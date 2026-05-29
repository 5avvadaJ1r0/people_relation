# CI: AI PR 差分レビュー

Pull Request の unified diff を LLM に送り、[reviewdog](https://github.com/reviewdog/reviewdog) 経由でインラインコメントを付けます。

ワークフロー: `.github/workflows/nim-pr-review.yml`（表示名: **AI PR review**）

## プロバイダの切替

リポジトリ変数 `PR_REVIEW_PROVIDER` でバックエンドを選びます（**Actions > Variables**）。

| 値 | 説明 | 必須シークレット |
| --- | --- | --- |
| `nim`（未設定時の既定） | NVIDIA NIM（OpenAI 互換 Chat Completions） | `NVIDIA_API_KEY` |
| `gemini` | Google Gemini（`generateContent`） | `GEMINI_API_KEY` |

大文字小文字は区別しません（例: `Gemini` → `gemini`）。

## シークレット（Actions > Secrets）

| 名前 | 用途 |
| --- | --- |
| `NVIDIA_API_KEY` | NIM 利用時 |
| `GEMINI_API_KEY` | Gemini 利用時 |
| `GITHUB_TOKEN` | ワークフロー既定（`gh pr diff` 取得・reviewdog 投稿） |

## 変数（Actions > Variables、任意）

| 名前 | 既定値 | 用途 |
| --- | --- | --- |
| `PR_REVIEW_PROVIDER` | `nim` | `nim` / `gemini` |
| `NIM_MODEL` | `meta/llama-3.3-70b-instruct` | NIM モデル ID |
| `NIM_API_BASE_URL` | `https://integrate.api.nvidia.com/v1` | NIM API ベース URL |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini モデル ID |
| `GEMINI_API_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | Gemini API ベース URL |

ジョブ内の `MAX_DIFF_CHARS`（既定 `200000`）はスクリプトの環境変数で上書き可能です（現状ワークフローでは未設定）。

## 外部 API

### NVIDIA NIM

- **目的**: PR 差分のコードレビュー
- **認証**: `Authorization: Bearer <NVIDIA_API_KEY>`
- **エンドポイント**: `{NIM_API_BASE_URL}/chat/completions`
- **レート制限**: NVIDIA の利用プランに依存（本リポジトリでは未制御）
- **エラー時**: ジョブ失敗、API エラー本文の先頭 4000 文字をログ出力

### Google Gemini

- **目的**: PR 差分のコードレビュー
- **認証**: ヘッダ `x-goog-api-key: <GEMINI_API_KEY>`
- **エンドポイント**: `{GEMINI_API_BASE_URL}/models/{GEMINI_MODEL}:generateContent`
- **レート制限**: Google AI の利用枠に依存（本リポジトリでは未制御）
- **エラー時**: ジョブ失敗、API エラー本文の先頭 4000 文字をログ出力

## 動作条件

- `pull_request`（opened / reopened / synchronize）
- ドラフト PR は対象外
- **fork 由来の PR は対象外**（fork ではリポジトリ secrets が渡らないため）
- 同一 PR では `concurrency` により進行中の実行をキャンセル

## スクリプト

| ファイル | 役割 |
| --- | --- |
| `.github/scripts/pr_review_lib.py` | プロンプト・diff 取得・rdjson 変換の共通処理 |
| `.github/scripts/nim_pr_review.py` | NIM 呼び出し |
| `.github/scripts/gemini_pr_review.py` | Gemini 呼び出し |
