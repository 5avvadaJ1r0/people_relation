"""wikitext からのリンク集計（`mwparserfromhell`、ノイズ節は level-2 見出しで除去）。"""

from __future__ import annotations

import re
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from typing import Any

import mwparserfromhell as mwp

from app.services.wiki.parser.encoding_utils import (
    is_noise_wiki_section_fragment,
    is_wiki_l2_link_noise_section_heading,
    normalize_wiki_link_title,
    title_has_non_main_namespace_prefix,
    wiki_internal_path_from_normalized_title,
)


@dataclass(slots=True)
class LinkStat:
    count: int
    href: str


# level-2 見出し（`===` と誤マッチしない）
_L2_HEADING_LINE_RE = re.compile(r"\n==(?!=)\s*([^=\n]+?)\s*==(?!=)\s*\n")
_EXTERNAL_LINKS_HEADING_RE = re.compile(r"(?:^|\n)==(?!=)\s*外部リンク\s*==(?!=)")


def strip_from_external_links_heading_to_eof(wikitext: str) -> str:
    """``== 外部リンク ==`` が最終 level-2 見出しのとき、末尾（navbox・Category 含む）を丸ごと除去する。"""
    wt = (wikitext or "").replace("\r\n", "\n")
    m = _EXTERNAL_LINKS_HEADING_RE.search(wt)
    if not m:
        return wt
    after_heading = wt[m.end() :]
    if _L2_HEADING_LINE_RE.search(after_heading):
        return wt
    return wt[: m.start()].rstrip()


def strip_trailing_boilerplate_from_wikitext(wikitext: str) -> str:
    """記事末尾の navbox テンプレ・Category・Normdaten 等を除去（最終節の末尾に付くもの向け）。"""
    lines = (wikitext or "").replace("\r\n", "\n").split("\n")
    while lines:
        line = lines[-1].strip()
        if not line:
            lines.pop()
            continue
        if line.startswith("[[Category:") or line.startswith("{{DEFAULTSORT:"):
            lines.pop()
            continue
        if re.match(r"^\{\{[Nn]ormdaten", line):
            lines.pop()
            continue
        if line.startswith("{{") and line.endswith("}}"):
            lines.pop()
            continue
        break
    return "\n".join(lines)


def prepare_wikitext_for_link_extraction(wikitext: str) -> str:
    """wikitext リンク集計前のノイズ除去（脚注・出典・参考文献・関連項目・外部リンク等）。"""
    wt = strip_from_external_links_heading_to_eof(wikitext)
    wt = strip_l2_noise_sections_from_wikitext(wt)
    return strip_trailing_boilerplate_from_wikitext(wt)


def strip_l2_noise_sections_from_wikitext(wikitext: str) -> str:
    wt = (wikitext or "").replace("\r\n", "\n")
    if not wt.strip():
        return wt
    parts = _L2_HEADING_LINE_RE.split(wt)
    if len(parts) == 1:
        return wt
    out: list[str] = [parts[0]]
    for i in range(1, len(parts), 2):
        heading = parts[i].strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        if is_wiki_l2_link_noise_section_heading(heading):
            continue
        out.append(f"\n== {heading} ==\n" + body)
    return "".join(out)


def count_links_from_wikitext(wikitext: str) -> dict[str, LinkStat]:
    raw = str(wikitext or "")
    cleaned = prepare_wikitext_for_link_extraction(raw)
    try:
        code = mwp.parse(cleaned)
    except Exception:
        return {}
    result: dict[str, LinkStat] = {}
    for link in code.filter_wikilinks():
        target = str(link.title).strip()
        if not target or title_has_non_main_namespace_prefix(target):
            continue
        anchor = ""
        if "#" in target:
            base, frag = target.split("#", 1)
            target = base.strip()
            anchor = frag.strip()
            if anchor and is_noise_wiki_section_fragment(anchor):
                continue
        norm = normalize_wiki_link_title(target)
        if not norm:
            continue
        href = wiki_internal_path_from_normalized_title(norm)
        prev = result.get(norm)
        if not prev:
            result[norm] = LinkStat(count=1, href=href)
        else:
            prev.count += 1
    return result


def reverse_link_score_from_wikitext_and_parse(
    slave_link_counts: Mapping[str, Mapping[str, Any]],
    parse_ns0_titles: set[str],
    master_title_candidates: set[str],
) -> int:
    cand_norms: set[str] = set()
    for x in master_title_candidates:
        nx = normalize_wiki_link_title(x)
        if nx:
            cand_norms.add(nx)
    wt_sum = 0
    for k, v in slave_link_counts.items():
        nk = normalize_wiki_link_title(k)
        if nk in cand_norms:
            wt_sum += int(v.get("count", 0))
    parse_hit = any(n in parse_ns0_titles for n in cand_norms)
    return max(wt_sum, 1 if parse_hit else 0)


def drop_sub_name_if_full_exists(score_map: MutableMapping[str, Any]) -> None:
    """長い名前が残るとき、同一語の先頭部分だけの短いキーを落とす（部分一致は先頭一致のみ）。"""
    to_delete: set[str] = set()
    names_by_len_desc = sorted(score_map.keys(), key=len, reverse=True)
    for full in names_by_len_desc:
        if len(full) < 3:
            continue
        full_meta = score_map.get(full)
        for end in range(2, len(full)):
            sub = full[:end]
            if sub not in score_map:
                continue
            sub_meta = score_map.get(sub)
            is_near_prefix = len(full) - len(sub) <= 2
            if is_near_prefix:
                sm = sub_meta or {}
                fm = full_meta or {}
                if fm.get("href") and (sm.get("point") or 0) <= (fm.get("point") or 0):
                    to_delete.add(sub)
                    continue
            if sub_meta and sub_meta.get("href"):
                continue
            to_delete.add(sub)
    for n in to_delete:
        score_map.pop(n, None)
