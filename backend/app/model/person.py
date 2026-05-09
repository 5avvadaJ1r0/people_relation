from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.model.relation import Relation


class Person(Base):
    __tablename__ = "person"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    # 「主体者として実行した」かどうか（関連者として保存された場合は立てない）
    executed_as_master: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    executed_as_master_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=False),
        nullable=True,
    )
    created: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now(), nullable=False)
    updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    masters: Mapped[list["Relation"]] = relationship(
        back_populates="master_person",
        foreign_keys="Relation.master_person_id",
        cascade="all, delete-orphan",
    )
    slaves: Mapped[list["Relation"]] = relationship(
        back_populates="slave_person",
        foreign_keys="Relation.slave_person_id",
        cascade="all, delete-orphan",
    )

