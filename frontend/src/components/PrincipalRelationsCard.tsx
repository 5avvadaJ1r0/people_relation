import { useCallback, useEffect, useMemo, useState } from "react";
import { PrincipalDiagramAddLink } from "./PrincipalDiagramAddLink";
import { PrincipalRelationPersonCell } from "./PrincipalRelationPersonCell";
import { isExecutedPrincipalForDiagram } from "../lib/wikiPersonMatch";
import { WIKI_MAX_RELATED_DISPLAY } from "../wikiDisplayConstants";
import type { ApiPerson } from "../lib/types";
import type { PeopleRelationPrincipalDetailModel } from "../peopleRelationAppModel";

type PrincipalRelationsCardProps = {
  principalDetail: PeopleRelationPrincipalDetailModel;
  diagramCenterPersonIds: ReadonlySet<number>;
  onAddRelatedPersonToDiagram: (person: ApiPerson) => void;
  onAddRelatedPersonsToDiagram: (persons: ApiPerson[]) => void;
  onRemoveRelatedPersonFromDiagram: (personId: number) => void;
  onSelectPrincipal: (person: ApiPerson) => void | Promise<void>;
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
  diagramCenterPersonIds,
  onAddRelatedPersonToDiagram,
  onAddRelatedPersonsToDiagram,
  onRemoveRelatedPersonFromDiagram,
  onSelectPrincipal,
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

  const [diagramAddCheckedIds, setDiagramAddCheckedIds] = useState<Set<number>>(
    () => new Set(),
  );

  const selectedPrincipalId = selected?.serverPerson.id ?? null;

  useEffect(() => {
    setDiagramAddCheckedIds(new Set());
  }, [selectedPrincipalId]);

  const isDiagramAddChecked = useCallback(
    (personId: number) =>
      diagramAddCheckedIds.has(personId) || diagramCenterPersonIds.has(personId),
    [diagramAddCheckedIds, diagramCenterPersonIds],
  );

  const toggleDiagramAddCheck = useCallback(
    (personId: number, checked: boolean) => {
      setDiagramAddCheckedIds((prev) => {
        const next = new Set(prev);
        if (checked) next.add(personId);
        else next.delete(personId);
        return next;
      });
      if (!checked) onRemoveRelatedPersonFromDiagram(personId);
    },
    [onRemoveRelatedPersonFromDiagram],
  );

  const collectCheckedAddablePersons = useCallback((): ApiPerson[] => {
    if (!selected) return [];
    const persons: ApiPerson[] = [];
    const master = selected.serverPerson;
    if (
      isExecutedPrincipalForDiagram(master) &&
      diagramAddCheckedIds.has(master.id)
    ) {
      persons.push(master);
    }
    for (const r of displayRelations) {
      const sp = r.slavePerson;
      if (
        sp != null &&
        isExecutedPrincipalForDiagram(sp) &&
        diagramAddCheckedIds.has(sp.id)
      ) {
        persons.push(sp);
      }
    }
    return persons;
  }, [diagramAddCheckedIds, displayRelations, selected]);

  const checkedAddableCount = useMemo(
    () => collectCheckedAddablePersons().length,
    [collectCheckedAddablePersons],
  );

  const hasAnyDiagramAddablePerson = useMemo(() => {
    if (!selected) return false;
    if (isExecutedPrincipalForDiagram(selected.serverPerson)) return true;
    return displayRelations.some(
      (r) => r.slavePerson != null && isExecutedPrincipalForDiagram(r.slavePerson),
    );
  }, [displayRelations, selected]);

  const handleBulkAddToDiagram = useCallback(() => {
    const persons = collectCheckedAddablePersons();
    if (persons.length === 0) return;
    onAddRelatedPersonsToDiagram(persons);
    setDiagramAddCheckedIds(new Set());
  }, [collectCheckedAddablePersons, onAddRelatedPersonsToDiagram]);

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
        <span>主体値または関連値0は除外</span>
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
      {selected && hasAnyDiagramAddablePerson ? (
        <p className="principalRelationsBulkDiagramAdd">
          <button
            type="button"
            className="principalRelationsBulkDiagramAddLink"
            disabled={checkedAddableCount === 0}
            onClick={handleBulkAddToDiagram}
          >
            チェックした人物をまとめて相関図に追加
          </button>
        </p>
      ) : null}
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
                  <PrincipalRelationPersonCell
                    displayName={masterLabel || selected.serverPerson.title}
                    url={selected.serverPerson.url}
                    person={selected.serverPerson}
                    onSelectPrincipal={onSelectPrincipal}
                  />
                </td>
                <td className="principalRelationsActionsCol">
                  <span className="principalRelatedRowActions">
                    {isExecutedPrincipalForDiagram(selected.serverPerson) ? (
                      <PrincipalDiagramAddLink
                        personName={masterLabel || selected.serverPerson.title}
                        checked={isDiagramAddChecked(selected.serverPerson.id)}
                        onCheckedChange={(checked) =>
                          toggleDiagramAddCheck(selected.serverPerson.id, checked)
                        }
                        onClick={() =>
                          onAddRelatedPersonToDiagram(selected.serverPerson)
                        }
                      />
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
                          <PrincipalRelationPersonCell
                            displayName={r.slave.name}
                            url={r.slave.url}
                            person={sp}
                            onSelectPrincipal={onSelectPrincipal}
                          />
                        </td>
                        <td className="principalRelationsActionsCol">
                          <span className="principalRelatedRowActions">
                            {canAddSlaveToDiagram ? (
                              <PrincipalDiagramAddLink
                                personName={r.slave.name}
                                checked={isDiagramAddChecked(sp.id)}
                                onCheckedChange={(checked) =>
                                  toggleDiagramAddCheck(sp.id, checked)
                                }
                                onClick={() => onAddRelatedPersonToDiagram(sp)}
                              />
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
          主体値または関連値0は除外のため、表示できる関連者がありません。チェックを外すと一覧できます。
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
