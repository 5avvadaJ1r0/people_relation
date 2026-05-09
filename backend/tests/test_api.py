from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_api_health(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_person_search_empty(client: TestClient) -> None:
    r = client.get("/api/v1/person/search", params={"name": "存在しない名前"})
    assert r.status_code == 200
    assert r.json() == []


def test_person_search_validation(client: TestClient) -> None:
    r = client.get("/api/v1/person/search", params={"name": ""})
    assert r.status_code == 422


def test_person_relations_not_found(client: TestClient) -> None:
    r = client.get("/api/v1/person/99999/relations")
    assert r.status_code == 404


def test_person_relations_aggregate_not_found(client: TestClient) -> None:
    r = client.get("/api/v1/person/99999/relations_aggregate")
    assert r.status_code == 404


def test_post_relation_and_person_endpoints(client: TestClient) -> None:
    payload = [
        {
            "master": {"name": "甲", "url": "https://example.com/a", "title": "甲タイトル"},
            "slave": {"name": "乙", "url": "https://example.com/b", "title": "乙タイトル"},
            "point": 3,
        },
        {
            "master": {"name": "乙", "url": "https://example.com/b", "title": "乙タイトル"},
            "slave": {"name": "甲", "url": "https://example.com/a", "title": "甲タイトル"},
            "point": 2,
        },
    ]
    r = client.post("/api/v1/relation", json=payload, params={"executed_master_url": "https://example.com/a"})
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 2
    assert body[0]["point"] == 3
    master_id = body[0]["master"]["id"]

    r_search = client.get("/api/v1/person/search", params={"name": "甲"})
    assert r_search.status_code == 200
    found = r_search.json()
    assert len(found) >= 1
    assert any(p["id"] == master_id and p["has_relations"] is True for p in found)

    r_rel = client.get(f"/api/v1/person/{master_id}/relations")
    assert r_rel.status_code == 200
    rels = r_rel.json()
    assert len(rels) == 1
    assert rels[0]["point"] == 3
    assert rels[0]["slave"]["name"] == "乙"

    r_agg = client.get(f"/api/v1/person/{master_id}/relations_aggregate")
    assert r_agg.status_code == 200
    agg = r_agg.json()
    assert len(agg) == 1
    assert agg[0]["total_point"] == 5
    assert agg[0]["forward_point"] == 3
    assert agg[0]["reverse_point"] == 2


def test_post_relation_without_executed_master_url(client: TestClient) -> None:
    payload = [
        {
            "master": {"name": "丙", "url": "https://example.com/c", "title": "丙"},
            "slave": {"name": "丁", "url": "https://example.com/d", "title": "丁"},
            "point": 1,
        },
    ]
    r = client.post("/api/v1/relation", json=payload)
    assert r.status_code == 200

    r_search = client.get("/api/v1/person/search", params={"name": "丙"})
    assert r_search.status_code == 200
    found = r_search.json()
    assert len(found) == 1
    assert found[0]["has_relations"] is False


def test_wiki_is_human(client: TestClient, mock_wiki_is_human: None) -> None:
    r = client.get("/api/v1/wiki/is_human", params={"title": "テスト人物"})
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "テスト人物"
    assert data["qid"] == "Q123"
    assert data["is_human"] is True
    assert data["source"] == "test"


def test_wiki_is_human_validation(client: TestClient, mock_wiki_is_human: None) -> None:
    r = client.get("/api/v1/wiki/is_human", params={"title": ""})
    assert r.status_code == 422
