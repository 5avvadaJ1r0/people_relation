# 起動・デプロイ設定

## 起動方法（開発）

前提: Docker / Docker Compose が利用できること

まず環境変数を用意（DB接続情報はソースに書きません）:

```bash
cp .env.example .env
```

必要に応じて `.env` の `POSTGRES_PASSWORD` / `DATABASE_URL` を編集してください。

リポジトリルートで実行してください（`.env` はルートに置いたままで問題ありません）。

```bash
docker compose -f docker/docker-compose.yml --env-file .env up --build
```

- 画面: `http://localhost:8080`
- APIヘルスチェック: `http://localhost:8080/api/v1/health`（DB まで含めた起動確認は `http://localhost:8080/api/v1/ready`）

停止:

```bash
docker compose -f docker/docker-compose.yml --env-file .env down
```

## 起動方法（Gunicorn：複数ワーカー）

VM・自前サーバーなど「プロセスを複数立てたい」環境では、親プロセスに **Gunicorn**、ワーカーに **Uvicorn**（`uvicorn.workers.UvicornWorker`）を使うのが一般的です。`backend/requirements.txt` に `gunicorn` を含めています。

### Docker Compose で Gunicorn を使う

ベースの compose に `docker/docker-compose.gunicorn.yml` を重ねます（`api` の `command` だけ上書き）。

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.gunicorn.yml --env-file .env up --build
```

ワーカー数やタイムアウトはプロジェクトルートの `.env` で任意（未設定時は compose ファイル内のデフォルト）。サンプルは `.env.example` を参照。

### Docker を使わず直接起動する例

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
gunicorn app.main:app -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000 --workers 4 --timeout 120
```

（`DATABASE_URL` / `REDIS_URL` などは従来どおり環境変数で渡す。）

## フロントを CDN（別ホスト）で配信する場合

API と画面のオリジンが分かれるときは、バックエンドの `CORS_ORIGINS` にユーザーが開くフロントの origin（例: `https://cdn.example.com`）を追加する。フロントのビルドでは `VITE_API_BASE_URL` に API のベース URL（例: `https://api.example.com/api`）を渡す。実行時にだけ URL を差し替えたい場合は `index.html` のコメント参照。詳細は [api.md](./api.md) の「CDN・別オリジンでフロントを配信する場合」。
