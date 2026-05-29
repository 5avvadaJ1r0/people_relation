"""PR 差分レビュー共通処理（reviewdog rdjson 出力まで）。"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys

SEVERITIES = frozenset({"ERROR", "WARNING", "INFO"})


def run_gh(args: list[str], *, token: str) -> str:
    env = {**os.environ, "GH_TOKEN": token}
    proc = subprocess.run(
        ["gh", *args],
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"gh failed ({proc.returncode}): {err}")
    return proc.stdout


def build_review_prompt(diff: str) -> str:
    return f"""あなたは熟練のソフトウェアエンジニアです。次の Pull Request の差分をレビューし、指摘事項を JSON のみで返してください。

観点（該当がなければ省略可）:
- バグ・ロジックミス・境界条件
- パフォーマンス・拡張性
- セキュリティ・秘密情報の扱い
- 可読性・テスト観点

## 差分（unified diff）
```
{diff}
```

## 出力ルール（厳守）
- 応答は JSON オブジェクトのみ（説明文・Markdown・コードフェンス禁止）
- 差分に含まれるファイルのみ path に指定する（存在しないパスは書かない）
- line は変更後ファイルの 1 始まり行番号（unified diff の + 側）
- 重要度の高い指摘を最大 20 件まで
- 指摘がなければ diagnostics は空配列

## JSON スキーマ
{{
  "diagnostics": [
    {{
      "path": "relative/path/to/file.ext",
      "line": 1,
      "end_line": 1,
      "message": "指摘内容（日本語、1〜3文）",
      "severity": "ERROR"
    }}
  ]
}}

severity は ERROR / WARNING / INFO のいずれか。
"""


def extract_json_object(text: str, *, provider_label: str) -> dict:
    stripped = text.strip()
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", stripped, re.IGNORECASE)
    if fence:
        parsed = json.loads(fence.group(1).strip())
        if isinstance(parsed, dict):
            return parsed

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        parsed = json.loads(stripped[start : end + 1])
        if isinstance(parsed, dict):
            return parsed

    raise RuntimeError(
        f"{provider_label} の応答から JSON を抽出できません: {stripped[:500]}"
    )


def normalize_severity(value: object) -> str:
    if isinstance(value, str):
        upper = value.strip().upper()
        if upper in SEVERITIES:
            return upper
    return "WARNING"


def normalize_line(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float) and value.is_integer():
        line = int(value)
        return line if line > 0 else None
    if isinstance(value, str) and value.strip().isdigit():
        line = int(value.strip())
        return line if line > 0 else None
    return None


def to_rdjson(
    review_result: dict,
    *,
    source_name: str,
    source_url: str,
) -> dict:
    raw_items = review_result.get("diagnostics")
    if not isinstance(raw_items, list):
        raw_items = []

    diagnostics: list[dict] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip().lstrip("./")
        if not path or path.startswith(".."):
            continue
        line = normalize_line(item.get("line"))
        if line is None:
            continue
        end_line = normalize_line(item.get("end_line")) or line
        if end_line < line:
            end_line = line
        message = str(item.get("message") or "").strip()
        if not message:
            continue

        location: dict = {
            "path": path,
            "range": {
                "start": {"line": line},
                "end": {"line": end_line},
            },
        }
        diagnostic: dict = {
            "message": message,
            "location": location,
            "severity": normalize_severity(item.get("severity")),
        }
        code = item.get("code")
        if isinstance(code, str) and code.strip():
            diagnostic["code"] = {"value": code.strip()}
        diagnostics.append(diagnostic)

    return {
        "source": {
            "name": source_name,
            "url": source_url,
        },
        "diagnostics": diagnostics,
    }


def fetch_pr_diff(
    *,
    token: str,
    repo: str,
    pr: str,
    max_chars: int,
) -> str:
    diff = run_gh(["pr", "diff", pr, "--repo", repo], token=token)
    if len(diff) > max_chars:
        diff = diff[:max_chars] + "\n\n[... diff truncated for API size ...]\n"
    return diff


def require_github_context() -> tuple[str, str, str, int]:
    token = (os.environ.get("GITHUB_TOKEN") or "").strip()
    repo = (os.environ.get("GITHUB_REPOSITORY") or "").strip()
    pr = (os.environ.get("PR_NUMBER") or "").strip()
    max_chars = int(os.environ.get("MAX_DIFF_CHARS") or "200000")

    if not token or not repo or not pr:
        print(
            "GITHUB_TOKEN / GITHUB_REPOSITORY / PR_NUMBER が不足しています。",
            file=sys.stderr,
        )
        raise SystemExit(1)

    return token, repo, pr, max_chars
