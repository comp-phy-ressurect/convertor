# Search architecture

How FormatPort is meant to be found, what is already in place, and what is left.
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

## Search Console, Bing and IndexNow

Moved. These steps need account and DNS access, so they live in one place with
the exact values and the owner checklist:

- **`SEARCH_ENGINE_SETUP.md`** — Google Search Console (domain property, TXT
  verification, sitemap submission, URL inspection), Bing Webmaster Tools
  (including importing from Search Console), IndexNow, and the `www` redirect
  that has to be fixed first.
- **`SEO_INDEX_INVENTORY.md`** — generated on every build: every URL we expect
  indexed, its search intent, and which pages are deliberately excluded.

No verification token is committed in this repository. There is none to commit:
Google issues it to the account at verification time.

---

## Measuring it

Moved to **`SEO_MONITORING.md`**, which carries the metric definitions and a
decision system for turning a Search Console report into one concrete change:
what to do about high impressions on page 2, about low CTR in the top 10, about
a good position nobody searches for, and about queries with no tool behind them.

The starting point everything is compared against is **`SEO_BASELINE.md`**,
recorded 2026-09-14 before the site was submitted anywhere.

There is no analytics in the app and none is proposed: `connect-src 'none'` in
`_headers` forbids it, and that restriction is the product's main claim. Traffic
is counted at the Cloudflare edge instead (see `DEPLOY.md`), and Search Console
is the measurement layer for search itself.

---

## Backlog

### P0 — blocking or high impact, low effort

- Set the real `PRODUCTION_ORIGIN` and regenerate. Every canonical, OG URL and
  sitemap entry currently says `example.com`.
- ~~Complete `privacy.html`: `[DATE]`, the `[Operator: …]` blocks, a real contact
  address.~~ Done: the date and the contact address are in place, and the
  operator note is gone. What it deferred — controller identity, legal bases,
  retention periods, supervisory authority — still needs the owner.
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
