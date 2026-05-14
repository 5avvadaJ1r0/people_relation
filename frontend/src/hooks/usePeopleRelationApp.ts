import { useCallback, useRef, useState } from "react";
import type { PeopleRelationAppModel } from "../peopleRelationAppModel";
import type { ApiPerson, WikiSearchItem } from "../lib/types";
import {
  isExecutedPrincipalForDiagram,
  normWikiTitleForMatch,
  pickServerPersonForWikiTitle,
} from "../lib/wikiPersonMatch";
import { useAppBusyProgress } from "./peopleRelationApp/useAppBusyProgress";
import { useMainTabAndDiagram } from "./peopleRelationApp/useMainTabAndDiagram";
import { usePrincipalDetailPhase } from "./peopleRelationApp/usePrincipalDetailPhase";
import { usePrincipalSearchPhase } from "./peopleRelationApp/usePrincipalSearchPhase";

export const usePeopleRelationApp = (): PeopleRelationAppModel => {
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

  const diagramNav = useMainTabAndDiagram();

  const wikiRowIsCurrentPrincipal = useCallback(
    (item: WikiSearchItem, selectedWiki: WikiSearchItem) => {
      const a = selectedWiki.pageid;
      const b = item.pageid;
      if (a != null && b != null && Number(a) === Number(b)) return true;
      return (
        normWikiTitleForMatch(selectedWiki.title) === normWikiTitleForMatch(item.title)
      );
    },
    [],
  );

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

  const getDiagramPersonIfReadyForWikiRow = useCallback(
    (item: WikiSearchItem): ApiPerson | undefined => {
      const s = detail.selected;
      const relations = detail.relations;
      const serverMatches = search.serverMatches;
      const wikiMastersByPageId = search.wikiMastersByPageId;

      const fromResolve = wikiMastersByPageId[item.pageid];
      if (fromResolve && isExecutedPrincipalForDiagram(fromResolve)) {
        return fromResolve;
      }

      if (s && wikiRowIsCurrentPrincipal(item, s.wiki) && relations.length > 0) {
        const fromSel = s.serverPerson;
        if (fromSel && isExecutedPrincipalForDiagram(fromSel)) return fromSel;
        if (
          fromSel &&
          detail.principalRelationPostSaved &&
          detail.source === "wikipedia"
        ) {
          return {
            ...fromSel,
            has_relations: true,
            is_executed_master: true,
          };
        }
      }

      const fromPick = pickServerPersonForWikiTitle(item.title, serverMatches);
      if (fromPick && isExecutedPrincipalForDiagram(fromPick)) return fromPick;

      return undefined;
    },
    [
      detail.principalRelationPostSaved,
      detail.relations,
      detail.selected,
      detail.source,
      search.serverMatches,
      search.wikiMastersByPageId,
      wikiRowIsCurrentPrincipal,
    ],
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
    appBusy: {
      busy: busy.busy,
      progress: busy.progress,
      isSearchProgress: busy.isSearchProgress,
      progressPct: busy.progressPct,
      busyOverlayCaption: busy.busyOverlayCaption,
    },
    listSearch: {
      query: search.query,
      setQuery: search.setQuery,
      queryInputRef: search.queryInputRef,
      onSearch: search.onSearch,
      hasSearched: search.hasSearched,
      wikiResults: search.wikiResults,
      wikiMastersByPageId: search.wikiMastersByPageId,
      wikiDisplayNameCounts: search.wikiDisplayNameCounts,
      wikiEmptyMessage: search.wikiEmptyMessage,
      onSelect: detail.onSelect,
      getDiagramPersonIfReadyForWikiRow,
      onAddWikiRowPersonToDiagram: diagramNav.queueCenterPersonIfExecutedMaster,
    },
    principalDetail: {
      detailRef: detail.detailRef,
      selected: detail.selected,
      masterLabel: detail.masterLabel,
      source: detail.source,
      masterExecutedAtLabel: detail.masterExecutedAtLabel,
      principalRelationPostSaved: detail.principalRelationPostSaved,
      excludeZeroReverse: detail.excludeZeroReverse,
      setExcludeZeroReverse: detail.setExcludeZeroReverse,
      displayRelations: detail.displayRelations,
      relations: detail.relations,
      resetDetail: detail.resetDetail,
      loadFromServer: detail.loadFromServer,
      extractFromWikipedia: detail.extractFromWikipedia,
    },
  };
};

export type { PeopleRelationAppModel } from "../peopleRelationAppModel";
