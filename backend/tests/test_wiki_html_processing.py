from __future__ import annotations

from app.services.wiki.parser.html import (
    strip_navbox_blocks,
    strip_wiki_noise_sections_from_extract_plain,
    strip_wiki_noise_sections_from_parsed_html,
)


def test_strip_navbox_nested_once_scan() -> None:
    html = (
        '<div class="mw-parser-output">'
        '<div class="navbox outer"><div class="navbox inner"><span>x</span></div></div>'
        "<p>keep</p>"
        "</div>"
    )
    out = strip_navbox_blocks(html)
    assert "navbox" not in out
    assert "keep" in out


def test_strip_wiki_noise_sections_removes_navbox_inside_external_links_block() -> None:
    raw = (
        '<div class="mw-parser-output">'
        '<div class="mw-heading mw-heading2"><h2 id="外部リンク">外部リンク</h2></div>'
        "<ul><li>ext</li></ul>"
        '<div class="navbox">'
        '<a href="/wiki/%E8%97%A4%E7%94%B0%E3%81%BE%E3%81%95%E3%81%A8">藤田まさと</a>'
        "</div>"
        '<div class="mw-heading mw-heading2"><h2 id="関連項目">関連項目</h2></div>'
        "<p>keep</p>"
        "</div>"
    )
    out = strip_wiki_noise_sections_from_parsed_html(raw)
    assert "藤田まさと" not in out
    assert "keep" not in out


def test_strip_wiki_noise_sections_from_parsed_html_mw_heading() -> None:
    raw = """<div class="mw-parser-output">
<div class="mw-heading mw-heading2"><h2 id="脚注">脚注</h2></div>
<p>foot content</p>
<div class="mw-heading mw-heading2"><h2 id="外部リンク">外部リンク</h2></div>
<p>ext links here</p>
<div class="mw-heading mw-heading2"><h2 id="関連項目">関連項目</h2></div>
<p>rel content</p>
</div>"""
    out = strip_wiki_noise_sections_from_parsed_html(raw)
    assert "foot content" not in out
    assert "ext links here" not in out
    assert "rel content" not in out


def test_strip_extract_plain_footnote_until_next_heading() -> None:
    t = "intro\n脚注\nfn1\n注釈\nafter"
    assert strip_wiki_noise_sections_from_extract_plain(t) == "intro"


def test_strip_extract_plain_related_items_and_sources() -> None:
    t = "intro\n出典\nsrc1\n参考文献\nref\n関連項目\n[[x]]"
    assert strip_wiki_noise_sections_from_extract_plain(t) == "intro"


def test_strip_extract_plain_footnote_until_eof() -> None:
    t = "intro\n脚注\nfn1"
    assert strip_wiki_noise_sections_from_extract_plain(t) == "intro"


def test_strip_extract_plain_external_links_tail() -> None:
    t = "body\n外部リンク\nhttps://example.com"
    assert strip_wiki_noise_sections_from_extract_plain(t) == "body"


def test_strip_extract_plain_external_only_tail_preserves_body() -> None:
    t = "A\nB\n外部リンク\nx"
    assert strip_wiki_noise_sections_from_extract_plain(t) == "A\nB"


def test_strip_extract_plain_no_footnote_section() -> None:
    t = "line1\nline2"
    assert strip_wiki_noise_sections_from_extract_plain(t) == "line1\nline2"
