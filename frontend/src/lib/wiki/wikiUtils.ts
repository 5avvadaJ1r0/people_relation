const escapeRegExp = (s: string): string => {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export const countOccurrences = (text: string, needle: string): number => {
  const n = needle.trim();
  if (!n) return 0;
  const re = new RegExp(escapeRegExp(n), "g");
  const m = text.match(re);
  return m ? m.length : 0;
};

/** リンク先タイトル比較用（アンダースコア/空白の揺れを吸収） */
export const normalizeWikiLinkTitle = (title: string): string => {
  const raw = String(title ?? "");
  // NBSP/ゼロ幅/改行などを吸収して比較できるようにする
  const t0 = raw
    .replace(/_/g, " ")
    .replace(/\u00A0/g, " ") // nbsp
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width
    .replace(/\s+/g, " ")
    .trim();
  if (!t0) return "";
  try {
    return decodeURIComponent(t0).replace(/\s+/g, " ").trim();
  } catch {
    // "100%" など不正な%を含む文字列で decodeURIComponent が例外になるのを防ぐ
    return t0;
  }
};

export const decodeWikiTitleFromHref = (href: string): string => {
  const rest = href.slice("/wiki/".length);
  try {
    return decodeURIComponent(rest).replace(/_/g, " ");
  } catch {
    // まれに % を含むが不正なエンコードのhrefが来ることがあるため、落ちないようにする
    return rest.replace(/_/g, " ");
  }
};

export const hrefToUrl = (href: string): string => {
  return `https://ja.wikipedia.org${href}`;
};

/** 脚注・外部リンクなど、参照・外部URLが集中する節を wikitext から除去（`[[...]]` カウントのノイズ低減） */
export const stripNoiseWikiSectionsFromWikitext = (wikitext: string): string => {
  let w = String(wikitext ?? "");
  for (const name of ["脚注", "外部リンク"]) {
    const esc = escapeRegExp(name);
    // Navboxes のほか、キングレコード等の末尾テンプレ・カテゴリ直前まで（{{キングレコード}} 内の [[...]] を源とするカウントを防ぐ）
    const re = new RegExp(
      `\\n==\\s*${esc}\\s*==\\s*\\n[\\s\\S]*?(?=\\n==[^=]|\\n\\{\\{Navboxes|\\n\\n\\{\\{|\\n\\{\\{Normdaten|\\n\\{\\{DEFAULTSORT|\\n\\{\\{デフォルトソート|\\n\\[\\[Category:)`,
      "i"
    );
    w = w.replace(re, "\n");
  }
  return w;
};

export const countLinksFromWikitext = (wikitext: string): Map<string, { count: number; href: string }> => {
  // [[タイトル]] / [[タイトル|表示]] / [[タイトル#節|表示]]
  const re = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  const map = new Map<string, { count: number; href: string }>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(wikitext))) {
    const target = (m[1] ?? "").trim();
    if (!target) continue;
    // 特別ページ等（: を含む）を除外
    if (target.includes(":")) continue;
    // タイトルの揺れ（空白/アンダースコア/URLエンコードなど）で同一人物が重複しないよう正規化
    const norm = normalizeWikiLinkTitle(target);
    if (!norm) continue;
    const href = `/wiki/${encodeURIComponent(norm.replace(/ /g, "_"))}`;
    const prev = map.get(norm);
    if (!prev) map.set(norm, { count: 1, href });
    else prev.count += 1;
  }
  return map;
};

export const reverseLinkScoreFromWikitextAndParse = (
  slaveLinkCounts: Map<string, { count: number; href: string }>,
  parseNs0Titles: Set<string>,
  masterTitleCandidates: Set<string>
): number => {
  const candNorms = new Set([...masterTitleCandidates].map(normalizeWikiLinkTitle));
  let wtSum = 0;
  for (const [k, v] of slaveLinkCounts) {
    if (candNorms.has(normalizeWikiLinkTitle(k))) wtSum += v.count;
  }
  let parseHit = false;
  for (const n of candNorms) {
    if (parseNs0Titles.has(n)) {
      parseHit = true;
      break;
    }
  }
  // テンプレートのみのリンクは wikitext 0 になりがちなので、展開後に存在すれば最低1としてカウント
  return Math.max(wtSum, parseHit ? 1 : 0);
};

export const dropSubNameIfFullExists = (
  scoreMap: Map<string, { point: number; href?: string; title?: string }>
): void => {
  // フルネームがある場合に、部分一致の短い候補（例: 山田 / 太郎）を落とす
  const names = Array.from(scoreMap.keys()).sort((a, b) => b.length - a.length);
  const toDelete = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const full = names[i]!;
    if (full.length < 3) continue;
    for (let j = i + 1; j < names.length; j++) {
      const sub = names[j]!;
      if (sub.length < 2) continue;
      if (!full.includes(sub)) continue;
      const subMeta = scoreMap.get(sub);
      const fullMeta = scoreMap.get(full);

      // 例外: sub が full の「先頭一致で末尾1〜2文字欠け」(木村拓 vs 木村拓哉) のような短縮形なら、
      // sub が href を持っていてもノイズになりやすいので落とす。
      const isNearPrefix = full.startsWith(sub) && full.length > sub.length && full.length - sub.length <= 2;
      if (isNearPrefix) {
        // fullが記事対象（hrefあり）かつ、subのpointがfullより優位でないなら落とす
        if (fullMeta?.href && (subMeta?.point ?? 0) <= (fullMeta.point ?? 0)) {
          toDelete.add(sub);
          continue;
        }
      }

      // sub側がWikipediaリンク（href）を持つ＝明確な記事対象の場合は落とさない。
      if (subMeta?.href) continue;

      toDelete.add(sub);
    }
  }
  for (const n of toDelete) scoreMap.delete(n);
};

