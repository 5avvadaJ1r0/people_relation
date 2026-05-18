import { isExecutedPrincipalForDiagram } from "../lib/wikiPersonMatch";
import { WIKI_MAX_RELATED_DISPLAY } from "../wikiDisplayConstants";
import type { ApiPerson } from "../lib/types";
import type { PeopleRelationPrincipalDetailModel } from "../peopleRelationAppModel";

type PrincipalRelationsCardProps = {
  principalDetail: PeopleRelationPrincipalDetailModel;
  onAddRelatedPersonToDiagram: (person: ApiPerson) => void;
};

const PRINCIPAL_RELATIONS_COL_COUNT = 5;

const PrincipalRelationsColGroup = () => (
  <colgroup>
    <col className="principalRelationsNameCol" />
    <col className="principalRelationsActionsCol" />
    <col className="principalRelationsScoreCol" />
    <col className="principalRelationsScoreCol" />
    <col className="principalRelationsScoreCol" />
  </colgroup>
);

const PrincipalRelationsScoreSpacerHeaders = () => (
  <>
    <th
      className="principalRelationsScoreCol principalRelationsScoreColSpacer"
      aria-hidden="true"
    />
    <th
      className="principalRelationsScoreCol principalRelationsScoreColSpacer"
      aria-hidden="true"
    />
    <th
      className="principalRelationsScoreCol principalRelationsScoreColSpacer"
      aria-hidden="true"
    />
  </>
);

const PrincipalRelationsScoreSpacerCells = () => (
  <>
    <td
      className="principalRelationsScoreCol principalRelationsScoreColEmpty"
      aria-hidden="true"
    />
    <td
      className="principalRelationsScoreCol principalRelationsScoreColEmpty"
      aria-hidden="true"
    />
    <td
      className="principalRelationsScoreCol principalRelationsScoreColEmpty"
      aria-hidden="true"
    />
  </>
);

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

  const showRelatedRows = relations.length > 0 && displayRelations.length > 0;

  const tableToolbar = (
    <>
      {masterExecutedAtLabel ? (
        <span className="principalRelationsMasterUpdated">
          最終更新: {masterExecutedAtLabel}
        </span>
      ) : null}
      <label className="detailMetaCheckboxLabel">
        <input
          type="checkbox"
          checked={excludeZeroReverse}
          onChange={(e) => setExcludeZeroReverse(e.target.checked)}
        />
        <span>関連値0は除外</span>
      </label>
    </>
  );

  return (
    <div className="card principalRelationsCard" ref={detailRef}>
      <h2>
        ❷ 主体者・関連者
        <span className="subtitle">
          （最大上位{WIKI_MAX_RELATED_DISPLAY}名のみ表示）
        </span>
      </h2>
      {selected ? (
        <>
          <table className="table principalRelationsRelationsTable">
            <PrincipalRelationsColGroup />
            <thead>
              <tr>
                <th>主体者</th>
                <th className="principalRelationsActionsCol"></th>
                <PrincipalRelationsScoreSpacerHeaders />
              </tr>
            </thead>
            <tbody>
              <tr className="principalRelationsMasterRow">
                <td>
                  <a
                    href={selected.serverPerson.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {masterLabel || selected.serverPerson.title}
                  </a>
                </td>
                <td className="principalRelationsActionsCol">
                  <span className="principalRelatedRowActions">
                    {isExecutedPrincipalForDiagram(selected.serverPerson) ? (
                      <button
                        type="button"
                        className="principalDiagramAddLink"
                        onClick={() =>
                          onAddRelatedPersonToDiagram(selected.serverPerson)
                        }
                      >
                        相関図に追加
                      </button>
                    ) : null}
                  </span>
                </td>
                <PrincipalRelationsScoreSpacerCells />
              </tr>
            </tbody>
            {showRelatedRows ? (
              <>
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
                  <tr className="principalRelationsToolbarRow">
                    <td colSpan={PRINCIPAL_RELATIONS_COL_COUNT}>
                      <div className="principalRelationsTableToolbar principalRelationsTableToolbarEmbedded">
                        {tableToolbar}
                      </div>
                    </td>
                  </tr>
                  {displayRelations.map((r) => {
                    const sp = r.slavePerson;
                    const canAddSlaveToDiagram =
                      sp != null && isExecutedPrincipalForDiagram(sp);
                    return (
                      <tr
                        key={`${r.slave.url}-${r.totalPoint}-${r.forwardPoint}`}
                      >
                        <td>
                          <a
                            href={r.slave.url}
                            target="_blank"
                            rel="noreferrer"
                          >
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
                        <td className="principalRelationsScoreCol">
                          {r.forwardPoint}
                        </td>
                        <td className="principalRelationsScoreCol">
                          {r.reversePoint}
                        </td>
                        <td className="principalRelationsScoreCol">
                          <span className="pill">{r.totalPoint}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            ) : null}
          </table>
          {!showRelatedRows ? (
            <div className="principalRelationsTableToolbar">{tableToolbar}</div>
          ) : null}
        </>
      ) : (
        <div className="subtitle" style={{ marginBottom: 10 }}>
          主体者を入力し、サジェストから人物を選択してください。
        </div>
      )}

      {relations.length > 0 && displayRelations.length > 0 ? null : relations.length > 0 ? (
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
