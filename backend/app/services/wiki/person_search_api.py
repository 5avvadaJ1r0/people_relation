from __future__ import annotations

from sqlalchemy.orm import Session

from app.services.wiki.api.ja_mediawiki import JaWikipediaClient
from app.services.wiki.extract.principal_search import (
    WikiSearchItem,
    run_principal_wiki_search,
)


async def wiki_person_search(
    db: Session,
    *,
    query: str,
) -> tuple[list[WikiSearchItem], str | None]:
    """Wikipedia 人物検索 + 人物判定（進捗通知なし・同期 JSON 用）。"""
    wiki = JaWikipediaClient()
    try:
        return await run_principal_wiki_search(wiki, query, db=db)
    finally:
        await wiki.aclose()
