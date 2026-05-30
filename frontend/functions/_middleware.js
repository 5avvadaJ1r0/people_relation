/**
 * Cloudflare Pages: SNS クローラ向けカード HTML 転送。
 *
 * Environment variables（Production）:
 *   API_BASE_URL = https://people-relation.saikyonews.com/api
 */

const SOCIAL_CRAWLER_RE =
  /Twitterbot|facebookexternalhit|LinkedInBot|Slackbot|Discordbot/i;

const resolveApiBase = (requestUrl, env) => {
  const fromEnv = env.API_BASE_URL?.trim() || env.VITE_API_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, "");
  }
  return new URL("/api", requestUrl).href.replace(/\/+$/, "");
};

export const onRequest = async (context) => {
  const { request, env, next } = context;
  if (request.method !== "GET") {
    return next();
  }
  const url = new URL(request.url);
  const shareId = url.searchParams.get("diagram_share_id")?.trim();
  const ua = request.headers.get("user-agent") ?? "";
  if (!shareId || url.pathname !== "/" || !SOCIAL_CRAWLER_RE.test(ua)) {
    return next();
  }

  const apiBase = resolveApiBase(request.url, env);
  const cardUrl = `${apiBase}/v1/diagram/share/${encodeURIComponent(shareId)}/card`;

  try {
    const upstream = await fetch(cardUrl, {
      headers: { Accept: "text/html" },
    });
    const body = await upstream.text();
    if (!upstream.ok || !body.includes("og:image")) {
      return next();
    }
    const contentType =
      upstream.headers.get("content-type") ?? "text/html; charset=utf-8";
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300",
        "X-Diagram-Share-Card": "1",
      },
    });
  } catch {
    return next();
  }
};
