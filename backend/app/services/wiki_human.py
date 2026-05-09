from __future__ import annotations

import json

import httpx
import redis

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


async def is_human_by_title(title: str) -> HumanCheck:
    t = title.strip()
    if not t:
        return HumanCheck(title=title, qid=None, is_human=False, source="unknown")

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

    r = _redis()
    key = _cache_key(t)
    cached = r.get(key)
    if cached:
        try:
            d = json.loads(cached)
            return HumanCheck(title=t, qid=d.get("qid"), is_human=_coerce_bool(d.get("is_human")), source="cache")
        except Exception:
            pass

    async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": UA}) as client:
        try:
            # 1) Wikipedia -> wikibase_item (QID)
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
            # 一時的な拒否/ネットワークエラー。is_human=False を短TTLキャッシュすると、
            # 再取得時に source=cache となりフロントが「非人物」と誤判定するためキャッシュしない。
            return HumanCheck(title=t, qid=None, is_human=False, source="unknown")
        pages = (data.get("query", {}).get("pages", {}) or {}).values()
        qid: str | None = None
        for p in pages:
            pp = p.get("pageprops") or {}
            qid = pp.get("wikibase_item")
            if qid:
                break
        if not qid:
            out = HumanCheck(title=t, qid=None, is_human=False, source="live")
            r.setex(key, 60 * 60 * 24 * 7, json.dumps({"qid": None, "is_human": False}))
            return out

        try:
            # 2) Wikidata -> P31 includes Q5 ?
            resp2 = await client.get(WIKIDATA_ENTITY.format(qid=qid))
            resp2.raise_for_status()
            wd = resp2.json()
        except Exception:
            # Wikidata 取得失敗も一時障害の可能性が高い。誤キャッシュは避ける。
            return HumanCheck(title=t, qid=qid, is_human=False, source="unknown")
        ent = (((wd.get("entities") or {}).get(qid)) or {})
        claims = ent.get("claims") or {}
        p31 = claims.get("P31") or []
        is_human = False
        for c in p31:
            dv = (((c.get("mainsnak") or {}).get("datavalue") or {}).get("value") or {})
            if dv.get("id") == HUMAN_QID:
                is_human = True
                break

        out = HumanCheck(title=t, qid=qid, is_human=is_human, source="live")
        r.setex(key, 60 * 60 * 24 * 30, json.dumps({"qid": qid, "is_human": is_human}))
        return out
