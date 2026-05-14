import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  apiGetRelationsAggregate,
  apiPostRelations,
  apiSearchPerson,
} from "../../lib/api";
import { trackRelatedSearchPhase2 } from "../../lib/analytics";
import { consumeWikiExtractSse, isAbortError } from "../../lib/wikiSse";
import {
  apiPersonFromPersonOutJson,
  displayPersonNameFromWikiTitle,
  findPostedMasterMatchingExtractMaster,
  isPrincipalRelationsCacheSource,
  mergeRelationViewsWithPostedPersons,
  normWikiTitleForMatch,
  pickServerPersonForWikiTitle,
} from "../../lib/wikiPersonMatch";
import type {
  ApiPerson,
  RelationIn,
  RelationView,
  WikiSearchItem,
} from "../../lib/types";
import type { SelectedPrincipal } from "../../appScreenTypes";
import { WIKI_MAX_RELATED_DISPLAY } from "../../wikiDisplayConstants";
import { devLog } from "./devLog";
import { formatExecutedAsMasterAt } from "./formatExecutedAsMasterAt";
import type { AppProgress } from "./useAppBusyProgress";

export type PrincipalDetailPhaseDeps = {
  serverMatches: ApiPerson[];
  error: string | null;
  progressPhase: string | undefined;
  setError: Dispatch<SetStateAction<string | null>>;
  startBusy: () => void;
  endBusy: () => void;
  setProgress: Dispatch<SetStateAction<AppProgress>>;
};

export const usePrincipalDetailPhase = ({
  serverMatches,
  error,
  progressPhase,
  setError,
  startBusy,
  endBusy,
  setProgress,
}: PrincipalDetailPhaseDeps) => {
  const extractAbortRef = useRef<AbortController | null>(null);
  const ensurePersonAbortRef = useRef<AbortController | null>(null);
  const detailSessionRef = useRef(0);

  const detailRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<SelectedPrincipal | null>(null);

  const [masterLabel, setMasterLabel] = useState<string>("");
  const [relations, setRelations] = useState<RelationView[]>([]);
  const [source, setSource] = useState<"server" | "wikipedia" | "">("");
  const [masterExecutedAt, setMasterExecutedAt] = useState<string | null>(null);
  const masterExecutedAtLabel = formatExecutedAsMasterAt(masterExecutedAt);

  const [principalRelationPostSaved, setPrincipalRelationPostSaved] = useState(false);

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
    setSource("");
    setMasterLabel("");
    setMasterExecutedAt(null);
    setPrincipalRelationPostSaved(false);
    setExcludeZeroReverse(true);
    setProgress(null);
    setError(null);
  }, [setError, setProgress]);

  const bumpDetailSession = useCallback(() => ++detailSessionRef.current, []);

  const resetDetail = useCallback(() => {
    extractAbortRef.current?.abort();
    ensurePersonAbortRef.current?.abort();
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
  }, [selected, relations.length, error, progressPhase]);

  const ensureServerPersonForWikiTitle = async (
    wikiTitle: string,
    currentMatches: ApiPerson[],
    signal?: AbortSignal,
  ): Promise<ApiPerson | undefined> => {
    const hit0 = pickServerPersonForWikiTitle(wikiTitle, currentMatches);
    if (hit0) return hit0;

    const queries = [
      ...new Set(
        [displayPersonNameFromWikiTitle(wikiTitle), wikiTitle]
          .map((q) => q.trim())
          .filter((q) => q.length > 0),
      ),
    ];

    for (const q of queries) {
      try {
        const rows = await apiSearchPerson(q, { signal });
        const hit = pickServerPersonForWikiTitle(wikiTitle, rows);
        if (hit) return hit;
      } catch (e: unknown) {
        if (isAbortError(e)) return undefined;
      }
    }
    return undefined;
  };

  const loadFromServer = useCallback(
    async (p: ApiPerson, parentSession?: number) => {
      const session = parentSession ?? bumpDetailSession();
      startBusy();
      setError(null);
      setProgress({ phase: "キャッシュ取得", done: 0, total: 1 });
      devLog("[App] loadFromServer", { id: p.id, name: p.name, title: p.title });
      try {
        const rels = await apiGetRelationsAggregate(p.id);
        if (session !== detailSessionRef.current) return;
        setMasterLabel(p.title);
        setSource("server");
        setPrincipalRelationPostSaved(false);
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
        setProgress({ phase: "キャッシュ取得", done: 1, total: 1 });
      } catch (e: unknown) {
        if (session !== detailSessionRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        endBusy();
      }
    },
    [bumpDetailSession, endBusy, setError, setProgress, startBusy],
  );

  const extractFromWikipedia = useCallback(
    async (title: string, parentSession?: number) => {
      const session = parentSession ?? bumpDetailSession();

      extractAbortRef.current?.abort();
      const extractAc = new AbortController();
      extractAbortRef.current = extractAc;
      const extractSignal = extractAc.signal;

      startBusy();
      setError(null);
      devLog("[App] extractFromWikipedia start", { title });
      try {
        setPrincipalRelationPostSaved(false);
        const { master, relations: relRows } = await consumeWikiExtractSse(
          title,
          WIKI_MAX_RELATED_DISPLAY,
          {
            signal: extractSignal,
            onProgress: (p) => {
              if (session !== detailSessionRef.current) return;
              setProgress(p);
            },
          },
        );
        if (session !== detailSessionRef.current) return;
        devLog("[App] extractFromWikipedia done", {
          masterTitle: master.title,
          relations: relRows.length,
        });

        setMasterLabel(master.title ?? master.name);
        setSource("wikipedia");
        setRelations(relRows);
        trackRelatedSearchPhase2({
          source: "wikipedia",
          relation_count: relRows.length,
          master_title: master.title ?? master.name,
        });

        const payloadRaw: RelationIn[] = [];
        for (const r of relRows) {
          payloadRaw.push({
            master: { name: master.name, title: master.title, url: master.url },
            slave: { name: r.slave.name, title: r.slave.title, url: r.slave.url },
            point: r.forwardPoint,
          });
          if (r.reversePoint > 0) {
            payloadRaw.push({
              master: {
                name: r.slave.name,
                title: r.slave.title,
                url: r.slave.url,
              },
              slave: { name: master.name, title: master.title, url: master.url },
              point: r.reversePoint,
            });
          }
        }
        const agg = new Map<string, RelationIn>();
        for (const item of payloadRaw) {
          const key = `${item.master.url}||${item.slave.url}`;
          const prev = agg.get(key);
          if (!prev) agg.set(key, item);
          else prev.point += item.point;
        }
        const payload = Array.from(agg.values());
        setProgress({ phase: "キャッシュ保存", done: 0, total: 1 });
        const posted = await apiPostRelations(payload, master.url);
        if (session !== detailSessionRef.current) return;
        setPrincipalRelationPostSaved(true);
        setRelations(mergeRelationViewsWithPostedPersons(relRows, posted));
        const principalMaster = findPostedMasterMatchingExtractMaster(posted, master);
        const executedAt = principalMaster?.executed_as_master_at ?? null;
        setMasterExecutedAt(executedAt ?? null);

        if (principalMaster) {
          const person: ApiPerson = {
            id: principalMaster.id,
            name: principalMaster.name,
            title: principalMaster.title,
            url: principalMaster.url,
            has_relations: principalMaster.has_relations,
            is_executed_master: principalMaster.is_executed_master,
            executed_as_master_at: principalMaster.executed_as_master_at ?? null,
          };
          setSelected((prev) => {
            if (!prev) return prev;
            if (
              normWikiTitleForMatch(prev.wiki.title) !== normWikiTitleForMatch(title)
            ) {
              return prev;
            }
            return { ...prev, serverPerson: person };
          });
        } else {
          const refreshed = await ensureServerPersonForWikiTitle(
            title,
            [],
            extractSignal,
          );
          if (session !== detailSessionRef.current) return;
          if (refreshed) {
            setSelected((prev) => {
              if (!prev) return prev;
              if (
                normWikiTitleForMatch(prev.wiki.title) !== normWikiTitleForMatch(title)
              ) {
                return prev;
              }
              return { ...prev, serverPerson: refreshed };
            });
          }
        }

        setProgress({ phase: "キャッシュ保存", done: 1, total: 1 });
      } catch (e: unknown) {
        if (isAbortError(e) || session !== detailSessionRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        endBusy();
      }
    },
    [bumpDetailSession, endBusy, setError, setProgress, startBusy],
  );

  const onSelect = useCallback(
    async (item: WikiSearchItem) => {
      extractAbortRef.current?.abort();
      ensurePersonAbortRef.current?.abort();
      const ensureAc = new AbortController();
      ensurePersonAbortRef.current = ensureAc;

      const session = bumpDetailSession();
      clearDetailState();

      const m = await ensureServerPersonForWikiTitle(
        item.title,
        serverMatches,
        ensureAc.signal,
      );
      if (session !== detailSessionRef.current) return;

      const sel: SelectedPrincipal = { wiki: item, serverPerson: m };
      setSelected(sel);

      if (m != null && isPrincipalRelationsCacheSource(m)) {
        devLog("[App] onSelect -> server", {
          wikiTitle: item.title,
          serverId: m.id,
        });
        await loadFromServer(m, session);
        return;
      }
      devLog("[App] onSelect -> wikipedia", {
        wikiTitle: item.title,
        serverPersonId: m?.id,
      });
      await extractFromWikipedia(item.title, session);
    },
    [
      bumpDetailSession,
      clearDetailState,
      extractFromWikipedia,
      loadFromServer,
      serverMatches,
    ],
  );

  return {
    detailRef,
    selected,
    masterLabel,
    source,
    masterExecutedAtLabel,
    principalRelationPostSaved,
    excludeZeroReverse,
    setExcludeZeroReverse,
    displayRelations,
    relations,
    resetDetail,
    loadFromServer,
    extractFromWikipedia,
    onSelect,
  };
};
