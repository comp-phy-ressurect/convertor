# Launch and distribution checklist

DevConvert's acquisition channel is search. This file covers the part search
cannot do on its own: the first few hundred real users, who create the brand
searches and the natural links that search ranking is built on.

Nothing here involves buying links, posting fake recommendations, or hiding
that you built the thing. Every channel below expects you to say so plainly.

---

## Before you post anywhere

These are blocking. Posting a link that resolves to `example.com` metadata, or
a site Google cannot index, wastes the one launch you get.

- [ ] Set `PRODUCTION_ORIGIN` in `src/config.js` to the real domain.
- [ ] Run `node scripts/build-seo.mjs` and commit the regenerated pages.
- [ ] Deploy, then confirm `curl -I https://your-domain/` returns the CSP from `_headers`.
- [ ] Confirm `https://your-domain/sitemap.xml` and `/robots.txt` load.
- [ ] Open a tool page with JavaScript disabled and confirm the h1, description and links are there.
- [ ] Fill in `privacy.html`: `[DATE]`, every `[Operator: …]` block, and the contact address.
- [ ] Decide whether `claude_instructions.md` and `todo_notes.txt` belong in a public repository.
- [ ] Add the site to Google Search Console and Bing Webmaster Tools (see `SEO.md`).

---

## GitHub

**Why it fits.** The repository is the artifact developers evaluate before they
trust a tool with a JWT or an API key. "No network calls, here is the CSP, here
is the test suite" is a claim they can check in thirty seconds.

**What to post.** Make the repository public. The README already explains the
architecture and the privacy model — that is the pitch. Add topics:
`json`, `yaml`, `toml`, `csv`, `converter`, `developer-tools`, `privacy`,
`static-site`, `no-backend`. Put the live URL in the repository's About field.

**What page to link to.** The homepage, and `/tools/` from the README.

**What NOT to do.** Do not open issues on unrelated repositories to mention it.
Do not add it to "awesome" lists by pull request unless the list's contribution
rules actually invite self-submission.

---

## Hacker News (Show HN)

**Why it fits.** Local-only processing and a build-free static architecture are
both things this audience argues about productively. The CSP `connect-src
'none'` detail is the kind of verifiable claim that earns comments.

**What to post.** A Show HN. Title format: `Show HN: DevConvert – 25 developer
converters that run entirely in your browser`. First comment should be yours,
explaining the constraint you set and what it cost:

> I wanted a converter I could paste a production JWT into without thinking
> about it. Everything runs in the tab — the CSP is `connect-src 'none'`, so
> the browser refuses any outbound connection the page might attempt. No build
> step either: it is plain ES modules served as static files.
>
> The parts I found hardest: CSV delimiter and header-row detection (both are
> guesses, and both are wrong sometimes, so the status line says which way it
> went), and streaming a CSV larger than memory comfortably holds.
>
> Test suite is public at /tests/ and runs in the browser.

**What page to link to.** The homepage.

**What NOT to do.** Do not ask anyone to upvote. Do not post and disappear —
the comments are the point, and answering them well is what gets the traffic.
Post once; if it sinks, it sinks.

---

## Reddit

Read each subreddit's self-promotion rule first. Several of these ban link
posts from new accounts outright.

| Subreddit | Angle |
| --- | --- |
| r/webdev | The no-build-step static architecture |
| r/javascript | Plain ES modules, Web Workers, no framework |
| r/programming | Only if there is a genuine write-up behind it |
| r/devops | JWT decoding and cURL translation without uploading secrets |
| r/dataengineering | CSV delimiter and header detection, large-file streaming |
| r/privacy | Client-side processing enforced by CSP |

**What to post.** A text post, not a bare link. Lead with the problem, not the
product: pasting a token into a random online decoder is a bad habit, here is
one that cannot exfiltrate it and here is why you can verify that.

**What page to link to.** The tool that matches the subreddit — `/jwt-decoder/`
for r/devops, `/csv-to-json/` for r/dataengineering — not the homepage.

**What NOT to do.** Do not post the same text to six subreddits in one day. Do
not use a second account to comment on your own post.

---

## Product Hunt

**Why it fits.** Reaches people outside the developer bubble and produces a
durable link. Lower value than Show HN for this audience, but cheap.

**What to post.** Tagline: *Developer converters that never upload your data.*
Use the homepage screenshot. Answer every comment on launch day.

**What NOT to do.** Do not buy or trade upvotes.

---

## Tool directories

Submit where submission is genuinely open and the directory is curated rather
than an SEO farm. Good candidates: Free For Dev, the relevant awesome-lists
that accept submissions, and developer-tool aggregators that review entries.

**What NOT to do.** Do not submit to directories that exist purely to sell
backlinks. They do nothing for ranking and can attract a manual penalty.

---

## Technical writing

Worth doing only if the article is genuinely useful on its own. Each of these
maps onto a tool and answers a question people actually search:

- CSV quoting and delimiter rules, and why detection is a guess → `/csv-to-json/`
- What a JWT actually contains, and why decoding is not verifying → `/jwt-decoder/`
- Unix seconds vs milliseconds vs microseconds → `/unix-timestamp-converter/`
- ULID vs UUID v4 as a database key → `/ulid-generator/`

Publish on your own domain if you have one, so the link equity stays. Cross-post
to dev.to or Hashnode with a canonical link back.

**What NOT to do.** Do not generate a hundred thin articles. Four good ones
that a practitioner would bookmark beat a hundred that no one finishes.

---

## What success looks like in week one

Do not judge by traffic — judge by whether anything got indexed and whether
anyone came back.

- Search Console shows the sitemap read and pages indexed, not "Discovered – currently not indexed".
- At least a handful of impressions for brand queries (`devconvert`).
- Referral traffic from wherever you posted.
- Someone, somewhere, links to it without being asked.

Ranking for `csv to json` takes months and is not a week-one metric.
