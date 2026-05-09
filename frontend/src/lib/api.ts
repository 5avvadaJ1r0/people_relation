import type { ApiPerson, ApiRelation, ApiRelationAggregate, ApiWikiHuman, RelationIn } from "./types";
import { resolveApiBaseUrl } from "./apiBase";

const API_BASE = resolveApiBaseUrl();

const parseJsonOrThrow = async <T>(res: Response, label: string): Promise<T> => {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  const text = await res.text();
  const head = text.slice(0, 120).replace(/\s+/g, " ");
  throw new Error(`${label}: expected JSON but got "${ct || "unknown"}" body="${head}"`);
};

export const apiSearchPerson = async (name: string): Promise<ApiPerson[]> => {
  const url = `${API_BASE}/v1/person/search?name=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`apiSearchPerson failed: ${res.status}`);
  return await parseJsonOrThrow<ApiPerson[]>(res, "apiSearchPerson");
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

export const apiWikiIsHuman = async (title: string): Promise<ApiWikiHuman> => {
  const url = `${API_BASE}/v1/wiki/is_human?title=${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`apiWikiIsHuman failed: ${res.status}`);
  return await parseJsonOrThrow<ApiWikiHuman>(res, "apiWikiIsHuman");
};

