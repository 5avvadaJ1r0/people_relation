import { isExecutedPrincipalForDiagram, isPrincipalRelationsCacheSource } from "../lib/wikiPersonMatch";
import { WIKI_MAX_RELATED_DISPLAY } from "../wikiDisplayConstants";
import type { ApiPerson } from "../lib/types";
import {
  PrincipalDiagramAddActionIcon,
  PrincipalRelatedSearchActionIcon,
} from "./principalRelatedTableActionIcons";
import type {
  PeopleRelationPrincipalDetailModel,
  PeopleRelationSearchActionsModel,
} from "../peopleRelationAppModel";

type PrincipalRelationsCardProps = {
  busy: boolean;
  searchActions: PeopleRelationSearchActionsModel;
  principalDetail: PeopleRelationPrincipalDetailModel;
  onAddRelatedPersonToDiagram: (person: ApiPerson) => void;
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
  onAddRelatedPersonToDiagram,
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
    <div className="card principalRelationsCard" ref={detailRef}>
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
          主体者検索結果の Wikipedia 行で「関連者を探す」を選んでください。
        </div>
      )}

      {relations.length > 0 && displayRelations.length > 0 ? (
        <table className="table principalRelationsRelationsTable">
          <thead>
            <tr>
              <th>関連者</th>
                <th className="principalRelationsActionsCol"></th>
              <th className="principalRelationsScoreCol">主体値</th>
              <th className="principalRelationsScoreCol">関連値</th>
              <th className="principalRelationsScoreCol">合計値</th>
            </tr>
          </thead>
          <tbody>
            {displayRelations.map((r) => {
              const sp = r.slavePerson;
              const canAddSlaveToDiagram =
                sp != null && isExecutedPrincipalForDiagram(sp);
              return (
              <tr key={`${r.slave.url}-${r.totalPoint}-${r.forwardPoint}`}>
                <td>
                  <a href={r.slave.url} target="_blank" rel="noreferrer">
                    {r.slave.name}
                  </a>
                </td>
                <td className="principalRelationsActionsCol">
                  <span className="principalRelatedRowActions">
                    {canAddSlaveToDiagram ? (
                      <button
                        type="button"
                        className="principalDiagramAddLink principalRelatedTableActionBtn"
                        disabled={busy}
                        aria-label="相関図に追加"
                        title="相関図に追加"
                        onClick={() => onAddRelatedPersonToDiagram(sp)}
                      >
                        <span className="principalRelatedTableActionBtn__icon">
                          <PrincipalDiagramAddActionIcon />
                        </span>
                        <span className="principalRelatedTableActionBtn__label">相関図に追加</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="principalRelatedSearchBtn principalRelatedTableActionBtn"
                      disabled={busy}
                      aria-label="関連者を探す"
                      title="関連者を探す"
                      onClick={() => runAsMaster(r.slave.name, r.slave.title)}
                    >
                      <span className="principalRelatedTableActionBtn__icon">
                        <PrincipalRelatedSearchActionIcon />
                      </span>
                      <span className="principalRelatedTableActionBtn__label">関連者を探す</span>
                    </button>
                  </span>
                </td>
                <td className="principalRelationsScoreCol">{r.forwardPoint}</td>
                <td className="principalRelationsScoreCol">{r.reversePoint}</td>
                <td className="principalRelationsScoreCol">
                  <span className="pill">{r.totalPoint}</span>
                </td>
              </tr>
            );
            })}
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
        </div>
      )}
    </div>
  );
};
