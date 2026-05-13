from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import PersonSearchOut, RelationAggregateOut, RelationOut
from app.services.persons import (
    list_person_relations,
    list_person_relations_aggregate,
    search_persons,
    search_persons_executed_as_master_only,
)

router = APIRouter(prefix="/person", tags=["person"])


@router.get("/search", response_model=list[PersonSearchOut])
def person_search(
    name: str = Query(min_length=1),
    db: Session = Depends(get_db),
) -> list[PersonSearchOut]:
    return search_persons(db, name)


@router.get("/search_executed_masters", response_model=list[PersonSearchOut])
def person_search_executed_masters(
    name: str = Query(min_length=1),
    db: Session = Depends(get_db),
) -> list[PersonSearchOut]:
    """executed_as_master が true の人物のみを検索する（相関図の中心人物選定用）。"""
    return search_persons_executed_as_master_only(db, name)


@router.get("/{person_id}/relations", response_model=list[RelationOut])
def person_relations(
    person_id: int,
    db: Session = Depends(get_db),
) -> list[RelationOut]:
    items = list_person_relations(db, person_id)
    if items is None:
        raise HTTPException(status_code=404, detail="person not found")
    return items


@router.get(
    "/{person_id}/relations_aggregate", response_model=list[RelationAggregateOut]
)
def person_relations_aggregate(
    person_id: int,
    db: Session = Depends(get_db),
) -> list[RelationAggregateOut]:
    items = list_person_relations_aggregate(db, person_id)
    if items is None:
        raise HTTPException(status_code=404, detail="person not found")
    return items
