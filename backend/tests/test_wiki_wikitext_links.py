from __future__ import annotations

from app.services.wiki.parser.encoding_utils import normalize_wiki_link_title
from app.services.wiki.parser.wikitext import (
    count_links_from_wikitext,
    drop_sub_name_if_full_exists,
    prepare_wikitext_for_link_extraction,
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


def test_count_links_excludes_external_links_section_and_trailing_navboxes() -> None:
    """阿木燿子型: 外部リンク節末尾の navbox テンプレ由来リンクを集計しない。"""
    wt = """\
本文 [[宇崎竜童]]。
== 脚注 ==
<ref>fn</ref>
== 関連項目 ==
* [[日本の小説家一覧]]
== 外部リンク ==
* [http://www.example.com/ example]
{{日本作詩大賞|第12回|1979年}}
{{報知映画賞助演女優賞}}
[[Category:日本の作家]]
"""
    got = count_links_from_wikitext(wt)
    assert normalize_wiki_link_title("宇崎竜童") in got
    assert normalize_wiki_link_title("日本の小説家一覧") not in got
    assert normalize_wiki_link_title("日本作詩大賞") not in got


def test_count_links_excludes_wikilinks_inside_external_links_section() -> None:
    wt = """\
intro [[宇崎竜童]]
== 外部リンク ==
* http://example.com
[[藤田まさと]]
{{賞|[[田中裕子]]}}
"""
    got = count_links_from_wikitext(wt)
    assert normalize_wiki_link_title("宇崎竜童") in got
    assert normalize_wiki_link_title("藤田まさと") not in got
    assert normalize_wiki_link_title("田中裕子") not in got


def test_prepare_wikitext_strips_trailing_navbox_after_related_items() -> None:
    wt = """\
intro
== 外部リンク ==
* http://example.com
== 関連項目 ==
* [[日本の小説家一覧]]
{{日本作詩大賞|第12回}}
[[Category:foo]]
"""
    cleaned = prepare_wikitext_for_link_extraction(wt)
    assert "日本作詩大賞" not in cleaned
    assert "Category:foo" not in cleaned
    assert "日本の小説家一覧" not in cleaned


def test_count_links_excludes_related_items_and_references_sections() -> None:
    wt = """\
本文 [[宇崎竜童]]。
== 出典 ==
* [http://example.com/news ニュース]
[[記者太郎]]
== 参考文献 ==
[[書籍一覧]]
== 関連項目 ==
[[日本の小説家一覧]]
[[別人物]]
"""
    got = count_links_from_wikitext(wt)
    assert normalize_wiki_link_title("宇崎竜童") in got
    for name in ("記者太郎", "書籍一覧", "日本の小説家一覧", "別人物"):
        assert normalize_wiki_link_title(name) not in got


def test_drop_sub_name_still_drops_prefix_when_no_href() -> None:
    sm = {
        "田中太郎": {"point": 5, "href": "/wiki/x", "title": None},
        "田中": {"point": 1, "href": None, "title": None},
    }
    drop_sub_name_if_full_exists(sm)
    assert "田中" not in sm
    assert "田中太郎" in sm
