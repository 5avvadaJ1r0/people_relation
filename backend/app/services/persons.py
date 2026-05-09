from __future__ import annotations

from app import crud
from app.db import SessionLocal
from app.schemas import PersonOut, PersonSearchOut, RelationAggregateOut, RelationOut


def search_persons(name: str) -> list[PersonSearchOut]:
    db = SessionLocal()
    try:
        rows = crud.search_persons(db, name=name, limit=20)
        return [
            PersonSearchOut(
                id=p.id, name=p.name, title=p.title, url=p.url, has_relations=has_rel
            )
            for p, has_rel in rows
        ]
    finally:
        db.close()


def list_person_relations(person_id: int) -> list[RelationOut] | None:
    db = SessionLocal()
    try:
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
                ),
                slave=PersonOut(
                    id=r.slave_person.id,
                    name=r.slave_person.name,
                    title=r.slave_person.title,
                    url=r.slave_person.url,
                ),
                point=r.point,
            )
            for r in rels
        ]
    finally:
        db.close()


def list_person_relations_aggregate(
    person_id: int,
) -> list[RelationAggregateOut] | None:
    db = SessionLocal()
    try:
        person = crud.get_person(db, person_id)
        if person is None:
            return None
        rows = crud.get_relation_aggregates_for_master(
            db, master_id=person_id, limit=50
        )
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
                    ),
                    slave=PersonOut(
                        id=fwd.slave_person.id,
                        name=fwd.slave_person.name,
                        title=fwd.slave_person.title,
                        url=fwd.slave_person.url,
                    ),
                    forward_point=fwd.point,
                    reverse_point=reverse_point,
                    total_point=total_point,
                )
            )
        out.sort(key=lambda x: x.total_point, reverse=True)
        return out
    finally:
        db.close()
