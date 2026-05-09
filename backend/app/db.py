from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.settings import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(
    bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    # 最小構成として、初回起動時にテーブルを作る（migrateは後でalembicへ移行可能）
    # モデル定義を import して metadata へ登録する
    from app.model import Person, Relation  # noqa: F401

    Base.metadata.create_all(bind=engine)
