/**
 * structured-data.js — JSON <-> YAML, JSON <-> TOML, JSON <-> CSV.
 * Pure functions only; see shared.js for the converter contract.
 */

import { YAML, TOML, CSV } from '../vendor.js';
import {
  ConversionError,
  asConversionError,
  parseJson,
  requireInput,
  stringifyJson,
  normalizeNewlines,
  result,
  singleColumnCaveat,
  headerMode,
  looksLikeHeaderRow,
  generatedColumnNames,
  rowsToRecords,
} from './shared.js';

/* ------------------------------------------------------------------ *
 * JSON <-> YAML
 * ------------------------------------------------------------------ */

export function jsonToYaml(input, options = {}) {
  const value = parseJson(input);
  const indent = clampIndent(options.indent, 2);
  try {
    const output = YAML.stringify(value, {
      indent: indent || 2,
      lineWidth: options.lineWidth === 0 ? -1 : (options.lineWidth ?? 120),
      noRefs: true,
      sortKeys: Boolean(options.sortKeys),
      quotingType: '"',
    });
    return result(normalizeNewlines(output));
  } catch (error) {
    throw asConversionError(error, 'Could not serialize this value as YAML.');
  }
}

export function yamlToJson(input, options = {}) {
  requireInput(input, 'YAML input');
  let value;
  try {
    value = YAML.parse(input);
  } catch (error) {
    const mark = error && error.mark;
    throw new ConversionError('Invalid YAML: ' + (error.reason || error.message), {
      line: mark ? mark.line + 1 : undefined,
      column: mark ? mark.column + 1 : undefined,
      hint: 'YAML is indentation sensitive — tabs are not allowed for indentation.',
    });
  }
  if (value === undefined) {
    throw new ConversionError('The YAML document is empty.');
  }
  const notes = [];
  const cleaned = replaceUnjsonable(value, notes);
  return result(stringifyJson(cleaned, clampIndent(options.indent, 2)), {
    notes: notes.length ? notes : undefined,
  });
}

/* ------------------------------------------------------------------ *
 * JSON <-> TOML
 * ------------------------------------------------------------------ */

export function jsonToToml(input) {
  const value = parseJson(input);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConversionError(
      'TOML documents must have a table (JSON object) at the root.',
      { hint: 'Wrap arrays or scalars in an object, e.g. {"items": [ ... ]}.' },
    );
  }
  const warnings = [];
  const prepared = prepareForToml(value, '', warnings);
  try {
    return result(normalizeNewlines(TOML.stringify(prepared)), {
      warnings: warnings.length ? warnings : undefined,
      notes: ['TOML has no null type; unsupported values are reported instead of being silently dropped.'],
    });
  } catch (error) {
    throw asConversionError(error, 'Could not serialize this value as TOML.');
  }
}

export function tomlToJson(input, options = {}) {
  requireInput(input, 'TOML input');
  let value;
  try {
    value = TOML.parse(input);
  } catch (error) {
    throw new ConversionError('Invalid TOML: ' + error.message, {
      line: error.line,
      column: error.column,
    });
  }
  const notes = [];
  const cleaned = replaceUnjsonable(value, notes);
  return result(stringifyJson(cleaned, clampIndent(options.indent, 2)), {
    notes: notes.length ? notes : undefined,
  });
}

/**
 * TOML cannot represent null. Rather than silently dropping data we remove the
 * key and report exactly which path was affected.
 */
function prepareForToml(value, path, warnings) {
  if (Array.isArray(value)) {
    const kept = [];
    value.forEach((item, index) => {
      const childPath = path + '[' + index + ']';
      if (item === null) {
        warnings.push('Dropped null array element at ' + (childPath || 'root') + ' — TOML has no null type.');
        return;
      }
      kept.push(prepareForToml(item, childPath, warnings));
    });
    return kept;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const childPath = path ? path + '.' + key : key;
      if (item === null) {
        warnings.push('Dropped "' + childPath + '" — TOML has no null type.');
        continue;
      }
      if (typeof item === 'undefined') continue;
      out[key] = prepareForToml(item, childPath, warnings);
    }
    return out;
  }
  return value;
}

/** YAML/TOML can produce Date, undefined, NaN and Infinity — JSON cannot. */
function replaceUnjsonable(value, notes, path = '') {
  if (value instanceof Date) {
    notes.push('Converted date at ' + (path || 'root') + ' to an ISO 8601 string.');
    return value.toISOString();
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    notes.push('Converted non-finite number at ' + (path || 'root') + ' to null.');
    return null;
  }
  if (typeof value === 'bigint') {
    notes.push('Converted big integer at ' + (path || 'root') + ' to a string.');
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => replaceUnjsonable(item, notes, path + '[' + index + ']'));
  }
  if (value && typeof value === 'object') {
    // Values coming out of TOML/YAML may be class instances (e.g. TomlDate).
    if (typeof value.toISOString === 'function') {
      notes.push('Converted date at ' + (path || 'root') + ' to an ISO 8601 string.');
      return value.toISOString();
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'undefined') continue;
      out[key] = replaceUnjsonable(item, notes, path ? path + '.' + key : key);
    }
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * JSON -> CSV
 * ------------------------------------------------------------------ */

const DELIMITERS = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };

export function delimiterFor(name, fallback = ',') {
  return DELIMITERS[name] ?? fallback;
}

export function jsonToCsv(input, options = {}) {
  const value = parseJson(input);
  const rows = Array.isArray(value) ? value : [value];
  if (rows.length === 0) {
    throw new ConversionError('The JSON array is empty — there is nothing to tabulate.');
  }

  const warnings = [];
  const notes = [];
  const flattened = rows.map((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new ConversionError(
        'Row ' + (index + 1) + ' is not an object. CSV output expects an array of flat objects.',
        { hint: 'Example: [{"name":"Ada","age":36}]' },
      );
    }
    return flattenRow(row, warnings);
  });

  // Union of keys, preserving first-seen order, so sparse rows still line up.
  const columns = [];
  const seen = new Set();
  for (const row of flattened) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  const matrix = flattened.map((row) => columns.map((key) => (key in row ? row[key] : '')));
  const csv = CSV.unparse(
    headerMode(options.header) === 'no' ? matrix : { fields: columns, data: matrix },
    {
      delimiter: delimiterFor(options.delimiter, ','),
      newline: '\n',
    },
  );

  if (!Array.isArray(value)) {
    notes.push('Input was a single object, so the CSV has exactly one data row.');
  }
  return result(normalizeNewlines(csv), {
    notes: notes.length ? notes : undefined,
    warnings: dedupe(warnings),
  });
}

/** Nested values become JSON text in a single cell — CSV has no nesting. */
function flattenRow(row, warnings) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      out[key] = '';
    } else if (typeof value === 'object') {
      out[key] = JSON.stringify(value);
      warnings.push('Nested objects and arrays were serialized as JSON text inside their cell.');
    } else {
      out[key] = value;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * CSV -> JSON
 * ------------------------------------------------------------------ */

export function csvToJson(input, options = {}) {
  requireInput(input, 'CSV input');
  const source = normalizeNewlines(stripBom(input));
  const delimiterOption = options.delimiter ?? 'auto';
  const delimiter = delimiterOption === 'auto' ? '' : delimiterFor(delimiterOption, ',');

  const mode = headerMode(options.header);
  const header = mode === 'auto'
    ? looksLikeHeaderRow(CSV.parse(source, {
        header: false, delimiter, dynamicTyping: false, skipEmptyLines: 'greedy', preview: 21,
      }).data)
    : mode === 'yes';

  const parsed = CSV.parse(source, {
    header,
    delimiter,
    dynamicTyping: Boolean(options.dynamicTyping),
    skipEmptyLines: options.skipEmptyLines === false ? false : 'greedy',
    transformHeader: options.trimHeaders === false ? undefined : (h) => h.trim(),
  });

  const undetectable = (parsed.errors || []).filter((e) => e.code === 'UndetectableDelimiter');
  if (undetectable.length && !parsed.data.length) {
    throw new ConversionError('Could not parse CSV: ' + undetectable[0].message, {
      hint: 'Try selecting the delimiter manually instead of "auto".',
    });
  }
  if (!parsed.data.length) {
    throw new ConversionError('No data rows were found in this CSV.');
  }

  const warnings = (parsed.errors || [])
    .filter((e) => e.code !== 'UndetectableDelimiter')
    .map((e) => 'Row ' + (typeof e.row === 'number' ? e.row + 1 : '?') + ': ' + e.message);
  const notes = [];
  const detected = parsed.meta && parsed.meta.delimiter;
  if (detected) notes.push('Delimiter used: ' + describeDelimiter(detected));

  // Bare arrays are hard to work with downstream, so a headerless table gets
  // generated column names instead.
  const width = header ? 0 : parsed.data.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
  const rows = header ? parsed.data : rowsToRecords(parsed.data, generatedColumnNames(width));
  if (!header) notes.push('No header row; columns named column1–column' + width + '.');

  return result(stringifyJson(rows, clampIndent(options.indent, 2)), {
    statusMessage: header
      ? (singleColumnCaveat(parsed.data, detected) ?? undefined)
      : (mode === 'auto'
          ? 'No header row detected. Columns are named column1–column' + width +
            '. Set "Header row" to Yes if the first row does name the columns.'
          : undefined),
    notes,
    warnings: warnings.length ? warnings.slice(0, 20) : undefined,
  });
}

function describeDelimiter(char) {
  if (char === '\t') return 'tab';
  if (char === ',') return 'comma';
  if (char === ';') return 'semicolon';
  if (char === '|') return 'pipe';
  return JSON.stringify(char);
}

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

/** Editors and Excel exports often prefix CSV with a UTF-8 byte order mark. */
function stripBom(text) {
  return String(text).replace(/^﻿/, '');
}

export function clampIndent(value, fallback = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(8, Math.max(0, Math.round(n)));
}

function dedupe(list) {
  if (!list || !list.length) return undefined;
  return [...new Set(list)];
}

/** Pretty-print / minify JSON in place. */
export function formatJson(input, options = {}) {
  const value = parseJson(input);
  if (options.mode === 'minify') return result(JSON.stringify(value));
  return result(stringifyJson(value, clampIndent(options.indent, 2)));
}
