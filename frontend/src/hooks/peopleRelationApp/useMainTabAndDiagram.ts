import { useCallback, useState } from "react";
import type { ApiPerson } from "../../lib/types";
import type { MainAppTab } from "../../appScreenTypes";
import { isExecutedPrincipalForDiagram } from "../../lib/wikiPersonMatch";

export const useMainTabAndDiagram = () => {
  const [mainTab, setMainTab] = useState<MainAppTab>("list");
  const [diagramQueueCenterPersons, setDiagramQueueCenterPersons] = useState<{
    persons: ApiPerson[];
    requestId: number;
  } | null>(null);
  const onDiagramQueueCenterPersonsApplied = useCallback(() => {
    setDiagramQueueCenterPersons(null);
  }, []);

  const queueCenterPersonsIfExecutedMasters = useCallback((persons: ApiPerson[]) => {
    const valid = persons.filter((p) => isExecutedPrincipalForDiagram(p));
    if (valid.length === 0) return;
    setDiagramQueueCenterPersons({
      persons: valid,
      requestId: Date.now(),
    });
    setMainTab("diagram");
  }, []);

  const queueCenterPersonIfExecutedMaster = useCallback(
    (person: ApiPerson | undefined | null) => {
      if (!person) return;
      queueCenterPersonsIfExecutedMasters([person]);
    },
    [queueCenterPersonsIfExecutedMasters],
  );

  return {
    mainTab,
    setMainTab,
    diagramQueueCenterPersons,
    onDiagramQueueCenterPersonsApplied,
    queueCenterPersonIfExecutedMaster,
    queueCenterPersonsIfExecutedMasters,
  };
};
