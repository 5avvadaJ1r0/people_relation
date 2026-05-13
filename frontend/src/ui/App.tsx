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
import urlQrCodeSvg from "../assets/images/svg/url-qr-code.svg";
import { DiagramTabPanel } from "./DiagramTabPanel";

type Selected = {
  wiki: WikiSearchItem;
  serverPerson?: ApiPerson;
};

/** Wikipedia 経由で取得する関連者の最大件数（抽出パラメータと見出し表示で共通） */
const WIKI_MAX_RELATED_DISPLAY = 100;

const formatExecutedAsMasterAt = (
  iso: string | null | undefined,
): string | null => {
  if (iso == null || iso === "") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours();
  const min = d.getMinutes();
  return `${y}年${mo}月${day}日 ${h}時${min}分`;
};

const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.log(...args);
};

type MainTab = "list" | "diagram";

export const App = () => {
  const [mainTab, setMainTab] = useState<MainTab>("list");
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
  const [selected, setSelected] = useState<Selected | null>(null);

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

    const sel: Selected = { wiki: item, serverPerson: m };
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

  return (
    <>
      <div
        className={`container${mainTab === "diagram" ? " containerDiagramLayout" : ""}`}
      >
        <div className="header">
          <div>
            <div className="title">著名人関連者リストアップ・相関図作成</div>
            <div className="subtitle">
              ネット上から著名人の関連者をリストアップし、相関図を作成するツールです
            </div>
          </div>
          <div className="headerQr" aria-hidden="true">
            <img src={urlQrCodeSvg} alt="" width={68} height={68} />
          </div>
        </div>

        <nav className="mainTabBar" aria-label="機能の切り替え">
          <div className="mainTabList" role="tablist">
            <button
              type="button"
              role="tab"
              id="main-tab-list"
              aria-selected={mainTab === "list"}
              aria-controls="main-panel-list"
              tabIndex={mainTab === "list" ? 0 : -1}
              className={`mainTab ${mainTab === "list" ? "mainTabActive" : ""}`}
              onClick={() => setMainTab("list")}
            >
              関連者リストアップ
            </button>
            <button
              type="button"
              role="tab"
              id="main-tab-diagram"
              aria-selected={mainTab === "diagram"}
              aria-controls="main-panel-diagram"
              tabIndex={mainTab === "diagram" ? 0 : -1}
              className={`mainTab ${mainTab === "diagram" ? "mainTabActive" : ""}`}
              onClick={() => setMainTab("diagram")}
            >
              相関図作成
            </button>
          </div>
        </nav>

        <div
          id="main-panel-list"
          role="tabpanel"
          aria-labelledby="main-tab-list"
          className="mainTabPanel"
          hidden={mainTab !== "list"}
        >
            <div className="grid">
              <div className="card">
            <h2>❶ 主体者入力</h2>
            <div className="row">
              <div className="textInputWrap">
                <input
                  ref={queryInputRef}
                  id="query"
                  name="query"
                  type="text"
                  value={query}
                  placeholder="著名人の氏名を入力してください"
                  className={query.trim().length > 0 ? "hasRightIcon" : ""}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSearch();
                  }}
                />
                {query.trim().length > 0 && (
                  <button
                    type="button"
                    className="textInputRightIcon"
                    aria-label="入力をクリア"
                    title="クリア"
                    onClick={() => {
                      setQuery("");
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
              <button
                className="primary"
                disabled={busy || query.trim().length === 0}
                onClick={() => void onSearch()}
              >
                検索
              </button>
            </div>

            {error && (
              <div style={{ marginTop: 10 }} className="danger">
                {error}
              </div>
            )}

            {progress && isSearchProgress && (
              <div className="progressWrap">
                <div
                  className="muted"
                  style={{ marginBottom: 6, fontSize: 12 }}
                >
                  {progress.phase}（{progress.done}/{progress.total}）
                </div>
                <div className="progress">
                  <div className="bar" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}

            <h2 style={{ marginTop: 14 }}>❷ 主体者検索結果</h2>
            <div className="list">
              {wikiResults.map((r) => {
                const displayName = displayPersonNameFromWikiTitle(r.title);
                const isAmbiguous =
                  (wikiDisplayNameCounts.get(displayName) ?? 0) >= 2;
                const label = isAmbiguous ? r.title : displayName;
                return (
                  <div key={r.pageid} className="item">
                    <div className="itemTitle">
                      <div style={{ fontWeight: 700 }}>{label}</div>
                    </div>
                    <div
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <button disabled={busy} onClick={() => onSelect(r)}>
                        選択
                      </button>
                    </div>
                  </div>
                );
              })}
              {wikiResults.length === 0 && !hasSearched && (
                <div className="subtitle">まだ検索していません。</div>
              )}
              {wikiResults.length === 0 && hasSearched && wikiEmptyMessage && (
                <div className="subtitle">{wikiEmptyMessage}</div>
              )}
            </div>

            {progress && !isSearchProgress && (
              <div className="progressWrap">
                <div
                  className="muted"
                  style={{ marginBottom: 6, fontSize: 12 }}
                >
                  {progress.phase}（{progress.done}/{progress.total}）
                </div>
                <div className="progress">
                  <div className="bar" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}
              </div>

              <div className="card" ref={detailRef}>
            <h2>
              ❸ 主体者・関連者
              <span className="subtitle">
                （最大上位{WIKI_MAX_RELATED_DISPLAY}名のみ表示）
              </span>
            </h2>
            {selected ? (
              <div className="detailMeta">
                <div className="detailMetaItem detailMetaItemMaster">
                  <span className="detailMetaLabel">主体者</span>
                  <div className="detailMetaMasterMain">
                    <span className="pill">
                      {masterLabel || selected.wiki.title}
                    </span>
                    <label className="detailMetaCheckboxLabel">
                      <input
                        type="checkbox"
                        checked={excludeZeroReverse}
                        onChange={(e) =>
                          setExcludeZeroReverse(e.target.checked)
                        }
                      />
                      <span>関連値0は除外</span>
                    </label>
                  </div>
                </div>
                <div className="detailMetaGroup">
                  <div className="detailMetaItem">
                    <span className="detailMetaLabel">表示元</span>
                    <span className="pill">
                      {source === "server"
                        ? "キャッシュ"
                        : source === "wikipedia"
                          ? "最新版"
                          : "-"}
                    </span>
                  </div>
                  {masterExecutedAtLabel && (
                    <div className="detailMetaItem">
                      <span className="detailMetaLabel">最終更新</span>
                      <span className="pill">{masterExecutedAtLabel}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="subtitle" style={{ marginBottom: 10 }}>
                主体者検索結果から人物を選択してください。
              </div>
            )}

            {relations.length > 0 && displayRelations.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>関連者</th>
                    <th style={{ textAlign: "right" }}></th>
                    <th style={{ width: 80, textAlign: "right" }}>主体値</th>
                    <th style={{ width: 80, textAlign: "right" }}>関連値</th>
                    <th style={{ width: 80, textAlign: "right" }}>合計値</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRelations.map((r) => (
                    <tr
                      key={`${r.slave.url}-${r.totalPoint}-${r.forwardPoint}`}
                    >
                      <td>
                        <a href={r.slave.url} target="_blank" rel="noreferrer">
                          {r.slave.name}
                        </a>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="principalRunAsMasterBtn"
                          disabled={busy}
                          onClick={() => {
                            const q = (r.slave.title ?? r.slave.name).trim();
                            setQuery(q);
                            void onSearch(q);
                          }}
                        >
                          主体者として実行
                        </button>
                      </td>
                      <td style={{ textAlign: "right" }}>{r.forwardPoint}</td>
                      <td style={{ textAlign: "right" }}>{r.reversePoint}</td>
                      <td style={{ textAlign: "right" }}>
                        <span className="pill">{r.totalPoint}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : relations.length > 0 ? (
              <div className="subtitle">
                関連値0は除外のため、表示できる関連者がありません。チェックを外すと一覧できます。
              </div>
            ) : (
              <div className="subtitle">結果はまだありません</div>
            )}

            {selected && (
              <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                <button disabled={busy} onClick={() => resetDetail()}>
                  戻る
                </button>
                {isPrincipalRelationsCacheSource(selected.serverPerson) && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => loadFromServer(selected.serverPerson!)}
                    title="キャッシュ再表示"
                  >
                    キャッシュ再取得
                  </button>
                )}
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => extractFromWikipedia(selected.wiki.title)}
                >
                  再実行
                </button>
                <button
                  type="button"
                  className="success"
                  disabled={
                    busy ||
                    !isPrincipalRelationsCacheSource(selected.serverPerson)
                  }
                  title={
                    !isPrincipalRelationsCacheSource(selected.serverPerson)
                      ? "主体者として実行済みの人物のみ相関図の中心に追加できます"
                      : undefined
                  }
                  onClick={() => {
                    const p = selected.serverPerson;
                    if (!p || !isPrincipalRelationsCacheSource(p)) return;
                    setDiagramQueueCenterPerson({
                      person: p,
                      requestId: Date.now(),
                    });
                    setMainTab("diagram");
                  }}
                >
                  主体者を相関図に追加
                </button>
              </div>
            )}
              </div>
            </div>
          </div>
        <div
          id="main-panel-diagram"
          role="tabpanel"
          aria-labelledby="main-tab-diagram"
          className="mainTabPanel"
          hidden={mainTab !== "diagram"}
        >
          <DiagramTabPanel
            queueCenterPerson={diagramQueueCenterPerson}
            onQueueCenterPersonApplied={onDiagramQueueCenterPersonApplied}
          />
        </div>
      </div>

      {busy ? (
        <div
          className="busyOverlay"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={busyOverlayCaption}
        >
          <div className="busySpinner" aria-hidden />
          <div className="busyOverlayCaption">{busyOverlayCaption}</div>
        </div>
      ) : null}
    </>
  );
};
