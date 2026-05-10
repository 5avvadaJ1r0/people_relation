from __future__ import annotations

from sqlalchemy import select

from app import crud
from app.db import SessionLocal
from app.model import Person, Relation
from app.schemas import PersonOut, RelationIn, RelationOut
from app.services.wiki_resolve import (
    normalized_person_in,
    resolve_ja_wikipedia_titles_sync,
    title_from_ja_wikipedia_url,
)


def save_relations_batch(
    payload: list[RelationIn],
    *,
    executed_master_url: str | None,
) -> list[RelationOut]:
    titles_to_resolve: list[str] = []
    if executed_master_url:
        et = title_from_ja_wikipedia_url(executed_master_url)
        if et:
            titles_to_resolve.append(et)
    for item in payload:
        for pin in (item.master, item.slave):
            fu = title_from_ja_wikipedia_url(pin.url)
            if fu:
                titles_to_resolve.append(fu)
    resolved_titles = resolve_ja_wikipedia_titles_sync(titles_to_resolve)

    executed_norm: str | None = None
    if executed_master_url:
        et = title_from_ja_wikipedia_url(executed_master_url)
        if et:
            canon_et = resolved_titles.get(et, et)
            executed_norm = crud.wiki_ja_article_url(canon_et)
        else:
            executed_norm = crud.normalize_url(executed_master_url)

    db = SessionLocal()
    try:
        out: list[RelationOut] = []
        if executed_norm:
            url_n = crud.normalize_url(executed_norm)
            mp = db.scalar(select(Person).where(Person.url == url_n))
            if mp is not None:
                prev_slave_ids = list(
                    db.scalars(
                        select(Relation.slave_person_id).where(
                            Relation.master_person_id == mp.id
                        )
                    ).all()
                )
                crud.delete_relations_where_master(db, master_id=mp.id)
                crud.delete_reverse_edges_to_master_from_given_masters(
                    db,
                    slave_person_id=mp.id,
                    reverse_master_ids=prev_slave_ids,
                )

        for item in payload:
            mn, mu, mtit = normalized_person_in(item.master, resolved_titles)
            sn, su, stit = normalized_person_in(item.slave, resolved_titles)
            master = crud.upsert_person(db, name=mn, url=mu, title=mtit)
            slave = crud.upsert_person(db, name=sn, url=su, title=stit)
            rel = crud.upsert_relation(
                db, master_id=master.id, slave_id=slave.id, point=item.point
            )
            out.append(
                RelationOut(
                    master=PersonOut(
                        id=master.id,
                        name=master.name,
                        title=master.title,
                        url=master.url,
                        executed_as_master_at=master.executed_as_master_at,
                    ),
                    slave=PersonOut(
                        id=slave.id,
                        name=slave.name,
                        title=slave.title,
                        url=slave.url,
                        executed_as_master_at=slave.executed_as_master_at,
                    ),
                    point=rel.point,
                )
            )

        # 逆向き(slave->master)も一緒に保存しているため、今回の「主体者」を明示的に渡してもらい
        # その人物のみ「主体者として実行済み」フラグを立てる。
        marked: Person | None = None
        if executed_norm:
            marked = crud.mark_executed_as_master_by_url(db, url=executed_norm)
        db.commit()
        if marked is not None:
            out = [
                RelationOut(
                    master=PersonOut(
                        id=r.master.id,
                        name=r.master.name,
                        title=r.master.title,
                        url=r.master.url,
                        executed_as_master_at=(
                            marked.executed_as_master_at
                            if r.master.id == marked.id
                            else r.master.executed_as_master_at
                        ),
                    ),
                    slave=PersonOut(
                        id=r.slave.id,
                        name=r.slave.name,
                        title=r.slave.title,
                        url=r.slave.url,
                        executed_as_master_at=r.slave.executed_as_master_at,
                    ),
                    point=r.point,
                )
                for r in out
            ]
        return out
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
