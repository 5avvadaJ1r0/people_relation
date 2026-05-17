"""ノイズ節・navbox 等の除去（Wikipedia `action=parse` の HTML 向け。BeautifulSoup + lxml で堅牢化）。"""

from __future__ import annotations

import re
from collections.abc import Iterable

from bs4 import BeautifulSoup, Comment, Tag
from bs4.element import PageElement

from app.services.wiki.parser.encoding_utils import (
    WIKI_EXTRACT_PLAIN_NOISE_SECTION_HEADINGS,
    WIKI_L2_LINK_NOISE_SECTION_HEADINGS,
    is_noise_wiki_section_fragment,
    normalize_wiki_link_title,
    title_has_non_main_namespace_prefix,
)

# Wikipedia パース HTML は常に lxml で扱う（`_serialize_fragment` が body 前提のため変更時は要見直し）
_HTML_PARSER = "lxml"


def _serialize_fragment(soup: BeautifulSoup) -> str:
    """lxml パース時に付与される `<body>` 内だけをシリアライズする。"""
    body = soup.body
    assert body is not None, (
        "BeautifulSoup を lxml でパースしたときは html/body が付与される想定。"
        "パーサを変更する場合は _serialize_fragment と _HTML_PARSER を見直すこと。"
    )
    return body.decode_contents(formatter="html")


def _class_list_includes_exact_navbox(classes: object) -> bool:
    if not classes:
        return False
    if isinstance(classes, str):
        parts = re.split(r"\s+", classes.strip())
    elif isinstance(classes, Iterable):
        parts = [str(p) for p in classes if p]
    else:
        return False
    return "navbox" in {p for p in parts if p}


def _strip_navboxes_from_soup(soup: BeautifulSoup) -> None:
    """navbox を一括収集し、深いノードから順に除去（O(n) 収集 + 深さソート）。"""
    candidates = [
        t
        for t in soup.find_all(("div", "table"))
        if _class_list_includes_exact_navbox(t.get("class"))
    ]
    for tag in sorted(
        candidates, key=lambda t: sum(1 for _ in t.parents), reverse=True
    ):
        if tag.parent is not None:
            tag.decompose()


def _should_stop_after_heading_block(node: PageElement) -> bool:
    """次の level-2 見出し手前まで除去する（navbox は別途一括除去）。"""
    if isinstance(node, Comment):
        return "NewPP limit report" in str(node)
    if not isinstance(node, Tag):
        return False
    if node.name == "div":
        cl = node.get("class") or []
        if "mw-heading" in cl and "mw-heading2" in cl:
            return True
    return False


def _strip_mw_heading2_block_and_following(soup: BeautifulSoup, h2_id: str) -> None:
    """`<div class="mw-heading mw-heading2"><h2 id="…">` から次の mw-heading2 / navbox / パーサコメント手前までを除去。"""
    h2 = soup.find("h2", id=h2_id)
    if h2 is None or h2.parent is None:
        return
    heading_div = h2.parent
    if heading_div.name != "div":
        return
    cl = heading_div.get("class") or []
    if "mw-heading" not in cl or "mw-heading2" not in cl:
        return
    to_remove: list[PageElement] = [heading_div]
    sib = heading_div.next_sibling
    while sib is not None:
        if _should_stop_after_heading_block(sib):
            break
        to_remove.append(sib)
        sib = sib.next_sibling
    for n in to_remove:
        n.extract()


def strip_navbox_blocks(html: str) -> str:
    soup = BeautifulSoup(html, _HTML_PARSER)
    _strip_navboxes_from_soup(soup)
    return _serialize_fragment(soup)


def strip_catlinks_block(html: str) -> str:
    soup = BeautifulSoup(html, _HTML_PARSER)
    cat = soup.find(id="catlinks")
    if cat is not None:
        cat.decompose()
    return _serialize_fragment(soup)


def strip_wiki_noise_sections_from_parsed_html(html: str) -> str:
    soup = BeautifulSoup(html, _HTML_PARSER)
    for label in WIKI_L2_LINK_NOISE_SECTION_HEADINGS:
        for sec in soup.find_all("section", attrs={"aria-labelledby": label}):
            sec.decompose()
    for sid in WIKI_L2_LINK_NOISE_SECTION_HEADINGS:
        _strip_mw_heading2_block_and_following(soup, sid)
    _strip_navboxes_from_soup(soup)
    cat = soup.find(id="catlinks")
    if cat is not None:
        cat.decompose()
    return _serialize_fragment(soup)


def strip_wiki_noise_sections_from_extract_plain(text: str) -> str:
    t = str(text or "")
    earliest: int | None = None
    for heading in WIKI_EXTRACT_PLAIN_NOISE_SECTION_HEADINGS:
        m = re.search(rf"\r?\n{re.escape(heading)}\s*\r?\n", t)
        if m is not None and (earliest is None or m.start() < earliest):
            earliest = m.start()
    if earliest is not None:
        t = t[:earliest].rstrip()
    return t.rstrip()


def strip_html_to_plain_text(markup: str) -> str:
    soup = BeautifulSoup(str(markup or ""), _HTML_PARSER)
    for tag in soup(["script", "style"]):
        tag.decompose()
    # get_text はパース時に HTML 実体参照を文字に解決済み。二重に html.unescape しない（テキスト内の &...; の誤変換を防ぐ）
    text = soup.get_text(separator=" ")
    return " ".join(text.split()).strip()


def collect_ns0_wiki_titles_from_html(markup: str) -> set[str]:
    soup = BeautifulSoup(str(markup or ""), _HTML_PARSER)
    out: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = str(a["href"])
        if not href.startswith("/wiki/"):
            continue
        path = href[len("/wiki/") :]
        path, _, _ = path.partition("?")
        path, _, fragment = path.partition("#")
        if fragment and is_noise_wiki_section_fragment(fragment):
            continue
        if not path:
            continue
        title = normalize_wiki_link_title(path)
        if not title or title_has_non_main_namespace_prefix(title):
            continue
        out.add(title)
    return out
