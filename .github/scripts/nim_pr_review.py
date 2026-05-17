#!/usr/bin/env python3
"""PR 差分を NVIDIA NIM API に送り、reviewdog rdjson 形式で stdout に出力する。"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

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


def call_nim_chat(*, api_key: str, base_url: str, model: str, prompt: str) -> str:
    url = f"{base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": 8192,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"NVIDIA NIM API エラー {e.code}: {body[:4000]}", file=sys.stderr)
        raise

    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(
            f"NIM の応答に choices がありません: {json.dumps(data)[:2000]}"
        )
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not content:
        raise RuntimeError(f"NIM の応答形式が想定外です: {json.dumps(data)[:2000]}")
    return str(content)


def extract_json_object(text: str) -> dict:
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

    raise RuntimeError(f"NIM の応答から JSON を抽出できません: {stripped[:500]}")


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


def to_rdjson(nim_result: dict, *, model: str) -> dict:
    raw_items = nim_result.get("diagnostics")
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
            "name": "nvidia-nim",
            "url": f"https://build.nvidia.com/ (model: {model})",
        },
        "diagnostics": diagnostics,
    }


def main() -> int:
    api_key = (os.environ.get("NVIDIA_API_KEY") or "").strip()
    token = (os.environ.get("GITHUB_TOKEN") or "").strip()
    repo = (os.environ.get("GITHUB_REPOSITORY") or "").strip()
    pr = (os.environ.get("PR_NUMBER") or "").strip()
    model = (os.environ.get("NIM_MODEL") or "meta/llama-3.3-70b-instruct").strip()
    base_url = (
        os.environ.get("NIM_API_BASE_URL") or "https://integrate.api.nvidia.com/v1"
    ).strip()
    max_chars = int(os.environ.get("MAX_DIFF_CHARS") or "200000")

    if not api_key:
        print(
            "NVIDIA_API_KEY が空です。リポジトリの Actions シークレットに NVIDIA_API_KEY を設定してください。",
            file=sys.stderr,
        )
        return 1
    if not token or not repo or not pr:
        print(
            "GITHUB_TOKEN / GITHUB_REPOSITORY / PR_NUMBER が不足しています。",
            file=sys.stderr,
        )
        return 1

    try:
        diff = run_gh(["pr", "diff", pr, "--repo", repo], token=token)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1

    if len(diff) > max_chars:
        diff = diff[:max_chars] + "\n\n[... diff truncated for API size ...]\n"

    try:
        nim_text = call_nim_chat(
            api_key=api_key,
            base_url=base_url,
            model=model,
            prompt=build_review_prompt(diff),
        )
        nim_result = extract_json_object(nim_text)
        rdjson = to_rdjson(nim_result, model=model)
    except (RuntimeError, json.JSONDecodeError) as e:
        print(str(e), file=sys.stderr)
        return 1

    print(json.dumps(rdjson, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
