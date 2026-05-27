"""2-hop 関連抽出のオーケストレーション（外部公開 `extract_two_hop_relations`）。"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app import crud
from app.services.wiki.api.ja_mediawiki import JaWikipediaClient
from app.services.wiki.extract.two_hop.canonical_forward_merge import (
    merge_forward_candidates_by_canonical_titles,
)
from app.services.wiki.extract.two_hop.fetcher import (
    load_master_article_context,
    resolve_missing_hrefs,
)
from app.services.wiki.extract.two_hop.filter import (
    collapse_relations_by_canonical_article,
    filter_forward_humans,
    relation_passes_self_filter,
)
from app.services.wiki.extract.two_hop.models import WikiSlaveRef
from app.services.wiki.extract.two_hop.ranker import build_forward_ranked_list
from app.services.wiki.extract.two_hop.reverse import collect_reverse_scores

log = logging.getLogger(__name__)


async def extract_two_hop_relations(
    wiki: JaWikipediaClient,
    *,
    master_title: str,
    master_name: str,
    max_related: int,
    db: Session,
) -> dict[str, Any]:
    master_url = crud.wiki_ja_article_url(master_title)
    master: WikiSlaveRef = {
        "name": master_name,
        "title": master_title,
        "url": master_url,
    }

    ctx = await load_master_article_context(
        wiki,
        master_title=master_title,
        master_name=master_name,
    )

    ranked, forward_keep = build_forward_ranked_list(ctx, max_related=max_related)

    ranked = await merge_forward_candidates_by_canonical_titles(wiki, ranked)

    await resolve_missing_hrefs(wiki, ranked=ranked)

    ranked = await filter_forward_humans(
        wiki,
        ranked=ranked,
        forward_keep=forward_keep,
        max_related=max_related,
        db=db,
    )

    out, reverse_checked_count, reverse_checked_sample = await collect_reverse_scores(
        wiki,
        ranked=ranked,
        master_title=master_title,
        master_name=master_name,
        canonical_title=ctx.canonical_title,
        master_redirects=ctx.master_redirects,
        master_url=master_url,
    )

    if reverse_checked_count:
        log.info(
            "wiki reverse checked master=%s total=%s checked=%s sample=%s",
            master_title,
            len(ranked),
            reverse_checked_count,
            reverse_checked_sample,
        )
    else:
        log.info(
            "wiki reverse checked none master=%s total=%s", master_title, len(ranked)
        )

    collapsed = await collapse_relations_by_canonical_article(wiki, out, db=db)
    collapsed.sort(key=lambda x: int(x.get("totalPoint") or 0), reverse=True)

    without_self = [
        rel
        for rel in collapsed
        if relation_passes_self_filter(rel, ctx.master_link_exclude_norms)
    ]
    return {"master": master, "relations": without_self[:max_related]}
