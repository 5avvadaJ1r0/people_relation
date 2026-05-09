const FETCH_TIMEOUT_MS = 25_000;
const MIN_EXTERNAL_API_INTERVAL_MS = 150; // Wikipedia/Wikidata への最小間隔（rate制限対策）
const MAX_RETRY = 4;

let lastExternalApiAt = 0;

export class ExternalApiFetcher {
  constructor(
    private readonly opts: {
      fetchTimeoutMs?: number;
      minExternalIntervalMs?: number;
      maxRetry?: number;
    } = {}
  ) {}

  private sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  private isExternalWikiLikeUrl(input: RequestInfo | URL): boolean {
    const s = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
    return s.startsWith("https://ja.wikipedia.org/") || s.startsWith("https://www.wikidata.org/");
  }

  private parseRetryAfterMs(res: Response): number | null {
    const ra = res.headers.get("retry-after");
    if (!ra) return null;
    const n = Number(ra);
    if (Number.isFinite(n)) return Math.max(0, Math.round(n * 1000));
    const dt = Date.parse(ra);
    if (!Number.isFinite(dt)) return null;
    const ms = dt - Date.now();
    return ms > 0 ? ms : 0;
  }

  async fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeoutMs?: number) {
    const ms = timeoutMs ?? this.opts.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      return await fetch(input, { ...init, signal: ac.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async fetchExternalApiWithRetry(input: RequestInfo | URL, init?: RequestInit, timeoutMs?: number) {
    const maxRetry = this.opts.maxRetry ?? MAX_RETRY;
    const minInterval = this.opts.minExternalIntervalMs ?? MIN_EXTERNAL_API_INTERVAL_MS;
    // Wikipedia/Wikidata への過剰連打を避ける（単純なグローバル間隔制御）
    for (let attempt = 0; attempt <= maxRetry; attempt++) {
      if (this.isExternalWikiLikeUrl(input)) {
        const now = Date.now();
        const wait = Math.max(0, minInterval - (now - lastExternalApiAt));
        if (wait > 0) await this.sleep(wait);
        lastExternalApiAt = Date.now();
      }

      const res = await this.fetchWithTimeout(input, init, timeoutMs);
      if (res.ok) return res;

      // rate制限/一時エラーはリトライ
      if (res.status === 429 || res.status === 503 || res.status === 504) {
        if (attempt >= maxRetry) return res;
        const ra = this.parseRetryAfterMs(res);
        const backoff = 300 * Math.pow(2, attempt); // 300,600,1200,2400...
        await this.sleep(ra ?? backoff);
        continue;
      }
      return res;
    }
    // 通常ここには来ない
    return await this.fetchWithTimeout(input, init, timeoutMs);
  }
}

