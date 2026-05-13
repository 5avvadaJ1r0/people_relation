"""外向き Wiki / Wikidata 呼び出しの同時実行・レート制御と人物判定バッチ用クォータ。

Semaphore で同時実行を制限し、`AsyncTokenBucket` で秒あたりの開始レートを抑える。
プロセス内で共有するため、複数リクエスト間でも 2-hop 抽出の暴発を抑制する。
"""

from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy.orm import Session

from app.schemas import HumanCheck
from app.services.wiki.extract.two_hop.models import WikiQuotaFactory
from app.services.wiki.human import live_resolve_human_checks_wbget_batch
from app.services.wiki.limiter.outbound import AsyncTokenBucket

# 秒あたりに許可する外向き API の「開始」回数（バーストは capacity）。旧バッチ sleep と同等の丁寧さを目安に。
WIKI_TOKEN_BUCKET_RATE = 10.0
WIKI_TOKEN_BUCKET_CAPACITY = 16.0

# 同一プロセス内で同時に進む外向き Wiki 呼び出しの上限（複数リクエスト間でも共有）。
WIKI_OUTBOUND_CONCURRENCY = 16

_wiki_outbound_sem = asyncio.Semaphore(WIKI_OUTBOUND_CONCURRENCY)
_wiki_rate_bucket = AsyncTokenBucket(
    rate=WIKI_TOKEN_BUCKET_RATE, capacity=WIKI_TOKEN_BUCKET_CAPACITY
)


async def quota_gather(*factories: WikiQuotaFactory) -> tuple[Any, ...]:
    """クォータ取得後に各 factory を実行する（取得前に coroutine を生成しない）。"""

    async def _run(factory: WikiQuotaFactory) -> Any:
        await _wiki_rate_bucket.acquire(1)
        async with _wiki_outbound_sem:
            return await factory()

    return tuple(await asyncio.gather(*(_run(f) for f in factories)))


async def quota_run(factory: WikiQuotaFactory) -> Any:
    """単一 factory を `quota_gather` と同じクォータで実行する。"""
    await _wiki_rate_bucket.acquire(1)
    async with _wiki_outbound_sem:
        return await factory()


async def quota_batch_human_checks(ts: list[str], *, db: Session) -> list[HumanCheck]:
    """外向きクォータ 1 単位で ``live_resolve_human_checks_wbget_batch`` をまとめて実行する。"""
    if not ts:
        return []
    await _wiki_rate_bucket.acquire(1)
    async with _wiki_outbound_sem:
        return await live_resolve_human_checks_wbget_batch(ts, db=db)
