import { useCallback, useState } from "react";
import type { ApiPerson } from "../../lib/types";
import type { MainAppTab } from "../../appScreenTypes";
import { MAX_DIAGRAM_CENTER } from "../../lib/diagramConstants";
import { isExecutedPrincipalForDiagram } from "../../lib/wikiPersonMatch";

const mergeCenterPersons = (
  prev: ApiPerson[],
  persons: readonly ApiPerson[],
): ApiPerson[] => {
  let next = prev;
  for (const person of persons) {
    if (next.some((c) => c.id === person.id)) continue;
    if (next.length >= MAX_DIAGRAM_CENTER) break;
    next = [...next, person];
  }
  return next.length === prev.length ? prev : next;
};

export const useMainTabAndDiagram = () => {
  const [mainTab, setMainTab] = useState<MainAppTab>("list");
  const [diagramCenter, setDiagramCenter] = useState<ApiPerson[]>([]);

  const addCenterPersonsIfExecutedMasters = useCallback((persons: ApiPerson[]) => {
    const valid = persons.filter((p) => isExecutedPrincipalForDiagram(p));
    if (valid.length === 0) return;
    setDiagramCenter((prev) => mergeCenterPersons(prev, valid));
    setMainTab("diagram");
  }, []);

  const addCenterPersonIfExecutedMaster = useCallback(
    (person: ApiPerson | undefined | null) => {
      if (!person) return;
      addCenterPersonsIfExecutedMasters([person]);
    },
    [addCenterPersonsIfExecutedMasters],
  );

  const removeCenterPerson = useCallback((personId: number) => {
    setDiagramCenter((prev) => prev.filter((c) => c.id !== personId));
  }, []);

  return {
    mainTab,
    setMainTab,
    diagramCenter,
    setDiagramCenter,
    addCenterPersonIfExecutedMaster,
    addCenterPersonsIfExecutedMasters,
    removeCenterPerson,
  };
};
