import { useEffect, useRef, type ReactNode } from "react";

export type PersonSuggestListboxProps = {
  id: string;
  open: boolean;
  highlightIdx: number;
  /** ハイライト中オプションの DOM id（# なし）。例: principal-suggest-opt-42 */
  activeOptionDomId?: string;
  children: ReactNode;
};

export const PersonSuggestListbox = ({
  id,
  open,
  highlightIdx,
  activeOptionDomId,
  children,
}: PersonSuggestListboxProps) => {
  const listboxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || highlightIdx < 0 || !activeOptionDomId) return;
    const opt = listboxRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(activeOptionDomId)}`,
    );
    opt?.scrollIntoView({ block: "nearest" });
  }, [activeOptionDomId, highlightIdx, open]);

  if (!open) return null;

  return (
    <div
      ref={listboxRef}
      id={id}
      className="diagramSuggestPanel"
      role="listbox"
      onWheel={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
};
