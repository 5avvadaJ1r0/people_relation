from __future__ import annotations

from sqlalchemy.orm import Session

from app import crud
from app.services.schema_maps import (
    person_search_out,
    relation_aggregate_out,
    relation_out_from_row,
)
from app.schemas import (
    PersonSearchOut,
    RelationAggregateOut,
    RelationOut,
    WikiMasterResolveIn,
    WikiMasterResolveOut,
    WikiMasterResolvePageOut,
)


def search_persons_executed_as_master_only(
    db: Session, name: str
) -> list[PersonSearchOut]:
    """主体者として実行済み（executed_as_master）の人物のみを名前で検索する。"""
    persons = crud.search_persons_executed_as_master(db, name=name, limit=20)
    if not persons:
        return []
    ids = [p.id for p in persons]
    with_fwd = crud.person_ids_with_forward_relation(db, person_ids=ids)
    return [
        person_search_out(
            p,
            has_relations=p.id in with_fwd,
            is_executed_master=True,
        )
        for p in persons
    ]


def resolve_wiki_master_rows(
    db: Session, body: WikiMasterResolveIn
) -> WikiMasterResolveOut:
    """各 Wikipedia 記事 URL に紐づく人物が主体者として実行済みなら `PersonSearchOut` を返す。"""
    pages = body.items
    urls = [crud.wiki_ja_article_url(p.title) for p in pages]
    by_url = crud.list_persons_executed_masters_by_urls(db, urls=urls)
    resolved_people = list(by_url.values())
    fwd_ids: set[int] = set()
    if resolved_people:
        fwd_ids = crud.person_ids_with_forward_relation(
            db, person_ids=[p.id for p in resolved_people]
        )
    items: list[WikiMasterResolvePageOut] = []
    for page, u in zip(pages, urls):
        row = by_url.get(crud.normalize_url(u))
        items.append(
            WikiMasterResolvePageOut(
                pageid=page.pageid,
                person=(
                    person_search_out(
                        row,
                        has_relations=row.id in fwd_ids,
                        is_executed_master=True,
                    )
                    if row is not None
                    else None
                ),
            )
        )
    return WikiMasterResolveOut(items=items)


def search_persons(db: Session, name: str) -> list[PersonSearchOut]:
    rows = crud.search_persons(db, name=name, limit=20)
    return [
        person_search_out(
            p,
            has_relations=has_fwd,
            is_executed_master=is_exec,
        )
        for p, has_fwd, is_exec in rows
    ]


def list_person_relations(db: Session, person_id: int) -> list[RelationOut] | None:
    person = crud.get_person(db, person_id)
    if person is None:
        return None
    rels = crud.get_relations_for_master(db, master_id=person_id, limit=50)
    ids: list[int] = []
    for r in rels:
        ids.append(r.master_person_id)
        ids.append(r.slave_person_id)
    forward = crud.person_ids_with_forward_relation(db, person_ids=ids)
    return [relation_out_from_row(r, forward_edge_person_ids=forward) for r in rels]


def list_person_relations_aggregate(
    db: Session, person_id: int
) -> list[RelationAggregateOut] | None:
    person = crud.get_person(db, person_id)
    if person is None:
        return None
    rows = crud.get_relation_aggregates_for_master(db, master_id=person_id, limit=50)
    ids: list[int] = []
    for fwd, rev in rows:
        ids.append(fwd.master_person_id)
        ids.append(fwd.slave_person_id)
    forward = crud.person_ids_with_forward_relation(db, person_ids=ids)
    out = [
        relation_aggregate_out(fwd, rev, forward_edge_person_ids=forward)
        for fwd, rev in rows
    ]
    out.sort(key=lambda x: x.total_point, reverse=True)
    return out
