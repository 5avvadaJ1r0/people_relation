from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app import crud
from app.worker.relation_extract import _default_sleep_seconds
from app.db import SessionLocal
from app.model import Person
from app.schemas import PersonIn, RelationIn
from app.services.related_search import build_relation_payload_from_extract


def test_build_relation_payload_merges_duplicate_edges() -> None:
    master = {
        "name": "主",
        "title": "主題",
        "url": "https://ja.wikipedia.org/wiki/%E4%B8%BB",
    }
    slave = {
        "name": "従",
        "title": "従題",
        "url": "https://ja.wikipedia.org/wiki/%E5%BE%93",
    }
    relations = [
        {
            "slave": slave,
            "forwardPoint": 2,
            "reversePoint": 1,
            "totalPoint": 3,
            "hasWikiPage": True,
        }
    ]
    payload = build_relation_payload_from_extract(master, relations)
    assert len(payload) == 2
    fwd = next(p for p in payload if p.master.url == master["url"])
    rev = next(p for p in payload if p.master.url == slave["url"])
    assert fwd.point == 2
    assert rev.point == 1


def test_build_relation_payload_aggregates_same_key() -> None:
    master = PersonIn(name="M", title="MT", url="https://example.com/m")
    slave = PersonIn(name="S", title="ST", url="https://example.com/s")
    raw = [
        RelationIn(master=master, slave=slave, point=1),
        RelationIn(master=master, slave=slave, point=2),
    ]
    agg: dict[str, RelationIn] = {}
    for item in raw:
        key = f"{item.master.url}||{item.slave.url}"
        prev = agg.get(key)
        if prev is None:
            agg[key] = item
        else:
            prev.point += item.point
    assert len(agg) == 1
    assert agg[f"{master.url}||{slave.url}"].point == 3


def test_default_sleep_seconds_without_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RELATION_EXTRACT_SLEEP_SECONDS", raising=False)
    assert _default_sleep_seconds() == 10.0


def test_default_sleep_seconds_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RELATION_EXTRACT_SLEEP_SECONDS", "30")
    assert _default_sleep_seconds() == 30.0


def test_default_sleep_seconds_invalid_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RELATION_EXTRACT_SLEEP_SECONDS", "not-a-number")
    with pytest.raises(ValueError, match="invalid RELATION_EXTRACT_SLEEP_SECONDS"):
        _default_sleep_seconds()


def test_pick_random_person_not_executed_as_master() -> None:
    db: Session = SessionLocal()
    try:
        db.add(
            Person(
                name="未実行A",
                title="未実行A題",
                url="https://example.com/not-exec-a",
                executed_as_master=False,
            )
        )
        db.add(
            Person(
                name="実行済",
                title="実行済題",
                url="https://example.com/exec",
                executed_as_master=True,
            )
        )
        db.commit()

        picked = crud.pick_random_person_not_executed_as_master(db)
        assert picked is not None
        assert picked.executed_as_master is False
        assert picked.url == "https://example.com/not-exec-a"
    finally:
        db.close()
