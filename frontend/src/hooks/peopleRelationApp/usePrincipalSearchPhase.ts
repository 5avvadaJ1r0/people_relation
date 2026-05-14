import { useCallback, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { apiResolveWikiMasters, apiSearchPerson } from "../../lib/api";
import { trackPrincipalInputPhase1 } from "../../lib/analytics";
import { consumeWikiPersonSearchSse, isAbortError } from "../../lib/wikiSse";
import { displayPersonNameFromWikiTitle } from "../../lib/wikiPersonMatch";
import type { ApiPerson, WikiSearchItem } from "../../lib/types";
import type { AppProgress } from "./useAppBusyProgress";

export type PrincipalSearchPhaseDeps = {
  resetDetail: () => void;
  setError: Dispatch<SetStateAction<string | null>>;
  startBusy: () => void;
  endBusy: () => void;
  setProgress: Dispatch<SetStateAction<AppProgress>>;
};

export const usePrincipalSearchPhase = ({
  resetDetail,
  setError,
  startBusy,
  endBusy,
  setProgress,
}: PrincipalSearchPhaseDeps) => {
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const queryInputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [wikiResults, setWikiResults] = useState<WikiSearchItem[]>([]);
  const [serverMatches, setServerMatches] = useState<ApiPerson[]>([]);
  const [wikiMastersByPageId, setWikiMastersByPageId] = useState<
    Record<number, ApiPerson>
  >({});
  const [wikiEmptyMessage, setWikiEmptyMessage] = useState<string | null>(null);

  const wikiDisplayNameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of wikiResults) {
      const k = displayPersonNameFromWikiTitle(r.title);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [wikiResults]);

  const onSearch = useCallback(
    async (queryOverride?: string) => {
      const effectiveQuery = (queryOverride ?? query).trim();
      if (effectiveQuery.length === 0) return;

      searchAbortRef.current?.abort();
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
      setWikiMastersByPageId({});
      setWikiEmptyMessage(null);
      let wikiResultCount = 0;
      let serverMatchCount = 0;
      try {
        const wikiRaw = consumeWikiPersonSearchSse(effectiveQuery, {
          signal: searchSignal,
          onProgress: (p) => {
            if (isStaleSearch()) return;
            setProgress(p);
          },
          onError: (m) => {
            if (isStaleSearch()) return;
            setError(m);
          },
        });

        const wikiP = wikiRaw
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

        const resolveP = wikiRaw
          .then(async (msg) => {
            if (isStaleSearch()) return;
            if (msg.wiki.length === 0) {
              setWikiMastersByPageId({});
              return;
            }
            try {
              const out = await apiResolveWikiMasters(
                msg.wiki.map((w) => ({ title: w.title, pageid: w.pageid })),
                { signal: searchSignal },
              );
              if (isStaleSearch()) return;
              const next: Record<number, ApiPerson> = {};
              for (const row of out.items) {
                if (row.person?.has_relations) {
                  next[row.pageid] = row.person;
                }
              }
              setWikiMastersByPageId(next);
            } catch (e: unknown) {
              if (isAbortError(e) || isStaleSearch()) return;
              setWikiMastersByPageId({});
            }
          })
          .catch((e: unknown) => {
            if (isAbortError(e) || isStaleSearch()) return;
            setWikiMastersByPageId({});
          });

        const serverP = apiSearchPerson(effectiveQuery, {
          signal: searchSignal,
        })
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

        await Promise.all([wikiP, serverP, resolveP]);
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
    },
    [endBusy, query, resetDetail, setError, setProgress, startBusy],
  );

  return {
    query,
    setQuery,
    queryInputRef,
    hasSearched,
    wikiResults,
    serverMatches,
    wikiMastersByPageId,
    wikiEmptyMessage,
    wikiDisplayNameCounts,
    onSearch,
  };
};
