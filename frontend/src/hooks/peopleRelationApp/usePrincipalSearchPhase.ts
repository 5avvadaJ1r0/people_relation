import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { apiSearchPersonExecutedMasters } from "../../lib/api";
import { trackPrincipalInputPhase1 } from "../../lib/analytics";
import { isAbortError } from "../../lib/wikiSse";
import type { ApiPerson } from "../../lib/types";

const SUGGEST_DEBOUNCE_MS = 320;
const MIN_SUGGEST_QUERY_LEN = 1;

export type PrincipalSearchPhaseDeps = {
  resetDetail: () => void;
  setError: Dispatch<SetStateAction<string | null>>;
};

export const usePrincipalSearchPhase = ({
  resetDetail,
  setError,
}: PrincipalSearchPhaseDeps) => {
  const suggestAbortRef = useRef<AbortController | null>(null);
  const queryInputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ApiPerson[]>([]);
  const [suggestFetched, setSuggestFetched] = useState(false);
  const [suggestFocused, setSuggestFocused] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_SUGGEST_QUERY_LEN) {
      setMatches([]);
      setSuggestFetched(false);
      setHighlightIdx(-1);
      return;
    }

    setMatches([]);
    setSuggestFetched(false);
    suggestAbortRef.current?.abort();
    const ac = new AbortController();
    suggestAbortRef.current = ac;

    const t = window.setTimeout(() => {
      void apiSearchPersonExecutedMasters(q, { signal: ac.signal })
        .then((res) => {
          if (ac.signal.aborted) return;
          setMatches(res);
          setSuggestFetched(true);
          setHighlightIdx(-1);
          trackPrincipalInputPhase1({
            query_char_count: q.length,
            suggest_match_count: res.length,
          });
        })
        .catch((e: unknown) => {
          if (isAbortError(e) || ac.signal.aborted) return;
          setMatches([]);
          setSuggestFetched(true);
          setHighlightIdx(-1);
          setError((prev) => prev ?? (e instanceof Error ? e.message : String(e)));
        });
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query, setError]);

  useEffect(() => {
    setHighlightIdx((idx) => {
      if (idx < 0) return idx;
      return idx >= matches.length ? -1 : idx;
    });
  }, [matches.length]);

  const suggestPanelOpen =
    suggestFocused &&
    query.trim().length >= MIN_SUGGEST_QUERY_LEN &&
    suggestFetched;

  const clearQuery = useCallback(() => {
    resetDetail();
    setQuery("");
    setMatches([]);
    setSuggestFetched(false);
    setHighlightIdx(-1);
    window.setTimeout(() => queryInputRef.current?.focus(), 0);
  }, [resetDetail]);

  return {
    query,
    setQuery,
    queryInputRef,
    matches,
    suggestFetched,
    suggestFocused,
    setSuggestFocused,
    suggestPanelOpen,
    highlightIdx,
    setHighlightIdx,
    clearQuery,
    minSuggestQueryLen: MIN_SUGGEST_QUERY_LEN,
  };
};
