"""日本語 Wikipedia MediaWiki API クライアント（フロント `WikiApiClient` + `ExternalApiFetcher` 相当）。"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
from bs4 import BeautifulSoup

from app.services.wiki.parser.html import (
    collect_ns0_wiki_titles_from_html,
    strip_html_to_plain_text,
    strip_wiki_noise_sections_from_extract_plain,
    strip_wiki_noise_sections_from_parsed_html,
)
from app.services.wiki.parser.encoding_utils import (
    is_noise_wiki_section_fragment,
    normalize_wiki_link_title,
    title_has_non_main_namespace_prefix,
)
from app.settings import settings

WIKI_API = "https://ja.wikipedia.org/w/api.php"
MIN_INTERVAL = 0.15
# 同一リクエストに対する試行回数（初回 + リトライ）。429/503/504・ネットワーク・JSON 不正時に消費。
MAX_ATTEMPTS = 5


def _backoff_seconds(attempt_index: int) -> float:
    return 0.3 * (2**attempt_index)


_HATNOTE_BLOCK_CLASSES = frozenset({"hatnote", "dablink", "ambox"})


class JaWikipediaClient:
    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._owns_client = client is None
        ua = settings.wikipedia_user_agent
        self.client = client or httpx.AsyncClient(
            timeout=25.0,
            headers={"User-Agent": ua},
        )
        self._lock = asyncio.Lock()
        self._last_mono = 0.0

    async def aclose(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    async def _wait_rate_limit(self) -> None:
        """MediaWiki への最小間隔だけロックし、HTTP 待ちはロックしない。"""
        async with self._lock:
            now = time.monotonic()
            wait = max(0.0, MIN_INTERVAL - (now - self._last_mono))
            if wait:
                await asyncio.sleep(wait)
            self._last_mono = time.monotonic()

    async def _get_json(self, params: dict[str, Any]) -> Any:
        for attempt in range(MAX_ATTEMPTS):
            await self._wait_rate_limit()
            try:
                r = await self.client.get(WIKI_API, params=params)
            except httpx.RequestError:
                if attempt >= MAX_ATTEMPTS - 1:
                    raise
                await asyncio.sleep(_backoff_seconds(attempt))
                continue

            if r.status_code in (429, 503, 504):
                if attempt >= MAX_ATTEMPTS - 1:
                    r.raise_for_status()
                await asyncio.sleep(_backoff_seconds(attempt))
                continue

            try:
                r.raise_for_status()
            except httpx.HTTPStatusError:
                raise

            try:
                return r.json()
            except ValueError:
                if attempt >= MAX_ATTEMPTS - 1:
                    raise
                await asyncio.sleep(_backoff_seconds(attempt))
                continue

        raise RuntimeError("_get_json: exhausted attempts")

    async def search_people(self, query: str) -> list[dict[str, Any]]:
        q = str(query or "").strip()
        if not q:
            return []

        async def run(use_title_what: bool) -> Any:
            p: dict[str, Any] = {
                "action": "query",
                "list": "search",
                "srsearch": q,
                "format": "json",
                "utf8": 1,
                "srlimit": 20,
            }
            if use_title_what:
                p["srwhat"] = "title"
            return await self._get_json(p)

        data = await run(True)
        if (
            isinstance(data, dict)
            and (data.get("error") or {}).get("code") == "search-title-disabled"
        ):
            data = await run(False)
        if isinstance(data, dict) and data.get("error"):
            e = data["error"]
            raise RuntimeError(
                f"wikiSearchPeople: {e.get('code')} {e.get('info', '')}".strip()
            )
        items = (
            (((data or {}).get("query") or {}).get("search") or [])
            if isinstance(data, dict)
            else []
        )
        return [
            {
                "title": i.get("title"),
                "pageid": int(i.get("pageid")),
                "snippet": i.get("snippet"),
            }
            for i in items
            if i.get("title") is not None and i.get("pageid") is not None
        ]

    async def fetch_disambiguation_page_ids_by_titles(
        self, titles: list[str]
    ) -> set[int]:
        dab: set[int] = set()
        chunk_size = 45
        for i in range(0, len(titles), chunk_size):
            chunk = [
                str(x or "").strip()
                for x in titles[i : i + chunk_size]
                if str(x or "").strip()
            ]
            if not chunk:
                continue
            data = await self._get_json(
                {
                    "action": "query",
                    "format": "json",
                    "prop": "pageprops",
                    "ppprop": "disambiguation",
                    "titles": "|".join(chunk),
                    "redirects": 1,
                    "utf8": 1,
                }
            )
            pages = ((data or {}).get("query") or {}).get("pages") or {}
            for p in pages.values():
                if not isinstance(p, dict) or p.get("invalid") is not None:
                    continue
                pp = p.get("pageprops") or {}
                if "disambiguation" in pp:
                    pid = int(p.get("pageid") or 0)
                    if pid:
                        dab.add(pid)
        return dab

    async def lookup_exact_title(self, title: str) -> dict[str, Any] | None:
        t = str(title or "").strip()
        if not t:
            return None
        data = await self._get_json(
            {
                "action": "query",
                "format": "json",
                "titles": t,
                "redirects": 1,
                "utf8": 1,
            }
        )
        pages = ((data or {}).get("query") or {}).get("pages") or {}
        # pages は pageid キーの dict。単一 titles= でもキーは複数になり得るが、通常は 1 件。先頭を代表として採用する。
        first = next(iter(pages.values()), None)
        if not isinstance(first, dict) or first.get("invalid") or first.get("missing"):
            return None
        pageid = int(first.get("pageid") or 0)
        out_title = str(first.get("title") or t)
        if not pageid or not out_title:
            return None
        return {"title": out_title, "pageid": pageid}

    async def fetch_extract_text_by_title(self, title: str) -> str:
        data = await self._get_json(
            {
                "action": "query",
                "format": "json",
                "prop": "extracts",
                "explaintext": 1,
                "exsectionformat": "plain",
                "redirects": 1,
                "utf8": 1,
                "titles": title,
            }
        )
        pages = ((data or {}).get("query") or {}).get("pages") or {}
        first = next(iter(pages.values()), None)
        raw = (first or {}).get("extract") or "" if isinstance(first, dict) else ""
        return strip_wiki_noise_sections_from_extract_plain(str(raw))

    async def fetch_parse_plain_text_by_title(self, title: str) -> str:
        data = await self._get_json(
            {
                "action": "parse",
                "format": "json",
                "prop": "text",
                "redirects": 1,
                "utf8": 1,
                "page": title,
            }
        )
        html = str((((data or {}).get("parse") or {}).get("text") or {}).get("*") or "")
        return strip_html_to_plain_text(
            strip_wiki_noise_sections_from_parsed_html(html)
        )

    async def fetch_wikitext_by_title(self, title: str) -> str:
        data = await self._get_json(
            {
                "action": "parse",
                "format": "json",
                "prop": "wikitext",
                "redirects": 1,
                "utf8": 1,
                "page": title,
            }
        )
        return str(
            (((data or {}).get("parse") or {}).get("wikitext") or {}).get("*") or ""
        )

    async def fetch_canonical_title(self, title: str) -> str:
        data = await self._get_json(
            {
                "action": "query",
                "format": "json",
                "titles": title,
                "redirects": 1,
                "prop": "info",
                "utf8": 1,
            }
        )
        pages = ((data or {}).get("query") or {}).get("pages") or {}
        first = next(iter(pages.values()), None)
        if not isinstance(first, dict) or first.get("invalid"):
            raise RuntimeError("fetch_canonical_title: invalid title")
        if first.get("missing"):
            raise RuntimeError("fetch_canonical_title: missing page")
        return str(first.get("title") or title)

    def _parse_resolution_chunk(self, chunk: list[str], data: Any) -> dict[str, str]:
        q = (data or {}).get("query") or {}
        raw_norm = q.get("normalized") or []
        raw_red = q.get("redirects") or []
        normalized = [x for x in raw_norm if isinstance(x, dict)]
        redirects = [x for x in raw_red if isinstance(x, dict)]

        def apply_normalized_steps(t: str) -> str:
            cur = t
            for _ in range(10):
                nxt = cur
                for n in normalized:
                    if cur == str(n.get("from") or ""):
                        nxt = str(n.get("to") or cur)
                        break
                if nxt == cur:
                    break
                cur = nxt
            return cur

        red_map: dict[str, str] = {}
        for r in redirects:
            f = r.get("from")
            if f:
                red_map[str(f)] = str(r.get("to") or "")

        def follow_redirects(t: str) -> str:
            cur = t
            seen: set[str] = set()
            for _ in range(30):
                nxt = red_map.get(cur)
                if not nxt or cur in seen:
                    break
                seen.add(cur)
                cur = nxt
            return cur

        out: dict[str, str] = {}
        for orig in chunk:
            s = str(orig or "").strip()
            if not s:
                continue
            t = apply_normalized_steps(s)
            t = follow_redirects(t)
            out[orig] = t
        return out

    async def resolve_canonical_titles_for_titles(
        self, titles: list[str]
    ) -> dict[str, str]:
        uniq: list[str] = []
        seen: set[str] = set()
        for t in titles:
            s = str(t or "").strip()
            if not s or s in seen:
                continue
            seen.add(s)
            uniq.append(s)
        out: dict[str, str] = {}
        chunk_size = 45
        for i in range(0, len(uniq), chunk_size):
            chunk = uniq[i : i + chunk_size]
            try:
                data = await self._get_json(
                    {
                        "action": "query",
                        "format": "json",
                        "titles": "|".join(chunk),
                        "redirects": 1,
                        "utf8": 1,
                    }
                )
                part = self._parse_resolution_chunk(chunk, data)
                out.update(part)
            except (httpx.RequestError, httpx.HTTPStatusError, ValueError):
                continue
        for t in uniq:
            out.setdefault(t, t)
        return out

    async def fetch_redirect_titles(self, title: str) -> list[str]:
        data = await self._get_json(
            {
                "action": "query",
                "format": "json",
                "titles": title,
                "prop": "redirects",
                "rdlimit": "max",
                "utf8": 1,
            }
        )
        pages = ((data or {}).get("query") or {}).get("pages") or {}
        first = next(iter(pages.values()), None)
        reds = (first or {}).get("redirects") or [] if isinstance(first, dict) else []
        out = [str(r.get("title")) for r in reds if r.get("title")]
        return list(dict.fromkeys(out))

    async def fetch_parse_ns0_link_title_set(self, page_title: str) -> set[str]:
        data = await self._get_json(
            {
                "action": "parse",
                "format": "json",
                "prop": "text",
                "redirects": 1,
                "utf8": 1,
                "page": page_title,
            }
        )
        html_raw = str(
            (((data or {}).get("parse") or {}).get("text") or {}).get("*") or ""
        )
        html = strip_wiki_noise_sections_from_parsed_html(html_raw)
        return collect_ns0_wiki_titles_from_html(html)

    async def fetch_hatnote_ns0_link_sets(
        self, page_title: str
    ) -> tuple[set[str], set[str]]:
        data = await self._get_json(
            {
                "action": "parse",
                "format": "json",
                "prop": "text",
                "redirects": 1,
                "utf8": 1,
                "page": page_title,
            }
        )
        html_raw = str(
            (((data or {}).get("parse") or {}).get("text") or {}).get("*") or ""
        )
        html = strip_wiki_noise_sections_from_parsed_html(html_raw)

        soup = BeautifulSoup(html, "lxml")
        in_notes: set[str] = set()
        for el in soup.find_all(("div", "table")):
            cls = el.get("class") or []
            if isinstance(cls, str):
                cls_list = [cls]
            else:
                cls_list = list(cls)
            if not _HATNOTE_BLOCK_CLASSES.intersection(cls_list):
                continue
            for a in el.find_all("a", href=True):
                href = str(a["href"])
                if not href.startswith("/wiki/"):
                    continue
                path = href[len("/wiki/") :]
                q_idx = path.find("?")
                path_only = path[:q_idx] if q_idx >= 0 else path
                hash_idx = path_only.find("#")
                encoded = path_only[:hash_idx] if hash_idx >= 0 else path_only
                fragment = path_only[hash_idx + 1 :] if hash_idx >= 0 else ""
                if fragment and is_noise_wiki_section_fragment(fragment):
                    continue
                if not encoded:
                    continue
                tit = normalize_wiki_link_title(encoded)
                if not tit or title_has_non_main_namespace_prefix(tit):
                    continue
                in_notes.add(tit)

        all_t = collect_ns0_wiki_titles_from_html(html)
        out_of = {t for t in all_t if t not in in_notes}
        return in_notes, out_of
