from __future__ import annotations

from dataclasses import dataclass

from datetime import datetime

from pydantic import BaseModel, Field


@dataclass(frozen=True)
class HumanCheck:
    title: str
    qid: str | None
    is_human: bool
    source: str  # db_cache / cache / live / unknown


class PersonIn(BaseModel):
    name: str
    url: str
    title: str | None = None


class RelationIn(BaseModel):
    master: PersonIn
    slave: PersonIn
    point: int = Field(ge=0)


class PersonOut(BaseModel):
    id: int
    name: str
    title: str
    url: str
    executed_as_master_at: datetime | None = None


class RelationOut(BaseModel):
    master: PersonOut
    slave: PersonOut
    point: int


class RelationAggregateOut(BaseModel):
    master: PersonOut
    slave: PersonOut
    forward_point: int
    reverse_point: int
    total_point: int


class PersonSearchOut(BaseModel):
    id: int
    name: str
    title: str
    url: str
    has_relations: bool
    executed_as_master_at: datetime | None = None
