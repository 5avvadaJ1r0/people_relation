"""主体記事（master）の各種情報取得と、候補行の参照 href の補完。"""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import quote

from app.services.wiki.api.ja_mediawiki import JaWikipediaClient
from app.services.wiki.extract.two_hop.models import (
    ForwardCandidate,
    MasterArticleContext,
)
from app.services.wiki.extract.two_hop.quota import quota_gather
from app.services.wiki.parser.encoding_utils import normalize_wiki_link_title

log = logging.getLogger(__name__)


async def load_master_article_context(
    wiki: JaWikipediaClient,
    *,
    master_title: str,
    master_name: str,
) -> MasterArticleContext:
    async def safe_canonical() -> str:
        try:
            return await wiki.fetch_canonical_title(master_title)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.debug(
                "fetch canonical_title failed; using master_title=%s",
                master_title,
                exc_info=True,
            )
            return master_title

    async def safe_parse_links() -> set[str]:
        try:
            return await wiki.fetch_parse_ns0_link_title_set(master_title)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.debug("fetch parse links failed master=%s", master_title, exc_info=True)
            return set()

    async def safe_hatnote() -> tuple[set[str], set[str]]:
        try:
            return await wiki.fetch_hatnote_ns0_link_sets(master_title)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.debug("fetch hatnote failed master=%s", master_title, exc_info=True)
            return set(), set()

    async def safe_html_plain() -> str:
        try:
            return await wiki.fetch_parse_plain_text_by_title(master_title)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.debug(
                "fetch parse plain text failed master=%s", master_title, exc_info=True
            )
            return ""

    (
        extract_text,
        wikitext,
        canonical_title,
        master_parse_links,
        hat_tuple,
        master_html_text_raw,
    ) = await quota_gather(
        lambda: wiki.fetch_extract_text_by_title(master_title),
        lambda: wiki.fetch_wikitext_by_title(master_title),
        lambda: safe_canonical(),
        lambda: safe_parse_links(),
        lambda: safe_hatnote(),
        lambda: safe_html_plain(),
    )
    hat_in, hat_out = hat_tuple

    master_parse_link_norms: set[str] = set()
    for t in master_parse_links:
        n = normalize_wiki_link_title(t)
        if n:
            master_parse_link_norms.add(n)

    async def safe_redirects() -> list[str]:
        try:
            return await wiki.fetch_redirect_titles(canonical_title)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.debug(
                "fetch_redirect_titles failed canonical=%s",
                canonical_title,
                exc_info=True,
            )
            return []

    (master_redirects,) = await quota_gather(lambda: safe_redirects())

    master_link_exclude_norms: set[str] = set()
    for s in [master_title, master_name, canonical_title, *master_redirects]:
        n = normalize_wiki_link_title(s)
        if n:
            master_link_exclude_norms.add(n)

    return MasterArticleContext(
        extract_text=str(extract_text or ""),
        wikitext=str(wikitext or ""),
        canonical_title=canonical_title,
        master_parse_links=master_parse_links,
        hat_in=hat_in,
        hat_out=hat_out,
        master_html_text_raw=str(master_html_text_raw or ""),
        master_redirects=master_redirects,
        master_parse_link_norms=master_parse_link_norms,
        master_link_exclude_norms=master_link_exclude_norms,
    )


async def resolve_missing_hrefs(
    wiki: JaWikipediaClient,
    *,
    ranked: list[ForwardCandidate],
) -> None:
    no_href = [r for r in ranked if not r.get("href")][:40]
    if not no_href:
        return

    batch_size = 5
    for i in range(0, len(no_href), batch_size):
        batch = no_href[i : i + batch_size]

        async def resolve_one(r: ForwardCandidate) -> None:
            try:
                hit = await wiki.lookup_exact_title(str(r.get("name") or ""))
                if hit:
                    r["title"] = hit["title"]
                    r["href"] = "/wiki/" + quote(
                        str(hit["title"]).strip().replace(" ", "_"), safe="-_.!~*'()"
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning(
                    "lookup_exact_title failed name=%s", r.get("name"), exc_info=True
                )

        await quota_gather(*(lambda r=r: resolve_one(r) for r in batch))
