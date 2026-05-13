from __future__ import annotations

from fastapi import APIRouter

from app.schemas import CoreNetworkIn, DiagramCoreNetworkOut
from app.services.diagram import core_network

router = APIRouter(prefix="/diagram", tags=["diagram"])


@router.post("/core_network", response_model=DiagramCoreNetworkOut)
def post_core_network(body: CoreNetworkIn) -> DiagramCoreNetworkOut:
    """中心人物（2〜5名の person.title）に基づき、無向ペア集約済みの関係行を返す。"""
    return core_network(body.center_titles, total_point_gt=body.total_point_gt)
