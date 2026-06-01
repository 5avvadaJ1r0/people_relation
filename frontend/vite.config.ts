import react from "@vitejs/plugin-react";
import type { Connect, Plugin } from "vite";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { isSocialShareCrawler } from "./src/lib/diagramShare";
import { SITE_JSON_LD } from "./src/lib/siteSeo";

const SITE_JSON_LD_PLACEHOLDER = "<!-- SITE_JSON_LD -->";

const injectSiteJsonLdPlugin = (): Plugin => ({
  name: "inject-site-json-ld",
  transformIndexHtml(html) {
    if (!html.includes(SITE_JSON_LD_PLACEHOLDER)) return html;
    const script = `<script type="application/ld+json">\n${JSON.stringify(SITE_JSON_LD, null, 2)}\n    </script>`;
    return html.replace(SITE_JSON_LD_PLACEHOLDER, script);
  },
});

/**
 * 開発時の /api プロキシ先。
 * - ホストで `npm run dev` かつ API を localhost:8000: デフォルトで 127.0.0.1:8000
 * - Docker の frontend サービス: `VITE_DEV_PROXY_TARGET=http://api:8000`（compose で指定）
 */
const devProxyTarget = (mode: string) => {
  const fromFile = loadEnv(mode, process.cwd(), "").VITE_DEV_PROXY_TARGET?.trim();
  const fromEnv = process.env.VITE_DEV_PROXY_TARGET?.trim();
  return fromEnv || fromFile || "http://127.0.0.1:8000";
};

const socialCrawlerShareCardMiddleware = (
  apiOrigin: string,
): Connect.NextHandleFunction => {
  return (req, res, next) => {
    if (req.method !== "GET" || !req.url) {
      next();
      return;
    }
    const url = new URL(req.url, "http://localhost");
    const shareId = url.searchParams.get("diagram_share_id")?.trim();
    const ua = req.headers["user-agent"] ?? "";
    if (
      !shareId ||
      url.pathname !== "/" ||
      !isSocialShareCrawler(String(ua))
    ) {
      next();
      return;
    }
    const target = `${apiOrigin}/api/v1/diagram/share/${encodeURIComponent(shareId)}/card`;
    void fetch(target)
      .then(async (upstream) => {
        const body = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader(
          "Content-Type",
          upstream.headers.get("content-type") ?? "text/html; charset=utf-8",
        );
        res.end(body);
      })
      .catch(() => {
        next();
      });
  };
};

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    injectSiteJsonLdPlugin(),
    {
      name: "diagram-share-social-card",
      configureServer(server) {
        server.middlewares.use(
          socialCrawlerShareCardMiddleware(devProxyTarget(mode)),
        );
      },
    },
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      path: "path-browserify",
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      "/api": {
        target: devProxyTarget(mode),
        changeOrigin: true,
      },
    },
  },
}));

