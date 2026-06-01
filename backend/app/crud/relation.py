from __future__ import annotations

from typing import Any, cast

from sqlalchemy import and_, delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, aliased, joinedload

from app.model import Relation


def person_ids_with_forward_relation(db: Session, *, person_ids: list[int]) -> set[int]:
    """`relation.master_person_id` に少なくとも 1 行ある person.id の集合。"""
    if not person_ids:
        return set()
    uniq: list[int] = list(dict.fromkeys(person_ids))
    rows = db.scalars(
        select(Relation.master_person_id)
        .where(Relation.master_person_id.in_(uniq))
        .distinct()
    ).all()
    return {int(x) for x in rows}


def list_slave_person_ids_for_master(db: Session, *, master_id: int) -> list[int]:
    """指定 master からの forward エッジ先（slave の person id）を列挙する。"""
    return list(
        db.scalars(
            select(Relation.slave_person_id).where(
                Relation.master_person_id == master_id
            )
        ).all()
    )


def delete_relations_where_master(db: Session, *, master_id: int) -> int:
    """主体を master とする forward 行をすべて削除する。"""
    res = cast(
        CursorResult[Any],
        db.execute(delete(Relation).where(Relation.master_person_id == master_id)),
    )
    return int(res.rowcount or 0)


def delete_reverse_edges_to_master_from_given_masters(
    db: Session, *, slave_person_id: int, reverse_master_ids: list[int]
) -> int:
    """
    slave が主体・master が以前 forward で繋がっていた相手、という逆向き行だけ削除する。
    （主体を再実行したときに残る B->A を掃除する用）
    """
    if not reverse_master_ids:
        return 0
    res = cast(
        CursorResult[Any],
        db.execute(
            delete(Relation).where(
                Relation.slave_person_id == slave_person_id,
                Relation.master_person_id.in_(reverse_master_ids),
            )
        ),
    )
    return int(res.rowcount or 0)


def upsert_relation(
    db: Session, *, master_id: int, slave_id: int, point: int
) -> Relation:
    rel = db.scalar(
        select(Relation).where(
            and_(
                Relation.master_person_id == master_id,
                Relation.slave_person_id == slave_id,
            )
        )
    )
    if rel is None:
        rel = Relation(
            master_person_id=master_id, slave_person_id=slave_id, point=point
        )
        db.add(rel)
        # 同一リクエスト内で同じ(master,slave)が複数回現れると、未flushの間はSELECTで検出できず
        # commit/flush時にユニーク制約違反(500)になるため、ここでflushして早めに確定させる。
        db.flush()
        return rel

    rel.point = point
    return rel


def get_relations_for_master(
    db: Session, *, master_id: int, limit: int = 50
) -> list[Relation]:
    return (
        db.query(Relation)
        .where(Relation.master_person_id == master_id)
        .order_by(Relation.point.desc(), Relation.id.asc())
        .limit(limit)
        .all()
    )


def get_relation_aggregates_for_master(db: Session, *, master_id: int, limit: int = 50):
    """
    master -> slave を forward とし、slave -> master を reverse として付けて返す。
    """
    r_fwd = aliased(Relation)
    r_rev = aliased(Relation)

    rows = (
        db.query(r_fwd, r_rev)
        .outerjoin(
            r_rev,
            and_(
                r_rev.master_person_id == r_fwd.slave_person_id,
                r_rev.slave_person_id == r_fwd.master_person_id,
            ),
        )
        .where(r_fwd.master_person_id == master_id)
        .order_by(r_fwd.point.desc(), r_fwd.id.asc())
        .limit(limit)
        .all()
    )
    return rows


def get_incoming_relations_without_forward(
    db: Session, *, person_id: int
) -> list[Relation]:
    """
    主体が slave の行のうち、同一相手への forward（主体が master）が無いもの。
    相手→主体のみ存在するペアを関連者一覧に含めるために使う。
    """
    fwd_check = aliased(Relation)
    return (
        db.query(Relation)
        .options(
            joinedload(Relation.master_person),
            joinedload(Relation.slave_person),
        )
        .outerjoin(
            fwd_check,
            and_(
                fwd_check.master_person_id == person_id,
                fwd_check.slave_person_id == Relation.master_person_id,
            ),
        )
        .where(Relation.slave_person_id == person_id)
        .where(fwd_check.id.is_(None))
        .order_by(Relation.point.desc(), Relation.id.asc())
        .all()
    )
