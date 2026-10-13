/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** `solo` (default) or `equipe`: see src/edition.ts. */
  readonly PUBLIC_EDITION?: string;
  /** Collab server, `equipe` only (default http://localhost:8787). */
  readonly PUBLIC_COLLAB_URL?: string;
  /** PostHog project key: visits are counted only when set (src/analytics.ts). */
  readonly PUBLIC_POSTHOG_KEY?: string;
  /** PostHog ingestion host (default https://us.i.posthog.com; EU: https://eu.i.posthog.com). */
  readonly PUBLIC_POSTHOG_HOST?: string;
}
