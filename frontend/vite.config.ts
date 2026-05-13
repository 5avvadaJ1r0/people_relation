import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

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

export default defineConfig(({ mode }) => ({
  plugins: [react()],
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

