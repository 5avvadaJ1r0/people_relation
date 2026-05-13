"""wiki.extract.two_hop パッケージの単体テスト（ネットワークなし）。"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from app import crud
from app.db import SessionLocal
from app.schemas import HumanCheck
from app.services.wiki.extract.two_hop import (
    ForwardCandidate,
    MasterArticleContext,
    WikiRelationRow,
    collapse_relations_by_canonical_article,
)
from app.services.wiki.extract.two_hop.filter import relation_passes_self_filter
from app.services.wiki.extract.two_hop.ranker import build_forward_ranked_list
from app.services.wiki.extract.two_hop.reverse import (
    collect_reverse_scores,
    reverse_point_for_slave,
)


def test_relation_passes_self_filter_false_when_slave_name_in_exclude_norms() -> None:
    norms = {"山田太郎"}
    rel: WikiRelationRow = {
        "slave": {"name": "山田太郎", "title": "別表記", "url": ""},
        "forwardPoint": 1,
        "reversePoint": 0,
        "totalPoint": 1,
        "hasWikiPage": True,
    }
    assert relation_passes_self_filter(rel, norms) is False


def test_relation_passes_self_filter_false_when_slave_title_in_exclude_norms() -> None:
    norms = {"山田太郎"}
    rel: WikiRelationRow = {
        "slave": {"name": "他人", "title": "山田太郎", "url": ""},
        "forwardPoint": 1,
        "reversePoint": 0,
        "totalPoint": 1,
        "hasWikiPage": True,
    }
    assert relation_passes_self_filter(rel, norms) is False


def test_relation_passes_self_filter_true_for_unrelated_person() -> None:
    norms = {"山田太郎"}
    rel: WikiRelationRow = {
        "slave": {
            "name": "佐藤花子",
            "title": "佐藤花子",
            "url": crud.wiki_ja_article_url("佐藤花子"),
        },
        "forwardPoint": 2,
        "reversePoint": 0,
        "totalPoint": 2,
        "hasWikiPage": True,
    }
    assert relation_passes_self_filter(rel, norms) is True


def test_relation_passes_self_filter_false_when_url_path_matches_exclude() -> None:
    norms = {"山田太郎"}
    url = crud.wiki_ja_article_url("山田太郎")
    rel: WikiRelationRow = {
        "slave": {"name": "表示名", "title": "表示名", "url": url},
        "forwardPoint": 1,
        "reversePoint": 0,
        "totalPoint": 1,
        "hasWikiPage": True,
    }
    assert relation_passes_self_filter(rel, norms) is False


def test_build_forward_ranked_empty_wikitext_returns_empty_ranked() -> None:
    ctx = MasterArticleContext(
        extract_text="",
        wikitext="",
        canonical_title="主体",
        master_parse_links=set(),
        hat_in=set(),
        hat_out=set(),
        master_html_text_raw="",
        master_redirects=[],
        master_parse_link_norms=set(),
        master_link_exclude_norms=set(),
    )
    ranked, forward_keep = build_forward_ranked_list(ctx, max_related=10)
    assert ranked == []
    assert forward_keep == 120


def test_build_forward_ranked_forward_keep_formula() -> None:
    ctx = MasterArticleContext(
        extract_text="",
        wikitext="",
        canonical_title="x",
        master_parse_links=set(),
        hat_in=set(),
        hat_out=set(),
        master_html_text_raw="",
        master_redirects=[],
        master_parse_link_norms=set(),
        master_link_exclude_norms=set(),
    )
    max_related = 50
    _, forward_keep = build_forward_ranked_list(ctx, max_related=max_related)
    assert forward_keep == 600


def test_build_forward_ranked_removes_hatnote_only_targets() -> None:
    """hat_in にだけいるリンクは link_counts から除去される。"""
    ctx = MasterArticleContext(
        extract_text="",
        wikitext="[[HatOnly]]",
        canonical_title="主体",
        master_parse_links=set(),
        hat_in={"HatOnly"},
        hat_out=set(),
        master_html_text_raw="",
        master_redirects=[],
        master_parse_link_norms=set(),
        master_link_exclude_norms=set(),
    )
    ranked, _ = build_forward_ranked_list(ctx, max_related=20)
    names = {n for r in ranked if (n := r.get("name"))}
    assert "HatOnly" not in names


def test_build_forward_ranked_excludes_master_norms() -> None:
    """master_link_exclude_norms に含まれる名前はスコア対象から除外。"""
    ctx = MasterArticleContext(
        extract_text="",
        wikitext="[[自分自身]] と [[他人]]",
        canonical_title="自分自身",
        master_parse_links=set(),
        hat_in=set(),
        hat_out=set(),
        master_html_text_raw="",
        master_redirects=[],
        master_parse_link_norms=set(),
        master_link_exclude_norms={"自分自身"},
    )
    ranked, _ = build_forward_ranked_list(ctx, max_related=20)
    names = {n for r in ranked if (n := r.get("name"))}
    assert "自分自身" not in names
    assert "他人" in names


def test_reverse_point_for_slave_skips_extract_when_link_score_positive() -> None:
    wiki = AsyncMock()
    wiki.fetch_wikitext_by_title = AsyncMock(return_value="本文 [[山田一郎]]")
    wiki.fetch_parse_ns0_link_title_set = AsyncMock(return_value=set())

    async def run() -> int:
        return await reverse_point_for_slave(
            wiki,
            slave_title="任意",
            master_title_candidates={"山田一郎"},
            master_candidate_norms=["山田一郎"],
        )

    score = asyncio.run(run())
    assert score >= 1
    wiki.fetch_extract_text_by_title.assert_not_called()
    wiki.fetch_parse_plain_text_by_title.assert_not_called()


def test_reverse_point_for_slave_skips_text_fallback_when_forward_point_low() -> None:
    """フォワードが閾値以下なら extract/HTML は取らない。"""
    wiki = AsyncMock()
    wiki.fetch_wikitext_by_title = AsyncMock(return_value="リンクなし本文のみ")
    wiki.fetch_parse_ns0_link_title_set = AsyncMock(return_value=set())

    async def run() -> int:
        return await reverse_point_for_slave(
            wiki,
            slave_title="任意",
            master_title_candidates={"山田一郎"},
            master_candidate_norms=["山田一郎"],
            slave_forward_point=1,
        )

    score = asyncio.run(run())
    assert score == 0
    wiki.fetch_extract_text_by_title.assert_not_called()
    wiki.fetch_parse_plain_text_by_title.assert_not_called()


def test_reverse_point_for_slave_falls_back_to_extract_when_no_link_score() -> None:
    wiki = AsyncMock()
    wiki.fetch_wikitext_by_title = AsyncMock(return_value="リンクなし本文のみ")
    wiki.fetch_parse_ns0_link_title_set = AsyncMock(return_value=set())
    wiki.fetch_extract_text_by_title = AsyncMock(return_value="山田一郎について言及")
    wiki.fetch_parse_plain_text_by_title = AsyncMock(return_value="")

    async def run() -> int:
        return await reverse_point_for_slave(
            wiki,
            slave_title="任意",
            master_title_candidates={"山田一郎"},
            master_candidate_norms=["山田一郎"],
        )

    score = asyncio.run(run())
    assert score >= 1
    wiki.fetch_extract_text_by_title.assert_called_once()
    wiki.fetch_parse_plain_text_by_title.assert_called_once()


def test_collapse_relations_merges_rows_with_same_resolved_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def noop_sleep(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(
        "app.services.wiki.extract.two_hop.quota.asyncio.sleep", noop_sleep
    )

    async def fake_batch(
        titles: list[str],
        **_kwargs: object,
    ) -> list[HumanCheck]:
        return [
            HumanCheck(title=t, qid=None, is_human=True, source="live") for t in titles
        ]

    monkeypatch.setattr(
        "app.services.wiki.extract.two_hop.filter.batch_human_checks_with_db_redis_priority",
        fake_batch,
    )

    class WikiStub:
        async def resolve_canonical_titles_for_titles(
            self, titles: list[str]
        ) -> dict[str, str]:
            # 別名 -> 同一 canonical
            return {t: "統合後の名前" for t in titles}

    async def main() -> None:
        wiki = WikiStub()
        rows: list[WikiRelationRow] = [
            {
                "slave": {
                    "name": "別名A",
                    "title": "別名A",
                    "url": crud.wiki_ja_article_url("別名A"),
                },
                "forwardPoint": 3,
                "reversePoint": 1,
                "totalPoint": 4,
                "hasWikiPage": True,
            },
            {
                "slave": {
                    "name": "別名B",
                    "title": "別名B",
                    "url": crud.wiki_ja_article_url("別名B"),
                },
                "forwardPoint": 2,
                "reversePoint": 4,
                "totalPoint": 6,
                "hasWikiPage": True,
            },
        ]

        db = SessionLocal()
        try:
            out = await collapse_relations_by_canonical_article(wiki, rows, db=db)
        finally:
            db.close()
        assert len(out) == 1
        first = out[0]
        assert first.get("forwardPoint") == 5
        assert first.get("reversePoint") == 4
        assert first.get("totalPoint") == 9
        assert (first.get("slave") or {}).get("title") == "統合後の名前"

    asyncio.run(main())


def test_collect_reverse_scores_gather_preserves_input_order() -> None:
    """reverse 並列化後も `ranked` の順序で relations が並ぶこと。"""
    wiki = AsyncMock()
    wiki.fetch_wikitext_by_title = AsyncMock(return_value="")
    wiki.fetch_parse_ns0_link_title_set = AsyncMock(return_value=set())
    wiki.fetch_extract_text_by_title = AsyncMock(return_value="")
    wiki.fetch_parse_plain_text_by_title = AsyncMock(return_value="")

    ranked: list[ForwardCandidate] = [
        {
            "name": "First",
            "point": 2,
            "href": "/wiki/First",
            "title": None,
            "reverseCheckPoint": 2,
        },
        {
            "name": "Second",
            "point": 1,
            "href": "/wiki/Second",
            "title": None,
            "reverseCheckPoint": 1,
        },
    ]

    async def main() -> None:
        out, cnt, _sample = await collect_reverse_scores(
            wiki,
            ranked=ranked,
            master_title="主体",
            master_name="主体",
            canonical_title="主体",
            master_redirects=[],
            master_url=crud.wiki_ja_article_url("主体"),
            on_progress=None,
        )
        assert [(row.get("slave") or {}).get("name") for row in out] == [
            "First",
            "Second",
        ]
        assert cnt == 2

    asyncio.run(main())
