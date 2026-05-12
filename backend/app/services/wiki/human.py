from __future__ import annotations

import asyncio
import json
import logging
import threading
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, cast

import httpx
import redis

from app import crud
from app.db import SessionLocal
from app.schemas import HumanCheck
from app.settings import settings


logger = logging.getLogger(__name__)

WIKIPEDIA_API = "https://ja.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
HUMAN_QID = "Q5"
INSTANCE_OF_PID = "P31"
JA_WIKI_SITE = "jawiki"

# wbgetentities の titles / ids パラメータは | 区切り（利用者向け既定上限に合わせる）
WBGETENTITIES_MAX_TITLES_PER_REQUEST = 50

# バッチ内ライブ解決の同時実行上限（タイトル単位ライブ解決パスのみ）
# Wikimedia のレート制限を踏みにくくするため控えめに（バッチ API が主経路）
BATCH_LIVE_HUMAN_MAX_CONCURRENT = 8

# Redis TTL（秒）: 否定的結果は短め（記事性質の変化に追随しやすく）
REDIS_IS_HUMAN_NEGATIVE_TTL_SEC = 86400  # 1 day
REDIS_IS_HUMAN_POSITIVE_TTL_SEC = 60 * 60 * 24 * 30  # 30 days

_wiki_resources_lock = threading.Lock()
_redis_client: redis.Redis | None = None
_http_httpx: httpx.AsyncClient | None = None


def _redis() -> redis.Redis:
    """共有 Redis クライアント（接続プール再利用）。"""
    global _redis_client
    with _wiki_resources_lock:
        if _redis_client is None:
            _redis_client = redis.Redis.from_url(
                settings.redis_url, decode_responses=True
            )
        return _redis_client


def _http_client() -> httpx.AsyncClient:
    """共有 httpx AsyncClient（ja.wikipedia / www.wikidata.org 兼用）。"""
    global _http_httpx
    with _wiki_resources_lock:
        if _http_httpx is None:
            _http_httpx = httpx.AsyncClient(
                timeout=httpx.Timeout(12.0),
                headers={"User-Agent": settings.wikipedia_user_agent},
            )
        return _http_httpx


async def aclose_shared_http_and_redis() -> None:
    """アプリ終了時: 共有 httpx / Redis を閉じる（テストや再読込でも安全）。"""
    global _http_httpx, _redis_client
    h: httpx.AsyncClient | None
    rd: redis.Redis | None
    with _wiki_resources_lock:
        h = _http_httpx
        _http_httpx = None
        rd = _redis_client
        _redis_client = None
    if h is not None:
        await h.aclose()
    if rd is not None:
        await asyncio.to_thread(rd.close)


def _norm_title_key(title: str) -> str:
    """sitelinks / 入力タイトルの突き合わせ・Redis キー用（空白と `_` の差のみ吸収）。"""
    return title.replace("_", " ").strip()


def _cache_key(title: str) -> str:
    return f"wiki:is_human:ja:{_norm_title_key(title)}"


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


def _claims_have_instance_of_human(claims: object) -> bool:
    if not isinstance(claims, dict):
        return False
    p31 = claims.get(INSTANCE_OF_PID)
    if not isinstance(p31, list):
        return False
    for item in p31:
        if not isinstance(item, dict):
            continue
        try:
            snak = item.get("mainsnak") or {}
            dv = (snak.get("datavalue") or {}).get("value")
            if isinstance(dv, dict) and dv.get("id") == HUMAN_QID:
                return True
        except Exception:
            continue
    return False


def _index_wbgetentities_sitelinks_human(
    data: object,
) -> dict[str, tuple[str, bool, str]]:
    """
    wbgetentities（props に claims と sitelinks）の JSON から
    jawiki 記事タイトル（正規化キー）→ (QID, is_human, jawiki の表記タイトル) の索引。
    """
    out: dict[str, tuple[str, bool, str]] = {}
    if not isinstance(data, dict):
        return out
    entities = data.get("entities")
    if not isinstance(entities, dict):
        return out
    for ent in entities.values():
        if not isinstance(ent, dict):
            continue
        if ent.get("missing") is not None:
            continue
        qid = ent.get("id")
        if not isinstance(qid, str) or not qid.startswith("Q"):
            continue
        sitelinks = ent.get("sitelinks")
        if not isinstance(sitelinks, dict):
            continue
        ja = sitelinks.get(JA_WIKI_SITE)
        if not isinstance(ja, dict):
            continue
        raw_title = ja.get("title")
        if not isinstance(raw_title, str) or not raw_title.strip():
            continue
        k = _norm_title_key(raw_title)
        claims = ent.get("claims")
        out[k] = (qid, _claims_have_instance_of_human(claims), raw_title)
    return out


async def _wbgetentities_json_for_titles(titles: list[str]) -> dict | None:
    if not titles:
        return {}
    client = _http_client()
    pipe = "|".join(titles)
    try:
        resp = await client.get(
            WIKIDATA_API,
            params={
                "action": "wbgetentities",
                "format": "json",
                "sites": JA_WIKI_SITE,
                "titles": pipe,
                "props": "claims|sitelinks",
                "redirects": "yes",
                "utf8": 1,
            },
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError:
        logger.exception(
            "wbgetentities(sites+titles) failed titles_count=%s", len(titles)
        )
        return None


async def _wbgetentities_json_for_qids(qids: list[str]) -> dict | None:
    if not qids:
        return {}
    client = _http_client()
    pipe = "|".join(qids)
    try:
        resp = await client.get(
            WIKIDATA_API,
            params={
                "action": "wbgetentities",
                "format": "json",
                "ids": pipe,
                "props": "claims",
                "utf8": 1,
            },
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError:
        logger.exception("wbgetentities(ids) failed qid_count=%s", len(qids))
        return None


def _human_flags_by_qid_from_claims_response(data: object) -> dict[str, bool]:
    out: dict[str, bool] = {}
    if not isinstance(data, dict):
        return out
    entities = data.get("entities")
    if not isinstance(entities, dict):
        return out
    for ent in entities.values():
        if not isinstance(ent, dict):
            continue
        qid = ent.get("id")
        if not isinstance(qid, str) or not qid.startswith("Q"):
            continue
        out[qid] = _claims_have_instance_of_human(ent.get("claims"))
    return out


async def _ja_wikipedia_wikibase_titles_batch(
    titles: list[str],
) -> dict[str, tuple[str | None, str, bool]]:
    """
    ja.wikipedia の query（redirects=1）で wikibase_item を解決する。

    戻り値: ``_norm_title_key(リクエストしたタイトル)`` →
    ``(qid または None, canonical_title, wikipedia_page_missing)``。
    """
    out: dict[str, tuple[str | None, str, bool]] = {}
    if not titles:
        return out
    client = _http_client()
    pipe = "|".join(titles)
    try:
        resp = await client.get(
            WIKIPEDIA_API,
            params={
                "action": "query",
                "format": "json",
                "prop": "pageprops",
                "ppprop": "wikibase_item",
                "titles": pipe,
                "redirects": 1,
                "utf8": 1,
            },
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError:
        logger.exception(
            "ja.wikipedia query(pageprops) failed titles_count=%s", len(titles)
        )
        return {_norm_title_key(t): (None, t.strip(), True) for t in titles}

    query = data.get("query") if isinstance(data, dict) else None
    if not isinstance(query, dict):
        return {_norm_title_key(t): (None, t.strip(), True) for t in titles}

    pages = list((query.get("pages") or {}).values())
    final_by_norm: dict[str, tuple[str | None, str, bool]] = {}
    for p in pages:
        if not isinstance(p, dict):
            continue
        canon = str(p.get("title") or "").strip()
        nk = _norm_title_key(canon)
        if p.get("missing"):
            final_by_norm[nk] = (None, canon or "", True)
            continue
        pp = p.get("pageprops") or {}
        qid_raw = pp.get("wikibase_item") if isinstance(pp, dict) else None
        qid = qid_raw if isinstance(qid_raw, str) and qid_raw.startswith("Q") else None
        final_by_norm[nk] = (qid, canon, False)

    redir: dict[str, str] = {}
    for r in query.get("redirects") or []:
        if (
            isinstance(r, dict)
            and isinstance(r.get("from"), str)
            and isinstance(r.get("to"), str)
        ):
            redir[_norm_title_key(r["from"])] = _norm_title_key(r["to"])

    def _follow(nk: str) -> str:
        seen: set[str] = set()
        cur = nk
        while cur in redir and cur not in seen:
            seen.add(cur)
            cur = redir[cur]
        return cur

    for t in titles:
        orig = t.strip()
        nk0 = _norm_title_key(orig)
        nk = nk0
        for n in query.get("normalized") or []:
            if (
                isinstance(n, dict)
                and isinstance(n.get("from"), str)
                and isinstance(n.get("to"), str)
                and _norm_title_key(n["from"]) == nk0
            ):
                nk = _norm_title_key(n["to"])
                break
        fk = _follow(nk)
        row = final_by_norm.get(fk)
        if row is None:
            out[nk0] = (None, orig, True)
        else:
            out[nk0] = row
    return out


async def _human_flags_for_qids(qids: list[str]) -> dict[str, bool | None]:
    """各 QID について P31=Q5 相当か。取得不能時はキー欠損ではなく明示的に None を入れる。"""
    uniq = [x for x in dict.fromkeys(qids) if isinstance(x, str) and x.startswith("Q")]
    flags: dict[str, bool | None] = {}
    for start in range(0, len(uniq), WBGETENTITIES_MAX_TITLES_PER_REQUEST):
        chunk = uniq[start : start + WBGETENTITIES_MAX_TITLES_PER_REQUEST]
        data = await _wbgetentities_json_for_qids(chunk)
        if data is None:
            for q in chunk:
                flags[q] = None
            continue
        parsed = _human_flags_by_qid_from_claims_response(data)
        for q in chunk:
            flags[q] = parsed.get(q)
    return flags


async def _live_human_checks_for_titles(stripped_titles: list[str]) -> list[HumanCheck]:
    """
    DB / Redis は見ない。Wikidata ``wbgetentities``（sites+titles、バッチ）を主とし、
    未解決分は Wikipedia ``query`` → ``wbgetentities``（ids）で P31 を補完する。

    成功判定分は Redis / ``wiki_human_cache`` に書き込む。Wikidata HTTP 全体失敗時は
    ``source=unknown`` で **キャッシュしない**。
    """
    if not stripped_titles:
        return []
    r = _redis()
    out: list[HumanCheck] = []

    for start in range(0, len(stripped_titles), WBGETENTITIES_MAX_TITLES_PER_REQUEST):
        chunk = stripped_titles[start : start + WBGETENTITIES_MAX_TITLES_PER_REQUEST]
        data0 = await _wbgetentities_json_for_titles(chunk)
        if data0 is None:
            out.extend(
                HumanCheck(title=t, qid=None, is_human=False, source="unknown")
                for t in chunk
            )
            continue

        by_site = _index_wbgetentities_sitelinks_human(data0)
        need_wp: list[str] = [
            t for t in chunk if t and _norm_title_key(t) not in by_site
        ]

        wp_map: dict[str, tuple[str | None, str, bool]] = {}
        if need_wp:
            wp_map = await _ja_wikipedia_wikibase_titles_batch(need_wp)

        qids_for_flags: list[str] = []
        for t in need_wp:
            row = wp_map.get(_norm_title_key(t))
            if row and row[0]:
                qids_for_flags.append(row[0])
        human_by_qid = await _human_flags_for_qids(qids_for_flags)

        db = SessionLocal()
        db_dirty = False
        try:
            for t in chunk:
                if not t:
                    out.append(
                        HumanCheck(
                            title="",
                            qid=None,
                            is_human=False,
                            source="unknown",
                        )
                    )
                    continue

                key = _cache_key(t)
                nk = _norm_title_key(t)
                if nk in by_site:
                    qid, is_human, canon = by_site[nk]
                    url_canon = crud.wiki_ja_article_url(canon)
                    hc = HumanCheck(
                        title=canon, qid=qid, is_human=is_human, source="live"
                    )
                    ttl = (
                        REDIS_IS_HUMAN_POSITIVE_TTL_SEC
                        if is_human
                        else REDIS_IS_HUMAN_NEGATIVE_TTL_SEC
                    )
                    r.setex(
                        key,
                        ttl,
                        json.dumps({"qid": qid, "is_human": is_human}),
                    )
                    crud.upsert_wiki_human_cache(
                        db,
                        title=canon,
                        url=url_canon,
                        qid=qid,
                        is_human=is_human,
                    )
                    db_dirty = True
                    out.append(hc)
                    continue

                wq, wcanon, wp_missing = wp_map.get(nk, (None, t, True))
                if not wq:
                    hc = HumanCheck(
                        title=wcanon, qid=None, is_human=False, source="live"
                    )
                    r.setex(
                        key,
                        REDIS_IS_HUMAN_NEGATIVE_TTL_SEC,
                        json.dumps({"qid": None, "is_human": False}),
                    )
                    if (not wp_missing) and wcanon.strip():
                        crud.upsert_wiki_human_cache(
                            db,
                            title=wcanon,
                            url=crud.wiki_ja_article_url(wcanon),
                            qid=None,
                            is_human=False,
                        )
                        db_dirty = True
                    out.append(hc)
                    continue

                is_human_wd = human_by_qid.get(wq)
                if is_human_wd is None:
                    out.append(
                        HumanCheck(
                            title=wcanon, qid=wq, is_human=False, source="unknown"
                        )
                    )
                    continue

                url_canon = crud.wiki_ja_article_url(wcanon)
                hc = HumanCheck(
                    title=wcanon,
                    qid=wq,
                    is_human=is_human_wd,
                    source="live",
                )
                ttl = (
                    REDIS_IS_HUMAN_POSITIVE_TTL_SEC
                    if is_human_wd
                    else REDIS_IS_HUMAN_NEGATIVE_TTL_SEC
                )
                r.setex(
                    key,
                    ttl,
                    json.dumps({"qid": wq, "is_human": is_human_wd}),
                )
                crud.upsert_wiki_human_cache(
                    db,
                    title=wcanon,
                    url=url_canon,
                    qid=wq,
                    is_human=is_human_wd,
                )
                db_dirty = True
                out.append(hc)
            if db_dirty:
                db.commit()
        finally:
            db.close()

    return out


async def live_resolve_human_checks_wbget_batch(titles: list[str]) -> list[HumanCheck]:
    """
    ``_live_human_checks_for_titles`` のエイリアス（外部からのバッチライブ解決用）。
    """
    stripped = [str(t or "").strip() for t in titles]
    return await _live_human_checks_for_titles(stripped)


async def batch_human_checks_with_db_redis_priority(
    titles: list[str],
    *,
    live_resolver: Callable[[str], Awaitable[HumanCheck]] | None = None,
    live_batch_resolver: Callable[[list[str]], Awaitable[list[HumanCheck]]]
    | None = None,
) -> list[HumanCheck]:
    """
    複数タイトルについて ``wiki_human_cache`` を DB で一括取得し、
    未命中は Redis ``MGET``、さらに未命中のみライブ解決に回す。

    ``live_batch_resolver`` が与えられた場合、未キャッシュ分は **リスト単位**で解決する。

    ``live_batch_resolver`` も ``live_resolver`` も無い場合、未キャッシュ分は
    ``live_resolve_human_checks_wbget_batch``（内部で ``wbgetentities`` を最大 50 件束ねる）。

    ``live_resolver`` のみ与えられた場合はタイトルごとに呼ぶ（``asyncio.Semaphore`` 制限付き）。

    ``live_batch_resolver`` 指定時は ``live_resolver`` はライブ解決に使われない。

    戻り値の長さ・順序は ``titles`` と一致する。
    """
    n = len(titles)
    stripped = [str(t or "").strip() for t in titles]
    results: list[HumanCheck | None] = [None] * n

    pending_indices: list[int] = [i for i in range(n) if stripped[i]]
    for i in range(n):
        if not stripped[i]:
            results[i] = HumanCheck(
                title=str(titles[i] or ""),
                qid=None,
                is_human=False,
                source="unknown",
            )

    if not pending_indices:
        return [results[i] for i in range(n)]  # type: ignore[list-item]

    urls = [crud.wiki_ja_article_url(stripped[i]) for i in pending_indices]
    db0 = SessionLocal()
    try:
        try:
            hits = crud.list_wiki_human_cache_by_urls(db0, urls)
        except Exception:
            logger.exception("list_wiki_human_cache_by_urls failed")
            hits = []
    finally:
        db0.close()

    by_norm_url: dict[str, Any] = {}
    for row in hits:
        by_norm_url[crud.normalize_url(row.url)] = row

    need_redis: list[tuple[int, str]] = []
    for i, u in zip(pending_indices, urls):
        hit = by_norm_url.get(crud.normalize_url(u))
        if hit is not None:
            results[i] = HumanCheck(
                title=hit.title,
                qid=hit.qid,
                is_human=bool(hit.is_human),
                source="db_cache",
            )
        else:
            need_redis.append((i, stripped[i]))

    need_api: list[tuple[int, str]] = []
    if need_redis:
        raw_vals: list[Any | None]
        try:
            r = _redis()
            keys = [_cache_key(t) for _, t in need_redis]
            raw_vals = (
                list(cast(Sequence[Any | None], r.mget(keys))) if keys else []
            )
        except redis.RedisError:
            logger.exception(
                "redis mget failed in batch_human_checks; falling through to live for %s keys",
                len(need_redis),
            )
            raw_vals = [None] * len(need_redis)

        for (i, t), cached in zip(need_redis, raw_vals):
            if cached:
                try:
                    if not isinstance(cached, (str, bytes, bytearray)):
                        cached = str(cached)
                    d = json.loads(cached)
                    results[i] = HumanCheck(
                        title=t,
                        qid=d.get("qid"),
                        is_human=_coerce_bool(d.get("is_human")),
                        source="cache",
                    )
                except Exception:
                    need_api.append((i, t))
            else:
                need_api.append((i, t))

    if need_api:
        if live_batch_resolver is not None:
            ts = [t for _, t in need_api]
            try:
                resolved_list = await live_batch_resolver(ts)
            except Exception:
                logger.exception("live_batch_resolver failed")
                resolved_list = []

            if len(resolved_list) != len(need_api):
                logger.warning(
                    "live_batch_resolver length mismatch: expected %s got %s",
                    len(need_api),
                    len(resolved_list),
                )
                pad = len(need_api) - len(resolved_list)
                resolved_list = list(resolved_list) + [
                    HumanCheck(
                        title=ts[i + len(resolved_list)],
                        qid=None,
                        is_human=False,
                        source="unknown",
                    )
                    for i in range(pad)
                ]
            for (i, t), h in zip(need_api, resolved_list):
                if h.title.strip() == "":
                    results[i] = HumanCheck(
                        title=t, qid=None, is_human=False, source="unknown"
                    )
                else:
                    results[i] = h
        elif live_resolver is None:
            ts = [t for _, t in need_api]
            resolved_list = await live_resolve_human_checks_wbget_batch(ts)
            for (i, _t), h in zip(need_api, resolved_list):
                results[i] = h
        else:
            sem = asyncio.Semaphore(BATCH_LIVE_HUMAN_MAX_CONCURRENT)

            async def _limited(t: str) -> HumanCheck:
                async with sem:
                    return await live_resolver(t)

            gathered = await asyncio.gather(
                *(_limited(t) for _, t in need_api),
                return_exceptions=True,
            )
            for (i, t), h in zip(need_api, gathered):
                if isinstance(h, HumanCheck):
                    results[i] = h
                else:
                    exc = h if isinstance(h, BaseException) else None
                    if exc is not None:
                        logger.warning(
                            "live human resolver failed title=%s", t, exc_info=exc
                        )
                    results[i] = HumanCheck(
                        title=t, qid=None, is_human=False, source="unknown"
                    )

    out: list[HumanCheck] = []
    for i in range(n):
        r_i = results[i]
        if r_i is None:
            raise RuntimeError(f"batch_human_checks: unresolved index {i}")
        out.append(r_i)
    return out


async def is_human_by_title(title: str) -> HumanCheck:
    t = title.strip()
    if not t:
        return HumanCheck(title=title, qid=None, is_human=False, source="unknown")

    url_guess = crud.wiki_ja_article_url(t)
    db = SessionLocal()
    try:
        hit = crud.get_wiki_human_cache(db, url=url_guess)
        if hit is not None:
            return HumanCheck(
                title=hit.title,
                qid=hit.qid,
                is_human=bool(hit.is_human),
                source="db_cache",
            )

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

        resolved = await _live_human_checks_for_titles([t])
        if len(resolved) != 1:
            return HumanCheck(title=t, qid=None, is_human=False, source="unknown")
        hc = resolved[0]

        url_canon = crud.wiki_ja_article_url(hc.title)
        hit2 = crud.get_wiki_human_cache(db, url=url_canon)
        if hit2 is not None:
            return HumanCheck(
                title=hit2.title,
                qid=hit2.qid,
                is_human=bool(hit2.is_human),
                source="db_cache",
            )
        return hc
    finally:
        db.close()
