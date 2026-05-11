/// <reference types="vite/client" />

interface Window {
  dataLayer?: unknown[];
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
