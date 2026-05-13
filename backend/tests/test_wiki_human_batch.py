from __future__ import annotations

import asyncio

import pytest

from app import crud
from app.db import SessionLocal
from app.services.wiki.human import batch_human_checks_with_db_redis_priority


def test_batch_human_checks_db_hit_skips_live(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    title = "バルク人物判定テストXyZ123"
    url = crud.wiki_ja_article_url(title)
    db = SessionLocal()
    try:
        crud.upsert_wiki_human_cache(
            db, title=title, url=url, qid="Q999991", is_human=True
        )
        db.commit()
    finally:
        db.close()

    async def boom(ts: list[str]) -> None:
        raise AssertionError(f"live path should not run: {ts!r}")

    monkeypatch.setattr(
        "app.services.wiki.human.live_resolve_human_checks_wbget_batch", boom
    )

    async def run() -> None:
        dbs = SessionLocal()
        try:
            out = await batch_human_checks_with_db_redis_priority(
                [title, ""], db=dbs
            )
        finally:
            dbs.close()
        assert len(out) == 2
        assert out[0].source == "db_cache" and out[0].is_human is True
        assert out[1].source == "unknown" and out[1].is_human is False

    asyncio.run(run())


def test_list_wiki_human_cache_by_urls_returns_hits() -> None:
    db = SessionLocal()
    try:
        u1 = "https://example.com/bulk-a"
        u2 = "https://example.com/bulk-b"
        crud.upsert_wiki_human_cache(db, title="A", url=u1, qid="Q1", is_human=True)
        crud.upsert_wiki_human_cache(db, title="B", url=u2, qid="Q2", is_human=False)
        db.commit()
        rows = crud.list_wiki_human_cache_by_urls(
            db, [u1, u2, "https://example.com/missing"]
        )
        by_url = {crud.normalize_url(r.url): r for r in rows}
        assert len(by_url) == 2
        assert by_url[crud.normalize_url(u1)].is_human is True
        assert by_url[crud.normalize_url(u2)].is_human is False
    finally:
        db.close()
