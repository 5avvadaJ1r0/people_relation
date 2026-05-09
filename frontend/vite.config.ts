import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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

