# main.pyに実装しているAPIは APIRouter でラップして、このファイルでルーティングを設定する
from fastapi import APIRouter

from app.api.v1 import persons, relations, wiki

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(relations.router)
api_router.include_router(persons.router)
api_router.include_router(wiki.router)
