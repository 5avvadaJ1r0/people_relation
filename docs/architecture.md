# アーキテクチャとアルゴリズム

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
   SSE の抽出が終わったあと、フロントは **`POST /api/v1/relation`** で関係を保存する（クエリに主体の Wikipedia URL を付与して、同一主体の既存関係を置き換え可能。詳細は [api-usage.md](./api-usage.md) および [api.md](./api.md)）。

5. **相関図（任意）**
   複数の主体者実行済み人物を中心に、保存済みの関係だけから無向ネットワークを描画する。画面の **「相関図作成」** タブと API は [frontend.md](./frontend.md) の「相関図作成タブ」および [api.md](./api.md) を参照。

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
