/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Override the API origin when the frontend is hosted apart from the Worker. */
  readonly PUBLIC_TRACKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
