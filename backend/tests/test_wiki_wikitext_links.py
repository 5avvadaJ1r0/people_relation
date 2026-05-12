from __future__ import annotations

from app.services.wiki.parser.encoding_utils import normalize_wiki_link_title
from app.services.wiki.parser.wikitext import (
    count_links_from_wikitext,
    drop_sub_name_if_full_exists,
    strip_l2_noise_sections_from_wikitext,
)


def test_count_links_keeps_colon_in_article_title() -> None:
    """記事名に ':' が含まれるものは名前空間以外なら集計する。"""
    wt = "See [[STAR:LIGHT]] and [[Category:Albums]]."
    got = count_links_from_wikitext(wt)
    assert normalize_wiki_link_title("STAR:LIGHT") in got
    assert not any(k.lower().startswith("category") for k in got.keys())


def test_strip_l2_does_not_split_level3_as_level2() -> None:
    wt = "intro\n== Sec ==\n=== Sub ===\nbody\n"
    out = strip_l2_noise_sections_from_wikitext(wt)
    assert "=== Sub ===" in out
    assert "Sec" in out


def test_drop_sub_name_prefix_only_not_mid_substring() -> None:
    """「田中太郎」に対して「中」だけ一致するような添字一致はしない。"""
    sm = {
        "田中太郎": {
            "point": 5,
            "href": "/wiki/%E7%94%B0%E4%B8%AD%E5%A4%AA%E9%83%8E",
            "title": None,
        },
        "中": {"point": 1, "href": None, "title": None},
    }
    drop_sub_name_if_full_exists(sm)
    assert "中" in sm


def test_drop_sub_name_still_drops_prefix_when_no_href() -> None:
    sm = {
        "田中太郎": {"point": 5, "href": "/wiki/x", "title": None},
        "田中": {"point": 1, "href": None, "title": None},
    }
    drop_sub_name_if_full_exists(sm)
    assert "田中" not in sm
    assert "田中太郎" in sm
