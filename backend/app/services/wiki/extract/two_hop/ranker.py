"""主体記事のリンク・本文出現回数からフォワード候補を構築・ランキングする。"""

from __future__ import annotations

import re

from app.services.wiki.extract.two_hop.models import (
    ForwardCandidate,
    ForwardScoreRow,
    MasterArticleContext,
    WikilinkCountRow,
)
from app.services.wiki.parser.encoding_utils import (
    count_occurrences,
    normalize_wiki_link_title,
    wiki_internal_path_from_normalized_title,
)
from app.services.wiki.parser.wikitext import (
    count_links_from_wikitext,
    drop_sub_name_if_full_exists,
)


def build_forward_ranked_list(
    ctx: MasterArticleContext,
    *,
    max_related: int,
) -> tuple[list[ForwardCandidate], int]:
    """wikitext / extract / hatnote からフォワード候補と reverse 判定用ポイントを構築する。"""
    link_counts: dict[str, WikilinkCountRow] = {
        k: {"count": int(v.count), "href": v.href}
        for k, v in count_links_from_wikitext(ctx.wikitext).items()
    }

    text = re.sub(r"\s+", " ", ctx.extract_text).strip()
    master_html_text = re.sub(r"\s+", " ", ctx.master_html_text_raw).strip()
    text_for_count = text

    for t in ctx.master_parse_links:
        norm = normalize_wiki_link_title(t)
        if not norm:
            continue
        if norm in link_counts:
            continue
        if norm in ctx.hat_in and norm not in ctx.hat_out:
            continue
        href = wiki_internal_path_from_normalized_title(norm)
        c_extract = count_occurrences(text_for_count, norm)
        c_html = count_occurrences(master_html_text, norm) if master_html_text else 0
        c = max(1, c_extract, c_html)
        link_counts[norm] = {"count": c, "href": href}

    forward_count_before_note_filter = {
        k: int(v.get("count") or 0) for k, v in link_counts.items()
    }

    for t in ctx.hat_in:
        norm = normalize_wiki_link_title(t)
        if not norm:
            continue
        if norm in ctx.hat_out:
            continue
        link_counts.pop(norm, None)

    forward_text_count: dict[str, int] = {}
    top_text_count = 280
    keys_sorted = sorted(
        link_counts.keys(),
        key=lambda k: int(link_counts[k].get("count") or 0),
        reverse=True,
    )[:top_text_count]
    for name in keys_sorted:
        c_extract = count_occurrences(text_for_count, name)
        c_html = count_occurrences(master_html_text, name) if master_html_text else 0
        c = max(c_extract, c_html)
        forward_text_count[name] = c
        prev = link_counts.get(name)
        if prev and c > int(prev.get("count") or 0):
            prev["count"] = c

    score_map: dict[str, ForwardScoreRow] = {}
    for name, v in link_counts.items():
        score_map[name] = {
            "point": int(v.get("count") or 0),
            "href": v.get("href"),
            "title": None,
        }

    drop_sub_name_if_full_exists(score_map)
    for name, v in list(score_map.items()):
        if (
            int(v.get("point") or 0) <= 1
            and name not in ctx.master_parse_link_norms
            and not v.get("href")
        ):
            score_map.pop(name, None)

    for n in ctx.master_link_exclude_norms:
        score_map.pop(n, None)

    ranked_rows: list[ForwardCandidate] = []
    for name, v in score_map.items():
        pt = int(v.get("point") or 0)
        if pt <= 0:
            continue
        ranked_rows.append(
            {
                "name": name,
                "point": pt,
                "href": v.get("href"),
                "title": v.get("title"),
                "reverseCheckPoint": max(
                    forward_count_before_note_filter.get(name, 0),
                    forward_text_count.get(name, 0),
                    pt,
                ),
            }
        )
    ranked_all = sorted(
        ranked_rows,
        key=lambda x: int(x.get("point") or 0),
        reverse=True,
    )

    # API 負荷抑制: 旧 max_related*50 は候補過多になりやすいため倍率を抑える
    candidate_limit = min(2500, max(max_related * 10, 400))
    forward_keep = min(1500, max(max_related * 12, max(120, max_related + 40)))
    ranked = ranked_all[:candidate_limit]
    return ranked, forward_keep
