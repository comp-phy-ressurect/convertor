/**
 * formats.js — the format matrix.
 *
 * Every supported format declares how to `parse` text into a plain JS value and
 * how to `serialize` a plain JS value back to text. Conversion is then simply:
 *
 *     serialize(to, parse(from, text))
 *
 * so N formats give N×N conversions without writing N² converters. The pairwise
 * tools (JSON → YAML and friends) are presets over this same machinery.
 *
 * The cost of going through a common representation is that a format's own
 * quirks have to be surfaced rather than silently absorbed: TOML has no null,
 * CSV has no nesting, XML has no numbers. Each serializer records what it had
 * to do via `warnings`, and `describeConversion()` can describe a pairing before
 * it runs. Both are part of the API and are covered by tests; the current UI
 * deliberately does not print them (see renderStatus in ui.js).
 */

import { YAML, TOML, CSV } from '../vendor.js';
import { ConversionError, parseJson, requireInput, stringifyJson, normalizeNewlines, singleColumnCaveat,
  headerMode, looksLikeHeaderRow, generatedColumnNames, rowsToRecords } from './shared.js';
import { parseXml, buildXmlWithReport, XML_EXAMPLE } from './xml.js';

/* ------------------------------------------------------------------ *
 * Shared examples
 * ------------------------------------------------------------------ */

const RECORDS = [
  { id: 1, name: 'Ada Lovelace', role: 'engineer', active: true },
  { id: 2, name: 'Linus Torvalds', role: 'maintainer', active: false },
];

const EXAMPLES = {
  json: JSON.stringify(RECORDS, null, 2),
  yaml: [
    '- id: 1',
    '  name: Ada Lovelace',
    '  role: engineer',
    '  active: true',
    '- id: 2',
    '  name: Linus Torvalds',
    '  role: maintainer',
    '  active: false',
  ].join('\n'),
  toml: [
    '[[people]]',
    'id = 1',
    'name = "Ada Lovelace"',
    'role = "engineer"',
    'active = true',
    '',
    '[[people]]',
    'id = 2',
    'name = "Linus Torvalds"',
    'role = "maintainer"',
    'active = false',
  ].join('\n'),
  csv: [
    'id,name,role,active',
    '1,Ada Lovelace,engineer,true',
    '2,Linus Torvalds,maintainer,false',
  ].join('\n'),
  tsv: [
    'id\tname\trole\tactive',
    '1\tAda Lovelace\tengineer\ttrue',
    '2\tLinus Torvalds\tmaintainer\tfalse',
  ].join('\n'),
  xml: XML_EXAMPLE,
  html: [
    '<table>',
    '  <thead>',
    '    <tr><th>id</th><th>name</th><th>role</th></tr>',
    '  </thead>',
    '  <tbody>',
    '    <tr><td>1</td><td>Ada Lovelace</td><td>engineer</td></tr>',
    '    <tr><td>2</td><td>Linus Torvalds</td><td>maintainer</td></tr>',
    '  </tbody>',
    '</table>',
  ].join('\n'),
};

/* ------------------------------------------------------------------ *
 * Tabular helpers — used by CSV, TSV and HTML
 * ------------------------------------------------------------------ */

/**
 * Coerce an arbitrary value into rows of flat records.
 * Tabular formats have exactly one shape they can represent, so this is where
 * "your data does not fit a table" gets decided and explained.
 */
function toRows(value, warnings, formatLabel) {
  const rows = Array.isArray(value) ? value : unwrapSingleArray(value) ?? [value];

  if (!rows.length) {
    throw new ConversionError('There are no records to put in a ' + formatLabel + ' table.');
  }

  return rows.map((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new ConversionError(
        formatLabel + ' output needs an array of objects, but record ' + (index + 1) + ' is a ' +
        (row === null ? 'null' : Array.isArray(row) ? 'nested array' : typeof row) + '.',
        { hint: 'Example: [{"id":1,"name":"Ada"}]' },
      );
    }
    const flat = {};
    for (const [key, item] of Object.entries(row)) {
      if (item === null || item === undefined) {
        flat[key] = '';
      } else if (typeof item === 'object') {
        flat[key] = JSON.stringify(item);
        warnings.push('Nested values were written as JSON text inside their cell — ' + formatLabel + ' has no nesting.');
      } else {
        flat[key] = item;
      }
    }
    return flat;
  });
}

/**
 * A document like `{ people: [ ... ] }` is really a table with a wrapper.
 * TOML and XML both produce that shape, so unwrap it rather than making the
 * user restructure their data by hand.
 */
function unwrapSingleArray(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length !== 1) return null;
  const [, only] = entries[0];
  return Array.isArray(only) ? only : null;
}

/** Union of keys across rows, in first-seen order, so sparse rows line up. */
function columnsOf(rows) {
  const columns = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

function parseDelimited(text, delimiter, options) {
  const source = normalizeNewlines(stripBom(text));
  const mode = headerMode(options.header);
  const detected = mode === 'auto' ? detectHeader(source, delimiter, options) : null;
  const hasHeader = mode === 'auto' ? detected : mode === 'yes';

  const parsed = CSV.parse(source, {
    header: hasHeader,
    delimiter,
    dynamicTyping: Boolean(options.dynamicTyping),
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  if (!parsed.data.length) {
    throw new ConversionError('No data rows were found.');
  }
  const errors = (parsed.errors ?? [])
    .filter((e) => e.code !== 'UndetectableDelimiter')
    .map((e) => 'Row ' + (typeof e.row === 'number' ? e.row + 1 : '?') + ': ' + e.message);

  // Without a header the rows are bare arrays, which no tabular output can
  // take: CSV, TSV and HTML all need records. Name the columns instead.
  const named = hasHeader ? parsed.data : nameColumns(parsed.data);

  return {
    value: named,
    warnings: errors.slice(0, 20),
    statusMessage: hasHeader
      ? singleColumnCaveat(parsed.data, parsed.meta?.delimiter)
      : noHeaderCaveat(named, mode),
  };
}

/** Parse just enough rows to judge whether the first one names the columns. */
function detectHeader(source, delimiter, options) {
  const sample = CSV.parse(source, {
    header: false,
    delimiter,
    dynamicTyping: false,
    skipEmptyLines: 'greedy',
    preview: 21,
  });
  return looksLikeHeaderRow(sample.data);
}

function nameColumns(rows) {
  const width = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  return rowsToRecords(rows, generatedColumnNames(width));
}

function noHeaderCaveat(records, mode) {
  if (mode !== 'auto') return null;
  const names = Object.keys(records[0] ?? {});
  if (!names.length) return null;
  const range = names.length === 1 ? names[0] : names[0] + '–' + names[names.length - 1];
  return 'No header row detected. Columns are named ' + range +
    '. Set "Header row" to Yes if the first row does name the columns.';
}

function serializeDelimited(value, delimiter, options) {
  const warnings = [];
  const rows = toRows(value, warnings, delimiter === '\t' ? 'TSV' : 'CSV');
  const columns = columnsOf(rows);
  const matrix = rows.map((row) => columns.map((key) => (key in row ? row[key] : '')));
  const text = CSV.unparse(
    headerMode(options.header) === 'no' ? matrix : { fields: columns, data: matrix },
    { delimiter, newline: '\n' },
  );
  return { text: normalizeNewlines(text), warnings };
}

function stripBom(text) {
  return String(text).replace(/^﻿/, '');
}

/* ------------------------------------------------------------------ *
 * HTML table
 * ------------------------------------------------------------------ */

function serializeHtmlTable(value, options) {
  const warnings = [];
  const rows = toRows(value, warnings, 'HTML table');
  const columns = columnsOf(rows);
  const indent = Number(options.indent) >= 0 ? Number(options.indent) : 2;
  const pad = (level) => ' '.repeat(indent * level);

  const lines = ['<table>'];
  if (headerMode(options.header) !== 'no') {
    lines.push(pad(1) + '<thead>');
    lines.push(pad(2) + '<tr>' + columns.map((c) => '<th>' + escapeHtml(c) + '</th>').join('') + '</tr>');
    lines.push(pad(1) + '</thead>');
  }
  lines.push(pad(1) + '<tbody>');
  for (const row of rows) {
    const cells = columns.map((c) => '<td>' + escapeHtml(row[c] ?? '') + '</td>').join('');
    lines.push(pad(2) + '<tr>' + cells + '</tr>');
  }
  lines.push(pad(1) + '</tbody>', '</table>');

  return { text: lines.join('\n'), warnings };
}

/**
 * Escape for HTML text content.
 *
 * This output is TEXT the user copies elsewhere — DevConvert never injects it
 * into its own DOM (see ui.js, which is textContent-only). Escaping it properly
 * still matters, because the user will paste it into a real page.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Read an HTML table back into records.
 *
 * The XML parser is strict, and real-world HTML is not well-formed XML, so this
 * extracts rows and cells directly instead. It handles the common shape — a
 * `<table>` of `<tr>` with `<th>`/`<td>` — and says so plainly when it cannot.
 */
function parseHtmlTable(text, options) {
  const warnings = [];
  const rowMatches = [...String(text).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];

  if (!rowMatches.length) {
    throw new ConversionError('No <tr> rows were found in this HTML.', {
      hint: 'This reader expects a <table> containing <tr> rows with <th> or <td> cells.',
    });
  }

  const parsedRows = rowMatches.map((match) => {
    const cells = [...match[1].matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t\1\s*>/gi)];
    return {
      cells: cells.map((cell) => decodeHtmlEntities(cell[2].replace(/<[^>]*>/g, '').trim())),
      allTh: cells.length > 0 && cells.every((cell) => cell[1].toLowerCase() === 'h'),
    };
  }).filter((row) => row.cells.length);

  if (!parsedRows.length) {
    throw new ConversionError('The rows in this HTML contain no <td> or <th> cells.');
  }

  const rows = parsedRows.map((row) => row.cells);

  // A table that marks its first row with <th> has told us outright; only a
  // table built entirely from <td> needs the value-shape heuristic.
  const mode = headerMode(options.header);
  const useHeader = mode === 'auto'
    ? (parsedRows[0].allTh || looksLikeHeaderRow(rows))
    : mode === 'yes';
  const header = useHeader ? rows[0] : rows[0].map((_, i) => 'column' + (i + 1));
  const body = useHeader ? rows.slice(1) : rows;

  if (useHeader && !body.length) {
    throw new ConversionError('The table has a header row but no data rows.');
  }

  const records = body.map((cells) => {
    const record = {};
    header.forEach((name, index) => {
      const key = name || 'column' + (index + 1);
      record[key] = options.dynamicTyping ? coerceScalar(cells[index] ?? '') : cells[index] ?? '';
    });
    if (cells.length > header.length) {
      warnings.push('A row had more cells than the header; the extra cells were dropped.');
    }
    return record;
  });

  warnings.push('HTML was read with a table-shaped reader: attributes, nested markup and styling are discarded.');
  return { value: records, warnings: [...new Set(warnings)] };
}

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeHtmlEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function coerceScalar(text) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === '') return '';
  // Only convert when the round trip is exact, so "007" and "1e999" stay text.
  const number = Number(text);
  return Number.isFinite(number) && String(number) === text ? number : text;
}

/* ------------------------------------------------------------------ *
 * The format registry
 * ------------------------------------------------------------------ */

/**
 * Each entry:
 *   parse(text, options)     -> { value, warnings? }
 *   serialize(value, options)-> { text, warnings? }
 *   tabular: true            -> can only represent an array of flat records
 *   rootMustBeObject: true   -> cannot represent a bare array or scalar at the root
 */
export const FORMATS = Object.freeze({
  json: {
    id: 'json',
    label: 'JSON',
    extension: '.json',
    mime: 'application/json',
    example: EXAMPLES.json,
    accept: '.json,.txt',
    parse: (text) => ({ value: parseJson(text) }),
    serialize: (value, options) => ({ text: stringifyJson(value, indentOf(options)) }),
  },

  yaml: {
    id: 'yaml',
    label: 'YAML',
    extension: '.yaml',
    mime: 'application/yaml',
    example: EXAMPLES.yaml,
    accept: '.yaml,.yml,.txt',
    parse: (text) => {
      requireInput(text, 'YAML input');
      try {
        const value = YAML.parse(text);
        if (value === undefined) throw new ConversionError('The YAML document is empty.');
        return { value };
      } catch (error) {
        if (error instanceof ConversionError) throw error;
        const mark = error?.mark;
        throw new ConversionError('Invalid YAML: ' + (error.reason || error.message), {
          line: mark ? mark.line + 1 : undefined,
          column: mark ? mark.column + 1 : undefined,
          hint: 'YAML is indentation sensitive — tabs are not allowed for indentation.',
        });
      }
    },
    serialize: (value, options) => ({
      text: normalizeNewlines(YAML.stringify(value, {
        indent: indentOf(options) || 2,
        lineWidth: options.lineWidth === 0 ? -1 : (options.lineWidth ?? 120),
        noRefs: true,
        sortKeys: Boolean(options.sortKeys),
        quotingType: '"',
      })),
    }),
  },

  toml: {
    id: 'toml',
    label: 'TOML',
    extension: '.toml',
    mime: 'application/toml',
    example: EXAMPLES.toml,
    accept: '.toml,.txt',
    rootMustBeObject: true,
    parse: (text) => {
      requireInput(text, 'TOML input');
      try {
        return { value: TOML.parse(text) };
      } catch (error) {
        throw new ConversionError('Invalid TOML: ' + error.message, {
          line: error.line,
          column: error.column,
        });
      }
    },
    serialize: (value, options) => {
      const warnings = [];
      let root = value;

      // TOML's root must be a table. Wrapping an array is friendlier than
      // refusing outright, and the wrapper key is reported, not hidden.
      if (Array.isArray(root)) {
        const key = options.arrayKey || 'items';
        root = { [key]: root };
        warnings.push('TOML cannot have an array at the root, so the records were wrapped in a "' + key + '" table.');
      } else if (root === null || typeof root !== 'object') {
        throw new ConversionError('TOML needs a table at the root; this value is a ' + (root === null ? 'null' : typeof root) + '.');
      }

      const prepared = stripNulls(root, '', warnings);
      try {
        return { text: normalizeNewlines(TOML.stringify(prepared)), warnings };
      } catch (error) {
        throw new ConversionError('Could not write this value as TOML: ' + error.message);
      }
    },
  },

  csv: {
    id: 'csv',
    label: 'CSV',
    extension: '.csv',
    mime: 'text/csv',
    example: EXAMPLES.csv,
    accept: '.csv,.txt',
    tabular: true,
    parse: (text, options) => {
      requireInput(text, 'CSV input');
      const delimiter = options.delimiter && options.delimiter !== 'auto'
        ? DELIMITERS[options.delimiter] ?? ','
        : '';
      return parseDelimited(text, delimiter, options);
    },
    serialize: (value, options) => serializeDelimited(value, DELIMITERS[options.delimiter] ?? ',', options),
  },

  tsv: {
    id: 'tsv',
    label: 'TSV',
    extension: '.tsv',
    mime: 'text/tab-separated-values',
    example: EXAMPLES.tsv,
    accept: '.tsv,.txt',
    tabular: true,
    parse: (text, options) => {
      requireInput(text, 'TSV input');
      return parseDelimited(text, '\t', options);
    },
    serialize: (value, options) => serializeDelimited(value, '\t', options),
  },

  xml: {
    id: 'xml',
    label: 'XML',
    extension: '.xml',
    mime: 'application/xml',
    example: EXAMPLES.xml,
    accept: '.xml,.txt',
    parse: (text, options) => {
      const parsed = parseXml(text, options);
      // Keep the root element name so a round trip can restore it.
      return {
        value: parsed.rootName ? { [parsed.rootName]: parsed.value } : parsed.value,
        warnings: parsed.warnings,
      };
    },
    serialize: (value, options) => {
      // `{ user: {...} }` should become `<user>…</user>`, not `<user><user>…`.
      // When the single top-level key supplies the element name, that key is
      // consumed rather than emitted again as a child.
      const implied = impliedRootName(value);
      const useImplied = !options.rootName && implied !== null;
      const report = buildXmlWithReport(useImplied ? value[implied] : value, {
        rootName: options.rootName || implied || 'root',
        indent: indentOf(options),
        declaration: options.declaration !== false,
      });
      return { text: report.xml, warnings: report.warnings };
    },
  },

  html: {
    id: 'html',
    label: 'HTML table',
    extension: '.html',
    mime: 'text/html',
    example: EXAMPLES.html,
    accept: '.html,.htm,.txt',
    tabular: true,
    parse: (text, options) => {
      requireInput(text, 'HTML input');
      return parseHtmlTable(text, options);
    },
    serialize: (value, options) => serializeHtmlTable(value, options),
  },
});

export const FORMAT_IDS = Object.keys(FORMATS);

const DELIMITERS = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };

function indentOf(options) {
  const n = Number(options?.indent);
  if (!Number.isFinite(n)) return 2;
  return Math.min(8, Math.max(0, Math.round(n)));
}

/** When a value is `{ people: [...] }`, "people" is the natural element name. */
function impliedRootName(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  return keys.length === 1 && !keys[0].startsWith('@') && keys[0] !== '#text' ? keys[0] : null;
}

/** TOML has no null. Report every removal instead of quietly losing data. */
function stripNulls(value, path, warnings) {
  if (Array.isArray(value)) {
    const kept = [];
    value.forEach((item, index) => {
      if (item === null) {
        warnings.push('Dropped a null element at ' + path + '[' + index + '] — TOML has no null type.');
        return;
      }
      kept.push(stripNulls(item, path + '[' + index + ']', warnings));
    });
    return kept;
  }
  if (value && typeof value === 'object') {
    if (typeof value.toISOString === 'function') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const childPath = path ? path + '.' + key : key;
      if (item === null) {
        warnings.push('Dropped "' + childPath + '" — TOML has no null type.');
        continue;
      }
      if (item === undefined) continue;
      out[key] = stripNulls(item, childPath, warnings);
    }
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function getFormat(id) {
  const format = FORMATS[id];
  if (!format) {
    throw new ConversionError('Unknown format "' + id + '".', {
      hint: 'Supported formats: ' + FORMAT_IDS.join(', ') + '.',
    });
  }
  return format;
}

export function formatChoices() {
  return FORMAT_IDS.map((id) => ({ value: id, label: FORMATS[id].label }));
}

/**
 * Convert text from one format to another.
 * @returns {{ output: string, notes?: string[], warnings?: string[] }}
 */
export function convertFormat(input, options = {}) {
  const from = getFormat(options.from ?? 'json');
  const to = getFormat(options.to ?? 'yaml');
  requireInput(input, from.label + ' input');

  const parsed = from.parse(input, options);
  const serialized = to.serialize(parsed.value, options);

  const notes = [];
  const warnings = [...(parsed.warnings ?? []), ...(serialized.warnings ?? [])];

  if (from.id === to.id) {
    notes.push('Input and output are both ' + from.label + ', so this reformatted the document in place.');
  } else {
    notes.push(from.label + ' → ' + to.label + ', via a common in-memory representation.');
  }
  // Type fidelity is the surprise people hit most often, so say it up front.
  if (LOSES_TYPES.has(from.id) && !options.dynamicTyping) {
    notes.push(from.label + ' has no types of its own, so every value is a string. Enable type conversion to infer numbers and booleans.');
  }

  return {
    output: serialized.text,
    notes,
    warnings: warnings.length ? [...new Set(warnings)] : undefined,
    statusMessage: parsed.statusMessage ?? undefined,
  };
}

const LOSES_TYPES = new Set(['csv', 'tsv', 'xml', 'html']);

/**
 * Structural caveats for a format pairing, describable without running the
 * conversion. Exposed for callers that want to warn up front; the current UI
 * does not display them.
 */
export function describeConversion(fromId, toId) {
  const from = FORMATS[fromId];
  const to = FORMATS[toId];
  if (!from || !to) return [];

  const notes = [];
  if (to.tabular && !from.tabular) {
    notes.push(to.label + ' is a table, so this needs an array of flat records. Nested values become JSON text in a cell.');
  }
  if (to.rootMustBeObject && from.tabular) {
    notes.push(to.label + ' needs an object at the root, so the rows will be wrapped in a named table.');
  }
  if (LOSES_TYPES.has(from.id) && !LOSES_TYPES.has(to.id)) {
    notes.push(from.label + ' carries no type information — numbers and booleans arrive as strings unless you enable type conversion.');
  }
  if (from.id === to.id) {
    notes.push('Same format in and out: this validates and reformats the document.');
  }
  return notes;
}

export { EXAMPLES as FORMAT_EXAMPLES };
