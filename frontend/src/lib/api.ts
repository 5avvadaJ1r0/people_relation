import type {
  ApiPerson,
  ApiRelation,
  ApiRelationAggregate,
  DiagramCoreNetworkOut,
  DiagramShareOut,
  DiagramShareTokenOut,
  RelationIn,
} from "./types";
import { resolveApiBaseUrl } from "./apiBase";

const API_BASE = resolveApiBaseUrl();

const readApiErrorDetail = async (res: Response): Promise<string> => {
  const ct = res.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const j = (await res.json()) as { detail?: unknown };
      if (j.detail !== undefined) {
        return typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      }
    } else {
      return (await res.text()).slice(0, 240).replace(/\s+/g, " ");
    }
  } catch {
    return "";
  }
  return "";
};

const parseJsonOrThrow = async <T>(res: Response, label: string): Promise<T> => {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  const text = await res.text();
  const head = text.slice(0, 120).replace(/\s+/g, " ");
  throw new Error(`${label}: expected JSON but got "${ct || "unknown"}" body="${head}"`);
};

export const apiSearchPerson = async (
  name: string,
  init?: { signal?: AbortSignal }
): Promise<ApiPerson[]> => {
  const url = `${API_BASE}/v1/person/search?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { signal: init?.signal });
  if (!res.ok) throw new Error(`apiSearchPerson failed: ${res.status}`);
  return await parseJsonOrThrow<ApiPerson[]>(res, "apiSearchPerson");
};

/** executed_as_master が true の人物のみ検索（相関図の中心人物選定用） */
export const apiSearchPersonExecutedMasters = async (
  name: string,
  init?: { signal?: AbortSignal }
): Promise<ApiPerson[]> => {
  const url = `${API_BASE}/v1/person/search_executed_masters?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { signal: init?.signal });
  if (!res.ok) throw new Error(`apiSearchPersonExecutedMasters failed: ${res.status}`);
  return await parseJsonOrThrow<ApiPerson[]>(res, "apiSearchPersonExecutedMasters");
};

export const apiResolveWikiMasters = async (
  items: { title: string; pageid: number }[],
  init?: { signal?: AbortSignal }
): Promise<{ items: { pageid: number; person: ApiPerson | null }[] }> => {
  const url = `${API_BASE}/v1/person/resolve_wiki_masters`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
    signal: init?.signal,
  });
  if (!res.ok) throw new Error(`apiResolveWikiMasters failed: ${res.status}`);
  return await parseJsonOrThrow(res, "apiResolveWikiMasters");
};

export const apiPostDiagramCoreNetwork = async (
  body: { center_titles: string[]; total_point_gt?: number },
  init?: { signal?: AbortSignal }
): Promise<DiagramCoreNetworkOut> => {
  const url = `${API_BASE}/v1/diagram/core_network`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: init?.signal,
  });
  if (!res.ok) {
    const detail = await readApiErrorDetail(res);
    throw new Error(
      `apiPostDiagramCoreNetwork failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return await parseJsonOrThrow<DiagramCoreNetworkOut>(res, "apiPostDiagramCoreNetwork");
};

export const apiPostDiagramShare = async (
  body: {
    center_person_ids: number[];
    show_peer_links: boolean;
    total_point_gt: number;
  },
  init?: { signal?: AbortSignal },
): Promise<DiagramShareTokenOut> => {
  const url = `${API_BASE}/v1/diagram/share`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: init?.signal,
  });
  if (!res.ok) {
    const detail = await readApiErrorDetail(res);
    throw new Error(
      `apiPostDiagramShare failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return await parseJsonOrThrow<DiagramShareTokenOut>(res, "apiPostDiagramShare");
};

export const apiGetDiagramShare = async (
  shareId: string,
  init?: { signal?: AbortSignal },
): Promise<DiagramShareOut> => {
  const url = `${API_BASE}/v1/diagram/share/${encodeURIComponent(shareId)}`;
  const res = await fetch(url, { signal: init?.signal });
  if (!res.ok) {
    const detail = await readApiErrorDetail(res);
    throw new Error(
      `apiGetDiagramShare failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return await parseJsonOrThrow<DiagramShareOut>(res, "apiGetDiagramShare");
};

export const apiPutDiagramShareOgImage = async (
  shareId: string,
  png: Blob,
  init?: { signal?: AbortSignal },
): Promise<void> => {
  const url = `${API_BASE}/v1/diagram/share/${encodeURIComponent(shareId)}/og-image`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
    signal: init?.signal,
  });
  if (!res.ok) {
    const detail = await readApiErrorDetail(res);
    throw new Error(
      `apiPutDiagramShareOgImage failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
};

export const apiGetRelations = async (personId: number): Promise<ApiRelation[]> => {
  const url = `${API_BASE}/v1/person/${personId}/relations`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`apiGetRelations failed: ${res.status}`);
  return await parseJsonOrThrow<ApiRelation[]>(res, "apiGetRelations");
};

export const apiGetRelationsAggregate = async (personId: number): Promise<ApiRelationAggregate[]> => {
  const url = `${API_BASE}/v1/person/${personId}/relations_aggregate`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`apiGetRelationsAggregate failed: ${res.status}`);
  return await parseJsonOrThrow<ApiRelationAggregate[]>(res, "apiGetRelationsAggregate");
};

export const apiPostRelations = async (payload: RelationIn[], executedMasterUrl: string): Promise<ApiRelation[]> => {
  // executed_master_url を渡すことで「主体者として実行済み」判定に使う
  const url = `${API_BASE}/v1/relation?executed_master_url=${encodeURIComponent(executedMasterUrl)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`apiPostRelations failed: ${res.status}`);
  return await parseJsonOrThrow<ApiRelation[]>(res, "apiPostRelations");
};
