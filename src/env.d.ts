/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Override the API origin when the frontend is hosted apart from the Worker. */
  readonly PUBLIC_TRACKER_URL?: string;
  /** "1" or "true" to show the call / LINE buttons. Off by any other value. */
  readonly PUBLIC_CONTACTS?: string;
  /** Only compiled in when PUBLIC_CONTACTS is on. */
  readonly PUBLIC_CONTACT_PHONE?: string;
  readonly PUBLIC_CONTACT_LINE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
