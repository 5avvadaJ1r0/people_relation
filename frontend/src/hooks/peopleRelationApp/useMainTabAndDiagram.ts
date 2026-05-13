import { useCallback, useState } from "react";
import type { ApiPerson } from "../../lib/types";
import type { MainAppTab, SelectedPrincipal } from "../../appScreenTypes";
import { isPrincipalRelationsCacheSource } from "../../lib/wikiPersonMatch";

export const useMainTabAndDiagram = (
  selected: SelectedPrincipal | null,
) => {
  const [mainTab, setMainTab] = useState<MainAppTab>("list");
  const [diagramQueueCenterPerson, setDiagramQueueCenterPerson] = useState<{
    person: ApiPerson;
    requestId: number;
  } | null>(null);
  const onDiagramQueueCenterPersonApplied = useCallback(() => {
    setDiagramQueueCenterPerson(null);
  }, []);

  const onAddPrincipalToDiagram = useCallback(() => {
    const p = selected?.serverPerson;
    if (!p || !isPrincipalRelationsCacheSource(p)) return;
    setDiagramQueueCenterPerson({
      person: p,
      requestId: Date.now(),
    });
    setMainTab("diagram");
  }, [selected]);

  return {
    mainTab,
    setMainTab,
    diagramQueueCenterPerson,
    onDiagramQueueCenterPersonApplied,
    onAddPrincipalToDiagram,
  };
};
