from __future__ import annotations

from collections.abc import Iterator
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

# app / settings を import する前にテスト用 URL を固定する
# :memory: は接続ごとに別 DB になるため、ファイル SQLite で単一 DB を共有する
_test_db = Path(__file__).resolve().parent.parent / ".pytest_sqlite.db"
if _test_db.exists():
    _test_db.unlink()
os.environ.setdefault("DATABASE_URL", f"sqlite+pysqlite:///{_test_db.resolve()}")
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:9/0")

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _empty_db(client: TestClient) -> Iterator[None]:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM relation"))
        conn.execute(text("DELETE FROM person"))
    yield


@pytest.fixture
def mock_wiki_is_human(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.schemas import HumanCheck

    async def fake_is_human(title: str) -> HumanCheck:
        t = title.strip()
        return HumanCheck(title=t, qid="Q123", is_human=True, source="test")

    monkeypatch.setattr("app.api.v1.wiki.is_human_by_title", fake_is_human)
