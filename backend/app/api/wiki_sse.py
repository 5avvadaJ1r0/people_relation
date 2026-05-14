from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable

from sqlalchemy.orm import Session

from app.services.wiki.api.ja_mediawiki import JaWikipediaClient

OnWikiProgress = Callable[[str, int, int], Awaitable[None]]
WikiSseJob = Callable[
    [JaWikipediaClient, Session, OnWikiProgress],
    Awaitable[dict],
]


def sse_data_chunk(obj: dict) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")


async def iter_wiki_job_sse(db: Session, run: WikiSseJob) -> AsyncIterator[bytes]:
    """Wikipedia クライアントの生成・解放と SSE キューを共通化する。"""
    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    wiki = JaWikipediaClient()

    async def on_progress(phase: str, done: int, total: int) -> None:
        await queue.put(
            {"type": "progress", "phase": phase, "done": done, "total": total}
        )

    async def worker() -> None:
        try:
            payload = await run(wiki, db, on_progress)
            await queue.put(payload)
        except Exception as e:
            await queue.put({"type": "error", "message": str(e)})
        finally:
            await queue.put(None)
            await wiki.aclose()

    task = asyncio.create_task(worker())
    while True:
        item = await queue.get()
        if item is None:
            break
        yield sse_data_chunk(item)
    await task
