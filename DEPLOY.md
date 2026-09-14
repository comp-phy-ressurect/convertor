# Deploying formatport.com

FormatPort ships as static files. There is no build step for the application
itself — only `scripts/build-seo.mjs`, which rewrites the crawlable HTML shells
and the sitemap from `src/config.js`.

## 1. Before the first deploy

```bash
node scripts/build-seo.mjs
```

The script prints the origin it used. It must say `https://formatport.com`. If
it still says `example.com`, fix `PRODUCTION_ORIGIN` in `src/config.js` and run
it again — canonicals, Open Graph URLs, JSON-LD, `sitemap.xml` and `robots.txt`
all come from that one constant.

Commit whatever the script changed. The generated pages are checked in on
purpose: the host serves files, not a build.

## 2. Host: Cloudflare Pages

Connect the repository and use these settings:

| Setting | Value |
| --- | --- |
| Build command | *(leave empty)* |
| Build output directory | `/` |
| Root directory | `/` |

`_headers` is read by Cloudflare Pages automatically. Nothing else is needed.

### Verify the headers actually arrive

The Content-Security-Policy in `_headers` is not decoration — it is the
enforcement behind the privacy claim. A deploy where it silently fails to apply
looks identical in a browser. Check it explicitly:

```bash
curl -sI https://formatport.com/ | grep -i content-security-policy
```

The response must contain `connect-src 'none'`. If the header is missing,
`_headers` is not being picked up — stop and fix that before announcing the
site.

## 3. Traffic analytics without tracking

Turn on **Cloudflare Web Analytics in server-side mode** for the zone:

> Cloudflare dashboard → the `formatport.com` zone → Analytics & Logs → Web Analytics

This is the important part: **do not add the JavaScript beacon.** Cloudflare
offers a `<script>` snippet for sites it does not proxy; this site is proxied,
so the numbers are counted at the edge from requests that already pass through
Cloudflare. That distinction is the whole design:

- No `<script>` on any page, no cookie, no client-side identifier.
- `connect-src 'none'` stays intact — a beacon would need a hole in it.
- The claim in `privacy.html` that no analytics are *loaded* stays true, because
  edge counting loads nothing. That is not the same as saying nothing is
  measured, so section 4 of that page names Cloudflare and says plainly which
  aggregate statistics the operator looks at. Keep those two in step: if the
  measurement changes, the page has to change with it.
- The dashboard sits behind the Cloudflare account login. That is real
  authentication, unlike a secret URL, which leaks through git history,
  `Referer` headers, certificate transparency logs and browser history — and
  which cannot be revoked once it is known.

What you get: requests and unique visitors over time, top paths, referrers,
countries, status codes, and bots vs. humans. What you do not get: per-user
journeys or funnels. That is the intended trade.

### If the site ever moves off Cloudflare

Netlify Analytics is the equivalent (log-derived, no client script, paid per
site). GitHub Pages has no server-side analytics at all — on that host the only
route to numbers is a browser script, which would mean editing `_headers` and
rewriting the privacy page. Treat that as a product decision, not a deployment
detail.

## 4. Telling search engines

Two mechanisms, and they cover different engines.

**Google: sitemap + Search Console.** Google does not participate in IndexNow.
It is covered by `sitemap.xml` and a verified Search Console property — the
exact steps, including the DNS TXT record, are in `SEARCH_ENGINE_SETUP.md`.

**Everyone else: IndexNow.** Bing, Yandex, Seznam, Naver and Yep accept a push
notification instead of waiting for a crawl. `.github/workflows/indexnow.yml`
runs on the same push that deploys, waits for the new files to be live, and
submits only the pages that push actually changed.

Run it by hand after a restructure, or once after the first deploy to seed the
engines with everything:

```bash
node scripts/indexnow.mjs --all
node scripts/indexnow.mjs --changed HEAD~1
node scripts/indexnow.mjs --all --dry-run
```

The key is published at `/<key>.txt` and is public by protocol — there is no
secret to configure. A failed submission warns and exits 0 on purpose: the site
is already live and in the sitemap, so a missed ping costs latency, not
correctness, and is not worth failing a deploy over. Use `--strict` when you
want the non-zero exit.

## 5. After the domain resolves

- [ ] `curl -sI https://formatport.com/ | grep -i content-security-policy` shows `connect-src 'none'`.
- [ ] `https://formatport.com/sitemap.xml` loads and lists `formatport.com` URLs.
- [ ] `https://formatport.com/robots.txt` points at that sitemap.
- [ ] A tool page (e.g. `/json-to-yaml/`) loads with the right `<title>` and canonical.
- [ ] `/tests/` passes in a browser on the deployed site.
- [ ] Submit the sitemap in Google Search Console.
- [ ] Web Analytics is enabled and recording — check it a day after launch.
- [ ] `curl -sSI https://www.formatport.com/` returns **301** to the apex, not 522.
- [ ] `https://formatport.com/og.png` returns 200 — social previews depend on it.
- [ ] `https://formatport.com/<key>.txt` serves the IndexNow key.
