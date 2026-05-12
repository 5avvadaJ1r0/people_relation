from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.services.wiki.api.ja_mediawiki import JaWikipediaClient
from app.services.wiki.extract.principal_search import run_principal_wiki_search
from app.services.wiki.extract.two_hop import extract_two_hop_relations

router = APIRouter(prefix="/wiki", tags=["wiki"])


def _sse_chunk(obj: dict) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")


@router.get("/person_search_sse")
async def wiki_person_search_sse(q: str = Query(min_length=1)) -> StreamingResponse:
    """
    Wikipedia 人物検索 + Wikidata 人物判定をサーバーで実行し、進捗を SSE で返す。
    最終イベント: `{"type":"search_result","wiki":[...],"emptyMessage":string|null}` または `{"type":"error",...}`。
    """

    async def event_stream():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()
        wiki = JaWikipediaClient()

        async def on_progress(phase: str, done: int, total: int) -> None:
            await queue.put(
                {"type": "progress", "phase": phase, "done": done, "total": total}
            )

        async def worker() -> None:
            try:
                rows, empty_msg = await run_principal_wiki_search(
                    wiki, q, on_progress=on_progress
                )
                await queue.put(
                    {
                        "type": "search_result",
                        "wiki": [r.as_api_dict() for r in rows],
                        "emptyMessage": empty_msg,
                    }
                )
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
            yield _sse_chunk(item)
        await task

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/extract_relations_sse")
async def wiki_extract_relations_sse(
    title: str = Query(min_length=1),
    max_related: int = Query(default=100, ge=1, le=500),
) -> StreamingResponse:
    """
    Wikipedia 2-hop 関連抽出（本文・wikitext 解析 + Wikidata 人物判定）をサーバーで実行し、進捗を SSE で返す。
    最終イベント: `{"type":"extract_result","master":{...},"relations":[...]}` または `{"type":"error",...}`。
    """

    async def event_stream():
        queue: asyncio.Queue[dict | None] = asyncio.Queue()
        wiki = JaWikipediaClient()

        async def on_progress(phase: str, done: int, total: int) -> None:
            await queue.put(
                {"type": "progress", "phase": phase, "done": done, "total": total}
            )

        async def worker() -> None:
            try:
                out = await extract_two_hop_relations(
                    wiki,
                    master_title=title,
                    master_name=title,
                    max_related=max_related,
                    on_progress=on_progress,
                )
                await queue.put({"type": "extract_result", **out})
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
            yield _sse_chunk(item)
        await task

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
