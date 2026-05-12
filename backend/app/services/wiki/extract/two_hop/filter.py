"""フォワード候補に対する人物判定・主体除外・正規化マージ。"""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import unquote

from app import crud
from app.schemas import HumanCheck
from app.services.wiki.api.ja_mediawiki import JaWikipediaClient
from app.services.wiki.extract.two_hop.models import (
    ForwardCandidate,
    ProgressCb,
    SupportsResolveCanonicalTitles,
    WikiRelationRow,
    emit_progress,
)
from app.services.wiki.extract.two_hop.quota import (
    quota_batch_human_checks,
    quota_run,
)
from app.services.wiki.human import batch_human_checks_with_db_redis_priority
from app.services.wiki.parser.encoding_utils import (
    decode_wiki_title_from_href,
    normalize_wiki_link_title,
)

log = logging.getLogger(__name__)

# Wikidata wbgetentities の束ね幅に合わせた人物判定バッチ
HUMAN_CHECK_BATCH_SIZE = 50


def relation_passes_self_filter(
    rel: WikiRelationRow, master_link_exclude_norms: set[str]
) -> bool:
    """主体記事自身・別名・リダイレクト先と同一なら False（除外）、それ以外は True（残す）。"""
    for raw in [
        (rel.get("slave") or {}).get("name"),
        (rel.get("slave") or {}).get("title"),
    ]:
        n = normalize_wiki_link_title(str(raw or ""))
        if n and n in master_link_exclude_norms:
            return False
    u = str((rel.get("slave") or {}).get("url") or "")
    ix = u.find("/wiki/")
    if ix >= 0:
        tail = u[ix + len("/wiki/") :]
        try:
            nn = normalize_wiki_link_title(unquote(tail).replace("_", " "))
            if nn and nn in master_link_exclude_norms:
                return False
        except Exception:
            nn = normalize_wiki_link_title(tail.replace("_", " "))
            if nn and nn in master_link_exclude_norms:
                return False
    return True


async def filter_forward_humans(
    wiki: JaWikipediaClient,
    *,
    ranked: list[ForwardCandidate],
    forward_keep: int,
    max_related: int,
    on_progress: ProgressCb,
) -> list[ForwardCandidate]:
    human_check_limit = min(2000, max(350, max_related * 12))
    human_check_min_point = 1
    ranked_with_href = [
        r
        for r in ranked
        if r.get("href") and int(r.get("point") or 0) >= human_check_min_point
    ]
    ranked_with_href = sorted(
        ranked_with_href, key=lambda x: int(x.get("point") or 0), reverse=True
    )[:human_check_limit]

    if not ranked_with_href:
        return ranked

    await emit_progress(on_progress, "人物判定処理中", 0, len(ranked_with_href))
    ok_names: set[str] = set()
    for i in range(0, len(ranked_with_href), HUMAN_CHECK_BATCH_SIZE):
        batch = ranked_with_href[i : i + HUMAN_CHECK_BATCH_SIZE]
        titles = [decode_wiki_title_from_href(str(r.get("href") or "")) for r in batch]
        try:
            checks = await batch_human_checks_with_db_redis_priority(
                titles,
                live_batch_resolver=quota_batch_human_checks,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning(
                "human batch check failed batch_index=%s",
                i // HUMAN_CHECK_BATCH_SIZE,
                exc_info=True,
            )
            checks = [
                HumanCheck(title=t, qid=None, is_human=False, source="unknown")
                for t in titles
            ]

        for r, c in zip(batch, checks):
            if c.source != "unknown" and bool(c.is_human):
                ok_names.add(str(r.get("name") or ""))
        await emit_progress(
            on_progress,
            "人物判定処理中",
            min(i + len(batch), len(ranked_with_href)),
            len(ranked_with_href),
        )

    filtered = [r for r in ranked_with_href if r.get("name") in ok_names]
    filtered = sorted(filtered, key=lambda x: int(x.get("point") or 0), reverse=True)[
        :forward_keep
    ]
    return filtered


async def collapse_relations_by_canonical_article(
    wiki: SupportsResolveCanonicalTitles, rows: list[WikiRelationRow]
) -> list[WikiRelationRow]:
    with_page = [
        r for r in rows if r.get("hasWikiPage") and (r.get("slave") or {}).get("url")
    ]
    rest = [
        r
        for r in rows
        if not (r.get("hasWikiPage") and (r.get("slave") or {}).get("url"))
    ]
    if not with_page:
        return rows

    slave_titles = [
        str(
            (r.get("slave") or {}).get("title")
            or (r.get("slave") or {}).get("name")
            or ""
        ).strip()
        for r in with_page
    ]
    slave_titles = [t for t in slave_titles if t]
    resolved = await quota_run(
        lambda: wiki.resolve_canonical_titles_for_titles(slave_titles)
    )

    def url_for_canon(canon: str) -> str:
        c = canon.strip()
        return crud.wiki_ja_article_url(c)

    merged: dict[str, WikiRelationRow] = {}
    for r in with_page:
        sk = str(
            (r.get("slave") or {}).get("title")
            or (r.get("slave") or {}).get("name")
            or ""
        ).strip()
        canon = resolved.get(sk) or sk
        key = url_for_canon(canon)
        prev = merged.get(key)
        if not prev:
            merged[key] = {
                "slave": {"name": canon, "title": canon, "url": key},
                "forwardPoint": int(r.get("forwardPoint") or 0),
                "reversePoint": int(r.get("reversePoint") or 0),
                "totalPoint": int(r.get("forwardPoint") or 0)
                + int(r.get("reversePoint") or 0),
                "hasWikiPage": True,
            }
        else:
            prev["forwardPoint"] = int(prev.get("forwardPoint") or 0) + int(
                r.get("forwardPoint") or 0
            )
            prev["reversePoint"] = max(
                int(prev.get("reversePoint") or 0),
                int(r.get("reversePoint") or 0),
            )
            prev["totalPoint"] = int(prev["forwardPoint"]) + int(prev["reversePoint"])
    lst = list(merged.values())
    ok: set[str] = set()
    batch_size = 20
    for i in range(0, len(lst), batch_size):
        batch = lst[i : i + batch_size]
        titles = [
            str(
                (r.get("slave") or {}).get("title")
                or (r.get("slave") or {}).get("name")
                or ""
            ).strip()
            for r in batch
        ]
        checks = await batch_human_checks_with_db_redis_priority(
            titles,
            live_batch_resolver=quota_batch_human_checks,
        )
        results = tuple(c.source != "unknown" and bool(c.is_human) for c in checks)
        for r, hx in zip(batch, results):
            tit = str(
                (r.get("slave") or {}).get("title")
                or (r.get("slave") or {}).get("name")
                or ""
            ).strip()
            if hx:
                ok.add(tit)
    kept = [
        r for r in lst if str((r.get("slave") or {}).get("title") or "").strip() in ok
    ]
    return kept + rest
