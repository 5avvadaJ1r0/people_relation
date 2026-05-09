from __future__ import annotations

from fastapi import APIRouter, Query

from app.services.wiki_human import is_human_by_title

router = APIRouter(prefix="/wiki", tags=["wiki"])


@router.get("/is_human")
async def wiki_is_human(title: str = Query(min_length=1)) -> dict:
    """
    Wikidataの instance of(P31) が human(Q5) かで人物判定する。
    Redisにキャッシュする（Wikipedia/Wikidataへの負荷対策）。
    """
    r = await is_human_by_title(title)
    return {"title": r.title, "qid": r.qid, "is_human": r.is_human, "source": r.source}
