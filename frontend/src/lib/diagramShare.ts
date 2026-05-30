/** 相関図共有 URL のクエリ名（`?diagram_share_id=`） */
export const DIAGRAM_SHARE_QUERY_PARAM = "diagram_share_id";

const SOCIAL_CRAWLER_RE =
  /Twitterbot|facebookexternalhit|LinkedInBot|Slackbot|Discordbot/i;

export const isSocialShareCrawler = (userAgent: string): boolean =>
  SOCIAL_CRAWLER_RE.test(userAgent);

export const readDiagramShareIdFromLocation = (
  href: string = window.location.href,
): string | null => {
  const raw = new URL(href).searchParams.get(DIAGRAM_SHARE_QUERY_PARAM)?.trim();
  return raw && raw.length > 0 ? raw : null;
};

export const buildDiagramSharePageUrl = (shareId: string): string => {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set(DIAGRAM_SHARE_QUERY_PARAM, shareId);
  return url.toString();
};

export const buildDiagramShareOgImageApiUrl = (shareId: string): string => {
  const path = `/v1/diagram/share/${encodeURIComponent(shareId)}/og-image`;
  return new URL(path, `${window.location.origin}/api`).href;
};
