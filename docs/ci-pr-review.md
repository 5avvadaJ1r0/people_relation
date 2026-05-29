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

**重要:** 変数は **Repository variables**（Actions タブ内の Variables）に置いてください。Environments タブだけに置いた場合は、ジョブに `environment:` を付けない限り `vars.PR_REVIEW_PROVIDER` には入りません。

**重要:** `PR_REVIEW_PROVIDER=gemini` を読むワークフローと `gemini_pr_review.py` は **default ブランチ（`main`）にマージされている必要**があります。`main` が古い「NIM 専用」ワークフローのままだと、変数を設定しても **常に NIM のみ**動きます（変数は参照されません）。

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

## トラブルシュート

### `PR_REVIEW_PROVIDER=gemini` なのに NIM が動く / 何も起きない

1. **default ブランチのワークフローを確認**  
   GitHub で `main` の `.github/workflows/nim-pr-review.yml` を開き、`Resolve PR review provider` ステップがあるか確認する。無ければ `feature/gemini-review` 相当の変更を `main` にマージする。

2. **Actions の実行ログを開く**  
   - Step summary の **Resolved provider** が `gemini` か  
   - `vars.PR_REVIEW_PROVIDER` が `gemini` と表示されるか  
   - 古いワークフローなら上記ステップ自体が無い

3. **`GEMINI_API_KEY` を Repository secrets に追加**（Gemini 利用時必須）  
   未設定だとジョブが error で止まる（以前は warning のみでスキップされ、動いていないように見えた）。

4. **変数の置き場所**  
   Organization variables の場合、当該リポジトリへのアクセス許可が必要。Environment variables のみの場合は、ワークフローに `environment: <名前>` が必要。

5. **fork PR ではないか**  
   fork 由来 PR は secrets / variables が渡らず、ジョブ自体がスキップされる。

6. **変数変更後**  
   変数を追加・変更したら、PR の **Re-run all jobs** で再実行する（古い実行ログは新しい変数を反映しない）。

### 手動でプロバイダを試す

`main` にマージ後、Actions タブから **AI PR review** → **Run workflow**（`workflow_dispatch`）で PR 番号と任意で `provider` を指定して実行できる。
