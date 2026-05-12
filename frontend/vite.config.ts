import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
      // ブラウザが http://localhost:5173 を直接開いた場合でも /api を FastAPI に転送する
      "/api": {
        target: "http://api:8000",
        changeOrigin: true,
      },
    },
  },
});

