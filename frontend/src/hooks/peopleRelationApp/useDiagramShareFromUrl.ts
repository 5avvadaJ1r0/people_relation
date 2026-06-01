import { useEffect, useState } from "react";
import { apiGetDiagramShare } from "../../lib/api";
import { buildDiagramShareText } from "../../lib/correlationDiagramExport";
import { readDiagramShareIdFromLocation } from "../../lib/diagramShare";
import {
  applyDiagramShareMeta,
  clearDiagramShareMeta,
} from "../../lib/diagramShareMeta";
import type { ApiPerson } from "../../lib/types";
import { PAGE_TITLE } from "../../lib/siteSeo";
import type { MainAppTab } from "../../appScreenTypes";

export type DiagramShareBootstrap = {
  shareId: string;
  centerPersons: ApiPerson[];
  showPeerLinks: boolean;
  totalPointGt: number;
};

/** `?diagram_share_id=` 付き URL から中心人物と表示条件を復元する */
export const useDiagramShareFromUrl = (
  setMainTab: (tab: MainAppTab) => void,
  setDiagramCenter: (persons: ApiPerson[]) => void,
) => {
  const [bootstrap, setBootstrap] = useState<DiagramShareBootstrap | null>(null);
  const [shareLoadError, setShareLoadError] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);

  useEffect(() => {
    const shareId = readDiagramShareIdFromLocation();
    if (!shareId) return;

    let cancelled = false;
    const ac = new AbortController();

    void (async () => {
      setShareLoading(true);
      setShareLoadError(null);
      try {
        const shared = await apiGetDiagramShare(shareId, { signal: ac.signal });
        if (cancelled) return;

        setMainTab("diagram");
        setDiagramCenter(shared.center_persons);
        setBootstrap({
          shareId: shared.share_id,
          centerPersons: shared.center_persons,
          showPeerLinks: shared.show_peer_links,
          totalPointGt: shared.total_point_gt,
        });

        const titles = shared.center_persons.map((p) => p.title).join("、");
        applyDiagramShareMeta({
          shareId: shared.share_id,
          title: `相関図: ${titles}`,
          description: buildDiagramShareText(
            shared.center_persons.map((p) => p.title),
          ),
          hasOgImage: shared.has_og_image,
        });
      } catch (e: unknown) {
        if (cancelled || ac.signal.aborted) return;
        setShareLoadError(e instanceof Error ? e.message : String(e));
        setBootstrap(null);
      } finally {
        if (!cancelled) setShareLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [setDiagramCenter, setMainTab]);

  useEffect(() => {
    const syncMetaWithLocation = () => {
      if (!readDiagramShareIdFromLocation()) {
        clearDiagramShareMeta(PAGE_TITLE);
        setBootstrap(null);
        setShareLoadError(null);
      }
    };
    window.addEventListener("popstate", syncMetaWithLocation);
    return () => window.removeEventListener("popstate", syncMetaWithLocation);
  }, []);

  useEffect(
    () => () => {
      clearDiagramShareMeta(PAGE_TITLE);
    },
    [],
  );

  return { bootstrap, shareLoadError, shareLoading };
};
