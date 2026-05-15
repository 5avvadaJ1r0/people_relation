"""フォワード候補の転送先記事単位への統合（同一人物の二重カウント防止）。"""

from __future__ import annotations

from app.services.wiki.extract.two_hop.models import (
    ForwardCandidate,
    SupportsResolveCanonicalTitles,
)
from app.services.wiki.parser.encoding_utils import (
    decode_wiki_title_from_href,
    normalize_wiki_link_title,
    wiki_internal_path_from_normalized_title,
)


async def merge_forward_candidates_by_canonical_titles(
    wiki: SupportsResolveCanonicalTitles,
    ranked: list[ForwardCandidate],
) -> list[ForwardCandidate]:
    """リンク先タイトルが転送で同一記事になる行を 1 つにまとめ、主体値・reverseCheckPoint を集約する。"""
    if not ranked:
        return ranked

    titles_to_resolve: list[str] = []
    for i, r in enumerate(ranked):
        href = r.get("href")
        nm = str(r.get("name") or "")
        if href:
            tit = decode_wiki_title_from_href(str(href)).strip()
        else:
            tit = (normalize_wiki_link_title(nm) or nm).strip()
        if not tit:
            tit = nm.strip()
        if not tit:
            tit = f"__empty_{i}"
        titles_to_resolve.append(tit)

    uniq = list(dict.fromkeys(titles_to_resolve))
    resolved = await wiki.resolve_canonical_titles_for_titles(uniq)

    merged_groups: dict[str, list[int]] = {}
    for i, tit in enumerate(titles_to_resolve):
        canon_raw = (resolved.get(tit) or tit).strip() or tit
        cn = normalize_wiki_link_title(canon_raw) or canon_raw
        merged_groups.setdefault(cn, []).append(i)

    out: list[ForwardCandidate] = []
    for cn, idxs in merged_groups.items():
        uniq_idx = list(dict.fromkeys(idxs))
        total_point = 0
        rcps: list[int] = []
        for j in uniq_idx:
            row = ranked[j]
            pt = int(row.get("point") or 0)
            total_point += pt
            rcp = int(row.get("reverseCheckPoint") or 0)
            rcps.append(rcp if rcp > 0 else pt)
        href_final = wiki_internal_path_from_normalized_title(cn)
        merge_rcp = max([total_point] + rcps) if rcps else total_point
        out.append(
            {
                "name": cn,
                "point": total_point,
                "href": href_final,
                "title": None,
                "reverseCheckPoint": merge_rcp,
            }
        )

    out.sort(key=lambda x: int(x.get("point") or 0), reverse=True)
    return out
