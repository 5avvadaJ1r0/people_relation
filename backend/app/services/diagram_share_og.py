from __future__ import annotations

import logging

import redis
from fastapi import HTTPException

from app.settings import settings

logger = logging.getLogger(__name__)

_OG_KEY_PREFIX = "diagram_share:og:"
_OG_TTL_SECONDS = 60 * 60 * 24 * 30
_MAX_OG_BYTES = 2 * 1024 * 1024
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

_redis_client: redis.Redis | None = None


def _redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=False)
    return _redis_client


def _og_key(share_id: str) -> str:
    return f"{_OG_KEY_PREFIX}{share_id}"


def store_diagram_share_og_image(*, share_id: str, png: bytes) -> None:
    if not png.startswith(_PNG_MAGIC):
        raise HTTPException(status_code=400, detail="PNG 画像のみアップロードできます")
    if len(png) > _MAX_OG_BYTES:
        raise HTTPException(status_code=413, detail="画像が大きすぎます（最大 2MB）")
    try:
        _redis().setex(_og_key(share_id), _OG_TTL_SECONDS, png)
    except redis.RedisError as exc:
        logger.exception("diagram share og image store failed")
        raise HTTPException(
            status_code=503, detail="共有画像の保存に失敗しました"
        ) from exc


def load_diagram_share_og_image(*, share_id: str) -> bytes | None:
    try:
        raw = _redis().get(_og_key(share_id))
    except redis.RedisError:
        logger.exception("diagram share og image load failed")
        return None
    if raw is None or not isinstance(raw, bytes):
        return None
    return raw
