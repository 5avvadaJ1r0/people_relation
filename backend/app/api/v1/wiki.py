from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.wiki_sse import iter_wiki_job_sse
from app.db import get_db
from app.services.wiki.extract.principal_search import run_principal_wiki_search
from app.services.wiki.extract.two_hop import extract_two_hop_relations

router = APIRouter(prefix="/wiki", tags=["wiki"])


@router.get("/person_search_sse")
async def wiki_person_search_sse(
    q: str = Query(min_length=1),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """
    Wikipedia 人物検索 + Wikidata 人物判定をサーバーで実行し、進捗を SSE で返す。
    最終イベント: `{"type":"search_result","wiki":[...],"emptyMessage":string|null}` または `{"type":"error",...}`。
    """

    async def event_stream():
        async def run(wiki, session, on_progress):
            rows, empty_msg = await run_principal_wiki_search(
                wiki, q, on_progress=on_progress, db=session
            )
            return {
                "type": "search_result",
                "wiki": [r.as_api_dict() for r in rows],
                "emptyMessage": empty_msg,
            }

        async for chunk in iter_wiki_job_sse(db, run):
            yield chunk

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
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """
    Wikipedia 2-hop 関連抽出（本文・wikitext 解析 + Wikidata 人物判定）をサーバーで実行し、進捗を SSE で返す。
    最終イベント: `{"type":"extract_result","master":{...},"relations":[...]}` または `{"type":"error",...}`。
    """

    async def event_stream():
        async def run(wiki, session, on_progress):
            out = await extract_two_hop_relations(
                wiki,
                master_title=title,
                master_name=title,
                max_related=max_related,
                db=session,
                on_progress=on_progress,
            )
            return {"type": "extract_result", **out}

        async for chunk in iter_wiki_job_sse(db, run):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
