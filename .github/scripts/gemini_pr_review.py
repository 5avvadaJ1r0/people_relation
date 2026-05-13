#!/usr/bin/env python3
"""PR 差分を Gemini API に送り、レビュー結果を PR コメントとして投稿する（GitHub Actions 用・標準ライブラリのみ）。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request


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


def main() -> int:
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    token = (os.environ.get("GITHUB_TOKEN") or "").strip()
    repo = (os.environ.get("GITHUB_REPOSITORY") or "").strip()
    pr = (os.environ.get("PR_NUMBER") or "").strip()
    model = (os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash").strip()
    max_chars = int(os.environ.get("MAX_DIFF_CHARS") or "200000")

    if not api_key:
        print("GEMINI_API_KEY が空です。リポジトリの Actions シークレットに GEMINI_API_KEY を設定してください。", file=sys.stderr)
        return 1
    if not token or not repo or not pr:
        print("GITHUB_TOKEN / GITHUB_REPOSITORY / PR_NUMBER が不足しています。", file=sys.stderr)
        return 1

    try:
        diff = run_gh(["pr", "diff", pr, "--repo", repo], token=token)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1

    if len(diff) > max_chars:
        diff = diff[:max_chars] + "\n\n[... diff truncated for API size ...]\n"

    prompt = f"""あなたは熟練のソフトウェアエンジニアです。次の Pull Request の差分をレビューし、日本語で要点をまとめてください。

観点（該当がなければ省略可）:
- バグ・ロジックミス・境界条件
- パフォーマンス・拡張性
- セキュリティ・秘密情報の扱い
- 可読性・テスト観点
- リファクタリング

## 差分（unified diff）
```
{diff}
```

出力形式:
- まず全体所見（2〜5文）
- その後、重要度が高い順に箇条書き（各項目1〜3文）
"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 8192},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"Gemini API エラー {e.code}: {body[:4000]}", file=sys.stderr)
        return 1

    candidates = data.get("candidates") or []
    if not candidates:
        print(f"Gemini の応答に candidates がありません: {json.dumps(data)[:2000]}", file=sys.stderr)
        return 1
    parts = ((candidates[0].get("content") or {}).get("parts")) or []
    if not parts or "text" not in parts[0]:
        print(f"Gemini の応答形式が想定外です: {json.dumps(data)[:2000]}", file=sys.stderr)
        return 1
    text = parts[0]["text"]

    review_path = os.environ.get("REVIEW_PATH") or "gemini-review.md"
    with open(review_path, "w", encoding="utf-8") as f:
        f.write("## Gemini によるレビュー\n\n")
        f.write(text)
        f.write("\n\n---\n*Automated review (model: ")
        f.write(model)
        f.write(")*\n")

    try:
        run_gh(
            ["pr", "comment", pr, "--repo", repo, "--body-file", review_path],
            token=token,
        )
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
