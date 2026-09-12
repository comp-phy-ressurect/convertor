/**
 * shared.js — the contract every converter follows.
 *
 * A converter is a PURE function:
 *
 *   convert(input: string, options: object) => ConversionResult
 *
 * It must not touch the DOM, localStorage, or the network, so that every
 * converter is unit-testable from /tests/ without a browser shell.
 *
 * ConversionResult = {
 *   output: string,            // the text shown in the output pane
 *   notes?: string[],          // neutral information ("nested objects mapped to JSONB")
 *   warnings?: string[],       // things the user should check before trusting output
 *   details?: Array<{label,value}>, // structured extras (JWT claims, URL parts, ...)
 * }
 *
 * Failures throw ConversionError so the UI can render a single, friendly
 * message with optional line/column context.
 */

export class ConversionError extends Error {
  constructor(message, { line, column, hint, cause } = {}) {
    super(message);
    this.name = 'ConversionError';
    this.line = line;
    this.column = column;
    this.hint = hint;
    if (cause) this.cause = cause;
  }
}

/** Normalize an unknown thrown value into a ConversionError. */
export function asConversionError(error, fallbackMessage) {
  if (error instanceof ConversionError) return error;
  const message = error && error.message ? error.message : fallbackMessage;
  return new ConversionError(message || fallbackMessage, { cause: error });
}

/** Throw when input is blank; every converter needs something to work with. */
export function requireInput(input, what = 'input') {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new ConversionError(`No ${what} provided. Paste or upload something first.`);
  }
  return input;
}

/**
 * JSON.parse with a friendly, positioned error message.
 * @returns {unknown}
 */
export function parseJson(text, label = 'JSON') {
  requireInput(text, `${label} input`);
  try {
    return JSON.parse(text);
  } catch (error) {
    const position = /position (\d+)/.exec(error.message);
    let line;
    let column;
    if (position) {
      const offset = Number(position[1]);
      const before = text.slice(0, offset);
      line = before.split('\n').length;
      column = offset - before.lastIndexOf('\n');
    }
    throw new ConversionError(`Invalid ${label}: ${error.message}`, {
      line,
      column,
      hint: 'Check for trailing commas, single quotes, or unquoted keys.',
    });
  }
}

/** Stable pretty-printing used by every JSON-producing converter. */
export function stringifyJson(value, indent = 2) {
  const size = Number(indent);
  const space = Number.isFinite(size) && size > 0 ? size : 0;
  return JSON.stringify(value, null, space);
}

/** Always emit "\n" line endings so output is byte-deterministic. */
export function normalizeNewlines(text) {
  return String(text).replace(/\r\n?/g, '\n');
}

/** Small helper for building a result object. */
export function result(output, extra = {}) {
  return { output, ...extra };
}

const DELIMITER_NAMES = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };

/**
 * A delimited parse that produced exactly one column whose name still holds
 * another delimiter never split the row. Returns a message for the status line,
 * or null when the parse looks sound.
 */
export function singleColumnCaveat(rows, usedDelimiter) {
  const first = Array.isArray(rows) ? rows[0] : null;
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null;

  const keys = Object.keys(first);
  if (keys.length !== 1) return null;

  const stray = Object.keys(DELIMITER_NAMES).find((d) => d !== usedDelimiter && keys[0].includes(d));
  if (!stray) return null;

  return 'Parsed as one column. The header still contains a ' + DELIMITER_NAMES[stray] +
    ' — change the CSV delimiter if the columns are wrong.';
}

/* ------------------------------------------------------------------ *
 * Header-row detection for delimited and tabular input
 * ------------------------------------------------------------------ */

const CELL_NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const CELL_BOOLEAN = /^(true|false|yes|no)$/i;
const CELL_DATE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;

function cellKind(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'empty';
  if (CELL_NUMBER.test(text)) return 'number';
  if (CELL_BOOLEAN.test(text)) return 'boolean';
  if (CELL_DATE.test(text)) return 'date';
  return 'string';
}

/** Normalize the header option, accepting the booleans older presets stored. */
export function headerMode(value) {
  if (value === 'yes' || value === true) return 'yes';
  if (value === 'no' || value === false) return 'no';
  return 'auto';
}

/**
 * Decide whether the first of `rows` (arrays of cells) names the columns.
 *
 * Each column where the remaining rows agree on a non-textual type casts one
 * vote: a first cell of a different type is a name, a matching one is data.
 * Text columns say nothing. A tie, or a file with no typed column at all, falls
 * back to treating a complete row of distinct values as a header — which is
 * what a CSV almost always has.
 */
export function looksLikeHeaderRow(rows) {
  if (!Array.isArray(rows) || !rows.length) return true;
  const first = rows[0];
  if (!Array.isArray(first)) return true;

  const rest = rows.slice(1, 21).filter(Array.isArray);
  if (!rest.length) return headerShaped(first);

  let header = 0;
  let data = 0;
  for (let column = 0; column < first.length; column += 1) {
    const kinds = new Set(rest.map((row) => cellKind(row[column])).filter((k) => k !== 'empty'));
    if (kinds.size !== 1) continue;
    const [kind] = kinds;
    if (kind === 'string') continue;
    if (cellKind(first[column]) === kind) data += 1;
    else header += 1;
  }

  if (header !== data) return header > data;
  return headerShaped(first);
}

function headerShaped(row) {
  const cells = row.map((cell) => String(cell ?? '').trim());
  if (!cells.length || cells.some((cell) => !cell)) return false;
  return new Set(cells).size === cells.length;
}

/** Names for a table read without a header row. */
export function generatedColumnNames(count) {
  return Array.from({ length: count }, (_, i) => 'column' + (i + 1));
}

/** Turn rows of cells into records under `names`, padding short rows. */
export function rowsToRecords(rows, names) {
  return rows.map((row) => {
    const record = {};
    names.forEach((name, i) => { record[name] = row[i] ?? ''; });
    return record;
  });
}
