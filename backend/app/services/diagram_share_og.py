from __future__ import annotations

import logging

import redis
from fastapi import HTTPException, Request

from app.settings import settings

logger = logging.getLogger(__name__)

_OG_KEY_PREFIX = "diagram_share:og:"
_OG_TTL_SECONDS = 60 * 60 * 24 * 30
_MAX_OG_BYTES = 2 * 1024 * 1024
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_IHDR_CHUNK_TYPE = b"IHDR"
_MIN_PNG_BYTES = 33  # シグネチャ + 最小 IHDR チャンク（length/type/data/CRC）

_redis_client: redis.Redis | None = None


def _validate_png_bytes(png: bytes) -> None:
    """PNG シグネチャ・IHDR・IEND の存在を確認する（完全デコードは行わない）。"""
    if len(png) < _MIN_PNG_BYTES:
        raise HTTPException(status_code=400, detail="PNG 画像のみアップロードできます")
    if not png.startswith(_PNG_MAGIC):
        raise HTTPException(status_code=400, detail="PNG 画像のみアップロードできます")
    if png[12:16] != _IHDR_CHUNK_TYPE:
        raise HTTPException(status_code=400, detail="PNG 画像のみアップロードできます")
    if b"IEND" not in png[-32:]:
        raise HTTPException(status_code=400, detail="PNG 画像のみアップロードできます")


async def read_og_image_body(
    request: Request, *, max_bytes: int = _MAX_OG_BYTES
) -> bytes:
    """OG 画像 PUT 用。Content-Length 超過は先に拒否し、ストリーム読み込みも上限で打ち切る。"""
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared = int(content_length)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="Content-Length が不正です"
            ) from exc
        if declared > max_bytes:
            raise HTTPException(
                status_code=413, detail="画像が大きすぎます（最大 2MB）"
            )
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413, detail="画像が大きすぎます（最大 2MB）"
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=False)
    return _redis_client


def _og_key(share_id: str) -> str:
    return f"{_OG_KEY_PREFIX}{share_id}"


def store_diagram_share_og_image(*, share_id: str, png: bytes) -> None:
    _validate_png_bytes(png)
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
