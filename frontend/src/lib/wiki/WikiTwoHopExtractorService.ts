import { apiWikiIsHuman } from "../api";
import type { PersonRef, RelationView } from "../types";
import { sleep, yieldToUi } from "./runtime";
import {
  countLinksFromWikitext,
  countOccurrences,
  decodeWikiTitleFromHref,
  dropSubNameIfFullExists,
  hrefToUrl,
  normalizeWikiLinkTitle,
  reverseLinkScoreFromWikitextAndParse,
} from "./wikiUtils";
import type { WikiApiClient } from "./WikiApiClient";

export class WikiTwoHopExtractorService {
  constructor(private readonly wiki: WikiApiClient) {}

  async extract(params: {
    masterTitle: string;
    masterName: string;
    maxRelated: number;
    onProgress?: (p: { phase: string; done: number; total: number }) => void;
  }): Promise<{ master: PersonRef; relations: RelationView[] }> {
    const { masterTitle, masterName, maxRelated, onProgress } = params;
    const masterUrl = `https://ja.wikipedia.org/wiki/${encodeURIComponent(masterTitle.replace(/ /g, "_"))}`;
    const master: PersonRef = { name: masterName, title: masterTitle, url: masterUrl };
    const reverseCheckedNames = new Set<string>();

    onProgress?.({ phase: "主体者情報取得処理中", done: 0, total: 1 });
    await yieldToUi();
    const [extractText, wikitext, canonicalTitle, masterParseLinks, hatnote, masterHtmlTextRaw] = await Promise.all([
      this.wiki.fetchExtractTextByTitle(masterTitle),
      this.wiki.fetchWikitextByTitle(masterTitle),
      this.wiki.fetchCanonicalTitle(masterTitle).catch(() => masterTitle),
      this.wiki.fetchParseNs0LinkTitleSet(masterTitle, normalizeWikiLinkTitle).catch(() => new Set<string>()),
      this.wiki
        .fetchHatnoteNs0LinkSets(masterTitle, normalizeWikiLinkTitle)
        .catch(() => ({ inNotes: new Set<string>(), outOfNotes: new Set<string>() })),
      this.wiki.fetchParsePlainTextByTitle(masterTitle).catch(() => ""),
    ]);
    const masterParseLinkNorms = new Set<string>();
    for (const t of masterParseLinks) {
      const norm = normalizeWikiLinkTitle(t);
      if (norm) masterParseLinkNorms.add(norm);
    }
    const masterRedirects = await this.wiki.fetchRedirectTitles(canonicalTitle).catch(() => []);
    onProgress?.({ phase: "主体者情報解析処理中", done: 0, total: 1 });
    await yieldToUi();
    const linkCounts = countLinksFromWikitext(wikitext);

    const text = extractText.replace(/\s+/g, " ").trim();
    const masterHtmlText = masterHtmlTextRaw.replace(/\s+/g, " ").trim();
    const textForCount = text;
    for (const t of masterParseLinks) {
      const norm = normalizeWikiLinkTitle(t);
      if (!norm) continue;
      if (linkCounts.has(norm)) continue;
      if (hatnote.inNotes.has(norm) && !hatnote.outOfNotes.has(norm)) continue;
      const href = `/wiki/${encodeURIComponent(norm.replace(/ /g, "_"))}`;
      const cExtract = countOccurrences(textForCount, norm);
      const cHtml = masterHtmlText ? countOccurrences(masterHtmlText, norm) : 0;
      const c = Math.max(1, cExtract, cHtml);
      linkCounts.set(norm, { count: c, href });
    }

    const forwardCountBeforeNoteFilter = new Map<string, number>();
    for (const [k, v] of linkCounts.entries()) forwardCountBeforeNoteFilter.set(k, v.count);

    for (const t of hatnote.inNotes) {
      const norm = normalizeWikiLinkTitle(t);
      if (!norm) continue;
      if (hatnote.outOfNotes.has(norm)) continue;
      linkCounts.delete(norm);
    }

    const forwardTextCount = new Map<string, number>();
    {
      const TOP_TEXT_COUNT = 280;
      const keys = Array.from(linkCounts.entries())
        .sort((a, b) => (b[1]?.count ?? 0) - (a[1]?.count ?? 0))
        .slice(0, TOP_TEXT_COUNT)
        .map(([k]) => k);
      for (const name of keys) {
        const cExtract = countOccurrences(textForCount, name);
        const cHtml = masterHtmlText ? countOccurrences(masterHtmlText, name) : 0;
        const c = Math.max(cExtract, cHtml);
        forwardTextCount.set(name, c);
        const prev = linkCounts.get(name);
        if (!prev) continue;
        if (c > prev.count) prev.count = c;
      }
    }
    const NLP_LIMIT = 200_000;
    const NLP_HEAD = 120_000;
    const NLP_TAIL = 80_000;
    const textForNlp = text.length > NLP_LIMIT ? `${text.slice(0, NLP_HEAD)} … ${text.slice(-NLP_TAIL)}` : text;
    void textForNlp;
    const properCounts = new Map<string, number>();

    const scoreMap = new Map<string, { point: number; href?: string; title?: string }>();

    for (const [name, v] of linkCounts.entries()) {
      scoreMap.set(name, { point: v.count, href: v.href });
    }
    for (const [name, c] of properCounts.entries()) {
      const prev = scoreMap.get(name);
      if (!prev) scoreMap.set(name, { point: c });
      else prev.point += c;
    }

    dropSubNameIfFullExists(scoreMap);
    for (const [name, v] of Array.from(scoreMap.entries())) {
      if ((v.point ?? 0) <= 1 && !masterParseLinkNorms.has(name) && !v.href) scoreMap.delete(name);
    }

    scoreMap.delete(masterName);
    scoreMap.delete(masterTitle);
    scoreMap.delete(canonicalTitle);

    const rankedAll = Array.from(scoreMap.entries())
      .map(([name, v]) => ({
        name,
        point: v.point,
        href: v.href,
        title: v.title,
        reverseCheckPoint: Math.max(
          forwardCountBeforeNoteFilter.get(name) ?? 0,
          forwardTextCount.get(name) ?? 0,
          v.point ?? 0
        ),
      }))
      .filter((x) => x.point > 0)
      .sort((a, b) => b.point - a.point);

    const candidateLimit = Math.min(2500, Math.max(maxRelated * 50, 400));
    /** 人物判定後に逆方向計算へ渡す候補数。maxRelated だけ変えてもここが不足すると「関連者検索」の total が頭打ちになる */
    const forwardKeep = Math.min(1500, Math.max(maxRelated * 12, Math.max(120, maxRelated + 40)));
    const ranked = rankedAll.slice(0, candidateLimit);

    const noHref = ranked.filter((r) => !r.href).slice(0, 40);
    if (noHref.length > 0) {
      onProgress?.({ phase: "候補確認", done: 0, total: noHref.length });
      await yieldToUi();
      const batchSize = 5;
      for (let i = 0; i < noHref.length; i += batchSize) {
        const batch = noHref.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (r) => {
            try {
              const hit = await this.wiki.lookupExactTitle(r.name);
              if (!hit) return;
              r.title = hit.title;
              r.href = `/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`;
            } catch {
              // ignore
            }
          })
        );
        onProgress?.({
          phase: "候補確認",
          done: Math.min(i + batch.length, noHref.length),
          total: noHref.length,
        });
        await sleep(80);
      }
    }

    /** スコア順で人物判定 API にかける最大件数（maxRelated 増加時はここも広げないと候補が足りない） */
    const HUMAN_CHECK_LIMIT = Math.min(2000, Math.max(350, maxRelated * 12));
    const HUMAN_CHECK_MIN_POINT = 1;
    const rankedWithHref = ranked
      .filter((r) => !!r.href && (r.point ?? 0) >= HUMAN_CHECK_MIN_POINT)
      .sort((a, b) => (b.point ?? 0) - (a.point ?? 0))
      .slice(0, HUMAN_CHECK_LIMIT);

    if (rankedWithHref.length > 0) {
      onProgress?.({ phase: "人物判定処理中", done: 0, total: rankedWithHref.length });
      await yieldToUi();
      const ok = new Set<string>();
      const batchSize = 5;
      for (let i = 0; i < rankedWithHref.length; i += batchSize) {
        const batch = rankedWithHref.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (r) => {
            try {
              const title = decodeWikiTitleFromHref(r.href!);
              const x = await apiWikiIsHuman(title);
              return { name: r.name, is_human: x.is_human };
            } catch {
              return { name: r.name, is_human: false };
            }
          })
        );
        for (const r of results) if (r.is_human) ok.add(r.name);
        onProgress?.({
          phase: "人物判定処理中",
          done: Math.min(i + batch.length, rankedWithHref.length),
          total: rankedWithHref.length,
        });
        await sleep(120);
      }

      const filtered = rankedWithHref.filter((r) => ok.has(r.name));
      ranked.length = 0;
      ranked.push(...filtered.sort((a, b) => b.point - a.point).slice(0, forwardKeep));
    }
    const total = ranked.length;
    const out: RelationView[] = [];
    const masterTitleCandidates = new Set<string>([masterTitle, masterName, canonicalTitle, ...masterRedirects]);
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i]!;
      onProgress?.({ phase: "関連者検索", done: i, total });
      let reversePoint = 0;
      let hasWikiPage = false;
      let slaveUrl = "";
      let slaveTitle = r.name;

      const REVERSE_CHECK_LIMIT = 80;
      const REVERSE_CHECK_ALL_IF_TOTAL_AT_MOST = 1000;
      const shouldCheckReverse =
        total <= REVERSE_CHECK_ALL_IF_TOTAL_AT_MOST ||
        i < REVERSE_CHECK_LIMIT ||
        (r.reverseCheckPoint ?? r.point ?? 0) >= 4;

      if (r.href) {
        hasWikiPage = true;
        slaveTitle = decodeWikiTitleFromHref(r.href);
        slaveUrl = hrefToUrl(r.href);

        if (shouldCheckReverse) {
          reverseCheckedNames.add(`${slaveTitle}(${r.point})`);
          await sleep(180);
          try {
            const [slaveWikitext, parseLinkTitles, slaveExtractRaw, slaveHtmlTextRaw] = await Promise.all([
              this.wiki.fetchWikitextByTitle(slaveTitle),
              this.wiki.fetchParseNs0LinkTitleSet(slaveTitle, normalizeWikiLinkTitle),
              this.wiki.fetchExtractTextByTitle(slaveTitle).catch(() => ""),
              this.wiki.fetchParsePlainTextByTitle(slaveTitle).catch(() => ""),
            ]);
            const slaveLinkCounts = countLinksFromWikitext(slaveWikitext);
            const linkScore = reverseLinkScoreFromWikitextAndParse(
              slaveLinkCounts,
              parseLinkTitles,
              masterTitleCandidates
            );

            const slaveExtractText = slaveExtractRaw.replace(/\s+/g, " ").trim();
            const slaveHtmlText = slaveHtmlTextRaw.replace(/\s+/g, " ").trim();
            let textScore = 0;
            for (const cand of masterTitleCandidates) {
              const norm = normalizeWikiLinkTitle(cand);
              if (!norm) continue;
              const cExtract = slaveExtractText ? countOccurrences(slaveExtractText, norm) : 0;
              const cHtml = slaveHtmlText ? countOccurrences(slaveHtmlText, norm) : 0;
              const c = Math.max(cExtract, cHtml);
              if (c > textScore) textScore = c;
            }

            reversePoint = Math.max(linkScore, textScore);
          } catch (e) {
            console.warn(
              "reversePoint calc failed",
              {
                masterTitle,
                masterName,
                slaveTitle,
                href: r.href,
              },
              e
            );
            reversePoint = 0;
          }
        }
      }

      out.push({
        slave: { name: r.name, title: slaveTitle, url: slaveUrl || masterUrl },
        forwardPoint: r.point,
        reversePoint,
        totalPoint: r.point + reversePoint,
        hasWikiPage,
      });
    }
    onProgress?.({ phase: "関連者検索", done: total, total });
    if (reverseCheckedNames.size > 0) {
      console.log("[wiki] reverse checked", {
        masterTitle,
        totalCandidates: total,
        checked: reverseCheckedNames.size,
        sample: Array.from(reverseCheckedNames).slice(0, 10),
      });
    } else {
      console.log("[wiki] reverse checked none", { masterTitle, totalCandidates: total });
    }

    out.sort((a, b) => b.totalPoint - a.totalPoint);
    return { master, relations: out.slice(0, maxRelated) };
  }
}

