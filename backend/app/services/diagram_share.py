from __future__ import annotations

from html import escape

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import crud
from app.services.diagram_share_og import load_diagram_share_og_image
from app.services.diagram_share_token import (
    decode_diagram_share_id,
    encode_diagram_share_payload,
)
from app.services.schema_maps import person_search_out
from app.schemas import DiagramShareCreateIn, DiagramShareOut
from app.settings import settings


def create_diagram_share_id(body: DiagramShareCreateIn) -> str:
    return encode_diagram_share_payload(
        center_person_ids=body.center_person_ids,
        show_peer_links=body.show_peer_links,
        total_point_gt=body.total_point_gt,
        exclude_zero_reverse=body.exclude_zero_reverse,
    )


def resolve_diagram_share(db: Session, share_id: str) -> DiagramShareOut:
    payload = decode_diagram_share_id(share_id)
    ids = payload["center_person_ids"]
    persons = crud.list_persons_by_ids(db, person_ids=ids)
    by_id = {p.id: p for p in persons}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise HTTPException(
            status_code=404,
            detail="共有された中心人物の一部が見つかりません",
        )
    ordered = [by_id[i] for i in ids]
    fwd_ids = crud.person_ids_with_forward_relation(db, person_ids=ids)
    center_persons = [
        person_search_out(
            p,
            has_relations=p.id in fwd_ids,
            is_executed_master=bool(p.executed_as_master),
        )
        for p in ordered
    ]
    return DiagramShareOut(
        share_id=share_id,
        center_person_ids=ids,
        show_peer_links=payload["show_peer_links"],
        total_point_gt=payload["total_point_gt"],
        exclude_zero_reverse=payload["exclude_zero_reverse"],
        center_persons=center_persons,
        has_og_image=load_diagram_share_og_image(share_id=share_id) is not None,
    )


def build_diagram_share_app_url(share_id: str) -> str:
    base = settings.public_app_url.rstrip("/")
    from urllib.parse import quote

    q = quote(share_id, safe="")
    return f"{base}/?diagram_share_id={q}"


def build_diagram_share_og_image_url(share_id: str) -> str:
    base = settings.public_api_url.rstrip("/")
    from urllib.parse import quote

    sid = quote(share_id, safe="")
    return f"{base}/v1/diagram/share/{sid}/og-image"


def render_diagram_share_card_html(db: Session, share_id: str) -> str:
    resolved = resolve_diagram_share(db, share_id)
    titles = "、".join(p.title for p in resolved.center_persons)
    title = f"相関図: {titles}" if titles else "相関図"
    description = (
        f"関連値の合計が {resolved.total_point_gt} より大きい関係"
        f"{'（関連者間リンクあり）' if resolved.show_peer_links else ''}"
        f"{'（主体値・関連値0除外）' if resolved.exclude_zero_reverse else ''}"
    )
    app_url = build_diagram_share_app_url(share_id)
    og_image = build_diagram_share_og_image_url(share_id)
    has_image = load_diagram_share_og_image(share_id=share_id) is not None
    image_tags = ""
    if has_image:
        image_tags = f"""
    <meta property="og:image" content="{escape(og_image, quote=True)}" />
    <meta name="twitter:image" content="{escape(og_image, quote=True)}" />"""
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>{escape(title)}</title>
  <meta name="description" content="{escape(description, quote=True)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="{escape(title, quote=True)}" />
  <meta property="og:description" content="{escape(description, quote=True)}" />
  <meta property="og:url" content="{escape(app_url, quote=True)}" />{image_tags}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{escape(title, quote=True)}" />
  <meta name="twitter:description" content="{escape(description, quote=True)}" />
  <meta http-equiv="refresh" content="0;url={escape(app_url, quote=True)}" />
</head>
<body>
  <p><a href="{escape(app_url, quote=True)}">相関図を開く</a></p>
</body>
</html>"""
