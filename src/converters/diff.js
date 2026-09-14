/**
 * diff.js — text / JSON diff engine.
 *
 * Pure functions only: no DOM, no storage, no network, so this module runs
 * unchanged in a Web Worker and in Node for unit tests. See shared.js for the
 * converter contract.
 *
 * computeDiff() returns a plain, structurally-cloneable object (safe to send
 * through postMessage) that the UI can render with text nodes only:
 *
 *   {
 *     parts:   Array<{ type, value, leftLine?, rightLine? }>,  // inline view
 *     stats:   { added, removed, unchanged },
 *     rows:    Array<{ left, right, type }>,                   // side-by-side view
 *     unified: string,                                         // for a <pre>
 *     warnings?: string[],
 *     notes?: string[],
 *   }
 *
 * Nothing here produces HTML — highlighting is the renderer's job, which keeps
 * untrusted input away from innerHTML by construction.
 */

import { Diff } from '../vendor.js';
import { SIZE_POLICY, byteLength, formatBytes } from '../security.js';
import { parseJson, stringifyJson, normalizeNewlines } from './shared.js';

/**
 * Hard cap on the number of diff chunks we hand to the UI. Rendering tens of
 * thousands of nodes locks up the main thread far more reliably than computing
 * the diff does, so we truncate the *result* rather than refusing the input.
 */
const MAX_PARTS = 5000;

/** Unified-diff context lines, matching `git diff` defaults. */
const DEFAULT_CONTEXT = 3;

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Compare two texts.
 *
 * @param {string} left
 * @param {string} right
 * @param {{ mode?: 'line'|'word'|'json', ignoreWhitespace?: boolean,
 *           ignoreCase?: boolean, context?: number }} [options]
 */
export function computeDiff(left, right, options = {}) {
  const mode = options.mode === 'word' || options.mode === 'json' ? options.mode : 'line';
  const ignoreWhitespace = Boolean(options.ignoreWhitespace);
  const ignoreCase = Boolean(options.ignoreCase);
  const context = clampContext(options.context);

  const warnings = [];
  const notes = [];

  const rawLeft = normalizeNewlines(left ?? '');
  const rawRight = normalizeNewlines(right ?? '');
  warnOnSize(rawLeft, 'Left side', warnings);
  warnOnSize(rawRight, 'Right side', warnings);

  // JSON mode compares *meaning*, not bytes: both sides are re-serialized with
  // recursively sorted keys and a fixed indent, so key order, spacing and
  // trailing-comma-free formatting differences disappear before diffing.
  let leftText = rawLeft;
  let rightText = rawRight;
  if (mode === 'json') {
    leftText = normalizeJsonText(left, 'left JSON');
    rightText = normalizeJsonText(right, 'right JSON');
    notes.push(
      'JSON mode normalized both sides before comparing: object keys sorted alphabetically (recursively) and re-indented with 2 spaces, so key order and formatting are ignored.',
    );
  }

  if (mode === 'word' && ignoreWhitespace) {
    notes.push('Word mode preserves spacing, so "ignore whitespace" only affects line and JSON modes.');
  }

  const changes = runDiff(mode, leftText, rightText, { ignoreWhitespace, ignoreCase });

  // Side-by-side rows are always line-aligned. In word mode the chunks are
  // sub-line fragments, so the row view is built from an extra line pass over
  // the same (already normalized) texts.
  const lineChanges =
    mode === 'word'
      ? Diff.diffLines(leftText, rightText, { ignoreWhitespace, ignoreCase })
      : changes;

  let usableChanges = changes;
  let usableLineChanges = lineChanges;
  if (changes.length > MAX_PARTS) {
    usableChanges = changes.slice(0, MAX_PARTS);
    usableLineChanges = mode === 'word' ? lineChanges.slice(0, MAX_PARTS) : usableChanges;
    warnings.push(`Diff truncated at ${MAX_PARTS} changes to keep the page responsive.`);
  }

  const parts = buildParts(usableChanges, mode);
  const stats = buildStats(usableChanges, mode);
  const rows = buildRows(usableLineChanges);

  if (stats.added === 0 && stats.removed === 0) {
    notes.push('The two sides are identical under the current comparison options.');
  }

  return {
    parts,
    stats,
    rows,
    unified: createPatch(leftText, rightText, context),
    warnings: warnings.length ? warnings : undefined,
    notes: notes.length ? notes : undefined,
  };
}

/**
 * Unified-diff text for the copy / download path. Re-runs the same
 * normalization as computeDiff so the downloaded patch matches what was shown.
 *
 * @returns {string}
 */
export function diffToUnifiedText(left, right, options = {}) {
  const mode = options.mode === 'word' || options.mode === 'json' ? options.mode : 'line';
  const leftText =
    mode === 'json' ? normalizeJsonText(left, 'left JSON') : normalizeNewlines(left ?? '');
  const rightText =
    mode === 'json' ? normalizeJsonText(right, 'right JSON') : normalizeNewlines(right ?? '');
  return createPatch(leftText, rightText, clampContext(options.context));
}

/** A small, realistic sample pair differing in exactly two lines. */
export const DIFF_EXAMPLE = Object.freeze({
  left: [
    '{',
    '  "name": "formatport",',
    '  "version": "1.0.0",',
    '  "private": true,',
    '  "scripts": {',
    '    "test": "node --test tests/"',
    '  }',
    '}',
  ].join('\n'),
  right: [
    '{',
    '  "name": "formatport",',
    '  "version": "1.1.0",',
    '  "private": true,',
    '  "scripts": {',
    '    "test": "node --test tests/ --experimental-test-coverage"',
    '  }',
    '}',
  ].join('\n'),
});

/* ------------------------------------------------------------------ *
 * JSON normalization
 * ------------------------------------------------------------------ */

/**
 * Recursively sort object keys so that {"b":1,"a":2} and {"a":2,"b":1} produce
 * byte-identical text. Arrays keep their order — element order is data in JSON,
 * unlike key order, which is not.
 */
export function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

/** parseJson + sortKeysDeep + stable pretty-print, as one step. */
function normalizeJsonText(text, label) {
  const value = parseJson(text ?? '', label);
  return normalizeNewlines(stringifyJson(sortKeysDeep(value), 2));
}

/* ------------------------------------------------------------------ *
 * Diff plumbing
 * ------------------------------------------------------------------ */

function runDiff(mode, leftText, rightText, { ignoreWhitespace, ignoreCase }) {
  if (mode === 'word') {
    // diffWordsWithSpace keeps whitespace inside the chunks, which is what a
    // renderer needs to reproduce the original text exactly.
    return Diff.diffWordsWithSpace(leftText, rightText, { ignoreCase });
  }
  return Diff.diffLines(leftText, rightText, { ignoreWhitespace, ignoreCase });
}

function createPatch(leftText, rightText, context) {
  // File labels are fixed so the patch reads like a normal `diff -u` blob.
  return normalizeNewlines(
    Diff.createTwoFilesPatch('left', 'right', leftText, rightText, undefined, undefined, {
      context,
    }),
  );
}

/**
 * Inline parts, each carrying the 1-based line where the chunk starts on the
 * side(s) it belongs to. Counters advance independently per side, which is what
 * makes the numbers line up with the original documents.
 */
function buildParts(changes, mode) {
  const parts = [];
  let leftLine = 1;
  let rightLine = 1;
  for (const change of changes) {
    const type = change.added ? 'add' : change.removed ? 'remove' : 'equal';
    const part = { type, value: change.value };
    if (type !== 'add') part.leftLine = leftLine;
    if (type !== 'remove') part.rightLine = rightLine;
    parts.push(part);

    const consumed = linesConsumed(change.value, mode);
    if (type !== 'add') leftLine += consumed;
    if (type !== 'remove') rightLine += consumed;
  }
  return parts;
}

/**
 * Stats are counted in the unit the user actually sees: lines for line/JSON
 * mode, word tokens for word mode (jsdiff already reports the token count).
 */
function buildStats(changes, mode) {
  const stats = { added: 0, removed: 0, unchanged: 0 };
  for (const change of changes) {
    const amount = mode === 'word' ? change.count ?? 1 : countLines(change.value);
    if (change.added) stats.added += amount;
    else if (change.removed) stats.removed += amount;
    else stats.unchanged += amount;
  }
  return stats;
}

/**
 * Side-by-side rows. Consecutive removed/added blocks are buffered and then
 * zipped together so a removed line sits next to the line that replaced it
 * ('modify'); whichever side runs out first is padded with null.
 */
function buildRows(changes) {
  const rows = [];
  let leftNum = 0;
  let rightNum = 0;
  let pendingRemoved = [];
  let pendingAdded = [];

  const flush = () => {
    const height = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let i = 0; i < height; i += 1) {
      const leftCell = pendingRemoved[i] ?? null;
      const rightCell = pendingAdded[i] ?? null;
      rows.push({
        left: leftCell,
        right: rightCell,
        type: leftCell && rightCell ? 'modify' : leftCell ? 'remove' : 'add',
      });
    }
    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const change of changes) {
    const lines = splitLines(change.value);
    if (change.removed) {
      for (const text of lines) {
        leftNum += 1;
        pendingRemoved.push({ num: leftNum, text });
      }
    } else if (change.added) {
      for (const text of lines) {
        rightNum += 1;
        pendingAdded.push({ num: rightNum, text });
      }
    } else {
      flush(); // an equal block ends the current change hunk
      for (const text of lines) {
        leftNum += 1;
        rightNum += 1;
        rows.push({
          left: { num: leftNum, text },
          right: { num: rightNum, text },
          type: 'equal',
        });
      }
    }
  }
  flush();
  return rows;
}

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

/** Split a chunk into lines, ignoring the trailing newline that ends it. */
function splitLines(value) {
  if (!value) return [];
  const body = value.endsWith('\n') ? value.slice(0, -1) : value;
  return body.split('\n');
}

function countLines(value) {
  return splitLines(value).length;
}

/**
 * How far a chunk advances the line counter. Line chunks advance by their line
 * count; word chunks may sit inside a line, so they advance only by the number
 * of newlines they contain.
 */
function linesConsumed(value, mode) {
  if (mode !== 'word') return countLines(value);
  let newlines = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\n') newlines += 1;
  }
  return newlines;
}

function clampContext(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONTEXT;
  return Math.min(20, Math.max(0, Math.round(n)));
}

/**
 * Oversized input is allowed — it is the user's own text and stays local — but
 * we say so up front, because a multi-megabyte diff is slow to render.
 */
function warnOnSize(text, label, warnings) {
  const bytes = byteLength(text);
  if (bytes > SIZE_POLICY.NORMAL_MAX) {
    warnings.push(
      `${label} is ${formatBytes(bytes)}, above the ${formatBytes(SIZE_POLICY.NORMAL_MAX)} comfort limit — diffing and rendering may be slow.`,
    );
  }
}
