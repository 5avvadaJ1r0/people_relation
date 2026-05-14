import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiPostDiagramCoreNetwork,
  apiSearchPersonExecutedMasters,
} from "../lib/api";
import { canShareDiagramImage } from "../lib/correlationDiagramExport";
import type { ApiPerson } from "../lib/types";
import type { DiagramRow, TwoCoreLayout } from "../lib/diagramGraph";
import {
  CorrelationDiagramView,
  type CorrelationDiagramViewHandle,
} from "./CorrelationDiagramView";

/** 相関図の中心人物として選べる最大人数（API `CoreNetworkIn` と一致） */
const MAX_DIAGRAM_CENTER = 10;

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

/** Font Awesome Solid「arrow-up-from-bracket」相当（Font Awesome Free 6.5.2 / CC BY 4.0） */
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

export type DiagramTabPanelProps = {
  /** 関連者リスト側から中心人物を追加するときに渡す（`requestId` は同一人物の再追加でも発火させるための nonce） */
  queueCenterPerson?: { person: ApiPerson; requestId: number } | null;
  onQueueCenterPersonApplied?: () => void;
  /** サジェスト空時の案内から「関連者リストアップ」タブへ切替え、主体者入力に相関図タブの入力文字列を渡す */
  onOpenListTabWithPrincipalQuery?: (query: string) => void;
};

export const DiagramTabPanel = ({
  queueCenterPerson = null,
  onQueueCenterPersonApplied,
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
  const [center, setCenter] = useState<ApiPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [rows, setRows] = useState<DiagramRow[]>([]);
  const [totalPointGt, setTotalPointGt] = useState(1);
  /** 中心 2 名の相関図でのみ利用（縦＝上・下 / 横＝左・右） */
  const [twoCoreLayout, setTwoCoreLayout] = useState<TwoCoreLayout>("vertical");
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const diagramViewRef = useRef<CorrelationDiagramViewHandle>(null);
  const [diagramShareReady, setDiagramShareReady] = useState(false);
  const [diagramShareBusy, setDiagramShareBusy] = useState(false);
  const [diagramShareError, setDiagramShareError] = useState<string | null>(
    null,
  );
  const webShareImageSupported = useMemo(() => canShareDiagramImage(), []);

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

  useEffect(() => {
    if (!queueCenterPerson) return;
    const { person } = queueCenterPerson;
    setCenter((prev) => {
      if (prev.some((c) => c.id === person.id)) return prev;
      if (prev.length >= MAX_DIAGRAM_CENTER) return prev;
      return [...prev, person];
    });
    setQuery("");
    setMatches([]);
    setSuggestFetched(false);
    setHighlightIdx(-1);
    onQueueCenterPersonApplied?.();
  }, [queueCenterPerson, onQueueCenterPersonApplied]);

  const removeCenter = (id: number) => {
    setCenter((prev) => prev.filter((c) => c.id !== id));
  };

  const canBuild =
    center.length >= 2 && center.length <= MAX_DIAGRAM_CENTER;

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
      setTotalPointGt(gt);
      setMembers(data.center_titles);
      setRows(
        data.pairs.map((x) => ({
          a: x.person1,
          b: x.person2,
          points: x.total_point,
        })),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const buildDiagram = async () => {
    await loadDiagramWithGt(totalPointGt);
  };

  const thresholdUiActive = members.length > 0 && canBuild;
  const canExpandRelated = totalPointGt > 0 && thresholdUiActive;
  const canShrinkRelated = rows.length > 0 && thresholdUiActive;

  const hasDiagram = useMemo(
    () => members.length > 0 || rows.length > 0,
    [members.length, rows.length],
  );

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

  useEffect(() => {
    if (!hasDiagram) {
      setDiagramShareReady(false);
      setDiagramShareError(null);
    }
  }, [hasDiagram]);

  return (
    <div className="diagramTabGrid">
      <div className="diagramControlSection">
        {error ? (
          <div className="danger diagramControlError">{error}</div>
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
                    disabled={busy || center.length >= MAX_DIAGRAM_CENTER}
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
                      disabled={busy || center.length >= MAX_DIAGRAM_CENTER}
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
                          disabled={busy}
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
              <h2>中心人物（2〜{MAX_DIAGRAM_CENTER}名）</h2>
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
                        disabled={busy}
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
                  disabled={busy || !canBuild}
                  onClick={() => void buildDiagram()}
                >
                  相関図を作成する
                </button>
                <button
                  type="button"
                  disabled={busy || center.length === 0}
                  onClick={() => {
                    setCenter([]);
                    setMembers([]);
                    setRows([]);
                    setTotalPointGt(1);
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

      <div className="diagramFlowSection">
        <div className="card diagramFlowCard">
          <div className="diagramFlowCardHeader">
            <div className="diagramFlowCardTitleRow">
              <h2 className="diagramFlowSectionTitle diagramCardLeadTitle">
                相関図
              </h2>
              {members.length === 2 ? (
                <div className="diagramFlowCardHeaderRight">
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
                </div>
              ) : null}
            </div>
            {members.length > 0 ? (
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
                      中心人物を 2〜{MAX_DIAGRAM_CENTER} 名に戻すと、下のボタンで再取得できます。
                    </span>
                  ) : null}
                </div>
                <div className="row diagramThresholdButtons">
                  <button
                    type="button"
                    disabled={busy || !canExpandRelated}
                    title={
                      totalPointGt <= 0
                        ? "これ以上しきい値を下げられません（n = 0）"
                        : "しきい値を下げて関連者を増やす"
                    }
                    onClick={() => void loadDiagramWithGt(totalPointGt - 1)}
                  >
                    <IconCirclePlus />
                    関連者を増やす
                  </button>
                  <button
                    type="button"
                    disabled={busy || !canShrinkRelated}
                    title={
                      rows.length === 0
                        ? "表示中のペアがないため、これ以上しきい値を上げられません"
                        : "しきい値を上げて関連者を減らす"
                    }
                    onClick={() => void loadDiagramWithGt(totalPointGt + 1)}
                  >
                    <IconCircleMinus />
                    関連者を減らす
                  </button>
                  {hasDiagram && webShareImageSupported ? (
                    <button
                      type="button"
                      className="diagramShareBtn"
                      disabled={
                        busy ||
                        !diagramShareReady ||
                        diagramShareBusy
                      }
                      onClick={() => void onShareDiagramImage()}
                    >
                      <IconArrowUpFromBracket />
                      {diagramShareBusy ? "準備中…" : "相関図を共有"}
                    </button>
                  ) : null}
                </div>
                {hasDiagram && !webShareImageSupported ? (
                  <div className="diagramShareUnsupported diagramThresholdShareUnsupported">
                    この環境では Web Share API（画像）が使えません。
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <CorrelationDiagramView
            ref={diagramViewRef}
            members={members}
            rows={rows}
            twoCoreLayout={twoCoreLayout}
            onDiagramShareReadyChange={setDiagramShareReady}
          />
        </div>
      </div>
    </div>
  );
};
