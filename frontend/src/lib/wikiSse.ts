import { resolveApiBaseUrl } from "./apiBase";
import type { PersonRef, RelationView, WikiSearchItem } from "./types";

export type WikiSseProgress = { phase: string; done: number; total: number };

type ProgressMsg = { type: "progress"; phase: string; done: number; total: number };
type SearchResultMsg = { type: "search_result"; wiki: WikiSearchItem[]; emptyMessage: string | null };
type ExtractResultMsg = { type: "extract_result"; master: PersonRef; relations: RelationView[] };
type ErrorMsg = { type: "error"; message: string };

const buildSseUrl = (endpoint: "person_search_sse" | "extract_relations_sse", params: Record<string, string>): string => {
  const base = resolveApiBaseUrl().replace(/\/+$/, "");
  const path = `${base}/v1/wiki/${endpoint}`;
  const u = path.startsWith("http") ? new URL(path) : new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
};

export const isAbortError = (e: unknown): boolean =>
  e instanceof DOMException && e.name === "AbortError";

export const consumeWikiPersonSearchSse = (
  query: string,
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: WikiSseProgress) => void;
    onError?: (message: string) => void;
  } = {}
): Promise<{ wiki: WikiSearchItem[]; emptyMessage: string | null }> =>
  new Promise((resolve, reject) => {
    const { signal } = opts;
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const url = buildSseUrl("person_search_sse", { q: query });
    const es = new EventSource(url);
    let finished = false;

    let detachAbort: (() => void) | undefined;
    const safeClose = () => {
      detachAbort?.();
      detachAbort = undefined;
      finished = true;
      es.close();
    };
    if (signal) {
      const onAbort = () => {
        if (finished) return;
        safeClose();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort);
      detachAbort = () => signal.removeEventListener("abort", onAbort);
    }

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ProgressMsg | SearchResultMsg | ErrorMsg;
        if (msg.type === "progress") {
          opts.onProgress?.({ phase: msg.phase, done: msg.done, total: msg.total });
          return;
        }
        if (msg.type === "search_result") {
          safeClose();
          resolve({ wiki: msg.wiki, emptyMessage: msg.emptyMessage });
          return;
        }
        if (msg.type === "error") {
          opts.onError?.(msg.message);
          safeClose();
          reject(new Error(msg.message));
        }
      } catch (e) {
        safeClose();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    es.onerror = () => {
      if (finished) return;
      safeClose();
      reject(new Error("person_search_sse の接続が切断されました"));
    };
  });

export const consumeWikiExtractSse = (
  title: string,
  maxRelated: number,
  opts: {
    signal?: AbortSignal;
    onProgress?: (p: WikiSseProgress) => void;
    onError?: (message: string) => void;
  } = {}
): Promise<{ master: PersonRef; relations: RelationView[] }> =>
  new Promise((resolve, reject) => {
    const { signal } = opts;
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const url = buildSseUrl("extract_relations_sse", {
      title,
      max_related: String(maxRelated),
    });
    const es = new EventSource(url);
    let finished = false;

    let detachAbort: (() => void) | undefined;
    const safeClose = () => {
      detachAbort?.();
      detachAbort = undefined;
      finished = true;
      es.close();
    };
    if (signal) {
      const onAbort = () => {
        if (finished) return;
        safeClose();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort);
      detachAbort = () => signal.removeEventListener("abort", onAbort);
    }

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ProgressMsg | ExtractResultMsg | ErrorMsg;
        if (msg.type === "progress") {
          opts.onProgress?.({ phase: msg.phase, done: msg.done, total: msg.total });
          return;
        }
        if (msg.type === "extract_result") {
          safeClose();
          resolve({ master: msg.master, relations: msg.relations });
          return;
        }
        if (msg.type === "error") {
          opts.onError?.(msg.message);
          safeClose();
          reject(new Error(msg.message));
        }
      } catch (e) {
        safeClose();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    es.onerror = () => {
      if (finished) return;
      safeClose();
      reject(new Error("extract_relations_sse の接続が切断されました"));
    };
  });

