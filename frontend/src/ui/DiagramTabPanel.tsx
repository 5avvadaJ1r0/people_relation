import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  MAX_DIAGRAM_CENTER,
  MIN_DIAGRAM_CENTER,
} from "../lib/diagramConstants";
import {
  apiPostDiagramCoreNetwork,
  apiPostDiagramShare,
  apiPutDiagramShareOgImage,
  apiSearchPersonExecutedMasters,
} from "../lib/api";
import { buildDiagramShareText, canShareDiagramImage } from "../lib/correlationDiagramExport";
import { buildDiagramSharePageUrl } from "../lib/diagramShare";
import type { DiagramShareBootstrap } from "../hooks/peopleRelationApp/useDiagramShareFromUrl";
import { applyDiagramShareMeta } from "../lib/diagramShareMeta";
import type { ApiPerson } from "../lib/types";
import {
  filterDiagramRowsForDisplay,
  type DiagramRow,
  type TwoCoreLayout,
} from "../lib/diagramGraph";
import {
  CorrelationDiagramView,
  type CorrelationDiagramViewHandle,
} from "./CorrelationDiagramView";

/** 「相関図を作成する」および中心人物クリア時の関連値しきい値（`SUM(point) > total_point_gt` の gt） */
const DEFAULT_DIAGRAM_TOTAL_POINT_GT = 1;

const SUGGEST_DEBOUNCE_MS = 320;
const MIN_SUGGEST_QUERY_LEN = 1;

const IconCirclePlus = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

const IconCircleMinus = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M8 12h8" />
  </svg>
);

const IconFitDisplay = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M7 3H4a1 1 0 0 0-1 1v3M17 3h3a1 1 0 0 1 1 1v3M7 21H4a1 1 0 0 1-1-1v-3M17 21h3a1 1 0 0 0 1-1v-3" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </svg>
);

const IconExpand = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
);

const IconCircleXmark = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6M9 9l6 6" />
  </svg>
);

/** Font Awesome Solid「arrow-up-from-bracket」相当（Font Awesome Free 6.5.2 / CC BY 4.0） */
const IconLink = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const IconArrowUpFromBracket = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={18}
    height={18}
    viewBox="0 0 512 512"
    fill="currentColor"
    aria-hidden
  >
    <path d="M246.6 9.4c-12.5-12.5-32.8-12.5-45.3 0l-128 128c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 109.3 192 320c0 17.7 14.3 32 32 32s32-14.3 32-32l0-210.7 73.4 73.4c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-128-128zM64 352c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 64c0 53 43 96 96 96l256 0c53 0 96-43 96-96l0-64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 64c0 17.7-14.3 32-32 32L96 448c-17.7 0-32-14.3-32-32l0-64z" />
  </svg>
);

type DiagramThresholdButtonsProps = {
  busy: boolean;
  canExpandRelated: boolean;
  canShrinkRelated: boolean;
  hasDiagram: boolean;
  totalPointGt: number;
  allRowsEmpty: boolean;
  onLoadWithGt: (gt: number) => void;
  onFitDiagramViewport: () => void;
  webShareImageSupported: boolean;
  diagramShareReady: boolean;
  diagramShareBusy: boolean;
  onShareDiagramImage: () => void;
  diagramUrlShareBusy: boolean;
  diagramUrlShareDone: boolean;
  onShareDiagramUrl: () => void;
};

const DiagramThresholdButtons = ({
  busy,
  canExpandRelated,
  canShrinkRelated,
  hasDiagram,
  totalPointGt,
  allRowsEmpty,
  onLoadWithGt,
  onFitDiagramViewport,
  webShareImageSupported,
  diagramShareReady,
  diagramShareBusy,
  onShareDiagramImage,
  diagramUrlShareBusy,
  diagramUrlShareDone,
  onShareDiagramUrl,
}: DiagramThresholdButtonsProps) => (
  <div className="diagramThresholdButtons">
    <button
      type="button"
      className="diagramThresholdBtn"
      disabled={busy || !canExpandRelated}
      aria-label="関連者を増やす"
      title={
        totalPointGt <= 0
          ? "これ以上しきい値を下げられません（n = 0）"
          : "しきい値を下げて関連者を増やす"
      }
      onClick={() => void onLoadWithGt(totalPointGt - 1)}
    >
      <IconCirclePlus />
      <span className="diagramThresholdBtnLabel">関連者を増やす</span>
    </button>
    <button
      type="button"
      className="diagramThresholdBtn"
      disabled={busy || !canShrinkRelated}
      aria-label="関連者を減らす"
      title={
        allRowsEmpty
          ? "表示中のペアがないため、これ以上しきい値を上げられません"
          : "しきい値を上げて関連者を減らす"
      }
      onClick={() => void onLoadWithGt(totalPointGt + 1)}
    >
      <IconCircleMinus />
      <span className="diagramThresholdBtnLabel">関連者を減らす</span>
    </button>
    <button
      type="button"
      className="diagramThresholdBtn"
      disabled={busy || !hasDiagram}
      aria-label="表示サイズ最適化"
      title="ズームと位置を調整し、相関図全体を表示領域に収めます"
      onClick={onFitDiagramViewport}
    >
      <IconFitDisplay />
      <span className="diagramThresholdBtnLabel">表示サイズ最適化</span>
    </button>
    {hasDiagram ? (
      <button
        type="button"
        className="diagramThresholdBtn diagramShareBtn"
        disabled={busy || !diagramShareReady || diagramUrlShareBusy}
        aria-label={
          diagramUrlShareBusy
            ? "URLを共有（準備中）"
            : diagramUrlShareDone
              ? "URLをコピー済み"
              : "URLを共有"
        }
        aria-busy={diagramUrlShareBusy}
        title="相関図の表示条件を含む URL をコピー（X のカード用画像も登録）"
        onClick={() => void onShareDiagramUrl()}
      >
        <IconLink />
        <span className="diagramThresholdBtnLabel">
          {diagramUrlShareBusy
            ? "準備中…"
            : diagramUrlShareDone
              ? "URLコピー済"
              : "URLを共有"}
        </span>
      </button>
    ) : null}
    {hasDiagram && webShareImageSupported ? (
      <button
        type="button"
        className="diagramThresholdBtn diagramShareBtn"
        disabled={busy || !diagramShareReady || diagramShareBusy}
        aria-label={
          diagramShareBusy ? "相関図を共有（準備中）" : "相関図を共有"
        }
        aria-busy={diagramShareBusy}
        title="相関図を画像で共有"
        onClick={() => void onShareDiagramImage()}
      >
        <IconArrowUpFromBracket />
        <span className="diagramThresholdBtnLabel">
          {diagramShareBusy ? "準備中…" : "相関図を共有"}
        </span>
      </button>
    ) : null}
  </div>
);

export type DiagramTabPanelProps = {
  center: ApiPerson[];
  setCenter: Dispatch<SetStateAction<ApiPerson[]>>;
  shareBootstrap?: DiagramShareBootstrap | null;
  shareLoadError?: string | null;
  shareLoading?: boolean;
  /** サジェスト空時の案内から「関連者リストアップ」タブへ切替え、主体者入力に相関図タブの入力文字列を渡す */
  onOpenListTabWithPrincipalQuery?: (query: string) => void;
};

export const DiagramTabPanel = ({
  center,
  setCenter,
  shareBootstrap = null,
  shareLoadError = null,
  shareLoading = false,
  onOpenListTabWithPrincipalQuery,
}: DiagramTabPanelProps) => {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<ApiPerson[]>([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestDebouncing, setSuggestDebouncing] = useState(false);
  const [suggestFetched, setSuggestFetched] = useState(false);
  const [suggestFocused, setSuggestFocused] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  /** API から取得した全エッジ（関連者間リンク含む） */
  const [allRows, setAllRows] = useState<DiagramRow[]>([]);
  /** 関連者同士のリンクを図に含める（既定 OFF） */
  const [showPeerLinks, setShowPeerLinks] = useState(false);
  const [totalPointGt, setTotalPointGt] = useState(DEFAULT_DIAGRAM_TOTAL_POINT_GT);
  /** 中心 2 名の相関図でのみ利用（縦＝上・下 / 横＝左・右） */
  const [twoCoreLayout, setTwoCoreLayout] = useState<TwoCoreLayout>("vertical");
  const [diagramFlowExpanded, setDiagramFlowExpanded] = useState(false);
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const diagramViewRef = useRef<CorrelationDiagramViewHandle>(null);
  const [diagramShareReady, setDiagramShareReady] = useState(false);
  const [diagramShareBusy, setDiagramShareBusy] = useState(false);
  const [diagramShareError, setDiagramShareError] = useState<string | null>(
    null,
  );
  const [diagramUrlShareBusy, setDiagramUrlShareBusy] = useState(false);
  const [diagramUrlShareDone, setDiagramUrlShareDone] = useState(false);
  const appliedShareIdRef = useRef<string | null>(null);
  const diagramUrlShareGenRef = useRef(0);
  const diagramUrlShareDoneTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );
  const webShareImageSupported = useMemo(() => canShareDiagramImage(), []);

  const panelError = error ?? shareLoadError;
  const panelBusy = busy || shareLoading;

  const selectableMatches = useMemo(
    () => matches.filter((p) => !center.some((c) => c.id === p.id)),
    [matches, center],
  );

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_SUGGEST_QUERY_LEN) {
      setMatches([]);
      setSuggestFetched(false);
      setSuggestBusy(false);
      setSuggestDebouncing(false);
      setHighlightIdx(-1);
      return;
    }
    setMatches([]);
    setSuggestFetched(false);
    setSuggestDebouncing(true);
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      setSuggestDebouncing(false);
      setSuggestBusy(true);
      setError(null);
      void apiSearchPersonExecutedMasters(q, { signal: ac.signal })
        .then((res) => {
          if (ac.signal.aborted) return;
          setMatches(res);
          setSuggestFetched(true);
          setHighlightIdx(-1);
        })
        .catch((e: unknown) => {
          if (ac.signal.aborted) return;
          setMatches([]);
          setSuggestFetched(true);
          setHighlightIdx(-1);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!ac.signal.aborted) setSuggestBusy(false);
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ac.abort();
      setSuggestDebouncing(false);
    };
  }, [query]);

  useEffect(() => {
    setHighlightIdx((idx) => {
      if (idx < 0) return idx;
      return idx >= selectableMatches.length ? -1 : idx;
    });
  }, [selectableMatches.length]);

  const suggestPanelOpen =
    suggestFocused &&
    query.trim().length >= MIN_SUGGEST_QUERY_LEN &&
    (suggestDebouncing || suggestBusy || suggestFetched);

  const addCenter = (p: ApiPerson) => {
    if (center.some((c) => c.id === p.id)) return;
    if (center.length >= MAX_DIAGRAM_CENTER) return;
    setCenter((prev) => [...prev, p]);
    setQuery("");
    setMatches([]);
    setSuggestFetched(false);
    setHighlightIdx(-1);
    window.setTimeout(() => queryInputRef.current?.focus(), 0);
  };

  const removeCenter = (id: number) => {
    setCenter((prev) => prev.filter((c) => c.id !== id));
  };

  const canBuild =
    center.length >= MIN_DIAGRAM_CENTER &&
    center.length <= MAX_DIAGRAM_CENTER;

  const applyNetworkResponse = useCallback(
    (
      gt: number,
      data: {
        center_titles: string[];
        pairs: { person1: string; person2: string; total_point: number }[];
      },
    ) => {
      setTotalPointGt(gt);
      setMembers(data.center_titles);
      setAllRows(
        data.pairs.map((x) => ({
          a: x.person1,
          b: x.person2,
          points: x.total_point,
        })),
      );
    },
    [],
  );

  /** `SUM(point) > total_point_gt` で無向ペアを絞り込む。gt を上げると関連者は減り、下げると増える。 */
  const loadDiagramWithGt = async (gt: number) => {
    if (!canBuild) return;
    setBusy(true);
    setError(null);
    try {
      const titles = center.map((c) => c.title);
      const data = await apiPostDiagramCoreNetwork({
        center_titles: titles,
        total_point_gt: gt,
      });
      applyNetworkResponse(gt, data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const buildDiagram = async () => {
    await loadDiagramWithGt(DEFAULT_DIAGRAM_TOTAL_POINT_GT);
  };

  const displayRows = useMemo(
    () => filterDiagramRowsForDisplay(allRows, members, showPeerLinks),
    [allRows, members, showPeerLinks],
  );

  const thresholdUiActive = members.length > 0 && canBuild;
  const canExpandRelated = totalPointGt > 0 && thresholdUiActive;
  const canShrinkRelated = allRows.length > 0 && thresholdUiActive;

  const hasDiagram = useMemo(
    () => members.length > 0 || allRows.length > 0,
    [members.length, allRows.length],
  );

  const loadDiagramWithGtForCenter = useCallback(
    async (persons: ApiPerson[], gt: number) => {
      setBusy(true);
      setError(null);
      try {
        const data = await apiPostDiagramCoreNetwork({
          center_titles: persons.map((c) => c.title),
          total_point_gt: gt,
        });
        applyNetworkResponse(gt, data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [applyNetworkResponse],
  );

  useEffect(() => {
    if (!shareBootstrap) return;
    if (appliedShareIdRef.current === shareBootstrap.shareId) return;
    appliedShareIdRef.current = shareBootstrap.shareId;
    setShowPeerLinks(shareBootstrap.showPeerLinks);
    void loadDiagramWithGtForCenter(
      shareBootstrap.centerPersons,
      shareBootstrap.totalPointGt,
    );
  }, [shareBootstrap, loadDiagramWithGtForCenter]);

  const onShareDiagramUrl = useCallback(async () => {
    if (center.length === 0 || !hasDiagram) return;
    const gen = diagramUrlShareGenRef.current + 1;
    diagramUrlShareGenRef.current = gen;
    if (diagramUrlShareDoneTimerRef.current !== null) {
      window.clearTimeout(diagramUrlShareDoneTimerRef.current);
      diagramUrlShareDoneTimerRef.current = null;
    }
    setDiagramShareError(null);
    setDiagramUrlShareDone(false);
    setDiagramUrlShareBusy(true);
    try {
      const { share_id: shareId } = await apiPostDiagramShare({
        center_person_ids: center.map((c) => c.id),
        show_peer_links: showPeerLinks,
        total_point_gt: totalPointGt,
      });
      if (gen !== diagramUrlShareGenRef.current) return;
      const pageUrl = buildDiagramSharePageUrl(shareId);
      await navigator.clipboard.writeText(pageUrl);
      if (gen !== diagramUrlShareGenRef.current) return;
      const png = await diagramViewRef.current?.captureOgPngBlob();
      if (gen !== diagramUrlShareGenRef.current) return;
      if (png) {
        await apiPutDiagramShareOgImage(shareId, png);
      }
      if (gen !== diagramUrlShareGenRef.current) return;
      const titles = members.length > 0 ? members : center.map((c) => c.title);
      applyDiagramShareMeta({
        shareId,
        title: `相関図: ${titles.join("、")}`,
        description: buildDiagramShareText(titles),
        hasOgImage: Boolean(png),
      });
      setDiagramUrlShareDone(true);
      diagramUrlShareDoneTimerRef.current = window.setTimeout(() => {
        if (gen !== diagramUrlShareGenRef.current) return;
        setDiagramUrlShareDone(false);
        diagramUrlShareDoneTimerRef.current = null;
      }, 4000);
    } catch (e: unknown) {
      if (gen !== diagramUrlShareGenRef.current) return;
      setDiagramShareError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === diagramUrlShareGenRef.current) {
        setDiagramUrlShareBusy(false);
      }
    }
  }, [center, hasDiagram, members, showPeerLinks, totalPointGt]);

  const onShareDiagramImage = useCallback(() => {
    setDiagramShareError(null);
    try {
      const p = diagramViewRef.current?.shareAsImage();
      if (p) {
        setDiagramShareBusy(true);
        void p
          .catch((e: unknown) => {
            if (e instanceof DOMException && e.name === "AbortError") {
              return;
            }
            setDiagramShareError(
              e instanceof Error ? e.message : String(e),
            );
          })
          .finally(() => setDiagramShareBusy(false));
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return;
      }
      setDiagramShareError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const onFitDiagramViewport = useCallback(() => {
    diagramViewRef.current?.fitDisplayToViewport();
  }, []);

  const onExpandDiagramFlow = useCallback(() => {
    setDiagramFlowExpanded(true);
  }, []);

  const onCollapseDiagramFlow = useCallback(() => {
    setDiagramFlowExpanded(false);
  }, []);

  useEffect(() => {
    if (!hasDiagram) {
      setDiagramShareReady(false);
      setDiagramShareError(null);
    }
  }, [hasDiagram]);

  useEffect(
    () => () => {
      if (diagramUrlShareDoneTimerRef.current !== null) {
        window.clearTimeout(diagramUrlShareDoneTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!diagramFlowExpanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [diagramFlowExpanded]);

  useEffect(() => {
    if (!diagramFlowExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDiagramFlowExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [diagramFlowExpanded]);

  const diagramFlowExpandedEverRef = useRef(false);
  useEffect(() => {
    if (!diagramFlowExpandedEverRef.current && !diagramFlowExpanded) return;
    diagramFlowExpandedEverRef.current = true;
    const t = window.setTimeout(() => {
      diagramViewRef.current?.fitDisplayToViewport();
    }, diagramFlowExpanded ? 450 : 120);
    return () => clearTimeout(t);
  }, [diagramFlowExpanded]);

  return (
    <div className="diagramTabGrid">
      <div className="diagramControlSection">
        {panelError ? (
          <div className="danger diagramControlError">{panelError}</div>
        ) : null}

        <div className="diagramTopRow">
          <div className="diagramTopCol">
            <div className="card diagramSearchCard">
              <h2 className="diagramFlowSectionTitle diagramCardLeadTitle">
                中心人物の追加
              </h2>
              <h2>著名人（主体者実行済みのみ）</h2>
              <div className="diagramSuggestWrap">
                <div
                  className={`textInputWrap${center.length >= MAX_DIAGRAM_CENTER ? " diagramCenterInputAtCap" : ""}`}
                >
                  <input
                    ref={queryInputRef}
                    id="diagram-query"
                    name="diagram-query"
                    type="text"
                    role="combobox"
                    aria-expanded={suggestPanelOpen}
                    aria-autocomplete="list"
                    aria-controls="diagram-suggest-listbox"
                    aria-activedescendant={
                      highlightIdx >= 0 && selectableMatches[highlightIdx]
                        ? `diagram-suggest-opt-${selectableMatches[highlightIdx].id}`
                        : undefined
                    }
                    autoComplete="off"
                    value={query}
                    placeholder="氏名の一部を入力して選択"
                    disabled={panelBusy || center.length >= MAX_DIAGRAM_CENTER}
                    title={
                      center.length >= MAX_DIAGRAM_CENTER
                        ? `中心人物は最大${MAX_DIAGRAM_CENTER}名までです（これ以上追加できません）`
                        : undefined
                    }
                    className={query.trim().length > 0 ? "hasRightIcon" : ""}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setSuggestFocused(true)}
                    onBlur={() => {
                      window.setTimeout(() => setSuggestFocused(false), 120);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setHighlightIdx(-1);
                        queryInputRef.current?.blur();
                        return;
                      }
                      if (!suggestPanelOpen) return;
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        if (selectableMatches.length === 0) return;
                        setHighlightIdx((i) =>
                          i < selectableMatches.length - 1 ? i + 1 : 0,
                        );
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        if (selectableMatches.length === 0) return;
                        setHighlightIdx((i) =>
                          i <= 0 ? selectableMatches.length - 1 : i - 1,
                        );
                      } else if (e.key === "Enter") {
                        if (highlightIdx >= 0 && selectableMatches[highlightIdx]) {
                          e.preventDefault();
                          addCenter(selectableMatches[highlightIdx]);
                        }
                      }
                    }}
                  />
                  {query.trim().length > 0 && (
                    <button
                      type="button"
                      className="textInputRightIcon"
                      aria-label="入力をクリア"
                      title="クリア"
                      disabled={panelBusy || center.length >= MAX_DIAGRAM_CENTER}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        setQuery("");
                        setMatches([]);
                        setSuggestFetched(false);
                        setHighlightIdx(-1);
                        window.setTimeout(
                          () => queryInputRef.current?.focus(),
                          0,
                        );
                      }}
                    >
                      <svg
                        viewBox="0 0 20 20"
                        width="16"
                        height="16"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path
                          d="M6.2 6.2a1 1 0 0 1 1.4 0L10 8.6l2.4-2.4a1 1 0 1 1 1.4 1.4L11.4 10l2.4 2.4a1 1 0 0 1-1.4 1.4L10 11.4l-2.4 2.4a1 1 0 0 1-1.4-1.4L8.6 10 6.2 7.6a1 1 0 0 1 0-1.4Z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  )}
                </div>

                {suggestPanelOpen ? (
                  <div
                    id="diagram-suggest-listbox"
                    className="diagramSuggestPanel"
                    role="listbox"
                  >
                    {suggestDebouncing || suggestBusy ? (
                      <div className="diagramSuggestStatus">検索中…</div>
                    ) : selectableMatches.length > 0 ? (
                      selectableMatches.map((p, idx) => (
                        <button
                          key={p.id}
                          type="button"
                          id={`diagram-suggest-opt-${p.id}`}
                          role="option"
                          aria-selected={highlightIdx === idx}
                          className={
                            highlightIdx === idx
                              ? "diagramSuggestOption diagramSuggestOptionActive"
                              : "diagramSuggestOption"
                          }
                          disabled={panelBusy}
                          onMouseDown={(ev) => ev.preventDefault()}
                          onMouseEnter={() => setHighlightIdx(idx)}
                          onClick={() => addCenter(p)}
                        >
                          {p.title}
                        </button>
                      ))
                    ) : (
                      <div className="diagramSuggestEmpty">
                        {center.length >= MAX_DIAGRAM_CENTER
                          ? `中心人物は最大 ${MAX_DIAGRAM_CENTER} 名までです。`
                          : matches.length > 0
                            ? "この検索結果はすべてすでに中心人物に追加されています。"
                            : suggestFetched ? (
                              <span className="diagramSuggestEmptyText">
                                該当する人物がいません。別の文字列を試すか、
                                {onOpenListTabWithPrincipalQuery ? (
                                  <button
                                    type="button"
                                    className="diagramSuggestEmptyLink"
                                    onMouseDown={(ev) => ev.preventDefault()}
                                    onClick={() =>
                                      onOpenListTabWithPrincipalQuery(query)
                                    }
                                    aria-label="関連者リストアップのタブへ移動し、入力中の氏名を主体者入力欄に反映"
                                  >
                                    関連者リストアップ
                                  </button>
                                ) : (
                                  "関連者リストアップ"
                                )}
                                が済んでいるか確認してください。
                              </span>
                            ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              {center.length >= MAX_DIAGRAM_CENTER ? (
                <p className="subtitle" style={{ marginTop: 10 }}>
                  中心人物が上限（{MAX_DIAGRAM_CENTER}名）に達したため、追加の入力はできません。
                </p>
              ) : (
                <p className="subtitle" style={{ marginTop: 10 }}>
                  氏名の一部を入力するとサジェストが表示されます。リストから選ぶと中心人物に追加されます（主体者として実行済みの人物のみ）。
                </p>
              )}
            </div>
          </div>

          <div className="diagramTopCol">
            <div className="card diagramActionCard">
              <h2 className="diagramFlowSectionTitle diagramCardLeadTitle">
                相関図を作成する
              </h2>
              <h2>
                中心人物（{MIN_DIAGRAM_CENTER}〜{MAX_DIAGRAM_CENTER}名）
              </h2>
              <div className="diagramCenterChips">
                {center.length === 0 ? (
                  <div className="subtitle">まだ選んでいません。</div>
                ) : (
                  center.map((p) => (
                    <span key={p.id} className="diagramChip">
                      <span className="diagramChipLabel">{p.title}</span>
                      <button
                        type="button"
                        className="diagramChipRemove"
                        aria-label={`${p.title} を外す`}
                        disabled={panelBusy}
                        onClick={() => removeCenter(p.id)}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>

              <div style={{ marginTop: 14 }} className="row diagramActionButtons">
                <button
                  type="button"
                  className="primary"
                  disabled={panelBusy || !canBuild}
                  onClick={() => void buildDiagram()}
                >
                  相関図を作成する
                </button>
                <button
                  type="button"
                  disabled={panelBusy || center.length === 0}
                  onClick={() => {
                    setCenter([]);
                    setMembers([]);
                    setAllRows([]);
                    setShowPeerLinks(false);
                    setTotalPointGt(DEFAULT_DIAGRAM_TOTAL_POINT_GT);
                    setTwoCoreLayout("vertical");
                    setError(null);
                  }}
                >
                  中心人物をクリア
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={
          diagramFlowExpanded
            ? "diagramFlowSection diagramFlowSectionExpanded"
            : "diagramFlowSection"
        }
      >
        <div className="card diagramFlowCard">
          <div
            className={
              members.length > 0
                ? "diagramFlowCardHeader diagramFlowCardHeader--withMeta"
                : "diagramFlowCardHeader"
            }
          >
            <div className="diagramFlowCardTitleRow">
              <h2 className="diagramFlowSectionTitle diagramCardLeadTitle">
                相関図
              </h2>
              <div className="diagramFlowCardToolbar">
                {members.length > 0 ? (
                  <DiagramThresholdButtons
                    busy={panelBusy}
                    canExpandRelated={canExpandRelated}
                    canShrinkRelated={canShrinkRelated}
                    hasDiagram={hasDiagram}
                    totalPointGt={totalPointGt}
                    allRowsEmpty={allRows.length === 0}
                    onLoadWithGt={(gt) => void loadDiagramWithGt(gt)}
                    onFitDiagramViewport={onFitDiagramViewport}
                    webShareImageSupported={webShareImageSupported}
                    diagramShareReady={diagramShareReady}
                    diagramShareBusy={diagramShareBusy}
                    onShareDiagramImage={onShareDiagramImage}
                    diagramUrlShareBusy={diagramUrlShareBusy}
                    diagramUrlShareDone={diagramUrlShareDone}
                    onShareDiagramUrl={onShareDiagramUrl}
                  />
                ) : null}
                <div className="diagramFlowCardHeaderRight">
                {diagramFlowExpanded ? (
                  <button
                    type="button"
                    className="diagramFlowViewportBtn"
                    aria-label="全画面表示を終了"
                    title="全画面表示を終了"
                    onClick={onCollapseDiagramFlow}
                  >
                    <IconCircleXmark />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="diagramFlowViewportBtn"
                    aria-label="相関図を画面いっぱいに表示"
                    title="相関図を画面いっぱいに表示"
                    onClick={onExpandDiagramFlow}
                  >
                    <IconExpand />
                  </button>
                )}
              {members.length === 2 ? (
                  <div
                    className="diagramTwoCoreLayoutBar"
                    role="group"
                    aria-label="中心2名の並び"
                  >
                    <span className="diagramTwoCoreLayoutLabel">中心の並び</span>
                    <div className="diagramSegmented">
                      <button
                        type="button"
                        className={
                          twoCoreLayout === "vertical"
                            ? "diagramSegmentedBtn diagramSegmentedBtnActive"
                            : "diagramSegmentedBtn"
                        }
                        aria-pressed={twoCoreLayout === "vertical"}
                        onClick={() => setTwoCoreLayout("vertical")}
                      >
                        縦
                      </button>
                      <button
                        type="button"
                        className={
                          twoCoreLayout === "horizontal"
                            ? "diagramSegmentedBtn diagramSegmentedBtnActive"
                            : "diagramSegmentedBtn"
                        }
                        aria-pressed={twoCoreLayout === "horizontal"}
                        onClick={() => setTwoCoreLayout("horizontal")}
                      >
                        横
                      </button>
                    </div>
                  </div>
              ) : null}
                </div>
              </div>
            </div>
            {members.length > 0 ? (
              <div className="diagramThresholdMeta">
                <div className="diagramThresholdBar">
                  {diagramShareError ? (
                    <div className="diagramShareError diagramThresholdShareError">
                      {diagramShareError}
                    </div>
                  ) : null}
                  <div className="diagramThresholdLabel">
                    関連値の合計が{" "}
                    <strong className="diagramThresholdN">{totalPointGt}</strong>{" "}
                    より大きい関係だけを表示しています。
                    {!canBuild ? (
                      <span className="diagramThresholdWarn">
                        {" "}
                        中心人物を {MIN_DIAGRAM_CENTER}〜{MAX_DIAGRAM_CENTER}{" "}
                        名に戻すと、下のボタンで再取得できます。
                      </span>
                    ) : null}
                  </div>
                  <label className="detailMetaCheckboxLabel diagramPeerLinksCheckbox">
                    <input
                      type="checkbox"
                      checked={showPeerLinks}
                      disabled={panelBusy}
                      onChange={(e) => setShowPeerLinks(e.target.checked)}
                    />
                    <span>関連者同士のリンクを表示</span>
                  </label>
                  {hasDiagram && !webShareImageSupported ? (
                    <div className="diagramShareUnsupported diagramThresholdShareUnsupported">
                      この環境では Web Share API（画像）が使えません。
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <CorrelationDiagramView
            ref={diagramViewRef}
            members={members}
            rows={displayRows}
            twoCoreLayout={twoCoreLayout}
            onDiagramShareReadyChange={setDiagramShareReady}
          />
        </div>
      </div>
    </div>
  );
};
