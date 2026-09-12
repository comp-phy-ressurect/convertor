# Search architecture

How DevConvert is meant to be found, what is already in place, and what is left.
Distribution beyond search lives in [SEO_LAUNCH.md](SEO_LAUNCH.md).

Everything here is generated from one source: `src/tool-registry.js`. Adding a
tool there and re-running `node scripts/build-seo.mjs` produces its landing
page, its category listing, its breadcrumb, its sitemap entry and its related
links. There is no second place to update.

---

## URL architecture

```
/                          homepage — discovery hub
/tools/                    all 25 tools, grouped
/tools/data/               Data Format Converters       (8 tools)
/tools/code/               Code Generators              (6 tools)
/tools/encoding/           Encoding, Hashing and Tokens (5 tools)
/tools/time/               Timestamps and Identifiers   (3 tools)
/tools/text/               Text Tools                   (3 tools)
/<tool-slug>/              one canonical page per search intent
/privacy.html /terms.html
/404.html                  noindex
/tests/                    disallowed in robots.txt
```

One intent, one URL. There is no `/convert-csv-to-json/` or
`/csv-to-json-online/` — those are the same intent as `/csv-to-json/` and would
be duplicate content. The one deliberate overlap is `/convert/`, the universal
matrix tool: it targets "convert between formats" generally, while each pair
that has its own page owns that pair's intent. `changeFormat()` in `src/app.js`
already navigates to the pair's own URL when one exists, so the canonical page
wins even when the user arrives through the selectors.

Query parameters are never used for tool state, and user input never enters the
URL, so there are no parameter variants to canonicalize away.

---

## What each page ships before JavaScript runs

Confirmed by fetching the static file, not the rendered DOM:

- unique `<title>` and `<meta name="description">`
- `<link rel="canonical">` to the trailing-slash URL
- `SoftwareApplication` and `BreadcrumbList` JSON-LD
- OpenGraph and Twitter card metadata
- visible breadcrumb, re-rendered by `ui.js` after SPA navigation so it never goes stale
- one `<h1>`, the tool's own name
- "What this tool handles" — behaviour specific to that tool
- a worked example whose **output is produced by running the tool at build time**
- related tools with descriptions
- the full 25-tool navigation as real `<a href>` links

That last point matters: the live navigation is built by JavaScript, so without
the static copy a crawler would only ever see the handful of related links on
each page.

The example is the part that cannot rot. `scripts/build-seo.mjs` calls the
tool's own `run()` with its default options and prints whatever comes back. If
the converter changes, the page changes with it; if it throws, the page simply
carries no example rather than a wrong one.

---

## Priority landing pages

Ranked by how directly the query maps to something the tool does, and how much
of the work the searcher still has to do after landing. **No search volume
figures are given: this repository has no keyword-data access, and inventing
numbers would be worse than omitting them.** Validate against Search Console
impressions once the site has been live long enough to have any.

| Priority | Page | Primary intent | Why |
| --- | --- | --- | --- |
| P0 | `/csv-to-json/` | csv to json | Highest-utility converter intent; covers delimiter, header and type long-tails |
| P0 | `/json-to-csv/` | json to csv | The other direction, equally common, distinct intent |
| P0 | `/json-to-yaml/` | json to yaml | Config work; constant developer need |
| P0 | `/yaml-to-json/` | yaml to json | Ditto, opposite direction |
| P0 | `/json-formatter/` | json formatter | Formatter + validator in one page, very high intent |
| P0 | `/jwt-decoder/` | jwt decoder | Strong differentiator: the token genuinely never leaves the tab |
| P0 | `/base64-encoder-decoder/` | base64 decode | Enormous generic intent; UTF-8 correctness is the differentiator |
| P0 | `/unix-timestamp-converter/` | unix timestamp converter | Clear single-answer intent; auto seconds/ms/µs detection |
| P1 | `/json-to-typescript/` | json to typescript | Narrow but high-conversion developer intent |
| P1 | `/hash-generator/` | sha256 hash generator | Splits into sha256/md5/sha1 long-tails from one page |
| P1 | `/url-encoder-decoder/` | url encode decode | Generic but steady; auto encode/decode/inspect is the edge |
| P1 | `/regex-tester/` | regex tester | Crowded field; the 750 ms worker timeout is a real differentiator |
| P1 | `/diff-checker/` | diff checker | Crowded; JSON-aware diff is the angle |
| P1 | `/uuid-generator/` | uuid generator | Very high volume, very low differentiation — cheap to hold |
| P1 | `/case-converter/` | camelcase converter | Multi-style output covers many variants at once |
| P1 | `/curl-to-code/` | curl to fetch | Specific, underserved, genuinely useful |
| P2 | `/json-to-python/` | json to python dataclass | Narrower audience |
| P2 | `/json-to-go/` | json to go struct | Ditto |
| P2 | `/json-to-zod/` | json to zod | Small but fast-growing |
| P2 | `/json-to-sql/` | json to sql | Real intent, more niche |
| P2 | `/json-to-json-schema/` | json to json schema | Narrow, technical |
| P2 | `/json-to-toml/` `/toml-to-json/` | json to toml | Rust/Python config audience |
| P2 | `/ulid-generator/` | ulid generator | Small audience, near-zero competition |
| P2 | `/convert/` | convert json yaml csv | Hub page; individual pairs carry the specific intents |
| P3 | `/tools/*` | — | Category pages exist for humans and crawl depth, not to rank |

Each of these is one page answering a cluster. `/csv-to-json/` is intended to
satisfy "convert csv to json", "csv file to json", "csv to json online",
"csv to json with headers" and "csv to json array" through the tool itself plus
the behaviour notes — not through five near-identical pages.

---

## Structured data

| Page type | Types emitted |
| --- | --- |
| Homepage | `WebSite` |
| `/tools/` and `/tools/<category>/` | `ItemList`, `BreadcrumbList` |
| Tool page | `SoftwareApplication`, `BreadcrumbList` |

`SoftwareApplication` carries `offers.price: "0"` and `isAccessibleForFree`,
both true. No `aggregateRating`, no `review`, no `interactionStatistic` — there
are no ratings or usage numbers to report, and inventing them is a manual-action
risk, not a ranking tactic.

Validate at <https://validator.schema.org/> and in Search Console's Rich
Results Test after deploying.

---

## Search Console and Bing setup

Nothing here can be completed from the repository alone; each step needs
account access.

1. **Add the property.** Search Console → Add property → Domain (needs a DNS
   TXT record) or URL prefix (accepts an HTML meta tag).
2. **Verify.** For the meta-tag method, put the tag in the `<head>` of
   `index.html` **and** in the `head()` function in `scripts/build-seo.mjs`, then
   re-run the builder so every page carries it. For the DNS method nothing in
   this repository changes. No token is committed here — there is none to
   commit.
3. **Submit the sitemap.** Sitemaps → add `sitemap.xml`. Confirm it reports 34
   discovered URLs and no errors.
4. **Inspect key URLs.** Run URL Inspection on `/`, `/csv-to-json/`,
   `/json-to-yaml/`, `/jwt-decoder/` and `/tools/`. Check that the rendered HTML
   contains the h1 and the behaviour notes, and request indexing for each.
5. **Bing Webmaster Tools.** Add the site, import from Search Console if
   available, submit the same sitemap. Bing feeds DuckDuckGo and Ecosia too.

### What to watch, and when

| Metric | Where | What it tells you |
| --- | --- | --- |
| Pages indexed vs discovered | Indexing → Pages | Whether Google thinks the pages are worth keeping |
| Impressions per page | Performance → Pages | Which tools are being surfaced at all |
| Queries per page | Performance → Queries, filtered by page | Whether you match the intent you aimed at |
| CTR per query | Performance | A title/description problem, not a ranking problem |
| Average position | Performance | Movement over months, not days |
| Core Web Vitals | Experience | Field data; only appears once there is traffic |

**How to read it.** High impressions with low CTR means the title and
description are wrong — that is a one-line fix in the registry. Impressions for
a query the page does not actually serve means the content and the intent have
drifted apart. Indexed but zero impressions after a few months means the page
is not competitive for anything, and the answer is a better page, not another
page.

There is no analytics in the app and none is proposed: `connect-src 'none'` in
`_headers` forbids it, and that restriction is the product's main claim. Search
Console is the measurement layer.

---

## Backlog

### P0 — blocking or high impact, low effort

- Set the real `PRODUCTION_ORIGIN` and regenerate. Every canonical, OG URL and
  sitemap entry currently says `example.com`.
- Complete `privacy.html`: `[DATE]`, the `[Operator: …]` blocks, a real contact
  address.
- Verify in Search Console and Bing, submit the sitemap.
- Confirm the host serves `404.html` for unknown paths with a real 404 status.
  Cloudflare Pages and Netlify both do this automatically for a root
  `404.html`; verify with `curl -I https://your-domain/does-not-exist`.

### P1 — worth doing next

- **OpenGraph image.** Pages currently share as title and description only.
  A 1200×630 PNG per category, referenced as `og:image`, makes links look
  deliberate on Slack and Reddit. Needs an image pipeline the repository does
  not have; it deliberately has no build step.
- **Behaviour notes for the four tools that have none.** `jwt-decoder`,
  `unix-timestamp-converter`, `uuid-generator`, `ulid-generator` and
  `regex-tester` carry a handles list but no worked example, because their
  output is random, time-dependent or not plain text. A hand-written
  illustrative example would help these pages, but it would not be
  build-verified like the others, so it needs a clear marker.
- **`/tools/<category>/` copy.** The category pages currently carry one blurb
  and a list. A short "which one do I want" paragraph would make them useful
  rather than merely navigational.

### P2 — real value, more effort

- **Supporting articles**, four at most, each tied to a tool: CSV quoting rules,
  what a JWT contains, Unix time units, ULID vs UUID. Only if written properly;
  see `SEO_LAUNCH.md`.
- **Adjacent tools with obvious intent and low cost**, ranked by fit:

  | Tool | Fit | Effort |
  | --- | --- | --- |
  | JSON Lines ↔ JSON | Slots straight into the format matrix | Low |
  | INI ↔ JSON | Same matrix, same shape as TOML | Low |
  | HTML entity encode/decode | Sits beside the URL and Base64 encoders | Low |
  | Query string ↔ JSON | Reuses the URL inspector | Low |
  | Cron expression explainer | Strong intent, no overlap with existing code | Medium |
  | JWT signature verification | Requires a key, and uploading one breaks the privacy model | Do not build |

  Each would need its own registry entry, behaviour notes and example. None
  should be added merely to have another page.

### P3 — only with evidence

- Splitting `/hash-generator/` into per-algorithm pages. Do this **only** if
  Search Console shows the combined page picking up `md5 hash generator` and
  `sha256 hash generator` impressions at a poor position. Otherwise it is three
  thin pages where one good one already ranks.

---

## Things deliberately not done

- **No doorway pages.** 7 formats × 7 formats is 49 working conversions, but
  only the pairs with genuine standalone intent get a page. The rest are
  reachable through `/convert/`, which is one page that actually does them.
- **No keyword stuffing.** Titles follow `intent — qualifier · brand` and stop.
- **No fabricated structured data.** No ratings, no download counts, no awards.
- **No analytics.** The CSP forbids it and the privacy claim depends on it.
- **No AI-written article farm.** Tool pages are the product.
