from __future__ import annotations

from sqlalchemy.orm import Session

from app import crud
from app.schemas import RelationIn, RelationOut
from app.services.schema_maps import relation_out, stamp_master_executed_at_on_relations
from app.services.wiki.resolver.resolve import (
    normalized_person_in,
    resolve_ja_wikipedia_titles_sync,
    title_from_ja_wikipedia_url,
)


def save_relations_batch(
    db: Session,
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

    try:
        out: list[RelationOut] = []
        if executed_norm:
            mp = crud.get_person_by_url(db, url=executed_norm)
            if mp is not None:
                prev_slave_ids = crud.list_slave_person_ids_for_master(
                    db, master_id=mp.id
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
            out.append(relation_out(master, slave, point=rel.point))

        marked = None
        if executed_norm:
            marked = crud.mark_executed_as_master_by_url(db, url=executed_norm)
        db.commit()
        if marked is not None:
            out = stamp_master_executed_at_on_relations(out, marked=marked)
        return out
    except Exception:
        db.rollback()
        raise
