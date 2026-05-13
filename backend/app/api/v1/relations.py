from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import RelationIn, RelationOut
from app.services.relations import save_relations_batch

router = APIRouter(tags=["relation"])


@router.post("/relation", response_model=list[RelationOut])
def post_relations(
    payload: list[RelationIn],
    executed_master_url: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[RelationOut]:
    return save_relations_batch(
        db, payload, executed_master_url=executed_master_url
    )
