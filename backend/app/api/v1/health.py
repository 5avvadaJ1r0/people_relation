from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.db import engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.get("/ready")
def ready() -> dict:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"db not ready: {e!s}")
    return {"ok": True, "db": True}
