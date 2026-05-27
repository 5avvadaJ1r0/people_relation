from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import WikiPersonSearchOut, WikiSearchRowOut
from app.services.wiki.person_search_api import wiki_person_search

router = APIRouter(prefix="/wiki", tags=["wiki"])


@router.get("/person_search", response_model=WikiPersonSearchOut)
async def wiki_person_search_endpoint(
    q: str = Query(min_length=1),
    db: Session = Depends(get_db),
) -> WikiPersonSearchOut:
    """
    Wikipedia 人物検索 + Wikidata 人物判定をサーバーで実行し、JSON で返す。
    2-hop 関連抽出は HTTP では公開せず、ワーカー（`app.worker.relation_extract`）が実行する。
    """
    try:
        rows, empty_msg = await wiki_person_search(db, query=q)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return WikiPersonSearchOut(
        wiki=[WikiSearchRowOut(**r.as_api_dict()) for r in rows],
        empty_message=empty_msg,
    )
