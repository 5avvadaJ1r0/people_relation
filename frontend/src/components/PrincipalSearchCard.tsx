import type { ChangeEvent, KeyboardEvent } from "react";
import { displayPersonNameFromWikiTitle } from "../lib/wikiPersonMatch";
import type {
  PeopleRelationAppBusyModel,
  PeopleRelationListSearchPanelModel,
} from "../peopleRelationAppModel";

type PrincipalSearchCardProps = {
  error: string | null;
  appBusy: PeopleRelationAppBusyModel;
  listSearch: PeopleRelationListSearchPanelModel;
};

export const PrincipalSearchCard = ({
  error,
  appBusy,
  listSearch,
}: PrincipalSearchCardProps) => {
  const {
    query,
    setQuery,
    queryInputRef,
    onSearch,
    wikiResults,
    wikiDisplayNameCounts,
    hasSearched,
    wikiEmptyMessage,
    onSelect,
  } = listSearch;
  const { busy, progress, isSearchProgress, progressPct } = appBusy;

  const handleQueryChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleQueryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void onSearch();
  };

  const handleClearQuery = () => {
    setQuery("");
    window.setTimeout(() => queryInputRef.current?.focus(), 0);
  };

  return (
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
            onChange={handleQueryChange}
            onKeyDown={handleQueryKeyDown}
          />
          {query.trim().length > 0 && (
            <button
              type="button"
              className="textInputRightIcon"
              aria-label="入力をクリア"
              title="クリア"
              onClick={handleClearQuery}
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
                <button disabled={busy} onClick={() => void onSelect(r)}>
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
          <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>
            {progress.phase}（{progress.done}/{progress.total}）
          </div>
          <div className="progress">
            <div className="bar" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
};
