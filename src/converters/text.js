/**
 * text.js — case conversion.
 *
 * Tokenization is Unicode aware: word boundaries come from \p{L}/\p{N} classes
 * rather than [a-z], so "čeština příklad" or "größe wert" survive the round
 * trip instead of being shredded into empty tokens.
 */

import { requireInput, result } from './shared.js';

export const CASE_STYLES = [
  { id: 'camel', label: 'camelCase' },
  { id: 'pascal', label: 'PascalCase' },
  { id: 'snake', label: 'snake_case' },
  { id: 'kebab', label: 'kebab-case' },
  { id: 'constant', label: 'CONSTANT_CASE' },
  { id: 'dot', label: 'dot.case' },
  { id: 'title', label: 'Title Case' },
  { id: 'sentence', label: 'Sentence case' },
  { id: 'lower', label: 'lower case' },
  { id: 'upper', label: 'UPPER CASE' },
];

/**
 * Split arbitrary text into word tokens.
 * Handles camelCase humps, ACRONYMBoundaries, digits, and any separator that
 * is not a letter or a number.
 */
export function tokenize(input) {
  return String(input)
    // Insert a break between a lower/digit and a following upper: fooBar -> foo Bar
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
    // Break "HTTPServer" into "HTTP Server"
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    // Break a letter followed by a digit run: "utf8Value" -> "utf 8 Value"
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const lower = (word) => word.toLocaleLowerCase();
const upper = (word) => word.toLocaleUpperCase();
const capitalize = (word) => (word ? upper(word.charAt(0)) + lower(word.slice(1)) : word);

export function toCamelCase(input) {
  const parts = tokenize(input);
  if (!parts.length) return '';
  return lower(parts[0]) + parts.slice(1).map(capitalize).join('');
}

export function toPascalCase(input) {
  return tokenize(input).map(capitalize).join('');
}

export function toSnakeCase(input) {
  return tokenize(input).map(lower).join('_');
}

export function toKebabCase(input) {
  return tokenize(input).map(lower).join('-');
}

export function toConstantCase(input) {
  return tokenize(input).map(upper).join('_');
}

export function toDotCase(input) {
  return tokenize(input).map(lower).join('.');
}

export function toTitleCase(input) {
  return tokenize(input).map(capitalize).join(' ');
}

export function toSentenceCase(input) {
  const parts = tokenize(input).map(lower);
  if (!parts.length) return '';
  return capitalize(parts[0]) + (parts.length > 1 ? ' ' + parts.slice(1).join(' ') : '');
}

export function toLowerCase(input) {
  return tokenize(input).map(lower).join(' ');
}

export function toUpperCase(input) {
  return tokenize(input).map(upper).join(' ');
}

const CONVERTERS = {
  camel: toCamelCase,
  pascal: toPascalCase,
  snake: toSnakeCase,
  kebab: toKebabCase,
  constant: toConstantCase,
  dot: toDotCase,
  title: toTitleCase,
  sentence: toSentenceCase,
  lower: toLowerCase,
  upper: toUpperCase,
};

/** Convert every style at once — that is what people actually want to see. */
export function convertAllCases(input) {
  const out = {};
  for (const [id, fn] of Object.entries(CONVERTERS)) out[id] = fn(input);
  return out;
}

/**
 * Tool entry point. `options.style` selects a single style; the default 'all'
 * emits every style so the user can copy whichever one they need.
 * Multi-line input is converted line by line, which is what you want when you
 * paste a column of field names.
 */
export function convertCase(input, options = {}) {
  requireInput(input, 'text');
  const style = options.style || 'all';
  const perLine = options.perLine !== false && input.includes('\n');
  const lines = perLine ? input.split('\n') : [input];

  if (style === 'all') {
    const source = lines.find((line) => line.trim()) ?? input;
    const all = convertAllCases(source);
    const width = Math.max(...CASE_STYLES.map((s) => s.label.length));
    const output = CASE_STYLES.map((s) => s.label.padEnd(width) + '  ' + all[s.id]).join('\n');
    const details = CASE_STYLES.map((s) => ({ label: s.label, value: all[s.id] }));
    const notes = perLine
      ? ['Showing every style for the first non-empty line. Pick a single style to convert all lines at once.']
      : undefined;
    return result(output, { details, notes, all });
  }

  const fn = CONVERTERS[style];
  if (!fn) {
    return result(convertAllCases(input).camel);
  }
  const converted = lines.map((line) => (line.trim() ? fn(line) : line)).join('\n');
  return result(converted, {
    notes: perLine ? ['Each line was converted independently.'] : undefined,
  });
}

export const CASE_EXAMPLE = 'hello world-example';
