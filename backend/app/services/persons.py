from __future__ import annotations

from sqlalchemy.orm import Session

from app import crud
from app.schemas import PersonOut, PersonSearchOut, RelationAggregateOut, RelationOut


def search_persons_executed_as_master_only(
    db: Session, name: str
) -> list[PersonSearchOut]:
    """主体者として実行済み（executed_as_master）の人物のみを名前で検索する。"""
    persons = crud.search_persons_executed_as_master(db, name=name, limit=20)
    return [
        PersonSearchOut(
            id=p.id,
            name=p.name,
            title=p.title,
            url=p.url,
            has_relations=p.executed_as_master_at is not None
            or bool(p.executed_as_master),
            executed_as_master_at=p.executed_as_master_at,
        )
        for p in persons
    ]


def search_persons(db: Session, name: str) -> list[PersonSearchOut]:
    rows = crud.search_persons(db, name=name, limit=20)
    return [
        PersonSearchOut(
            id=p.id,
            name=p.name,
            title=p.title,
            url=p.url,
            has_relations=has_rel,
            executed_as_master_at=p.executed_as_master_at,
        )
        for p, has_rel in rows
    ]


def list_person_relations(db: Session, person_id: int) -> list[RelationOut] | None:
    person = crud.get_person(db, person_id)
    if person is None:
        return None
    rels = crud.get_relations_for_master(db, master_id=person_id, limit=50)
    return [
        RelationOut(
            master=PersonOut(
                id=r.master_person.id,
                name=r.master_person.name,
                title=r.master_person.title,
                url=r.master_person.url,
                executed_as_master_at=r.master_person.executed_as_master_at,
            ),
            slave=PersonOut(
                id=r.slave_person.id,
                name=r.slave_person.name,
                title=r.slave_person.title,
                url=r.slave_person.url,
                executed_as_master_at=r.slave_person.executed_as_master_at,
            ),
            point=r.point,
        )
        for r in rels
    ]


def list_person_relations_aggregate(
    db: Session, person_id: int
) -> list[RelationAggregateOut] | None:
    person = crud.get_person(db, person_id)
    if person is None:
        return None
    rows = crud.get_relation_aggregates_for_master(db, master_id=person_id, limit=50)
    out: list[RelationAggregateOut] = []
    for fwd, rev in rows:
        reverse_point = rev.point if rev is not None else 0
        total_point = fwd.point + reverse_point
        out.append(
            RelationAggregateOut(
                master=PersonOut(
                    id=fwd.master_person.id,
                    name=fwd.master_person.name,
                    title=fwd.master_person.title,
                    url=fwd.master_person.url,
                    executed_as_master_at=fwd.master_person.executed_as_master_at,
                ),
                slave=PersonOut(
                    id=fwd.slave_person.id,
                    name=fwd.slave_person.name,
                    title=fwd.slave_person.title,
                    url=fwd.slave_person.url,
                    executed_as_master_at=fwd.slave_person.executed_as_master_at,
                ),
                forward_point=fwd.point,
                reverse_point=reverse_point,
                total_point=total_point,
            )
        )
    out.sort(key=lambda x: x.total_point, reverse=True)
    return out
