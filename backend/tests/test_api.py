from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.crud.person import wiki_ja_article_url
from app.db import engine


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


def test_resolve_wiki_masters_returns_master_by_article_url(client: TestClient) -> None:
    """記事タイトルから組み立てた URL と一致する主体者のみ resolve が返す。"""
    title = "ResolveWikiMasterApiX"
    url_master = wiki_ja_article_url(title)
    payload = [
        {
            "master": {"name": "R主", "url": url_master, "title": title},
            "slave": {
                "name": "R従",
                "url": "https://example.com/r-slave",
                "title": "R従T",
            },
            "point": 1,
        },
    ]
    r = client.post(
        "/api/v1/relation",
        json=payload,
        params={"executed_master_url": url_master},
    )
    assert r.status_code == 200

    r2 = client.post(
        "/api/v1/person/resolve_wiki_masters",
        json={"items": [{"title": title, "pageid": 999001}]},
    )
    assert r2.status_code == 200
    body = r2.json()
    assert len(body["items"]) == 1
    row = body["items"][0]
    assert row["pageid"] == 999001
    assert row["person"] is not None
    assert row["person"]["url"] == url_master
    assert row["person"]["has_relations"] is True
    assert row["person"]["is_executed_master"] is True


def test_diagram_core_network_validation_empty(client: TestClient) -> None:
    r = client.post("/api/v1/diagram/core_network", json={"center_titles": []})
    assert r.status_code == 422


def test_diagram_core_network_single_center(client: TestClient) -> None:
    r = client.post(
        "/api/v1/diagram/core_network",
        json={"center_titles": ["図甲タイトル"]},
    )
    assert r.status_code == 200
    assert r.json()["center_titles"] == ["図甲タイトル"]


def test_diagram_core_network_validation_too_many_centers(client: TestClient) -> None:
    titles = [f"t{i}" for i in range(11)]
    r = client.post("/api/v1/diagram/core_network", json={"center_titles": titles})
    assert r.status_code == 422


def test_diagram_core_network_validation_collapses_to_single_title(
    client: TestClient,
) -> None:
    r = client.post(
        "/api/v1/diagram/core_network",
        json={"center_titles": ["only", " only ", "only"]},
    )
    assert r.status_code == 200
    assert r.json()["center_titles"] == ["only"]


def test_diagram_core_network_validation_total_point_gt_negative(
    client: TestClient,
) -> None:
    r = client.post(
        "/api/v1/diagram/core_network",
        json={
            "center_titles": ["x", "y"],
            "total_point_gt": -1,
        },
    )
    assert r.status_code == 422


def test_person_search_executed_masters_excludes_at_only(
    client: TestClient,
) -> None:
    """`executed_as_master_at` のみの行は無効（`executed_as_master` を優先）。"""
    from datetime import datetime

    from app.db import SessionLocal
    from app.model import Person

    url = "https://example.com/exem-at-only-master"
    db = SessionLocal()
    try:
        db.add(
            Person(
                name="佐藤未実行扱い",
                title="佐藤未実行扱い",
                url=url,
                executed_as_master=False,
                executed_as_master_at=datetime(2026, 5, 17, 8, 0, 0),
            )
        )
        db.commit()
    finally:
        db.close()

    r_search = client.get(
        "/api/v1/person/search_executed_masters",
        params={"name": "佐藤未実行"},
    )
    assert r_search.status_code == 200
    assert r_search.json() == []

    r_person = client.get(
        "/api/v1/person/search",
        params={"name": "佐藤未実行"},
    )
    assert r_person.status_code == 200
    row = next(x for x in r_person.json() if x["url"] == url)
    assert row["is_executed_master"] is False
    assert row["executed_as_master_at"] is not None


def test_person_search_executed_masters_finds_master_not_slave(
    client: TestClient,
) -> None:
    """主体として実行済みの人物だけが search_executed_masters に含まれる。"""
    url_master = "https://example.com/exem-master-only"
    url_slave = "https://example.com/exem-slave-only"
    payload = [
        {
            "master": {"name": "Exe主", "url": url_master, "title": "Exe主T"},
            "slave": {"name": "Exe従", "url": url_slave, "title": "Exe従T"},
            "point": 1,
        },
    ]
    r = client.post(
        "/api/v1/relation",
        json=payload,
        params={"executed_master_url": url_master},
    )
    assert r.status_code == 200

    r_m = client.get(
        "/api/v1/person/search_executed_masters",
        params={"name": "Exe主"},
    )
    assert r_m.status_code == 200
    masters = r_m.json()
    assert len(masters) == 1
    assert masters[0]["url"] == url_master

    r_s = client.get(
        "/api/v1/person/search_executed_masters",
        params={"name": "Exe従"},
    )
    assert r_s.status_code == 200
    assert r_s.json() == []


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


def test_diagram_core_network_includes_related_to_related_edges(
    client: TestClient,
) -> None:
    """中心に触れる関連者同士の relation も、同じ total_point_gt で返す。"""
    payload = [
        {
            "master": {
                "name": "図丙",
                "url": "https://example.com/diagram-c",
                "title": "図丙タイトル",
            },
            "slave": {
                "name": "図丁",
                "url": "https://example.com/diagram-d",
                "title": "図丁タイトル",
            },
            "point": 4,
        },
        {
            "master": {
                "name": "図戊",
                "url": "https://example.com/diagram-e",
                "title": "図戊タイトル",
            },
            "slave": {
                "name": "図己",
                "url": "https://example.com/diagram-f",
                "title": "図己タイトル",
            },
            "point": 4,
        },
        {
            "master": {
                "name": "図丁",
                "url": "https://example.com/diagram-d",
                "title": "図丁タイトル",
            },
            "slave": {
                "name": "図己",
                "url": "https://example.com/diagram-f",
                "title": "図己タイトル",
            },
            "point": 3,
        },
    ]
    r = client.post(
        "/api/v1/relation",
        json=payload,
        params={"executed_master_url": "https://example.com/diagram-c"},
    )
    assert r.status_code == 200

    r2 = client.post(
        "/api/v1/diagram/core_network",
        json={"center_titles": ["図丙タイトル", "図戊タイトル"]},
    )
    assert r2.status_code == 200
    raw_pairs = r2.json()["pairs"]

    def total_between(t1: str, t2: str) -> int | None:
        for p in raw_pairs:
            if {p["person1"], p["person2"]} == {t1, t2}:
                return int(p["total_point"])
        return None

    assert total_between("図丁タイトル", "図己タイトル") == 3
    assert total_between("図丙タイトル", "図丁タイトル") == 4
    assert total_between("図戊タイトル", "図己タイトル") == 4

    r3 = client.post(
        "/api/v1/diagram/core_network",
        json={
            "center_titles": ["図丙タイトル", "図戊タイトル"],
            "total_point_gt": 3,
        },
    )
    assert r3.status_code == 200
    assert all(
        p["person1"] != "図丁タイトル" or p["person2"] != "図己タイトル"
        for p in r3.json()["pairs"]
    )


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
    master_row = next(p for p in found if p["id"] == master_id)
    assert master_row["has_relations"] is True
    assert master_row["is_executed_master"] is True

    r_rel = client.get(f"/api/v1/person/{master_id}/relations")
    assert r_rel.status_code == 200
    rels = r_rel.json()
    assert len(rels) == 1
    assert rels[0]["point"] == 3
    assert rels[0]["slave"]["name"] == "乙"
    assert rels[0]["master"]["has_relations"] is True
    assert rels[0]["master"]["is_executed_master"] is True
    assert rels[0]["slave"]["has_relations"] is True
    assert rels[0]["slave"]["is_executed_master"] is False

    r_agg = client.get(f"/api/v1/person/{master_id}/relations_aggregate")
    assert r_agg.status_code == 200
    agg = r_agg.json()
    assert len(agg) == 1
    assert agg[0]["total_point"] == 5
    assert agg[0]["forward_point"] == 3
    assert agg[0]["reverse_point"] == 2
    assert agg[0]["slave"]["has_relations"] is True
    assert agg[0]["slave"]["is_executed_master"] is False


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
    assert slave_row["is_executed_master"] is False


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
    assert found[0]["has_relations"] is True
    assert found[0]["is_executed_master"] is False


def test_resolve_wiki_masters_non_executed_returns_null(client: TestClient) -> None:
    """主体者フラグが立っていない人物は resolve の突合対象外。"""
    title = "NoExecWikiX"
    url = wiki_ja_article_url(title)
    r = client.post(
        "/api/v1/relation",
        json=[
            {
                "master": {"name": "N主", "url": url, "title": title},
                "slave": {
                    "name": "N従",
                    "url": "https://example.com/n-sl",
                    "title": "N従",
                },
                "point": 1,
            },
        ],
    )
    assert r.status_code == 200
    r2 = client.post(
        "/api/v1/person/resolve_wiki_masters",
        json={"items": [{"title": title, "pageid": 77001}]},
    )
    assert r2.status_code == 200
    row = r2.json()["items"][0]
    assert row["pageid"] == 77001
    assert row["person"] is None


def test_resolve_wiki_masters_duplicate_titles_same_person(client: TestClient) -> None:
    title = "DupTitleX"
    url = wiki_ja_article_url(title)
    client.post(
        "/api/v1/relation",
        json=[
            {
                "master": {"name": "D主", "url": url, "title": title},
                "slave": {
                    "name": "D従",
                    "url": "https://example.com/d-sl",
                    "title": "D従",
                },
                "point": 1,
            },
        ],
        params={"executed_master_url": url},
    )
    r = client.post(
        "/api/v1/person/resolve_wiki_masters",
        json={
            "items": [
                {"title": title, "pageid": 10},
                {"title": title, "pageid": 11},
            ],
        },
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 2
    assert items[0]["person"] is not None
    assert items[0]["person"]["id"] == items[1]["person"]["id"]


def test_resolve_wiki_masters_executed_but_no_forward_rows(
    client: TestClient,
) -> None:
    """フラグだけ残り relation が無いときは has_relations が false。"""
    title = "StaleExecX"
    url = wiki_ja_article_url(title)
    r = client.post(
        "/api/v1/relation",
        json=[
            {
                "master": {"name": "S主", "url": url, "title": title},
                "slave": {
                    "name": "S従",
                    "url": "https://example.com/s-sl",
                    "title": "S従",
                },
                "point": 1,
            },
        ],
        params={"executed_master_url": url},
    )
    assert r.status_code == 200
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM relation"))
    r2 = client.post(
        "/api/v1/person/resolve_wiki_masters",
        json={"items": [{"title": title, "pageid": 88001}]},
    )
    assert r2.status_code == 200
    person = r2.json()["items"][0]["person"]
    assert person is not None
    assert person["has_relations"] is False
    assert person["is_executed_master"] is True


def test_resolve_wiki_masters_empty_items_422(client: TestClient) -> None:
    r = client.post("/api/v1/person/resolve_wiki_masters", json={"items": []})
    assert r.status_code == 422


def test_resolve_wiki_masters_too_many_items_422(client: TestClient) -> None:
    items = [{"title": "T", "pageid": i} for i in range(51)]
    r = client.post("/api/v1/person/resolve_wiki_masters", json={"items": items})
    assert r.status_code == 422


def test_wiki_person_search_validation(client: TestClient) -> None:
    r = client.get("/api/v1/wiki/person_search", params={"q": ""})
    assert r.status_code == 422


def test_wiki_person_search_json(monkeypatch, client: TestClient) -> None:
    from app.api.v1 import wiki as wiki_router
    from app.services.wiki.extract.principal_search import WikiSearchItem

    async def fake_wiki_person_search(db, *, query: str):
        _ = db, query
        return (
            [WikiSearchItem(title="テスト太郎", pageid=42, snippet="…")],
            None,
        )

    monkeypatch.setattr(wiki_router, "wiki_person_search", fake_wiki_person_search)
    r = client.get("/api/v1/wiki/person_search", params={"q": "テスト"})
    assert r.status_code == 200
    body = r.json()
    assert body["wiki"] == [{"title": "テスト太郎", "pageid": 42, "snippet": "…"}]
    assert body["empty_message"] is None


def test_wiki_person_search_empty_message(monkeypatch, client: TestClient) -> None:
    from app.api.v1 import wiki as wiki_router

    async def fake_wiki_person_search(db, *, query: str):
        _ = db, query
        return ([], "該当人物はいません")

    monkeypatch.setattr(wiki_router, "wiki_person_search", fake_wiki_person_search)
    r = client.get("/api/v1/wiki/person_search", params={"q": "なし"})
    assert r.status_code == 200
    assert r.json() == {"wiki": [], "empty_message": "該当人物はいません"}
