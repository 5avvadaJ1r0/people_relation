from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.model.person import Person


class Relation(Base):
    __tablename__ = "relation"
    __table_args__ = (
        UniqueConstraint(
            "master_person_id", "slave_person_id", name="uq_relation_master_slave"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    master_person_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("person.id"), nullable=False
    )
    slave_person_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("person.id"), nullable=False
    )
    point: Mapped[int] = mapped_column(Integer, nullable=False)
    created: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), nullable=False
    )
    updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    master_person: Mapped["Person"] = relationship(
        "Person", foreign_keys=[master_person_id], back_populates="masters"
    )
    slave_person: Mapped["Person"] = relationship(
        "Person", foreign_keys=[slave_person_id], back_populates="slaves"
    )
