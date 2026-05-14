import type { ApiPerson, ApiRelation, PersonRef, RelationView } from "./types";

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
  const matches = persons.filter((p) => {
    if (normWikiTitleForMatch(p.title) === nt || normWikiTitleForMatch(p.name) === nt) return true;
    const fromUrl = titleFromJaWikipediaUrl(p.url);
    return fromUrl != null && normWikiTitleForMatch(fromUrl) === nt;
  });
  if (matches.length === 0) return undefined;
  /** `/person/search` は関連者のみの人物も返す。先頭一致が slave だと相関図リンクが出ないため主体者を優先 */
  const master = matches.find((p) => p.has_relations);
  return master ?? matches[0];
};

/**
 * Wikipedia 抽出の `master` と、`POST /relation` 応答の各行 `master` を突き合わせる。
 * バックエンドの URL 正規化で文字列が一致しない場合でも、記事タイトル（URL 由来含む）で拾う。
 */
export const findPostedMasterMatchingExtractMaster = (
  posted: ApiRelation[],
  extractMaster: PersonRef,
): ApiRelation["master"] | undefined => {
  if (posted.length === 0) return undefined;
  const byStrictUrl = posted.find((r) => r.master.url === extractMaster.url);
  if (byStrictUrl) return byStrictUrl.master;
  const emTitle = normWikiTitleForMatch(extractMaster.title ?? extractMaster.name);
  const emArticle = titleFromJaWikipediaUrl(extractMaster.url);
  const emArticleKey = emArticle != null ? normWikiTitleForMatch(emArticle) : null;
  for (const r of posted) {
    const m = r.master;
    if (normWikiTitleForMatch(m.title) === emTitle) return m;
    const ma = titleFromJaWikipediaUrl(m.url);
    if (emArticleKey != null && ma != null && emArticleKey === normWikiTitleForMatch(ma)) {
      return m;
    }
  }
  return undefined;
};

/** `POST /relation` 等のネストした人物オブジェクトを `ApiPerson` に変換する */
export const apiPersonFromPersonOutJson = (
  p: ApiRelation["slave"] | ApiRelation["master"],
): ApiPerson => ({
  id: p.id,
  name: p.name,
  title: p.title,
  url: p.url,
  has_relations: p.has_relations,
  executed_as_master_at: p.executed_as_master_at ?? null,
});

/**
 * Wikipedia 抽出直後の `RelationView` に、`POST /relation` 応答の人物情報（`has_relations` 等）をマージする。
 */
export const mergeRelationViewsWithPostedPersons = (
  relViews: RelationView[],
  posted: ApiRelation[],
): RelationView[] => {
  const byUrl = new Map<string, ApiPerson>();
  const byNormTitle = new Map<string, ApiPerson>();
  for (const row of posted) {
    for (const side of [row.master, row.slave]) {
      const ap = apiPersonFromPersonOutJson(side);
      byUrl.set(side.url, ap);
      byNormTitle.set(normWikiTitleForMatch(side.title), ap);
    }
  }
  return relViews.map((rv) => {
    let slavePerson = byUrl.get(rv.slave.url);
    if (!slavePerson) {
      const t = rv.slave.title ?? rv.slave.name;
      if (t) slavePerson = byNormTitle.get(normWikiTitleForMatch(t));
    }
    return slavePerson ? { ...rv, slavePerson } : rv;
  });
};

/**
 * ❸ の「キャッシュ」表示・初回選択時の DB 読み出しの対象。
 * `executed_as_master` / `executed_as_master_at` に相当する API の `has_relations` が真のときのみ。
 * 関連者としてだけ登録された人物（例: executed_as_master = false）は対象外。
 */
export const isPrincipalRelationsCacheSource = (p: ApiPerson | undefined): boolean =>
  Boolean(p?.has_relations);
