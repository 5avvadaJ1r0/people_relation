# ドキュメント

本ディレクトリに README から分割したガイドを置いています。

| ドキュメント | 内容 |
| --- | --- |
| [infrastructure.md](./infrastructure.md) | インフラ構成（フロント・バックエンド） |
| [setup.md](./setup.md) | 開発環境の起動・停止、Gunicorn、関連者抽出ワーカー（systemd）、CDN 配信 |
| [architecture.md](./architecture.md) | 処理の全体像、2-hop アルゴリズムの概要 |
| [api-usage.md](./api-usage.md) | 関係データの保存形式、エンドポイント一覧（概要） |
| [frontend.md](./frontend.md) | 画面の挙動、相関図タブ、フロントテスト |
| [demo-license.md](./demo-license.md) | デモ URL、ライセンス・データソース |

API の詳細（認証、パラメータ、レスポンス例、レート制限、エラー）は [api.md](./api.md) を参照してください。

データベーススキーマ（PostgreSQL）の DDL は [ddl_postgres.sql](./ddl_postgres.sql) です。
