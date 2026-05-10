import { useEffect, useMemo, useRef, useState } from "react";
import { apiGetRelationsAggregate, apiPostRelations, apiSearchPerson } from "../lib/api";
import {
  expandWikiResultsResolvingDisambiguationPages,
  useWikiTwoHopExtractor,
  wikiIsHuman,
  wikiSearchPeopleIncludingExact,
} from "../lib/wiki";
import type { ApiPerson, RelationIn, RelationView, WikiSearchItem } from "../lib/types";
import urlQrCodeSvg from "../assets/images/svg/url-qr-code.svg";

type Selected = {
  wiki: WikiSearchItem;
  serverPerson?: ApiPerson;
};

/** Wikipedia 経由で取得する関連者の最大件数（抽出パラメータと見出し表示で共通） */
const WIKI_MAX_RELATED_DISPLAY = 100;

const displayPersonNameFromWikiTitle = (title: string): string => {
  // Wikipedia検索のtitleには曖昧さ回避の補足が付くことがある（例: "山田太郎 (俳優)"）。
  // 表示は人物名のみ、選択/取得は元titleのままにする。
  return title.replace(/\s*\(.*?\)\s*$/, "").trim();
};

const filterWikiPeopleOnly = async (
  items: WikiSearchItem[],
  onProgress?: (p: { phase: string; done: number; total: number }) => void
): Promise<WikiSearchItem[]> => {
  // Wikipedia検索結果には人物以外（作品・団体など）が混ざることがあるため、
  // Wikidataの P31=Q5 (human) 判定で人物のみ残す。
  const batchSize = 5;
  const out: WikiSearchItem[] = [];
  const total = items.length;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    onProgress?.({ phase: "検索結果の人物判定", done: Math.min(i, total), total });
    const results = await Promise.all(
      batch.map(async (it) => {
        try {
          const x = await wikiIsHuman(it.title);
          // 判定不能（外部到達不可など）の場合は、人物以外の混入を避けるため落とす
          const ok = x.source !== "unknown" && x.is_human;
          return { it, ok };
        } catch {
          // 判定APIが落ちている/ネットワーク障害の場合も、人物以外の混入を避けるため表示しない
          return { it, ok: false };
        }
      })
    );
    for (const r of results) {
      if (r.ok) out.push(r.it);
    }
  }
  onProgress?.({ phase: "検索結果の人物判定", done: total, total });
  return out;
};

export const App = () => {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const queryInputRef = useRef<HTMLInputElement | null>(null);

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

  const wikiExtract = useWikiTwoHopExtractor();
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const isSearchProgress = progress?.phase === "検索結果の人物判定";
  const progressPct = useMemo(() => {
    if (!progress) return 0;
    if (progress.total <= 0) return 0;
    return Math.round((progress.done / progress.total) * 100);
  }, [progress]);

  const [masterLabel, setMasterLabel] = useState<string>("");
  const [relations, setRelations] = useState<RelationView[]>([]);
  const [source, setSource] = useState<"server" | "wikipedia" | "">("");

  // Hook側の progress/error を App の表示に反映（既存UIを維持）
  useEffect(() => {
    if (wikiExtract.progress) setProgress(wikiExtract.progress);
  }, [wikiExtract.progress]);
  useEffect(() => {
    if (wikiExtract.error) setError(wikiExtract.error);
  }, [wikiExtract.error]);

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

  const resetDetail = () => {
    setSelected(null);
    setRelations([]);
    setSource("");
    setMasterLabel("");
    setProgress(null);
    setError(null);
    wikiExtract.reset();
  };

  const onSearch = async () => {
    setBusy(true);
    setError(null);
    resetDetail();
    setWikiResults([]);
    setServerMatches([]);
    try {
      // どちらか片方が落ちても、片方の検索結果は表示する（特にサーバー停止時にWikipedia検索まで巻き添えで0件になるのを防ぐ）
      let wiki: WikiSearchItem[] = [];
      try {
        wiki = await wikiSearchPeopleIncludingExact(query);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }

      if (wiki.length > 0) {
        setProgress({ phase: "検索結果の人物判定", done: 0, total: wiki.length });
        let wikiHumans = await filterWikiPeopleOnly(wiki, (p) => setProgress(p));
        let wikiForFallback = wiki;
        // 同姓同名で曖昧さ回避のみ返ると Q5 判定で全滅しやすい → hatnote から実記事を合流
        if (wikiHumans.length === 0) {
          const expanded = await expandWikiResultsResolvingDisambiguationPages(wiki);
          if (expanded.length > wiki.length) {
            wikiForFallback = expanded;
            setProgress({ phase: "検索結果の人物判定", done: 0, total: expanded.length });
            wikiHumans = await filterWikiPeopleOnly(expanded, (p) => setProgress(p));
          }
        }
        // 人物判定が外部到達不可などで全滅するケースがあるため、0件なら未フィルタ結果を出す
        if (wikiHumans.length === 0) {
          setWikiResults(wikiForFallback);
          setError((prev) => prev ?? "人物判定に失敗したため、未判定の検索結果を表示しています。");
        } else {
          setWikiResults(wikiHumans);
        }
      } else {
        setWikiResults([]);
      }

      try {
        const server = await apiSearchPerson(query);
        setServerMatches(server);
      } catch (e: any) {
        // サーバー検索が失敗してもWikipedia検索は表示できるので致命扱いにしない
        setServerMatches([]);
        setError((prev) => prev ?? (e?.message ?? String(e)));
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const findServerMatchByTitle = (title: string): ApiPerson | undefined => {
    // サーバーはnameで曖昧検索しているので、title一致(またはname一致)を優先して当てる
    return serverMatches.find((p) => p.title === title) ?? serverMatches.find((p) => p.name === title);
  };

  const loadFromServer = async (p: ApiPerson) => {
    setBusy(true);
    setError(null);
    setProgress({ phase: "キャッシュ取得", done: 0, total: 1 });
    console.log("[App] loadFromServer", { id: p.id, name: p.name, title: p.title });
    try {
      const rels = await apiGetRelationsAggregate(p.id);
      setMasterLabel(p.title);
      setSource("server");
      setRelations(
        rels.map((r) => ({
          slave: { name: r.slave.name, title: r.slave.title, url: r.slave.url },
          forwardPoint: r.forward_point,
          reversePoint: r.reverse_point,
          totalPoint: r.total_point,
          hasWikiPage: true,
        }))
      );
      setProgress({ phase: "キャッシュ取得", done: 1, total: 1 });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const extractFromWikipedia = async (title: string) => {
    setBusy(true);
    setError(null);
    console.log("[App] extractFromWikipedia start", { title });
    try {
      const masterName = title;
      const out = await wikiExtract.run({
        masterTitle: title,
        masterName,
        maxRelated: WIKI_MAX_RELATED_DISPLAY,
      });
      if (!out) return;
      const { master, relations } = out;
      console.log("[App] extractFromWikipedia done", { masterTitle: master.title, relations: relations.length });

      setMasterLabel(master.title ?? master.name);
      setSource("wikipedia");
      setRelations(relations);

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
            master: { name: r.slave.name, title: r.slave.title, url: r.slave.url },
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
      await apiPostRelations(payload, master.url);
      setProgress({ phase: "キャッシュ保存", done: 1, total: 1 });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSelect = async (item: WikiSearchItem) => {
    setSelected(null);
    setRelations([]);
    setSource("");
    setMasterLabel("");
    setError(null);
    const m = findServerMatchByTitle(item.title);
    const sel: Selected = { wiki: item, serverPerson: m };
    setSelected(sel);

    if (m?.has_relations) {
      console.log("[App] onSelect -> server", { wikiTitle: item.title, serverId: m.id });
      await loadFromServer(m);
      return;
    }
    console.log("[App] onSelect -> wikipedia", { wikiTitle: item.title });
    await extractFromWikipedia(item.title);
  };

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="title">著名人関連者リストアップ</div>
          <div className="subtitle">ネット上から著名人の関連者をリストアップするツールです</div>
        </div>
        <div className="headerQr" aria-hidden="true">
          <img src={urlQrCodeSvg} alt="" width={68} height={68} />
        </div>
      </div>

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
                placeholder="例: 木村拓哉"
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
                    window.setTimeout(() => queryInputRef.current?.focus(), 0);
                  }}
                >
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
                    <path
                      d="M6.2 6.2a1 1 0 0 1 1.4 0L10 8.6l2.4-2.4a1 1 0 1 1 1.4 1.4L11.4 10l2.4 2.4a1 1 0 0 1-1.4 1.4L10 11.4l-2.4 2.4a1 1 0 0 1-1.4-1.4L8.6 10 6.2 7.6a1 1 0 0 1 0-1.4Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              )}
            </div>
            <button className="primary" disabled={busy || query.trim().length === 0} onClick={onSearch}>
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
              <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>
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
              const isAmbiguous = (wikiDisplayNameCounts.get(displayName) ?? 0) >= 2;
              const label = isAmbiguous ? r.title : displayName;
              return (
                <div key={r.pageid} className="item">
                  <div className="itemTitle">
                    <div style={{ fontWeight: 700 }}>{label}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button disabled={busy} onClick={() => onSelect(r)}>
                      選択
                    </button>
                  </div>
                </div>
              );
            })}
            {wikiResults.length === 0 && <div className="subtitle">まだ検索していません。</div>}
          </div>

          {progress && !isSearchProgress && (
            <div className="progressWrap">
              <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>
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
            <span className="subtitle">（上位{WIKI_MAX_RELATED_DISPLAY}名のみ表示）</span>
          </h2>
          {selected ? (
            <div className="muted" style={{ marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
              <span>
                主体者: <span className="pill">{masterLabel || selected.wiki.title}</span>
              </span>
              <span>
                表示元:{" "}
                <span className="pill">{source === "server" ? "キャッシュ" : source === "wikipedia" ? "最新版" : "-"}</span>
              </span>
            </div>
          ) : (
            <div className="subtitle" style={{ marginBottom: 10 }}>
              主体者検索結果から人物を選択してください。
            </div>
          )}

          {relations.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>関連者</th>
                  <th style={{ width: 80, textAlign: "right" }}>主体値</th>
                  <th style={{ width: 80, textAlign: "right" }}>関連値</th>
                  <th style={{ width: 80, textAlign: "right" }}>合計値</th>
                </tr>
              </thead>
              <tbody>
                {relations.map((r) => (
                  <tr key={`${r.slave.title ?? r.slave.name}-${r.totalPoint}`}>
                    <td>
                      <a href={r.slave.url} target="_blank" rel="noreferrer">
                        {r.slave.name}
                      </a>
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
          ) : (
            <div className="subtitle">結果はまだありません</div>
          )}

          {selected && (
            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              <button disabled={busy} onClick={() => resetDetail()}>
                戻る
              </button>
              {selected.serverPerson && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => loadFromServer(selected.serverPerson!)}
                  title="キャッシュ再表示"
                >
                  キャッシュ再取得
                </button>
              )}
              <button className="primary" disabled={busy} onClick={() => extractFromWikipedia(selected.wiki.title)}>
                再実行
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

