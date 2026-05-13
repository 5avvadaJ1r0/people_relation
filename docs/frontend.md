# フロントエンド

## 画面の挙動（React）

- **❶ 主体者入力** — 検索語を入力して「検索」。
- **❷ 主体者検索結果** — Wikipedia 側は **`person_search_sse`** の結果（SSE 進捗つき）。同一表示名が複数あるときは記事タイトルで区別表示。
- **❸ 主体者・関連者** — 一覧から「選択」すると次を判定する。
  - 保存済みの `Person` と突き合わせ、`GET /api/v1/person/search` の **`has_relations` が true**（主体として `POST /api/v1/relation` 実行済み）なら、初回から **`GET /api/v1/person/{id}/relations_aggregate`** で **キャッシュ表示**（Wikipedia 負荷軽減）。
  - それ以外は **`extract_relations_sse`** で Wikipedia から抽出し、完了後 **`POST /api/v1/relation`** に **`executed_master_url`** 付きで自動保存。進捗はプログレス表示。
- 関連者テーブルは **主体値（forward） / 関連値（reverse） / 合計値（total）**。既定で **「関連値 0 は除外」** がオン（オフにすると reverse が 0 の行も表示）。
- **「再実行」** は常に **`extract_relations_sse`**（最新の Wikipedia から取り直し）。主体として保存済みの人物には **「キャッシュ再取得」**（`relations_aggregate` のみ）も表示。
- 関連者行の **「主体者として実行」** で、その人物名を検索語に代入して ❷ の検索を実行できる。
- **「戻る」** で検索画面に戻る。

## 相関図作成タブ（機能追加）

メイン画面の **「相関図作成」** タブでは、データベースに保存済みの関係（`POST /api/v1/relation` で主体として保存したデータ）だけを使い、**複数の中心人物**を結ぶ無向ネットワークを可視化する。

- **中心人物の選び方** — 氏名の一部で検索し、サジェストから追加する。候補は **いままで主体者として関係保存を実行したことがある人物のみ**（`GET /api/v1/person/search_executed_masters`）。**2〜10 名**選べる。
- **図の生成** — 「相関図を作成する」で **`POST /api/v1/diagram/core_network`** を呼び、中心人物同士および共通の関連者を **無向ペア**（両方向の `point` を合算した `total_point`）として取得し、フロント（React Flow / `@xyflow/react`）でノード・エッジとして描画する。
- **しきい値** — 表示は **`SUM(point) > total_point_gt`** を満たす関係だけに絞る。既定は `total_point_gt = 1`。「関連者を増やす／減らす」でしきい値を前後させ、同じ API で再取得してノード数を調整できる。
- **中心が 2 名のとき** — 2 つのコアノードの配置を **縦（上・下）／横（左・右）** で切り替えられる。
- **共有** — Web Share API で画像共有が使える環境では、描画完了後に **「相関図を共有」** から PNG を共有できる（未対応ブラウザではボタンは出ない）。
- **リストアップ画面からの導線** — 関連者抽出・保存が済んだ主体者について、**「主体者を相関図に追加」** で相関図タブへ移動し、その人物を中心候補としてキュー投入できる。

## Wikipedia API の利用について

Wikipedia API は呼び出し頻度にレート制限があるため留意する（[Wikimedia API エチケット](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines) および本リポジトリのサーバー側スロットリングを参照）。

## フロントの単体テスト

```bash
cd frontend && npm test
```
