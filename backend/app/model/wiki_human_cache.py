from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class WikiHumanCache(Base):
    """Wikipedia/Wikidata の人物判定（P31=Q5）結果キャッシュ。

    person とは独立に、URL（ja.wikipedia の記事URL）単位で is_human を保存する。
    人物以外（曖昧さ回避ページ・組織・作品など）も含めてキャッシュ対象とすることで、
    「人物以外を person に書き込んでしまう」事故を避ける。
    """

    __tablename__ = "wiki_human_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    qid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_human: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
