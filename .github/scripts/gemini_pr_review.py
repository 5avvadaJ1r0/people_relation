#!/usr/bin/env python3
"""PR 差分を Google Gemini API に送り、reviewdog rdjson 形式で stdout に出力する。"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

from pr_review_lib import (
    build_review_prompt,
    extract_json_object,
    fetch_pr_diff,
    require_github_context,
    to_rdjson,
)


def call_gemini_generate(
    *, api_key: str, base_url: str, model: str, prompt: str
) -> str:
    url = f"{base_url.rstrip('/')}/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 8192,
        },
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
        raise

    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError(
            f"Gemini の応答に candidates がありません: {json.dumps(data)[:2000]}"
        )
    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    texts = [
        str(part.get("text"))
        for part in parts
        if isinstance(part, dict) and part.get("text")
    ]
    if not texts:
        raise RuntimeError(f"Gemini の応答形式が想定外です: {json.dumps(data)[:2000]}")
    return "\n".join(texts)


def main() -> int:
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    model = (os.environ.get("GEMINI_MODEL") or "gemini-2.0-flash").strip()
    base_url = (
        os.environ.get("GEMINI_API_BASE_URL")
        or "https://generativelanguage.googleapis.com/v1beta"
    ).strip()

    if not api_key:
        print(
            "GEMINI_API_KEY が空です。リポジトリの Actions シークレットに GEMINI_API_KEY を設定してください。",
            file=sys.stderr,
        )
        return 1

    token, repo, pr, max_chars = require_github_context()

    try:
        diff = fetch_pr_diff(token=token, repo=repo, pr=pr, max_chars=max_chars)
        gemini_text = call_gemini_generate(
            api_key=api_key,
            base_url=base_url,
            model=model,
            prompt=build_review_prompt(diff),
        )
        review_result = extract_json_object(gemini_text, provider_label="Gemini")
        rdjson = to_rdjson(
            review_result,
            source_name="gemini",
            source_url=f"https://ai.google.dev/ (model: {model})",
        )
    except (RuntimeError, json.JSONDecodeError) as e:
        print(str(e), file=sys.stderr)
        return 1

    print(json.dumps(rdjson, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
