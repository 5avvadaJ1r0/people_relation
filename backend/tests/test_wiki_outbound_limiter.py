"""wiki.limiter.outbound.AsyncTokenBucket の単体テスト。"""

from __future__ import annotations

import asyncio

import pytest

from app.services.wiki.limiter.outbound import AsyncTokenBucket


def test_token_bucket_many_acquires_under_capacity() -> None:
    async def main() -> None:
        b = AsyncTokenBucket(rate=10000.0, capacity=1000.0)
        for _ in range(400):
            await b.acquire(1)

    asyncio.run(main())


def test_token_bucket_invalid_args() -> None:
    with pytest.raises(ValueError):
        AsyncTokenBucket(rate=0, capacity=1)
    with pytest.raises(ValueError):
        AsyncTokenBucket(rate=1, capacity=0)


def test_token_bucket_acquire_zero_noop() -> None:
    async def main() -> None:
        b = AsyncTokenBucket(rate=1.0, capacity=1.0)
        await b.acquire(0)

    asyncio.run(main())
