from __future__ import annotations

from app.model import Person, Relation
from app.schemas import PersonOut, RelationAggregateOut, RelationOut, PersonSearchOut


def person_to_out(person: Person) -> PersonOut:
    executed = person.executed_as_master_at is not None or bool(
        person.executed_as_master
    )
    return PersonOut(
        id=person.id,
        name=person.name,
        title=person.title,
        url=person.url,
        has_relations=executed,
        executed_as_master_at=person.executed_as_master_at,
    )


def relation_out(master: Person, slave: Person, *, point: int) -> RelationOut:
    return RelationOut(
        master=person_to_out(master),
        slave=person_to_out(slave),
        point=point,
    )


def relation_out_from_row(rel: Relation) -> RelationOut:
    return relation_out(rel.master_person, rel.slave_person, point=rel.point)


def relation_aggregate_out(fwd: Relation, rev: Relation | None) -> RelationAggregateOut:
    reverse_point = rev.point if rev is not None else 0
    return RelationAggregateOut(
        master=person_to_out(fwd.master_person),
        slave=person_to_out(fwd.slave_person),
        forward_point=fwd.point,
        reverse_point=reverse_point,
        total_point=fwd.point + reverse_point,
    )


def person_search_out(
    person: Person, *, has_relations: bool | None = None
) -> PersonSearchOut:
    if has_relations is None:
        executed = person.executed_as_master_at is not None or bool(
            person.executed_as_master
        )
        has_relations = executed
    return PersonSearchOut(
        id=person.id,
        name=person.name,
        title=person.title,
        url=person.url,
        has_relations=has_relations,
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
                    update={"executed_as_master_at": marked.executed_as_master_at}
                )
            }
        )
        if r.master.id == marked.id
        else r
        for r in items
    ]
