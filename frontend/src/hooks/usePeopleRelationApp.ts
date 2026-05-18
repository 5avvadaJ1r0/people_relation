import { useCallback, useRef, useState } from "react";
import type { ApiPerson } from "../lib/types";
import type { PeopleRelationAppModel } from "../peopleRelationAppModel";
import { useMainTabAndDiagram } from "./peopleRelationApp/useMainTabAndDiagram";
import { usePrincipalDetailPhase } from "./peopleRelationApp/usePrincipalDetailPhase";
import { usePrincipalSearchPhase } from "./peopleRelationApp/usePrincipalSearchPhase";

export const usePeopleRelationApp = (): PeopleRelationAppModel => {
  const resetDetailRef = useRef<() => void>(() => {});
  const resetDetailProxy = useCallback(() => {
    resetDetailRef.current();
  }, []);

  const [error, setError] = useState<string | null>(null);

  const search = usePrincipalSearchPhase({
    resetDetail: resetDetailProxy,
    setError,
  });

  const detail = usePrincipalDetailPhase({
    error,
    setError,
  });

  resetDetailRef.current = detail.resetDetail;

  const diagramNav = useMainTabAndDiagram();

  const onOpenListTabWithPrincipalQuery = useCallback(
    (q: string) => {
      search.setQuery(q);
      diagramNav.setMainTab("list");
      window.setTimeout(() => {
        search.queryInputRef.current?.focus();
      }, 0);
    },
    [diagramNav.setMainTab, search.queryInputRef, search.setQuery],
  );

  const onSelectPerson = useCallback(
    async (person: ApiPerson) => {
      search.setQuery(person.name);
      await detail.onSelectPerson(person);
    },
    [detail.onSelectPerson, search.setQuery],
  );

  return {
    error,
    nav: {
      mainTab: diagramNav.mainTab,
      setMainTab: diagramNav.setMainTab,
      diagramQueueCenterPerson: diagramNav.diagramQueueCenterPerson,
      onDiagramQueueCenterPersonApplied: diagramNav.onDiagramQueueCenterPersonApplied,
      onAddRelatedPersonToDiagram: diagramNav.queueCenterPersonIfExecutedMaster,
      onOpenListTabWithPrincipalQuery,
    },
    listSearch: {
      query: search.query,
      setQuery: search.setQuery,
      queryInputRef: search.queryInputRef,
      matches: search.matches,
      suggestFetched: search.suggestFetched,
      suggestFocused: search.suggestFocused,
      setSuggestFocused: search.setSuggestFocused,
      suggestPanelOpen: search.suggestPanelOpen,
      highlightIdx: search.highlightIdx,
      setHighlightIdx: search.setHighlightIdx,
      clearQuery: search.clearQuery,
      minSuggestQueryLen: search.minSuggestQueryLen,
      onSelectPerson,
    },
    principalDetail: {
      detailRef: detail.detailRef,
      selected: detail.selected,
      masterLabel: detail.masterLabel,
      masterExecutedAtLabel: detail.masterExecutedAtLabel,
      excludeZeroReverse: detail.excludeZeroReverse,
      setExcludeZeroReverse: detail.setExcludeZeroReverse,
      displayRelations: detail.displayRelations,
      relations: detail.relations,
      resetDetail: detail.resetDetail,
    },
  };
};

export type { PeopleRelationAppModel } from "../peopleRelationAppModel";
