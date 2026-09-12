/**
 * config.js — the one place to change when you deploy.
 *
 * PRODUCTION_ORIGIN is used for canonical URLs, Open Graph tags and
 * sitemap.xml. Change it here, then run `node scripts/build-seo.mjs` to rewrite
 * the static entry pages and sitemap in one pass.
 */

export const PRODUCTION_ORIGIN = 'https://formatport.com';

export const PRODUCT = Object.freeze({
  name: 'DevConvert',
  tagline: 'Developer converters that run entirely in your browser',
  privacyBadge: '100% local processing',
  privacyStatement:
    'Private by design. Your input never leaves this browser. Conversions run locally on your device.',
});

/**
 * Base path the app is served from. '/' for a root deployment; set it to
 * '/devconvert/' for a GitHub Pages project site. Every internal link is built
 * through router.js so this is the only knob you need.
 */
export const BASE_PATH = '/';

/**
 * Feature flags, prepared for a future paid tier.
 *
 * IMPORTANT: these are convenience switches, not a security boundary. Anything
 * enforced only in the browser can be flipped by anyone with devtools. See the
 * "Monetization" section of the README before treating any of these as a
 * paywall.
 */
export const FEATURES = Object.freeze({
  ads: false,
  unlimitedHistory: false,
  largeInputs: false,
  savedPresets: true,
  batchConversion: false,
  offlinePwa: false,
});

export const LIMITS = Object.freeze({
  historyEntries: 20,
  historyEntriesPro: 500,
  historyValueChars: 4000,
  presets: 50,
  detectDebounceMs: 250,
  regexTimeoutMs: 750,
});

export const STORAGE_KEYS = Object.freeze({
  history: 'devconvert:history:v1',
  presets: 'devconvert:presets:v1',
  settings: 'devconvert:settings:v1',
});
