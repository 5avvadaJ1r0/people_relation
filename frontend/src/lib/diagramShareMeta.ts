import { buildDiagramShareOgImageApiUrl, buildDiagramSharePageUrl } from "./diagramShare";
import { applyDefaultSiteSeo, PAGE_TITLE } from "./siteSeo";

const META_KEYS = [
  "description",
  "og:type",
  "og:title",
  "og:description",
  "og:url",
  "og:image",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
] as const;

const upsertMeta = (attr: "name" | "property", key: string, content: string) => {
  const selector =
    attr === "name"
      ? `meta[name="${key}"]`
      : `meta[property="${key}"]`;
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

const removeManagedMeta = () => {
  for (const key of META_KEYS) {
    const byName = document.head.querySelector(`meta[name="${key}"]`);
    byName?.remove();
    const byProp = document.head.querySelector(`meta[property="${key}"]`);
    byProp?.remove();
  }
};

export type DiagramShareMetaInput = {
  shareId: string;
  title: string;
  description: string;
  /** OG 画像を API にアップロード済みのとき true */
  hasOgImage: boolean;
};

export const applyDiagramShareMeta = (input: DiagramShareMetaInput): void => {
  const pageUrl = buildDiagramSharePageUrl(input.shareId);
  document.title = input.title;
  upsertMeta("name", "description", input.description);
  upsertMeta("property", "og:type", "website");
  upsertMeta("property", "og:title", input.title);
  upsertMeta("property", "og:description", input.description);
  upsertMeta("property", "og:url", pageUrl);
  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", input.title);
  upsertMeta("name", "twitter:description", input.description);
  if (input.hasOgImage) {
    const imageUrl = buildDiagramShareOgImageApiUrl(input.shareId);
    upsertMeta("property", "og:image", imageUrl);
    upsertMeta("name", "twitter:image", imageUrl);
  }
};

export const clearDiagramShareMeta = (defaultTitle: string = PAGE_TITLE): void => {
  removeManagedMeta();
  applyDefaultSiteSeo(defaultTitle);
};
