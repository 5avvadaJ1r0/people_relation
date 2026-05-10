import type { WikiSearchItem } from "../types";
import { ExternalApiFetcher } from "./ExternalApiFetcher";
import { isNoiseWikiSectionFragment } from "./wikiUtils";

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
    const raw = (first?.extract ?? "") as string;
    return this.stripWikiNoiseSectionsFromExtractPlain(raw);
  }

  /** `mw-heading2` + `h2#…` から次見出し／navbox／パーサレポート手前までを 1 セクション分除去 */
  private stripOneMwHeadingSectionByH2Id(html: string, h2Id: string): string {
    const startMarker = `<div class="mw-heading mw-heading2"><h2 id="${h2Id}">`;
    const start = html.indexOf(startMarker);
    if (start === -1) return html;

    const candidates: number[] = [];
    const nextHeading = html.indexOf('<div class="mw-heading mw-heading2">', start + 5);
    if (nextHeading !== -1 && nextHeading > start) candidates.push(nextHeading);
    for (const needle of ["<table class=\"navbox", "<div class=\"navbox", "<!-- NewPP limit report"]) {
      const idx = html.indexOf(needle, start + 1);
      if (idx !== -1) candidates.push(idx);
    }
    const end = candidates.length > 0 ? Math.min(...candidates) : html.length;
    return html.slice(0, start) + html.slice(end);
  }

  /** `class` にトークン `navbox` を含む `<div>` / `<table>`（`navbox-inner` は除外）をネスト対応で除去 */
  private stripNavboxBlocks(html: string): string {
    let h = String(html ?? "");
    for (let iter = 0; iter < 80; iter++) {
      const next = this.stripOneNavboxBlock(h);
      if (next === h) break;
      h = next;
    }
    return h;
  }

  private classListIncludesExactNavbox(classAttr: string): boolean {
    return String(classAttr ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .includes("navbox");
  }

  private stripBalancedDivOrTable(html: string, start: number, openTagLength: number, tag: "div" | "table"): string {
    const h = String(html ?? "");
    let pos = start + openTagLength;
    let depth = 1;
    const openRe = tag === "div" ? /<div\b[^>]*>/i : /<table\b[^>]*>/i;
    const closeRe = tag === "div" ? /<\/div\s*>/i : /<\/table\s*>/i;
    while (pos < h.length && depth > 0) {
      const slice = h.slice(pos);
      const nextOpen = openRe.exec(slice);
      const nextClose = closeRe.exec(slice);
      const oIdx = nextOpen?.index ?? Infinity;
      const cIdx = nextClose?.index ?? Infinity;
      if (oIdx !== Infinity && oIdx <= cIdx) {
        depth++;
        pos += oIdx + nextOpen![0].length;
      } else if (cIdx !== Infinity) {
        depth--;
        pos += cIdx + nextClose![0].length;
        if (depth === 0) return h.slice(0, start) + h.slice(pos);
      } else {
        break;
      }
    }
    return h;
  }

  private stripOneNavboxBlock(html: string): string {
    const h = String(html ?? "");
    let best: { index: number; len: number; tag: "div" | "table" } | null = null;
    const re = /<(div|table)\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(h))) {
      const full = m[0];
      const clsMatch = /\bclass\s*=\s*["']([^"']*)["']/i.exec(full);
      if (!this.classListIncludesExactNavbox(clsMatch?.[1] ?? "")) continue;
      const tag = (m[1] ?? "").toLowerCase();
      if (tag !== "div" && tag !== "table") continue;
      const idx = m.index;
      if (!best || idx < best.index) best = { index: idx, len: full.length, tag: tag as "div" | "table" };
    }
    if (!best) return h;
    return this.stripBalancedDivOrTable(h, best.index, best.len, best.tag);
  }

  /** ページ末尾のカテゴリリンク（`#catlinks`）。ネストした inner `<div>` にも対応 */
  private stripCatlinksBlock(html: string): string {
    const h = String(html ?? "");
    const openRe = /<div\b[^>]*\bid\s*=\s*["']catlinks["'][^>]*>/i;
    const m = openRe.exec(h);
    if (!m) return h;
    const start = m.index;
    let pos = m.index + m[0].length;
    let depth = 1;
    while (pos < h.length && depth > 0) {
      const slice = h.slice(pos);
      const nextOpen = /<div\b[^>]*>/i.exec(slice);
      const nextClose = /<\/div\s*>/i.exec(slice);
      const oIdx = nextOpen?.index ?? Infinity;
      const cIdx = nextClose?.index ?? Infinity;
      if (oIdx !== Infinity && oIdx <= cIdx) {
        depth++;
        pos += oIdx + nextOpen![0].length;
      } else if (cIdx !== Infinity) {
        depth--;
        pos += cIdx + nextClose![0].length;
        if (depth === 0) return h.slice(0, start) + h.slice(pos);
      } else {
        break;
      }
    }
    return h;
  }

  /** 脚注・外部リンクなど参照／外部URLが集中する節を除去（ブラウザの section・parse HTML の対応見出し） */
  private stripWikiNoiseSectionsFromParsedHtml(html: string): string {
    let h = String(html ?? "");
    for (const label of ["脚注", "外部リンク"]) {
      h = h.replace(
        new RegExp(`<section\\b[^>]*\\baria-labelledby="${label}"[^>]*>[\\s\\S]*?<\\/section>`, "gi"),
        ""
      );
    }
    for (const id of ["脚注", "外部リンク"]) {
      h = this.stripOneMwHeadingSectionByH2Id(h, id);
    }
    h = this.stripNavboxBlocks(h);
    h = this.stripCatlinksBlock(h);
    return h;
  }

  /** `explaintext` から脚注ブロック・末尾の外部リンクブロックを除去 */
  private stripWikiNoiseSectionsFromExtractPlain(text: string): string {
    let t = String(text ?? "");
    t = t.replace(
      /\r?\n脚注\s*\r?\n[\s\S]*?(?=\r?\n(?:注釈|出典|参考文献|外部リンク|関連項目|その他の関連項目)\s*\r?\n|$)/,
      ""
    );
    const extRe = /\r?\n外部リンク\s*\r?\n[\s\S]*$/;
    const extM = extRe.exec(t);
    if (extM) t = t.slice(0, extM.index).trimEnd();
    return t.trimEnd();
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
    return this.stripHtmlToPlainText(this.stripWikiNoiseSectionsFromParsedHtml(html));
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

  /**
   * `action=query&redirects=1` の normalized / redirects を踏襲し、各入力タイトル→転送解決後の記事タイトルを返す。
   * バックエンド `wiki_resolve.resolve_ja_wikipedia_titles_sync` と同じ考え方。
   */
  private parseResolutionChunk(chunk: string[], data: unknown): Map<string, string> {
    const q = (data as { query?: unknown })?.query as Record<string, unknown> | undefined;
    const rawNorm = q?.normalized;
    const rawRed = q?.redirects;
    const normalized = Array.isArray(rawNorm) ? rawNorm.filter((x): x is Record<string, string> => typeof x === "object") : [];
    const redirects = Array.isArray(rawRed) ? rawRed.filter((x): x is Record<string, string> => typeof x === "object") : [];

    const applyNormalizedSteps = (t: string): string => {
      let cur = t;
      for (let guard = 0; guard < 10; guard++) {
        let nxt = cur;
        for (const n of normalized) {
          if (cur === (n.from ?? "")) {
            nxt = String(n.to ?? cur);
            break;
          }
        }
        if (nxt === cur) break;
        cur = nxt;
      }
      return cur;
    };

    const redMap: Record<string, string> = {};
    for (const r of redirects) {
      const f = r.from;
      if (f) redMap[String(f)] = String(r.to ?? "");
    }

    const followRedirects = (t: string): string => {
      let cur = t;
      const seen = new Set<string>();
      for (let guard = 0; guard < 30; guard++) {
        const nxt = redMap[cur];
        if (!nxt || seen.has(cur)) break;
        seen.add(cur);
        cur = nxt;
      }
      return cur;
    };

    const out = new Map<string, string>();
    for (const orig of chunk) {
      const s = String(orig ?? "").trim();
      if (!s) continue;
      let t = applyNormalizedSteps(s);
      t = followRedirects(t);
      out.set(orig, t);
    }
    return out;
  }

  /** 複数タイトルをチャンクで `redirects=1` 解決（入力キー→正規記事タイトル） */
  async resolveCanonicalTitlesForTitles(titles: string[]): Promise<Map<string, string>> {
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const t of titles) {
      const s = String(t ?? "").trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      uniq.push(s);
    }
    const out = new Map<string, string>();
    const chunkSize = 45;
    for (let i = 0; i < uniq.length; i += chunkSize) {
      const chunk = uniq.slice(i, i + chunkSize);
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        titles: chunk.join("|"),
        redirects: "1",
        utf8: "1",
        origin: "*",
      });
      const res = await this.fetcher.fetchExternalApiWithRetry(`${WIKI_API}?${params.toString()}`);
      if (!res.ok) continue;
      const json = await this.parseJsonOrThrow<unknown>(res, "resolveCanonicalTitlesForTitles");
      const part = this.parseResolutionChunk(chunk, json);
      for (const [k, v] of part) out.set(k, v);
    }
    for (const t of uniq) {
      if (!out.has(t)) out.set(t, t);
    }
    return out;
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

  /** ノイズ節除去後の HTML に現れる ns0 の `/wiki/` リンクタイトルのみ（`prop=links` は脚注・外部リンク内も含むため使わない） */
  private collectNs0WikiTitlesFromHtml(html: string, normalize: (t: string) => string): Set<string> {
    const set = new Set<string>();
    const reAllHref = /href="\/wiki\/([^"]+)"/g;
    let a: RegExpExecArray | null;
    while ((a = reAllHref.exec(html))) {
      const path = a[1] ?? "";
      if (!path) continue;
      const qIdx = path.indexOf("?");
      const pathOnly = qIdx >= 0 ? path.slice(0, qIdx) : path;
      const hashIdx = pathOnly.indexOf("#");
      const encoded = hashIdx >= 0 ? pathOnly.slice(0, hashIdx) : pathOnly;
      const fragment = hashIdx >= 0 ? pathOnly.slice(hashIdx + 1) : "";
      if (fragment && isNoiseWikiSectionFragment(fragment)) continue;
      if (!encoded) continue;
      const title = normalize(encoded);
      if (!title) continue;
      if (title.includes(":")) continue;
      set.add(title);
    }
    return set;
  }

  async fetchParseNs0LinkTitleSet(pageTitle: string, normalize: (t: string) => string): Promise<Set<string>> {
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
    if (!res.ok) throw new Error(`fetchParseNs0LinkTitleSet failed: ${res.status}`);
    const json = (await this.parseJsonOrThrow<any>(res, "fetchParseNs0LinkTitleSet")) as any;
    const htmlRaw = String(json?.parse?.text?.["*"] ?? "");
    const html = this.stripWikiNoiseSectionsFromParsedHtml(htmlRaw);
    return this.collectNs0WikiTitlesFromHtml(html, normalize);
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
    const htmlRaw = String(json?.parse?.text?.["*"] ?? "");
    const html = this.stripWikiNoiseSectionsFromParsedHtml(htmlRaw);

    const inNotes = new Set<string>();
    const hatnoteBlocks: string[] = [];
    const reBlock =
      /<(?:div|table)[^>]+class="[^"]*(?:hatnote|dablink|ambox)[^"]*"[^>]*>[\s\S]*?<\/(?:div|table)>/gi;
    let m: RegExpExecArray | null;
    while ((m = reBlock.exec(html))) hatnoteBlocks.push(m[0]);
    const blockText = hatnoteBlocks.join("\n");

    const reHref = /href="\/wiki\/([^"]+)"/g;
    let h: RegExpExecArray | null;
    while ((h = reHref.exec(blockText))) {
      const path = h[1] ?? "";
      if (!path) continue;
      const qIdx = path.indexOf("?");
      const pathOnly = qIdx >= 0 ? path.slice(0, qIdx) : path;
      const hashIdx = pathOnly.indexOf("#");
      const encoded = hashIdx >= 0 ? pathOnly.slice(0, hashIdx) : pathOnly;
      const fragment = hashIdx >= 0 ? pathOnly.slice(hashIdx + 1) : "";
      if (fragment && isNoiseWikiSectionFragment(fragment)) continue;
      if (!encoded) continue;
      const title = normalize(encoded);
      if (!title) continue;
      if (title.includes(":")) continue;
      inNotes.add(title);
    }

    const all = this.collectNs0WikiTitlesFromHtml(html, normalize);
    const outOfNotes = new Set<string>();
    for (const t of all) if (!inNotes.has(t)) outOfNotes.add(t);

    return { inNotes, outOfNotes };
  }
}

