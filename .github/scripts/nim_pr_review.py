#!/usr/bin/env python3
"""PR 差分を NVIDIA NIM API に送り、reviewdog rdjson 形式で stdout に出力する。"""

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


def main() -> int:
    api_key = (os.environ.get("NVIDIA_API_KEY") or "").strip()
    model = (os.environ.get("NIM_MODEL") or "meta/llama-3.3-70b-instruct").strip()
    base_url = (
        os.environ.get("NIM_API_BASE_URL") or "https://integrate.api.nvidia.com/v1"
    ).strip()

    if not api_key:
        print(
            "NVIDIA_API_KEY が空です。リポジトリの Actions シークレットに NVIDIA_API_KEY を設定してください。",
            file=sys.stderr,
        )
        return 1

    token, repo, pr, max_chars = require_github_context()

    try:
        diff = fetch_pr_diff(token=token, repo=repo, pr=pr, max_chars=max_chars)
        nim_text = call_nim_chat(
            api_key=api_key,
            base_url=base_url,
            model=model,
            prompt=build_review_prompt(diff),
        )
        review_result = extract_json_object(nim_text, provider_label="NIM")
        rdjson = to_rdjson(
            review_result,
            source_name="nvidia-nim",
            source_url=f"https://build.nvidia.com/ (model: {model})",
        )
    except (RuntimeError, json.JSONDecodeError) as e:
        print(str(e), file=sys.stderr)
        return 1

    print(json.dumps(rdjson, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
