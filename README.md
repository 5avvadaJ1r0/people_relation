# 著名人関連者リストアップ・相関図作成

Wikipedia を起点に人物の関連を抽出し、保存・検索・相関図表示ができるアプリケーションです。

## ドキュメント

詳細は **[docs/README.md](docs/README.md)** の目次から参照してください（インフラ、起動手順、アーキテクチャ、API 概要、画面仕様、デモなど）。

- API 仕様（エンドポイント、認証、パラメータ、レスポンス例、レート制限、エラー）: [docs/api.md](docs/api.md)
- PostgreSQL DDL: [docs/ddl_postgres.sql](docs/ddl_postgres.sql)

## クイックスタート（開発）

前提: Docker / Docker Compose

```bash
cp .env.example .env
docker compose -f docker/docker-compose.yml --env-file .env up --build
```

- 画面: `http://localhost:8080`
- ヘルス: `http://localhost:8080/api/v1/health` / レディ: `http://localhost:8080/api/v1/ready`

停止・Gunicorn・CDN 配信などは [docs/setup.md](docs/setup.md) を参照。
