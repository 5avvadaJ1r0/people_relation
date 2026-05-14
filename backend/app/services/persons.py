from __future__ import annotations

from sqlalchemy.orm import Session

from app import crud
from app.services.schema_maps import (
    person_search_out,
    relation_aggregate_out,
    relation_out_from_row,
)
from app.schemas import PersonSearchOut, RelationAggregateOut, RelationOut


def search_persons_executed_as_master_only(
    db: Session, name: str
) -> list[PersonSearchOut]:
    """主体者として実行済み（executed_as_master）の人物のみを名前で検索する。"""
    persons = crud.search_persons_executed_as_master(db, name=name, limit=20)
    return [person_search_out(p) for p in persons]


def search_persons(db: Session, name: str) -> list[PersonSearchOut]:
    rows = crud.search_persons(db, name=name, limit=20)
    return [person_search_out(p, has_relations=has_rel) for p, has_rel in rows]


def list_person_relations(db: Session, person_id: int) -> list[RelationOut] | None:
    person = crud.get_person(db, person_id)
    if person is None:
        return None
    rels = crud.get_relations_for_master(db, master_id=person_id, limit=50)
    return [relation_out_from_row(r) for r in rels]


def list_person_relations_aggregate(
    db: Session, person_id: int
) -> list[RelationAggregateOut] | None:
    person = crud.get_person(db, person_id)
    if person is None:
        return None
    rows = crud.get_relation_aggregates_for_master(db, master_id=person_id, limit=50)
    out = [relation_aggregate_out(fwd, rev) for fwd, rev in rows]
    out.sort(key=lambda x: x.total_point, reverse=True)
    return out
