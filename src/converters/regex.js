/**
 * regex.js — the pure regular-expression engine behind the Regex Tester.
 *
 * No DOM, no storage, no network: this module is imported by the Web Worker
 * wrapper (which owns the timeout that protects the UI from catastrophic
 * backtracking) and by the Node unit tests.
 *
 * SECURITY NOTE — `new RegExp(userPattern, flags)` is NOT eval.
 * It compiles a pattern string with the standard RegExp constructor, which is
 * the intended public API for user-supplied patterns; it cannot execute
 * arbitrary JavaScript. This file contains no eval(), no new Function() and no
 * dynamic import. The same goes for `replacement`: "$1" / "$<name>" are plain
 * String.prototype.replace substitution tokens, not code.
 *
 * Results are plain, structurally-cloneable objects. `segments` partitions the
 * WHOLE input into alternating non-match / match chunks so the renderer can
 * highlight matches with createTextNode only — never innerHTML.
 */

import { ConversionError, requireInput, result } from './shared.js';

/** Every flag ECMAScript currently defines. */
const VALID_FLAGS = /^[dgimsuvy]*$/;

/** Default match cap; the UI can lower it, never raise it beyond reason. */
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 100000;

/* ------------------------------------------------------------------ *
 * Pattern safety helpers
 * ------------------------------------------------------------------ */

/**
 * Validate a flag string: known letters only, no duplicates.
 * @returns {string} the validated flags
 */
export function validateFlags(flags) {
  const value = typeof flags === 'string' ? flags : '';
  if (!VALID_FLAGS.test(value)) {
    const bad = [...value].filter((ch) => !'dgimsuvy'.includes(ch));
    throw new ConversionError(
      `Unknown regular expression flag${bad.length > 1 ? 's' : ''}: ${[...new Set(bad)].join(', ')}`,
      { hint: 'Valid flags are d, g, i, m, s, u, v and y.' },
    );
  }
  const seen = new Set();
  for (const ch of value) {
    if (seen.has(ch)) {
      throw new ConversionError(`Duplicate regular expression flag: ${ch}`);
    }
    seen.add(ch);
  }
  return value;
}

/**
 * Compile a user pattern into a RegExp, turning a SyntaxError into a friendly
 * ConversionError.
 *
 * The 'd' flag is added internally when missing: it only asks the engine to
 * report match indices (needed for per-group positions) and changes nothing
 * about what the pattern matches.
 *
 * @returns {RegExp}
 */
export function compileRegex(pattern, flags) {
  requireInput(pattern, 'regular expression');
  const validated = validateFlags(flags);
  const effective = validated.includes('d') ? validated : validated + 'd';
  try {
    // Not eval: the RegExp constructor compiles a pattern, it does not run code.
    return new RegExp(pattern, effective);
  } catch (error) {
    throw new ConversionError(`Invalid regular expression: ${error.message}`, {
      hint: 'Check for an unbalanced ( ) or [ ], a stray backslash, or an escape that needs doubling.',
      cause: error,
    });
  }
}

/**
 * Names of the capturing groups, indexed by group number (1-based); entries are
 * null for unnamed groups.
 *
 * We scan the pattern text instead of reading `match.groups`, because that
 * object gives no reliable group *number* and drops groups that did not
 * participate in the match.
 *
 * @returns {Array<string|null>}
 */
export function captureGroupNames(source) {
  const names = [null]; // index 0 is the whole match, never a named group
  let classDepth = 0;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '[') {
      // Nested classes are legal under the 'v' flag, so track depth.
      classDepth += 1;
      continue;
    }
    if (ch === ']') {
      if (classDepth > 0) classDepth -= 1;
      continue;
    }
    if (classDepth > 0 || ch !== '(') continue;

    if (source[i + 1] === '?') {
      // (?:…) (?=…) (?!…) (?<=…) (?<!…) do not capture; (?<name>…) does.
      const named = /^\(\?<([^=!][^>]*)>/.exec(source.slice(i));
      if (named) names.push(named[1]);
      continue;
    }
    names.push(null);
  }
  return names;
}

/** Flag letter -> human description, for the UI checkboxes. */
export function describeFlags() {
  return {
    g: 'global — find every match, not just the first',
    i: 'ignore case',
    m: 'multiline — ^ and $ match at line breaks',
    s: 'dotAll — . also matches newlines',
    u: 'unicode — treat the pattern as Unicode code points',
    v: 'unicodeSets — extended character classes (superset of u)',
    y: 'sticky — match only at lastIndex',
    d: 'indices — report the start/end of every capture group',
  };
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/**
 * Run a pattern against an input string.
 *
 * @param {{ pattern: string, flags?: string, input?: string, limit?: number }} params
 * @returns {{ matches: Array, count: number, truncated: boolean,
 *             segments: Array, note?: string }}
 */
export function runRegex({ pattern, flags = '', input = '', limit } = {}) {
  const regex = compileRegex(pattern, flags);
  // Whitespace-only input is a legitimate test subject (\s+, ^$ …), so unlike
  // most converters we do not demand non-blank input here.
  const text = typeof input === 'string' ? input : String(input ?? '');
  const cap = clampLimit(limit);
  const names = captureGroupNames(regex.source);
  const global = regex.global;

  const matches = [];
  let truncated = false;

  if (!global) {
    // Real RegExp semantics: without 'g' there is only ever one match.
    const found = regex.exec(text);
    if (found) matches.push(toMatch(found, names));
  } else {
    regex.lastIndex = 0;
    let found = regex.exec(text);
    while (found) {
      matches.push(toMatch(found, names));
      if (matches.length >= cap) {
        truncated = true;
        break;
      }
      // A zero-length match leaves lastIndex where it is, which would loop
      // forever. Step forward by one full code POINT so surrogate pairs
      // (emoji, astral scripts) are never split in half.
      if (found[0] === '') {
        regex.lastIndex = nextCodePointIndex(text, regex.lastIndex);
        if (regex.lastIndex > text.length) break;
      }
      found = regex.exec(text);
    }
  }

  const note = !global
    ? 'Without the g flag a regular expression returns only the first match. Add g to find them all.'
    : truncated
      ? `Stopped after ${cap} matches to keep the page responsive.`
      : undefined;

  return {
    matches,
    count: matches.length,
    truncated,
    segments: buildSegments(text, matches),
    note,
  };
}

/**
 * Find/replace using the same validation. `replacement` is a standard
 * String.prototype.replace template — $1, $<name>, $& and $$ — which is
 * substitution syntax, not executable code (we never pass a function).
 */
export function replaceWithRegex({ pattern, flags = '', input = '', replacement = '' } = {}) {
  const regex = compileRegex(pattern, flags);
  const text = typeof input === 'string' ? input : String(input ?? '');
  const template = typeof replacement === 'string' ? replacement : String(replacement ?? '');

  const notes = [];
  if (!regex.global) {
    notes.push('Without the g flag only the first occurrence is replaced.');
  }

  // Count first, on a fresh regex, so the reported number cannot be skewed by
  // lastIndex left over from the replace() call.
  const counted = runRegex({ pattern, flags, input: text, limit: MAX_LIMIT });
  if (counted.truncated) {
    notes.push(`More than ${MAX_LIMIT} matches — the replacement count is a lower bound.`);
  }

  regex.lastIndex = 0;
  let output;
  try {
    output = text.replace(regex, template);
  } catch (error) {
    // e.g. an invalid $<name> reference against a pattern with no named groups.
    throw new ConversionError(`Could not apply the replacement: ${error.message}`, {
      hint: 'Use $1…$9 for numbered groups, $<name> for named groups, $$ for a literal dollar sign.',
      cause: error,
    });
  }

  return result(output, {
    notes: notes.length ? notes : undefined,
    details: [{ label: 'Replacements', value: String(counted.count) }],
  });
}

/** Realistic sample with two matches and two capture groups per match. */
export const REGEX_EXAMPLE = Object.freeze({
  pattern: '\\b(\\w+)@(\\w+\\.\\w+)\\b',
  flags: 'g',
  input: 'Ping ada@example.com or grace@example.org before the deploy window closes.',
});

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

function toMatch(found, names) {
  const groups = [];
  for (let i = 1; i < found.length; i += 1) {
    const pair = found.indices ? found.indices[i] : undefined;
    groups.push({
      name: names[i] ?? null,
      value: found[i],
      index: pair ? pair[0] : undefined,
    });
  }
  return {
    index: found.index,
    end: found.index + found[0].length,
    match: found[0],
    groups,
  };
}

/**
 * Partition the entire input into alternating chunks. Concatenating every
 * segment's text reproduces the input exactly, which is what lets the renderer
 * build the highlighted view from text nodes alone.
 */
function buildSegments(text, matches) {
  const segments = [];
  let cursor = 0;
  matches.forEach((m, matchIndex) => {
    if (m.index > cursor) {
      segments.push({ text: text.slice(cursor, m.index), isMatch: false });
    }
    // Zero-length matches contribute no text; skipping them keeps the segment
    // list free of empty nodes without changing the rejoined string.
    if (m.end > m.index) {
      segments.push({ text: text.slice(m.index, m.end), isMatch: true, matchIndex });
    }
    cursor = Math.max(cursor, m.end);
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isMatch: false });
  }
  return segments;
}

/** Index just after the code point starting at `index` (never splits a pair). */
function nextCodePointIndex(text, index) {
  if (index >= text.length) return index + 1;
  const code = text.codePointAt(index);
  return index + (code > 0xffff ? 2 : 1);
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.round(n));
}
