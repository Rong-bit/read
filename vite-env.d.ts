/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_KEY?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_GOOGLE_TTS_VOICE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
