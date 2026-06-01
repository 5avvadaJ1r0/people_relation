from __future__ import annotations

import base64
import json
import logging
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.settings import settings

logger = logging.getLogger(__name__)

_PAYLOAD_VERSION = 1
_fernet_instance: Fernet | None = None
_diagram_share_enabled = False


def init_diagram_share_crypto() -> None:
    """起動時に Fernet 鍵を検証し、共有機能の有効/無効を確定する。"""
    global _fernet_instance, _diagram_share_enabled
    raw = settings.diagram_share_secret_key.strip()
    if not raw:
        _fernet_instance = None
        _diagram_share_enabled = False
        logger.warning(
            "DIAGRAM_SHARE_SECRET_KEY が未設定のため、相関図 URL 共有は無効です"
        )
        return
    try:
        _fernet_instance = Fernet(raw.encode("ascii"))
    except (ValueError, TypeError) as exc:
        raise RuntimeError(
            "DIAGRAM_SHARE_SECRET_KEY の形式が不正です（Fernet 鍵を設定してください）"
        ) from exc
    _diagram_share_enabled = True


def _fernet() -> Fernet:
    if not _diagram_share_enabled or _fernet_instance is None:
        raise HTTPException(
            status_code=503,
            detail="相関図共有は未設定です（DIAGRAM_SHARE_SECRET_KEY を設定してください）",
        )
    return _fernet_instance


def encode_diagram_share_payload(
    *,
    center_person_ids: list[int],
    show_peer_links: bool,
    total_point_gt: int,
    exclude_zero_reverse: bool = True,
) -> str:
    """JSON を Fernet で暗号化し、URL セーフな share_id を返す。"""
    payload: dict[str, Any] = {
        "v": _PAYLOAD_VERSION,
        "c": center_person_ids,
        "p": show_peer_links,
        "t": total_point_gt,
        "e": exclude_zero_reverse,
    }
    blob = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )
    token = _fernet().encrypt(blob)
    return base64.urlsafe_b64encode(token).decode("ascii").rstrip("=")


def _decode_share_id_bytes(share_id: str) -> bytes:
    """URL-safe base64（パディング除去済み）を Fernet トークン bytes に復元する。"""
    cleaned = share_id.strip()
    if not cleaned or len(cleaned) > 4096:
        raise HTTPException(status_code=400, detail="共有 ID が不正です")
    if "=" in cleaned:
        raise HTTPException(status_code=400, detail="共有 ID が不正です")
    if len(cleaned) % 4 == 1:
        raise HTTPException(status_code=400, detail="共有 ID が不正です")
    pad = "=" * (-len(cleaned) % 4)
    try:
        raw = base64.urlsafe_b64decode(cleaned + pad)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="共有 ID が不正です") from exc
    canonical = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    if canonical != cleaned:
        raise HTTPException(status_code=400, detail="共有 ID が不正です")
    return raw


def decode_diagram_share_id(share_id: str) -> dict[str, Any]:
    """share_id を復号し、検証済みペイロード dict を返す。"""
    raw = _decode_share_id_bytes(share_id)
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
    exclude_raw = data.get("e")
    if exclude_raw is None:
        exclude_zero_reverse = True
    elif not isinstance(exclude_raw, bool):
        raise HTTPException(status_code=400, detail="共有 ID が無効です")
    else:
        exclude_zero_reverse = exclude_raw
    return {
        "center_person_ids": uniq,
        "show_peer_links": show_peer,
        "total_point_gt": total_gt,
        "exclude_zero_reverse": exclude_zero_reverse,
    }
