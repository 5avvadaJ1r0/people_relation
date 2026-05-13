import { useCallback, useRef, useState } from "react";
import { useAppBusyProgress } from "./peopleRelationApp/useAppBusyProgress";
import { useMainTabAndDiagram } from "./peopleRelationApp/useMainTabAndDiagram";
import { usePrincipalDetailPhase } from "./peopleRelationApp/usePrincipalDetailPhase";
import { usePrincipalSearchPhase } from "./peopleRelationApp/usePrincipalSearchPhase";

export const usePeopleRelationApp = () => {
  const resetDetailRef = useRef<() => void>(() => {});
  const resetDetailProxy = useCallback(() => {
    resetDetailRef.current();
  }, []);

  const busy = useAppBusyProgress();
  const [error, setError] = useState<string | null>(null);

  const search = usePrincipalSearchPhase({
    resetDetail: resetDetailProxy,
    setError,
    startBusy: busy.startBusy,
    endBusy: busy.endBusy,
    setProgress: busy.setProgress,
  });

  const detail = usePrincipalDetailPhase({
    serverMatches: search.serverMatches,
    error,
    progressPhase: busy.progress?.phase,
    setError,
    startBusy: busy.startBusy,
    endBusy: busy.endBusy,
    setProgress: busy.setProgress,
  });

  resetDetailRef.current = detail.resetDetail;

  const nav = useMainTabAndDiagram(detail.selected);

  return {
    ...nav,
    busy: busy.busy,
    progress: busy.progress,
    isSearchProgress: busy.isSearchProgress,
    progressPct: busy.progressPct,
    busyOverlayCaption: busy.busyOverlayCaption,
    error,
    query: search.query,
    setQuery: search.setQuery,
    queryInputRef: search.queryInputRef,
    onSearch: search.onSearch,
    hasSearched: search.hasSearched,
    wikiResults: search.wikiResults,
    wikiDisplayNameCounts: search.wikiDisplayNameCounts,
    wikiEmptyMessage: search.wikiEmptyMessage,
    detailRef: detail.detailRef,
    selected: detail.selected,
    masterLabel: detail.masterLabel,
    source: detail.source,
    masterExecutedAtLabel: detail.masterExecutedAtLabel,
    excludeZeroReverse: detail.excludeZeroReverse,
    setExcludeZeroReverse: detail.setExcludeZeroReverse,
    displayRelations: detail.displayRelations,
    relations: detail.relations,
    resetDetail: detail.resetDetail,
    loadFromServer: detail.loadFromServer,
    extractFromWikipedia: detail.extractFromWikipedia,
    onSelect: detail.onSelect,
  };
};

export type PeopleRelationAppViewModel = ReturnType<
  typeof usePeopleRelationApp
>;
