from __future__ import annotations

from dataclasses import dataclass

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


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
    has_relations: bool
    is_executed_master: bool
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
    is_executed_master: bool
    executed_as_master_at: datetime | None = None


class WikiMasterResolvePageIn(BaseModel):
    """Wikipedia 検索結果の 1 行（記事タイトルから ja.wikipedia の canonical URL を組み立てる）。"""

    title: str = Field(min_length=1, max_length=500)
    pageid: int = Field(description="MediaWiki の pageid（レスポンス突合用）")


class WikiMasterResolveIn(BaseModel):
    items: list[WikiMasterResolvePageIn] = Field(min_length=1, max_length=50)


class WikiMasterResolvePageOut(BaseModel):
    pageid: int
    person: PersonSearchOut | None = None


class WikiMasterResolveOut(BaseModel):
    items: list[WikiMasterResolvePageOut]


class CoreNetworkIn(BaseModel):
    """相関図（中心人物複数）のエッジ取得リクエスト。"""

    center_titles: list[str] = Field(min_length=2, max_length=10)
    total_point_gt: int = Field(
        default=1,
        ge=0,
        description="無向ペア集約後の HAVING 条件: SUM(relation.point) > total_point_gt",
    )

    @field_validator("center_titles")
    @classmethod
    def normalize_center_titles(cls, v: list[str]) -> list[str]:
        cleaned = [t.strip() for t in v if t.strip()]
        uniq = list(dict.fromkeys(cleaned))
        if len(uniq) < 2 or len(uniq) > 10:
            raise ValueError(
                "中心人物は2名以上10名以下のユニークな人物（title）を指定してください"
            )
        return uniq


class DiagramRelationPairOut(BaseModel):
    person1: str
    person2: str
    total_point: int


class DiagramCoreNetworkOut(BaseModel):
    center_titles: list[str]
    pairs: list[DiagramRelationPairOut]
