import { apiWikiIsHuman } from "../api";
import type { PersonRef, RelationView, WikiSearchItem } from "../types";
import { ExternalApiFetcher } from "./ExternalApiFetcher";
import { WikiApiClient } from "./WikiApiClient";
import { WikiTwoHopExtractorService } from "./WikiTwoHopExtractorService";
import { useWikiTwoHopExtractor as useWikiTwoHopExtractorImpl, type WikiProgress } from "./useWikiTwoHopExtractor";
import { WikiTwoHopExtractor as WikiTwoHopExtractorImpl, type WikiTwoHopExtractorProps as ImplProps } from "./WikiTwoHopExtractor";
import { normalizeWikiLinkTitle } from "./wikiUtils";

const wikiApi = new WikiApiClient(new ExternalApiFetcher());
const wikiTwoHop = new WikiTwoHopExtractorService(wikiApi);

export const wikiSearchPeople = async (query: string): Promise<WikiSearchItem[]> => {
  return await wikiApi.searchPeople(query);
};

const wikiLookupExactTitle = async (title: string): Promise<WikiSearchItem | null> => {
  return await wikiApi.lookupExactTitle(title);
};

export const wikiSearchPeopleIncludingExact = async (query: string): Promise<WikiSearchItem[]> => {
  const q = String(query ?? "").trim();
  if (!q) return [];
  const [search, exact] = await Promise.all([wikiSearchPeople(q), wikiLookupExactTitle(q).catch(() => null)]);
  const map = new Map<number, WikiSearchItem>();
  for (const it of search) map.set(it.pageid, it);
  if (exact) map.set(exact.pageid, exact);
  if (exact) {
    const rest = [...map.values()].filter((x) => x.pageid !== exact.pageid);
    return [exact, ...rest];
  }
  return [...map.values()];
};

export const wikiIsHuman = async (
  title: string
): Promise<{ title: string; qid: string | null; is_human: boolean; source: string }> => {
  try {
    return await apiWikiIsHuman(title);
  } catch {
    return { title, qid: null, is_human: false, source: "unknown" };
  }
};

/**
 * 人物判定で全件落ちたとき用。曖昧さ回避ページは Wikidata 上 Q5 ではないため弾かれやすいが、
 * 冒頭の hatnote リンク先は実人物記事のことが多いので候補に合流する。
 */
export const expandWikiResultsResolvingDisambiguationPages = async (
  items: WikiSearchItem[]
): Promise<WikiSearchItem[]> => {
  if (items.length === 0) return items;
  const byPageid = new Map<number, WikiSearchItem>();
  for (const it of items) byPageid.set(it.pageid, it);
  const titles = [...byPageid.values()].map((x) => x.title);
  const dabPageIds = await wikiApi.fetchDisambiguationPageIdsByTitles(titles);
  if (dabPageIds.size === 0) return items;

  for (const it of [...byPageid.values()]) {
    if (!dabPageIds.has(it.pageid)) continue;
    const hat = await wikiApi.fetchHatnoteNs0LinkSets(it.title, normalizeWikiLinkTitle).catch(() => ({
      inNotes: new Set<string>(),
      outOfNotes: new Set<string>(),
    }));
    for (const linkTitle of hat.inNotes) {
      if (hat.outOfNotes.has(linkTitle)) continue;
      const looked = await wikiApi.lookupExactTitle(linkTitle).catch(() => null);
      if (looked && !byPageid.has(looked.pageid)) byPageid.set(looked.pageid, looked);
    }
  }
  return [...byPageid.values()];
};

export const extractRelationsTwoHop = async (params: {
  masterTitle: string;
  masterName: string;
  maxRelated: number;
  onProgress?: (p: { phase: string; done: number; total: number }) => void;
}): Promise<{ master: PersonRef; relations: RelationView[] }> => {
  return await wikiTwoHop.extract(params);
};

export type { WikiProgress };

export const useWikiTwoHopExtractor = () => {
  return useWikiTwoHopExtractorImpl(extractRelationsTwoHop);
};

// class component: impl をそのまま export（extractRelationsTwoHop は利用側で注入）
export type WikiTwoHopExtractorProps = ImplProps;
export { WikiTwoHopExtractorImpl as WikiTwoHopExtractor };

