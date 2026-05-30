from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import (
    CoreNetworkIn,
    DiagramCoreNetworkOut,
    DiagramShareCreateIn,
    DiagramShareOut,
    DiagramShareTokenOut,
)
from app.services.diagram import core_network
from app.services.diagram_share import (
    create_diagram_share_id,
    render_diagram_share_card_html,
    resolve_diagram_share,
)
from app.services.diagram_share_og import (
    load_diagram_share_og_image,
    read_og_image_body,
    store_diagram_share_og_image,
)

router = APIRouter(prefix="/diagram", tags=["diagram"])


@router.post("/core_network", response_model=DiagramCoreNetworkOut)
def post_core_network(
    body: CoreNetworkIn,
    db: Session = Depends(get_db),
) -> DiagramCoreNetworkOut:
    """中心人物（1〜10名の person.title）に基づき、無向ペア集約済みの関係行を返す。"""
    return core_network(db, body.center_titles, total_point_gt=body.total_point_gt)


@router.post("/share", response_model=DiagramShareTokenOut)
def post_diagram_share(
    body: DiagramShareCreateIn,
    db: Session = Depends(get_db),
) -> DiagramShareTokenOut:
    """相関図の表示条件を暗号化した share_id を発行する。"""
    share_id = create_diagram_share_id(body)
    resolve_diagram_share(db, share_id)
    return DiagramShareTokenOut(share_id=share_id)


@router.get("/share/{share_id}", response_model=DiagramShareOut)
def get_diagram_share(
    share_id: str,
    db: Session = Depends(get_db),
) -> DiagramShareOut:
    """share_id を復号し、中心人物と表示条件を返す。"""
    return resolve_diagram_share(db, share_id)


@router.put("/share/{share_id}/og-image", status_code=204)
async def put_diagram_share_og_image(
    share_id: str,
    request: Request,
) -> Response:
    """X / OGP 用の相関図 PNG を Redis に保存する（share_id 検証のみ）。"""
    from app.services.diagram_share_token import decode_diagram_share_id

    content_type = (
        request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    )
    if content_type != "image/png":
        raise HTTPException(
            status_code=415,
            detail="Content-Type は image/png である必要があります",
        )
    decode_diagram_share_id(share_id)
    png = await read_og_image_body(request)
    store_diagram_share_og_image(share_id=share_id, png=png)
    return Response(status_code=204)


@router.get("/share/{share_id}/og-image")
def get_diagram_share_og_image(share_id: str) -> Response:
    """保存済み OG 画像を返す（Twitter Card 用）。"""
    from app.services.diagram_share_token import decode_diagram_share_id

    decode_diagram_share_id(share_id)
    png = load_diagram_share_og_image(share_id=share_id)
    if png is None:
        return Response(status_code=404)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/share/{share_id}/card", response_class=HTMLResponse)
def get_diagram_share_card(
    share_id: str,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """SNS クローラ向け HTML（OG / Twitter Card）。"""
    html = render_diagram_share_card_html(db, share_id)
    return HTMLResponse(
        content=html,
        headers={"Cache-Control": "public, max-age=300"},
    )
