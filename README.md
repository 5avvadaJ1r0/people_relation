# 著名人関連者リストアップ

## インフラ構成

- frontend
  - React + TypeScript + Vite

- Backend
  - nginx
  - FastAPI
  - PostgreSQL
  - Redis

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

API と画面のオリジンが分かれるときは、バックエンドの `CORS_ORIGINS` にユーザーが開くフロントの origin（例: `https://cdn.example.com`）を追加する。フロントのビルドでは `VITE_API_BASE_URL` に API のベース URL（例: `https://api.example.com/api`）を渡す。実行時にだけ URL を差し替えたい場合は `index.html` のコメント参照。詳細は [`doc/api.md`](doc/api.md) の「CDN・別オリジンでフロントを配信する場合」。

## 全体の流れ（サーバー中心）

1. **検索（❶〜❷）**
   ブラウザは **MediaWiki / Wikidata に直接アクセスしない**。
   - Wikipedia 側の検索・各候補の **人物判定（Wikidata）** は **`GET /api/v1/wiki/person_search_sse`**（SSE）で実行され、進捗イベントが返る。
   - あわせて保存済み DB 人物のあたり付け用に **`GET /api/v1/person/search`** を **並列**で呼ぶ（検索語が記事タイトルと一致しないとヒットしないため、人物選択後にタイトルでも検索し直して突き合わせる。実装は `frontend/src/lib/wikiPersonMatch.ts`）。

2. **関連抽出（❸）**
   主体記事の **本文・wikitext 解析・2-hop 集計・人物判定** はすべて **`GET /api/v1/wiki/extract_relations_sse`**（SSE）でバックエンドが実行する。クエリ `max_related` で関連者の上限（既定 100、上限 500）を指定できる。

3. **キャッシュ**
   人物判定結果は **`wiki_human_cache`** および **Redis** にキャッシュされる。保存済みの関係データは **PostgreSQL**。

4. **保存**
   SSE の抽出が終わったあと、フロントは **`POST /api/v1/relation`** で関係を保存する（クエリに主体の Wikipedia URL を付与して、同一主体の既存関係を置き換え可能。詳細は下記および [`doc/api.md`](doc/api.md)）。

## 人物のリストアップのアルゴリズム（サーバー側の概要）

実装は `app.services.wiki.extract.two_hop` がオーケストレーションする。**概念としては**次のとおり。

- **検索フェーズ**
  MediaWiki の検索結果をベースに、候補ごとに Wikidata で **人物かどうか** を判定し、人物のみを一覧に載せる（SSE で「検索結果の人物判定」進捗を通知）。

- **抽出フェーズ（2-hop）**
  1. 主体記事について本文・wikitext から候補リンクや表記を集計し、**主体→関連**方向のスコア（forward）を付ける。
  2. 上位候補について関連側記事を参照し、**関連→主体**方向のスコア（reverse）を取り込む。
  3. 同一 Wikipedia 記事に正規化できる関連は **合算**し、**合計スコア（totalPoint）** で並べ替える。
  4. サーバーはこの結果を SSE の `extract_result` で返す（フロントは **主体値 / 関連値 / 合計値** として表示）。

（例）「AAA」と入力した場合

1. Wikipedia の検索結果を人物だけに絞って表示（名前に一致する人物ページのタイトルのリスト）
2. リストから選択すると、その人物ページから関連人物とスコアを抽出する
   https://ja.wikipedia.org/wiki/%E6%9C%A8%E6%9D%91%E6%8B%93%E5%93%89

|主体者|関連者|point（主体→関連の forward など）|
|-|-|-|
|AAA|BBB|10|
|AAA|CCC|8|
|…|…|…|

3. 関連者に Wikipedia の人物記事がある場合は、その記事側から主体への言及も参照してスコアを足し合わせる（reverse）。

4. 最終表示は **totalPoint（forward + reverse を集約した値）** が高い順。画面上位は **`max_related`**（フロントは既定で 100 件）で切り詰める。

## Wikipedia からの抽出結果の保存

抽出が終わったあと、フロントは **`POST /api/v1/relation`** で関係を保存する。抽出計算自体は上記どおりバックエンド SSE で完結している。

- **クエリ `executed_master_url`**（任意）に **主体者の Wikipedia URL** を付けると、その主体を master とする既存の関係行を削除してから upsert する（「この主体で保存し直す」用途）。
- ペイロードでは **主体→関連** のみならず、**関連→主体** 方向で `point > 0` のものもあわせて送る（README末尾の JSON 例のブロック参照）。

## リストアップした結果は以下のフォーマットでサーバー API を実行してデータベースに保存する

- API（FastAPI）: ボディは **JSON 配列**（`RelationIn[]`）。`master` / `slave` には `name` と `url` が必須、`title`（Wikipedia 表示名）は任意。主体の関係を置き換えるときはクエリ **`executed_master_url`** に主体の URL を付与する（詳細は [`doc/api.md`](doc/api.md)）。

```http
POST /api/v1/relation?executed_master_url=https%3A%2F%2Fja.wikipedia.org%2Fwiki%2F...
Content-Type: application/json
```

```json
[
  {
    "master": {
      "name": "AAA",
      "url": "https://ja.wikipedia.org/wiki/%E6%9C%A8%E6%9D%91%E6%8B%93%E5%93%89",
      "title": "AAA BBB"
    },
    "slave": {
      "name": "BBB",
      "url": "https://ja.wikipedia.org/wiki/%E4%B8%AD%E5%B1%85%E6%AD%A3%E5%BA%83",
      "title": "CCC DDD"
    },
    "point": 10
  },
  {
    "master": {
      "name": "BBB",
      "url": "https://ja.wikipedia.org/wiki/%E4%B8%AD%E5%B1%85%E6%AD%A3%E5%BA%83",
      "title": "CCC DDD"
    },
    "slave": {
      "name": "AAA",
      "url": "https://ja.wikipedia.org/wiki/%E6%9C%A8%E6%9D%91%E6%8B%93%E5%93%89",
      "title": "AAA BBB"
    },
    "point": 8
  }
]
```

## API（実装済み）

エンドポイントの詳細・レート制限・エラー形式は [`doc/api.md`](doc/api.md) を参照。

- `GET /api/v1/health`（プロセス生存確認）
- `GET /api/v1/ready`（DB 接続確認）
- `POST /api/v1/relation`（関係データの保存・upsert）
- `GET /api/v1/person/search?name=...`（保存済み人物の検索。`has_relations` は「主体者として関係保存を実行したことがあるか」。レスポンスに `executed_as_master_at` あり）
- `GET /api/v1/person/{person_id}/relations`（主体者の関連者を取得）
- `GET /api/v1/person/{person_id}/relations_aggregate`（forward / reverse を集約した関連者一覧）
- `GET /api/v1/wiki/person_search_sse?q=...`（Wikipedia 検索 + 人物フィルタ、**SSE**）
- `GET /api/v1/wiki/extract_relations_sse?title=...&max_related=...`（2-hop 抽出、**SSE**）

- データベーススキーマ（PostgreSQL）の最新定義: [`doc/ddl_postgres.sql`](doc/ddl_postgres.sql)

### フロント画面の挙動（React）

- **❶ 主体者入力** — 検索語を入力して「検索」。
- **❷ 主体者検索結果** — Wikipedia 側は **`person_search_sse`** の結果（SSE 進捗つき）。同一表示名が複数あるときは記事タイトルで区別表示。
- **❸ 主体者・関連者** — 一覧から「選択」すると次を判定する。
  - 保存済みの `Person` と突き合わせ、`GET /api/v1/person/search` の **`has_relations` が true**（主体として `POST /api/v1/relation` 実行済み）なら、初回から **`GET /api/v1/person/{id}/relations_aggregate`** で **キャッシュ表示**（Wikipedia 負荷軽減）。
  - それ以外は **`extract_relations_sse`** で Wikipedia から抽出し、完了後 **`POST /api/v1/relation`** に **`executed_master_url`** 付きで自動保存。進捗はプログレス表示。
- 関連者テーブルは **主体値（forward） / 関連値（reverse） / 合計値（total）**。既定で **「関連値 0 は除外」** がオン（オフにすると reverse が 0 の行も表示）。
- **「再実行」** は常に **`extract_relations_sse`**（最新の Wikipedia から取り直し）。主体として保存済みの人物には **「キャッシュ再取得」**（`relations_aggregate` のみ）も表示。
- 関連者行の **「主体者として実行」** で、その人物名を検索語に代入して ❷ の検索を実行できる。
- **「戻る」** で検索画面に戻る。

### Wikipedia API の利用について

Wikipedia API は呼び出し頻度にレート制限があるため留意する（[Wikimedia API エチケット](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines) および本リポジトリのサーバー側スロットリングを参照）。

### フロントの単体テスト

```bash
cd frontend && npm test
```

## デモ

- https://people-relation.pages.dev/

## ライセンスとデータソース

本リポジトリのソースコードは **Apache License 2.0** で提供されます（[`LICENSE`](LICENSE) を参照）。

データの取り扱いおよび Wikimedia Foundation との関係については [`NOTICE`](NOTICE) の **Data Source Notice** を参照してください。
