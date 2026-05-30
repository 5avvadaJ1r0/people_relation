from __future__ import annotations

from app.crud.diagram import aggregate_core_network_edges
from app.crud.person import (
    get_person,
    get_person_by_url,
    get_wiki_human_cache,
    list_persons_by_ids,
    list_persons_executed_masters_by_urls,
    list_wiki_human_cache_by_urls,
    mark_executed_as_master_by_url,
    normalize_url,
    pick_random_person_not_executed_as_master,
    search_persons,
    search_persons_executed_as_master,
    upsert_person,
    upsert_wiki_human_cache,
    wiki_ja_article_url,
)
from app.crud.relation import (
    delete_relations_where_master,
    delete_reverse_edges_to_master_from_given_masters,
    get_relation_aggregates_for_master,
    get_relations_for_master,
    list_slave_person_ids_for_master,
    person_ids_with_forward_relation,
    upsert_relation,
)

__all__ = [
    "aggregate_core_network_edges",
    "delete_relations_where_master",
    "delete_reverse_edges_to_master_from_given_masters",
    "get_person",
    "get_person_by_url",
    "get_relation_aggregates_for_master",
    "get_relations_for_master",
    "list_persons_by_ids",
    "list_persons_executed_masters_by_urls",
    "list_slave_person_ids_for_master",
    "person_ids_with_forward_relation",
    "get_wiki_human_cache",
    "list_wiki_human_cache_by_urls",
    "mark_executed_as_master_by_url",
    "normalize_url",
    "pick_random_person_not_executed_as_master",
    "search_persons",
    "search_persons_executed_as_master",
    "upsert_person",
    "upsert_relation",
    "upsert_wiki_human_cache",
    "wiki_ja_article_url",
]
