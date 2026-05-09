import type { WikiSearchItem } from "../types";
import { ExternalApiFetcher } from "./ExternalApiFetcher";

const WIKI_API = "https://ja.wikipedia.org/w/api.php";

export class WikiApiClient {
  constructor(private readonly fetcher: ExternalApiFetcher) {}

  private async parseJsonOrThrow<T>(res: Response, label: string): Promise<T> {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return (await res.json()) as T;
    const text = await res.text();
    const head = text.slice(0, 120).replace(/\s+/g, " ");
    throw new Error(`${label}: expected JSON but got "${ct || "unknown"}" body="${head}"`);
  }

  async searchPeople(query: string): Promise<WikiSearchItem[]> {
    const q = String(query ?? "").trim();
    if (!q) return [];

    const run = async (useTitleWhat: boolean): Promise<any> => {
      const params = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: q,
        format: "json",
        origin: "*",
        utf8: "1",
        srlimit: "20",
      });
      // 明石家さんま のように一致ページがあっても、本文検索だと上位が番組記事で埋まりやすい。
      // 対応できる wiki ではタイトル検索を優先する。
      if (useTitleWhat) params.set("srwhat", "title");
      const res = await this.fetcher.fetchExternalApiWithRetry(`${WIKI_API}?${params.toString()}`);
      if (!res.ok) throw new Error(`wikiSearch failed: ${res.status}`);
      return this.parseJsonOrThrow<any>(res, "wikiSearchPeople");
    };

    let json = await run(true);
    // ja.wikipedia.org 等では srwhat=title が無効化されている（search-title-disabled）
    if (json?.error?.code === "search-title-disabled") {
      json = await run(false);
    }
    if (json?.error) {
      const code = String(json.error.code ?? "error");
      const info = String(json.error.info ?? "");
      throw new Error(`wikiSearchPeople: ${code} ${info}`.trim());
    }
    const items = (json?.query?.search ?? []) as Array<{ title: string; pageid: number; snippet?: string }>;
    return items.map((i) => ({ title: i.title, pageid: i.pageid, snippet: i.snippet }));
  }

  /** pageprops.disambiguation があるページ（曖昧さ回避）の pageid */
  async fetchDisambiguationPageIdsByTitles(titles: string[]): Promise<Set<number>> {
    const dab = new Set<number>();
    const chunkSize = 45;
    for (let i = 0; i < titles.length; i += chunkSize) {
      const chunk = titles.slice(i, i + chunkSize).map((x) => String(x ?? "").trim()).filter(Boolean);
      if (chunk.length === 0) continue;
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        prop: "pageprops",
        ppprop: "disambiguation",
        titles: chunk.join("|"),
        redirects: "1",
        utf8: "1",
        origin: "*",
      });
      const res = await this.fetcher.fetchExternalApiWithRetry(`${WIKI_API}?${params.toString()}`);
      if (!res.ok) throw new Error(`fetchDisambiguationPageIdsByTitles failed: ${res.status}`);
      const json = (await this.parseJsonOrThrow<any>(res, "fetchDisambiguationPageIdsByTitles")) as any;
      const pages = (json?.query?.pages ?? {}) as Record<string, any>;
      for (const p of Object.values(pages)) {
        if (!p || p.invalid != null) continue;
        const pp = (p.pageprops ?? {}) as Record<string, unknown>;
        if ("disambiguation" in pp) {
          const pid = Number(p.pageid);
          if (Number.isFinite(pid)) dab.add(pid);
        }
      }
    }
    return dab;
  }

  async lookupExactTitle(title: string): Promise<WikiSearchItem | null> {
    const t = String(title ?? "").trim();
    if (!t) return null;
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      titles: t,
      redirects: "1",
      utf8: "1",
      origin: "*",
    });
    const res = await this.fetcher.fetchWithTimeout(`${WIKI_API}?${params.toString()}`);
    if (!res.ok) throw new Error(`wikiLookupExactTitle failed: ${res.status}`);
    const json = (await this.parseJsonOrThrow<any>(res, "wikiLookupExactTitle")) as any;
    const pages = (json?.query?.pages ?? {}) as Record<string, any>;
    const first = Object.values(pages)[0] as any;
    if (!first || first.invalid != null || first.missing != null) return null;
    const pageid = Number(first.pageid);
    const outTitle = String(first.title ?? t);
    if (!Number.isFinite(pageid) || !outTitle) return null;
    return { title: outTitle, pageid };
  }

  async fetchExtractTextByTitle(title: string): Promise<string> {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "extracts",
      explaintext: "1",
      exsectionformat: "plain",
      redirects: "1",
      utf8: "1",
      origin: "*",
      titles: title,
    });
    const res = await this.fetcher.fetchExternalApiWithRetry(`${WIKI_API}?${params.toString()}`);
    if (!res.ok) throw new Error(`fetchWikiExtractText failed: ${res.status}`);
    const json = (await this.parseJsonOrThrow<any>(res, "fetchWikiExtractTextByTitle")) as any;
    const pages = (json?.query?.pages ?? {}) as Record<string, any>;
    const first = Object.values(pages)[0] as any;
    return (first?.extract ?? "") as string;
  }

  private stripHtmlToPlainText(html: string): string {
    const s = String(html ?? "");
    return s
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  async fetchParsePlainTextByTitle(title: string): Promise<string> {
    const params = new URLSearchParams({
      action: "parse",
      format: "json",
      prop: "text",
      redirects: "1",
      utf8: "1",
      origin: "*",
      page: title,
    });
    const res = await this.fetcher.fetchExternalApiWithRetry(`${WIKI_API}?${params.toString()}`);
    if (!res.ok) throw new Error(`fetchWikiParsePlainText failed: ${res.status}`);
    const json = (await this.parseJsonOrThrow<any>(res, "fetchWikiParsePlainTextByTitle")) as any;
    const html = String(json?.parse?.text?.["*"] ?? "");
    return this.stripHtmlToPlainText(html);
  }

  async fetchWikitextByTitle(title: string): Promise<string> {
    const params = new URLSearchParams({
      action: "parse",
      format: "json",
      prop: "wikitext",
      redirects: "1",
      utf8: "1",
      origin: "*",
      page: title,
    });
    const res = await this.fetcher.fetchExternalApiWithRetry(`${WIKI_API}?${params.toString()}`);
    if (!res.ok) throw new Error(`fetchWikiWikitext failed: ${res.status}`);
    const json = (await this.parseJsonOrThrow<any>(res, "fetchWikiWikitextByTitle")) as any;
    return (json?.parse?.wikitext?.["*"] ?? "") as string;
  }

  async fetchCanonicalTitle(title: string): Promise<string> {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      titles: title,
      redirects: "1",
      prop: "info",
      utf8: "1",
      origin: "*",
    });
    const res = await this.fetcher.fetchExternalApiWithRetry(`${WIKI_API}?${params.toString()}`);
    if (!res.ok) throw new Error(`fetchWikiCanonicalTitle failed: ${res.status}`);
    const json = (await this.parseJsonOrThrow<any>(res, "fetchWikiCanonicalTitle")) as any;
    const pages = (json?.query?.pages ?? {}) as Record<string, any>;
    const first = Object.values(pages)[0] as any;
    if (!first || first.invalid != null) throw new Error("fetchWikiCanonicalTitle: invalid title");
    if (first.missing != null) throw new Error("fetchWikiCanonicalTitle: missing page");
    return (first.title ?? title) as string;
  }

  async fetchRedirectTitles(title: string): Promise<string[]> {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      titles: title,
      prop: "redirects",
      rdlimit: "max",
      utf8: "1",
      origin: "*",
    });
    const res = await this.fetcher.fetchExternalApiWithRetry(`${WIKI_API}?${params.toString()}`);
    if (!res.ok) throw new Error(`fetchRedirectTitles failed: ${res.status}`);
    const json = (await this.parseJsonOrThrow<any>(res, "fetchRedirectTitles")) as any;
    const pages = (json?.query?.pages ?? {}) as Record<string, any>;
    const first = Object.values(pages)[0] as any;
    const redirects = (first?.redirects ?? []) as Array<{ title: string }>;
    const out = redirects.map((r) => r.title).filter(Boolean);
    return Array.from(new Set(out));
  }

  async fetchParseNs0LinkTitleSet(pageTitle: string, normalize: (t: string) => string): Promise<Set<string>> {
    const params = new URLSearchParams({
      action: "parse",
      format: "json",
      prop: "links",
      page: pageTitle,
      utf8: "1",
      origin: "*",
    });
    const res = await this.fetcher.fetchExternalApiWithRetry(`${WIKI_API}?${params.toString()}`);
    if (!res.ok) throw new Error(`fetchParseNs0LinkTitleSet failed: ${res.status}`);
    const json = (await this.parseJsonOrThrow<any>(res, "fetchParseNs0LinkTitleSet")) as any;
    const links = (json?.parse?.links ?? []) as Array<{ ns: number; "*": string }>;
    const set = new Set<string>();
    for (const L of links) {
      if (L.ns !== 0) continue;
      const t = L["*"];
      if (!t || t.includes(":")) continue;
      set.add(normalize(t));
    }
    return set;
  }

  async fetchHatnoteNs0LinkSets(pageTitle: string, normalize: (t: string) => string): Promise<{
    inNotes: Set<string>;
    outOfNotes: Set<string>;
  }> {
    const params = new URLSearchParams({
      action: "parse",
      format: "json",
      prop: "text",
      redirects: "1",
      utf8: "1",
      origin: "*",
      page: pageTitle,
    });
    const res = await this.fetcher.fetchExternalApiWithRetry(`${WIKI_API}?${params.toString()}`);
    if (!res.ok) throw new Error(`fetchHatnoteNs0LinkTitleSet failed: ${res.status}`);
    const json = (await this.parseJsonOrThrow<any>(res, "fetchHatnoteNs0LinkTitleSet")) as any;
    const html = String(json?.parse?.text?.["*"] ?? "");

    const inNotes = new Set<string>();
    const hatnoteBlocks: string[] = [];
    const reBlock =
      /<(?:div|table)[^>]+class="[^"]*(?:hatnote|dablink|ambox)[^"]*"[^>]*>[\s\S]*?<\/(?:div|table)>/gi;
    let m: RegExpExecArray | null;
    while ((m = reBlock.exec(html))) hatnoteBlocks.push(m[0]);
    const blockText = hatnoteBlocks.join("\n");

    const reHref = /href="\/wiki\/([^"#?]+)"/g;
    let h: RegExpExecArray | null;
    while ((h = reHref.exec(blockText))) {
      const encoded = h[1] ?? "";
      if (!encoded) continue;
      const title = normalize(encoded);
      if (!title) continue;
      if (title.includes(":")) continue;
      inNotes.add(title);
    }

    const all = new Set<string>();
    const reAllHref = /href="\/wiki\/([^"#?]+)"/g;
    let a: RegExpExecArray | null;
    while ((a = reAllHref.exec(html))) {
      const encoded = a[1] ?? "";
      if (!encoded) continue;
      const title = normalize(encoded);
      if (!title) continue;
      if (title.includes(":")) continue;
      all.add(title);
    }
    const outOfNotes = new Set<string>();
    for (const t of all) if (!inNotes.has(t)) outOfNotes.add(t);

    return { inNotes, outOfNotes };
  }
}

