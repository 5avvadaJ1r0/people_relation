/** 本番の公開オリジン（canonical / sitemap / JSON-LD）。Pages の本番 URL と揃える。 */
export const SITE_CANONICAL_ORIGIN = "https://people-relation.pages.dev";

/**
 * Google 検索結果の「サイト名」（Cloudflare 等のホスト名ではなくこちらを優先させる）。
 * @see https://developers.google.com/search/docs/appearance/site-names
 */
export const SITE_NAME = "People Relation";

/** SITE_NAME が選ばれない場合の候補（先頭ほど優先） */
export const SITE_ALTERNATE_NAMES = [
  "人物相関図",
  "有名人相関図",
  "people-relation.pages.dev",
] as const;

export const PAGE_TITLE = "有名人・著名人の関係者・関連者リストと相関図作成";

export const PAGE_DESCRIPTION =
  "有名人・著名人の関係者・関連者をWikipediaからリストアップし、相関図を無料で作成。有名人相関図・著名人の関係者マップをブラウザ上で可視化するツールです。";

export const CANONICAL_PAGE_URL = `${SITE_CANONICAL_ORIGIN}/`;

const upsertMeta = (attr: "name" | "property", key: string, content: string) => {
  const selector =
    attr === "name" ? `meta[name="${key}"]` : `meta[property="${key}"]`;
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

const upsertLink = (rel: string, href: string) => {
  let el = document.head.querySelector(
    `link[rel="${rel}"]`,
  ) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
};

/** トップページ向けの title / description / OGP / canonical を適用する */
export const applyDefaultSiteSeo = (title: string = PAGE_TITLE): void => {
  document.title = title;
  upsertMeta("name", "description", PAGE_DESCRIPTION);
  upsertMeta("name", "robots", "index, follow");
  upsertLink("canonical", CANONICAL_PAGE_URL);
  upsertMeta("property", "og:type", "website");
  upsertMeta("property", "og:site_name", SITE_NAME);
  upsertMeta("property", "og:locale", "ja_JP");
  upsertMeta("property", "og:title", title);
  upsertMeta("name", "application-name", SITE_NAME);
  upsertMeta("property", "og:description", PAGE_DESCRIPTION);
  upsertMeta("property", "og:url", CANONICAL_PAGE_URL);
  upsertMeta("name", "twitter:card", "summary");
  upsertMeta("name", "twitter:title", title);
  upsertMeta("name", "twitter:description", PAGE_DESCRIPTION);
};

const WEBSITE_ID = `${CANONICAL_PAGE_URL}#website`;
const WEB_APP_ID = `${CANONICAL_PAGE_URL}#app`;

export const SITE_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      url: CANONICAL_PAGE_URL,
      name: SITE_NAME,
      alternateName: [...SITE_ALTERNATE_NAMES],
      inLanguage: "ja",
    },
    {
      "@type": "WebApplication",
      "@id": WEB_APP_ID,
      name: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
      url: CANONICAL_PAGE_URL,
      isPartOf: { "@id": WEBSITE_ID },
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Web",
      inLanguage: "ja",
      keywords: [
        "有名人 関係者",
        "有名人 関連者",
        "有名人 相関図",
        "著名人 関係者",
        "著名人 関連者",
        "著名人 相関図",
      ],
    },
  ],
} as const;
