import { useEffect, useRef } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { PeopleRelationListSearchPanelModel } from "../peopleRelationAppModel";

type PrincipalSearchCardProps = {
  error: string | null;
  listSearch: PeopleRelationListSearchPanelModel;
};

export const PrincipalSearchCard = ({
  error,
  listSearch,
}: PrincipalSearchCardProps) => {
  const {
    query,
    setQuery,
    queryInputRef,
    matches,
    suggestFetched,
    setSuggestFocused,
    suggestPanelOpen,
    highlightIdx,
    setHighlightIdx,
    clearQuery,
    onSelectPerson,
  } = listSearch;

  const suggestListboxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!suggestPanelOpen || highlightIdx < 0) return;
    const active = matches[highlightIdx];
    if (!active) return;
    const opt = suggestListboxRef.current?.querySelector<HTMLElement>(
      `#principal-suggest-opt-${active.id}`,
    );
    opt?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx, matches, suggestPanelOpen]);

  const handleQueryChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const selectPerson = (idx: number) => {
    const p = matches[idx];
    if (!p) return;
    setHighlightIdx(-1);
    void onSelectPerson(p);
  };

  const handleQueryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setHighlightIdx(-1);
      queryInputRef.current?.blur();
      return;
    }
    if (!suggestPanelOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (matches.length === 0) return;
      setHighlightIdx((i) => (i < matches.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length === 0) return;
      setHighlightIdx((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (highlightIdx >= 0 && matches[highlightIdx]) {
        e.preventDefault();
        selectPerson(highlightIdx);
      }
    }
  };

  const cardClassName = suggestPanelOpen
    ? "card principalSearchCard principalSuggestPanelOpen"
    : "card principalSearchCard";

  return (
    <div className={cardClassName}>
      <h2>❶ 主体者入力</h2>
      <div className="principalSuggestWrap diagramSuggestWrap">
        <div className="textInputWrap">
          <input
            ref={queryInputRef}
            id="query"
            name="query"
            type="text"
            role="combobox"
            aria-expanded={suggestPanelOpen}
            aria-autocomplete="list"
            aria-controls="principal-suggest-listbox"
            aria-activedescendant={
              highlightIdx >= 0 && matches[highlightIdx]
                ? `principal-suggest-opt-${matches[highlightIdx].id}`
                : undefined
            }
            autoComplete="off"
            value={query}
            placeholder="氏名の一部を入力して選択"
            className={query.trim().length > 0 ? "hasRightIcon" : ""}
            onChange={handleQueryChange}
            onFocus={() => setSuggestFocused(true)}
            onBlur={() => {
              window.setTimeout(() => setSuggestFocused(false), 120);
            }}
            onKeyDown={handleQueryKeyDown}
          />
          {query.trim().length > 0 && (
            <button
              type="button"
              className="textInputRightIcon"
              aria-label="入力をクリア"
              title="クリア"
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={clearQuery}
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
            ref={suggestListboxRef}
            id="principal-suggest-listbox"
            className="diagramSuggestPanel"
            role="listbox"
            onWheel={(e) => e.stopPropagation()}
          >
            {matches.length > 0 ? (
              matches.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  id={`principal-suggest-opt-${p.id}`}
                  role="option"
                  aria-selected={highlightIdx === idx}
                  className={
                    highlightIdx === idx
                      ? "diagramSuggestOption diagramSuggestOptionActive"
                      : "diagramSuggestOption"
                  }
                  onMouseDown={(ev) => ev.preventDefault()}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onClick={() => selectPerson(idx)}
                >
                  {p.name}
                  {p.title !== p.name ? (
                    <span className="principalSuggestOptionSub">（{p.title}）</span>
                  ) : null}
                </button>
              ))
            ) : (
              <div className="diagramSuggestEmpty">
                {suggestFetched ? "該当する人物がいません。" : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {error && (
        <div style={{ marginTop: 10 }} className="danger">
          {error}
        </div>
      )}
    </div>
  );
};
