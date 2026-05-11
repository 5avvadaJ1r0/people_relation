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

## 人物名を入力するとWikipediaから該当する人物のページをリストアップする
リストから選択した人物に関連する人物をリストアップする。フロントでは Wikipedia の wikitext・本文から内部リンクや表記の出現を数えてスコア化し、関連記事があれば最大2ホップまで同様に集計する。記事が人物かどうかはバックエンドの Wikidata 判定 API（結果は DB / Redis にキャッシュ）で補助する。

## 人物のリストアップのアルゴリズム
- 人物のページの wikitext 上のリンクや、本文上の表記出現などを候補ごとにカウントする
- カウントした値を point とする（逆向きの共起も関連記事側のページを参照して加算する場合がある）
- 候補に Wikipedia の記事ページがある場合はそのページも参照し、同様にカウントする（2ホップまで）

（例）「AAA」と入力した場合

1. Wikipediaの検索結果を表示（名前に一致する人物ページのタイトルのリスト）
2. リストから選択するとその人物ページ中に出現する人物名と出現回数(point) 抽出する
https://ja.wikipedia.org/wiki/%E6%9C%A8%E6%9D%91%E6%8B%93%E5%93%89

|主体者|関連者|point|
|-|-|-|
|AAA|BBB|10|
|AAA|CCC|8|
|AAA|DDD|7|
|AAA|EEE|6|
|AAA|FFF|6|
|AAA|...|...|


3. 次に上記の「関連者」にWikipediaの人物ページが存在する場合（文中のアンカーで判定）同様に人物名と出現回数(point) 抽出する

- BBB https://ja.wikipedia.org/wiki/%E4%B8%AD%E5%B1%85%E6%AD%A3%E5%BA%83
|主体者|関連者|point|
|-|-|-|
|BBB|AAA|8|
|BBB|...|...|

- CCC https://ja.wikipedia.org/wiki/%E7%A8%B2%E5%9E%A3%E5%90%BE%E9%83%8E
|主体者|関連者|point|
|-|-|-|
|CCC|AAA|7|
|CCC|...|...|

- DDD https://ja.wikipedia.org/wiki/%E9%A6%99%E5%8F%96%E6%85%8E%E5%90%BE
|主体者|関連者|point|
|-|-|-|
|DDD|AAA|2|
|DDD|...|...|

- EEE https://ja.wikipedia.org/wiki/%E5%B7%A5%E8%97%A4%E9%9D%99%E9%A6%99
|主体者|関連者|point|
|-|-|-|
|EEE|AAA|3|
|EEE|...|...|

- FFF https://ja.wikipedia.org/wiki/%E7%A8%B2%E5%9E%A3%E5%90%BE%E9%83%8E
|主体者|関連者|point|
|-|-|-|
|FFF|AAA|1|
|FFF|...|...|

4. 最終的には`point`を元に主体者に対し、pointが高い順に関連者を表示する。

- 主体者
  - AAA

- 関連者
  - BBB (主体者:AAA 関連者:BBB のpoint + 主体者:BBB 関連者:AAA のpoint = 18)
  - CCC (主体者:AAA 関連者:CCC のpoint + 主体者:CCC 関連者:AAA のpoint = 15)
  - ...

## Wikipedia からの抽出およびリストアップの計算は主にフロントで行う（人物判定はバックエンド API とキャッシュを利用）
## リストアップした結果は以下のフォーマットでサーバーAPIを実行してデータベースに保存する

- API（FastAPI）: ボディは **JSON 配列**（`RelationIn[]`）。`master` / `slave` には `name` と `url` が必須、`title`（Wikipedia 表示名）は任意。再実行で主体の関係を置き換えるときはクエリ `executed_master_url` に主体の URL を付与する（詳細は [`doc/api.md`](doc/api.md)）。

```http
POST /api/v1/relation
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
- `GET /api/v1/person/search?name=...`（保存済み人物の検索）
- `GET /api/v1/person/{person_id}/relations`（主体者の関連者を取得）
- `GET /api/v1/person/{person_id}/relations_aggregate`（forward / reverse を集約した関連者一覧）
- `GET /api/v1/wiki/is_human?title=...`（Wikidata による人物判定、キャッシュ利用）

- データベーススキーマ（PostgreSQL）の最新定義: [`doc/ddl_postgres.sql`](doc/ddl_postgres.sql)

5. 「1. Wikipediaの検索結果を表示（名前に一致する人物ページのタイトルのリスト）」の中に既にサーバーに保存した情報があればサーバーの情報を元に関連する人物のリストアップを表示する（Wikipediaに対する負荷対策）

6. Wikipedia APIは呼出頻度にrate制限があるため留意する（APIマニュアル参照）

7. frontend画面構成

- 主体者入力 + 送信
- 該当する人物名一覧表示（リンク）
- リンククリック→Wikipedia抽出 or 自サーバー処理（Wikipediaの場合は時間がかかるので通信中のプログレスバー表示）
- 主体者及び関連者の表示（この時点で自サーバーにも自動保存）、「戻る」で「人物名入力 + 送信」に戻る

8. デモ

- https://people-relation.pages.dev/

## ライセンスとデータソース

本リポジトリのソースコードは **Apache License 2.0** で提供されます（[`LICENSE`](LICENSE) を参照）。

データの取り扱いおよび Wikimedia Foundation との関係については [`NOTICE`](NOTICE) の **Data Source Notice** を参照してください。
