"""人物名検索（Wikipedia + Wikidata 人物判定、フロント `onSearch` の Wikipedia 部分）。"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import httpx
from sqlalchemy.orm import Session

from app.schemas import HumanCheck
from app.services.wiki.api.ja_mediawiki import JaWikipediaClient
from app.services.wiki.extract.two_hop.quota import quota_batch_human_checks
from app.services.wiki.human import batch_human_checks_with_db_redis_priority

logger = logging.getLogger(__name__)

ProgressCb = Callable[[str, int, int], Awaitable[None]] | None

# 人物判定の並列度。大きすぎると Wikipedia / Wikidata 側のレート制限や接続枯渇に触れやすい。
HUMAN_CHECK_CONCURRENCY = 5


@dataclass(slots=True)
class WikiSearchItem:
    """`JaWikipediaClient.search_people` / `lookup_exact_title` 合成結果の 1 件。"""

    title: str
    pageid: int
    snippet: str | None = None

    def as_api_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"title": self.title, "pageid": self.pageid}
        if self.snippet is not None:
            d["snippet"] = self.snippet
        return d

    @staticmethod
    def from_mediawiki_search_row(row: dict[str, Any]) -> WikiSearchItem:
        sn = row.get("snippet")
        return WikiSearchItem(
            title=str(row.get("title") or ""),
            pageid=int(row.get("pageid") or 0),
            snippet=None if sn is None else str(sn),
        )


async def _emit(cb: ProgressCb, phase: str, done: int, total: int) -> None:
    if cb:
        await cb(phase, done, total)


def _norm_title_for_exact_match(s: str) -> str:
    return " ".join(str(s or "").strip().replace("_", " ").split())


def _log_lookup_exact_failure(q: str, exc: BaseException) -> None:
    if isinstance(exc, httpx.TimeoutException):
        logger.warning("lookup_exact_title timeout: %s", q)
        return
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code if exc.response is not None else None
        if code == 429:
            logger.warning("lookup_exact_title 429: %s", q)
        else:
            logger.error("lookup_exact_title HTTP %s: %s", code, q, exc_info=exc)
        return
    if isinstance(exc, httpx.RequestError):
        logger.warning("lookup_exact_title request error: %s", q, exc_info=exc)
        return
    logger.exception("lookup_exact_title failed: %s", q)


async def filter_wiki_people_only(
    items: list[WikiSearchItem],
    on_progress: ProgressCb = None,
    *,
    db: Session,
) -> list[WikiSearchItem]:
    out: list[WikiSearchItem] = []
    total = len(items)
    batch_size = HUMAN_CHECK_CONCURRENCY
    for i in range(0, len(items), batch_size):
        batch = items[i : i + batch_size]
        await _emit(on_progress, "検索結果の人物判定", i, total)
        titles = [it.title for it in batch]

        async def _quota_batch(ts: list[str]) -> list[HumanCheck]:
            return await quota_batch_human_checks(ts, db=db)

        checks = await batch_human_checks_with_db_redis_priority(
            titles,
            db=db,
            live_batch_resolver=_quota_batch,
        )
        results = [c.source != "unknown" and bool(c.is_human) for c in checks]
        for it, ok in zip(batch, results):
            if ok:
                out.append(it)
        await _emit(on_progress, "検索結果の人物判定", i + len(batch), total)
    await _emit(on_progress, "検索結果の人物判定", total, total)
    return out


async def wiki_search_people_including_exact(
    wiki: JaWikipediaClient, query: str
) -> list[WikiSearchItem]:
    q = str(query or "").strip()
    if not q:
        return []
    search_task = asyncio.create_task(wiki.search_people(q))
    exact_task = asyncio.create_task(wiki.lookup_exact_title(q))
    search = await search_task

    skip_exact = bool(
        search
        and _norm_title_for_exact_match(q)
        == _norm_title_for_exact_match(str(search[0].get("title") or ""))
    )
    exact: WikiSearchItem | None = None
    if skip_exact:
        exact_task.cancel()
        try:
            await exact_task
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            _log_lookup_exact_failure(q, exc)
        exact = WikiSearchItem.from_mediawiki_search_row(search[0])
    else:
        try:
            looked = await exact_task
        except Exception as exc:
            _log_lookup_exact_failure(q, exc)
            looked = None
        if isinstance(looked, dict) and looked.get("title") and looked.get("pageid"):
            exact = WikiSearchItem(
                title=str(looked["title"]),
                pageid=int(looked["pageid"]),
            )
        else:
            exact = None

    by_page: dict[int, WikiSearchItem] = {}
    search_order_pids: list[int] = []
    seen_pid: set[int] = set()
    for raw in search:
        pid = int(raw.get("pageid") or 0)
        if not pid:
            continue
        if pid not in seen_pid:
            seen_pid.add(pid)
            search_order_pids.append(pid)
        by_page[pid] = WikiSearchItem.from_mediawiki_search_row(raw)

    if not exact:
        return [by_page[pid] for pid in search_order_pids if pid in by_page]

    pid_ex = int(exact.pageid)
    by_page[pid_ex] = exact
    ordered: list[WikiSearchItem] = [exact]
    for pid in search_order_pids:
        if pid == pid_ex:
            continue
        if pid in by_page:
            ordered.append(by_page[pid])
    return ordered


def _log_hatnote_failure(title: str, exc: BaseException) -> None:
    if isinstance(exc, httpx.TimeoutException):
        logger.warning("fetch_hatnote_ns0_link_sets timeout: %s", title)
        return
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code if exc.response is not None else None
        if code == 429:
            logger.warning("fetch_hatnote_ns0_link_sets 429: %s", title)
        else:
            logger.error(
                "fetch_hatnote_ns0_link_sets HTTP %s: %s", code, title, exc_info=exc
            )
        return
    if isinstance(exc, httpx.RequestError):
        logger.warning(
            "fetch_hatnote_ns0_link_sets request error: %s", title, exc_info=exc
        )
        return
    logger.exception("fetch_hatnote_ns0_link_sets failed: %s", title)


async def expand_disambiguation_results(
    wiki: JaWikipediaClient, items: list[WikiSearchItem]
) -> list[WikiSearchItem]:
    if not items:
        return items
    by_pageid: dict[int, WikiSearchItem] = {}
    for it in items:
        pid = int(it.pageid)
        if pid:
            by_pageid[pid] = it
    titles = [x.title for x in by_pageid.values()]
    dab_ids = await wiki.fetch_disambiguation_page_ids_by_titles(titles)
    if not dab_ids:
        return items

    dab_items = [it for it in by_pageid.values() if int(it.pageid) in dab_ids]
    hat_results = await asyncio.gather(
        *[wiki.fetch_hatnote_ns0_link_sets(it.title) for it in dab_items],
        return_exceptions=True,
    )

    pending_links: list[str] = []
    seen_link: set[str] = set()
    for it, res in zip(dab_items, hat_results):
        if isinstance(res, BaseException):
            _log_hatnote_failure(it.title, res)
            hat_in, hat_out = set(), set()
        else:
            hat_in, hat_out = res
        for link_title in hat_in:
            if link_title in hat_out or link_title in seen_link:
                continue
            seen_link.add(link_title)
            pending_links.append(link_title)

    if not pending_links:
        return list(by_pageid.values())

    looked_results = await asyncio.gather(
        *[wiki.lookup_exact_title(lt) for lt in pending_links],
        return_exceptions=True,
    )
    for link_title, looked in zip(pending_links, looked_results):
        if isinstance(looked, BaseException):
            if isinstance(looked, httpx.TimeoutException):
                logger.warning(
                    "lookup_exact_title timeout in disambiguation expand: %s",
                    link_title,
                )
            elif isinstance(looked, httpx.HTTPStatusError):
                code = (
                    looked.response.status_code if looked.response is not None else None
                )
                if code == 429:
                    logger.warning(
                        "lookup_exact_title 429 in disambiguation expand: %s",
                        link_title,
                    )
                else:
                    logger.error(
                        "lookup_exact_title HTTP %s in disambiguation expand: %s",
                        code,
                        link_title,
                        exc_info=looked,
                    )
            elif isinstance(looked, httpx.RequestError):
                logger.warning(
                    "lookup_exact_title request error in disambiguation expand: %s",
                    link_title,
                    exc_info=looked,
                )
            else:
                logger.error(
                    "lookup_exact_title failed in disambiguation expand: %s",
                    link_title,
                    exc_info=looked,
                )
            continue
        if isinstance(looked, dict) and looked.get("title") and looked.get("pageid"):
            lp = int(looked["pageid"])
            if lp and lp not in by_pageid:
                by_pageid[lp] = WikiSearchItem(
                    title=str(looked["title"]),
                    pageid=lp,
                )

    return list(by_pageid.values())


async def run_principal_wiki_search(
    wiki: JaWikipediaClient,
    query: str,
    on_progress: ProgressCb = None,
    *,
    db: Session,
) -> tuple[list[WikiSearchItem], str | None]:
    """Wikipedia 検索結果（人物のみ）と空メッセージ（0件時）を返す。"""
    wiki_items = await wiki_search_people_including_exact(wiki, query)
    if not wiki_items:
        return [], "該当人物はいません"

    await _emit(on_progress, "検索結果の人物判定", 0, len(wiki_items))
    wiki_humans = await filter_wiki_people_only(wiki_items, on_progress, db=db)

    if not wiki_humans:
        expanded = await expand_disambiguation_results(wiki, wiki_items)
        if len(expanded) > len(wiki_items):
            await _emit(on_progress, "検索結果の人物判定", 0, len(expanded))
            wiki_humans = await filter_wiki_people_only(expanded, on_progress, db=db)

    if not wiki_humans:
        return [], "該当人物はいません"
    return wiki_humans, None
