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


@app.on_event("shutdown")
async def _shutdown_wiki_clients() -> None:
    from app.services.wiki.human import aclose_shared_http_and_redis

    await aclose_shared_http_and_redis()


app.include_router(api_router)
