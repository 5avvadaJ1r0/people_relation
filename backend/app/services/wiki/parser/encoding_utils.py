"""Wikipedia JA パイプライン用の文字列正規化（フロント `wikiUtils` と同等の意図）。"""

from __future__ import annotations

import re
from functools import lru_cache
from urllib.parse import quote, unquote

# 見出しアンカーとして除外するセクション（normalize_wiki_link_title 後の文字列と照合）。
_NOISE_SECTION_FRAGMENTS = frozenset(
    {
        "脚注",
        "外部リンク",
        "参考文献",
        "出典",
        "関連項目",
        "注釈",
        "その他の関連項目",
        "References",
        "External links",
        "See also",
    }
)

# level-2 見出しとして wikitext / parse HTML / extract からリンク集計除外する節（日本語記事向け）。
WIKI_L2_LINK_NOISE_SECTION_HEADINGS: frozenset[str] = frozenset(
    {
        "脚注",
        "出典",
        "参考文献",
        "関連項目",
        "外部リンク",
    }
)

# explaintext extract 用（上記 + 脚注直後に来やすい見出し）。
WIKI_EXTRACT_PLAIN_NOISE_SECTION_HEADINGS: tuple[str, ...] = (
    "脚注",
    "注釈",
    "出典",
    "参考文献",
    "関連項目",
    "その他の関連項目",
    "外部リンク",
)


@lru_cache(maxsize=8192)
def normalize_wiki_link_title(title: str) -> str:
    raw = str(title or "")
    t0 = (
        raw.replace("_", " ")
        .replace("\u00a0", " ")
        .replace("\u200b", "")
        .replace("\u200c", "")
        .replace("\u200d", "")
        .replace("\ufeff", "")
    )
    try:
        t0 = unquote(t0)
    except Exception:
        pass
    t0 = re.sub(r"\s+", " ", t0).strip()
    return t0


def count_occurrences(text: str, needle: str) -> int:
    n = needle.strip()
    if not n:
        return 0
    return text.count(n)


def decode_wiki_title_from_href(href: str) -> str:
    rest = str(href or "").removeprefix("/wiki/")
    try:
        return unquote(rest).replace("_", " ")
    except Exception:
        return rest.replace("_", " ")


def href_to_url(href: str) -> str:
    h = str(href or "")
    if not h.startswith("/wiki/"):
        raise ValueError("invalid wiki href")
    return f"https://ja.wikipedia.org{h}"


def wiki_internal_path_from_normalized_title(norm: str) -> str:
    """normalize_wiki_link_title 済みのタイトルから `/wiki/...` を生成（当面 ja 固定・ローカルパス）。"""
    return f"/wiki/{quote(str(norm).replace(' ', '_'), safe='')}"


def is_noise_wiki_section_fragment(fragment: str) -> bool:
    n = normalize_wiki_link_title(str(fragment or "").replace("+", " "))
    return n in _NOISE_SECTION_FRAGMENTS


def is_wiki_l2_link_noise_section_heading(heading: str) -> bool:
    """``== 見出し ==`` がリンク集計除外対象か（normalize 後に照合）。"""
    n = normalize_wiki_link_title(heading)
    return bool(n) and n in WIKI_L2_LINK_NOISE_SECTION_HEADINGS


# MediaWiki の「名前空間:ページ」形式のみ除外。記事タイトルに ':' が含まれるもの（例: STAR:LIGHT）は除外しない。
# 将来的には action=query&meta=siteinfo&siprop=namespaces|namespacealiases で同期すると環境差に強い。
_NON_MAIN_NS_PREFIXES = frozenset(
    {
        "Help",
        "Wikipedia",
        "Template",
        "Category",
        "File",
        "Image",
        "User",
        "Talk",
        "Draft",
        "Module",
        "MediaWiki",
        "Portal",
        "TimedText",
        "Special",
        "Media",
        "Education",
        "Gadget",
        "Gadget_definition",
        "Topic",
        "User_talk",
        "Wikipedia_talk",
        "Template_talk",
        "Category_talk",
        "File_talk",
        "Help_talk",
        "Draft_talk",
        "Module_talk",
        "Portal_talk",
        "ノート",
        "利用者",
        "ファイル",
        "カテゴリ",
        "テンプレート",
        "ヘルプ",
        "プロジェクト",
        "モジュール",
        "ノート・トーク",
        "利用者・トーク",
        "カテゴリ・トーク",
        "ファイル・トーク",
        "テンプレート・トーク",
        "Wikipedia・トーク",
        "プロジェクト・トーク",
        "モジュール・トーク",
    }
)

# 英語名前空間はコピペで小文字になることがあるため canonical + lower の両方で照合する。
_NON_MAIN_NS_ASCII_LOWER = frozenset(
    p.lower().replace(" ", "_") for p in _NON_MAIN_NS_PREFIXES if p.isascii()
)


def title_has_non_main_namespace_prefix(title: str) -> bool:
    """先頭がメイン名前空間以外（Help:, Category:, ノート: 等）なら True。"""
    t = str(title or "").strip()
    if ":" not in t:
        return False
    prefix = re.sub(r"\s+", " ", t.split(":", 1)[0].strip())
    if not prefix:
        return False
    norm_us = prefix.replace(" ", "_")
    if prefix in _NON_MAIN_NS_PREFIXES or norm_us in _NON_MAIN_NS_PREFIXES:
        return True
    if prefix.isascii():
        return prefix.lower().replace(" ", "_") in _NON_MAIN_NS_ASCII_LOWER
    return False
