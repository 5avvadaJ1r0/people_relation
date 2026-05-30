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

## 相関図 URL 共有の環境変数

相関図の「URLを共有」および X（Twitter）カード用画像を使う場合、**FastAPI（`api` サービス）** のみ次の環境変数が必要です。`relation_extract_worker` は相関図共有 API を呼ばないため、**`DIAGRAM_SHARE_SECRET_KEY` は worker には不要**です（同じ `.env` を読んでも未設定のままで worker は動作します）。

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DIAGRAM_SHARE_SECRET_KEY` | 共有機能を使うとき | Fernet 形式の暗号化鍵（下記手順で生成） |
| `PUBLIC_APP_URL` | 本番・OG 推奨 | ユーザーが開く共有 URL のオリジン（末尾スラッシュなし）。例: `https://example.com` |
| `PUBLIC_API_URL` | 本番・OG 推奨 | OG 画像 URL の API ベース（`/api` まで含む）。例: `https://example.com/api` |
| `REDIS_URL` | OG 画像を使うとき | 共有 PNG の保存先（既存の Redis 設定を流用） |

開発時の例（Docker Compose + nginx `8080`）:

```bash
PUBLIC_APP_URL=http://localhost:8080
PUBLIC_API_URL=http://localhost:8080/api
```

Vite のみ（`5173`）で試す場合:

```bash
PUBLIC_APP_URL=http://localhost:5173
PUBLIC_API_URL=http://localhost:5173/api
```

### Cloudflare Pages（フロントのみ CDN の場合）

共有 URL が `https://….pages.dev/?diagram_share_id=…` のとき、**X のクローラは JavaScript を実行しない**ため、静的 `index.html` だけでは `og:image` が付きません。`functions/_middleware.js` が、開発時の Vite ミドルウェアと同様に Twitterbot 等を API の `/card` HTML へ転送します。

**`functions` の置き場所**（Cloudflare の **Root directory** に合わせる）:

| Root directory | `functions` のパス |
| --- | --- |
| `frontend` | `frontend/functions/_middleware.js` |
| リポジトリ直下（出力 `frontend/dist`） | `/functions/_middleware.js` |

デプロイログに **Functions** のビルド行があるか確認してください。無い場合は Root と `functions` の位置がずれています。

Pages の **Settings → Environment variables**（Production）に次を設定します（**ビルド専用の `VITE_*` だけでは Functions 実行時に渡りません**）。

| 変数 | 例 |
| --- | --- |
| `API_BASE_URL` | `https://people-relation.saikyonews.com/api` |

動作確認（応答に `X-Diagram-Share-Card: 1` と `og:image` があること）:

```bash
curl -sI -A "Twitterbot/1.0" "https://people-relation.pages.dev/?diagram_share_id=<share_id>"
```

API 側（`backend/.env`）は、共有 URL・画像 URL が実際の公開オリジンと一致すること。

```bash
PUBLIC_APP_URL=https://people-relation.pages.dev
PUBLIC_API_URL=https://people-relation.saikyonews.com/api
```

デプロイ後の確認（サーバーまたは手元）:

```bash
curl -sA "Twitterbot/1.0" "https://people-relation.pages.dev/?diagram_share_id=<share_id>" | grep -E 'og:image|twitter:image'
curl -sI "https://people-relation.saikyonews.com/api/v1/diagram/share/<share_id>/og-image"
```

`og:image` の URL が **200** `image/png` であること。X はカードをキャッシュするため、修正後は [Card Validator](https://cards-dev.twitter.com/validator) で URL を再取得してください（キャッシュだけでは初回失敗分は直りません）。

### `DIAGRAM_SHARE_SECRET_KEY` の生成（本番・ステージング）

鍵は **環境ごとに 1 本**、ランダム生成した値を Git にコミットせず、`.env` やシークレット管理にだけ保存してください。

Fernet は **`cryptography` パッケージに含まれる**機能です（`fernet` という別 pip パッケージはありません）。API 本体は `backend/requirements.txt` に `cryptography` を依存として持っていますが、**ホストの素の `python3` には入っていない**ことが多いです。次のいずれかで実行してください。

**A. バックエンド venv を使う（systemd / 直接デプロイ）**

本リポジトリの API は **Python 3.12** 想定です（`docker/backend/Dockerfile` と同じ）。`python3` が 3.14 など別バージョンだと、venv 内で **実行する Python と pip が入れた先がずれ**、`pip install` 後も `ModuleNotFoundError: No module named 'cryptography'` になることがあります。

```bash
cd backend
# 初回、または venv が壊れているとき（下記「うまくいかないとき」参照）
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

`python3.12` が無い場合は `pyenv` / `apt install python3.12-venv` などで 3.12 を用意するか、**B の Docker** で鍵だけ生成してください。

**A がうまくいかないとき（よくある原因）**

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| `pip install` は成功するが `cryptography` が無い | `.venv/bin/python`（例: 3.12）と、pip がパッケージを入れたバージョン（例: 3.14）が不一致 | venv を作り直す（下記） |
| `python3.12: command not found` | ホストに 3.12 が無い | 3.12 を入れるか **B** を使う |

venv の作り直し:

```bash
cd backend
rm -rf .venv
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -c "import cryptography; print(cryptography.__version__)"
.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

**応急**（venv を触らず鍵だけ欲しい）: pip が入れた方の Python を明示する（`ls .venv/lib/` で `python3.14` などがある場合）:

```bash
.venv/bin/python3.14 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

ただし API 起動も同じ venv の `python` を使うなら、**作り直しの方が安全**です。

**B. Docker Compose の api コンテナで生成（推奨・ローカルに cryptography 不要）**

リポジトリルートで:

```bash
docker compose -f docker/docker-compose.yml run --rm api \
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

**C. 鍵生成だけホストに入れる**

```bash
python3 -m pip install cryptography
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

`ModuleNotFoundError: No module named 'cryptography'` が出た場合は、上記 A〜C のどれかを使ってください（システム Python にグローバル `pip install` するより A または B が安全です）。

標準出力の 1 行（44 文字程度、`A-Za-z0-9_-=`）を `.env` に追記します。

```bash
DIAGRAM_SHARE_SECRET_KEY=（上記コマンドの出力をそのまま貼り付け）
```

Docker Compose 利用時は **リポジトリルートの `.env`**（`docker compose --env-file .env` で読むファイル）に書き、**`api` コンテナを再起動**してください。`backend/.env` だけに書いても Compose の `api` には渡りません。

```bash
# ルート .env に追記したあと
docker compose -f docker/docker-compose.yml --env-file .env up -d --force-recreate api
```

**`apiPostDiagramShare failed: 503`** が出るとき:

| 確認 | 内容 |
| --- | --- |
| 変数名 | `DIAGRAM_SHARE_SECRET_KEY`（スペル・大文字小文字） |
| 置き場所 | Docker 利用時は **リポジトリルート** の `.env` |
| 値 | Fernet 生成コマンドの 1 行そのまま（余計な引用符・改行・先頭スペースなし） |
| 再起動 | `.env` 変更後は `api` を recreate（上記コマンド） |
| コンテナ内 | `docker compose ... exec api printenv DIAGRAM_SHARE_SECRET_KEY` で空でないこと |

503 の本文が「相関図共有は未設定です」なら鍵が空、「形式が不正です」なら鍵の文字列が Fernet 形式ではありません。

注意:

- 鍵を変更すると、既に発行済みの `diagram_share_id` 付き URL はすべて無効になります。
- 本番と開発で同じ鍵を使い回さないでください。
- 形式の詳細と API 仕様は [api.md の §4-4](./api.md#4-4-相関図-url-共有暗号化-share_id) を参照してください。

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

同梱の unit（`deploy/systemd/people-relation-relation-extract.service` / `people-relation-fastapi.service`）は、配置先を **`/var/www/people_relation`**、環境変数を **`/var/www/people_relation/backend/.env`** としています。以下はその前提です。

前提:

- Ubuntu 22.04 / 24.04 など（`systemd` 利用）
- リポジトリを `/var/www/people_relation` に配置済み
- PostgreSQL / Redis に API と同じ接続情報で到達できること
- Python 3.12 と `backend` 用 venv を作成済み

### 1. 専用ユーザーと配置（初回のみ）

```bash
sudo useradd --system --home /var/www/people_relation --shell /usr/sbin/nologin people_relation
sudo mkdir -p /var/www/people_relation
# デプロイ方法に合わせて clone / rsync などでコードを配置
sudo chown -R people_relation:people_relation /var/www/people_relation
```

バックエンドの venv と依存関係（**必ず `python3.12` で venv を作成**し、`pip` / `python` は `.venv/bin/` 配下だけを使う）:

```bash
cd /var/www/people_relation/backend
sudo -u people_relation python3.12 -m venv .venv
sudo -u people_relation .venv/bin/pip install -r requirements.txt
sudo -u people_relation .venv/bin/python -c "import cryptography"
```

`DIAGRAM_SHARE_SECRET_KEY` の生成も同じ `.venv/bin/python` で行う（[相関図 URL 共有の環境変数](#相関図-url-共有の環境変数) の手順 A）。

### 2. 環境変数ファイル

API（`people-relation-fastapi.service`）とワーカー（`people-relation-relation-extract.service`）の両方が、同じ **`backend/.env`** を `EnvironmentFile` で読み込みます（パスワード等は Git に含めない）。

```bash
cd /var/www/people_relation
sudo cp .env.example backend/.env
# DATABASE_URL / REDIS_URL などを編集
sudo nano backend/.env
```

unit の `User` が異なる（API: `www-data`、ワーカー: `people_relation`）ため、`.env` の所有者・グループ・パーミッションは環境に合わせて調整してください（例: グループ `people_relation` に読み取りを付与し、`www-data` をそのグループに追加する）。

### 3. systemd ユニットの登録

リポジトリ同梱の unit をコピーし、パスが異なる場合のみ編集します。

```bash
sudo cp /var/www/people_relation/deploy/systemd/people-relation-relation-extract.service \
  /etc/systemd/system/people-relation-relation-extract.service
# WorkingDirectory / EnvironmentFile / ExecStart が /var/www/people_relation 配下と一致するか確認
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
cd /var/www/people_relation/backend
set -a && source .env && set +a
sudo -u people_relation --preserve-env=DATABASE_URL,REDIS_URL \
  .venv/bin/python -m app.worker.relation_extract --once
```

### 6. オプション（unit の `ExecStart` を編集する場合）

| オプション | 意味 |
| --- | --- |
| `--sleep 10` | 各処理の間隔（秒）。既定 10（`RELATION_EXTRACT_SLEEP_SECONDS` でも指定可） |
| `--max-related 100` | 抽出する関連者上限 |
| `--max-iterations N` | N 回で終了（常駐向きでは通常付けない） |
| `--once` | 1 件のみ（手動テスト向け） |

例: 間隔 60 秒に変更する場合:

```ini
ExecStart=/var/www/people_relation/backend/.venv/bin/python -m app.worker.relation_extract --sleep 60
```

編集後は `sudo systemctl daemon-reload` と `sudo systemctl restart people-relation-relation-extract` を実行してください。

### Docker Compose を使う場合

開発用 compose には `relation_extract_worker` サービスがあります。本番で compose 常駐にする場合は `docker compose up -d relation_extract_worker` で代替できます。VM 上でプロセスを直接管理する場合は上記 systemd を利用してください。

## フロントを CDN（別ホスト）で配信する場合

API と画面のオリジンが分かれるときは、バックエンドの `CORS_ORIGINS` にユーザーが開くフロントの origin（例: `https://cdn.example.com`）を追加する。フロントのビルドでは `VITE_API_BASE_URL` に API のベース URL（例: `https://api.example.com/api`）を渡す。実行時にだけ URL を差し替えたい場合は `index.html` のコメント参照。詳細は [api.md](./api.md) の「CDN・別オリジンでフロントを配信する場合」。
