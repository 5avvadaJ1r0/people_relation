from __future__ import annotations

import random
from datetime import datetime
from urllib.parse import quote

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.crud.relation import person_ids_with_forward_relation
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


def person_executed_as_master_predicate():
    """主体者として実行済み（`person.executed_as_master` が true）の SQL 条件。"""
    return Person.executed_as_master.is_(True)


def list_persons_executed_masters_by_urls(
    db: Session, *, urls: list[str]
) -> dict[str, Person]:
    """正規化 URL をキーに、`executed_as_master` 相当の人物のみ返す（❷ 相関図リンク用の一括突合）。"""
    if not urls:
        return {}
    norms = [normalize_url(u) for u in urls]
    uniq: list[str] = list(dict.fromkeys(norms))
    rows = db.scalars(
        select(Person).where(
            Person.url.in_(uniq),
            person_executed_as_master_predicate(),
        )
    ).all()
    return {normalize_url(p.url): p for p in rows}


def search_persons_executed_as_master(
    db: Session, *, name: str, limit: int = 20
) -> list[Person]:
    q = f"%{name.strip()}%"
    return list(
        db.scalars(
            select(Person)
            .where(Person.name.ilike(q), person_executed_as_master_predicate())
            .limit(limit)
        ).all()
    )


def search_persons(
    db: Session, *, name: str, limit: int = 20
) -> list[tuple[Person, bool, bool]]:
    q = f"%{name.strip()}%"
    persons = db.scalars(select(Person).where(Person.name.ilike(q)).limit(limit)).all()
    if not persons:
        return []

    ids = [p.id for p in persons]
    with_fwd = person_ids_with_forward_relation(db, person_ids=ids)
    out: list[tuple[Person, bool, bool]] = []
    for p in persons:
        has_rows = p.id in with_fwd
        executed = bool(getattr(p, "executed_as_master", False))
        out.append((p, has_rows, executed))
    return out


def get_person(db: Session, person_id: int) -> Person | None:
    return db.scalar(select(Person).where(Person.id == person_id))


def list_persons_by_ids(db: Session, *, person_ids: list[int]) -> list[Person]:
    """指定 ID の人物を取得する（入力順は保証しない）。"""
    if not person_ids:
        return []
    uniq = list(dict.fromkeys(person_ids))
    rows = db.scalars(select(Person).where(Person.id.in_(uniq))).all()
    return list(rows)


def get_person_by_url(db: Session, *, url: str) -> Person | None:
    """正規化済み URL 相当の `Person.url` で 1 件取得する。"""
    url_n = normalize_url(url)
    return db.scalar(select(Person).where(Person.url == url_n))


def pick_random_person_not_executed_as_master(db: Session) -> Person | None:
    """`executed_as_master` が false の人物から 1 件返す（該当なしは None）。

    `relation` に master / slave として登場する件数が最大の人物を優先する。
    件数が 0、または最大件数が同数の人物が複数いる場合はその中からランダムに選ぶ。
    """
    involvement = (
        select(Relation.master_person_id.label("person_id"))
        .union_all(select(Relation.slave_person_id.label("person_id")))
        .subquery()
    )
    rel_count = (
        select(
            involvement.c.person_id,
            func.count().label("rel_count"),
        )
        .group_by(involvement.c.person_id)
        .subquery()
    )
    rel_count_col = func.coalesce(rel_count.c.rel_count, 0)

    max_count = db.scalar(
        select(func.max(rel_count_col))
        .select_from(Person)
        .outerjoin(rel_count, Person.id == rel_count.c.person_id)
        .where(Person.executed_as_master.is_(False))
    )
    if max_count is None:
        return None

    candidates = list(
        db.scalars(
            select(Person)
            .outerjoin(rel_count, Person.id == rel_count.c.person_id)
            .where(
                Person.executed_as_master.is_(False),
                rel_count_col == max_count,
            )
        ).all()
    )
    if not candidates:
        return None
    return random.choice(candidates)


def mark_executed_as_master_by_url(db: Session, *, url: str) -> Person | None:
    url_n = normalize_url(url)
    person = db.scalar(select(Person).where(Person.url == url_n))
    if person is None:
        return None
    person.executed_as_master = True
    person.executed_as_master_at = datetime.now()
    return person
