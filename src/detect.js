/**
 * detect.js — independent scoring detectors for pasted input.
 *
 * Design rules:
 *  - Every detector is a pure function of the raw text and returns
 *    { type, confidence: 0..1, reason }.
 *  - Detectors never mutate the input and the UI never rewrites what you typed.
 *    Detection only *suggests* a tool; the manual override always wins.
 *  - Confidence is deliberately conservative. "Looks like it might be YAML"
 *    scores low so that a wrong guess never outranks a certain one.
 */

import { base64ToBytes } from './converters/encoding.js';

/** Precedence used when two detectors score within a whisker of each other. */
const PRECEDENCE = ['curl', 'jwt', 'json', 'url', 'timestamp', 'html', 'xml', 'yaml', 'csv', 'toml', 'base64', 'text'];

const SAMPLE_LIMIT = 64 * 1024; // Detect on a prefix; a 5 MiB paste needs no full scan.

/**
 * Run every detector and return them sorted best-first.
 * @returns {Array<{type: string, confidence: number, reason: string}>}
 */
export function detectAll(rawInput) {
  const input = String(rawInput ?? '');
  const sample = input.length > SAMPLE_LIMIT ? input.slice(0, SAMPLE_LIMIT) : input;
  const trimmed = sample.trim();

  if (!trimmed) {
    return [{ type: 'text', confidence: 0, reason: 'Input is empty.' }];
  }

  const candidates = [
    detectCurl(trimmed),
    detectJwt(trimmed),
    detectJson(trimmed),
    detectUrl(trimmed),
    detectTimestamp(trimmed),
    detectHtmlTable(trimmed),
    detectXml(trimmed),
    detectYaml(trimmed, input),
    detectCsv(trimmed),
    detectToml(trimmed),
    detectBase64(trimmed),
    detectPlainText(trimmed),
  ].filter((candidate) => candidate && candidate.confidence > 0);

  candidates.sort((a, b) => {
    // Within 5 percentage points, fall back to the documented precedence order.
    if (Math.abs(b.confidence - a.confidence) < 0.05) {
      return PRECEDENCE.indexOf(a.type) - PRECEDENCE.indexOf(b.type);
    }
    return b.confidence - a.confidence;
  });

  return candidates.length ? candidates : [{ type: 'text', confidence: 0.3, reason: 'No structure recognized.' }];
}

/** Convenience wrapper: the single best guess. */
export function detect(input) {
  return detectAll(input)[0];
}

/* ------------------------------------------------------------------ *
 * cURL
 * ------------------------------------------------------------------ */

export function detectCurl(input) {
  const normalized = input.replace(/^\$\s+/, '');
  if (!/^curl(\s|$)/i.test(normalized)) {
    return { type: 'curl', confidence: 0, reason: 'Does not start with "curl".' };
  }
  const hasUrl = /https?:\/\//i.test(normalized) || /\s-{1,2}url\b/i.test(normalized);
  const hasFlags = /\s-[A-Za-z]|\s--[a-z-]+/.test(normalized);
  if (hasUrl && hasFlags) {
    return { type: 'curl', confidence: 0.98, reason: 'Starts with "curl" and contains a URL and flags.' };
  }
  if (hasUrl) {
    return { type: 'curl', confidence: 0.92, reason: 'Starts with "curl" and contains a URL.' };
  }
  return { type: 'curl', confidence: 0.6, reason: 'Starts with "curl" but no URL was found.' };
}

/* ------------------------------------------------------------------ *
 * JWT
 * ------------------------------------------------------------------ */

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

export function detectJwt(input) {
  const token = input.replace(/^Bearer\s+/i, '').trim();
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment, index) => index < 2 && !segment)) {
    return { type: 'jwt', confidence: 0, reason: 'Not three dot-separated segments.' };
  }
  if (!segments.slice(0, 2).every((segment) => BASE64URL_SEGMENT.test(segment))) {
    return { type: 'jwt', confidence: 0, reason: 'Segments are not Base64URL.' };
  }

  const header = tryDecodeJsonSegment(segments[0]);
  const payload = tryDecodeJsonSegment(segments[1]);

  if (header && payload) {
    const looksLikeJwt = typeof header.alg === 'string' || typeof header.typ === 'string';
    return {
      type: 'jwt',
      confidence: looksLikeJwt ? 0.99 : 0.93,
      reason: looksLikeJwt
        ? 'Header and payload decode as JSON and the header declares "alg"/"typ".'
        : 'Header and payload both decode as JSON objects.',
    };
  }
  if (header || payload) {
    return { type: 'jwt', confidence: 0.55, reason: 'Only one of the two segments decodes as JSON.' };
  }
  return { type: 'jwt', confidence: 0.25, reason: 'Shaped like a JWT but neither segment decodes as JSON.' };
}

function tryDecodeJsonSegment(segment) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(segment));
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

export function detectJson(input) {
  const first = input[0];
  if (!'{["-0123456789tfn'.includes(first)) {
    return { type: 'json', confidence: 0, reason: 'Does not start with a JSON value.' };
  }
  try {
    const value = JSON.parse(input);
    if (value !== null && typeof value === 'object') {
      return {
        type: 'json',
        confidence: 0.98,
        reason: Array.isArray(value)
          ? 'Parses as a JSON array with ' + value.length + ' element(s).'
          : 'Parses as a JSON object with ' + Object.keys(value).length + ' key(s).',
      };
    }
    // A bare 42 or "x" is valid JSON but almost never what the user means.
    return { type: 'json', confidence: 0.35, reason: 'Parses as a bare JSON scalar.' };
  } catch {
    if (/^[{[]/.test(input) && /[}\]]$/.test(input)) {
      return { type: 'json', confidence: 0.4, reason: 'Looks like JSON but does not parse — check for trailing commas or quotes.' };
    }
    return { type: 'json', confidence: 0, reason: 'JSON.parse failed.' };
  }
}

/* ------------------------------------------------------------------ *
 * URL
 * ------------------------------------------------------------------ */

export function detectUrl(input) {
  if (/\s/.test(input)) {
    return { type: 'url', confidence: 0, reason: 'Contains whitespace.' };
  }
  let url;
  try {
    url = new URL(input);
  } catch {
    return { type: 'url', confidence: 0, reason: 'Not a parsable absolute URL.' };
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { type: 'url', confidence: 0.95, reason: 'Parses as an ' + url.protocol.replace(':', '') + ' URL.' };
  }
  if (url.protocol === 'data:' || url.protocol === 'javascript:') {
    return { type: 'url', confidence: 0.5, reason: 'Parses as a ' + url.protocol.replace(':', '') + ' URI.' };
  }
  return { type: 'url', confidence: 0.7, reason: 'Parses as a URL with scheme "' + url.protocol.replace(':', '') + '".' };
}

/* ------------------------------------------------------------------ *
 * Unix timestamp
 * ------------------------------------------------------------------ */

// Roughly 2001-09-09 .. 2033-05-18 in seconds: the range where a plain integer
// is overwhelmingly likely to be a timestamp rather than an ID.
const PLAUSIBLE_SECONDS = [1_000_000_000, 2_000_000_000];

export function detectTimestamp(input) {
  if (!/^\d{9,14}$/.test(input)) {
    return { type: 'timestamp', confidence: 0, reason: 'Not a 9-14 digit integer.' };
  }
  const value = Number(input);
  const digits = input.length;

  if (digits === 10 && value >= PLAUSIBLE_SECONDS[0] && value <= PLAUSIBLE_SECONDS[1]) {
    return { type: 'timestamp', confidence: 0.9, reason: '10 digits in the plausible seconds range.' };
  }
  if (digits === 13 && value >= PLAUSIBLE_SECONDS[0] * 1000 && value <= PLAUSIBLE_SECONDS[1] * 1000) {
    return { type: 'timestamp', confidence: 0.9, reason: '13 digits in the plausible milliseconds range.' };
  }
  if (digits === 9 || digits === 11 || digits === 12 || digits === 14) {
    return { type: 'timestamp', confidence: 0.45, reason: digits + ' digits — possible timestamp, but outside the common seconds/milliseconds shapes.' };
  }
  return { type: 'timestamp', confidence: 0.3, reason: 'Numeric, but the resulting date is implausible.' };
}

/* ------------------------------------------------------------------ *
 * YAML
 *
 * The trap here is that js-yaml parses "hello" and "42" happily, so a naive
 * detector calls every string YAML. We instead require YAML-specific syntax.
 * ------------------------------------------------------------------ */

export function detectYaml(trimmed, rawInput) {
  if (/^</.test(trimmed)) {
    return { type: 'yaml', confidence: 0, reason: 'Starts with markup, not YAML.' };
  }
  if (/^[{[]/.test(trimmed)) {
    return { type: 'yaml', confidence: 0, reason: 'Looks like JSON flow style; JSON detection covers this.' };
  }

  const lines = trimmed.split('\n').filter((line) => line.trim() && !/^\s*#/.test(line));
  if (!lines.length) return { type: 'yaml', confidence: 0, reason: 'No content lines.' };

  const documentMarker = /^---\s*$/m.test(trimmed);
  const keyLines = lines.filter((line) => /^\s*[\w".'-][\w\s".'/-]*:(\s|$)/.test(line));
  const listLines = lines.filter((line) => /^\s*-\s+\S/.test(line));
  const indented = lines.filter((line) => /^\s+\S/.test(line));
  const anchors = /(^|\s)[&*][A-Za-z0-9_-]+/.test(trimmed);
  const blockScalar = /:\s*[|>][-+]?\s*$/m.test(trimmed);

  const structural = keyLines.length + listLines.length;
  if (structural === 0) {
    return { type: 'yaml', confidence: 0, reason: 'No "key: value" or "- item" lines.' };
  }

  const coverage = structural / lines.length;
  let confidence = 0.3 + coverage * 0.45;
  if (documentMarker) confidence += 0.12;
  if (indented.length) confidence += 0.08;
  if (anchors || blockScalar) confidence += 0.1;
  if (lines.length === 1 && !documentMarker) confidence = Math.min(confidence, 0.55);
  // A tab used for indentation is illegal in YAML.
  if (/^\t+\S/m.test(rawInput ?? trimmed)) confidence = Math.min(confidence, 0.35);

  return {
    type: 'yaml',
    confidence: Math.min(0.95, Number(confidence.toFixed(2))),
    reason: structural + ' of ' + lines.length + ' lines use YAML mapping/sequence syntax.',
  };
}

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

export function detectCsv(input) {
  const lines = input.split('\n').map((line) => line.replace(/\r$/, '')).filter((line) => line.trim());
  if (lines.length < 2) {
    return { type: 'csv', confidence: 0, reason: 'CSV needs at least two rows.' };
  }

  const best = [',', ';', '\t', '|']
    .map((delimiter) => scoreDelimiter(lines, delimiter))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.columns < 2) {
    return { type: 'csv', confidence: 0, reason: 'No delimiter produced consistent multi-column rows.' };
  }

  const name = best.delimiter === '\t' ? 'tab' : best.delimiter === ',' ? 'comma' : best.delimiter === ';' ? 'semicolon' : 'pipe';
  return {
    type: 'csv',
    confidence: Math.min(0.93, Number(best.score.toFixed(2))),
    reason: lines.length + ' rows with a consistent ' + best.columns + ' columns separated by ' + name + '.',
  };
}

/** Count fields per row while respecting quoted fields. */
function scoreDelimiter(lines, delimiter) {
  const counts = lines.slice(0, 50).map((line) => countFields(line, delimiter));
  const columns = counts[0];
  if (columns < 2) return { delimiter, columns, score: 0 };
  const consistent = counts.filter((count) => count === columns).length;
  const ratio = consistent / counts.length;
  if (ratio < 0.8) return { delimiter, columns, score: 0 };
  // More rows and more columns both raise confidence, capped well below JSON's.
  const rowBonus = Math.min(0.15, (lines.length - 2) * 0.02);
  const columnBonus = Math.min(0.1, (columns - 2) * 0.02);
  return { delimiter, columns, score: 0.6 * ratio + rowBonus + columnBonus };
}

function countFields(line, delimiter) {
  let count = 1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      count += 1;
    }
  }
  return count;
}

/* ------------------------------------------------------------------ *
 * TOML
 * ------------------------------------------------------------------ */

export function detectToml(input) {
  const lines = input.split('\n').filter((line) => line.trim() && !/^\s*#/.test(line));
  if (!lines.length) return { type: 'toml', confidence: 0, reason: 'No content lines.' };

  const tableHeaders = lines.filter((line) => /^\s*\[\[?[A-Za-z0-9_."-]+\]\]?\s*$/.test(line));
  const assignments = lines.filter((line) => /^\s*[A-Za-z0-9_."-]+\s*=\s*\S/.test(line));

  if (!assignments.length) return { type: 'toml', confidence: 0, reason: 'No "key = value" assignments.' };

  const coverage = (tableHeaders.length + assignments.length) / lines.length;
  let confidence = 0.35 + coverage * 0.35;
  if (tableHeaders.length) confidence += 0.15;
  return {
    type: 'toml',
    confidence: Math.min(0.9, Number(confidence.toFixed(2))),
    reason: assignments.length + ' assignment(s) and ' + tableHeaders.length + ' table header(s).',
  };
}

/* ------------------------------------------------------------------ *
 * XML and HTML
 *
 * HTML is checked before XML because an HTML table is also markup-shaped, and
 * "this is a table you can convert" is the more useful answer.
 * ------------------------------------------------------------------ */

export function detectHtmlTable(input) {
  if (!/<table\b/i.test(input) && !/<tr\b/i.test(input)) {
    return { type: 'html', confidence: 0, reason: 'No <table> or <tr> markup.' };
  }
  const rows = (input.match(/<tr\b/gi) ?? []).length;
  const cells = (input.match(/<t[hd]\b/gi) ?? []).length;
  if (!rows || !cells) {
    return { type: 'html', confidence: 0.3, reason: 'Table markup without rows and cells.' };
  }
  const hasTable = /<table\b/i.test(input);
  return {
    type: 'html',
    confidence: Math.min(0.94, (hasTable ? 0.8 : 0.6) + Math.min(0.1, rows * 0.02)),
    reason: rows + ' table row(s) with ' + cells + ' cell(s).',
  };
}

export function detectXml(input) {
  const declaration = /^<\?xml[\s?]/i.test(input);
  if (!declaration && !/^<[A-Za-z_]/.test(input)) {
    return { type: 'xml', confidence: 0, reason: 'Does not start with an XML declaration or element.' };
  }

  // A closing tag is what separates real markup from a stray "<b" fragment.
  const openTags = [...input.matchAll(/<([A-Za-z_][\w.:-]*)[\s/>]/g)].map((m) => m[1]);
  const closeTags = [...input.matchAll(/<\/([A-Za-z_][\w.:-]*)\s*>/g)].map((m) => m[1]);
  const selfClosing = (input.match(/\/>/g) ?? []).length;

  if (!closeTags.length && !selfClosing) {
    return { type: 'xml', confidence: 0.25, reason: 'Looks like markup but no element is closed.' };
  }
  if (!input.trimEnd().endsWith('>')) {
    return { type: 'xml', confidence: 0.35, reason: 'Markup appears truncated.' };
  }

  let confidence = 0.6;
  if (declaration) confidence += 0.3;
  if (closeTags.length >= 2) confidence += 0.08;
  if (openTags.length > 2) confidence += 0.05;
  // HTML documents are markup too, but the HTML detector describes them better.
  if (/^<!doctype html/i.test(input) || /<html\b/i.test(input)) confidence -= 0.25;

  return {
    type: 'xml',
    confidence: Math.min(0.97, Number(confidence.toFixed(2))),
    reason: declaration
      ? 'Has an XML declaration and ' + closeTags.length + ' closing tag(s).'
      : openTags.length + ' element(s) with ' + closeTags.length + ' closing tag(s).',
  };
}

/* ------------------------------------------------------------------ *
 * Base64
 * ------------------------------------------------------------------ */

export function detectBase64(input) {
  // Base64 payloads are commonly wrapped across lines, but a space *inside* a
  // line means this is prose — and "just some regular words here" happens to
  // use only Base64 alphabet characters, so this guard matters.
  const lines = input.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) => /\s/.test(line))) {
    return { type: 'base64', confidence: 0, reason: 'Contains spaces inside a line — reads as prose, not Base64.' };
  }
  const compact = lines.join('');
  if (compact.length < 8) {
    return { type: 'base64', confidence: 0, reason: 'Too short to judge.' };
  }
  const standard = /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
  const urlSafe = /^[A-Za-z0-9_-]+={0,2}$/.test(compact);
  if (!standard && !urlSafe) {
    return { type: 'base64', confidence: 0, reason: 'Contains characters outside the Base64 alphabets.' };
  }
  if (compact.length % 4 === 1) {
    return { type: 'base64', confidence: 0, reason: 'Length is not valid for Base64.' };
  }

  const padded = compact.length % 4 === 0;
  let decodesToText = false;
  try {
    const bytes = base64ToBytes(compact);
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Printable-ish content is a much stronger signal than "valid alphabet".
    decodesToText = true;
  } catch {
    decodesToText = false;
  }

  let confidence = 0.4;
  if (padded) confidence += 0.15;
  if (decodesToText) confidence += 0.2;
  if (compact.length > 40) confidence += 0.05;
  // Plain lowercase words are also "valid Base64"; keep those low.
  if (/^[a-z]+$/.test(compact)) confidence = Math.min(confidence, 0.3);

  return {
    type: 'base64',
    confidence: Math.min(0.88, Number(confidence.toFixed(2))),
    reason: (urlSafe && !standard ? 'Base64URL alphabet' : 'Base64 alphabet') +
      (decodesToText ? ', decodes to valid UTF-8 text.' : ', but the decoded bytes are not UTF-8 text.'),
  };
}

/* ------------------------------------------------------------------ *
 * Plain text — always the floor, never the winner unless nothing else fits
 * ------------------------------------------------------------------ */

export function detectPlainText(input) {
  const lines = input.split('\n').length;
  return {
    type: 'text',
    confidence: 0.2,
    reason: lines > 1 ? lines + ' lines of unstructured text.' : 'A single line of unstructured text.',
  };
}

/** Human-readable label for a detected type. */
export const TYPE_LABELS = {
  curl: 'cURL command',
  xml: 'XML',
  html: 'HTML table',
  jwt: 'JWT',
  json: 'JSON',
  url: 'URL',
  timestamp: 'Unix timestamp',
  yaml: 'YAML',
  csv: 'CSV',
  toml: 'TOML',
  base64: 'Base64',
  text: 'Plain text',
};

/**
 * Label for the detected type.
 *
 * The confidence score is deliberately not shown. It drives the decision — the
 * suggestion only appears above a threshold — but as a number on screen it is
 * noise: nobody needs to be told that JSON was recognized with 98% confidence.
 * It remains in the returned object, and in the element's tooltip, for anyone
 * debugging a detector.
 */
export function formatDetection(detection) {
  if (!detection || !detection.confidence) return '';
  return TYPE_LABELS[detection.type] ?? detection.type;
}
