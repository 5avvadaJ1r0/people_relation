from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from app.db import SessionLocal
from app.model import Person
from app.services.person_name_search import normalize_person_name_for_search


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("ミック・ジャガー", "ミックジャガー"),
        ("ミック ジャガー", "ミックジャガー"),
        ("ミック-ジャガー", "ミックジャガー"),
        ("  A　B  ", "ab"),
    ],
)
def test_normalize_person_name_for_search(raw: str, expected: str) -> None:
    assert normalize_person_name_for_search(raw) == expected


def test_person_search_matches_without_middle_dot(client: TestClient) -> None:
    url = "https://example.com/person-search-norm-dot"
    db = SessionLocal()
    try:
        db.add(
            Person(
                name="表示名ミック・ジャガー",
                title="ミック・ジャガー",
                url=url,
                executed_as_master=True,
                executed_as_master_at=datetime(2026, 6, 1, 12, 0, 0),
            )
        )
        db.commit()
    finally:
        db.close()

    r = client.get("/api/v1/person/search", params={"name": "ミックジャガー"})
    assert r.status_code == 200
    rows = [x for x in r.json() if x["url"] == url]
    assert len(rows) == 1


def test_person_search_executed_masters_matches_title_only_spacing(
    client: TestClient,
) -> None:
    url = "https://example.com/person-search-norm-title"
    db = SessionLocal()
    try:
        db.add(
            Person(
                name="別表記",
                title="山田 太郎",
                url=url,
                executed_as_master=True,
                executed_as_master_at=datetime(2026, 6, 1, 12, 0, 0),
            )
        )
        db.commit()
    finally:
        db.close()

    r = client.get(
        "/api/v1/person/search_executed_masters",
        params={"name": "山田太郎"},
    )
    assert r.status_code == 200
    rows = [x for x in r.json() if x["url"] == url]
    assert len(rows) == 1


def test_person_search_empty_after_strip(client: TestClient) -> None:
    r = client.get("/api/v1/person/search", params={"name": "・　-"})
    assert r.status_code == 200
    assert r.json() == []
