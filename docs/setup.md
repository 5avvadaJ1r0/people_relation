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

## 関連者抽出ワーカー（Ubuntu + systemd）

画面の「関連者を探す」と同じ処理を、`person.executed_as_master = false` の人物に対してバックグラウンドで繰り返すワーカーを **systemd** で常駐させる手順です（`systemctl` で登録・起動・停止）。

前提:

- Ubuntu 22.04 / 24.04 など（`systemd` 利用）
- リポジトリをサーバーに配置済み（例: `/opt/people_relation`）
- PostgreSQL / Redis に API と同じ接続情報で到達できること
- Python 3.12 と `backend` 用 venv を作成済み

### 1. 専用ユーザーと配置（初回のみ）

```bash
sudo useradd --system --home /opt/people_relation --shell /usr/sbin/nologin people_relation
sudo mkdir -p /opt/people_relation
# デプロイ方法に合わせて clone / rsync などでコードを配置
sudo chown -R people_relation:people_relation /opt/people_relation
```

バックエンドの venv と依存関係（API と同じ手順で可）:

```bash
cd /opt/people_relation/backend
sudo -u people_relation python3.12 -m venv .venv
sudo -u people_relation .venv/bin/pip install -r requirements.txt
```

### 2. 環境変数ファイル

API と同じ `DATABASE_URL` / `REDIS_URL` を渡します（パスワード等は Git に含めない）。

```bash
sudo mkdir -p /etc/people_relation
sudo install -o root -g people_relation -m 640 /dev/stdin /etc/people_relation/relation-extract.env <<'EOF'
DATABASE_URL=postgresql+psycopg://app:YOUR_PASSWORD@127.0.0.1:5432/people_relation
REDIS_URL=redis://127.0.0.1:6379/0
# 公開運用時は連絡先付き URL を設定すること
# WIKIPEDIA_USER_AGENT=people_relation/1.0 (+https://example.com/; contact: you@example.com)
EOF
sudo chmod 640 /etc/people_relation/relation-extract.env
```

`EnvironmentFile=-` プレフィックスにより、ファイルが無い場合でも unit の登録は可能です（本番では必ず作成してください）。

### 3. systemd ユニットの登録

リポジトリ同梱の unit をコピーし、パスが異なる場合は編集します。

```bash
sudo cp /opt/people_relation/deploy/systemd/people-relation-relation-extract.service \
  /etc/systemd/system/people-relation-relation-extract.service
# WorkingDirectory / ExecStart / User が環境と一致するか確認
sudo systemctl daemon-reload
sudo systemctl enable people-relation-relation-extract.service
```

### 4. 起動・停止・状態確認

| 操作 | コマンド |
| --- | --- |
| 起動 | `sudo systemctl start people-relation-relation-extract` |
| 停止 | `sudo systemctl stop people-relation-relation-extract` |
| 再起動 | `sudo systemctl restart people-relation-relation-extract` |
| 状態 | `sudo systemctl status people-relation-relation-extract` |
| ログ（追従） | `sudo journalctl -u people-relation-relation-extract -f` |

停止時は **SIGTERM** が送られ、実行中の 1 件が終わってからプロセスが終了します（`TimeoutStopSec=600`）。強制終了が必要な場合のみ `sudo systemctl kill -s SIGKILL people-relation-relation-extract` を検討してください。

### 5. 動作確認（任意）

1 件だけ処理して終了する場合（常駐ではなく手動テスト）:

```bash
cd /opt/people_relation/backend
sudo -u people_relation --preserve-env=DATABASE_URL,REDIS_URL \
  .venv/bin/python -m app.worker.relation_extract --once
```

### 6. オプション（unit の `ExecStart` を編集する場合）

| オプション | 意味 |
| --- | --- |
| `--sleep 30` | 各処理の間隔（秒）。既定 30 |
| `--max-related 100` | 抽出する関連者上限 |
| `--max-iterations N` | N 回で終了（常駐向きでは通常付けない） |
| `--once` | 1 件のみ（手動テスト向け） |

例: 間隔 60 秒に変更する場合:

```ini
ExecStart=/opt/people_relation/backend/.venv/bin/python -m app.worker.relation_extract --sleep 60
```

編集後は `sudo systemctl daemon-reload` と `sudo systemctl restart people-relation-relation-extract` を実行してください。

### Docker Compose を使う場合

開発用 compose には `relation_extract_worker` サービスがあります。本番で compose 常駐にする場合は `docker compose up -d relation_extract_worker` で代替できます。VM 上でプロセスを直接管理する場合は上記 systemd を利用してください。

## フロントを CDN（別ホスト）で配信する場合

API と画面のオリジンが分かれるときは、バックエンドの `CORS_ORIGINS` にユーザーが開くフロントの origin（例: `https://cdn.example.com`）を追加する。フロントのビルドでは `VITE_API_BASE_URL` に API のベース URL（例: `https://api.example.com/api`）を渡す。実行時にだけ URL を差し替えたい場合は `index.html` のコメント参照。詳細は [api.md](./api.md) の「CDN・別オリジンでフロントを配信する場合」。
