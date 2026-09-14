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
