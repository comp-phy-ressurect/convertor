/**
 * build-seo.mjs — regenerates the static entry page for every tool and every
 * category, plus sitemap.xml, robots.txt and 404.html.
 *
 * These pages are NOT a build step for the app: the app is build-free and runs
 * straight from source. This script only writes the small crawlable HTML shells
 * so that /json-to-yaml/ is a real file with a real <title>, a real <h1> and
 * real links, and so that changing PRODUCTION_ORIGIN in src/config.js takes
 * effect everywhere in one pass.
 *
 * Every landing-page example is produced by running the tool's own `run()` at
 * build time, so a page can never describe behaviour the code does not have.
 *
 * Run:  node tools/build-seo.mjs
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { getTools, relatedTools, getCategories, categorySlugOf, defaultOptions } =
  await import('../src/tool-registry.js');
const { PRODUCTION_ORIGIN, PRODUCT } = await import('../src/config.js');
const { PAGE_CONTENT, SEARCH_INTENT } = await import('./seo-content.mjs');

/** Escape text for HTML text nodes and double-quoted attribute values. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** JSON-LD goes inside <script>, where the only dangerous sequence is "</". */
function jsonLd(data) {
  return `<script type="application/ld+json">
${JSON.stringify(data, null, 2).replace(/<\//g, '<\\/')}
</script>`;
}

const HEADER = `<header class="site-header">
  <div class="site-header__inner">
    <a class="brand" href="/">
      <span class="brand__mark" aria-hidden="true">⇄</span>
      <span class="brand__name">FormatPort</span>
    </a>

    <button type="button" class="search-trigger" id="search-trigger" aria-haspopup="dialog">
      <span aria-hidden="true">🔍</span>
      <span class="search-trigger__label">Search tools</span>
      <kbd class="search-trigger__kbd">Ctrl K</kbd>
    </button>

    <p class="privacy-badge">
      <span class="privacy-badge__dot" aria-hidden="true"></span>
      100% local processing · up to 10 MiB
    </p>

    <nav class="site-header__actions" aria-label="Application">
      <button type="button" class="button button--ghost" id="history-trigger" aria-haspopup="dialog">History</button>
      <button type="button" class="button button--ghost" id="presets-trigger" aria-haspopup="dialog">Presets</button>
      <button type="button" class="button button--ghost" id="settings-trigger" aria-haspopup="dialog">Settings</button>
    </nav>
  </div>
</header>`;

const FOOTER = `<footer class="site-footer">
  <div class="site-footer__inner">
    <p class="site-footer__privacy">
      <strong>Private by design.</strong> Your input never leaves this browser. Conversions run
      locally on your device. History and presets are stored only in this browser and you can clear
      them at any time. No analytics are loaded by default. Uploaded files are read locally and are
      never sent anywhere.
    </p>
    <nav class="site-footer__links" aria-label="Site">
      <a href="/">Home</a>
      <a href="/tools/">All tools</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </nav>
  </div>
</footer>`;

/**
 * The full tool list as real links, rendered into the <nav> that app.js later
 * replaces. Without this a crawler sees only the handful of related links on
 * each page, because the live navigation is built by JavaScript.
 */
function staticToolNav(currentSlug) {
  const groups = getCategories().map((group) => {
    const items = group.tools
      .map((tool) => {
        const current = tool.slug === currentSlug ? ' aria-current="page"' : '';
        return `      <li><a href="/${tool.slug}/"${current}>${escapeHtml(tool.label)}</a></li>`;
      })
      .join('\n');
    return `    <section class="tool-nav__group">
      <h3 class="tool-nav__heading"><a href="/tools/${group.slug}/">${escapeHtml(group.category)}</a></h3>
      <ul class="tool-nav__list">
${items}
      </ul>
    </section>`;
  });
  return groups.join('\n');
}

function breadcrumbTrail(tool) {
  const group = getCategories().find((entry) => entry.category === tool.category);
  return [
    { name: 'Tools', url: PRODUCTION_ORIGIN + '/tools/' },
    { name: group.category, url: PRODUCTION_ORIGIN + '/tools/' + group.slug + '/' },
    { name: tool.label, url: PRODUCTION_ORIGIN + '/' + tool.slug + '/' },
  ];
}

function breadcrumbHtml(trail) {
  const items = trail
    .map((step, index) =>
      index === trail.length - 1
        ? `      <li aria-current="page">${escapeHtml(step.name)}</li>`
        : `      <li><a href="${escapeHtml(new URL(step.url).pathname)}">${escapeHtml(step.name)}</a></li>`,
    )
    .join('\n');
  return `<nav class="breadcrumb" aria-label="Breadcrumb">
    <ol>
${items}
    </ol>
  </nav>`;
}

function breadcrumbLd(trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: step.name,
      item: step.url,
    })),
  };
}

/**
 * Run the tool on its sample input so the printed example is whatever the code
 * actually produces today. Anything that throws, or has no text output, simply
 * gets no example rather than a wrong one.
 */
async function renderExample(tool) {
  const sample = PAGE_CONTENT[tool.id]?.sample;
  if (!sample || typeof tool.run !== 'function') return '';

  let output;
  try {
    const options = { ...defaultOptions(tool), ...(sample.options ?? {}) };
    // `run` is a promise for the tools that hash or run a regex off the main
    // thread. Awaiting a plain value is harmless; not awaiting a promise meant
    // `result.output` was undefined and the example was silently dropped.
    const result = await tool.run({
      input: sample.input,
      secondaryInput: sample.secondaryInput ?? '',
      options,
      formats: tool.formats,
    });
    output = result?.output;
  } catch (error) {
    console.warn('  ! example failed for ' + tool.slug + ': ' + error.message);
    return '';
  }
  if (typeof output !== 'string' || !output.trim()) return '';

  const inputLabel = tool.input?.label ?? 'Input';
  const outputLabel = tool.output?.label ?? 'Output';
  const pane = (label, text) => `        <div>
          <h3>${escapeHtml(label)}</h3>
          <pre><code>${escapeHtml(text)}</code></pre>
        </div>`;

  const panes = [pane(inputLabel, sample.input)];
  if (sample.secondaryInput) {
    panes.push(pane(tool.secondaryInput?.label ?? 'Second input', sample.secondaryInput));
  }
  panes.push(pane(outputLabel, output.trimEnd()));

  return `      <h2>Example</h2>
      <div class="seo-example">
${panes.join('\n')}
      </div>
`;
}

function handlesHtml(tool) {
  const handles = PAGE_CONTENT[tool.id]?.handles ?? [];
  if (!handles.length) return '';
  const items = handles.map((line) => '        <li>' + escapeHtml(line) + '</li>').join('\n');
  return `      <h2>What this tool handles</h2>
      <ul>
${items}
      </ul>
`;
}

/**
 * "When you would use it" — the concrete contexts a tool is reached for.
 *
 * This is editorial copy, so it lives in seo-content.mjs next to the `handles`
 * bullets rather than in the registry: the registry describes the software, and
 * a wrong sentence here must not be able to change how a converter behaves.
 */
function useCasesHtml(tool) {
  const cases = PAGE_CONTENT[tool.id]?.useCases ?? [];
  if (!cases.length) return '';
  const items = cases
    .map(
      (entry) =>
        `        <li><strong>${escapeHtml(entry.title)}</strong> — ${escapeHtml(entry.body)}</li>`,
    )
    .join('\n');
  return `      <h2>When you would use it</h2>
      <ul class="seo-cases">
${items}
      </ul>
`;
}

/**
 * The questions a developer actually arrives with. Deliberately NOT marked up
 * as FAQPage JSON-LD: the answers are here because they are useful on the page,
 * not to bid for a search feature Google no longer shows for sites like this.
 */
function faqHtml(tool) {
  const faq = PAGE_CONTENT[tool.id]?.faq ?? [];
  if (!faq.length) return '';
  const items = faq
    .map(
      (entry) => `        <div class="seo-faq__item">
          <h3>${escapeHtml(entry.q)}</h3>
          <p>${escapeHtml(entry.a)}</p>
        </div>`,
    )
    .join('\n');
  return `      <h2>Common questions</h2>
      <div class="seo-faq">
${items}
      </div>
`;
}

/** The dialogs are shared with index.html; app.js expects these ids to exist. */
async function dialogsMarkup() {
  const indexHtml = await readFile(join(root, 'index.html'), 'utf8');
  const start = indexHtml.indexOf('<div class="palette"');
  const end = indexHtml.indexOf('<script type="module"');
  if (start === -1 || end === -1) {
    throw new Error('Could not locate the dialog block in index.html — update build-seo.mjs.');
  }
  return indexHtml.slice(start, end).trimEnd();
}

function head({ title, description, canonical, extraLd = [] }) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(PRODUCT.name)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:locale" content="en">
<meta property="og:image" content="${escapeHtml(PRODUCTION_ORIGIN)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml(PRODUCT.name)} — ${escapeHtml(PRODUCT.tagline)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${escapeHtml(PRODUCTION_ORIGIN)}/og.png">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%E2%87%84%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles/main.css">
${extraLd.map(jsonLd).join('\n')}`;
}

async function toolPage(tool, dialogs) {
  const canonical = PRODUCTION_ORIGIN + '/' + tool.slug + '/';
  const title = (tool.seoTitle ?? tool.label) + ' · ' + PRODUCT.name;
  const description = tool.metaDescription ?? tool.description;
  const trail = breadcrumbTrail(tool);

  const related = relatedTools(tool, 6)
    .map((other) => `        <li><a href="/${other.slug}/">${escapeHtml(other.label)}</a> — ${escapeHtml(other.description)}</li>`)
    .join('\n');

  const softwareLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: tool.label,
    description,
    url: canonical,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any browser',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
  };

  return `<!doctype html>
<html lang="en">
<head>
${head({ title, description, canonical, extraLd: [softwareLd, breadcrumbLd(trail)] })}
</head>
<body data-tool="${escapeHtml(tool.slug)}">

<a class="skip-link" href="#workspace">Skip to the converter</a>

${HEADER}

<div class="layout">
  <nav class="tool-nav" id="tool-nav" aria-label="All tools">
${staticToolNav(tool.slug)}
  </nav>

  <main id="workspace" class="workspace">
    <!--
      Static content for crawlers and for visitors without JavaScript.
      app.js replaces #app with the interactive workspace on load, breadcrumb
      included, so navigating to another tool updates the trail.
    -->
    <div id="app" class="app-root">
      ${breadcrumbHtml(trail)}

      <h1>${escapeHtml(tool.label)}</h1>
      <p>${escapeHtml(tool.description)}</p>
    </div>

    <!--
      These notes sit OUTSIDE #app deliberately. app.js clears #app when it
      boots, so anything inside it is gone from the rendered DOM — which is the
      DOM a search engine indexes, and the one a reader sees a second after the
      page paints. Out here they survive the boot. app.js hides them if the
      visitor navigates on to another tool, because they describe this page.
    -->
    <div class="seo-body" id="tool-notes" data-seo-tool="${escapeHtml(tool.slug)}">
      <p>${escapeHtml(PRODUCT.privacyStatement)}</p>

${handlesHtml(tool)}${await renderExample(tool)}${useCasesHtml(tool)}${faqHtml(tool)}
      <h2>Related tools</h2>
      <ul>
${related}
      </ul>
      <p><a href="/tools/">Browse all ${getTools().length} tools</a></p>
    </div>
  </main>
</div>

${FOOTER}

${dialogs}

<script type="module" src="/src/app.js"></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * Category pages
 * ------------------------------------------------------------------ */

function categoryPage(group, isIndex) {
  const canonical = isIndex
    ? PRODUCTION_ORIGIN + '/tools/'
    : PRODUCTION_ORIGIN + '/tools/' + group.slug + '/';
  const title = isIndex
    ? 'All Tools · ' + PRODUCT.name
    : group.title + ' · ' + PRODUCT.name;
  const description = isIndex
    ? `All ${getTools().length} FormatPort tools, grouped by what they do. Converters, code generators, encoders, hashes, timestamps and text tools, all running in your browser.`
    : group.blurb;

  const trail = isIndex
    ? [{ name: 'Tools', url: PRODUCTION_ORIGIN + '/tools/' }]
    : [
        { name: 'Tools', url: PRODUCTION_ORIGIN + '/tools/' },
        { name: group.category, url: canonical },
      ];

  const groups = isIndex ? getCategories() : [group];
  const sections = groups
    .map((entry) => {
      const items = entry.tools
        .map((tool) => `        <li><a href="/${tool.slug}/">${escapeHtml(tool.label)}</a> — ${escapeHtml(tool.description)}</li>`)
        .join('\n');
      const heading = isIndex
        ? `      <h2><a href="/tools/${entry.slug}/">${escapeHtml(entry.title)}</a></h2>
      <p>${escapeHtml(entry.blurb)}</p>`
        : '';
      return `${heading}
      <ul>
${items}
      </ul>`;
    })
    .join('\n');

  const otherCategories = getCategories()
    .filter((entry) => isIndex || entry.slug !== group.slug)
    .map((entry) => `        <li><a href="/tools/${entry.slug}/">${escapeHtml(entry.title)}</a></li>`)
    .join('\n');

  const listLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: isIndex ? 'All FormatPort tools' : group.title,
    itemListElement: groups
      .flatMap((entry) => entry.tools)
      .map((tool, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: tool.label,
        url: PRODUCTION_ORIGIN + '/' + tool.slug + '/',
      })),
  };

  return `<!doctype html>
<html lang="en">
<head>
${head({ title, description, canonical, extraLd: [listLd, breadcrumbLd(trail)] })}
</head>
<body>

<a class="skip-link" href="#workspace">Skip to the tool list</a>

${HEADER}

<div class="layout">
  <nav class="tool-nav" aria-label="All tools">
${staticToolNav(null)}
  </nav>

  <main id="workspace" class="workspace">
    ${breadcrumbHtml(trail)}

    <div class="app-root">
      <h1>${escapeHtml(isIndex ? 'All FormatPort tools' : group.title)}</h1>
      <p>${escapeHtml(description)}</p>

      <div class="seo-body">
${sections}

      <h2>${isIndex ? 'Categories' : 'Other categories'}</h2>
      <ul>
${otherCategories}
      </ul>
      <p><a href="/">FormatPort home</a></p>
      </div>
    </div>
  </main>
</div>

${FOOTER}

</body>
</html>
`;
}

function notFoundPage() {
  const links = getCategories()
    .map((entry) => `        <li><a href="/tools/${entry.slug}/">${escapeHtml(entry.title)}</a></li>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · ${escapeHtml(PRODUCT.name)}</title>
<meta name="robots" content="noindex, follow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%E2%87%84%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles/main.css">
</head>
<body>

${HEADER}

<div class="layout">
  <main id="workspace" class="workspace">
    <div class="app-root">
      <h1>Page not found</h1>
      <p>That URL does not match any FormatPort tool.</p>
      <div class="seo-body">
      <h2>Where to go instead</h2>
      <ul>
        <li><a href="/tools/">All ${getTools().length} tools</a></li>
${links}
      </ul>
      </div>
    </div>
  </main>
</div>

${FOOTER}

</body>
</html>
`;
}

/**
 * The hand-written pages (index.html, privacy.html, terms.html) are not
 * generated, but they still carry absolute URLs that must follow
 * PRODUCTION_ORIGIN. Rewrite only the origin, and only where an absolute URL is
 * actually meant: the canonical link, og:url, and the "url" key in JSON-LD.
 * Sample data inside page copy is left alone.
 */
const ABSOLUTE_URL_FIELD =
  /(<link rel="canonical" href="|<meta property="og:url" content="|<meta property="og:image" content="|<meta name="twitter:image" content="|"url": ")https?:\/\/[^"\/]+/g;

function retargetOrigin(html) {
  return html.replace(ABSOLUTE_URL_FIELD, (match, field) => field + PRODUCTION_ORIGIN);
}

function sitemap(tools, lastmod = new Map()) {
  const urls = [
    { loc: PRODUCTION_ORIGIN + '/', priority: '1.0' },
    { loc: PRODUCTION_ORIGIN + '/tools/', priority: '0.9' },
    ...getCategories().map((entry) => ({
      loc: PRODUCTION_ORIGIN + '/tools/' + entry.slug + '/',
      priority: '0.7',
    })),
    ...tools.map((tool) => ({ loc: PRODUCTION_ORIGIN + '/' + tool.slug + '/', priority: '0.8' })),
    { loc: PRODUCTION_ORIGIN + '/privacy', priority: '0.3' },
    { loc: PRODUCTION_ORIGIN + '/terms', priority: '0.3' },
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${escapeHtml(url.loc)}</loc>
    <lastmod>${lastmod.get(url.loc) ?? TODAY}</lastmod>
    <priority>${url.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
}

function robots() {
  return `# FormatPort — ${PRODUCTION_ORIGIN}
User-agent: *
Allow: /

# /tests/ is deliberately NOT disallowed here. It carries
# <meta name="robots" content="noindex, nofollow"> and an X-Robots-Tag header,
# and a crawler has to be allowed to fetch a page before it can read either.
# Blocking it in robots.txt would have the opposite of the intended effect:
# Google would keep the URL as an untitled entry it was never permitted to look
# at. Letting it crawl and be told "noindex" is what actually keeps it out.

Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml
`;
}

/* ------------------------------------------------------------------ *
 * Indexable-page inventory
 * ------------------------------------------------------------------ */

/**
 * SEO_INDEX_INVENTORY.md is generated, not maintained by hand. A hand-written
 * inventory is wrong the moment someone adds a tool and forgets it, which is
 * exactly when an accurate one would have mattered. Because this is built from
 * the same registry as the pages and the sitemap, the three cannot disagree.
 *
 * Every column is derived, not asserted:
 *   Indexable      the page is generated with "index, follow" (all of them are)
 *   In sitemap     the URL is in the list sitemap() builds
 *   Canonical      the self-referencing canonical the page is written with
 *   Linked from    every tool is in the static tool-nav on every page, so a
 *                  crawler reaches all of them one hop from the homepage
 */
function inventoryDoc(tools, sitemapUrls) {
  const inSitemap = new Set(sitemapUrls);
  const date = new Date().toISOString().slice(0, 10);

  const row = (url, type, intent, linkedFrom) =>
    `| \`${url.replace(PRODUCTION_ORIGIN, '')}\` | ${type} | ${intent} | yes | ${
      inSitemap.has(url) ? 'yes' : '**NO**'
    } | self | ${linkedFrom} |`;

  const rows = [
    row(PRODUCTION_ORIGIN + '/', 'Home', 'brand + "online developer converter tools"', 'root'),
    row(PRODUCTION_ORIGIN + '/tools/', 'Tool index', 'browse — "developer tools list"', 'header, footer, every page'),
    ...getCategories().map((group) =>
      row(
        PRODUCTION_ORIGIN + '/tools/' + group.slug + '/',
        'Category',
        group.category.toLowerCase().replace(/ tools$/, '') + ' tools',
        'tool-nav heading on every page',
      ),
    ),
    ...tools.map((tool) => {
      const intent = SEARCH_INTENT[tool.id];
      return row(
        PRODUCTION_ORIGIN + '/' + tool.slug + '/',
        'Tool (tier ' + (intent?.tier ?? '?') + ')',
        intent?.query ?? tool.description,
        'tool-nav on every page, related-tools blocks',
      );
    }),
    row(PRODUCTION_ORIGIN + '/privacy', 'Legal', 'n/a — not a target', 'footer'),
    row(PRODUCTION_ORIGIN + '/terms', 'Legal', 'n/a — not a target', 'footer'),
  ].join('\n');

  const tier1 = tools
    .filter((tool) => SEARCH_INTENT[tool.id]?.tier === 1)
    .map((tool) => `- \`${PRODUCTION_ORIGIN}/${tool.slug}/\` — ${SEARCH_INTENT[tool.id].query}`)
    .join('\n');

  const excluded = [
    ['`/tests/`', 'Developer test harness. `noindex, nofollow` in the HTML and an `X-Robots-Tag` header. Crawlable on purpose — a blocked page can never be told it is noindex.'],
    ['`/scripts/*`', 'Build tooling, served only because the host serves the repository as-is. `X-Robots-Tag: noindex`.'],
    ['`/src/*`, `/styles/*`, `/vendor/*`', 'Application code and assets. Not pages. Deliberately crawlable so Google can render the app.'],
    ['`/404.html`', 'Error page, `noindex, follow`.'],
  ]
    .map(([url, why]) => `| ${url} | ${why} |`)
    .join('\n');

  return `# Indexable-page inventory

Generated by \`scripts/build-seo.mjs\` on ${date} — **do not edit by hand.**
Add a tool to \`src/tool-registry.js\`, give it an entry in \`SEARCH_INTENT\` in
\`scripts/seo-content.mjs\`, re-run the build, and this file, the landing page,
the sitemap and the internal links all move together.

**${tools.length} tools · ${getCategories().length} categories · ${sitemapUrls.length} indexable URLs.**

Every page below is generated with \`index, follow\`, carries a self-referencing
canonical, and is reachable from the homepage in one click, because the static
tool navigation listing all ${tools.length} tools is rendered into every page before
JavaScript runs.

## Pages we expect to be indexed

| URL | Page type | Primary search intent | Indexable? | In sitemap? | Canonical | Linked internally from |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

## Deliberately not indexed

| URL | Why |
| --- | --- |
${excluded}

## Tier 1 — request indexing for these first

The homepage plus the tool pages whose query has both obvious intent and real
volume. These are the ones worth spending Search Console's manual "Request
indexing" quota on; see \`SEARCH_ENGINE_SETUP.md\`.

- \`${PRODUCTION_ORIGIN}/\` — brand and category entry point
${tier1}

Tiers are editorial guesses made before any traffic existed. Replace them with
what Search Console actually reports; the method for that is in
\`SEO_MONITORING.md\`.
`;
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * The date git last committed a change to this file, or null when git cannot
 * say (no repository, a shallow clone, a file git has never seen).
 */
function gitLastModified(relativePath) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', relativePath], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** True when the working tree holds edits to this file that git has not seen. */
function hasUncommittedChanges(relativePath) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', relativePath], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * index.html, privacy.html and terms.html are written by hand, so comparing
 * generator output against them says nothing about whether their text changed.
 * Git is the only thing that knows.
 */
function handWrittenLastmod(relativePath, publishedDate) {
  if (hasUncommittedChanges(relativePath)) return TODAY;
  return gitLastModified(relativePath) ?? publishedDate ?? TODAY;
}

/**
 * Write only when the bytes actually differ, and report when the content last
 * moved. <lastmod> is supposed to mean "this page changed then". Stamping all
 * 34 URLs with today's date on every build makes the field say "the build ran",
 * which is not a signal a crawler can use — and it churns the file in git for
 * no reason. Unchanged pages therefore keep their git commit date.
 */
async function writeIfChanged(relativePath, contents, previousLastmod) {
  const file = join(root, relativePath);
  let before = null;
  try {
    before = await readFile(file, 'utf8');
  } catch {
    // A page that does not exist yet is simply new.
  }
  if (before === contents) {
    // The date already published wins: it is what crawlers have seen, and
    // rederiving it from git would move it every time a page is committed on a
    // different day from the build that produced it.
    return { changed: false, lastmod: previousLastmod ?? gitLastModified(relativePath) ?? TODAY };
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf8');
  return { changed: true, lastmod: TODAY };
}

async function main() {
  const tools = getTools();
  const dialogs = await dialogsMarkup();
  const written = [];
  const lastmod = new Map();

  // What the sitemap already says, so an unchanged page keeps the date it was
  // last published with instead of drifting on every build.
  const published = new Map();
  try {
    const previous = await readFile(join(root, 'sitemap.xml'), 'utf8');
    for (const [, block] of previous.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
      const date = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
      if (loc && date) published.set(loc, date);
    }
  } catch {
    // No sitemap yet: every page is new.
  }

  const record = (url, path, result) => {
    if (url) lastmod.set(url, result.lastmod);
    if (result.changed) written.push(path);
  };

  const write = (url, path, contents) => writeIfChanged(path, contents, published.get(url));

  for (const tool of tools) {
    const path = tool.slug + '/index.html';
    const url = PRODUCTION_ORIGIN + '/' + tool.slug + '/';
    record(url, path, await write(url, path, await toolPage(tool, dialogs)));
  }

  // /tools/ and /tools/<category>/
  const toolsUrl = PRODUCTION_ORIGIN + '/tools/';
  record(toolsUrl, 'tools/index.html', await write(toolsUrl, 'tools/index.html', categoryPage(null, true)));

  for (const group of getCategories()) {
    const path = 'tools/' + group.slug + '/index.html';
    const url = PRODUCTION_ORIGIN + '/tools/' + group.slug + '/';
    record(url, path, await write(url, path, categoryPage(group, false)));
  }

  // Hand-written pages: keep their absolute URLs pointed at PRODUCTION_ORIGIN.
  for (const [page, url] of [
    ['index.html', PRODUCTION_ORIGIN + '/'],
    ['privacy.html', PRODUCTION_ORIGIN + '/privacy'],
    ['terms.html', PRODUCTION_ORIGIN + '/terms'],
  ]) {
    const before = await readFile(join(root, page), 'utf8');
    const result = await write(url, page, retargetOrigin(before));
    record(url, page, { ...result, lastmod: handWrittenLastmod(page, published.get(url)) });
  }

  record(null, '404.html', await writeIfChanged('404.html', notFoundPage()));

  const sitemapXml = sitemap(tools, lastmod);
  record(null, 'sitemap.xml', await writeIfChanged('sitemap.xml', sitemapXml));
  record(null, 'robots.txt', await writeIfChanged('robots.txt', robots()));

  const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  record(null, 'SEO_INDEX_INVENTORY.md', await writeIfChanged('SEO_INDEX_INVENTORY.md', inventoryDoc(tools, sitemapUrls)));

  console.log('Origin: ' + PRODUCTION_ORIGIN);
  console.log(written.length ? 'Wrote ' + written.length + ' changed file(s):' : 'Everything already up to date.');
  for (const path of written) console.log('  ' + path);
  if (PRODUCTION_ORIGIN.includes('example.com')) {
    console.log('\nPRODUCTION_ORIGIN is still example.com — set the real domain in src/config.js and re-run.');
  }
  return written;
}

// Importable: the SEO regression tests build pages in memory and assert on
// them, which must not write 35 files as a side effect of the import.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();

export { main, toolPage, categoryPage, notFoundPage, sitemap, robots, head, inventoryDoc, dialogsMarkup };
