# Search baseline — 2026-09-14

Where FormatPort started, recorded before any search engine was told the site
exists. Everything below was measured, not estimated. Where a number could not
be obtained honestly, it says so instead of guessing.

Re-measure with the same queries in 30 and 90 days; the value of this file is
entirely in being able to compare against it.

---

## Search engine visibility

Measured 2026-09-14, before the property was added to Search Console or Bing
Webmaster Tools.

| Query | Result |
| --- | --- |
| `"FormatPort"` | No result for the brand as a product or company. |
| `"formatport.com"` | No result referencing the domain. |
| `formatport.com JSON YAML TOML converter tools` | Nothing from the domain; only unrelated competitors. |
| `site:formatport.com` | **Not reliably measurable.** See the note below. |

### Why there is no indexed-page count

The `site:` operator did not return trustworthy results through the tooling
available here — the operator was ignored and unrelated results came back.
Rather than publish a fabricated "0 pages indexed", this is recorded as
**untested**.

**The correct number will come from Google Search Console → Indexing → Pages**
once the property is verified. That is the authoritative source, and it will be
available within days of the setup in `SEARCH_ENGINE_SETUP.md`. Note the count
there on the day the property is verified, and add it below.

**Property verified 2026-09-14** by DNS TXT record, same day this baseline was
taken. Sitemap submitted and accepted the same day: status *Success*, **34
discovered URLs** — matching `SEO_INDEX_INVENTORY.md` exactly.

```
Date verified:     2026-09-14
Sitemap submitted: 2026-09-14, 34 URLs discovered, no errors
Indexed at baseline: 1 of 34 — the homepage only
```

**Correction to the "nothing is indexed" assumption above.** URL Inspection on
2026-09-14 reported `https://formatport.com/` as **already on Google** ("Stránka
je indexována"). Google had found and indexed the homepage on its own, before
the property existed — which the `site:` query could not reveal and which the
brand-query results did not suggest. Every other URL inspected came back either
*Google adresu URL nezná* or *Objeveno – momentálně neindexováno*.

So the true starting point is **1 indexed page, not 0.** Worth keeping in mind:
the indexed homepage was the DevConvert version, so the first thing to watch is
whether the FormatPort title replaces it.

The first full indexed count will appear in **Indexing → Pages** a few days
after this date. Record it here when it does.

### What this baseline means

Zero visibility is the expected and correct starting point, not a problem. The
domain is new, has no backlinks, and had never been submitted to a search
engine. There is nothing to diagnose — there is simply nothing there yet.

---

## Brand name check

**`FormatPort` is clear.** No company, product or registered trademark using
the name was found in the developer-tools space, or in any adjacent space.

The only literal occurrence found anywhere was a Go helper function named
`FormatPort()` in an unrelated open-source repository — a function name, not a
product. Weak stemming matches (`Format.com`, `format-pro.com`, `DockPort`,
`Beatport`) are different words in different industries and create no confusion.

**Caveat, stated honestly:** this is a search-engine-level check, not a
trademark clearance. The USPTO search interface could not be queried directly.
If the name is ever going to carry commercial weight, run a real TESS search
before relying on it.

### The name this site previously used

The site was branded **DevConvert** until 2026-09-14. That name had a genuine
collision problem, which is the main reason the rename was worth doing rather
than merely tidy:

- `devconverter.dev`, `devconverter.org`, `dev-convert.com` — several are
  active developer converter tools describing themselves in nearly the same
  words ("runs entirely in your browser", "your data never touches our
  servers", JSON / Base64 / JWT / hash tools).
- `devconvert.com` — a parked domain listed for sale.
- A "DevConvert" Chrome extension and a "DevConvert" CLI tool also exist.

Competing for a brand query against several established products with the same
name, from a domain that did not even contain that name, was unwinnable. The
domain and the brand now match, and the brand is unclaimed.

**Consequence for measurement:** brand queries start from true zero on
2026-09-14. There is no earlier brand traffic to inherit and no redirect from a
previous name, because `formatport.com` never publicly carried the old name in
its URL.

---

## Technical state at baseline

Audited live on 2026-09-14 against `https://formatport.com/`.

| Check | Result |
| --- | --- |
| Sitemap URLs returning HTTP 200 | **34 / 34** |
| Correct self-referencing canonical | **34 / 34** |
| Exactly one `<h1>` | **34 / 34** |
| Accidental `noindex` on an indexable page | **0** |
| Orphan pages (in sitemap, unreachable by link) | **0** |
| Broken internal links | **0** |
| Max click depth from the homepage | **1** |
| JSON-LD blocks parsing cleanly | **63 / 63** |
| Fabricated ratings / reviews / user counts in structured data | **0** |
| Duplicate URL forms competing | **0** — `/tool` 308s to `/tool/`, mixed case 404s |
| Nonexistent page returns 404 | yes |
| Horizontal overflow at 320–768px | none, across 5 representative pages |
| Browser test suite | **122 passed, 0 failed** |
| Homepage TTFB / size | 170 ms / 11.4 KB |
| TLS | valid; apex and wildcard both covered |
| `http://` → `https://` apex | 301, **one hop** |
| `www.formatport.com` | **Was HTTP 522 — fixed 2026-09-14.** All four host/scheme variants now 301 to the apex in one hop, path and query preserved. |

Every row except the last was already correct before this work started. The
`www` failure was the one real defect; it was fixed on 2026-09-14 with a
Cloudflare Redirect Rule (`www to apex (301)`, matching `http.host eq
"www.formatport.com"`), which runs at the edge before any origin fetch and so
sidesteps the unreachable origin behind the proxied `www` CNAME entirely.

---

## Distribution at baseline

| Channel | State on 2026-09-14 |
| --- | --- |
| Backlinks | None known. Nothing has been posted anywhere. |
| GitHub repository | Public — `comp-phy-ressurect/convertor`, **0 stars**. Description, homepage and 15 topics updated to FormatPort on 2026-09-14. |
| Show HN | Not posted |
| Product Hunt | Not posted |
| Reddit / dev communities | Not posted |
| Directories | Not submitted anywhere |
| Search Console | **Domain property verified 2026-09-14**, sitemap submitted, 34 URLs discovered, indexing requested for 10 tier-1 URLs |
| Bing Webmaster Tools | **Not added — blocked on owner.** Requires a Microsoft account sign-in. |
| IndexNow | Key live; all 34 URLs submitted 2026-09-14, accepted (HTTP 200) |

Launch material for all of these is written and ready in `LAUNCH.md`. None of
it has been published — no account was created and nothing was posted on the
owner's behalf.

---

## What to re-measure, and when

Same queries, same table, so the comparison is real.

**At 30 days (≈ 2026-10-14)**

- Search Console → Indexing → Pages: how many of the 34 are indexed?
- Search Console → Performance: any impressions at all, for anything?
- Does `"FormatPort"` return the site as the first result?
- Any referring domain that was not created by hand?

**At 90 days (≈ 2026-12-13)**

- Which queries produce impressions, and at what average position?
- Which of the tier 1 pages from `SEO_INDEX_INVENTORY.md` earned impressions,
  and which did not? The ones that did not are the interesting ones.
- Any page indexed but with zero impressions after three months?

`SEO_MONITORING.md` says what to do with each of those answers.

**One honest expectation to keep in view:** a new domain with no authority does
not rank for `json formatter` or `csv to json` in 90 days. What *should* happen
in 90 days is that the pages are indexed, brand search resolves to the site,
and long-tail queries begin producing impressions. Judge the work against that,
not against the headline keywords.

---

# First measurement — 2026-09-19

Five days after the baseline. Search Console has data for 13–16 September; the
numbers below are its 28-day window, which is the whole life of the property.

## Where the numbers stood

| | 2026-09-14 | 2026-09-19 |
|---|---|---|
| Indexed | 1 of 34 | **15** |
| Not indexed | 33 | 22 |
| Clicks | 0 | 1 |
| Impressions | 0 | 15 |
| Average position | — | 17.6 |

Sitemap: submitted 14 Sep, last read 17 Sep, Success, 34 URLs discovered.

Not-indexed reasons — all three of them, with nothing else present:

| Reason | Pages |
|---|---|
| Page with redirect | 2 |
| Discovered, currently not indexed | 11 |
| Crawled, currently not indexed | 9 |

No `noindex`, no robots block, no soft 404, no server error, no duplicate
canonical. The two redirects are `http://formatport.com/` and the `www` host;
both 301 to the apex, verified with `curl`, and need nothing.

Queries above the anonymisation threshold — only two exist:

| Query | Impressions | Position |
|---|---|---|
| `yaml to json` | 2 | 43.5 |
| `iso 8601 to unix timestamp` | 1 | 63.0 |

Pages, top of the list:

| Page | Clicks | Impressions | Position |
|---|---|---|---|
| `/yaml-to-json/` | 1 | 8 | 15.2 |
| `/unix-timestamp-converter/` | 0 | 7 | 16.0 |
| `/` | 0 | 6 | 2.5 |
| `/json-formatter/` | 0 | 6 | 4.0 |
| `/json-to-yaml/` | 0 | 6 | 6.2 |
| `/jwt-decoder/` | 0 | 5 | 4.2 |
| `/base64-encoder-decoder/` | 0 | 5 | 7.6 |
| `/privacy` | 0 | 4 | 2.2 |
| `/csv-to-json/` | 0 | 4 | 3.5 |
| `/hash-generator/` | 0 | 3 | 2.7 |

Read those two tables together. Page positions of 2–8 next to query positions
of 43 and 63 means the good positions come from the anonymised brand queries.
On a real generic converter query the site sits at 40–60. That is the honest
picture at five days, and it is roughly what the baseline predicted.

## What the data turned out to be hiding

`/privacy` at position 2.2 was the thread worth pulling. It ranks, which means
its content is indexed, which means the "this is a template, not legal advice"
banner was one snippet away from being the first thing a visitor read.

Checking what Google actually renders turned up the larger problem. `app.js`
clears `#app` on boot, and every tool page kept its supporting content inside
`#app`. Measured in the browser, before and after the fix:

| | Rendered words in `<main>` |
|---|---|
| Any tool page, before | 91 |
| `/json-to-yaml/`, after | 510 |
| `/`, before | 91 |
| `/`, after | 293 |

Ninety-one words, near-identical across all 25 pages, is what the nine
"crawled, currently not indexed" pages were being judged on. The homepage was
a separate problem: `renderHome()` selected `json-to-yaml`, which overwrote
`document.title` and the `h1`, so `/` rendered as a copy of `/json-to-yaml/`,
and four of the five category hubs lost their only rendered inbound link —
which is why all five sit in "discovered, currently not indexed".

Both are fixed, along with the thinness itself: the 25 tool pages now carry
220–552 words each, written from the converters' own behaviour, where the
median was 165. `tests/seo.mjs` fails if either regresses.

## Manual search check, 2026-09-19

A sanity check of what the engines are showing, not a ranking measurement —
results are personalised and Search Console remains the source of truth.

**Google.** `site:formatport.com` returns 10 visible results: `/`, `/privacy`,
`/terms`, `/tools/`, `/jwt-decoder/`, `/diff-checker/`, `/json-formatter/`,
`/case-converter/`, `/ulid-generator/`, `/hash-generator/`. `"FormatPort"`
returns the site at position 1. `yaml to json` does not place it in the top 10,
which matches the 43.5 that Search Console reports.

One result is worth reading carefully. The stored title for the homepage is:

> JSON to YAML Converter — Local & Private · FormatPort

That is the converter's title, not the homepage's — direct confirmation that
Google indexed the rendered DOM after `app.js` had overwritten `document.title`.
The `http://formatport.com/` entry, listed separately, carries the correct
"FormatPort — Developer Converters That Run in Your Browser". Both come from the
same file; only the rendering differed. A re-crawl of `/` has been requested.

**Bing.** Nothing. `site:formatport.com` and the brand query both return no
results from Bing's index, checked through DuckDuckGo after Bing itself served a
CAPTCHA. IndexNow has been submitting URLs since 14 September and has been
accepted every time, so this is not a submission failure: IndexNow announces a
URL, it does not oblige anyone to index it. Bing Webmaster Tools has never been
set up, and that is the thing most likely to move this.

## What to re-measure, and when

The 30- and 90-day checks above still stand. Add to the 30-day one:

- Have the nine "crawled, currently not indexed" pages moved into the index?
  They are the direct test of the rendering fix: `/tools/text/`, `/terms`,
  `/json-to-typescript/`, `/json-to-python/`, `/diff-checker/`, `/json-to-zod/`,
  `/regex-tester/`, `/toml-to-json/`, `/ulid-generator/`.
- Have the five category hubs been crawled at all? They had no rendered inbound
  link until 19 September.
- Does `/` still rank separately from `/json-to-yaml/`, and does its result now
  show the homepage title rather than the converter's?
