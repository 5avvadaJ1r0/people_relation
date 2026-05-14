import { isPrincipalRelationsCacheSource } from "../lib/wikiPersonMatch";
import { WIKI_MAX_RELATED_DISPLAY } from "../wikiDisplayConstants";
import type {
  PeopleRelationPrincipalDetailModel,
  PeopleRelationSearchActionsModel,
} from "../peopleRelationAppModel";

type PrincipalRelationsCardProps = {
  busy: boolean;
  searchActions: PeopleRelationSearchActionsModel;
  principalDetail: PeopleRelationPrincipalDetailModel;
  onAddPrincipalToDiagram: () => void;
};

const runAsMasterFromRow =
  (
    busy: boolean,
    setQuery: PeopleRelationSearchActionsModel["setQuery"],
    onSearch: PeopleRelationSearchActionsModel["onSearch"],
  ) =>
  (slaveName: string, slaveTitle: string | undefined) => {
    if (busy) return;
    const q = (slaveTitle ?? slaveName).trim();
    setQuery(q);
    void onSearch(q);
  };

export const PrincipalRelationsCard = ({
  busy,
  searchActions,
  principalDetail,
  onAddPrincipalToDiagram,
}: PrincipalRelationsCardProps) => {
  const { setQuery, onSearch } = searchActions;
  const runAsMaster = runAsMasterFromRow(busy, setQuery, onSearch);
  const {
    detailRef,
    selected,
    masterLabel,
    source,
    masterExecutedAtLabel,
    excludeZeroReverse,
    setExcludeZeroReverse,
    displayRelations,
    relations,
    resetDetail,
    loadFromServer,
    extractFromWikipedia,
  } = principalDetail;

  return (
    <div className="card" ref={detailRef}>
      <h2>
        ❸ 主体者・関連者
        <span className="subtitle">
          （最大上位{WIKI_MAX_RELATED_DISPLAY}名のみ表示）
        </span>
      </h2>
      {selected ? (
        <div className="detailMeta">
          <div className="detailMetaItem detailMetaItemMaster">
            <span className="detailMetaLabel">主体者</span>
            <div className="detailMetaMasterMain">
              <span className="pill">{masterLabel || selected.wiki.title}</span>
              <label className="detailMetaCheckboxLabel">
                <input
                  type="checkbox"
                  checked={excludeZeroReverse}
                  onChange={(e) => setExcludeZeroReverse(e.target.checked)}
                />
                <span>関連値0は除外</span>
              </label>
            </div>
          </div>
          <div className="detailMetaGroup">
            <div className="detailMetaItem">
              <span className="detailMetaLabel">表示元</span>
              <span className="pill">
                {source === "server"
                  ? "キャッシュ"
                  : source === "wikipedia"
                    ? "最新版"
                    : "-"}
              </span>
            </div>
            {masterExecutedAtLabel && (
              <div className="detailMetaItem">
                <span className="detailMetaLabel">最終更新</span>
                <span className="pill">{masterExecutedAtLabel}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="subtitle" style={{ marginBottom: 10 }}>
          主体者検索結果から人物を選択してください。
        </div>
      )}

      {relations.length > 0 && displayRelations.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>関連者</th>
              <th style={{ textAlign: "right" }}></th>
              <th style={{ width: 80, textAlign: "right" }}>主体値</th>
              <th style={{ width: 80, textAlign: "right" }}>関連値</th>
              <th style={{ width: 80, textAlign: "right" }}>合計値</th>
            </tr>
          </thead>
          <tbody>
            {displayRelations.map((r) => (
              <tr key={`${r.slave.url}-${r.totalPoint}-${r.forwardPoint}`}>
                <td>
                  <a href={r.slave.url} target="_blank" rel="noreferrer">
                    {r.slave.name}
                  </a>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="principalRunAsMasterBtn"
                    disabled={busy}
                    onClick={() => runAsMaster(r.slave.name, r.slave.title)}
                  >
                    主体者として実行
                  </button>
                </td>
                <td style={{ textAlign: "right" }}>{r.forwardPoint}</td>
                <td style={{ textAlign: "right" }}>{r.reversePoint}</td>
                <td style={{ textAlign: "right" }}>
                  <span className="pill">{r.totalPoint}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : relations.length > 0 ? (
        <div className="subtitle">
          関連値0は除外のため、表示できる関連者がありません。チェックを外すと一覧できます。
        </div>
      ) : (
        <div className="subtitle">結果はまだありません</div>
      )}

      {selected && (
        <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
          <button disabled={busy} onClick={() => resetDetail()}>
            戻る
          </button>
          {isPrincipalRelationsCacheSource(selected.serverPerson) && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void loadFromServer(selected.serverPerson!)}
              title="キャッシュ再表示"
            >
              キャッシュ再取得
            </button>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() => void extractFromWikipedia(selected.wiki.title)}
          >
            再実行
          </button>
          <button
            type="button"
            className="success"
            disabled={
              busy || !isPrincipalRelationsCacheSource(selected.serverPerson)
            }
            title={
              !isPrincipalRelationsCacheSource(selected.serverPerson)
                ? "主体者として実行済みの人物のみ相関図の中心に追加できます"
                : undefined
            }
            onClick={onAddPrincipalToDiagram}
          >
            主体者を相関図に追加
          </button>
        </div>
      )}
    </div>
  );
};
