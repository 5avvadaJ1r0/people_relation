import { isExecutedPrincipalForDiagram } from "../lib/wikiPersonMatch";
import { WIKI_MAX_RELATED_DISPLAY } from "../wikiDisplayConstants";
import type { ApiPerson } from "../lib/types";
import type { PeopleRelationPrincipalDetailModel } from "../peopleRelationAppModel";

type PrincipalRelationsCardProps = {
  principalDetail: PeopleRelationPrincipalDetailModel;
  onAddRelatedPersonToDiagram: (person: ApiPerson) => void;
};

export const PrincipalRelationsCard = ({
  principalDetail,
  onAddRelatedPersonToDiagram,
}: PrincipalRelationsCardProps) => {
  const {
    detailRef,
    selected,
    masterLabel,
    masterExecutedAtLabel,
    excludeZeroReverse,
    setExcludeZeroReverse,
    displayRelations,
    relations,
    resetDetail,
  } = principalDetail;

  return (
    <div className="card principalRelationsCard" ref={detailRef}>
      <h2>
        ❷ 主体者・関連者
        <span className="subtitle">
          （最大上位{WIKI_MAX_RELATED_DISPLAY}名のみ表示）
        </span>
      </h2>
      {selected ? (
        <div className="detailMeta">
          <div className="detailMetaItem detailMetaItemMaster">
            <span className="detailMetaLabel">主体者</span>
            <div className="detailMetaMasterMain">
              <span className="pill">{masterLabel || selected.serverPerson.title}</span>
              {isExecutedPrincipalForDiagram(selected.serverPerson) ? (
                <button
                  type="button"
                  className="principalDiagramAddLink"
                  onClick={() => onAddRelatedPersonToDiagram(selected.serverPerson)}
                >
                  相関図に追加
                </button>
              ) : null}
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
          {masterExecutedAtLabel ? (
            <div className="detailMetaGroup">
              <div className="detailMetaItem">
                <span className="detailMetaLabel">最終更新</span>
                <span className="pill">{masterExecutedAtLabel}</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="subtitle" style={{ marginBottom: 10 }}>
          主体者を入力し、サジェストから人物を選択してください。
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
                          className="principalDiagramAddLink"
                          onClick={() => onAddRelatedPersonToDiagram(sp)}
                        >
                          相関図に追加
                        </button>
                      ) : null}
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
          <button type="button" onClick={() => resetDetail()}>
            戻る
          </button>
        </div>
      )}
    </div>
  );
};
