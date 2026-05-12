"""slave 側の reverse スコア計算と並列ワーカーによる集計。"""

from __future__ import annotations

import asyncio
import logging
import re

from app.services.wiki.api.ja_mediawiki import JaWikipediaClient
from app.services.wiki.extract.two_hop.models import (
    ForwardCandidate,
    ProgressCb,
    WikiRelationRow,
    WikilinkCountRow,
    emit_progress,
)
from app.services.wiki.extract.two_hop.quota import (
    WIKI_OUTBOUND_CONCURRENCY,
    quota_gather,
)
from app.services.wiki.parser.encoding_utils import (
    count_occurrences,
    decode_wiki_title_from_href,
    href_to_url,
    normalize_wiki_link_title,
)
from app.services.wiki.parser.wikitext import (
    count_links_from_wikitext,
    reverse_link_score_from_wikitext_and_parse,
)

log = logging.getLogger(__name__)

# reverse 候補を一度に N タスク化しないためのワーカー数（外向き同時実行と同程度）
REVERSE_SCORE_WORKERS = WIKI_OUTBOUND_CONCURRENCY
# フォワードスコアがこれ以下なら slave の extract/HTML reverse フォールバックを省略
REVERSE_TEXT_FALLBACK_MIN_FORWARD_POINT = 1

class _ReverseWorkStop:
    """ワーカー終了用キューsentinel（``object()`` だと Queue の Union が狭まらない）。"""

    __slots__ = ()


_REVERSE_WORK_STOP = _ReverseWorkStop()


async def reverse_point_for_slave(
    wiki: JaWikipediaClient,
    *,
    slave_title: str,
    master_title_candidates: set[str],
    master_candidate_norms: list[str],
    slave_forward_point: int | None = None,
) -> int:
    """wikitext と parse を先に取得し、リンク由来が 0 のときだけ extract / 平文 HTML にフォールバックする。"""
    slave_wikitext, parse_link_titles = await quota_gather(
        lambda: wiki.fetch_wikitext_by_title(slave_title),
        lambda: wiki.fetch_parse_ns0_link_title_set(slave_title),
    )
    slave_link_counts: dict[str, WikilinkCountRow] = {
        k: {"count": int(v.count), "href": v.href}
        for k, v in count_links_from_wikitext(slave_wikitext).items()
    }
    link_score = reverse_link_score_from_wikitext_and_parse(
        slave_link_counts,
        parse_link_titles,
        master_title_candidates,
    )
    if link_score > 0:
        return link_score

    if (
        slave_forward_point is not None
        and slave_forward_point <= REVERSE_TEXT_FALLBACK_MIN_FORWARD_POINT
    ):
        return 0

    slave_extract_raw, slave_html_text_raw = await quota_gather(
        lambda: wiki.fetch_extract_text_by_title(slave_title),
        lambda: wiki.fetch_parse_plain_text_by_title(slave_title),
    )
    slave_extract_text = re.sub(r"\s+", " ", str(slave_extract_raw or "")).strip()
    slave_html_text = re.sub(r"\s+", " ", str(slave_html_text_raw or "")).strip()
    text_score = 0
    for norm in master_candidate_norms:
        c_extract = (
            count_occurrences(slave_extract_text, norm) if slave_extract_text else 0
        )
        c_html = count_occurrences(slave_html_text, norm) if slave_html_text else 0
        text_score = max(text_score, c_extract, c_html)
    return text_score


async def collect_reverse_scores(
    wiki: JaWikipediaClient,
    *,
    ranked: list[ForwardCandidate],
    master_title: str,
    master_name: str,
    canonical_title: str,
    master_redirects: list[str],
    master_url: str,
    on_progress: ProgressCb,
) -> tuple[list[WikiRelationRow], int, list[str]]:
    """reverse は `quota_gather` で外向きを抑制し、候補は限定ワーカーで処理する。"""
    reverse_checked_count = 0
    reverse_checked_sample: list[str] = []
    track_sample = log.isEnabledFor(logging.INFO)

    master_title_candidates = {
        master_title,
        master_name,
        canonical_title,
        *master_redirects,
    }
    master_candidate_norms = sorted(
        {
            n
            for n in (
                normalize_wiki_link_title(str(c)) for c in master_title_candidates
            )
            if n
        },
        key=len,
        reverse=True,
    )

    reverse_check_limit = 80
    reverse_check_all_if_total_at_most = 1000
    total = len(ranked)
    meta_lock = asyncio.Lock()
    completed = 0

    async def score_one(i: int, r: ForwardCandidate) -> WikiRelationRow:
        nonlocal reverse_checked_count, completed
        reverse_point = 0
        has_wiki_page = False
        slave_url = ""
        slave_title = str(r.get("name") or "")

        should_check_reverse = (
            total <= reverse_check_all_if_total_at_most
            or i < reverse_check_limit
            or int(r.get("reverseCheckPoint") or r.get("point") or 0) >= 4
        )

        href = r.get("href")
        if href:
            has_wiki_page = True
            slave_title = decode_wiki_title_from_href(str(href))
            slave_url = href_to_url(str(href))

            if should_check_reverse:
                try:
                    reverse_point = await reverse_point_for_slave(
                        wiki,
                        slave_title=slave_title,
                        master_title_candidates=master_title_candidates,
                        master_candidate_norms=master_candidate_norms,
                        slave_forward_point=int(r.get("point") or 0),
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as ex:
                    log.warning(
                        "reversePoint calc failed master=%s slave=%s href=%s err=%s",
                        master_title,
                        slave_title,
                        href,
                        ex,
                    )
                    reverse_point = 0
                async with meta_lock:
                    reverse_checked_count += 1
                    if track_sample and len(reverse_checked_sample) < 10:
                        reverse_checked_sample.append(
                            f"{slave_title}({r.get('point')})"
                        )

        fp = int(r.get("point") or 0)
        row: WikiRelationRow = {
            "slave": {
                "name": str(r.get("name") or ""),
                "title": slave_title,
                "url": slave_url or master_url,
            },
            "forwardPoint": fp,
            "reversePoint": reverse_point,
            "totalPoint": fp + reverse_point,
            "hasWikiPage": has_wiki_page,
        }
        async with meta_lock:
            completed += 1
            await emit_progress(on_progress, "関連者検索", completed, total)
        return row

    if total == 0:
        return [], reverse_checked_count, reverse_checked_sample

    results_buf: list[WikiRelationRow | None] = [None] * total
    work_q: asyncio.Queue[tuple[int, ForwardCandidate] | _ReverseWorkStop] = (
        asyncio.Queue()
    )
    for i, row in enumerate(ranked):
        await work_q.put((i, row))
    num_workers = min(REVERSE_SCORE_WORKERS, max(1, total))
    for _ in range(num_workers):
        await work_q.put(_REVERSE_WORK_STOP)

    async def worker() -> None:
        while True:
            item = await work_q.get()
            if isinstance(item, _ReverseWorkStop):
                break
            idx, row = item
            results_buf[idx] = await score_one(idx, row)

    await asyncio.gather(*(worker() for _ in range(num_workers)))
    out: list[WikiRelationRow] = []
    for i in range(total):
        cell = results_buf[i]
        if cell is None:
            raise RuntimeError(f"reverse worker did not fill index {i}")
        out.append(cell)
    return out, reverse_checked_count, reverse_checked_sample
