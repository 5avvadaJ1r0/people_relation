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


class WikiSearchRowOut(BaseModel):
    title: str
    pageid: int
    snippet: str | None = None


class WikiPersonSearchOut(BaseModel):
    """Wikipedia 人物検索（人物フィルタ済み）の JSON 応答。"""

    wiki: list[WikiSearchRowOut]
    empty_message: str | None = Field(
        default=None,
        description="wiki が空のときの理由文言（例: 該当人物はいません）",
    )


class CoreNetworkIn(BaseModel):
    """相関図（中心人物複数）のエッジ取得リクエスト。"""

    center_titles: list[str] = Field(min_length=1, max_length=10)
    total_point_gt: int = Field(
        default=1,
        ge=0,
        description="無向ペア集約後の HAVING 条件: SUM(relation.point) > total_point_gt",
    )
    exclude_zero_reverse: bool = Field(
        default=True,
        description=(
            "True のとき無向ペアの両方向に point<>0 の relation が必要"
            "（関連者リストの「主体値または関連値0は除外」と同等）"
        ),
    )

    @field_validator("center_titles")
    @classmethod
    def normalize_center_titles(cls, v: list[str]) -> list[str]:
        cleaned = [t.strip() for t in v if t.strip()]
        uniq = list(dict.fromkeys(cleaned))
        if len(uniq) < 1 or len(uniq) > 10:
            raise ValueError(
                "中心人物は1名以上10名以下のユニークな人物（title）を指定してください"
            )
        return uniq


class DiagramRelationPairOut(BaseModel):
    person1: str
    person2: str
    total_point: int


class DiagramCoreNetworkOut(BaseModel):
    center_titles: list[str]
    pairs: list[DiagramRelationPairOut]


class DiagramShareCreateIn(BaseModel):
    """相関図共有 URL 用の暗号化トークン生成リクエスト。"""

    center_person_ids: list[int] = Field(min_length=1, max_length=10)
    show_peer_links: bool = False
    total_point_gt: int = Field(
        default=1,
        ge=0,
        description="無向ペア集約後の HAVING 条件: SUM(relation.point) > total_point_gt",
    )
    exclude_zero_reverse: bool = Field(
        default=True,
        description="True のとき無向ペアの両方向に point<>0 の relation が必要",
    )

    @field_validator("center_person_ids")
    @classmethod
    def normalize_center_person_ids(cls, v: list[int]) -> list[int]:
        uniq = list(dict.fromkeys(v))
        if len(uniq) < 1 or len(uniq) > 10:
            raise ValueError(
                "中心人物は1名以上10名以下のユニークな ID を指定してください"
            )
        return uniq


class DiagramShareTokenOut(BaseModel):
    share_id: str


class DiagramShareOut(BaseModel):
    share_id: str
    center_person_ids: list[int]
    show_peer_links: bool
    total_point_gt: int
    exclude_zero_reverse: bool = True
    center_persons: list[PersonSearchOut]
    has_og_image: bool = False
