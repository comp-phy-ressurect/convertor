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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { getTools, relatedTools, getCategories, categorySlugOf, defaultOptions } =
  await import('../src/tool-registry.js');
const { PRODUCTION_ORIGIN, PRODUCT } = await import('../src/config.js');
const { PAGE_CONTENT } = await import('./seo-content.mjs');

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
      <span class="brand__name">DevConvert</span>
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
function renderExample(tool) {
  const sample = PAGE_CONTENT[tool.id]?.sample;
  if (!sample || typeof tool.run !== 'function') return '';

  let output;
  try {
    const options = { ...defaultOptions(tool), ...(sample.options ?? {}) };
    const result = tool.run({
      input: sample.input,
      secondaryInput: '',
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
  return `      <h2>Example</h2>
      <div class="seo-example">
        <div>
          <h3>${escapeHtml(inputLabel)}</h3>
          <pre><code>${escapeHtml(sample.input)}</code></pre>
        </div>
        <div>
          <h3>${escapeHtml(outputLabel)}</h3>
          <pre><code>${escapeHtml(output.trimEnd())}</code></pre>
        </div>
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
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%E2%87%84%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles/main.css">
${extraLd.map(jsonLd).join('\n')}`;
}

function toolPage(tool, dialogs) {
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

      <div class="seo-body">
      <p>${escapeHtml(PRODUCT.privacyStatement)}</p>

${handlesHtml(tool)}${renderExample(tool)}
      <h2>Related tools</h2>
      <ul>
${related}
      </ul>
      <p><a href="/tools/">Browse all ${getTools().length} tools</a></p>
      </div>
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
    ? `All ${getTools().length} DevConvert tools, grouped by what they do. Converters, code generators, encoders, hashes, timestamps and text tools, all running in your browser.`
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
    name: isIndex ? 'All DevConvert tools' : group.title,
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
      <h1>${escapeHtml(isIndex ? 'All DevConvert tools' : group.title)}</h1>
      <p>${escapeHtml(description)}</p>

      <div class="seo-body">
${sections}

      <h2>${isIndex ? 'Categories' : 'Other categories'}</h2>
      <ul>
${otherCategories}
      </ul>
      <p><a href="/">DevConvert home</a></p>
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
      <p>That URL does not match any DevConvert tool.</p>
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
  /(<link rel="canonical" href="|<meta property="og:url" content="|"url": ")https?:\/\/[^"\/]+/g;

function retargetOrigin(html) {
  return html.replace(ABSOLUTE_URL_FIELD, (match, field) => field + PRODUCTION_ORIGIN);
}

function sitemap(tools) {
  const today = new Date().toISOString().slice(0, 10);
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
    <lastmod>${today}</lastmod>
    <priority>${url.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>
`;
}

function robots() {
  return `# DevConvert
User-agent: *
Allow: /

# The test harness is for developers, not for search results.
Disallow: /tests/

Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml
`;
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const tools = getTools();
const dialogs = await dialogsMarkup();
const written = [];

for (const tool of tools) {
  const directory = join(root, tool.slug);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'index.html'), toolPage(tool, dialogs), 'utf8');
  written.push(tool.slug + '/index.html');
}

// /tools/ and /tools/<category>/
await mkdir(join(root, 'tools'), { recursive: true });
await writeFile(join(root, 'tools', 'index.html'), categoryPage(null, true), 'utf8');
written.push('tools/index.html');

for (const group of getCategories()) {
  const directory = join(root, 'tools', group.slug);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'index.html'), categoryPage(group, false), 'utf8');
  written.push('tools/' + group.slug + '/index.html');
}

// Hand-written pages: keep their absolute URLs pointed at PRODUCTION_ORIGIN.
for (const page of ['index.html', 'privacy.html', 'terms.html']) {
  const file = join(root, page);
  const before = await readFile(file, 'utf8');
  const after = retargetOrigin(before);
  if (after !== before) {
    await writeFile(file, after, 'utf8');
    written.push(page);
  }
}

await writeFile(join(root, '404.html'), notFoundPage(), 'utf8');
await writeFile(join(root, 'sitemap.xml'), sitemap(tools), 'utf8');
await writeFile(join(root, 'robots.txt'), robots(), 'utf8');
written.push('404.html', 'sitemap.xml', 'robots.txt');

console.log('Origin: ' + PRODUCTION_ORIGIN);
console.log('Wrote ' + written.length + ' files.');
if (PRODUCTION_ORIGIN.includes('example.com')) {
  console.log('\nPRODUCTION_ORIGIN is still example.com — set the real domain in src/config.js and re-run.');
}
