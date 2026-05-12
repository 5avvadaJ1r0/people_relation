from __future__ import annotations

import pytest

from app.services.wiki.parser.encoding_utils import (
    count_occurrences,
    decode_wiki_title_from_href,
    href_to_url,
    normalize_wiki_link_title,
    title_has_non_main_namespace_prefix,
)


def test_title_has_ns_prefix_help_not_main_article() -> None:
    assert title_has_non_main_namespace_prefix("Help:Foo") is True


def test_title_with_colon_but_main_article_star_light() -> None:
    assert title_has_non_main_namespace_prefix("STAR:LIGHT") is False


def test_lowercase_category_prefix_is_non_main() -> None:
    assert title_has_non_main_namespace_prefix("category:Foo") is True


def test_namespace_prefix_whitespace_normalized() -> None:
    assert title_has_non_main_namespace_prefix("Category : Foo") is True
    assert title_has_non_main_namespace_prefix("category  :Foo") is True


def test_normalize_unquote_before_space_collapse() -> None:
    assert normalize_wiki_link_title("A%20%20B") == "A B"


def test_count_occurrences_plain_substring() -> None:
    assert count_occurrences("foo.bar", ".") == 1
    assert count_occurrences("a*a*a", "*") == 2


def test_href_to_url_requires_wiki_path() -> None:
    assert href_to_url("/wiki/Foo") == "https://ja.wikipedia.org/wiki/Foo"
    with pytest.raises(ValueError):
        href_to_url("//evil.com")
    with pytest.raises(ValueError):
        href_to_url("/w/index.php")


def test_decode_wiki_title_from_href_removeprefix() -> None:
    assert decode_wiki_title_from_href("/wiki/Bar_Baz") == "Bar Baz"
