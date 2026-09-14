/**
 * seo-content.mjs — the per-tool copy that appears on each static landing page.
 *
 * Build-time only. Nothing here is imported by src/app.js, so none of this text
 * is downloaded by someone using the app; it exists for the page a search
 * engine and a first-time visitor land on.
 *
 * `handles` states what the tool does with real input. `sample.input` is run
 * through the tool's own `run()` at build time and the result is printed as the
 * example, so the page cannot drift from the behaviour it describes. Tools
 * whose output is random or time-dependent carry no sample.
 */

export const PAGE_CONTENT = {
  'format-converter': {
    handles: [
      'Any pair of JSON, YAML, TOML, CSV, TSV, XML and HTML tables — 49 combinations from one pair of selectors.',
      'CSV and TSV delimiters are detected automatically: comma, semicolon, tab or pipe.',
      'A table with no header row is detected and its columns are named column1 to columnN.',
      'Values read from CSV, TSV, XML and HTML stay strings until "Infer numbers and booleans" is switched on.',
      'A nested value written into a table cell is serialized as JSON text inside that cell.',
    ],
    sample: { input: '[{"id":1,"name":"Ada","tags":["math","code"]}]' },
  },

  'json-to-yaml': {
    handles: [
      'Indentation of 2 or 4 spaces, or 0 for a compact flow style.',
      'Keys can be sorted alphabetically instead of keeping their original order.',
      'Repeated structures are written out in full; no anchors or aliases are emitted.',
      'Strings that YAML would otherwise read as numbers, booleans or dates are quoted.',
    ],
    sample: { input: '{"name":"Ada","active":true,"ports":[80,443]}' },
  },

  'yaml-to-json': {
    handles: [
      'Dates in the YAML document become ISO 8601 strings.',
      'NaN and Infinity become null.',
      'Tabs used for indentation are rejected, and the error carries the line and column.',
      'Multi-document YAML is not supported; one document per conversion.',
    ],
    sample: { input: 'name: Ada\nactive: true\nports:\n  - 80\n  - 443\n' },
  },

  'json-to-toml': {
    handles: [
      'A JSON array at the document root is refused — wrap it in an object first.',
      'Null values are dropped and every dropped path is reported.',
      'Nested objects become TOML tables and arrays of objects become [[array]] blocks.',
    ],
    sample: { input: '{"title":"FormatPort","owner":{"name":"Ada"},"ports":[80,443]}' },
  },

  'toml-to-json': {
    handles: [
      'TOML dates and date-times become ISO 8601 strings.',
      'Tables, inline tables and arrays of tables all become plain JSON objects and arrays.',
      'Invalid TOML reports the line and column rather than a raw parser message.',
    ],
    sample: { input: 'title = "FormatPort"\n\n[owner]\nname = "Ada"\nactive = true\n' },
  },

  'json-to-csv': {
    handles: [
      'Columns are the union of every key across all records, in first-seen order.',
      'Records missing a key get an empty cell rather than a shifted row.',
      'Nested objects and arrays are written as JSON text inside a single cell.',
      'The delimiter can be a comma, semicolon, tab or pipe, and the header row can be switched off.',
      'Output always uses "\\n" line endings.',
    ],
    sample: { input: '[{"id":1,"name":"Ada"},{"id":2,"name":"Linus","role":"maintainer"}]' },
  },

  'csv-to-json': {
    handles: [
      'The delimiter is detected automatically: comma, semicolon, tab or pipe.',
      'A quoted field keeps the commas inside it, and "" is read as an escaped quote.',
      'A file with no header row is detected and its columns are named column1 to columnN.',
      'Values stay strings until "Infer numbers and booleans" is switched on, so "007" survives as text.',
      'A UTF-8 byte order mark is stripped, and header cells are trimmed.',
      'Files above 2 MiB are streamed row by row, up to 100,000 rows.',
    ],
    sample: { input: 'id;name;role\n1;Ada;"engineer, founder"\n2;Linus;maintainer\n' },
  },

  'json-formatter': {
    handles: [
      'Pretty-print with 2 or 4 spaces, or minify to a single line.',
      'A syntax error reports the line and column and a hint for the usual causes.',
      'Key order is preserved exactly as written.',
    ],
    sample: { input: '{"name":"Ada","ports":[80,443],"active":true}' },
  },

  'json-to-typescript': {
    handles: [
      'Emits an interface or a type alias, named from the root type name you choose.',
      'Nested objects become their own named interfaces rather than inline literals.',
      'Unknown and mixed types are written as unknown or any, whichever you select.',
      'Types describe the sample you paste: a field that is never null in the sample is not optional.',
    ],
    sample: { input: '{"id":1,"name":"Ada","address":{"city":"London"},"tags":["a","b"]}' },
  },

  'json-to-zod': {
    handles: [
      'Emits a Zod schema, with or without the import line.',
      'Whole numbers become z.number().int() when integer inference is on.',
      'Nested objects become nested z.object() calls.',
      'The schema describes the sample you paste; it is not inferred from a wider dataset.',
    ],
    sample: { input: '{"id":1,"name":"Ada","active":true}' },
  },

  'json-to-python': {
    handles: [
      'Emits @dataclass definitions with type hints, one class per nested object.',
      'Keys that are not valid Python identifiers are skipped and listed in a comment.',
      'Null values in the sample produce Optional fields.',
    ],
    sample: { input: '{"id":1,"name":"Ada","manager":null}' },
  },

  'json-to-go': {
    handles: [
      'Emits Go structs with JSON tags matching the original key names.',
      'The package line and omitempty tags can each be switched off.',
      'Nested objects become their own named structs.',
      'Pointer types are not generated; nullable fields fall back to interface{} or the zero value.',
    ],
    sample: { input: '{"id":1,"name":"Ada","active":true}' },
  },

  'json-to-sql': {
    handles: [
      'Emits CREATE TABLE for PostgreSQL or SQLite from a flat object or an array of similar objects.',
      'Nested objects and arrays are stored as JSONB on PostgreSQL and TEXT on SQLite.',
      'Column types come from the sample; widths, indexes, constraints and foreign keys are not inferred.',
      'Identifiers are escaped for the selected dialect.',
    ],
    sample: { input: '[{"id":1,"name":"Ada","active":true}]' },
  },

  'json-to-json-schema': {
    handles: [
      'Emits draft-07 or 2020-12.',
      'Required lists the keys that appear in every observed object.',
      'additionalProperties can be pinned to false.',
      'Arrays are typed from their first element.',
    ],
    sample: { input: '[{"id":1,"name":"Ada"},{"id":2,"name":"Linus"}]' },
  },

  'jwt-decoder': {
    handles: [
      'Splits the token on its dots and base64url-decodes the header and the payload.',
      'The signature is shown but never verified — verification needs the signing key.',
      'Registered claims such as exp, iat and nbf are shown as readable dates alongside their raw values.',
      'A malformed segment is reported rather than guessed at.',
    ],
  },

  'base64-encoder-decoder': {
    handles: [
      'Encodes and decodes standard Base64 and the URL-safe alphabet that uses - and _.',
      'Padding with = can be switched off when encoding.',
      'Text is treated as UTF-8, so non-ASCII characters survive a round trip.',
      'Decoding accepts input with or without padding.',
    ],
    sample: { input: 'Žofie & Ada', options: { direction: 'encode' } },
  },

  'url-encoder-decoder': {
    handles: [
      'Detects what to do with the input: an absolute URL is inspected, text carrying percent escapes is decoded, anything else is encoded.',
      'Encoding uses encodeURIComponent for a single value or encodeURI for a whole URL.',
      '"+" can be treated as a space when decoding, which is the form-submission rule.',
      'Inspecting a URL breaks out protocol, host, port, path, query parameters and hash.',
    ],
    sample: { input: 'hello world&lang=cs' },
  },

  'curl-to-code': {
    handles: [
      'Translates one cURL invocation into JavaScript fetch, axios or Python requests.',
      'Understands quoting, backslash escapes and backslash line continuations.',
      'Shell expansion is not evaluated — $VAR, ${VAR}, $(...) and backticks pass through as literal text.',
      'Pipes, redirections, subshells, && chains and multiple URLs are not translated.',
      'Transport-only flags such as -s, -v, -k and --compressed are listed rather than converted.',
    ],
    sample: { input: "curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{\"name\":\"Ada\"}'" },
  },

  'hash-generator': {
    handles: [
      'SHA-256, SHA-384, SHA-512, SHA-1 and MD5, printed as lowercase or uppercase hex.',
      'SHA-256 is 64 hex characters, SHA-512 is 128, SHA-1 is 40 and MD5 is 32.',
      'SHA family digests come from the browser\'s own Web Crypto API; MD5 comes from a bundled library.',
      'A file is hashed from its bytes rather than its text, so any file type works.',
      'MD5 and SHA-1 are marked in the options: both are broken for collision resistance and unfit for signatures or passwords.',
    ],
    sample: { input: 'hello world' },
  },

  'unix-timestamp-converter': {
    handles: [
      'Seconds, milliseconds and microseconds are told apart by digit count, or can be forced.',
      'Shows ISO 8601, UTC, a chosen time zone, and how long ago the instant is.',
      '10 digits is seconds, 13 is milliseconds, 16 is microseconds.',
      'Converts in both directions: a timestamp to a date, or a date back to a timestamp.',
    ],
  },

  'uuid-generator': {
    handles: [
      'Generates version 4 UUIDs from crypto.randomUUID(), which uses the operating system\'s random source.',
      '1, 10 or 100 at a time, lowercase or uppercase.',
      'Version 4 carries no timestamp and no MAC address, and sorts randomly.',
    ],
  },

  'ulid-generator': {
    handles: [
      'Generates ULIDs: 26 Crockford base32 characters, a 48-bit timestamp followed by 80 random bits.',
      'Lexicographic order matches creation order, which is what makes them usable as database keys.',
      'Monotonic mode guarantees ordering within the same millisecond.',
      '1, 10 or 100 at a time.',
    ],
  },

  'case-converter': {
    handles: [
      'camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, dot.case, Title Case, Sentence case, lower and UPPER.',
      'Shows every style at once, or just the one you pick.',
      'Each line can be converted separately, so a whole list of identifiers can be pasted in.',
      'Existing casing, underscores, hyphens, dots and spaces are all read as word boundaries.',
    ],
    sample: { input: 'user_first_name', options: { style: 'all', perLine: true } },
  },

  'regex-tester': {
    handles: [
      'Matches or replaces, with the g, i, m, s, u, v, y and d flags.',
      'Shows every match with its index and its capture groups.',
      'The pattern runs in a Web Worker that is killed after 750 ms, so catastrophic backtracking cannot freeze the tab.',
      'Replacement supports $1, $2 and named group references.',
    ],
  },

  'diff-checker': {
    handles: [
      'Compares by line, by word, or semantically as JSON where key order does not count as a change.',
      'Side-by-side or unified view.',
      'Whitespace-only and case-only differences can each be ignored.',
      'Additions and removals carry a glyph as well as a colour.',
    ],
  },
};

/**
 * SEARCH_INTENT — the query a person is most plausibly typing when they should
 * land on a given tool, plus how hard that query is to win.
 *
 * This is editorial judgement, not measured data. It exists so
 * SEO_INDEX_INVENTORY.md can be regenerated instead of hand-maintained, and so
 * the "which pages do we push first" decision is written down somewhere
 * reviewable rather than re-argued each time. Once Search Console has real
 * query data, that data wins over anything guessed here.
 *
 * tier:
 *   1  high-volume, obvious intent — worth requesting indexing for on day one
 *   2  real demand, narrower or more competitive
 *   3  low volume or long-tail; indexed, but not worth pushing
 */
export const SEARCH_INTENT = {
  'format-converter': { query: 'convert json to yaml / csv / toml / xml (any pair)', tier: 2 },
  'json-to-yaml': { query: 'json to yaml converter', tier: 1 },
  'yaml-to-json': { query: 'yaml to json converter', tier: 1 },
  'json-to-toml': { query: 'json to toml converter', tier: 3 },
  'toml-to-json': { query: 'toml to json converter', tier: 3 },
  'json-to-csv': { query: 'json to csv converter', tier: 1 },
  'csv-to-json': { query: 'csv to json converter', tier: 1 },
  'json-formatter': { query: 'json formatter / json beautifier / json validator', tier: 1 },
  'json-to-typescript': { query: 'json to typescript interface generator', tier: 1 },
  'json-to-zod': { query: 'json to zod schema generator', tier: 2 },
  'json-to-python': { query: 'json to python dataclass / typeddict', tier: 2 },
  'json-to-go': { query: 'json to go struct generator', tier: 2 },
  'json-to-sql': { query: 'json to sql insert / create table', tier: 2 },
  'json-to-json-schema': { query: 'generate json schema from json', tier: 2 },
  'jwt-decoder': { query: 'jwt decoder / decode jwt token', tier: 1 },
  'base64-encoder-decoder': { query: 'base64 encode decode online', tier: 1 },
  'url-encoder-decoder': { query: 'url encode decode / percent encoding', tier: 2 },
  'curl-to-code': { query: 'convert curl to python / javascript / go', tier: 2 },
  'hash-generator': { query: 'sha256 / md5 hash generator online', tier: 1 },
  'unix-timestamp-converter': { query: 'unix timestamp converter / epoch converter', tier: 1 },
  'uuid-generator': { query: 'uuid generator v4 online', tier: 2 },
  'ulid-generator': { query: 'ulid generator online', tier: 3 },
  'case-converter': { query: 'camelcase / snake_case converter', tier: 2 },
  'regex-tester': { query: 'regex tester javascript online', tier: 2 },
  'diff-checker': { query: 'text diff checker / compare two texts', tier: 2 },
};
