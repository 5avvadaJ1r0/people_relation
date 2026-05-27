"""2-hop 抽出で使う型定義・主体記事コンテキスト。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Protocol, TypedDict

WikiQuotaFactory = Callable[[], Awaitable[Any]]


class SupportsResolveCanonicalTitles(Protocol):
    async def resolve_canonical_titles_for_titles(
        self, titles: list[str]
    ) -> dict[str, str]: ...


class WikiSlaveRef(TypedDict):
    """レスポンス `master.slave` および確定行の人物参照（必須フィールド）。"""

    name: str
    title: str
    url: str


class WikiRelationRow(TypedDict, total=False):
    slave: WikiSlaveRef
    forwardPoint: int
    reversePoint: int
    totalPoint: int
    hasWikiPage: bool


class ForwardCandidate(TypedDict):
    name: str
    point: int
    href: str | None
    title: str | None
    reverseCheckPoint: int


class WikilinkCountRow(TypedDict, total=False):
    count: int
    href: str | None


class ForwardScoreRow(TypedDict, total=False):
    point: int
    href: str | None
    title: str | None


@dataclass(slots=True)
class MasterArticleContext:
    extract_text: str
    wikitext: str
    canonical_title: str
    master_parse_links: set[str]
    hat_in: set[str]
    hat_out: set[str]
    master_html_text_raw: str
    master_redirects: list[str]
    master_parse_link_norms: set[str]
    master_link_exclude_norms: set[str]
