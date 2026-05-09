from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.schemas import PersonSearchOut, RelationAggregateOut, RelationOut
from app.services.persons import list_person_relations, list_person_relations_aggregate, search_persons

router = APIRouter(prefix="/person", tags=["person"])


@router.get("/search", response_model=list[PersonSearchOut])
def person_search(name: str = Query(min_length=1)) -> list[PersonSearchOut]:
    return search_persons(name)


@router.get("/{person_id}/relations", response_model=list[RelationOut])
def person_relations(person_id: int) -> list[RelationOut]:
    items = list_person_relations(person_id)
    if items is None:
        raise HTTPException(status_code=404, detail="person not found")
    return items


@router.get("/{person_id}/relations_aggregate", response_model=list[RelationAggregateOut])
def person_relations_aggregate(person_id: int) -> list[RelationAggregateOut]:
    items = list_person_relations_aggregate(person_id)
    if items is None:
        raise HTTPException(status_code=404, detail="person not found")
    return items
