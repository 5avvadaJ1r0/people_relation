import { DiagramTabPanel } from "../ui/DiagramTabPanel";
import type { PeopleRelationAppModel } from "../peopleRelationAppModel";
import { AppHeader } from "./AppHeader";
import { MainTabBar } from "./MainTabBar";
import { PrincipalSearchCard } from "./PrincipalSearchCard";
import { PrincipalRelationsCard } from "./PrincipalRelationsCard";

type PeopleRelationAppViewProps = {
  model: PeopleRelationAppModel;
};

export const PeopleRelationAppView = ({ model }: PeopleRelationAppViewProps) => {
  const { nav, listSearch, principalDetail, error } = model;
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
            <PrincipalSearchCard error={error} listSearch={listSearch} />
            <PrincipalRelationsCard
              principalDetail={principalDetail}
              onAddRelatedPersonToDiagram={nav.onAddRelatedPersonToDiagram}
              onSelectPrincipal={listSearch.onSelectPerson}
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
            onOpenListTabWithPrincipalQuery={nav.onOpenListTabWithPrincipalQuery}
          />
        </div>
      </div>
    </>
  );
};
