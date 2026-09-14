# Search performance monitoring

A repeatable way to turn Search Console data into a decision about what to
change next. The point is to stop the two failure modes that waste the most
time: reacting to noise, and polishing pages nobody is looking for.

Baseline to compare against: `SEO_BASELINE.md`.
What is supposed to be indexed: `SEO_INDEX_INVENTORY.md`.

---

## Before any of this is worth doing

Do not open the Performance report for the first four to six weeks. A new
domain produces numbers too small to mean anything, and reading them anyway
leads to rewriting a title because it "only" got three impressions.

Wait until **Indexing → Pages** shows most of the 34 URLs indexed and
Performance shows impressions in the hundreds per month. Until then the only
question worth asking is the indexing one in the next section.

---

## The metrics, and what each one actually tells you

Search Console → **Performance → Search results**. Set the date range to the
**last 3 months** and enable all four metric tiles.

| Metric | What it literally is | What it tells you |
| --- | --- | --- |
| **Queries** | The search someone typed | Which intent Google thinks the page serves — often not the one you designed it for |
| **Pages** | The URL that was shown | Which pages Google considers worth surfacing at all |
| **Impressions** | Times a URL appeared in results | **Demand.** The only metric that measures whether anyone is looking |
| **Clicks** | Times someone clicked through | Demand that you actually captured |
| **CTR** | Clicks ÷ impressions | How well the title and description sell the page *at its current position* |
| **Average position** | Mean rank across impressions | Roughly how close you are to being chosen |

Three traps worth knowing, because each one produces confident wrong decisions:

- **Average position is an average.** Position 14 can mean "always 14" or "3 for
  one rare query and 30 for a common one". Always filter to a single query
  before believing a position.
- **CTR is meaningless without position.** 2% CTR at position 19 is normal. The
  same 2% at position 3 is a broken title.
- **Impressions are counted per query per page.** A page in the top 10 for
  fifty long-tail queries and a page in the top 10 for one popular query can
  show the same total. Drill into Queries before concluding anything.

---

## Decision system

Work top to bottom. Stop at the first rule that matches. The ordering is
deliberate — it puts effort where the ceiling is highest.

### Rule 0 — Pages not indexed at all

**Signal:** Indexing → Pages shows URLs as *Discovered – currently not
indexed*, *Crawled – currently not indexed*, or *Excluded*.

**Priority: P0.** Nothing else on this page matters while this is true. A page
that is not indexed has no impressions to analyse, and no amount of title
tuning changes that.

**What to do**

- *Discovered – currently not indexed* — Google knows the URL and chose not to
  spend a crawl. Usually low site authority on a new domain. The fix is
  distribution (`LAUNCH.md`) and time, not page edits. Do not rewrite the page.
- *Crawled – currently not indexed* — Google looked and judged it not worth
  keeping. That **is** a page-quality verdict. Usually it means the page is too
  close to a dozen others: the fix is to make it genuinely more useful than
  the competition, not to add keywords.
- *Duplicate, Google chose a different canonical* — check the canonical against
  `SEO_INDEX_INVENTORY.md`. If it is correct and Google still disagrees, the
  two pages are too similar to justify both.
- Anything else (server error, redirect, blocked) — a real bug. Fix it today
  and re-run the audit commands in `SEARCH_ENGINE_SETUP.md` §6.

---

### Rule 1 — High impressions, position 11–30

**Signal:** a query with meaningful impressions sitting on page 2 or 3.

**Priority: P1 — the highest-value opportunity there is.** Google already
believes the page is relevant; it just does not believe it is the best answer.
Moving from 15 to 8 is a far bigger traffic change than moving from 60 to 40,
and it is a change that is actually achievable.

**What to do, in this order**

1. **Search the query yourself** and read the top three results properly. What
   do they answer that the tool page does not? This is the single most useful
   thing to do and the most commonly skipped.
2. **Fix the intent gap in the page.** The generated pages already carry an
   H1, a description, a build-time-verified example and a "What this tool
   handles" list. The lever is `handles` and `sample` in
   `scripts/seo-content.mjs` — add the specific case people are searching for,
   and it appears on the page with an example that is proven correct because it
   is produced by running the tool.
3. **Functionality, where that is the real gap.** If competitors handle an edge
   case the tool does not, the honest fix is to handle it. That is a registry
   change, and the page will describe it automatically.
4. **Internal links.** Every tool is already one click from everywhere via the
   static nav, so there is little left to win here — but a related-tools entry
   pointing at the page from a *topically close* tool is worth more than one
   from an unrelated one. `relatedTools()` in `src/tool-registry.js`.
5. **External authority.** Frequently the actual blocker on a new domain, and
   the one thing page edits cannot substitute for. See `LAUNCH.md` — and note
   rule "never" at the bottom of this file.

---

### Rule 2 — High impressions, top 10, low CTR

**Signal:** average position under ~10, plenty of impressions, CTR well under
what that position should yield.

**Priority: P1.** This is the cheapest win available: the ranking is already
paid for, and only the presentation is losing the click.

**What to check, in order**

1. **The title.** Titles are generated as `seoTitle · FormatPort` from
   `src/tool-registry.js`. Does it contain the words people typed? Is the
   useful part visible before Google truncates it around 60 characters?
2. **The description.** `metaDescription` in the registry. Google rewrites it
   often, but when it does use it, it decides the click. State what the tool
   does and the one thing that makes it different — for this site, that the
   data never leaves the browser.
3. **Intent mismatch.** Check the actual queries. If people search
   "what is a jwt" and land on a decoder, they will not click, and no title
   fixes that. Either serve the intent on the page or accept the query is not
   yours.
4. **What the SERP looks like.** If the query is dominated by a featured
   snippet, an AI answer, or a video carousel, a low CTR at position 4 may be
   the ceiling. Measure against what is achievable, not against a textbook
   curve.

Change **one** thing, then wait two to four weeks. Changing title and
description together tells you nothing about which one worked.

---

### Rule 3 — Good position, almost no impressions

**Signal:** position 3, five impressions a month.

**Priority: P3 — do essentially nothing.** You have won a query nobody searches.
The ranking is not the problem and improving it changes nothing.

Do not rewrite the page, do not build links to it, do not "optimise" it. The
one legitimate use of this data is as evidence: several low-volume queries
clustering around the same unserved concept is a signal for Rule 4.

---

### Rule 4 — Growing impressions for something with no tool

**Signal:** queries appearing in Performance that no existing page really
serves, with impressions trending up rather than flat.

**Priority: P2 — the most valuable thing in the whole report.** This is real
measured demand telling you what to build, which is far better evidence than
anyone's opinion about what tool to add next.

**What to do**

1. Confirm the trend over at least 8 weeks. One good week is noise.
2. Check it is genuinely unserved — an existing tool may already do it but
   describe it in different words, in which case this is a Rule 1 wording fix
   and much cheaper.
3. Add it to the backlog with the query and its impression count attached.
4. When building it: add to `src/tool-registry.js`, add `handles`/`sample` and
   a `SEARCH_INTENT` entry to `scripts/seo-content.mjs`, run
   `node scripts/build-seo.mjs`. The landing page, the sitemap entry, the
   internal links, the inventory row and the IndexNow ping all follow
   automatically.

**The constraint that still applies:** add a tool because the demand is real
and the tool would be good, not because a keyword looked available. A thin page
built for a keyword is exactly what Rule 0's *Crawled – currently not indexed*
is Google's way of rejecting.

---

### Rule 5 — Indexed, zero impressions

**Signal:** the page is indexed, and after 3+ months has essentially no
impressions for anything.

**Priority: P2**, and the first job is diagnosis, not repair.

Work through these in order and stop when one explains it:

1. **Is there demand?** Search the target query. If even the top result looks
   like a hobby page, the query may barely exist — this is Rule 3, and the
   answer is to leave it alone. `/ulid-generator/` and `/json-to-toml/` are
   honestly in this category and are marked tier 3 in the inventory.
2. **Does the page match the intent?** Compare its `SEARCH_INTENT` entry with
   what the top results actually are. If they are a different kind of page
   entirely, the page is aimed at the wrong thing.
3. **Is it distinguishable?** If it is one of forty near-identical converters,
   Google has no reason to prefer it. What is genuinely different here is
   verifiable local processing and a worked example that is generated by the
   tool itself — if the page does not make that visible, it is invisible.
4. **Is it internally linked from somewhere topical?** The nav covers
   reachability; a related-tools link from an adjacent tool carries more
   meaning.
5. **Does it deserve to exist?** A tool with no demand, no differentiation and
   no use is fine as a tool and pointless as a landing page. Leaving it indexed
   costs nothing; spending a week on it costs a week.

---

## Monthly routine

Twenty minutes, once a month. Enough to catch problems, too infrequent to
react to noise.

1. **Indexing → Pages.** Indexed count vs. the 34 in the inventory. Any new
   error class? → Rule 0.
2. **Performance, last 3 months, Pages tab.** Sort by impressions. Which pages
   are working? Any tier 1 page from the inventory with nothing? → Rule 5.
3. **Queries tab, sorted by impressions.** Filter to position 11–30. → Rule 1.
   This is the list worth spending the month's effort on.
4. **Queries in the top 10 with poor CTR.** → Rule 2.
5. **Scan queries for things with no tool.** → Rule 4, into the backlog.
6. **Compare against `SEO_BASELINE.md`** and update the tier guesses in
   `SEARCH_INTENT` where real data now contradicts them. Measured beats
   editorial.

Record one decision per month, not twenty. Search results move on a timescale
of weeks; a change made this month cannot be judged before next month, and
changing five things at once makes all five unmeasurable.

---

## Never, regardless of what the data says

No result in Search Console justifies any of the following, and each one risks
a manual penalty that costs more than everything above gains:

- buying backlinks or "packages"
- directory spam, or submitting anywhere solely because it accepts a link
- fake forum posts, comment spam, or sockpuppet accounts
- private blog networks
- mass-generated articles written for links rather than readers
- fake social profiles
- fabricated ratings, reviews, user counts or awards — **including in
  structured data**, which is validated as absent on every build

Genuine distribution is in `LAUNCH.md`, and it is slower on purpose.
