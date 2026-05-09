from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.db import init_db
from app.settings import settings

app = FastAPI(title="people_relation API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/health")
def api_health() -> dict:
    # nginx配下で /api/health を叩けるよう互換エンドポイントを用意
    return {"ok": True}


app.include_router(api_router)
