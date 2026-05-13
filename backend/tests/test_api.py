from __future__ import annotations

from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_api_health(client: TestClient) -> None:
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_ready(client: TestClient) -> None:
    r = client.get("/api/v1/ready")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "db": True}


def test_api_ready(client: TestClient) -> None:
    r = client.get("/api/v1/ready")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "db": True}


def test_api_v1_ready(client: TestClient) -> None:
    r = client.get("/api/v1/ready")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "db": True}


def test_person_search_empty(client: TestClient) -> None:
    r = client.get("/api/v1/person/search", params={"name": "存在しない名前"})
    assert r.status_code == 200
    assert r.json() == []


def test_person_search_validation(client: TestClient) -> None:
    r = client.get("/api/v1/person/search", params={"name": ""})
    assert r.status_code == 422


def test_person_search_executed_masters_empty(client: TestClient) -> None:
    r = client.get(
        "/api/v1/person/search_executed_masters",
        params={"name": "存在しない名前"},
    )
    assert r.status_code == 200
    assert r.json() == []


def test_person_search_executed_masters_validation(client: TestClient) -> None:
    r = client.get("/api/v1/person/search_executed_masters", params={"name": ""})
    assert r.status_code == 422


def test_diagram_core_network_validation(client: TestClient) -> None:
    r = client.post("/api/v1/diagram/core_network", json={"center_titles": ["a"]})
    assert r.status_code == 422


def test_diagram_core_network_returns_pairs(client: TestClient) -> None:
    payload = [
        {
            "master": {
                "name": "図甲",
                "url": "https://example.com/diagram-a",
                "title": "図甲タイトル",
            },
            "slave": {
                "name": "図乙",
                "url": "https://example.com/diagram-b",
                "title": "図乙タイトル",
            },
            "point": 3,
        },
        {
            "master": {
                "name": "図乙",
                "url": "https://example.com/diagram-b",
                "title": "図乙タイトル",
            },
            "slave": {
                "name": "図甲",
                "url": "https://example.com/diagram-a",
                "title": "図甲タイトル",
            },
            "point": 2,
        },
    ]
    r = client.post(
        "/api/v1/relation",
        json=payload,
        params={"executed_master_url": "https://example.com/diagram-a"},
    )
    assert r.status_code == 200

    r2 = client.post(
        "/api/v1/diagram/core_network",
        json={"center_titles": ["図甲タイトル", "図乙タイトル"]},
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["center_titles"] == ["図甲タイトル", "図乙タイトル"]
    pairs = body["pairs"]
    assert len(pairs) == 1
    assert pairs[0]["total_point"] == 5

    r3 = client.post(
        "/api/v1/diagram/core_network",
        json={"center_titles": ["図甲タイトル", "図乙タイトル"], "total_point_gt": 5},
    )
    assert r3.status_code == 200
    assert r3.json()["pairs"] == []

    r4 = client.post(
        "/api/v1/diagram/core_network",
        json={"center_titles": ["図甲タイトル", "図乙タイトル"], "total_point_gt": 4},
    )
    assert r4.status_code == 200
    assert len(r4.json()["pairs"]) == 1


def test_person_relations_not_found(client: TestClient) -> None:
    r = client.get("/api/v1/person/99999/relations")
    assert r.status_code == 404


def test_person_relations_aggregate_not_found(client: TestClient) -> None:
    r = client.get("/api/v1/person/99999/relations_aggregate")
    assert r.status_code == 404


def test_post_relation_and_person_endpoints(client: TestClient) -> None:
    payload = [
        {
            "master": {
                "name": "甲",
                "url": "https://example.com/a",
                "title": "甲タイトル",
            },
            "slave": {
                "name": "乙",
                "url": "https://example.com/b",
                "title": "乙タイトル",
            },
            "point": 3,
        },
        {
            "master": {
                "name": "乙",
                "url": "https://example.com/b",
                "title": "乙タイトル",
            },
            "slave": {
                "name": "甲",
                "url": "https://example.com/a",
                "title": "甲タイトル",
            },
            "point": 2,
        },
    ]
    r = client.post(
        "/api/v1/relation",
        json=payload,
        params={"executed_master_url": "https://example.com/a"},
    )
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


def test_post_relation_replaces_edges_when_executed_master_url(
    client: TestClient,
) -> None:
    """同一 executed_master_url で再 POST すると、当該主体の forward と関連 reverse が付け替わる。"""
    url_a = "https://example.com/replace-master"
    url_b = "https://example.com/replace-b"
    url_c = "https://example.com/replace-c"
    first = [
        {
            "master": {"name": "替甲", "url": url_a, "title": "替甲"},
            "slave": {"name": "替乙", "url": url_b, "title": "替乙"},
            "point": 9,
        },
        {
            "master": {"name": "替乙", "url": url_b, "title": "替乙"},
            "slave": {"name": "替甲", "url": url_a, "title": "替甲"},
            "point": 7,
        },
    ]
    r1 = client.post(
        "/api/v1/relation",
        json=first,
        params={"executed_master_url": url_a},
    )
    assert r1.status_code == 200
    master_id = r1.json()[0]["master"]["id"]

    second = [
        {
            "master": {"name": "替甲", "url": url_a, "title": "替甲"},
            "slave": {"name": "替丙", "url": url_c, "title": "替丙"},
            "point": 4,
        },
        {
            "master": {"name": "替丙", "url": url_c, "title": "替丙"},
            "slave": {"name": "替甲", "url": url_a, "title": "替甲"},
            "point": 3,
        },
    ]
    r2 = client.post(
        "/api/v1/relation",
        json=second,
        params={"executed_master_url": url_a},
    )
    assert r2.status_code == 200

    r_rel = client.get(f"/api/v1/person/{master_id}/relations")
    assert r_rel.status_code == 200
    rels = r_rel.json()
    assert len(rels) == 1
    assert rels[0]["slave"]["url"] == url_c
    assert rels[0]["point"] == 4

    r_agg = client.get(f"/api/v1/person/{master_id}/relations_aggregate")
    assert r_agg.status_code == 200
    agg = r_agg.json()
    assert len(agg) == 1
    assert agg[0]["slave"]["url"] == url_c
    assert agg[0]["total_point"] == 7


def test_person_search_slave_only_has_relations_false(
    client: TestClient,
) -> None:
    """関連者としてだけ登録された person は has_relations が false（キャッシュ表示対象外）。"""
    url_master = "https://example.com/cache-spec-master"
    url_slave = "https://example.com/cache-spec-slave"
    payload = [
        {
            "master": {"name": "主M", "url": url_master, "title": "主M"},
            "slave": {"name": "従S", "url": url_slave, "title": "従S"},
            "point": 2,
        },
    ]
    r = client.post(
        "/api/v1/relation",
        json=payload,
        params={"executed_master_url": url_master},
    )
    assert r.status_code == 200
    body = r.json()
    slave_id = next(x["slave"]["id"] for x in body if x["slave"]["url"] == url_slave)

    r_search = client.get("/api/v1/person/search", params={"name": "従S"})
    assert r_search.status_code == 200
    rows = r_search.json()
    slave_row = next(x for x in rows if x["id"] == slave_id)
    assert slave_row["has_relations"] is False


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
