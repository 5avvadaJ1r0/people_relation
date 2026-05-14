"""ja.wikipedia.org の転送（リダイレクト）を解決し、記事の正規タイトル・URLへそろえる。"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any, cast
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from app import crud
from app.schemas import PersonIn
from app.settings import settings

logger = logging.getLogger(__name__)

WIKIPEDIA_API = "https://ja.wikipedia.org/w/api.php"
# MediaWiki `titles=` は公式でも複数件だが、URI 長・サーバ制限を踏みにくいよう余裕を見て分割する。
_CHUNK = 45

_RESOLVE_HTTP_CLIENT: httpx.Client | None = None


def _get_resolve_client() -> httpx.Client:
    global _RESOLVE_HTTP_CLIENT
    if _RESOLVE_HTTP_CLIENT is None:
        # httpx 0.28+: 部分指定不可。connect/read に加え write/pool を明示する。
        _RESOLVE_HTTP_CLIENT = httpx.Client(
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0),
            headers={"User-Agent": settings.wikipedia_user_agent},
        )
    return _RESOLVE_HTTP_CLIENT


def _is_ja_wikipedia_host(host: str) -> bool:
    h = (host or "").lower()
    return h in ("ja.wikipedia.org", "ja.m.wikipedia.org")


def title_from_ja_wikipedia_url(url: str) -> str | None:
    """記事 URL からページタイトルを復元する（`/wiki/…` および `index.php?title=`）。"""
    try:
        u = urlparse(url.strip())
    except Exception:
        return None
    if not _is_ja_wikipedia_host(u.netloc):
        return None
    path = (u.path or "").rstrip("/")
    prefix = "/wiki"
    if path.startswith(prefix + "/") or path == prefix:
        seg = path[len(prefix) :].lstrip("/")
        if not seg:
            return None
        raw = unquote(seg)
        if not raw:
            return None
        return raw.replace("_", " ").strip()

    if path.endswith("index.php") or path.endswith("/index.php"):
        qs = parse_qs(u.query or "")
        titles = qs.get("title") or []
        if not titles or not str(titles[0] or "").strip():
            return None
        raw = unquote(str(titles[0]))
        if not raw:
            return None
        return raw.replace("_", " ").strip()

    return None


def _norm_map_from_api_entries(
    norm_list: list[Mapping[str, object]],
) -> dict[str, str]:
    return {
        str(n.get("from") or ""): str(n.get("to") or "")
        for n in norm_list
        if n.get("from")
    }


def _red_map_from_api_entries(
    red_list: list[Mapping[str, object]],
) -> dict[str, str]:
    return {
        str(r.get("from") or ""): str(r.get("to") or "")
        for r in red_list
        if r.get("from")
    }


def _resolve_chain(
    start: str,
    mapping: dict[str, str],
    *,
    max_steps: int,
    cycle_guard: bool,
) -> str:
    """
    `from`→`to` の 1 ステップ写像を `max_steps` 回まで辿る。
    `cycle_guard` が真のとき（redirects）訪問済みタイトルで打ち切り、偽のとき（normalized）は非巡回を前提にループ上限のみ。
    """
    cur = start
    seen: set[str] = set()
    for _ in range(max_steps):
        if cycle_guard:
            if cur in seen:
                break
            seen.add(cur)
        nxt = mapping.get(cur)
        if nxt is None or nxt == cur:
            break
        cur = nxt
    return cur


def _parse_resolution_for_chunk(
    chunk: list[str], data: dict[str, Any]
) -> dict[str, str]:
    """MediaWiki `action=query&redirects=1` の結果から、リクエストした各タイトル → 正規タイトル。"""
    q = (data or {}).get("query") if isinstance(data, dict) else None
    q = q if isinstance(q, dict) else {}
    raw_norm = q.get("normalized")
    raw_red = q.get("redirects")
    normalized: list[object] = []
    redirects: list[object] = []
    if isinstance(raw_norm, list):
        normalized = raw_norm
    if isinstance(raw_red, list):
        redirects = raw_red
    norm_list = [
        cast(Mapping[str, object], x) for x in normalized if isinstance(x, dict)
    ]
    red_list = [cast(Mapping[str, object], x) for x in redirects if isinstance(x, dict)]

    norm_map = _norm_map_from_api_entries(norm_list)
    red_map = _red_map_from_api_entries(red_list)

    out: dict[str, str] = {}
    for orig in chunk:
        if not orig:
            continue
        t = _resolve_chain(orig, norm_map, max_steps=10, cycle_guard=False)
        t = _resolve_chain(t, red_map, max_steps=30, cycle_guard=True)
        out[orig] = t
    return out


def resolve_ja_wikipedia_titles_sync(titles: list[str]) -> dict[str, str]:
    """
    日本語 Wikipedia で転送を解決し、入力タイトルキーごとの正規記事タイトルを返す。
    API 失敗時は入力どおり（同一キー→同一値）にフォールバックする。
    """
    uniq: list[str] = []
    seen: set[str] = set()
    for t in titles:
        if not t or not str(t).strip():
            continue
        s = str(t).strip()
        if s not in seen:
            seen.add(s)
            uniq.append(s)
    if not uniq:
        return {}
    out: dict[str, str] = {}
    try:
        client = _get_resolve_client()
        for i in range(0, len(uniq), _CHUNK):
            chunk = uniq[i : i + _CHUNK]
            resp = client.get(
                WIKIPEDIA_API,
                params={
                    "action": "query",
                    "format": "json",
                    "titles": "|".join(chunk),
                    "redirects": 1,
                    "utf8": 1,
                },
            )
            resp.raise_for_status()
            body = resp.json()
            part = _parse_resolution_for_chunk(chunk, body)
            out.update(part)
    except Exception:
        logger.exception("failed to resolve wikipedia redirects (bulk)")
        return {t: t for t in uniq}
    for t in uniq:
        if t not in out:
            out[t] = t
    return out


def _person_identity_from_ja_wiki_url(
    p: PersonIn, resolved: dict[str, str]
) -> tuple[str, str, str] | None:
    """ja.wikipedia の記事 URL から、転送解決後の (表示名, URL, canonical title)。該当しない場合は None。"""
    from_url = title_from_ja_wikipedia_url(p.url)
    if from_url is None:
        return None
    canon = resolved.get(from_url, from_url)
    url_c = crud.wiki_ja_article_url(canon)
    name = canon if canon != from_url else p.name
    return name, url_c, canon


def normalized_person_in(p: PersonIn, resolved: dict[str, str]) -> tuple[str, str, str]:
    """転送解決後の (name, url, title)。ja.wikipedia の記事 URL のみ正規タイトルへそろえる。
    転送元 URL（別名記事）の場合は、表示名 name も正規タイトルに揃え、転送元のリンク名のまま登録しない。
    """
    from_wiki = _person_identity_from_ja_wiki_url(p, resolved)
    if from_wiki is not None:
        return from_wiki
    name = p.name
    url_n = crud.normalize_url(p.url)
    tit = (p.title or p.name or "").strip() or name
    return name, url_n, tit
