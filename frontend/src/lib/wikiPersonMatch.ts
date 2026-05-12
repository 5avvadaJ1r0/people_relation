import type { ApiPerson } from "./types";

/** Wikipedia検索の title に曖昧さ回避が付く場合の表示名（括弧以降を落とす） */
export const displayPersonNameFromWikiTitle = (title: string): string =>
  title.replace(/\s*\(.*?\)\s*$/, "").trim();

/** バックエンド `app.services.wiki.extract.principal_search._norm_title_for_exact_match` に寄せた比較用キー */
export const normWikiTitleForMatch = (s: string): string =>
  s
    .normalize("NFC")
    .trim()
    .replace(/_/g, " ")
    .split(/\s+/)
    .join(" ");

/** `Person.url` が ja.wikipedia の記事 URL のとき、ページタイトルを復元する（`/wiki/…` のみ） */
export const titleFromJaWikipediaUrl = (url: string): string | null => {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase();
    if (host !== "ja.wikipedia.org" && host !== "ja.m.wikipedia.org") return null;
    const path = u.pathname.replace(/\/$/, "");
    if (!path.startsWith("/wiki/")) return null;
    const seg = path.slice("/wiki/".length);
    if (!seg) return null;
    let raw: string;
    try {
      raw = decodeURIComponent(seg);
    } catch {
      raw = seg;
    }
    return raw.replace(/_/g, " ").trim() || null;
  } catch {
    return null;
  }
};

export const pickServerPersonForWikiTitle = (
  wikiTitle: string,
  persons: ApiPerson[]
): ApiPerson | undefined => {
  const nt = normWikiTitleForMatch(wikiTitle);
  return persons.find((p) => {
    if (normWikiTitleForMatch(p.title) === nt || normWikiTitleForMatch(p.name) === nt) return true;
    const fromUrl = titleFromJaWikipediaUrl(p.url);
    return fromUrl != null && normWikiTitleForMatch(fromUrl) === nt;
  });
};

/**
 * ❸ の「キャッシュ」表示・初回選択時の DB 読み出しの対象。
 * `executed_as_master` / `executed_as_master_at` に相当する API の `has_relations` が真のときのみ。
 * 関連者としてだけ登録された人物（例: executed_as_master = false）は対象外。
 */
export const isPrincipalRelationsCacheSource = (p: ApiPerson | undefined): boolean =>
  Boolean(p?.has_relations);
