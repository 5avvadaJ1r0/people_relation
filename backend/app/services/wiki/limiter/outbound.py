"""外向き Wikipedia / Wikidata 系呼び出しのレート制御（トークンバケツ）。

Semaphore との役割分担:
- Semaphore: 同時実行数の上限
- TokenBucket: 秒あたりの開始レート（バースト許容）
"""

from __future__ import annotations

import asyncio


class AsyncTokenBucket:
    """非同期トークンバケツ。`rate` は秒あたりに追加されるトークン数、`capacity` は上限（バースト）。"""

    __slots__ = ("_capacity", "_last_ts", "_lock", "_rate", "_tokens")

    def __init__(self, *, rate: float, capacity: float) -> None:
        if rate <= 0 or capacity <= 0:
            raise ValueError("rate and capacity must be positive")
        self._rate = rate
        self._capacity = capacity
        self._tokens = float(capacity)
        self._last_ts: float | None = None
        self._lock = asyncio.Lock()

    async def acquire(self, n: float = 1.0) -> None:
        if n <= 0:
            return
        loop = asyncio.get_running_loop()
        async with self._lock:
            while True:
                now = loop.time()
                if self._last_ts is None:
                    self._last_ts = now
                elapsed = max(0.0, now - self._last_ts)
                self._last_ts = now
                self._tokens = min(self._capacity, self._tokens + elapsed * self._rate)
                if self._tokens >= n:
                    self._tokens -= n
                    return
                deficit = n - self._tokens
                wait_sec = deficit / self._rate
                await asyncio.sleep(wait_sec)
