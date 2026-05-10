"""ja.wikipedia.org の転送（リダイレクト）を解決し、記事の正規タイトル・URLへそろえる。"""

from __future__ import annotations

from urllib.parse import unquote, urlparse

import httpx

from app import crud
from app.schemas import PersonIn

WIKIPEDIA_API = "https://ja.wikipedia.org/w/api.php"
UA = "people_relation/0.1 (https://localhost; contact: local-dev)"
_CHUNK = 45


def _is_ja_wikipedia_host(host: str) -> bool:
    h = (host or "").lower()
    return h in ("ja.wikipedia.org", "ja.m.wikipedia.org")


def title_from_ja_wikipedia_url(url: str) -> str | None:
    """記事 URL の `/wiki/` 以降からページタイトルを復元する。"""
    try:
        u = urlparse(url.strip())
    except Exception:
        return None
    if not _is_ja_wikipedia_host(u.netloc):
        return None
    path = u.path or ""
    prefix = "/wiki/"
    if not path.startswith(prefix):
        return None
    raw = unquote(path[len(prefix) :])
    if not raw:
        return None
    return raw.replace("_", " ").strip()


def _apply_normalized_steps(t: str, normalized: list[dict[str, str]]) -> str:
    cur = t
    guard = 0
    while guard < 10:
        guard += 1
        nxt = cur
        for n in normalized:
            if cur == (n.get("from") or ""):
                nxt = str(n.get("to") or cur)
                break
        if nxt == cur:
            break
        cur = nxt
    return cur


def _follow_redirects(t: str, redirects: list[dict[str, str]]) -> str:
    red_map = {
        str(r.get("from") or ""): str(r.get("to") or "")
        for r in redirects
        if r.get("from")
    }
    cur = t
    guard = 0
    seen: set[str] = set()
    while cur in red_map and cur not in seen and guard < 30:
        seen.add(cur)
        cur = red_map[cur]
        guard += 1
    return cur


def _parse_resolution_for_chunk(
    chunk: list[str], data: dict[str, object]
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
    norm_list = [x for x in normalized if isinstance(x, dict)]
    red_list = [x for x in redirects if isinstance(x, dict)]

    out: dict[str, str] = {}
    for orig in chunk:
        if not orig:
            continue
        t = _apply_normalized_steps(orig, norm_list)
        t = _follow_redirects(t, red_list)
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
        with httpx.Client(timeout=20.0, headers={"User-Agent": UA}) as client:
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
        return {t: t for t in uniq}
    for t in uniq:
        if t not in out:
            out[t] = t
    return out


def normalized_person_in(p: PersonIn, resolved: dict[str, str]) -> tuple[str, str, str]:
    """転送解決後の (name, url, title)。ja.wikipedia の記事 URL のみ正規タイトルへそろえる。
    転送元 URL（別名記事）の場合は、表示名 name も正規タイトルに揃え、転送元のリンク名のまま登録しない。
    """
    name = p.name
    from_url = title_from_ja_wikipedia_url(p.url)
    if from_url is not None:
        canon = resolved.get(from_url, from_url)
        url_c = crud.wiki_ja_article_url(canon)
        if canon != from_url:
            name = canon
        return name, url_c, canon
    url_n = crud.normalize_url(p.url)
    tit = (p.title or p.name or "").strip() or name
    return name, url_n, tit
