import { useCallback, useRef, useState } from "react";
import type { PersonRef, RelationView } from "../types";

export type WikiProgress = { phase: string; done: number; total: number };

export const useWikiTwoHopExtractor = (extractRelationsTwoHop: (params: {
  masterTitle: string;
  masterName: string;
  maxRelated: number;
  onProgress?: (p: WikiProgress) => void;
}) => Promise<{ master: PersonRef; relations: RelationView[] }>) => {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<WikiProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ master: PersonRef; relations: RelationView[] } | null>(null);

  const runSeqRef = useRef(0);
  const cancelledSeqRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    setBusy(false);
    setProgress(null);
    setError(null);
    setResult(null);
  }, []);

  const cancel = useCallback(() => {
    cancelledSeqRef.current = runSeqRef.current;
    setBusy(false);
    setProgress(null);
  }, []);

  const run = useCallback(
    async (p: { masterTitle: string; masterName: string; maxRelated: number }) => {
      const seq = ++runSeqRef.current;
      cancelledSeqRef.current = null;
      setBusy(true);
      setError(null);
      setResult(null);
      setProgress({ phase: "主体者情報取得処理中", done: 0, total: 1 });
      try {
        const out = await extractRelationsTwoHop({
          ...p,
          onProgress: (x) => {
            if (cancelledSeqRef.current === seq) return;
            setProgress(x);
          },
        });
        if (cancelledSeqRef.current === seq) return null;
        setResult(out);
        return out;
      } catch (e: any) {
        if (cancelledSeqRef.current === seq) return null;
        setError(e?.message ?? String(e));
        return null;
      } finally {
        if (cancelledSeqRef.current === seq) return;
        setBusy(false);
      }
    },
    [extractRelationsTwoHop]
  );

  return { busy, progress, error, result, run, reset, cancel };
};

