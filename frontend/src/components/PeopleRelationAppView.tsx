import { DiagramTabPanel } from "../ui/DiagramTabPanel";
import { AppHeader } from "./AppHeader";
import { MainTabBar } from "./MainTabBar";
import { PrincipalSearchCard } from "./PrincipalSearchCard";
import { PrincipalRelationsCard } from "./PrincipalRelationsCard";
import { BusyOverlay } from "./BusyOverlay";
import type { PeopleRelationAppViewModel } from "../hooks/usePeopleRelationApp";

export const PeopleRelationAppView = ({
  mainTab,
  setMainTab,
  diagramQueueCenterPerson,
  onDiagramQueueCenterPersonApplied,
  query,
  setQuery,
  queryInputRef,
  busy,
  onSearch,
  error,
  progress,
  isSearchProgress,
  progressPct,
  wikiResults,
  wikiDisplayNameCounts,
  hasSearched,
  wikiEmptyMessage,
  onSelect,
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
  onAddPrincipalToDiagram,
  busyOverlayCaption,
}: PeopleRelationAppViewModel) => (
  <>
    <div
      className={`container${mainTab === "diagram" ? " containerDiagramLayout" : ""}`}
    >
      <AppHeader />
      <MainTabBar mainTab={mainTab} onTabChange={setMainTab} />

      <div
        id="main-panel-list"
        role="tabpanel"
        aria-labelledby="main-tab-list"
        className="mainTabPanel"
        hidden={mainTab !== "list"}
      >
        <div className="grid">
          <PrincipalSearchCard
            query={query}
            setQuery={setQuery}
            queryInputRef={queryInputRef}
            busy={busy}
            onSearch={onSearch}
            error={error}
            progress={progress}
            isSearchProgress={isSearchProgress}
            progressPct={progressPct}
            wikiResults={wikiResults}
            wikiDisplayNameCounts={wikiDisplayNameCounts}
            hasSearched={hasSearched}
            wikiEmptyMessage={wikiEmptyMessage}
            onSelect={onSelect}
          />
          <PrincipalRelationsCard
            detailRef={detailRef}
            selected={selected}
            masterLabel={masterLabel}
            source={source}
            masterExecutedAtLabel={masterExecutedAtLabel}
            excludeZeroReverse={excludeZeroReverse}
            setExcludeZeroReverse={setExcludeZeroReverse}
            displayRelations={displayRelations}
            relations={relations}
            busy={busy}
            resetDetail={resetDetail}
            loadFromServer={loadFromServer}
            extractFromWikipedia={extractFromWikipedia}
            onSearch={onSearch}
            setQuery={setQuery}
            onAddPrincipalToDiagram={onAddPrincipalToDiagram}
          />
        </div>
      </div>
      <div
        id="main-panel-diagram"
        role="tabpanel"
        aria-labelledby="main-tab-diagram"
        className="mainTabPanel"
        hidden={mainTab !== "diagram"}
      >
        <DiagramTabPanel
          queueCenterPerson={diagramQueueCenterPerson}
          onQueueCenterPersonApplied={onDiagramQueueCenterPersonApplied}
        />
      </div>
    </div>

    {busy ? <BusyOverlay caption={busyOverlayCaption} /> : null}
  </>
);
