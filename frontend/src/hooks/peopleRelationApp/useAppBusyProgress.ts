import { useCallback, useEffect, useMemo, useState } from "react";

export type AppProgress = {
  phase: string;
  done: number;
  total: number;
} | null;

export const useAppBusyProgress = () => {
  const [busyCount, setBusyCount] = useState(0);
  const [progress, setProgress] = useState<AppProgress>(null);
  const busy = busyCount > 0;
  const startBusy = useCallback(() => setBusyCount((c) => c + 1), []);
  const endBusy = useCallback(() => setBusyCount((c) => Math.max(0, c - 1)), []);

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

  useEffect(() => {
    if (!busy) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [busy]);

  return {
    busy,
    startBusy,
    endBusy,
    progress,
    setProgress,
    isSearchProgress,
    progressPct,
    busyOverlayCaption,
  };
};
