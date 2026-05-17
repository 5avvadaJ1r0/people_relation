import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { apiGetRelationsAggregate } from "../../lib/api";
import { trackRelatedSearchPhase2 } from "../../lib/analytics";
import { apiPersonFromPersonOutJson } from "../../lib/wikiPersonMatch";
import type { ApiPerson, RelationView } from "../../lib/types";
import type { SelectedPrincipal } from "../../appScreenTypes";
import { WIKI_MAX_RELATED_DISPLAY } from "../../wikiDisplayConstants";
import { devLog } from "./devLog";
import { formatExecutedAsMasterAt } from "./formatExecutedAsMasterAt";

export type PrincipalDetailPhaseDeps = {
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
};

export const usePrincipalDetailPhase = ({ error, setError }: PrincipalDetailPhaseDeps) => {
  const detailSessionRef = useRef(0);

  const detailRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<SelectedPrincipal | null>(null);

  const [masterLabel, setMasterLabel] = useState<string>("");
  const [relations, setRelations] = useState<RelationView[]>([]);
  const [masterExecutedAt, setMasterExecutedAt] = useState<string | null>(null);
  const masterExecutedAtLabel = formatExecutedAsMasterAt(masterExecutedAt);

  const [excludeZeroReverse, setExcludeZeroReverse] = useState(true);

  const displayRelations = useMemo(() => {
    let rows = relations;
    if (excludeZeroReverse) {
      rows = rows.filter((r) => r.reversePoint !== 0);
    }
    const sorted = [...rows].sort((a, b) => b.totalPoint - a.totalPoint);
    return sorted.slice(0, WIKI_MAX_RELATED_DISPLAY);
  }, [relations, excludeZeroReverse]);

  const clearDetailState = useCallback(() => {
    setSelected(null);
    setRelations([]);
    setMasterLabel("");
    setMasterExecutedAt(null);
    setExcludeZeroReverse(true);
    setError(null);
  }, [setError]);

  const bumpDetailSession = useCallback(() => ++detailSessionRef.current, []);

  const resetDetail = useCallback(() => {
    bumpDetailSession();
    clearDetailState();
  }, [bumpDetailSession, clearDetailState]);

  useEffect(() => {
    if (!selected) return;
    const el = detailRef.current;
    if (!el) return;

    const scrollIfNeeded = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      if (rect.top >= 0 && rect.bottom <= Math.max(vh * 0.9, 0)) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const id1 = window.setTimeout(scrollIfNeeded, 0);
    const id2 = window.setTimeout(scrollIfNeeded, 200);
    return () => {
      window.clearTimeout(id1);
      window.clearTimeout(id2);
    };
  }, [selected, relations.length, error]);

  const loadFromServer = useCallback(
    async (p: ApiPerson, parentSession?: number) => {
      const session = parentSession ?? bumpDetailSession();
      setError(null);
      devLog("[App] loadFromServer", { id: p.id, name: p.name, title: p.title });
      try {
        const rels = await apiGetRelationsAggregate(p.id);
        if (session !== detailSessionRef.current) return;
        setMasterLabel(p.title);
        setMasterExecutedAt(p.executed_as_master_at ?? null);
        setRelations(
          rels.map((r) => ({
            slave: { name: r.slave.name, title: r.slave.title, url: r.slave.url },
            slavePerson: apiPersonFromPersonOutJson(r.slave),
            forwardPoint: r.forward_point,
            reversePoint: r.reverse_point,
            totalPoint: r.total_point,
            hasWikiPage: true,
          })),
        );
        trackRelatedSearchPhase2({
          source: "server",
          relation_count: rels.length,
          master_title: p.title,
        });
      } catch (e: unknown) {
        if (session !== detailSessionRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [bumpDetailSession, setError],
  );

  const onSelectPerson = useCallback(
    async (person: ApiPerson) => {
      const session = bumpDetailSession();
      clearDetailState();
      setSelected({ serverPerson: person });
      await loadFromServer(person, session);
    },
    [bumpDetailSession, clearDetailState, loadFromServer],
  );

  return {
    detailRef,
    selected,
    masterLabel,
    masterExecutedAtLabel,
    excludeZeroReverse,
    setExcludeZeroReverse,
    displayRelations,
    relations,
    resetDetail,
    onSelectPerson,
  };
};
