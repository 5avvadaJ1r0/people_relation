from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.model import Person
from app.schemas import PersonIn, RelationIn
from app.services.relations import save_relations_batch
from app.services.wiki.api.ja_mediawiki import JaWikipediaClient
from app.services.wiki.extract.two_hop import extract_two_hop_relations

log = logging.getLogger(__name__)

DEFAULT_MAX_RELATED = 100


def build_relation_payload_from_extract(
    master: dict[str, Any],
    relations: list[dict[str, Any]],
) -> list[RelationIn]:
    """フロント `usePrincipalDetailPhase.extractFromWikipedia` と同じ RelationIn 集約。"""
    payload_raw: list[RelationIn] = []
    master_in = PersonIn(
        name=str(master["name"]),
        title=str(master.get("title") or master["name"]),
        url=str(master["url"]),
    )
    for row in relations:
        slave = row["slave"]
        slave_in = PersonIn(
            name=str(slave["name"]),
            title=str(slave.get("title") or slave["name"]),
            url=str(slave["url"]),
        )
        payload_raw.append(
            RelationIn(
                master=master_in,
                slave=slave_in,
                point=int(row["forwardPoint"]),
            )
        )
        reverse = int(row.get("reversePoint") or 0)
        if reverse > 0:
            payload_raw.append(
                RelationIn(master=slave_in, slave=master_in, point=reverse)
            )

    agg: dict[str, RelationIn] = {}
    for item in payload_raw:
        key = f"{item.master.url}||{item.slave.url}"
        prev = agg.get(key)
        if prev is None:
            agg[key] = item
        else:
            prev.point += item.point
    return list(agg.values())


async def run_related_search_for_wiki_title(
    db: Session,
    *,
    wiki_title: str,
    master_name: str | None = None,
    max_related: int = DEFAULT_MAX_RELATED,
) -> dict[str, Any]:
    """
    画面の「関連者を探す」（Wikipedia 抽出 + POST /relation 相当）を 1 回実行する。
    戻り値は extract 結果（master / relations）に saved_count を付与した dict。
    """
    name = (master_name or wiki_title).strip()
    title = wiki_title.strip()
    wiki = JaWikipediaClient()
    try:
        out = await extract_two_hop_relations(
            wiki,
            master_title=title,
            master_name=name,
            max_related=max_related,
            db=db,
        )
    finally:
        await wiki.aclose()

    master = out["master"]
    relations: list[dict[str, Any]] = out["relations"]
    payload = build_relation_payload_from_extract(master, relations)
    saved = save_relations_batch(db, payload, executed_master_url=str(master["url"]))
    log.info(
        "related_search saved wiki_title=%s relations=%s payload_edges=%s",
        title,
        len(relations),
        len(saved),
    )
    return {
        "master": master,
        "relations": relations,
        "saved_count": len(saved),
    }


async def run_related_search_for_person(
    db: Session,
    person: Person,
    *,
    max_related: int = DEFAULT_MAX_RELATED,
) -> dict[str, Any]:
    """DB 上の Person を主体に `run_related_search_for_wiki_title` を実行する。"""
    return await run_related_search_for_wiki_title(
        db,
        wiki_title=person.title,
        master_name=person.name,
        max_related=max_related,
    )
