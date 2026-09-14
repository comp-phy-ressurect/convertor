/**
 * indexnow.mjs — tell IndexNow-participating search engines (Bing, Yandex,
 * Seznam, Naver, Yep) that specific FormatPort pages appeared, changed or went
 * away. One POST replaces waiting for the next crawl.
 *
 * Google does not participate in IndexNow. Google is covered by sitemap.xml
 * and Search Console; this script is the other half, not a replacement.
 *
 * ---------------------------------------------------------------------------
 * The key
 * ---------------------------------------------------------------------------
 * IndexNow authenticates by asking the site to prove it controls the key: the
 * key is published at https://formatport.com/<key>.txt and the file contains
 * the key and nothing else. The key is therefore PUBLIC BY DESIGN — it is not
 * a credential, it grants nothing, and committing the key file is how the
 * protocol is meant to work. What it must never be is *wrong*: if the file
 * stops being served, every submission is rejected with 403.
 *
 * The key is read from INDEXNOW_KEY if set, otherwise from the key file found
 * in the repository root. Both paths are checked against the served file
 * before anything is submitted, so a mismatch fails loudly here rather than
 * silently at the API.
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *   node scripts/indexnow.mjs --all                 every URL in sitemap.xml
 *   node scripts/indexnow.mjs --changed HEAD~1      pages touched since a ref
 *   node scripts/indexnow.mjs /json-to-yaml/ /uuid-generator/
 *   node scripts/indexnow.mjs --all --dry-run       print, submit nothing
 *
 * Flags:
 *   --dry-run   resolve and print the payload, make no network call
 *   --strict    exit non-zero if the API call fails (default: warn and exit 0)
 *
 * ---------------------------------------------------------------------------
 * Why a failure here is not a deploy failure
 * ---------------------------------------------------------------------------
 * The site is already live by the time this runs. If IndexNow is down, the
 * pages are still correct, still in sitemap.xml and still crawlable — the only
 * loss is that discovery takes days instead of minutes. Failing a deploy over
 * that would be trading a real outage for a scheduling inconvenience, so the
 * default is to warn and exit 0. Use --strict when you actually want to know.
 */

import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { PRODUCTION_ORIGIN } = await import('../src/config.js');

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const KEY_FILE_PATTERN = /^([a-f0-9]{8,128})\.txt$/i;

/* ------------------------------------------------------------------ *
 * Key
 * ------------------------------------------------------------------ */

/** The key file lives in the repository root and is named after the key. */
async function findKeyFile() {
  const entries = await readdir(root, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isFile() && KEY_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name);

  if (matches.length > 1) {
    throw new Error(
      'More than one IndexNow key file in the repository root (' +
        matches.join(', ') +
        '). Keep exactly one, or the wrong key may be used.',
    );
  }
  return matches[0] ?? null;
}

async function resolveKey() {
  const fromEnv = process.env.INDEXNOW_KEY?.trim();
  const keyFile = await findKeyFile();

  if (!fromEnv && !keyFile) {
    throw new Error(
      'No IndexNow key. Either set INDEXNOW_KEY, or create <key>.txt in the\n' +
        'repository root containing that key and nothing else. Generate one with:\n' +
        "  node -e \"console.log(require('crypto').randomBytes(16).toString('hex'))\"",
    );
  }

  const key = fromEnv ?? keyFile.replace(/\.txt$/i, '');

  // The file's *name* is what the protocol looks up, so name and contents have
  // to agree. A mismatch is silent in a browser and fatal at the API.
  if (keyFile) {
    const contents = (await readFile(join(root, keyFile), 'utf8')).trim();
    const named = keyFile.replace(/\.txt$/i, '');
    if (contents !== named) {
      throw new Error(
        `${keyFile} contains "${contents}" but is named for "${named}". ` +
          'The file must contain exactly the key it is named after.',
      );
    }
    if (fromEnv && fromEnv !== named) {
      throw new Error(
        `INDEXNOW_KEY is "${fromEnv}" but the published key file is "${named}". ` +
          'Submissions would be rejected. Remove one of the two.',
      );
    }
  }

  return key;
}

/**
 * The key has to be reachable at the origin we are claiming, or every
 * submission is rejected. Checking it here turns a confusing 403 into a clear
 * message about a missing file.
 */
async function verifyKeyIsPublished(key) {
  const url = `${PRODUCTION_ORIGIN}/${key}.txt`;
  try {
    const response = await fetch(url);
    if (!response.ok) return `${url} returned HTTP ${response.status}`;
    const body = (await response.text()).trim();
    if (body !== key) return `${url} served "${body.slice(0, 40)}" instead of the key`;
    return null;
  } catch (error) {
    return `${url} could not be fetched (${error.message})`;
  }
}

/* ------------------------------------------------------------------ *
 * Which URLs
 * ------------------------------------------------------------------ */

async function urlsFromSitemap() {
  const xml = await readFile(join(root, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
}

/**
 * Map a repository path to the public URL it is served at, or null when the
 * file is not a page.
 *
 * This filter is the point of the whole function. A deploy usually touches
 * things that are not pages — styles, source modules, notes, the sitemap
 * itself — and announcing a "change" for those would be noise sent to every
 * participating engine. Only files that a visitor can actually land on count.
 */
function pathToUrl(file) {
  const path = file.replace(/\\/g, '/');

  if (path === 'index.html') return PRODUCTION_ORIGIN + '/';
  if (path === 'privacy.html') return PRODUCTION_ORIGIN + '/privacy';
  if (path === 'terms.html') return PRODUCTION_ORIGIN + '/terms';

  // <tool>/index.html and tools/<category>/index.html
  const directoryPage = path.match(/^((?:tools\/)?[a-z0-9-]+(?:\/[a-z0-9-]+)?)\/index\.html$/);
  if (directoryPage) return PRODUCTION_ORIGIN + '/' + directoryPage[1] + '/';

  return null;
}

/**
 * Pages added, modified or deleted since `ref`. Deleted pages are included on
 * purpose: submitting a URL that now 404s is how IndexNow is told to drop it.
 */
async function urlsFromGit(ref) {
  const { stdout } = await run('git', ['diff', '--name-only', '--diff-filter=AMDR', ref, 'HEAD'], {
    cwd: root,
  });
  const urls = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(pathToUrl)
    .filter(Boolean);
  return [...new Set(urls)];
}

/** Accept "/json-to-yaml/" or a full URL; reject anything off-origin. */
function normalizeArgument(value) {
  const url = value.startsWith('http') ? value : PRODUCTION_ORIGIN + (value.startsWith('/') ? '' : '/') + value;
  return url;
}

/* ------------------------------------------------------------------ *
 * Submit
 * ------------------------------------------------------------------ */

async function submit(key, urls) {
  const { host } = new URL(PRODUCTION_ORIGIN);
  const payload = {
    host,
    key,
    keyLocation: `${PRODUCTION_ORIGIN}/${key}.txt`,
    urlList: urls,
  };

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });

  // 200 accepted, 202 accepted but key still being validated. Both are fine.
  return { status: response.status, body: (await response.text()).trim() };
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const strict = argv.includes('--strict');
const rest = argv.filter((value) => value !== '--dry-run' && value !== '--strict');

function fail(message) {
  console.error('IndexNow: ' + message);
  process.exit(strict ? 1 : 0);
}

let urls;
try {
  if (rest.includes('--all')) {
    urls = await urlsFromSitemap();
  } else if (rest.includes('--changed')) {
    const index = rest.indexOf('--changed');
    urls = await urlsFromGit(rest[index + 1] ?? 'HEAD~1');
  } else if (rest.length) {
    urls = rest.map(normalizeArgument);
  } else {
    console.error(
      'Nothing to submit. Pass --all, --changed <ref>, or one or more paths.\n' +
        'See the header of this file for examples.',
    );
    process.exit(1);
  }
} catch (error) {
  fail('could not work out which URLs to submit: ' + error.message);
}

// Never leak a local or third-party URL into a submission. A stray
// localhost URL is rejected for the whole batch, so catch it here.
const offOrigin = urls.filter((url) => !url.startsWith(PRODUCTION_ORIGIN + '/'));
if (offOrigin.length) {
  console.error('IndexNow: refusing to submit URLs outside ' + PRODUCTION_ORIGIN + ':');
  for (const url of offOrigin) console.error('  ' + url);
  process.exit(1);
}

urls = [...new Set(urls)].sort();

if (!urls.length) {
  console.log('IndexNow: no public pages changed, nothing to submit.');
  process.exit(0);
}

let key;
try {
  key = await resolveKey();
} catch (error) {
  fail(error.message);
}

console.log(`IndexNow: ${urls.length} URL(s), key ${key.slice(0, 6)}…`);
for (const url of urls) console.log('  ' + url);

if (dryRun) {
  console.log('IndexNow: --dry-run, nothing submitted.');
  process.exit(0);
}

const keyProblem = await verifyKeyIsPublished(key);
if (keyProblem) {
  fail('key file is not being served — ' + keyProblem + '. Submissions would be rejected.');
}

try {
  const { status, body } = await submit(key, urls);
  if (status === 200 || status === 202) {
    console.log(`IndexNow: accepted (HTTP ${status}).`);
  } else {
    fail(`API returned HTTP ${status}${body ? ' — ' + body : ''}`);
  }
} catch (error) {
  fail('request failed — ' + error.message);
}
