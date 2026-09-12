/**
 * router.js — History API routing over real, crawlable paths.
 *
 * No hash routing: every tool lives at a genuine URL such as /json-to-yaml/,
 * which is also a static HTML file on disk. That means a direct hit, a search
 * engine crawl and an in-app navigation all resolve to the same page, and the
 * app works on plain static hosting with no rewrite rules.
 *
 * User input is NEVER placed in the URL — see storage.js for why.
 */

import { BASE_PATH } from './config.js';

/** Turn a tool slug into an absolute, trailing-slash path. */
export function pathForSlug(slug) {
  if (!slug || slug === 'home') return BASE_PATH;
  return BASE_PATH + slug + '/';
}

/** Extract a slug from any path this app serves. */
export function slugFromPath(pathname = globalThis.location?.pathname ?? '/') {
  let path = pathname;
  if (BASE_PATH !== '/' && path.startsWith(BASE_PATH)) {
    path = '/' + path.slice(BASE_PATH.length);
  }
  const cleaned = path
    .replace(/index\.html$/i, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  return cleaned || 'home';
}

/**
 * Wire up client-side navigation.
 *
 * @param {(slug: string, options: {replace?: boolean, initial?: boolean}) => void} onNavigate
 * @param {(slug: string) => boolean} isKnownSlug
 */
export function createRouter({ onNavigate, isKnownSlug }) {
  function go(slug, { replace = false, silent = false } = {}) {
    const url = pathForSlug(slug);
    if (globalThis.location.pathname !== url) {
      const method = replace ? 'replaceState' : 'pushState';
      globalThis.history[method]({ slug }, '', url);
    }
    if (!silent) onNavigate(slug, { replace });
  }

  function handlePopState(event) {
    const slug = event.state?.slug ?? slugFromPath();
    onNavigate(isKnownSlug(slug) ? slug : 'home', { fromPopState: true });
  }

  /**
   * Intercept same-origin tool links so navigation is instant, while leaving
   * every real browser affordance intact: modified clicks, middle clicks,
   * target="_blank", downloads and external links all behave normally.
   */
  function handleClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;
    if (anchor.dataset.noRoute !== undefined) return;

    const url = new URL(anchor.href, globalThis.location.href);
    if (url.origin !== globalThis.location.origin) return;
    if (url.search || url.hash) return; // let the browser handle anchors/queries

    const slug = slugFromPath(url.pathname);
    if (!isKnownSlug(slug)) return; // e.g. /privacy — a real page load

    event.preventDefault();
    go(slug);
  }

  function start() {
    globalThis.addEventListener('popstate', handlePopState);
    document.addEventListener('click', handleClick);
    const initial = slugFromPath();
    const slug = isKnownSlug(initial) ? initial : 'home';
    // replaceState so the first entry carries a slug for the back button.
    globalThis.history.replaceState({ slug }, '', pathForSlug(slug));
    onNavigate(slug, { initial: true });
    return slug;
  }

  function stop() {
    globalThis.removeEventListener('popstate', handlePopState);
    document.removeEventListener('click', handleClick);
  }

  return { start, stop, go };
}
