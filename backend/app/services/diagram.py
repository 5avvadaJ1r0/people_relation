from __future__ import annotations

from sqlalchemy.orm import Session

from app import crud
from app.schemas import DiagramCoreNetworkOut, DiagramRelationPairOut


def core_network(
    db: Session,
    center_titles: list[str],
    *,
    total_point_gt: int = 0,
    exclude_zero_reverse: bool = True,
) -> DiagramCoreNetworkOut:
    rows = crud.aggregate_core_network_edges(
        db,
        center_titles=center_titles,
        total_point_gt=total_point_gt,
        exclude_zero_reverse=exclude_zero_reverse,
    )
    return DiagramCoreNetworkOut(
        center_titles=list(center_titles),
        pairs=[
            DiagramRelationPairOut(
                person1=a,
                person2=b,
                total_point=tp,
            )
            for a, b, tp in rows
        ],
    )
