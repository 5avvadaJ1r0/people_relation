/** CDN など静的ホストから API オリジンが異なる場合の設定（任意・実行時注入） */
export type PeopleRelationWindowConfig = {
  /** 例: `https://api.example.com/api`（末尾スラッシュは自動除去） */
  apiBaseUrl?: string;
};

const readWindowApiBase = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  const cfg = (window as Window & { __PEOPLE_RELATION__?: PeopleRelationWindowConfig }).__PEOPLE_RELATION__;
  const raw = cfg?.apiBaseUrl?.trim();
  return raw && raw.length > 0 ? raw : undefined;
};

const readEnvApiBase = (): string | undefined => {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  return raw && raw.length > 0 ? raw : undefined;
};

/**
 * API のベース（`/api` または絶対URLの `/api` 相当まで）。
 * 優先順位: `window.__PEOPLE_RELATION__.apiBaseUrl` → `VITE_API_BASE_URL` → `/api`
 */
export const resolveApiBaseUrl = (): string => {
  const chosen = readWindowApiBase() ?? readEnvApiBase() ?? "/api";
  const trimmed = chosen.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "/api";
};
