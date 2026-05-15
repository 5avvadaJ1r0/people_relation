"""Wikipedia 2-hop 関連抽出パッケージ。

責務ごとに分離:
- ``models``     型・データクラス・進捗コールバック
- ``quota``      外向き同時実行 / レート制御 / 人物判定バッチ用クォータ
- ``fetcher``    主体記事の各種情報取得・参照 href の補完
- ``ranker``     フォワード候補のスコア構築・上位抽出
- ``canonical_forward_merge`` 転送先が同一のフォワード候補の統合
- ``reverse``    slave 側 reverse スコア計算・並列ワーカー集計
- ``filter``     人物判定・主体除外・正規化マージ
- ``pipeline``   オーケストレーション本体 (``extract_two_hop_relations``)
"""

from app.services.wiki.extract.two_hop.filter import (
    collapse_relations_by_canonical_article,
)
from app.services.wiki.extract.two_hop.models import (
    ForwardCandidate,
    ForwardScoreRow,
    MasterArticleContext,
    ProgressCb,
    SupportsResolveCanonicalTitles,
    WikiQuotaFactory,
    WikilinkCountRow,
    WikiRelationRow,
    WikiSlaveRef,
)
from app.services.wiki.extract.two_hop.pipeline import extract_two_hop_relations

__all__ = [
    "ForwardCandidate",
    "ForwardScoreRow",
    "MasterArticleContext",
    "ProgressCb",
    "SupportsResolveCanonicalTitles",
    "WikiQuotaFactory",
    "WikiRelationRow",
    "WikiSlaveRef",
    "WikilinkCountRow",
    "collapse_relations_by_canonical_article",
    "extract_two_hop_relations",
]
