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
# 相関図共有トークン（Fernet）用の固定テスト鍵
os.environ.setdefault(
    "DIAGRAM_SHARE_SECRET_KEY",
    "7CAXratP6jJ7LqaU3UHH1ckBhmUG5prGYQswS4Ry1m8=",
)

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
        conn.execute(text("DELETE FROM wiki_human_cache"))
        conn.execute(text("DELETE FROM person"))
    yield
