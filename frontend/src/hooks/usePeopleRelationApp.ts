import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiGetRelationsAggregate,
  apiPostRelations,
  apiSearchPerson,
} from "../lib/api";
import {
  trackPrincipalInputPhase1,
  trackRelatedSearchPhase2,
} from "../lib/analytics";
import {
  consumeWikiExtractSse,
  consumeWikiPersonSearchSse,
  isAbortError,
} from "../lib/wikiSse";
import {
  displayPersonNameFromWikiTitle,
  isPrincipalRelationsCacheSource,
  pickServerPersonForWikiTitle,
} from "../lib/wikiPersonMatch";
import type {
  ApiPerson,
  RelationIn,
  RelationView,
  WikiSearchItem,
} from "../lib/types";
import type { MainAppTab, SelectedPrincipal } from "../appScreenTypes";
import { WIKI_MAX_RELATED_DISPLAY } from "../wikiDisplayConstants";

const formatExecutedAsMasterAt = (
  iso: string | null | undefined,
): string | null => {
  if (iso == null || iso === "") return null;
  const executedAt = dayjs(iso);
  if (!executedAt.isValid()) return null;
  return executedAt.format("YYYY年M月D日 H時m分");
};

const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.log(...args);
};

export const usePeopleRelationApp = () => {
  const [mainTab, setMainTab] = useState<MainAppTab>("list");
  const [diagramQueueCenterPerson, setDiagramQueueCenterPerson] = useState<{
    person: ApiPerson;
    requestId: number;
  } | null>(null);
  const onDiagramQueueCenterPersonApplied = useCallback(() => {
    setDiagramQueueCenterPerson(null);
  }, []);
  const [query, setQuery] = useState("");
  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;
  const startBusy = () => setBusyCount((c) => c + 1);
  const endBusy = () => setBusyCount((c) => Math.max(0, c - 1));

  const searchAbortRef = useRef<AbortController | null>(null);
  const extractAbortRef = useRef<AbortController | null>(null);
  const ensurePersonAbortRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const detailSessionRef = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [wikiEmptyMessage, setWikiEmptyMessage] = useState<string | null>(null);

  const [wikiResults, setWikiResults] = useState<WikiSearchItem[]>([]);
  const [serverMatches, setServerMatches] = useState<ApiPerson[]>([]);
  const [selected, setSelected] = useState<SelectedPrincipal | null>(null);

  const wikiDisplayNameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of wikiResults) {
      const k = displayPersonNameFromWikiTitle(r.title);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [wikiResults]);

  const [progress, setProgress] = useState<{
    phase: string;
    done: number;
    total: number;
  } | null>(null);
  const isSearchProgress = progress?.phase === "検索結果の人物判定";
  const progressPct = useMemo(() => {
    if (!progress) return 0;
    if (progress.total <= 0) return 0;
    return Math.round((progress.done / progress.total) * 100);
  }, [progress]);

  const busyOverlayCaption = useMemo(() => {
    if (!progress) return "処理中…";
    return `${progress.phase}（${progress.done}/${progress.total}）`;
  }, [progress]);

  const [masterLabel, setMasterLabel] = useState<string>("");
  const [relations, setRelations] = useState<RelationView[]>([]);
  const [source, setSource] = useState<"server" | "wikipedia" | "">("");
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

  useEffect(() => {
    if (!selected) return;
    const el = detailRef.current;
    if (!el) return;

    const scrollIfNeeded = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      // 画面内に十分入っているならスクロール不要
      if (rect.top >= 0 && rect.bottom <= Math.max(vh * 0.9, 0)) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    // レンダリング反映後に確実にスクロールさせる（iOS/Safari対策で2段）
    const id1 = window.setTimeout(scrollIfNeeded, 0);
    const id2 = window.setTimeout(scrollIfNeeded, 200);
    return () => {
      window.clearTimeout(id1);
      window.clearTimeout(id2);
    };
  }, [selected, relations.length, error, progress?.phase]);

  useEffect(() => {
    if (!busy) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [busy]);

  const clearDetailState = () => {
    setSelected(null);
    setRelations([]);
    setSource("");
    setMasterLabel("");
    setMasterExecutedAt(null);
    setExcludeZeroReverse(true);
    setProgress(null);
    setError(null);
  };

  const resetDetail = () => {
    extractAbortRef.current?.abort();
    ensurePersonAbortRef.current?.abort();
    bumpDetailSession();
    clearDetailState();
  };

  const bumpDetailSession = () => ++detailSessionRef.current;

  const onSearch = async (queryOverride?: string) => {
    const effectiveQuery = (queryOverride ?? query).trim();
    if (effectiveQuery.length === 0) return;

    searchAbortRef.current?.abort();
    extractAbortRef.current?.abort();
    const searchAc = new AbortController();
    searchAbortRef.current = searchAc;
    const searchSignal = searchAc.signal;
    const mySearchId = ++searchRequestIdRef.current;
    const isStaleSearch = () => mySearchId !== searchRequestIdRef.current;

    startBusy();
    setError(null);
    resetDetail();
    setHasSearched(true);
    setWikiResults([]);
    setServerMatches([]);
    setWikiEmptyMessage(null);
    let wikiResultCount = 0;
    let serverMatchCount = 0;
    try {
      const wikiP = consumeWikiPersonSearchSse(effectiveQuery, {
        signal: searchSignal,
        onProgress: (p) => {
          if (isStaleSearch()) return;
          setProgress(p);
        },
        onError: (m) => {
          if (isStaleSearch()) return;
          setError(m);
        },
      })
        .then((msg) => {
          if (isStaleSearch()) return;
          setWikiResults(msg.wiki);
          setWikiEmptyMessage(
            msg.emptyMessage ??
              (msg.wiki.length === 0 ? "該当人物はいません" : null),
          );
          wikiResultCount = msg.wiki.length;
        })
        .catch((e: unknown) => {
          if (isAbortError(e) || isStaleSearch()) return;
          setWikiResults([]);
          setWikiEmptyMessage("該当人物はいません");
          wikiResultCount = 0;
          setError(e instanceof Error ? e.message : String(e));
        });

      const serverP = apiSearchPerson(effectiveQuery, { signal: searchSignal })
        .then((server) => {
          if (isStaleSearch()) return;
          setServerMatches(server);
          serverMatchCount = server.length;
        })
        .catch((e: unknown) => {
          if (isAbortError(e) || isStaleSearch()) return;
          setServerMatches([]);
          serverMatchCount = 0;
          setError(
            (prev) => prev ?? (e instanceof Error ? e.message : String(e)),
          );
        });

      await Promise.all([wikiP, serverP]);
    } catch (e: unknown) {
      if (isAbortError(e) || isStaleSearch()) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!isStaleSearch()) setProgress(null);
      endBusy();
      if (!isStaleSearch()) {
        trackPrincipalInputPhase1({
          query_char_count: effectiveQuery.length,
          wiki_result_count: wikiResultCount,
          server_match_count: serverMatchCount,
        });
      }
    }
  };

  /**
   * 検索クエリと Wikipedia 記事タイトルが一致しないと `serverMatches` に載らない。
   * 選択時に記事タイトル（と括弧を外した表示名）で person/search を補い DB の person を特定する。
   * キャッシュ表示は `has_relations`（主体者として実行済み）が真のときのみ（`isPrincipalRelationsCacheSource`）。
   */
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

  const loadFromServer = async (p: ApiPerson, parentSession?: number) => {
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
      setMasterExecutedAt(p.executed_as_master_at ?? null);
      setRelations(
        rels.map((r) => ({
          slave: { name: r.slave.name, title: r.slave.title, url: r.slave.url },
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
  };

  const extractFromWikipedia = async (
    title: string,
    parentSession?: number,
  ) => {
    const session = parentSession ?? bumpDetailSession();

    extractAbortRef.current?.abort();
    const extractAc = new AbortController();
    extractAbortRef.current = extractAc;
    const extractSignal = extractAc.signal;

    startBusy();
    setError(null);
    devLog("[App] extractFromWikipedia start", { title });
    try {
      const { master, relations } = await consumeWikiExtractSse(
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
        relations: relations.length,
      });

      setMasterLabel(master.title ?? master.name);
      setSource("wikipedia");
      setRelations(relations);
      trackRelatedSearchPhase2({
        source: "wikipedia",
        relation_count: relations.length,
        master_title: master.title ?? master.name,
      });

      // サーバー保存：READMEのフォーマットに寄せて master->slave と slave->master を保存
      const payloadRaw: RelationIn[] = [];
      for (const r of relations) {
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
      // 同一(master.url, slave.url)が重複して送られるとDBユニーク制約で500になるため、ここで集約する
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
      const principalRow = posted.find((x) => x.master.url === master.url)
        ?.master;
      const executedAt =
        principalRow?.executed_as_master_at ??
        posted[0]?.master.executed_as_master_at ??
        null;
      setMasterExecutedAt(executedAt ?? null);

      /**
       * Wikipedia 経路では選択直後の `serverPerson` に `has_relations` が付いていないことがある。
       * 保存成功後はレスポンスの主体者で同期しないと「主体者を相関図に追加」がずっと無効のままになる。
       */
      if (principalRow) {
        const person: ApiPerson = {
          id: principalRow.id,
          name: principalRow.name,
          title: principalRow.title,
          url: principalRow.url,
          has_relations: true,
          executed_as_master_at: principalRow.executed_as_master_at ?? null,
        };
        setSelected((prev) => {
          if (!prev || prev.wiki.title !== title) return prev;
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
            if (!prev || prev.wiki.title !== title) return prev;
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
  };

  const onSelect = async (item: WikiSearchItem) => {
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
  };

  const onAddPrincipalToDiagram = () => {
    const p = selected?.serverPerson;
    if (!p || !isPrincipalRelationsCacheSource(p)) return;
    setDiagramQueueCenterPerson({
      person: p,
      requestId: Date.now(),
    });
    setMainTab("diagram");
  };

  return {
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
  };
};

export type PeopleRelationAppViewModel = ReturnType<
  typeof usePeopleRelationApp
>;
