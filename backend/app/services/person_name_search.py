"""人物名検索用の正規化（区切り記号を除いた部分一致）。"""

from __future__ import annotations

import re
import unicodedata
from typing import Union

from sqlalchemy import ColumnElement, func
from sqlalchemy.orm import InstrumentedAttribute

# 中点・スペース（半角/全角）・ハイフン類
_PERSON_NAME_SEARCH_STRIP_RE = re.compile(r"[\s　・･·\-－—]")

_SQLITE_STRIP_CHARS = (" ", "　", "・", "･", "·", "-", "－", "—")

_POSTGRES_STRIP_PATTERN = r"[\s　・･·\-－—]"

_StrColumnExpr = Union[ColumnElement[str], InstrumentedAttribute[str]]


def normalize_person_name_for_search(name: str) -> str:
    """検索語・DB 値の比較用キー（区切り記号除去・NFC・casefold）。"""
    s = unicodedata.normalize("NFC", str(name or "").strip())
    return _PERSON_NAME_SEARCH_STRIP_RE.sub("", s).casefold()


def sql_normalized_person_name(
    column: _StrColumnExpr,
    *,
    dialect_name: str,
) -> ColumnElement[str]:
    """`Person.name` / `Person.title` を検索用に正規化する SQL 式。"""
    expr: ColumnElement[str] = func.lower(column)
    if dialect_name == "postgresql":
        return func.regexp_replace(
            expr,
            _POSTGRES_STRIP_PATTERN,
            "",
            "g",
        )
    # pytest の SQLite 用。本番 PostgreSQL は上記 regexp_replace のみ。
    for ch in _SQLITE_STRIP_CHARS:
        expr = func.replace(expr, ch, "")
    return expr
