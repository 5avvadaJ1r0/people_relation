from __future__ import annotations

from app.model import Person, Relation
from app.schemas import (
    PersonOut,
    PersonSearchOut,
    RelationAggregateOut,
    RelationOut,
)


def _is_executed_master_from_person(person: Person) -> bool:
    return bool(person.executed_as_master)


def person_to_out(
    person: Person,
    *,
    has_relations: bool,
    is_executed_master: bool | None = None,
) -> PersonOut:
    is_exec = (
        _is_executed_master_from_person(person)
        if is_executed_master is None
        else is_executed_master
    )
    return PersonOut(
        id=person.id,
        name=person.name,
        title=person.title,
        url=person.url,
        has_relations=has_relations,
        is_executed_master=is_exec,
        executed_as_master_at=person.executed_as_master_at,
    )


def relation_out(
    master: Person,
    slave: Person,
    *,
    point: int,
    forward_edge_person_ids: set[int],
) -> RelationOut:
    return RelationOut(
        master=person_to_out(
            master, has_relations=master.id in forward_edge_person_ids
        ),
        slave=person_to_out(slave, has_relations=slave.id in forward_edge_person_ids),
        point=point,
    )


def relation_out_from_row(
    rel: Relation, *, forward_edge_person_ids: set[int]
) -> RelationOut:
    return relation_out(
        rel.master_person,
        rel.slave_person,
        point=rel.point,
        forward_edge_person_ids=forward_edge_person_ids,
    )


def relation_aggregate_out(
    fwd: Relation,
    rev: Relation | None,
    *,
    forward_edge_person_ids: set[int],
) -> RelationAggregateOut:
    reverse_point = rev.point if rev is not None else 0
    return RelationAggregateOut(
        master=person_to_out(
            fwd.master_person,
            has_relations=fwd.master_person_id in forward_edge_person_ids,
        ),
        slave=person_to_out(
            fwd.slave_person,
            has_relations=fwd.slave_person_id in forward_edge_person_ids,
        ),
        forward_point=fwd.point,
        reverse_point=reverse_point,
        total_point=fwd.point + reverse_point,
    )


def person_search_out(
    person: Person,
    *,
    has_relations: bool,
    is_executed_master: bool,
) -> PersonSearchOut:
    return PersonSearchOut(
        id=person.id,
        name=person.name,
        title=person.title,
        url=person.url,
        has_relations=has_relations,
        is_executed_master=is_executed_master,
        executed_as_master_at=person.executed_as_master_at,
    )


def stamp_master_executed_at_on_relations(
    items: list[RelationOut], *, marked: Person
) -> list[RelationOut]:
    """主体者 URL に紐づく人物の `executed_as_master_at` をレスポンスへ反映する。"""
    return [
        r.model_copy(
            update={
                "master": r.master.model_copy(
                    update={
                        "executed_as_master_at": marked.executed_as_master_at,
                        "is_executed_master": True,
                    }
                )
            }
        )
        if r.master.id == marked.id
        else r
        for r in items
    ]
