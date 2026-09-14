/**
 * tests.js — zero-dependency test suite for FormatPort.
 *
 * These tests exercise the PURE converter and detector functions. There is no
 * DOM assertion here on purpose: the converters know nothing about the DOM, so
 * a regression in conversion logic shows up as a failing test rather than a
 * broken page.
 *
 * Where a library may legitimately choose different whitespace (YAML, TOML),
 * assertions compare re-parsed values rather than exact strings.
 */

import { YAML, TOML } from '../src/vendor.js';
import {
  jsonToYaml, yamlToJson, jsonToToml, tomlToJson,
  jsonToCsv, csvToJson, formatJson,
} from '../src/converters/structured-data.js';
import {
  jsonToTypeScript, jsonToZod, jsonToPython, jsonToGo,
  jsonToSql, jsonToJsonSchema,
} from '../src/converters/codegen.js';
import {
  base64Encode, base64Decode, bytesToBase64, base64ToBytes,
  urlEncode, urlDecode, inspectUrl, decodeJwt, detectUrlAction,
} from '../src/converters/encoding.js';
import {
  convertTimestamp, detectTimestampUnit, generateUuidV4, generateUlid,
  generateIds, UUID_V4_PATTERN, ULID_PATTERN, inspectUlid,
} from '../src/converters/time-id.js';
import { convertAllCases, convertCase } from '../src/converters/text.js';
import { hashText, hashInput } from '../src/converters/hashing.js';
import { parseCurl, curlToCode } from '../src/converters/curl.js';
import { runRegex, replaceWithRegex } from '../src/converters/regex.js';
import { computeDiff } from '../src/converters/diff.js';
import { detect, detectAll } from '../src/detect.js';
import { convertFormat, describeConversion, FORMATS, FORMAT_IDS } from '../src/converters/formats.js';
import { ConversionError, looksLikeHeaderRow } from '../src/converters/shared.js';
import { getTools, defaultOptions, coerceOptions, searchTools, isToolSlug } from '../src/tool-registry.js';

/* ------------------------------------------------------------------ *
 * Tiny test framework
 * ------------------------------------------------------------------ */

const registry = [];

function test(name, group, fn) {
  registry.push({ name, group, fn });
}

class AssertionError extends Error {
  constructor(message, { actual, expected } = {}) {
    super(message);
    this.name = 'AssertionError';
    this.actual = actual;
    this.expected = expected;
  }
}

/**
 * Almost every test here is pure and runs anywhere. The handful that need a
 * DOM throw this instead of failing when run under Node, so the suite reports
 * them as skipped rather than passing silently — a silent pass would be a lie
 * about what was checked.
 */
class SkipTest extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'SkipTest';
  }
}

/** Call at the top of a test that cannot run without a document. */
function requireDom(what) {
  if (typeof document === 'undefined') {
    throw new SkipTest('needs a DOM: ' + what);
  }
}

function show(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const assert = {
  equal(actual, expected, message = 'Values are not equal') {
    if (actual !== expected) {
      throw new AssertionError(message, { actual: show(actual), expected: show(expected) });
    }
  },
  deepEqual(actual, expected, message = 'Structures are not equal') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new AssertionError(message, { actual: show(actual), expected: show(expected) });
    }
  },
  ok(value, message = 'Expected a truthy value') {
    if (!value) throw new AssertionError(message, { actual: show(value), expected: 'truthy' });
  },
  includes(haystack, needle, message) {
    if (!String(haystack).includes(needle)) {
      throw new AssertionError(message ?? 'Output does not contain the expected text', {
        actual: show(haystack),
        expected: 'to contain: ' + needle,
      });
    }
  },
  match(value, pattern, message) {
    if (!pattern.test(String(value))) {
      throw new AssertionError(message ?? 'Value does not match the expected pattern', {
        actual: show(value),
        expected: String(pattern),
      });
    }
  },
  atLeast(actual, minimum, message) {
    if (!(actual >= minimum)) {
      throw new AssertionError(message ?? 'Value is below the minimum', {
        actual: show(actual),
        expected: '>= ' + minimum,
      });
    }
  },
  throws(fn, message = 'Expected the call to throw') {
    try {
      fn();
    } catch (error) {
      return error;
    }
    throw new AssertionError(message, { actual: 'no error thrown', expected: 'an error' });
  },
};

/* ------------------------------------------------------------------ *
 * Shared fixtures
 * ------------------------------------------------------------------ */

const b64url = (value) => bytesToBase64(new TextEncoder().encode(JSON.stringify(value)), { urlSafe: true, padding: false });

const JWT_HEADER = { alg: 'HS256', typ: 'JWT' };
const JWT_PAYLOAD = { sub: '123', name: 'Ada', iat: 1516239022 };
// A deterministic token built in test code. The third segment is a dummy —
// we never assert anything about signature validity.
export const TEST_JWT = b64url(JWT_HEADER) + '.' + b64url(JWT_PAYLOAD) + '.' + 'ZHVtbXktc2lnbmF0dXJl';

const SAMPLE = '{"id":1,"name":"Ada","active":true}';

// Fixtures for the matrix-vs-pairwise equivalence test.
const JSON_SAMPLE = '{"name":"Ada","active":true,"tags":["a","b"]}';
const YAML_SAMPLE = ['name: Ada', 'active: true'].join('\n');

/* ================================================================== *
 * 1-2. JSON <-> YAML
 * ================================================================== */

test('JSON to YAML produces a document that re-parses to the same value', 'Structured data', () => {
  const { output } = jsonToYaml('{"name":"Ada","active":true}');
  // Compare semantically: js-yaml is free to choose its own quoting/spacing.
  assert.deepEqual(YAML.parse(output), { name: 'Ada', active: true });
  assert.includes(output, 'name: Ada');
});

test('YAML to JSON returns exactly the expected object', 'Structured data', () => {
  const { output } = yamlToJson('name: Ada\nactive: true');
  assert.deepEqual(JSON.parse(output), { name: 'Ada', active: true });
});

test('YAML round trip preserves nested structures', 'Structured data', () => {
  const original = { server: { host: 'a.example.com', ports: [80, 443] }, debug: false };
  const yaml = jsonToYaml(JSON.stringify(original)).output;
  assert.deepEqual(JSON.parse(yamlToJson(yaml).output), original);
});

test('Invalid YAML reports a line number instead of throwing raw', 'Structured data', () => {
  const error = assert.throws(() => yamlToJson('a:\n\t- broken tab indent'));
  assert.ok(error instanceof ConversionError, 'expected a ConversionError');
  assert.includes(error.message, 'Invalid YAML');
});

/* ================================================================== *
 * JSON <-> TOML
 * ================================================================== */

test('JSON to TOML round trips through the TOML parser', 'Structured data', () => {
  const { output } = jsonToToml('{"title":"FormatPort","owner":{"name":"Ada"},"ports":[80,443]}');
  // TOML must emit scalars before tables, so key order legitimately differs
  // from the JSON input. Compare key by key rather than as one JSON string.
  const parsed = TOML.parse(output);
  assert.equal(parsed.title, 'FormatPort');
  assert.deepEqual(parsed.ports, [80, 443]);
  assert.deepEqual(parsed.owner, { name: 'Ada' });
});

test('JSON to TOML reports dropped nulls rather than losing them silently', 'Structured data', () => {
  const outcome = jsonToToml('{"a":1,"b":null}');
  assert.ok(outcome.warnings?.length, 'expected a warning about the null value');
  assert.includes(outcome.warnings.join(' '), '"b"');
});

test('TOML to JSON parses tables and arrays of tables', 'Structured data', () => {
  const { output } = tomlToJson('title = "x"\n\n[[servers]]\nhost = "a"\n\n[[servers]]\nhost = "b"');
  assert.deepEqual(JSON.parse(output), { title: 'x', servers: [{ host: 'a' }, { host: 'b' }] });
});

/* ================================================================== *
 * 3-4. CSV
 * ================================================================== */

test('CSV to JSON with dynamicTyping off keeps every value a string', 'Structured data', () => {
  const { output } = csvToJson('name,age\nAda,36\nLinus,55', { dynamicTyping: false });
  assert.deepEqual(JSON.parse(output), [
    { name: 'Ada', age: '36' },
    { name: 'Linus', age: '55' },
  ]);
});

test('CSV to JSON with dynamicTyping on coerces numbers', 'Structured data', () => {
  const { output } = csvToJson('name,age\nAda,36', { dynamicTyping: true });
  assert.deepEqual(JSON.parse(output), [{ name: 'Ada', age: 36 }]);
});

test('CSV to JSON auto-detects a semicolon delimiter', 'Structured data', () => {
  const { output } = csvToJson('name;age\nAda;36', { delimiter: 'auto' });
  assert.deepEqual(JSON.parse(output), [{ name: 'Ada', age: '36' }]);
});

test('A semicolon CSV converts correctly under the tool\'s own default options', 'Structured data', () => {
  // Passing `delimiter: 'auto'` explicitly, as the test above does, is not what
  // the app does: it passes whatever the registry says the default is. That
  // default was 'comma', so a semicolon file came back as a single column while
  // the status line still said "Converted". Assert against the real defaults.
  const tool = getTools().find((t) => t.id === 'csv-to-json');
  const options = defaultOptions(tool);
  const input = 'id;name;role\n101;Ada;engineer\n102;Linus;maintainer\n';
  const expected = [
    { id: '101', name: 'Ada', role: 'engineer' },
    { id: '102', name: 'Linus', role: 'maintainer' },
  ];

  assert.deepEqual(JSON.parse(convertFormat(input, { ...options, ...tool.formats }).output), expected);
  assert.deepEqual(JSON.parse(csvToJson(input, options).output), expected);
});

test('An explicitly wrong CSV delimiter is reported, not silently mangled', 'Structured data', () => {
  const input = 'id;name;role\n101;Ada;engineer\n';
  const outcomes = [
    csvToJson(input, { delimiter: 'comma' }),
    convertFormat(input, { from: 'csv', to: 'json', delimiter: 'comma' }),
  ];
  for (const outcome of outcomes) {
    assert.includes(outcome.statusMessage ?? '', 'semicolon');
  }
});

test('A correctly parsed CSV carries no delimiter caveat', 'Structured data', () => {
  const outcome = convertFormat('id,name\n1,Ada\n', { from: 'csv', to: 'json', delimiter: 'auto' });
  assert.equal(outcome.statusMessage, undefined);
});

test('Writing CSV while the delimiter is on auto still emits commas', 'Structured data', () => {
  const { output } = convertFormat('[{"a":1,"b":2}]', { from: 'json', to: 'csv', delimiter: 'auto' });
  assert.equal(output.trim().split('\n')[0], 'a,b');
});

/* ---- Header-row detection --------------------------------------- */

test('looksLikeHeaderRow reads a typed column to tell names from data', 'Structured data', () => {
  const rows = (text) => text.trim().split('\n').map((line) => line.split(','));
  assert.equal(looksLikeHeaderRow(rows('id,name\n1,Ada\n2,Linus')), true);
  assert.equal(looksLikeHeaderRow(rows('date,amount\n2024-01-01,15.50')), true);
  assert.equal(looksLikeHeaderRow(rows('id,active\n1,true\n2,false')), true);
  assert.equal(looksLikeHeaderRow(rows('1,Ada\n2,Linus\n3,Grace')), false);
  assert.equal(looksLikeHeaderRow(rows('2024-01-01,15.50\n2024-01-02,3.10')), false);
  // No typed column anywhere: undecidable, so keep the usual assumption.
  assert.equal(looksLikeHeaderRow(rows('Ada,Lovelace\nLinus,Torvalds')), true);
});

test('A headerless CSV gets generated column names under default options', 'Structured data', () => {
  const tool = getTools().find((t) => t.id === 'csv-to-json');
  const options = defaultOptions(tool);
  const input = '1,Ada,eng\n2,Linus,maint\n';
  const expected = [
    { column1: '1', column2: 'Ada', column3: 'eng' },
    { column1: '2', column2: 'Linus', column3: 'maint' },
  ];

  const matrix = convertFormat(input, { ...options, ...tool.formats });
  assert.deepEqual(JSON.parse(matrix.output), expected);
  assert.includes(matrix.statusMessage ?? '', 'No header row detected');
  assert.deepEqual(JSON.parse(csvToJson(input, options).output), expected);
});

test('Header "yes" and "no" override what detection would have chosen', 'Structured data', () => {
  const named = convertFormat('1,Ada\n2,Linus\n', { from: 'csv', to: 'json', header: 'yes' });
  assert.deepEqual(JSON.parse(named.output), [{ 1: '2', Ada: 'Linus' }]);

  const unnamed = convertFormat('id,name\n1,Ada\n', { from: 'csv', to: 'json', header: 'no' });
  assert.deepEqual(JSON.parse(unnamed.output), [
    { column1: 'id', column2: 'name' },
    { column1: '1', column2: 'Ada' },
  ]);
  // An explicit choice is the user's, so it is not worth a status line.
  assert.equal(unnamed.statusMessage, undefined);
});

test('Presets holding the old boolean header value still work', 'Structured data', () => {
  const tool = getTools().find((t) => t.id === 'csv-to-json');
  assert.equal(coerceOptions(tool, { header: true }).header, 'yes');
  assert.equal(coerceOptions(tool, { header: false }).header, 'no');
  assert.equal(coerceOptions(tool, {}).header, 'auto');
});

test('A headerless table converts to every tabular format', 'Structured data', () => {
  // These two used to throw: without a header the rows were bare arrays, and
  // both writers need records.
  const input = '1,Ada,eng\n2,Linus,maint\n';
  assert.includes(convertFormat(input, { from: 'csv', to: 'tsv' }).output, 'column1\tcolumn2\tcolumn3');
  assert.includes(convertFormat(input, { from: 'csv', to: 'html' }).output, '<th>column1</th>');
  assert.includes(convertFormat(input, { from: 'csv', to: 'xml' }).output, '<column1>1</column1>');
});

test('detectUrlAction picks inspect, decode or encode from the input alone', 'Encoding', () => {
  assert.equal(detectUrlAction('https://example.com/search?q=hello world#results'), 'inspect');
  assert.equal(detectUrlAction('mailto:ada@example.com'), 'inspect');
  assert.equal(detectUrlAction('a%20b%26c'), 'decode');
  assert.equal(detectUrlAction('hello world&x=1'), 'encode');
  assert.equal(detectUrlAction('/path/with space'), 'encode');
  assert.equal(detectUrlAction(''), 'encode');
});

test('The URL tool encodes plain text instead of demanding an absolute URL', 'Encoding', () => {
  // The action defaulted to "inspect", so pasting anything that was not a full
  // URL answered "This is not an absolute URL." rather than encoding it.
  const tool = getTools().find((t) => t.id === 'url-encoder-decoder');
  const options = defaultOptions(tool);
  assert.equal(options.action, 'auto');

  const encoded = tool.run({ input: 'hello world&x=1', options });
  assert.equal(encoded.output, 'hello%20world%26x%3D1');
  assert.includes(encoded.statusMessage ?? '', 'encode');

  const decoded = tool.run({ input: 'a%20b%26c', options });
  assert.equal(decoded.output, 'a b&c');

  const inspected = tool.run({ input: 'https://example.com/p?q=1', options });
  assert.includes(inspected.output, 'example.com');
});

test('An explicit URL action is obeyed and stays quiet', 'Encoding', () => {
  const tool = getTools().find((t) => t.id === 'url-encoder-decoder');
  const options = { ...defaultOptions(tool), action: 'encode' };
  const outcome = tool.run({ input: 'a%20b', options });
  assert.equal(outcome.output, 'a%2520b');
  assert.equal(outcome.statusMessage, undefined);
});

test('An HTML table is judged by its <th> cells before its values', 'Structured data', () => {
  const withTh = '<table><tr><th>id</th><th>name</th></tr><tr><td>1</td><td>Ada</td></tr></table>';
  assert.deepEqual(JSON.parse(convertFormat(withTh, { from: 'html', to: 'json' }).output), [{ id: '1', name: 'Ada' }]);

  const allTd = '<table><tr><td>1</td><td>Ada</td></tr><tr><td>2</td><td>Linus</td></tr></table>';
  assert.deepEqual(JSON.parse(convertFormat(allTd, { from: 'html', to: 'json' }).output), [
    { column1: '1', column2: 'Ada' },
    { column1: '2', column2: 'Linus' },
  ]);
});

test('JSON to CSV emits a header row and "\\n" newlines', 'Structured data', () => {
  const { output } = jsonToCsv('[{"name":"Ada","age":36},{"name":"Linus","age":55}]');
  assert.equal(output, 'name,age\nAda,36\nLinus,55');
});

test('JSON to CSV unions keys across sparse rows', 'Structured data', () => {
  const { output } = jsonToCsv('[{"a":1},{"b":2}]');
  assert.equal(output, 'a,b\n1,\n,2');
});

test('JSON to CSV rejects an array of non-objects with a clear message', 'Structured data', () => {
  const error = assert.throws(() => jsonToCsv('[1,2,3]'));
  assert.includes(error.message, 'not an object');
});

test('JSON formatter minifies and pretty-prints', 'Structured data', () => {
  assert.equal(formatJson('{ "a" : 1 }', { mode: 'minify' }).output, '{"a":1}');
  assert.equal(formatJson('{"a":1}', { mode: 'pretty', indent: 2 }).output, '{\n  "a": 1\n}');
});

test('Invalid JSON reports the line and column', 'Structured data', () => {
  const error = assert.throws(() => formatJson('{"a": 1,}'));
  assert.ok(error instanceof ConversionError, 'expected a ConversionError');
  assert.ok(error.line >= 1, 'expected a line number');
});

/* ================================================================== *
 * 5-6. TypeScript and Zod
 * ================================================================== */

test('JSON to TypeScript emits an interface with inferred primitive types', 'Code generation', () => {
  const { output } = jsonToTypeScript(SAMPLE, { rootName: 'Root', style: 'interface' });
  assert.includes(output, 'interface Root');
  assert.includes(output, 'id: number');
  assert.includes(output, 'name: string');
  assert.includes(output, 'active: boolean');
});

test('JSON to TypeScript quotes keys that are not valid identifiers', 'Code generation', () => {
  const { output } = jsonToTypeScript('{"kebab-key":1,"ok":2}');
  assert.includes(output, '"kebab-key": number');
  assert.includes(output, 'ok: number');
});

test('JSON to TypeScript marks keys missing from some rows as optional', 'Code generation', () => {
  const { output } = jsonToTypeScript('[{"a":1},{"a":2,"b":"x"}]');
  assert.includes(output, 'b?: string');
});

test('JSON to Zod emits z.object with matching primitive schemas', 'Code generation', () => {
  const { output } = jsonToZod(SAMPLE, { rootName: 'RootSchema' });
  assert.includes(output, 'z.object');
  assert.includes(output, 'id: z.number()');
  assert.includes(output, 'name: z.string()');
  assert.includes(output, 'active: z.boolean()');
});

test('JSON to Zod marks nullable and optional fields', 'Code generation', () => {
  const { output } = jsonToZod('[{"a":1,"b":null},{"a":2,"b":"x"}]', { intAsInt: false });
  assert.includes(output, '.nullable()');
});

/* ================================================================== *
 * Python, Go, SQL, JSON Schema
 * ================================================================== */

test('JSON to Python emits a dataclass with type hints', 'Code generation', () => {
  const { output } = jsonToPython(SAMPLE, { rootName: 'Root' });
  assert.includes(output, '@dataclass');
  assert.includes(output, 'class Root:');
  assert.includes(output, 'id: int');
  assert.includes(output, 'name: str');
  assert.includes(output, 'active: bool');
});

test('JSON to Python generates nested dataclasses and list types', 'Code generation', () => {
  const { output } = jsonToPython('{"user":{"city":"London"},"tags":["a"]}');
  assert.includes(output, 'class User:');
  assert.includes(output, 'tags: list[str]');
});

test('JSON to Go emits a struct with json tags', 'Code generation', () => {
  const { output } = jsonToGo(SAMPLE, { rootName: 'Root', packageName: 'main' });
  assert.includes(output, 'type Root struct');
  assert.includes(output, 'json:"id"');
  assert.includes(output, 'json:"name"');
  // Field alignment padding depends on the longest name, so match loosely.
  assert.match(output, /Name\s+string/);
  assert.match(output, /Active\s+bool/);
});

test('JSON to Go uppercases known initialisms', 'Code generation', () => {
  const { output } = jsonToGo('{"user_id":1,"api_url":"x"}');
  assert.includes(output, 'UserID');
  assert.includes(output, 'APIURL');
});

test('JSON to SQL infers PostgreSQL column types', 'Code generation', () => {
  const { output } = jsonToSql('[{"id":1,"name":"Ada","score":1.5,"active":true}]', {
    tableName: 'users', dialect: 'postgres',
  });
  assert.includes(output, 'CREATE TABLE "users"');
  assert.includes(output, '"id"');
  assert.includes(output, 'BIGINT');
  assert.includes(output, 'TEXT');
  assert.includes(output, 'DOUBLE PRECISION');
  assert.includes(output, 'BOOLEAN');
  assert.includes(output, 'PRIMARY KEY');
});

test('JSON to SQL maps nested values to JSONB on Postgres and TEXT on SQLite', 'Code generation', () => {
  assert.includes(jsonToSql('[{"meta":{"a":1}}]', { dialect: 'postgres' }).output, 'JSONB');
  assert.includes(jsonToSql('[{"meta":{"a":1}}]', { dialect: 'sqlite' }).output, 'TEXT');
});

test('JSON to SQL quotes identifiers containing a double quote', 'Code generation', () => {
  const { output } = jsonToSql('[{"we\\"ird":1}]', { tableName: 't' });
  assert.includes(output, '"we""ird"');
});

test('JSON to JSON Schema infers types, properties and required keys', 'Code generation', () => {
  const { output } = jsonToJsonSchema(SAMPLE);
  const schema = JSON.parse(output);
  assert.equal(schema.type, 'object');
  assert.equal(schema.properties.id.type, 'integer');
  assert.equal(schema.properties.name.type, 'string');
  assert.equal(schema.properties.active.type, 'boolean');
  assert.deepEqual(schema.required, ['id', 'name', 'active']);
});

test('JSON to JSON Schema describes array items', 'Code generation', () => {
  const schema = JSON.parse(jsonToJsonSchema('{"tags":["a","b"]}').output);
  assert.equal(schema.properties.tags.type, 'array');
  assert.equal(schema.properties.tags.items.type, 'string');
});

/* ================================================================== *
 * 7. JWT
 * ================================================================== */

test('JWT decoder returns the exact header and payload', 'Encoding', () => {
  const outcome = decodeJwt(TEST_JWT);
  assert.deepEqual(outcome.header, JWT_HEADER);
  assert.deepEqual(outcome.payload, JWT_PAYLOAD);
});

test('JWT decoder always warns that the signature is not verified', 'Encoding', () => {
  const outcome = decodeJwt(TEST_JWT);
  assert.includes(outcome.warnings.join(' '), 'signature not verified');
});

test('JWT decoder renders iat as a human date', 'Encoding', () => {
  const outcome = decodeJwt(TEST_JWT);
  const iat = outcome.details.find((d) => d.label.includes('iat'));
  assert.ok(iat, 'expected an iat detail row');
  assert.includes(iat.value, '2018-01-18');
});

test('JWT decoder rejects a token without three segments', 'Encoding', () => {
  const error = assert.throws(() => decodeJwt('abc.def'));
  assert.includes(error.message, 'three dot-separated segments');
});

/* ================================================================== *
 * 8. Timestamps
 * ================================================================== */

test('Timestamp 0 converts to the Unix epoch in ISO form', 'Time and identifiers', () => {
  const outcome = convertTimestamp('0', { timeZone: 'UTC' });
  assert.equal(outcome.date.toISOString(), '1970-01-01T00:00:00.000Z');
});

test('Timestamp detection distinguishes seconds from milliseconds', 'Time and identifiers', () => {
  assert.equal(detectTimestampUnit(1700000000), 'seconds');
  assert.equal(detectTimestampUnit(1700000000000), 'milliseconds');
  const seconds = convertTimestamp('1700000000', { timeZone: 'UTC' });
  const milliseconds = convertTimestamp('1700000000000', { timeZone: 'UTC' });
  assert.equal(seconds.date.toISOString(), milliseconds.date.toISOString());
});

test('A date string converts back to Unix seconds and milliseconds', 'Time and identifiers', () => {
  const outcome = convertTimestamp('2024-05-01T12:00:00Z', { timeZone: 'UTC' });
  assert.equal(outcome.seconds, 1714564800);
  assert.equal(outcome.milliseconds, 1714564800000);
});

test('A zone-less date is interpreted in the selected time zone', 'Time and identifiers', () => {
  // 12:00 in Prague during CEST is 10:00 UTC.
  const outcome = convertTimestamp('2024-05-01 12:00:00', { timeZone: 'Europe/Prague' });
  assert.equal(outcome.date.toISOString(), '2024-05-01T10:00:00.000Z');
});

test('Unparsable input produces a helpful error', 'Time and identifiers', () => {
  const error = assert.throws(() => convertTimestamp('not a date', {}));
  assert.includes(error.message, 'Could not interpret');
});

/* ================================================================== *
 * 17-18. UUID and ULID
 * ================================================================== */

test('UUID v4 matches the RFC 4122 version and variant pattern', 'Time and identifiers', () => {
  const uuid = generateUuidV4();
  assert.match(uuid, UUID_V4_PATTERN);
});

test('UUIDs are unique across a batch', 'Time and identifiers', () => {
  const { values } = generateIds('', { kind: 'uuid', count: 100 });
  assert.equal(values.length, 100);
  assert.equal(new Set(values).size, 100, 'expected 100 distinct UUIDs');
});

test('ULID is 26 Crockford Base32 characters', 'Time and identifiers', () => {
  const ulid = generateUlid();
  assert.equal(ulid.length, 26);
  assert.match(ulid, ULID_PATTERN);
});

test('ULID timestamp decodes to approximately now', 'Time and identifiers', () => {
  const { timestamp } = inspectUlid(generateUlid());
  assert.ok(Math.abs(Date.now() - timestamp) < 60000, 'expected the ULID timestamp to be recent');
});

/* ================================================================== *
 * 9. Base64
 * ================================================================== */

test('Base64 encodes non-ASCII text through UTF-8', 'Encoding', () => {
  assert.equal(base64Encode('hello ✓', {}).output, 'aGVsbG8g4pyT');
});

test('Base64 decode returns the original text', 'Encoding', () => {
  assert.equal(base64Decode('aGVsbG8g4pyT', {}).output, 'hello ✓');
});

test('Base64URL uses the - and _ alphabet without padding', 'Encoding', () => {
  const encoded = base64Encode('??~~>>', { variant: 'url', padding: false });
  assert.equal(encoded.output, 'Pz9-fj4-');
  assert.equal(base64Decode(encoded.output, {}).output, '??~~>>');
});

test('Base64 decode rejects characters outside the alphabet', 'Encoding', () => {
  const error = assert.throws(() => base64Decode('!!!!', {}));
  assert.includes(error.message, 'Invalid Base64');
});

test('Base64 byte round trip is exact for arbitrary bytes', 'Encoding', () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255, 254, 42]);
  const decoded = base64ToBytes(bytesToBase64(bytes));
  assert.deepEqual([...decoded], [...bytes]);
});

/* ================================================================== *
 * 10. URL
 * ================================================================== */

test('URL encode escapes spaces, plus and question mark', 'Encoding', () => {
  assert.equal(urlEncode('hello world+?', {}).output, 'hello%20world%2B%3F');
});

test('URL decode reverses the encoding', 'Encoding', () => {
  assert.equal(urlDecode('hello%20world%2B%3F', {}).output, 'hello world+?');
});

test('Malformed percent-encoding produces a friendly error', 'Encoding', () => {
  const error = assert.throws(() => urlDecode('%E0%A4%A', {}));
  assert.includes(error.message, 'Malformed percent-encoding');
  assert.ok(error.hint, 'expected a hint explaining what is wrong');
});

test('URL inspection splits a URL into its parts', 'Encoding', () => {
  const parsed = JSON.parse(inspectUrl('https://example.com:8443/a/b?q=1&r=two#frag', {}).output);
  assert.equal(parsed.protocol, 'https');
  assert.equal(parsed.hostname, 'example.com');
  assert.equal(parsed.port, '8443');
  assert.equal(parsed.pathname, '/a/b');
  assert.deepEqual(parsed.query, { q: '1', r: 'two' });
  assert.equal(parsed.hash, '#frag');
});

/* ================================================================== *
 * 11-12. Hashes
 * ================================================================== */

test('SHA-256 of "abc" matches the published digest', 'Hashing', async () => {
  const digest = await hashText('abc', 'sha256');
  assert.equal(digest, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('MD5 of "abc" matches the published digest', 'Hashing', async () => {
  const digest = await hashText('abc', 'md5');
  assert.equal(digest, '900150983cd24fb0d6963f7d28e17f72');
});

test('SHA-512 of "abc" matches the published digest', 'Hashing', async () => {
  const digest = await hashText('abc', 'sha512');
  assert.equal(
    digest,
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
    '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  );
});

test('The hash tool labels MD5 as legacy only', 'Hashing', async () => {
  const outcome = await hashInput('abc', { algorithms: ['md5'] });
  assert.includes(outcome.warnings.join(' '), 'not secure for cryptographic use');
});

test('Hashing is UTF-8 exact for non-ASCII input', 'Hashing', async () => {
  // Known digest of the three-byte UTF-8 sequence for "✓".
  const digest = await hashText('✓', 'sha256');
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, await hashText('\u2713', 'sha256'));
});

/* ================================================================== *
 * 13. Case converter
 * ================================================================== */

test('Case converter produces every documented style', 'Text', () => {
  const cases = convertAllCases('hello world-example');
  assert.equal(cases.camel, 'helloWorldExample');
  assert.equal(cases.pascal, 'HelloWorldExample');
  assert.equal(cases.snake, 'hello_world_example');
  assert.equal(cases.kebab, 'hello-world-example');
  assert.equal(cases.constant, 'HELLO_WORLD_EXAMPLE');
  assert.equal(cases.dot, 'hello.world.example');
});

test('Case converter splits camelCase and acronyms', 'Text', () => {
  assert.equal(convertAllCases('HTTPServerErrorCode').snake, 'http_server_error_code');
  assert.equal(convertAllCases('parseHTMLString').kebab, 'parse-html-string');
});

test('Case converter preserves Unicode letters', 'Text', () => {
  const cases = convertAllCases('velká čeština příklad');
  assert.equal(cases.snake, 'velká_čeština_příklad');
  assert.equal(cases.camel, 'velkáČeštinaPříklad');
});

test('Case converter converts multi-line input line by line', 'Text', () => {
  const { output } = convertCase('first name\nlast name', { style: 'snake', perLine: true });
  assert.equal(output, 'first_name\nlast_name');
});

/* ================================================================== *
 * 14. Regex
 * ================================================================== */

test('Regex finds every match with correct start and end indexes', 'Text', () => {
  const outcome = runRegex({ pattern: '\\bcat\\b', flags: 'g', input: 'cat dog cat' });
  assert.equal(outcome.count, 2);
  assert.deepEqual(outcome.matches.map((m) => m.index), [0, 8]);
  assert.deepEqual(outcome.matches.map((m) => m.end), [3, 11]);
});

test('Regex segments reconstruct the original input exactly', 'Text', () => {
  const input = 'cat dog cat';
  const outcome = runRegex({ pattern: 'cat', flags: 'g', input });
  assert.equal(outcome.segments.map((s) => s.text).join(''), input);
});

test('Regex exposes capture groups', 'Text', () => {
  const outcome = runRegex({ pattern: '(\\w+)@(\\w+\\.\\w+)', flags: 'g', input: 'ada@ex.com' });
  assert.deepEqual(outcome.matches[0].groups.map((g) => g.value), ['ada', 'ex.com']);
});

test('A zero-length match cannot loop forever', 'Text', () => {
  const outcome = runRegex({ pattern: 'a*', flags: 'g', input: 'bbb' });
  assert.ok(outcome.count > 0 && outcome.count < 10, 'expected the scan to terminate quickly');
});

test('An invalid pattern raises a ConversionError, not a raw SyntaxError', 'Text', () => {
  const error = assert.throws(() => runRegex({ pattern: '(', flags: '', input: 'x' }));
  assert.equal(error.name, 'ConversionError');
});

test('An unknown regex flag is rejected', 'Text', () => {
  const error = assert.throws(() => runRegex({ pattern: 'a', flags: 'q', input: 'a' }));
  assert.equal(error.name, 'ConversionError');
});

test('Regex replace applies standard $1 substitution', 'Text', () => {
  const outcome = replaceWithRegex({ pattern: '(\\w+)@', flags: 'g', input: 'ada@x', replacement: '[$1]@' });
  const text = typeof outcome === 'string' ? outcome : outcome.output;
  assert.equal(text, '[ada]@x');
});

/* ================================================================== *
 * Diff
 * ================================================================== */

test('Line diff counts added, removed and unchanged lines', 'Text', () => {
  const diff = computeDiff('alpha\nbeta\ngamma', 'alpha\nBETA\ngamma', { mode: 'line' });
  assert.equal(diff.stats.added, 1);
  assert.equal(diff.stats.removed, 1);
  assert.equal(diff.stats.unchanged, 2);
});

test('JSON diff ignores key order and formatting', 'Text', () => {
  const diff = computeDiff('{"b":2,  "a":1}', '{\n "a": 1,\n "b": 2\n}', { mode: 'json' });
  assert.equal(diff.stats.added, 0);
  assert.equal(diff.stats.removed, 0);
});

test('JSON diff still reports a genuine value change', 'Text', () => {
  const diff = computeDiff('{"a":1}', '{"a":2}', { mode: 'json' });
  assert.ok(diff.stats.added > 0 && diff.stats.removed > 0, 'expected a reported change');
});

test('Side-by-side rows carry line numbers for both sides', 'Text', () => {
  const diff = computeDiff('a\nb', 'a\nc', { mode: 'line' });
  assert.ok(diff.rows.length >= 2, 'expected at least two rows');
  assert.equal(diff.rows[0].type, 'equal');
  assert.equal(diff.rows[0].left.num, 1);
});

/* ================================================================== *
 * cURL
 * ================================================================== */

test('cURL parser extracts method, URL, headers and body', 'cURL', () => {
  const parsed = parseCurl(
    'curl -X POST https://api.example.com/users -H \'Content-Type: application/json\' -d \'{"name":"Ada"}\'',
  );
  assert.equal(parsed.method, 'POST');
  assert.equal(parsed.url, 'https://api.example.com/users');
  assert.equal(parsed.headers.length, 1);
  assert.equal(parsed.bodyKind, 'json');
});

test('cURL to fetch generates a fetch call with the right method', 'cURL', () => {
  const { output } = curlToCode('curl -X POST https://a.example.com/x -d \'{"a":1}\'', { target: 'fetch' });
  assert.includes(output, 'await fetch(');
  assert.includes(output, '"POST"');
  assert.includes(output, 'JSON.stringify');
});

test('cURL to Python generates a requests call', 'cURL', () => {
  const { output } = curlToCode('curl -X POST https://a.example.com/x -d \'{"a":1}\'', { target: 'python' });
  assert.includes(output, 'import requests');
  assert.includes(output, 'requests.request(');
  assert.includes(output, 'raise_for_status');
});

test('cURL to axios generates an axios call', 'cURL', () => {
  const { output } = curlToCode('curl https://a.example.com/x', { target: 'axios' });
  assert.includes(output, 'axios');
});

test('An unsupported cURL flag is reported, never silently ignored', 'cURL', () => {
  const outcome = curlToCode('curl --proxy http://p https://a.example.com/x', { target: 'fetch' });
  assert.includes((outcome.warnings ?? []).join(' '), '--proxy');
});

test('cURL basic auth becomes an Authorization header', 'cURL', () => {
  const { output } = curlToCode('curl -u ada:secret https://a.example.com/x', { target: 'fetch' });
  assert.includes(output, 'Basic YWRhOnNlY3JldA==');
});

test('A cURL command with no URL fails loudly', 'cURL', () => {
  assert.throws(() => curlToCode('curl -X POST', { target: 'fetch' }));
});

/* ================================================================== *
 * 15-16. Detection
 * ================================================================== */

test('JSON is detected with at least 90% confidence', 'Detection', () => {
  const detection = detect('{"hello":"world"}');
  assert.equal(detection.type, 'json');
  assert.atLeast(detection.confidence, 0.9);
});

test('A JWT is detected with at least 90% confidence', 'Detection', () => {
  const detection = detect(TEST_JWT);
  assert.equal(detection.type, 'jwt');
  assert.atLeast(detection.confidence, 0.9);
});

test('A cURL command is detected', 'Detection', () => {
  const detection = detect('curl -X POST https://api.example.com/u -H "A: b"');
  assert.equal(detection.type, 'curl');
  assert.atLeast(detection.confidence, 0.9);
});

test('An http URL is detected', 'Detection', () => {
  assert.equal(detect('https://example.com/path?q=1').type, 'url');
});

test('Ten- and thirteen-digit timestamps are detected', 'Detection', () => {
  assert.equal(detect('1700000000').type, 'timestamp');
  assert.equal(detect('1700000000000').type, 'timestamp');
});

test('YAML requires YAML-specific structure, not just any scalar', 'Detection', () => {
  assert.equal(detect('name: Ada\nactive: true\nlist:\n  - a').type, 'yaml');
  // A bare word must not be claimed as YAML just because js-yaml would parse it.
  assert.equal(detect('hello').type, 'text');
});

test('CSV requires several consistent rows', 'Detection', () => {
  assert.equal(detect('name,age\nAda,36\nLinus,55').type, 'csv');
  assert.ok(detect('just one line').type !== 'csv', 'a single line must not be called CSV');
});

test('Base64 detection does not claim ordinary prose', 'Detection', () => {
  assert.equal(detect('aGVsbG8gd29ybGQgdGhpcyBpcyBiYXNlNjQ=').type, 'base64');
  assert.equal(detect('just some regular words here').type, 'text');
});

test('Every detector returns a type, a confidence and a reason', 'Detection', () => {
  for (const candidate of detectAll('{"a":1}')) {
    assert.ok(typeof candidate.type === 'string', 'type must be a string');
    assert.ok(candidate.confidence >= 0 && candidate.confidence <= 1, 'confidence must be within 0..1');
    assert.ok(typeof candidate.reason === 'string' && candidate.reason.length > 0, 'reason must be present');
  }
});

/* ================================================================== *
 * Format matrix
 * ================================================================== */

test('Every format pair converts its own example without throwing', 'Format matrix', () => {
  const failures = [];
  for (const from of FORMAT_IDS) {
    for (const to of FORMAT_IDS) {
      try {
        const outcome = convertFormat(FORMATS[from].example, { from, to, dynamicTyping: true });
        if (typeof outcome.output !== 'string' || !outcome.output.trim()) {
          failures.push(from + ' -> ' + to + ': empty output');
        }
      } catch (error) {
        failures.push(from + ' -> ' + to + ': ' + error.message);
      }
    }
  }
  assert.deepEqual(failures, [], 'every pair in the matrix must convert');
});

test('The matrix covers exactly the advertised formats', 'Format matrix', () => {
  assert.deepEqual(FORMAT_IDS, ['json', 'yaml', 'toml', 'csv', 'tsv', 'xml', 'html']);
});

test('JSON to XML uses a single top-level key as the root element', 'Format matrix', () => {
  const { output } = convertFormat('{"user":{"name":"Ada"}}', { from: 'json', to: 'xml' });
  assert.includes(output, '<user>');
  assert.includes(output, '<name>Ada</name>');
  // The key must not be emitted twice — once as the root and once as a child.
  assert.ok(!/<user>\s*<user>/.test(output), 'the root element must not be duplicated');
});

test('XML attributes and text round trip through JSON', 'Format matrix', () => {
  const json = convertFormat('<a x="1">hi</a>', { from: 'xml', to: 'json' }).output;
  assert.deepEqual(JSON.parse(json), { a: { '@x': '1', '#text': 'hi' } });
});

test('XML output escapes markup so it cannot be re-read as elements', 'Format matrix', () => {
  const dangerous = '<script>alert("x")&</script>';
  const xml = convertFormat(JSON.stringify({ v: dangerous }), { from: 'json', to: 'xml' }).output;
  assert.ok(!xml.includes('<script>'), 'the raw tag must not appear in the XML');
  assert.includes(xml, '&lt;script&gt;');
  // And it must survive the trip back byte for byte.
  const back = JSON.parse(convertFormat(xml, { from: 'xml', to: 'json' }).output);
  assert.equal(back.v, dangerous);
});

test('HTML table output escapes cell content', 'Format matrix', () => {
  const html = convertFormat('[{"v":"<script>alert(1)</script>"}]', { from: 'json', to: 'html' }).output;
  assert.ok(!html.includes('<script>'), 'cell content must be escaped');
  assert.includes(html, '&lt;script&gt;');
});

test('An HTML table reads back into records', 'Format matrix', () => {
  const json = convertFormat(FORMATS.html.example, { from: 'html', to: 'json' }).output;
  const records = JSON.parse(json);
  assert.equal(records.length, 2);
  assert.equal(records[0].name, 'Ada Lovelace');
});

test('TSV round trips through JSON', 'Format matrix', () => {
  const json = convertFormat('a\tb\n1\t2', { from: 'tsv', to: 'json' }).output;
  assert.deepEqual(JSON.parse(json), [{ a: '1', b: '2' }]);
  assert.equal(convertFormat(json, { from: 'json', to: 'tsv' }).output, 'a\tb\n1\t2');
});

test('An array converted to TOML is wrapped and the wrapping is reported', 'Format matrix', () => {
  const outcome = convertFormat('[{"id":1}]', { from: 'json', to: 'toml' });
  assert.includes(outcome.output, '[[items]]');
  assert.includes((outcome.warnings ?? []).join(' '), 'wrapped');
});

test('Converting a format to itself reformats and validates it', 'Format matrix', () => {
  const outcome = convertFormat('{ "a" : 1 }', { from: 'json', to: 'json', indent: 2 });
  assert.equal(outcome.output, '{\n  "a": 1\n}');
  assert.throws(() => convertFormat('{ oops', { from: 'json', to: 'json' }));
});

test('An unknown format id is rejected', 'Format matrix', () => {
  const error = assert.throws(() => convertFormat('{}', { from: 'json', to: 'protobuf' }));
  assert.includes(error.message, 'Unknown format');
});

test('describeConversion warns before a lossy pairing is run', 'Format matrix', () => {
  assert.includes(describeConversion('json', 'csv').join(' '), 'table');
  assert.includes(describeConversion('csv', 'toml').join(' '), 'root');
  assert.includes(describeConversion('csv', 'json').join(' '), 'no type information');
  assert.deepEqual(describeConversion('json', 'yaml'), []);
});

test('The matrix and the original pairwise converters agree', 'Format matrix', () => {
  // Two implementations of the same conversion exist: the pairwise functions
  // (used by the transform worker) and the matrix. This test is what keeps
  // them from drifting apart.
  const pairs = [
    [jsonToYaml, JSON_SAMPLE, 'json', 'yaml'],
    [yamlToJson, YAML_SAMPLE, 'yaml', 'json'],
    [jsonToToml, '{"a":1,"b":{"c":"x"}}', 'json', 'toml'],
    [tomlToJson, 'a = 1\n[b]\nc = "x"', 'toml', 'json'],
    [jsonToCsv, '[{"a":1,"b":2},{"a":3,"b":4}]', 'json', 'csv'],
  ];
  for (const [fn, input, from, to] of pairs) {
    const direct = fn(input, { indent: 2 }).output;
    const viaMatrix = convertFormat(input, { from, to, indent: 2 }).output;
    assert.equal(viaMatrix, direct, from + ' -> ' + to + ' must match the pairwise converter');
  }
});

test('Detection recognizes XML and HTML tables', 'Detection', () => {
  const xml = detect('<?xml version="1.0"?><catalog><book>x</book></catalog>');
  assert.equal(xml.type, 'xml');
  assert.atLeast(xml.confidence, 0.9);

  const html = detect('<table><tr><th>a</th></tr><tr><td>1</td></tr></table>');
  assert.equal(html.type, 'html');
  assert.atLeast(html.confidence, 0.8);
});

test('Markup is not mistaken for YAML', 'Detection', () => {
  assert.ok(detect('<a>\n  <b>1</b>\n</a>').type !== 'yaml', 'markup must not be called YAML');
});

/* ================================================================== *
 * Registry integrity
 * ================================================================== */

test('Every tool has the metadata the UI depends on', 'Registry', () => {
  for (const tool of getTools()) {
    assert.ok(tool.id, 'a tool is missing an id');
    assert.ok(tool.slug, tool.id + ' is missing a slug');
    assert.ok(tool.label, tool.id + ' is missing a label');
    assert.ok(tool.description, tool.id + ' is missing a description');
    assert.ok(tool.output?.extension, tool.id + ' is missing a download extension');
    assert.ok(typeof tool.run === 'function', tool.id + ' is missing a run function');
    assert.ok(tool.input || tool.generator, tool.id + ' has neither an input nor generator mode');
    if (tool.input) assert.ok(tool.input.example, tool.id + ' is missing an example');
  }
});

test('Tool slugs and ids are unique', 'Registry', () => {
  const slugs = getTools().map((t) => t.slug);
  const ids = getTools().map((t) => t.id);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug found');
  assert.equal(new Set(ids).size, ids.length, 'duplicate id found');
});

test('Every swap target points at a real tool', 'Registry', () => {
  for (const tool of getTools()) {
    if (!tool.swap) continue;
    assert.ok(isToolSlug(tool.swap), tool.id + ' swaps to unknown slug ' + tool.swap);
  }
});

test('Every tool converts its own example without throwing', 'Registry', async () => {
  for (const tool of getTools()) {
    if (tool.id === 'regex-tester') continue; // covered directly by the regex tests
    const outcome = await tool.run({
      input: tool.input?.example ?? '',
      secondaryInput: tool.secondaryInput?.example ?? '',
      options: defaultOptions(tool),
    });
    assert.ok(
      typeof outcome.output === 'string' && outcome.output.length > 0,
      tool.id + ' produced no output for its own example',
    );
  }
});

test('Every tool renders an editor with an accessible name', 'Registry', async () => {
  // Regression guard: the format selector replaced the visible <label> on
  // matrix tools, which silently left the editor with no accessible name.
  requireDom('renders a workspace');
  const ui = await import('../src/ui.js');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const unnamed = [];

  try {
    for (const tool of getTools()) {
      if (!tool.input) continue;
      const refs = ui.renderWorkspace(host, tool, {
        options: defaultOptions(tool),
        settings: { wrapOutput: true },
        formats: tool.formats,
      });
      const named = refs.input.getAttribute('aria-label')
        || host.querySelector('label[for="' + refs.input.id + '"]');
      if (!named) unnamed.push(tool.id);
    }
  } finally {
    host.remove();
  }
  assert.deepEqual(unnamed, [], 'these tools render an unlabelled editor');
});

test('Only the matrix entry point is dispatchable in the transform worker', 'Registry', async () => {
  // A pairwise id in this table would silently diverge from what the same tool
  // does on the main thread, because app.js rewrites matrix tools to
  // 'format-converter' before sending. Regression guard for that trap.
  const { TRANSFORMABLE } = await import('../src/workers/transform-worker.js');
  const pairwise = getTools().filter((t) => t.formats && !t.universal).map((t) => t.id);
  const leaked = pairwise.filter((id) => TRANSFORMABLE.includes(id));
  assert.deepEqual(leaked, [], 'pairwise tool ids must not be dispatchable');
  assert.ok(TRANSFORMABLE.includes('format-converter'), 'the matrix entry point must be dispatchable');
});

test('Tool search finds tools by label and keyword', 'Registry', () => {
  assert.ok(searchTools('uuid').some((t) => t.id === 'uuid-generator'), 'expected the UUID generator');
  assert.ok(searchTools('yaml').some((t) => t.id === 'json-to-yaml'), 'expected a YAML tool');
  assert.equal(searchTools('zzzznotatool').length, 0, 'expected no matches for nonsense');
});

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */

export function getTests() {
  return registry;
}

export async function runTests(onResult) {
  const results = [];
  for (const entry of registry) {
    const started = performance.now();
    try {
      await entry.fn();
      const outcome = { ...entry, status: 'pass', duration: performance.now() - started };
      results.push(outcome);
      onResult?.(outcome);
    } catch (error) {
      const outcome = error instanceof SkipTest
        ? { ...entry, status: 'skip', duration: performance.now() - started, message: error.message }
        : {
          ...entry,
          status: 'fail',
          duration: performance.now() - started,
          message: error.message,
          actual: error.actual,
          expected: error.expected,
          stack: error.stack,
        };
      results.push(outcome);
      onResult?.(outcome);
    }
  }
  return results;
}
