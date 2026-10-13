/**
 * Visit counting (PostHog), on only when the site is built with `PUBLIC_POSTHOG_KEY`: forks and local
 * builds send nothing and don't even download the library.
 *
 * Cookieless (no cookie, no local storage: the welcome and the docs promise « no analytics cookies »;
 * cookieless mode must also be turned on in the PostHog project settings, or events are dropped), no
 * person profiles, and only page views and page leaves: no autocapture, no session recording, no
 * heatmaps, so nothing typed or shown on the desk leaves the browser. Do Not Track is respected.
 *
 * Platform seam: the desktop app replaces this module (no analytics there).
 */
const key = import.meta.env.PUBLIC_POSTHOG_KEY;
const host = import.meta.env.PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

/** Whether this build counts visits (the welcome dialog says so only then). */
export const analyticsEnabled = Boolean(key);

let client: Promise<typeof import('posthog-js').default | null> | null = null;

function start() {
  client ??= key
    ? import('posthog-js').then(({ default: posthog }) => {
        posthog.init(key, {
          api_host: host,
          cookieless_mode: 'always',
          person_profiles: 'never',
          respect_dnt: true,
          capture_pageview: true,
          capture_pageleave: true,
          autocapture: false,
          capture_heatmaps: false,
          capture_dead_clicks: false,
          capture_exceptions: false,
          disable_session_recording: true,
          disable_surveys: true,
          advanced_disable_flags: true,
          disable_external_dependency_loading: true,
          mask_all_text: true,
          mask_all_element_attributes: true,
        });
        return posthog;
      })
    : Promise.resolve(null);
  return client;
}

/**
 * A named product event (e.g. `bureau_file_imported`). Keep properties to kinds and counts: never file
 * names, titles or contents.
 */
export function track(event: string, props?: Record<string, string | number | boolean>) {
  void start().then((ph) => ph?.capture(event, props));
}

if (typeof window !== 'undefined') void start();
