# API の利用概要

エンドポイントの詳細・レート制限・エラー形式は [api.md](./api.md) を参照してください。

## Wikipedia からの抽出結果の保存

抽出が終わったあと、フロントは **`POST /api/v1/relation`** で関係を保存する。抽出計算自体は [architecture.md](./architecture.md) のとおりバックエンド SSE で完結している。

- **クエリ `executed_master_url`**（任意）に **主体者の Wikipedia URL** を付けると、その主体を master とする既存の関係行を削除してから upsert する（「この主体で保存し直す」用途）。
- ペイロードでは **主体→関連** のみならず、**関連→主体** 方向で `point > 0` のものもあわせて送る（下記 JSON 例参照）。

## リストアップした結果の保存フォーマット

- API（FastAPI）: ボディは **JSON 配列**（`RelationIn[]`）。`master` / `slave` には `name` と `url` が必須、`title`（Wikipedia 表示名）は任意。主体の関係を置き換えるときはクエリ **`executed_master_url`** に主体の URL を付与する（詳細は [api.md](./api.md)）。

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

## エンドポイント一覧（実装済み）

- `GET /api/v1/health`（プロセス生存確認）
- `GET /api/v1/ready`（DB 接続確認）
- `POST /api/v1/relation`（関係データの保存・upsert）
- `GET /api/v1/person/search?name=...`（保存済み人物の検索。`has_relations` は主体としての `relation` 有無、`is_executed_master` は `executed_as_master` が true のときのみ true）
- `POST /api/v1/person/resolve_wiki_masters`（Wikipedia 検索各行の記事タイトルから canonical URL を組み立て、**主体者実行済み**の `person` を行ごとに返す。❷「相関図に追加」の主突合）
- `GET /api/v1/person/search_executed_masters?name=...`（`executed_as_master = true` の人物のみ検索。❶ 主体者サジェスト・相関図タブ用）
- `POST /api/v1/diagram/core_network`（中心人物 2〜10 名の **無向ペア集約**。リクエストに `total_point_gt` あり。レスポンスは相関図用エッジ一覧）
- `GET /api/v1/person/{person_id}/relations`（主体者の関連者を取得。各 `master` / `slave` に `has_relations` / `is_executed_master` を含む）
- `GET /api/v1/person/{person_id}/relations_aggregate`（forward / reverse を集約した関連者一覧。各人物に `has_relations` / `is_executed_master` を含む）
- `GET /api/v1/wiki/person_search_sse?q=...`（Wikipedia 検索 + 人物フィルタ、**SSE**）
- `GET /api/v1/wiki/extract_relations_sse?title=...&max_related=...`（2-hop 抽出、**SSE**）

データベーススキーマ（PostgreSQL）の最新定義: [ddl_postgres.sql](./ddl_postgres.sql)
