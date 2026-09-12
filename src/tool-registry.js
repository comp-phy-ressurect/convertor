/**
 * tool-registry.js — the single source of truth for every tool.
 *
 * Each entry carries everything both the SPA and the static SEO pages need:
 * identity, copy, an options schema, an example, a download extension, and the
 * pure `run` function. The UI renders itself entirely from this data, so adding
 * a converter never means editing ui.js.
 *
 * Adding a tool:
 *   1. write the pure function in src/converters/
 *   2. add an entry here
 *   3. add a case to tests/tests.js
 *   4. create the SEO shell (node scripts/build-seo.mjs regenerates them all)
 */

import { formatJson } from './converters/structured-data.js';
import {
  jsonToTypeScript, jsonToZod, jsonToPython, jsonToGo,
  jsonToSql, jsonToJsonSchema,
} from './converters/codegen.js';
import {
  base64Encode, base64Decode, urlEncode, urlDecode, inspectUrl,
  decodeJwt, JWT_DISCLAIMER, JWT_EXAMPLE, detectUrlAction,
} from './converters/encoding.js';
import { convertTimestamp, generateIds, COMMON_TIME_ZONES } from './converters/time-id.js';
import { convertCase, CASE_STYLES, CASE_EXAMPLE } from './converters/text.js';
import { hashInput, HASH_ALGORITHMS } from './converters/hashing.js';
import { curlToCode, CURL_EXAMPLE } from './converters/curl.js';
import { computeDiff, diffToUnifiedText, DIFF_EXAMPLE } from './converters/diff.js';
import { REGEX_EXAMPLE, describeFlags } from './converters/regex.js';
import { runRegexInWorker } from './workers/regex-client.js';
import { convertFormat, FORMATS, FORMAT_EXAMPLES } from './converters/formats.js';
import { result } from './converters/shared.js';

/* ------------------------------------------------------------------ *
 * Shared example payloads
 * ------------------------------------------------------------------ */

const JSON_OBJECT_EXAMPLE = JSON.stringify(
  {
    id: 1,
    name: 'Ada Lovelace',
    active: true,
    score: 99.5,
    roles: ['admin', 'engineer'],
    address: { city: 'London', postcode: 'NW1 4RY' },
    lastSeen: null,
  },
  null,
  2,
);

const JSON_ROWS_EXAMPLE = JSON.stringify(
  [
    { id: 1, name: 'Ada Lovelace', age: 36, active: true },
    { id: 2, name: 'Linus Torvalds', age: 55, active: false },
  ],
  null,
  2,
);

const YAML_EXAMPLE = [
  'name: Ada Lovelace',
  'active: true',
  'roles:',
  '  - admin',
  '  - engineer',
  'address:',
  '  city: London',
  '  postcode: NW1 4RY',
].join('\n');

const TOML_EXAMPLE = [
  'title = "DevConvert"',
  'active = true',
  '',
  '[owner]',
  'name = "Ada Lovelace"',
  'joined = 2024-05-01',
  '',
  '[[servers]]',
  'host = "alpha.example.com"',
  'port = 8080',
].join('\n');

const CSV_EXAMPLE = ['name,age,active', 'Ada,36,true', 'Linus,55,false'].join('\n');

/* ------------------------------------------------------------------ *
 * Reusable option fragments
 * ------------------------------------------------------------------ */

const INDENT_OPTION = {
  id: 'indent',
  label: 'JSON indentation',
  type: 'select',
  default: '2',
  choices: [
    { value: '2', label: '2 spaces' },
    { value: '4', label: '4 spaces' },
    { value: '0', label: 'Minified' },
  ],
  parse: Number,
};

const DELIMITER_CHOICES = [
  { value: 'comma', label: 'Comma ,' },
  { value: 'semicolon', label: 'Semicolon ;' },
  { value: 'tab', label: 'Tab' },
  { value: 'pipe', label: 'Pipe |' },
];

const ROOT_NAME_OPTION = (defaultValue, label) => ({
  id: 'rootName',
  label,
  type: 'text',
  default: defaultValue,
  placeholder: defaultValue,
});

/* ------------------------------------------------------------------ *
 * Tool definitions
 * ------------------------------------------------------------------ */

/**
 * Options shared by every format-matrix tool. They apply to whichever formats
 * are selected, so the panel does not change shape as you switch formats.
 */
const MATRIX_OPTIONS = [
  {
    id: 'indent',
    label: 'Indentation',
    type: 'select',
    default: '2',
    choices: [
      { value: '2', label: '2 spaces' },
      { value: '4', label: '4 spaces' },
      { value: '0', label: 'Compact' },
    ],
    parse: Number,
    appliesTo: { to: ['json', 'yaml', 'xml', 'html'] },
  },
  {
    id: 'delimiter',
    label: 'CSV delimiter',
    type: 'select',
    default: 'auto',
    choices: [{ value: 'auto', label: 'Auto-detect (reading)' }, ...DELIMITER_CHOICES],
    appliesTo: { either: ['csv'] },
  },
  {
    id: 'header',
    label: 'Header row',
    type: 'select',
    default: 'auto',
    choices: [
      { value: 'auto', label: 'Auto-detect' },
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
    // Presets and history saved before this was a three-way choice hold booleans.
    parse: (value) => (value === true ? 'yes' : value === false ? 'no' : value),
    appliesTo: { either: ['csv', 'tsv', 'html'] },
  },
  {
    id: 'dynamicTyping',
    label: 'Infer numbers and booleans',
    type: 'checkbox',
    default: false,
    appliesTo: { from: ['csv', 'tsv', 'xml', 'html'] },
  },
  {
    id: 'rootName',
    label: 'XML root element',
    type: 'text',
    default: '',
    placeholder: 'auto',
    appliesTo: { to: ['xml'] },
  },
  {
    id: 'sortKeys',
    label: 'Sort keys alphabetically',
    type: 'checkbox',
    default: false,
    appliesTo: { to: ['yaml'] },
  },
];

/**
 * Every format-matrix tool runs the same conversion. The pairwise tools below
 * are presets over this: they only differ in which formats start selected and
 * in the copy their landing page carries.
 */
const runMatrix = ({ input, options, formats }) =>
  convertFormat(input, { ...options, ...(formats ?? {}) });

/** @type {Array<object>} */
const TOOLS = [
  /* ---------------- Structured data ---------------- */
  {
    id: 'format-converter',
    slug: 'convert',
    label: 'Convert any format',
    category: 'Structured data',
    description: 'Pick an input format and an output format and convert between any pair.',
    seoTitle: 'Convert JSON, YAML, TOML, CSV, XML and HTML',
    metaDescription:
      'Convert between JSON, YAML, TOML, CSV, TSV, XML and HTML tables in your browser. Pick any input and output format — nothing is uploaded.',
    keywords: ['convert', 'json', 'yaml', 'toml', 'csv', 'tsv', 'xml', 'html', 'format'],
    input: { label: 'Input', language: 'json', example: FORMAT_EXAMPLES.json, accept: '.json,.yaml,.yml,.toml,.csv,.tsv,.xml,.html,.txt' },
    output: { label: 'Output', extension: '.txt', language: 'text' },
    formats: { from: 'json', to: 'yaml' },
    // Marks this as the catch-all: it accepts every pair, so it must never win
    // the lookup for a pair that has its own dedicated page.
    universal: true,
    streamsFiles: true,
    options: MATRIX_OPTIONS,
    run: runMatrix,
  },
  {
    id: 'json-to-yaml',
    slug: 'json-to-yaml',
    label: 'JSON → YAML',
    category: 'Structured data',
    description: 'Convert JSON to readable YAML with configurable indentation.',
    seoTitle: 'JSON to YAML Converter — Local & Private',
    metaDescription:
      'Convert JSON to YAML in your browser. No upload, no signup, no tracking — the conversion runs on your own device.',
    keywords: ['json', 'yaml', 'convert', 'yml'],
    input: { label: 'JSON', language: 'json', example: JSON_OBJECT_EXAMPLE, accept: '.json,.txt' },
    output: { label: 'YAML', extension: '.yaml', language: 'yaml' },
    swap: 'yaml-to-json',
    formats: { from: 'json', to: 'yaml' },
    options: MATRIX_OPTIONS,
    run: runMatrix,
  },
  {
    id: 'yaml-to-json',
    slug: 'yaml-to-json',
    label: 'YAML → JSON',
    category: 'Structured data',
    description: 'Parse YAML and emit pretty-printed JSON.',
    seoTitle: 'YAML to JSON Converter — Local & Private',
    metaDescription:
      'Convert YAML to JSON in your browser with full error reporting. Your document never leaves your device.',
    keywords: ['yaml', 'json', 'yml', 'parse'],
    input: { label: 'YAML', language: 'yaml', example: YAML_EXAMPLE, accept: '.yaml,.yml,.txt' },
    output: { label: 'JSON', extension: '.json', language: 'json' },
    swap: 'json-to-yaml',
    formats: { from: 'yaml', to: 'json' },
    options: MATRIX_OPTIONS,
    run: runMatrix,
  },
  {
    id: 'json-to-toml',
    slug: 'json-to-toml',
    label: 'JSON → TOML',
    category: 'Structured data',
    description: 'Convert a JSON object to TOML.',
    seoTitle: 'JSON to TOML Converter — Local & Private',
    metaDescription:
      'Convert JSON to TOML in your browser. TOML has no null type, so null values are dropped — see the notes below.',
    keywords: ['json', 'toml', 'config'],
    input: { label: 'JSON', language: 'json', example: JSON.stringify({ title: 'DevConvert', active: true, owner: { name: 'Ada Lovelace' }, ports: [8080, 8443] }, null, 2), accept: '.json,.txt' },
    output: { label: 'TOML', extension: '.toml', language: 'toml' },
    swap: 'toml-to-json',
    formats: { from: 'json', to: 'toml' },
    options: MATRIX_OPTIONS,
    run: runMatrix,
  },
  {
    id: 'toml-to-json',
    slug: 'toml-to-json',
    label: 'TOML → JSON',
    category: 'Structured data',
    description: 'Parse TOML configuration into JSON.',
    seoTitle: 'TOML to JSON Converter — Local & Private',
    metaDescription:
      'Convert TOML config files to JSON in your browser. Dates become ISO 8601 strings; nothing is uploaded.',
    keywords: ['toml', 'json', 'config', 'cargo'],
    input: { label: 'TOML', language: 'toml', example: TOML_EXAMPLE, accept: '.toml,.txt' },
    output: { label: 'JSON', extension: '.json', language: 'json' },
    swap: 'json-to-toml',
    formats: { from: 'toml', to: 'json' },
    options: MATRIX_OPTIONS,
    run: runMatrix,
  },
  {
    id: 'json-to-csv',
    slug: 'json-to-csv',
    label: 'JSON → CSV',
    category: 'Structured data',
    description: 'Turn an array of objects into a CSV table.',
    seoTitle: 'JSON to CSV Converter — Local & Private',
    metaDescription:
      'Convert a JSON array of objects to CSV with a configurable delimiter. Runs locally in your browser.',
    keywords: ['json', 'csv', 'excel', 'table'],
    input: { label: 'JSON array', language: 'json', example: JSON_ROWS_EXAMPLE, accept: '.json,.txt' },
    output: { label: 'CSV', extension: '.csv', language: 'csv' },
    swap: 'csv-to-json',
    formats: { from: 'json', to: 'csv' },
    options: MATRIX_OPTIONS,
    run: runMatrix,
  },
  {
    id: 'csv-to-json',
    slug: 'csv-to-json',
    label: 'CSV → JSON',
    category: 'Structured data',
    description: 'Parse CSV or TSV into JSON, with delimiter detection and optional type coercion.',
    seoTitle: 'CSV to JSON Converter — Local & Private',
    metaDescription:
      'Convert CSV or TSV to JSON in your browser, with automatic delimiter detection.',
    keywords: ['csv', 'json', 'tsv', 'parse'],
    input: { label: 'CSV', language: 'csv', example: CSV_EXAMPLE, accept: '.csv,.tsv,.txt' },
    // Files above 2 MiB are streamed through Papa Parse's own worker.
    streamsFiles: true,
    output: { label: 'JSON', extension: '.json', language: 'json' },
    swap: 'json-to-csv',
    formats: { from: 'csv', to: 'json' },
    options: MATRIX_OPTIONS,
    run: runMatrix,
  },
  {
    id: 'json-formatter',
    slug: 'json-formatter',
    label: 'JSON Formatter',
    category: 'Structured data',
    description: 'Pretty-print or minify JSON and validate it in one step.',
    seoTitle: 'JSON Formatter and Validator — Local & Private',
    metaDescription:
      'Format, minify and validate JSON in your browser. Errors report the exact line and column.',
    keywords: ['json', 'format', 'pretty', 'minify', 'validate'],
    input: { label: 'JSON', language: 'json', example: '{"name":"Ada","roles":["admin","engineer"],"active":true}', accept: '.json,.txt' },
    output: { label: 'JSON', extension: '.json', language: 'json' },
    options: [
      { id: 'mode', label: 'Mode', type: 'select', default: 'pretty', choices: [{ value: 'pretty', label: 'Pretty-print' }, { value: 'minify', label: 'Minify' }] },
      INDENT_OPTION,
    ],
    run: ({ input, options }) => formatJson(input, options),
  },

  /* ---------------- Code generation ---------------- */
  {
    id: 'json-to-typescript',
    slug: 'json-to-typescript',
    label: 'JSON → TypeScript',
    category: 'Code generation',
    description: 'Generate TypeScript interfaces or types from a JSON sample.',
    seoTitle: 'JSON to TypeScript Interface Generator',
    metaDescription:
      'Generate TypeScript interfaces from JSON in your browser. Handles nested objects, arrays and nullable fields.',
    keywords: ['json', 'typescript', 'interface', 'types', 'codegen'],
    input: { label: 'JSON sample', language: 'json', example: JSON_OBJECT_EXAMPLE, accept: '.json,.txt' },
    output: { label: 'TypeScript', extension: '.ts', language: 'typescript' },
    options: [
      ROOT_NAME_OPTION('Root', 'Root type name'),
      { id: 'style', label: 'Declaration style', type: 'select', default: 'interface', choices: [{ value: 'interface', label: 'interface' }, { value: 'type', label: 'type alias' }] },
      { id: 'unknownType', label: 'Fallback for unknown values', type: 'select', default: 'unknown', choices: [{ value: 'unknown', label: 'unknown' }, { value: 'any', label: 'any' }] },
    ],
    run: ({ input, options }) => jsonToTypeScript(input, options),
  },
  {
    id: 'json-to-zod',
    slug: 'json-to-zod',
    label: 'JSON → Zod',
    category: 'Code generation',
    description: 'Generate a Zod schema from a JSON sample.',
    seoTitle: 'JSON to Zod Schema Generator — Local & Private',
    metaDescription:
      'Generate Zod validation schemas from JSON in your browser. The generated code is text and is never executed.',
    keywords: ['json', 'zod', 'schema', 'validation', 'typescript'],
    input: { label: 'JSON sample', language: 'json', example: JSON_OBJECT_EXAMPLE, accept: '.json,.txt' },
    output: { label: 'Zod schema', extension: '.ts', language: 'typescript' },
    options: [
      ROOT_NAME_OPTION('RootSchema', 'Root schema name'),
      { id: 'includeImport', label: 'Include import statement', type: 'checkbox', default: true },
      { id: 'inferType', label: 'Export z.infer type', type: 'checkbox', default: true },
      { id: 'intAsInt', label: 'Use .int() for whole numbers', type: 'checkbox', default: true },
    ],
    run: ({ input, options }) => jsonToZod(input, options),
  },
  {
    id: 'json-to-python',
    slug: 'json-to-python',
    label: 'JSON → Python',
    category: 'Code generation',
    description: 'Generate Python dataclasses from a JSON sample.',
    seoTitle: 'JSON to Python Dataclass Generator',
    metaDescription:
      'Generate Python dataclasses from JSON in your browser, with list[], dict[] and Optional[] type hints.',
    keywords: ['json', 'python', 'dataclass', 'typing', 'codegen'],
    input: { label: 'JSON sample', language: 'json', example: JSON_OBJECT_EXAMPLE, accept: '.json,.txt' },
    output: { label: 'Python', extension: '.py', language: 'python' },
    options: [ROOT_NAME_OPTION('Root', 'Root class name')],
    run: ({ input, options }) => jsonToPython(input, options),
  },
  {
    id: 'json-to-go',
    slug: 'json-to-go',
    label: 'JSON → Go',
    category: 'Code generation',
    description: 'Generate Go structs with json tags from a JSON sample.',
    seoTitle: 'JSON to Go Struct Generator — Local & Private',
    metaDescription:
      'Generate Go structs with json field tags from JSON in your browser. Nested objects become nested structs.',
    keywords: ['json', 'go', 'golang', 'struct', 'codegen'],
    input: { label: 'JSON sample', language: 'json', example: JSON_OBJECT_EXAMPLE, accept: '.json,.txt' },
    output: { label: 'Go', extension: '.go', language: 'go' },
    options: [
      ROOT_NAME_OPTION('Root', 'Root struct name'),
      { id: 'packageName', label: 'Package name', type: 'text', default: 'main', placeholder: 'main' },
      { id: 'includePackage', label: 'Include package clause', type: 'checkbox', default: true },
      { id: 'omitempty', label: 'Add omitempty to optional fields', type: 'checkbox', default: true },
    ],
    run: ({ input, options }) => jsonToGo(input, options),
  },
  {
    id: 'json-to-sql',
    slug: 'json-to-sql',
    label: 'JSON → SQL',
    category: 'Code generation',
    description: 'Generate a CREATE TABLE statement from flat JSON rows.',
    seoTitle: 'JSON to SQL CREATE TABLE Generator',
    metaDescription:
      'Generate PostgreSQL or SQLite CREATE TABLE statements from JSON in your browser. Nothing is executed or uploaded.',
    keywords: ['json', 'sql', 'create table', 'postgres', 'sqlite', 'schema'],
    input: { label: 'JSON rows', language: 'json', example: JSON_ROWS_EXAMPLE, accept: '.json,.txt' },
    output: { label: 'SQL', extension: '.sql', language: 'sql' },
    options: [
      { id: 'tableName', label: 'Table name', type: 'text', default: 'my_table', placeholder: 'my_table' },
      { id: 'dialect', label: 'Dialect', type: 'select', default: 'postgres', choices: [{ value: 'postgres', label: 'PostgreSQL' }, { value: 'sqlite', label: 'SQLite' }] },
      { id: 'primaryKey', label: 'Primary key column', type: 'text', default: '', placeholder: 'auto: "id" if present' },
    ],
    run: ({ input, options }) => jsonToSql(input, options),
  },
  {
    id: 'json-to-json-schema',
    slug: 'json-to-json-schema',
    label: 'JSON → JSON Schema',
    category: 'Code generation',
    description: 'Infer a JSON Schema from a sample document.',
    seoTitle: 'JSON to JSON Schema Generator — Local & Private',
    metaDescription:
      'Generate a draft-07 or 2020-12 JSON Schema from a JSON sample, entirely in your browser.',
    keywords: ['json', 'json schema', 'draft-07', 'validation'],
    input: { label: 'JSON sample', language: 'json', example: JSON_OBJECT_EXAMPLE, accept: '.json,.txt' },
    output: { label: 'JSON Schema', extension: '.json', language: 'json' },
    options: [
      { id: 'draft', label: 'Draft', type: 'select', default: 'draft-07', choices: [{ value: 'draft-07', label: 'draft-07' }, { value: '2020-12', label: '2020-12' }] },
      { id: 'title', label: 'Schema title', type: 'text', default: '', placeholder: 'optional' },
      { id: 'additionalProperties', label: 'Forbid additional properties', type: 'checkbox', default: false, parse: (v) => (v ? false : undefined), rawValue: true },
    ],
    run: ({ input, options }) => jsonToJsonSchema(input, {
      ...options,
      additionalProperties: options.additionalProperties ? false : undefined,
    }),
  },

  /* ---------------- Encoding & tokens ---------------- */
  {
    id: 'jwt-decoder',
    slug: 'jwt-decoder',
    label: 'JWT Decoder',
    category: 'Encoding & tokens',
    description: 'Decode a JSON Web Token header and payload locally. Signatures are not verified.',
    seoTitle: 'JWT Decoder — Decoded Locally, Never Uploaded',
    metaDescription:
      'Decode JWT header and payload in your browser. Your token is never sent anywhere and no JWKS is fetched.',
    keywords: ['jwt', 'decode', 'token', 'bearer', 'claims'],
    input: { label: 'JWT', language: 'text', example: JWT_EXAMPLE, accept: '.txt,.jwt' },
    output: { label: 'Decoded token', extension: '.json', language: 'json' },
    banner: {
      level: 'warning',
      text: JWT_DISCLAIMER + '',
    },
    options: [INDENT_OPTION],
    run: ({ input, options }) => decodeJwt(input, options),
  },
  {
    id: 'base64-encoder-decoder',
    slug: 'base64-encoder-decoder',
    label: 'Base64 Encode / Decode',
    category: 'Encoding & tokens',
    description: 'Encode and decode Base64 and Base64URL with correct UTF-8 handling.',
    seoTitle: 'Base64 Encoder and Decoder — UTF-8 Safe, Local',
    metaDescription:
      'Encode and decode Base64 and Base64URL in your browser with proper UTF-8 support for emoji and accents.',
    keywords: ['base64', 'base64url', 'encode', 'decode', 'utf-8'],
    input: { label: 'Input', language: 'text', example: 'hello ✓', accept: '.txt' },
    output: { label: 'Output', extension: '.txt', language: 'text' },
    options: [
      { id: 'direction', label: 'Direction', type: 'select', default: 'encode', choices: [{ value: 'encode', label: 'Encode' }, { value: 'decode', label: 'Decode' }] },
      { id: 'variant', label: 'Alphabet', type: 'select', default: 'standard', choices: [{ value: 'standard', label: 'Standard (+ /)' }, { value: 'url', label: 'Base64URL (- _)' }] },
      { id: 'padding', label: 'Keep "=" padding when encoding', type: 'checkbox', default: true },
    ],
    run: ({ input, options }) =>
      (options.direction === 'decode' ? base64Decode : base64Encode)(input, options),
  },
  {
    id: 'url-encoder-decoder',
    slug: 'url-encoder-decoder',
    label: 'URL Encode / Decode',
    category: 'Encoding & tokens',
    description: 'Percent-encode or decode text, or break a full URL into its parts.',
    seoTitle: 'URL Encoder, Decoder and Parser — Local & Private',
    metaDescription:
      'Percent-encode and decode URLs in your browser, or inspect protocol, host, path, query parameters and hash.',
    keywords: ['url', 'encode', 'decode', 'percent', 'query string', 'uri'],
    input: { label: 'Input', language: 'text', example: 'https://example.com/search?q=hello world&lang=en#results', accept: '.txt' },
    output: { label: 'Output', extension: '.txt', language: 'text' },
    options: [
      { id: 'action', label: 'Action', type: 'select', default: 'auto', choices: [{ value: 'auto', label: 'Auto-detect' }, { value: 'inspect', label: 'Inspect URL' }, { value: 'encode', label: 'Encode' }, { value: 'decode', label: 'Decode' }] },
      { id: 'mode', label: 'Scope', type: 'select', default: 'component', choices: [{ value: 'component', label: 'Component (encodeURIComponent)' }, { value: 'full', label: 'Whole URL (encodeURI)' }] },
      { id: 'plusAsSpace', label: 'Treat "+" as a space when decoding', type: 'checkbox', default: false },
    ],
    run: ({ input, options }) => {
      const auto = !options.action || options.action === 'auto';
      const action = auto ? detectUrlAction(input) : options.action;
      const outcome = action === 'encode' ? urlEncode(input, options)
        : action === 'decode' ? urlDecode(input, options)
        : inspectUrl(input, options);
      return auto
        ? { ...outcome, statusMessage: 'Auto-detected: ' + action + '. Set Action to override.', statusLevel: 'info' }
        : outcome;
    },
  },
  {
    id: 'curl-to-code',
    slug: 'curl-to-code',
    label: 'cURL → code',
    category: 'Encoding & tokens',
    description: 'Translate a cURL command into fetch, axios or Python requests code.',
    seoTitle: 'cURL to fetch, axios and Python requests',
    metaDescription:
      'Convert a cURL command to JavaScript fetch, axios or Python requests code. The request is never executed.',
    keywords: ['curl', 'fetch', 'axios', 'python', 'requests', 'http'],
    input: { label: 'cURL command', language: 'shell', example: CURL_EXAMPLE, accept: '.txt,.sh' },
    output: { label: 'Generated code', extension: '.js', language: 'javascript' },
    banner: { level: 'info', text: 'The command is parsed as text. DevConvert never executes it and never sends the request.' },
    options: [
      { id: 'target', label: 'Target', type: 'select', default: 'fetch', choices: [{ value: 'fetch', label: 'JavaScript fetch()' }, { value: 'axios', label: 'axios' }, { value: 'python', label: 'Python requests' }] },
    ],
    extensionFor: (options) => (options.target === 'python' ? '.py' : '.js'),
    run: ({ input, options }) => curlToCode(input, options),
  },
  {
    id: 'hash-generator',
    slug: 'hash-generator',
    label: 'Hash Generator',
    category: 'Encoding & tokens',
    description: 'Compute SHA-256, SHA-384, SHA-512, SHA-1 and MD5 digests of text or a file.',
    seoTitle: 'SHA-256 and MD5 Hash Generator — Local & Private',
    metaDescription:
      'Generate SHA-256, SHA-512 and MD5 hashes of text or files in your browser using the Web Crypto API.',
    keywords: ['hash', 'sha256', 'md5', 'sha1', 'checksum', 'digest'],
    input: { label: 'Text', language: 'text', example: 'abc', accept: '*' },
    output: { label: 'Digests', extension: '.txt', language: 'text' },
    supportsFileHashing: true,
    options: [
      {
        id: 'algorithms',
        label: 'Algorithms',
        type: 'checkbox-group',
        default: ['sha256'],
        choices: HASH_ALGORITHMS.map((a) => ({ value: a.id, label: a.label, help: a.warning })),
      },
      { id: 'uppercase', label: 'Uppercase output', type: 'checkbox', default: false },
    ],
    isAsync: true,
    run: ({ input, options }) => hashInput(input, options),
  },

  /* ---------------- Time & identifiers ---------------- */
  {
    id: 'unix-timestamp-converter',
    slug: 'unix-timestamp-converter',
    label: 'Unix Timestamp Converter',
    category: 'Time & identifiers',
    description: 'Convert between Unix timestamps and human dates in any time zone.',
    seoTitle: 'Unix Timestamp Converter — UTC and ISO 8601',
    metaDescription:
      'Convert Unix timestamps to dates and back, with automatic seconds/milliseconds detection and time zone support.',
    keywords: ['unix', 'timestamp', 'epoch', 'date', 'iso 8601', 'time zone'],
    input: { label: 'Timestamp or date', language: 'text', example: '1700000000', accept: '.txt' },
    output: { label: 'Converted', extension: '.txt', language: 'text' },
    render: 'details',
    options: [
      { id: 'timeZone', label: 'Time zone', type: 'select', default: 'UTC', choices: COMMON_TIME_ZONES.map((zone) => ({ value: zone, label: zone === 'local' ? 'Local (this browser)' : zone })) },
      { id: 'unit', label: 'Interpret numbers as', type: 'select', default: 'auto', choices: [{ value: 'auto', label: 'Auto-detect' }, { value: 'seconds', label: 'Seconds' }, { value: 'milliseconds', label: 'Milliseconds' }, { value: 'microseconds', label: 'Microseconds' }] },
    ],
    actions: [{ id: 'now', label: 'Use current time' }],
    run: ({ input, options }) => convertTimestamp(input, options),
  },
  {
    id: 'uuid-generator',
    slug: 'uuid-generator',
    label: 'UUID Generator',
    category: 'Time & identifiers',
    description: 'Generate cryptographically random version 4 UUIDs.',
    seoTitle: 'UUID v4 Generator — Cryptographically Random',
    metaDescription:
      'Generate one, ten or a hundred UUID v4 values in your browser using crypto.randomUUID(). Nothing is transmitted.',
    keywords: ['uuid', 'guid', 'uuid v4', 'random', 'identifier'],
    input: null,
    output: { label: 'UUIDs', extension: '.txt', language: 'text' },
    generator: true,
    options: [
      { id: 'count', label: 'How many', type: 'select', default: '1', choices: [{ value: '1', label: '1' }, { value: '10', label: '10' }, { value: '100', label: '100' }], parse: Number },
      { id: 'uppercase', label: 'Uppercase', type: 'checkbox', default: false },
    ],
    run: ({ options }) => generateIds('', { ...options, kind: 'uuid' }),
  },
  {
    id: 'ulid-generator',
    slug: 'ulid-generator',
    label: 'ULID Generator',
    category: 'Time & identifiers',
    description: 'Generate lexicographically sortable ULIDs.',
    seoTitle: 'ULID Generator — Sortable, Generated Locally',
    metaDescription:
      'Generate ULIDs in your browser. ULIDs sort by creation time and are generated with the Web Crypto CSPRNG.',
    keywords: ['ulid', 'sortable', 'identifier', 'crockford base32'],
    input: null,
    output: { label: 'ULIDs', extension: '.txt', language: 'text' },
    generator: true,
    options: [
      { id: 'count', label: 'How many', type: 'select', default: '1', choices: [{ value: '1', label: '1' }, { value: '10', label: '10' }, { value: '100', label: '100' }], parse: Number },
      { id: 'monotonic', label: 'Monotonic within the same millisecond', type: 'checkbox', default: false },
    ],
    run: ({ options }) => generateIds('', { ...options, kind: 'ulid' }),
  },

  /* ---------------- Text tools ---------------- */
  {
    id: 'case-converter',
    slug: 'case-converter',
    label: 'Case Converter',
    category: 'Text tools',
    description: 'Convert text between camelCase, snake_case, kebab-case and six more styles.',
    seoTitle: 'Case Converter — camelCase, snake_case, kebab',
    metaDescription:
      'Convert identifiers between camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE and dot.case.',
    keywords: ['case', 'camelcase', 'snake_case', 'kebab-case', 'pascalcase', 'naming'],
    input: { label: 'Text', language: 'text', example: CASE_EXAMPLE, accept: '.txt' },
    output: { label: 'Converted', extension: '.txt', language: 'text' },
    render: 'details',
    options: [
      { id: 'style', label: 'Style', type: 'select', default: 'all', choices: [{ value: 'all', label: 'Show every style' }, ...CASE_STYLES.map((s) => ({ value: s.id, label: s.label }))] },
      { id: 'perLine', label: 'Convert each line separately', type: 'checkbox', default: true },
    ],
    run: ({ input, options }) => convertCase(input, options),
  },
  {
    id: 'regex-tester',
    slug: 'regex-tester',
    label: 'Regex Tester',
    category: 'Text tools',
    description: 'Test a regular expression against text with highlighted matches and capture groups.',
    seoTitle: 'Regex Tester — Runs in a Worker, Times Out Safely',
    metaDescription:
      'Test JavaScript regular expressions in your browser. Matches run in a Web Worker with a timeout so the page never freezes.',
    keywords: ['regex', 'regular expression', 'match', 'capture group', 'test'],
    input: { label: 'Test string', language: 'text', example: REGEX_EXAMPLE.input, accept: '.txt' },
    output: { label: 'Matches', extension: '.json', language: 'json' },
    render: 'regex',
    isAsync: true,
    options: [
      { id: 'pattern', label: 'Pattern', type: 'text', default: REGEX_EXAMPLE.pattern, monospace: true, placeholder: '\\b\\w+\\b' },
      { id: 'flags', label: 'Flags', type: 'flags', default: 'g', choices: Object.entries(describeFlags()).map(([value, label]) => ({ value, label: value + ' — ' + label })) },
      { id: 'mode', label: 'Mode', type: 'select', default: 'match', choices: [{ value: 'match', label: 'Find matches' }, { value: 'replace', label: 'Find and replace' }] },
      { id: 'replacement', label: 'Replacement', type: 'text', default: '', placeholder: '$1 or $<name>', monospace: true, dependsOn: { mode: 'replace' } },
    ],
    run: async ({ input, options }) => {
      const payload = { pattern: options.pattern, flags: options.flags, input };
      if (options.mode === 'replace') {
        const { data } = await runRegexInWorker({ ...payload, replacement: options.replacement }, { action: 'replace' });
        return result(typeof data === 'string' ? data : data.output, { notes: ['Replacement uses standard String.replace syntax — $1, $<name>, $& — which is substitution, not code execution.'] });
      }
      const { data, degraded } = await runRegexInWorker(payload);
      const notes = [];
      if (data.note) notes.push(data.note);
      if (data.truncated) notes.push('Output truncated at ' + data.matches.length + ' matches.');
      return result(JSON.stringify(data.matches, null, 2), {
        notes: notes.length ? notes : undefined,
        regex: data,
        // Losing the timeout means a bad pattern can now freeze the tab, so this
        // one has to reach the user even though notes are not displayed.
        statusMessage: degraded
          ? 'Converted — but this browser has no module workers, so the pattern ran without the 750 ms timeout.'
          : undefined,
        statusLevel: degraded ? 'warning' : undefined,
      });
    },
  },
  {
    id: 'diff-checker',
    slug: 'diff-checker',
    label: 'Diff Checker',
    category: 'Text tools',
    description: 'Compare two texts or two JSON documents line by line or word by word.',
    seoTitle: 'Diff Checker — Text and JSON, Compared Locally',
    metaDescription:
      'Compare two texts or JSON documents in your browser. JSON mode ignores key order and formatting.',
    keywords: ['diff', 'compare', 'text diff', 'json', 'json diff', 'merge', 'text'],
    input: { label: 'Original', language: 'text', example: DIFF_EXAMPLE.left, accept: '.txt,.json' },
    secondaryInput: { label: 'Changed', language: 'text', example: DIFF_EXAMPLE.right, accept: '.txt,.json' },
    output: { label: 'Differences', extension: '.diff', language: 'diff' },
    render: 'diff',
    options: [
      { id: 'mode', label: 'Compare as', type: 'select', default: 'line', choices: [{ value: 'line', label: 'Text — line by line' }, { value: 'word', label: 'Text — word by word' }, { value: 'json', label: 'JSON — ignore key order' }] },
      { id: 'view', label: 'Layout', type: 'select', default: 'side-by-side', choices: [{ value: 'side-by-side', label: 'Side by side' }, { value: 'unified', label: 'Unified' }] },
      { id: 'ignoreWhitespace', label: 'Ignore whitespace', type: 'checkbox', default: false },
      { id: 'ignoreCase', label: 'Ignore case', type: 'checkbox', default: false },
    ],
    run: ({ input, secondaryInput, options }) => {
      const diff = computeDiff(input ?? '', secondaryInput ?? '', options);
      const output = options.view === 'unified'
        ? diff.unified
        : diffToUnifiedText(input ?? '', secondaryInput ?? '', options);
      return result(output, { notes: diff.notes, warnings: diff.warnings, diff });
    },
  },
];

/* ------------------------------------------------------------------ *
 * Registry API
 * ------------------------------------------------------------------ */

/**
 * A matrix tool falls back to its own format pair when the caller passes none,
 * so `tool.run({ input, options })` is correct on its own — the UI supplies the
 * live selection, but tests and the worker do not have to know that.
 */
for (const tool of TOOLS) {
  if (!tool.formats) continue;
  const base = tool.run;
  const fallback = tool.formats;
  tool.run = (args) => base({ ...args, formats: args.formats ?? fallback });
}

const BY_SLUG = new Map(TOOLS.map((tool) => [tool.slug, tool]));
const BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

export const CATEGORIES = [...new Set(TOOLS.map((tool) => tool.category))];

/**
 * Category metadata, keyed by the `category` string the tools already carry.
 * The slug gives each category a browsable page at /tools/<slug>/, and the
 * blurb is the one sentence that page and the breadcrumb trail use.
 */
export const CATEGORY_META = Object.freeze({
  'Structured data': {
    slug: 'data',
    title: 'Data Format Converters',
    blurb: 'Convert between JSON, YAML, TOML, CSV, TSV, XML and HTML tables in any direction, and format or validate JSON.',
  },
  'Code generation': {
    slug: 'code',
    title: 'Code Generators',
    blurb: 'Turn a JSON sample into TypeScript interfaces, Zod schemas, Python dataclasses, Go structs, SQL tables or JSON Schema.',
  },
  'Encoding & tokens': {
    slug: 'encoding',
    title: 'Encoding, Hashing and Tokens',
    blurb: 'Base64 and URL encoding, SHA-256 and MD5 hashes, JWT inspection and cURL translation.',
  },
  'Time & identifiers': {
    slug: 'time',
    title: 'Timestamps and Identifiers',
    blurb: 'Convert Unix timestamps between seconds, milliseconds and ISO 8601, and generate UUIDs and ULIDs.',
  },
  'Text tools': {
    slug: 'text',
    title: 'Text Tools',
    blurb: 'Convert identifier casing, test regular expressions and compare two pieces of text or JSON.',
  },
});

/** Every category as a record, in registry order. */
export function getCategories() {
  return CATEGORIES.map((category) => ({
    category,
    ...CATEGORY_META[category],
    tools: TOOLS.filter((tool) => tool.category === category),
  }));
}

export function categorySlugOf(tool) {
  return CATEGORY_META[tool?.category]?.slug ?? null;
}

export function getCategoryBySlug(slug) {
  return getCategories().find((entry) => entry.slug === slug) ?? null;
}

export function getTools() {
  return TOOLS;
}

export function getToolBySlug(slug) {
  return BY_SLUG.get(slug) ?? null;
}

export function getToolById(id) {
  return BY_ID.get(id) ?? null;
}

export function isToolSlug(slug) {
  return slug === 'home' || BY_SLUG.has(slug);
}

export function toolsByCategory() {
  return CATEGORIES.map((category) => ({
    category,
    tools: TOOLS.filter((tool) => tool.category === category),
  }));
}

/** Default option values for a tool, ready to feed to run(). */
export function defaultOptions(tool) {
  const values = {};
  for (const option of tool.options ?? []) {
    values[option.id] = Array.isArray(option.default) ? [...option.default] : option.default;
  }
  return coerceOptions(tool, values);
}

/**
 * Options arrive from form controls as strings. Each option may declare a
 * `parse` function; everything else passes through untouched.
 */
export function coerceOptions(tool, rawValues) {
  const values = {};
  for (const option of tool.options ?? []) {
    const raw = rawValues?.[option.id];
    const value = raw === undefined ? option.default : raw;
    values[option.id] = typeof option.parse === 'function' && value !== undefined && !option.rawValue
      ? option.parse(value)
      : value;
  }
  return values;
}

/** Which download extension applies for the current options and formats. */
export function extensionFor(tool, options, formats) {
  if (typeof tool.extensionFor === 'function') return tool.extensionFor(options ?? {});
  // A matrix tool's extension follows the selected output format, so JSON → XML
  // downloads as .xml rather than the page's original .yaml.
  const target = formats?.to ?? tool.formats?.to;
  if (target && FORMATS[target]) return FORMATS[target].extension;
  return tool.output?.extension ?? '.txt';
}

/** MIME type for the current output format, used for the download Blob. */
export function mimeFor(tool, formats) {
  const target = formats?.to ?? tool.formats?.to;
  return target && FORMATS[target] ? FORMATS[target].mime : null;
}

/** The example payload matching the currently selected input format. */
export function exampleFor(tool, formats) {
  const source = formats?.from ?? tool.formats?.from;
  if (source && FORMATS[source]) return FORMATS[source].example;
  return tool.input?.example ?? '';
}

/** Human label for a format id, for status messages. */
export function formatLabel(id) {
  return FORMATS[id]?.label ?? id;
}

/**
 * The tool whose landing page represents this format pair, if one exists.
 * Used so changing a selector keeps the URL meaningful where it can.
 */
export function toolForFormats(from, to) {
  return TOOLS.find(
    (tool) => !tool.universal && tool.formats?.from === from && tool.formats?.to === to,
  ) ?? null;
}

/**
 * Lightweight relevance search for the command palette.
 * Matching on label, description and keywords is plenty at this scale; no
 * fuzzy-search dependency needed.
 */
export function searchTools(query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return TOOLS;
  const terms = needle.split(/\s+/);

  return TOOLS.map((tool) => {
    const haystack = [tool.label, tool.description, tool.slug, ...(tool.keywords ?? [])]
      .join(' ')
      .toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (!haystack.includes(term)) return { tool, score: -1 };
      if (tool.label.toLowerCase().startsWith(term)) score += 5;
      else if (tool.label.toLowerCase().includes(term)) score += 3;
      else if ((tool.keywords ?? []).some((k) => k.startsWith(term))) score += 2;
      else score += 1;
    }
    return { tool, score };
  })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.tool);
}

/** Tools worth linking from a given tool's page, for SEO and navigation. */
export function relatedTools(tool, limit = 5) {
  if (!tool) return TOOLS.slice(0, limit);
  const sameCategory = TOOLS.filter((t) => t.category === tool.category && t.id !== tool.id);
  const swapped = tool.swap ? [getToolBySlug(tool.swap)].filter(Boolean) : [];
  const shareKeyword = TOOLS.filter(
    (t) => t.id !== tool.id && (t.keywords ?? []).some((k) => (tool.keywords ?? []).includes(k)),
  );
  const ordered = [...swapped, ...sameCategory, ...shareKeyword];
  const seen = new Set([tool.id]);
  const out = [];
  for (const candidate of ordered) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    out.push(candidate);
    if (out.length >= limit) break;
  }
  return out;
}
