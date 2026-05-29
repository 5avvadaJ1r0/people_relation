from __future__ import annotations

import base64
import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.settings import settings

_PAYLOAD_VERSION = 1


def _fernet() -> Fernet:
    raw = settings.diagram_share_secret_key.strip()
    if not raw:
        raise HTTPException(
            status_code=503,
            detail="相関図共有は未設定です（DIAGRAM_SHARE_SECRET_KEY を設定してください）",
        )
    try:
        key = raw.encode("ascii")
        return Fernet(key)
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="DIAGRAM_SHARE_SECRET_KEY の形式が不正です",
        ) from exc


def encode_diagram_share_payload(
    *,
    center_person_ids: list[int],
    show_peer_links: bool,
    total_point_gt: int,
) -> str:
    """JSON を Fernet で暗号化し、URL セーフな share_id を返す。"""
    payload: dict[str, Any] = {
        "v": _PAYLOAD_VERSION,
        "c": center_person_ids,
        "p": show_peer_links,
        "t": total_point_gt,
    }
    blob = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )
    token = _fernet().encrypt(blob)
    return base64.urlsafe_b64encode(token).decode("ascii").rstrip("=")


def decode_diagram_share_id(share_id: str) -> dict[str, Any]:
    """share_id を復号し、検証済みペイロード dict を返す。"""
    cleaned = share_id.strip()
    if not cleaned or len(cleaned) > 4096:
        raise HTTPException(status_code=400, detail="共有 ID が不正です")
    pad = "=" * (-len(cleaned) % 4)
    try:
        raw = base64.urlsafe_b64decode(cleaned + pad)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="共有 ID が不正です") from exc
    try:
        plain = _fernet().decrypt(raw)
    except InvalidToken as exc:
        raise HTTPException(status_code=400, detail="共有 ID が無効です") from exc
    try:
        data = json.loads(plain.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="共有 ID が無効です") from exc
    if not isinstance(data, dict) or data.get("v") != _PAYLOAD_VERSION:
        raise HTTPException(status_code=400, detail="共有 ID が無効です")
    center_raw = data.get("c")
    if not isinstance(center_raw, list) or not center_raw:
        raise HTTPException(status_code=400, detail="共有 ID が無効です")
    try:
        center_ids = [int(x) for x in center_raw]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="共有 ID が無効です") from exc
    uniq = list(dict.fromkeys(center_ids))
    if len(uniq) < 1 or len(uniq) > 10:
        raise HTTPException(status_code=400, detail="共有 ID が無効です")
    show_peer = data.get("p")
    if not isinstance(show_peer, bool):
        raise HTTPException(status_code=400, detail="共有 ID が無効です")
    total_raw = data.get("t")
    if total_raw is None or isinstance(total_raw, bool):
        raise HTTPException(status_code=400, detail="共有 ID が無効です")
    try:
        total_gt = int(total_raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="共有 ID が無効です") from exc
    if total_gt < 0:
        raise HTTPException(status_code=400, detail="共有 ID が無効です")
    return {
        "center_person_ids": uniq,
        "show_peer_links": show_peer,
        "total_point_gt": total_gt,
    }
