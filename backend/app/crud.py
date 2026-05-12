from __future__ import annotations

from datetime import datetime
from urllib.parse import quote

from sqlalchemy import and_, delete, select
from sqlalchemy.orm import aliased
from sqlalchemy.orm import Session

from app.model import Person, Relation, WikiHumanCache


def normalize_url(url: str) -> str:
    return url.strip()


def wiki_ja_article_url(title: str) -> str:
    """フロントの `encodeURIComponent(title.replace(/ /g, '_'))` と同様の記事 URL。"""
    segment = title.strip().replace(" ", "_")
    return "https://ja.wikipedia.org/wiki/" + quote(segment, safe="-_.!~*'()")


def get_wiki_human_cache(db: Session, *, url: str) -> WikiHumanCache | None:
    """記事URL単位の人物判定キャッシュを返す（無ければ None）。"""
    url_n = normalize_url(url)
    return db.scalar(select(WikiHumanCache).where(WikiHumanCache.url == url_n))


def list_wiki_human_cache_by_urls(db: Session, urls: list[str]) -> list[WikiHumanCache]:
    """複数 URL を一度に `wiki_human_cache` から取得する（検索結果の人物判定バッチ用）。"""
    if not urls:
        return []
    norms = [normalize_url(u) for u in urls]
    uniq: list[str] = list(dict.fromkeys(norms))
    rows = db.scalars(select(WikiHumanCache).where(WikiHumanCache.url.in_(uniq))).all()
    return list(rows)


def upsert_wiki_human_cache(
    db: Session,
    *,
    title: str,
    url: str,
    qid: str | None,
    is_human: bool,
) -> WikiHumanCache:
    """記事URL単位の人物判定キャッシュを作成または更新する。

    is_human=False のケースもここで保存する（人物以外として判定された URL も
    キャッシュしたいため。person テーブルには触れない）。
    """
    url_n = normalize_url(url)
    row = db.scalar(select(WikiHumanCache).where(WikiHumanCache.url == url_n))
    if row is None:
        row = WikiHumanCache(title=title, url=url_n, qid=qid, is_human=is_human)
        db.add(row)
    else:
        row.title = title
        row.qid = qid
        row.is_human = is_human
    db.flush()
    return row


def upsert_person(db: Session, *, name: str, url: str, title: str | None) -> Person:
    url_n = normalize_url(url)
    person = db.scalar(select(Person).where(Person.url == url_n))
    if person is None:
        person = Person(name=name, title=title or name, url=url_n)
        db.add(person)
        db.flush()
        return person

    # タイトルはWikipediaの表示名として使いたいので、空でなければ更新
    person.name = name
    if title:
        person.title = title
    return person


def delete_relations_where_master(db: Session, *, master_id: int) -> int:
    """主体を master とする forward 行をすべて削除する。"""
    res = db.execute(delete(Relation).where(Relation.master_person_id == master_id))
    return int(res.rowcount or 0)


def delete_reverse_edges_to_master_from_given_masters(
    db: Session, *, slave_person_id: int, reverse_master_ids: list[int]
) -> int:
    """
    slave が主体・master が以前 forward で繋がっていた相手、という逆向き行だけ削除する。
    （主体を再実行したときに残る B->A を掃除する用）
    """
    if not reverse_master_ids:
        return 0
    res = db.execute(
        delete(Relation).where(
            Relation.slave_person_id == slave_person_id,
            Relation.master_person_id.in_(reverse_master_ids),
        )
    )
    return int(res.rowcount or 0)


def upsert_relation(
    db: Session, *, master_id: int, slave_id: int, point: int
) -> Relation:
    rel = db.scalar(
        select(Relation).where(
            and_(
                Relation.master_person_id == master_id,
                Relation.slave_person_id == slave_id,
            )
        )
    )
    if rel is None:
        rel = Relation(
            master_person_id=master_id, slave_person_id=slave_id, point=point
        )
        db.add(rel)
        # 同一リクエスト内で同じ(master,slave)が複数回現れると、未flushの間はSELECTで検出できず
        # commit/flush時にユニーク制約違反(500)になるため、ここでflushして早めに確定させる。
        db.flush()
        return rel

    rel.point = point
    return rel


def search_persons(
    db: Session, *, name: str, limit: int = 20
) -> list[tuple[Person, bool]]:
    q = f"%{name.strip()}%"
    persons = db.scalars(select(Person).where(Person.name.ilike(q)).limit(limit)).all()
    if not persons:
        return []

    out: list[tuple[Person, bool]] = []
    for p in persons:
        # 「前回実行あり」は主体者として実行した人のみを対象にする
        executed = getattr(p, "executed_as_master_at", None) is not None or bool(
            getattr(p, "executed_as_master", False)
        )
        out.append((p, executed))
    return out


def get_relations_for_master(
    db: Session, *, master_id: int, limit: int = 50
) -> list[Relation]:
    return (
        db.query(Relation)
        .where(Relation.master_person_id == master_id)
        .order_by(Relation.point.desc(), Relation.id.asc())
        .limit(limit)
        .all()
    )


def get_relation_aggregates_for_master(db: Session, *, master_id: int, limit: int = 50):
    """
    master -> slave を forward とし、slave -> master を reverse として付けて返す。
    """
    r_fwd = aliased(Relation)
    r_rev = aliased(Relation)

    rows = (
        db.query(r_fwd, r_rev)
        .outerjoin(
            r_rev,
            and_(
                r_rev.master_person_id == r_fwd.slave_person_id,
                r_rev.slave_person_id == r_fwd.master_person_id,
            ),
        )
        .where(r_fwd.master_person_id == master_id)
        .order_by(r_fwd.point.desc(), r_fwd.id.asc())
        .limit(limit)
        .all()
    )
    return rows


def get_person(db: Session, person_id: int) -> Person | None:
    return db.scalar(select(Person).where(Person.id == person_id))


def mark_executed_as_master_by_url(db: Session, *, url: str) -> Person | None:
    url_n = normalize_url(url)
    person = db.scalar(select(Person).where(Person.url == url_n))
    if person is None:
        return None
    person.executed_as_master = True
    person.executed_as_master_at = datetime.now()
    return person
