from __future__ import annotations

import json
from typing import Any

import httpx
import redis

from app import crud
from app.db import SessionLocal
from app.schemas import HumanCheck
from app.settings import settings


WIKIPEDIA_API = "https://ja.wikipedia.org/w/api.php"
WIKIDATA_ENTITY = "https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
HUMAN_QID = "Q5"
UA = "people_relation/0.1 (https://localhost; contact: local-dev)"


def _redis() -> redis.Redis:
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


def _cache_key(title: str) -> str:
    return f"wiki:is_human:ja:{title}"


def _coerce_bool(v: object) -> bool:
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in {"true", "1", "yes", "y", "on"}:
            return True
        if s in {"false", "0", "no", "n", "off", ""}:
            return False
    return False


async def is_human_by_title(title: str) -> HumanCheck:
    t = title.strip()
    if not t:
        return HumanCheck(title=title, qid=None, is_human=False, source="unknown")

    url_guess = crud.wiki_ja_article_url(t)
    db0 = SessionLocal()
    try:
        hit = crud.get_wiki_human_cache(db0, url=url_guess)
        if hit is not None:
            return HumanCheck(
                title=hit.title,
                qid=hit.qid,
                is_human=bool(hit.is_human),
                source="db_cache",
            )
    finally:
        db0.close()

    r = _redis()
    key = _cache_key(t)
    cached: Any = r.get(key)
    if cached:
        try:
            if not isinstance(cached, (str, bytes, bytearray)):
                cached = str(cached)
            d = json.loads(cached)
            return HumanCheck(
                title=t,
                qid=d.get("qid"),
                is_human=_coerce_bool(d.get("is_human")),
                source="cache",
            )
        except Exception:
            pass

    async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": UA}) as client:
        try:
            resp = await client.get(
                WIKIPEDIA_API,
                params={
                    "action": "query",
                    "format": "json",
                    "prop": "pageprops",
                    "ppprop": "wikibase_item",
                    "titles": t,
                    "redirects": 1,
                    "utf8": 1,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception:
            return HumanCheck(title=t, qid=None, is_human=False, source="unknown")

        pages = list((data.get("query", {}).get("pages", {}) or {}).values())
        canonical_title = t
        qid: str | None = None
        for p in pages:
            if p.get("missing"):
                continue
            canonical_title = p.get("title") or canonical_title
            pp = p.get("pageprops") or {}
            qid = pp.get("wikibase_item")
            break

        url_canon = crud.wiki_ja_article_url(canonical_title)
        db1 = SessionLocal()
        try:
            hit2 = crud.get_wiki_human_cache(db1, url=url_canon)
            if hit2 is not None:
                return HumanCheck(
                    title=hit2.title,
                    qid=hit2.qid,
                    is_human=bool(hit2.is_human),
                    source="db_cache",
                )
        finally:
            db1.close()

        if not pages or all(x.get("missing") for x in pages):
            out = HumanCheck(title=t, qid=None, is_human=False, source="live")
            r.setex(key, 60 * 60 * 24 * 7, json.dumps({"qid": None, "is_human": False}))
            return out

        if not qid:
            out = HumanCheck(
                title=canonical_title, qid=None, is_human=False, source="live"
            )
            r.setex(key, 60 * 60 * 24 * 7, json.dumps({"qid": None, "is_human": False}))
            dbx = SessionLocal()
            try:
                crud.upsert_wiki_human_cache(
                    dbx,
                    title=canonical_title,
                    url=url_canon,
                    qid=None,
                    is_human=False,
                )
                dbx.commit()
            finally:
                dbx.close()
            return out

        try:
            resp2 = await client.get(WIKIDATA_ENTITY.format(qid=qid))
            resp2.raise_for_status()
            wd = resp2.json()
        except Exception:
            return HumanCheck(
                title=canonical_title, qid=qid, is_human=False, source="unknown"
            )

        ent = ((wd.get("entities") or {}).get(qid)) or {}
        claims = ent.get("claims") or {}
        p31 = claims.get("P31") or []
        is_human = False
        for c in p31:
            dv = ((c.get("mainsnak") or {}).get("datavalue") or {}).get("value") or {}
            if dv.get("id") == HUMAN_QID:
                is_human = True
                break

        out = HumanCheck(
            title=canonical_title, qid=qid, is_human=is_human, source="live"
        )
        r.setex(key, 60 * 60 * 24 * 30, json.dumps({"qid": qid, "is_human": is_human}))
        dbx = SessionLocal()
        try:
            crud.upsert_wiki_human_cache(
                dbx,
                title=canonical_title,
                url=url_canon,
                qid=qid,
                is_human=is_human,
            )
            dbx.commit()
        finally:
            dbx.close()
        return out
