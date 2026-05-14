import { DiagramTabPanel } from "../ui/DiagramTabPanel";
import type { PeopleRelationAppModel } from "../peopleRelationAppModel";
import { AppHeader } from "./AppHeader";
import { MainTabBar } from "./MainTabBar";
import { PrincipalSearchCard } from "./PrincipalSearchCard";
import { PrincipalRelationsCard } from "./PrincipalRelationsCard";
import { BusyOverlay } from "./BusyOverlay";

type PeopleRelationAppViewProps = {
  model: PeopleRelationAppModel;
};

export const PeopleRelationAppView = ({ model }: PeopleRelationAppViewProps) => {
  const { nav, appBusy, listSearch, principalDetail, error } = model;
  return (
    <>
      <div
        className={`container${nav.mainTab === "diagram" ? " containerDiagramLayout" : ""}`}
      >
        <AppHeader />
        <MainTabBar mainTab={nav.mainTab} onTabChange={nav.setMainTab} />

        <div
          id="main-panel-list"
          role="tabpanel"
          aria-labelledby="main-tab-list"
          className="mainTabPanel"
          hidden={nav.mainTab !== "list"}
        >
          <div className="grid">
            <PrincipalSearchCard
              error={error}
              appBusy={appBusy}
              listSearch={listSearch}
            />
            <PrincipalRelationsCard
              busy={appBusy.busy}
              searchActions={{
                setQuery: listSearch.setQuery,
                onSearch: listSearch.onSearch,
              }}
              principalDetail={principalDetail}
              onAddPrincipalToDiagram={nav.onAddPrincipalToDiagram}
            />
          </div>
        </div>
        <div
          id="main-panel-diagram"
          role="tabpanel"
          aria-labelledby="main-tab-diagram"
          className="mainTabPanel"
          hidden={nav.mainTab !== "diagram"}
        >
          <DiagramTabPanel
            queueCenterPerson={nav.diagramQueueCenterPerson}
            onQueueCenterPersonApplied={nav.onDiagramQueueCenterPersonApplied}
          />
        </div>
      </div>

      {appBusy.busy ? <BusyOverlay caption={appBusy.busyOverlayCaption} /> : null}
    </>
  );
};
