from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.model import Person, Relation


def _normalize_core_network_center_titles(center_titles: list[str]) -> list[str]:
    """API 層の前提に合わせ、生の center_titles を集約用の title 列へ正規化する。

    元リストが 2 未満または 10 超なら []。strip・空除去・重複排除のあと 2 未満なら []。
    """
    if len(center_titles) < 2 or len(center_titles) > 10:
        return []
    titles = list(dict.fromkeys(t.strip() for t in center_titles if t.strip()))
    if len(titles) < 2:
        return []
    return titles


def _core_network_edges_aggregate_select(titles: list[str], total_point_gt: int):
    """無向ペア集約の SELECT を組み立てる（実行はしない）。"""
    p1 = aliased(Person)
    p2 = aliased(Person)
    pair_a = case((p1.title <= p2.title, p1.title), else_=p2.title)
    pair_b = case((p1.title <= p2.title, p2.title), else_=p1.title)
    total = func.sum(Relation.point)
    return (
        select(pair_a, pair_b, total)
        .select_from(Relation)
        .join(p1, p1.id == Relation.master_person_id)
        .join(p2, p2.id == Relation.slave_person_id)
        .where(
            Relation.point != 0,
            or_(p1.title.in_(titles), p2.title.in_(titles)),
        )
        .group_by(pair_a, pair_b)
        .having(total > total_point_gt)
        .order_by(total.desc())
    )


def _rows_to_core_network_edge_tuples(
    rows: Iterable[Any],
) -> list[tuple[str, str, int]]:
    """集約クエリの行を (title_a, title_b, total_point) に変換する。"""
    out: list[tuple[str, str, int]] = []
    for a, b, tp in rows:
        if tp is None:
            continue
        out.append((str(a), str(b), int(tp)))
    return out


def aggregate_core_network_edges(
    db: Session, *, center_titles: list[str], total_point_gt: int = 1
) -> list[tuple[str, str, int]]:
    """中心人物タイトル集合に触れる relation を無向ペア集約して返す。

    ペアは辞書順で正規化（PostgreSQL の LEAST/GREATEST と同等）。SQLite でも動くよう CASE で実装。
    `SUM(point) > total_point_gt` かつ `point <> 0` の行のみ。
    """
    titles = _normalize_core_network_center_titles(center_titles)
    if not titles:
        return []
    stmt = _core_network_edges_aggregate_select(titles, total_point_gt)
    rows = db.execute(stmt).all()
    return _rows_to_core_network_edge_tuples(rows)
