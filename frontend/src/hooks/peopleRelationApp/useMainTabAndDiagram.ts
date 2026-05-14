import { useCallback, useState } from "react";
import type { ApiPerson } from "../../lib/types";
import type { MainAppTab } from "../../appScreenTypes";
import { isExecutedPrincipalForDiagram } from "../../lib/wikiPersonMatch";

export const useMainTabAndDiagram = () => {
  const [mainTab, setMainTab] = useState<MainAppTab>("list");
  const [diagramQueueCenterPerson, setDiagramQueueCenterPerson] = useState<{
    person: ApiPerson;
    requestId: number;
  } | null>(null);
  const onDiagramQueueCenterPersonApplied = useCallback(() => {
    setDiagramQueueCenterPerson(null);
  }, []);

  const queueCenterPersonIfExecutedMaster = useCallback(
    (person: ApiPerson | undefined | null) => {
      if (!person || !isExecutedPrincipalForDiagram(person)) return;
      setDiagramQueueCenterPerson({
        person,
        requestId: Date.now(),
      });
      setMainTab("diagram");
    },
    [],
  );

  return {
    mainTab,
    setMainTab,
    diagramQueueCenterPerson,
    onDiagramQueueCenterPersonApplied,
    queueCenterPersonIfExecutedMaster,
  };
};
