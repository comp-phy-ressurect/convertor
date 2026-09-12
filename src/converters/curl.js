/**
 * curl.js — cURL command to fetch / axios / Python requests.
 *
 * The command is parsed with a small, deliberately BOUNDED shell tokenizer:
 * quoting, backslash escapes and line continuations are understood, but
 * expansion (`$VAR`, `$(...)`, backticks), pipes, redirections and subshells
 * are not. Anything outside that subset is reported instead of guessed at.
 *
 * Everything produced here is TEXT. The cURL command is never executed, no
 * request is ever made, and the generated code is never evaluated.
 */

import {
  ConversionError,
  requireInput,
  result,
  normalizeNewlines,
} from './shared.js';
import {
  jsStringDouble,
  pyString,
  commentSafe,
} from '../security.js';

/** Upper bound on input size: a pasted cURL command is never this long. */
const MAX_COMMAND_CHARS = 100000;

export const CURL_LIMITATIONS = [
  'Understands one cURL invocation: quoting, backslash escapes and backslash line continuations.',
  'Shell expansion is not evaluated — $VAR, ${VAR}, $(...) and backticks are passed through as literal text.',
  'Pipes, redirections, subshells, `&&` chains and multiple URLs in one command are not translated.',
  'Multipart uploads (-F/--form), @file data references, --config option files and client certificates are reported, not converted.',
  'Transport-only flags (-s, -v, -i, -o, --compressed, -k) have no direct equivalent in fetch or axios; they are listed as notes.',
  'The command is parsed as text and is never executed; no request is made by DevConvert.',
];

export const CURL_EXAMPLE = [
  'curl -X POST https://api.example.com/v1/users \\',
  "  -H 'Content-Type: application/json' \\",
  '  -H "Authorization: Bearer sk-demo-token" \\',
  '  -d \'{"name":"Ada Lovelace","email":"ada@example.com","roles":["admin","engineer"]}\'',
].join('\n');

/* ================================================================== *
 * 1. Tokenizer
 * ================================================================== */

/**
 * Split a command line into argv-style tokens.
 *
 * Quoting rules follow POSIX sh closely enough for cURL commands copied out
 * of browser devtools or API docs: single quotes are literal, double quotes
 * honour a handful of backslash escapes, and a backslash before a newline is
 * a line continuation rather than a token break.
 */
function tokenize(command) {
  const text = normalizeNewlines(command);
  if (text.length > MAX_COMMAND_CHARS) {
    throw new ConversionError('That command is too long to parse as a shell command.', {
      hint: 'This converter expects a single cURL invocation, not a script.',
    });
  }

  const tokens = [];
  let current = '';
  let started = false; // distinguishes an empty token ('' as an argument) from no token
  let index = 0;

  const push = () => {
    if (started) tokens.push(current);
    current = '';
    started = false;
  };

  while (index < text.length) {
    const char = text[index];

    if (char === '\\') {
      const next = text[index + 1];
      if (next === undefined) {
        // A trailing backslash is meaningless; treat it as literal text.
        current += '\\';
        started = true;
        index += 1;
      } else if (next === '\n') {
        index += 2; // line continuation: the token keeps going on the next line
      } else {
        current += next;
        started = true;
        index += 2;
      }
      continue;
    }

    if (char === "'") {
      const end = text.indexOf("'", index + 1);
      if (end === -1) throw unterminated("'", text, index);
      current += text.slice(index + 1, end);
      started = true;
      index = end + 1;
      continue;
    }

    if (char === '"') {
      const consumed = readDoubleQuoted(text, index);
      current += consumed.value;
      started = true;
      index = consumed.next;
      continue;
    }

    if (/\s/.test(char)) {
      push();
      index += 1;
      continue;
    }

    current += char;
    started = true;
    index += 1;
  }

  push();
  return tokens;
}

/** Read a double-quoted run starting at `start`, returning its text. */
function readDoubleQuoted(text, start) {
  let value = '';
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') return { value, next: index + 1 };
    if (char === '\\') {
      const next = text[index + 1];
      if (next === '\n') {
        index += 2;
        continue;
      }
      // Inside double quotes the shell only removes the backslash before
      // these characters; anywhere else it stays part of the string.
      if (next === '"' || next === '\\' || next === '$' || next === '`') {
        value += next;
        index += 2;
        continue;
      }
      value += '\\';
      index += 1;
      continue;
    }
    value += char;
    index += 1;
  }
  throw unterminated('"', text, start);
}

function unterminated(quote, text, offset) {
  const before = text.slice(0, offset);
  return new ConversionError('Unterminated ' + (quote === '"' ? 'double' : 'single') + ' quote in the command.', {
    line: before.split('\n').length,
    column: offset - before.lastIndexOf('\n'),
    hint: 'Check that every quote in the pasted command has a partner.',
  });
}

/* ================================================================== *
 * 2. Flag tables
 * ================================================================== */

const LONG_VALUE_FLAGS = new Map([
  ['--request', 'method'],
  ['--header', 'header'],
  ['--data', 'data'],
  ['--data-raw', 'data'],
  ['--data-binary', 'data'],
  ['--data-ascii', 'data'],
  ['--json', 'json'],
  ['--user', 'user'],
  ['--user-agent', 'userAgent'],
  ['--cookie', 'cookie'],
  ['--referer', 'referer'],
  ['--url', 'url'],
  ['--output', 'output'],
]);

const SHORT_VALUE_FLAGS = new Map([
  ['X', 'method'],
  ['H', 'header'],
  ['d', 'data'],
  ['u', 'user'],
  ['A', 'userAgent'],
  ['b', 'cookie'],
  ['e', 'referer'],
  ['o', 'output'],
]);

const LONG_BOOL_FLAGS = new Map([
  ['--location', 'location'],
  ['--insecure', 'insecure'],
  ['--head', 'head'],
  ['--get', 'get'],
  ['--compressed', 'compressed'],
  ['--silent', 'silent'],
  ['--verbose', 'verbose'],
  ['--include', 'include'],
]);

const SHORT_BOOL_FLAGS = new Map([
  ['L', 'location'],
  ['k', 'insecure'],
  ['I', 'head'],
  ['G', 'get'],
  ['s', 'silent'],
  ['v', 'verbose'],
  ['i', 'include'],
]);

/**
 * Flags this converter does not translate but which DO take an argument.
 * Knowing that lets the parser skip the argument instead of mistaking it for
 * the URL — `--proxy http://x https://api…` must still find the real URL.
 */
const LONG_UNSUPPORTED_WITH_VALUE = new Set([
  '--proxy', '--proxy-user', '--preproxy', '--noproxy',
  '--form', '--form-string', '--upload-file',
  '--config', '--cert', '--cert-type', '--key', '--key-type', '--pass',
  '--cacert', '--capath', '--pinnedpubkey',
  '--connect-timeout', '--max-time', '--max-redirs', '--retry', '--retry-delay',
  '--limit-rate', '--resolve', '--interface', '--unix-socket', '--abstract-unix-socket',
  '--oauth2-bearer', '--aws-sigv4', '--negotiate-delegation',
  '--write-out', '--cookie-jar', '--dump-header', '--trace', '--trace-ascii',
  '--data-urlencode', '--range', '--time-cond', '--proto', '--tlsv1.2', '--ciphers',
  '--output-dir', '--create-dirs', '--continue-at',
]);

const SHORT_UNSUPPORTED_WITH_VALUE = new Set(['F', 'T', 'K', 'c', 'D', 'w', 'E', 'x', 'y', 'Y', 'z', 'C', 'r', 'Z']);

/* ================================================================== *
 * 3. Parser
 * ================================================================== */

/**
 * Parse a cURL command into a request description.
 *
 * @param {string} command
 * @returns {{
 *   url: string,
 *   method: string,
 *   headers: Array<{name: string, value: string}>,
 *   body: string|null,
 *   bodyKind: 'raw'|'json'|'form'|null,
 *   auth: {user: string, password: string}|null,
 *   flags: object,
 *   unsupported: string[],
 * }}
 */
export function parseCurl(command) {
  requireInput(command, 'cURL command');

  const tokens = tokenize(command);
  // A pasted command often carries the shell prompt and the program name.
  while (tokens.length && (tokens[0] === '$' || tokens[0] === '>' || tokens[0] === '#')) tokens.shift();
  if (tokens.length && /^curl(\.exe)?$/i.test(tokens[0])) tokens.shift();

  const headers = [];
  const dataParts = [];
  const unsupported = [];
  const fileData = [];
  const extraUrls = [];
  const flags = {
    location: false,
    insecure: false,
    head: false,
    get: false,
    compressed: false,
    silent: false,
    verbose: false,
    include: false,
    output: null,
    userAgent: null,
    cookie: null,
    referer: null,
    jsonFlag: false,
    form: false,
    fileData,
    extraUrls,
  };

  let url = null;
  let explicitMethod = null;
  let auth = null;
  let index = 0;

  const markUnsupported = (name) => {
    // The multipart body cannot be translated, but -F still tells us the
    // request is a POST — that much is worth keeping.
    if (name === '-F' || name === '--form' || name === '--form-string') flags.form = true;
    if (!unsupported.includes(name)) unsupported.push(name);
  };

  const takeValue = (name, inline) => {
    if (inline !== null && inline !== undefined && inline !== '') return inline;
    if (index < tokens.length) {
      index += 1;
      return tokens[index - 1];
    }
    markUnsupported(name); // a flag without its argument cannot be honoured
    return null;
  };

  const applyValue = (kind, value) => {
    if (value === null) return;
    switch (kind) {
      case 'method':
        explicitMethod = value.trim().toUpperCase();
        break;
      case 'header':
        headers.push(parseHeader(value));
        break;
      case 'data':
        if (value.startsWith('@')) fileData.push(value);
        dataParts.push(value);
        break;
      case 'json':
        flags.jsonFlag = true;
        if (value.startsWith('@')) fileData.push(value);
        dataParts.push(value);
        break;
      case 'user':
        auth = splitUserInfo(value);
        break;
      case 'userAgent':
        flags.userAgent = value;
        break;
      case 'cookie':
        flags.cookie = value;
        break;
      case 'referer':
        flags.referer = value;
        break;
      case 'url':
        if (url === null) url = value;
        else extraUrls.push(value);
        break;
      case 'output':
        flags.output = value;
        break;
      default:
        break;
    }
  };

  while (index < tokens.length) {
    const token = tokens[index];
    index += 1;

    if (token === '--') continue; // end-of-options marker
    if (token === '' || !token.startsWith('-') || token === '-') {
      if (token === '' || token === '-') continue;
      if (url === null) url = token;
      else extraUrls.push(token);
      continue;
    }

    if (token.startsWith('--')) {
      let name = token;
      let inline = null;
      const equals = token.indexOf('=');
      if (equals > 2) {
        name = token.slice(0, equals);
        inline = token.slice(equals + 1);
      }

      if (LONG_VALUE_FLAGS.has(name)) {
        applyValue(LONG_VALUE_FLAGS.get(name), takeValue(name, inline));
        continue;
      }
      if (LONG_BOOL_FLAGS.has(name)) {
        flags[LONG_BOOL_FLAGS.get(name)] = true;
        continue;
      }
      markUnsupported(name);
      if (inline === null && LONG_UNSUPPORTED_WITH_VALUE.has(name) && index < tokens.length) {
        index += 1; // skip its argument so it is not mistaken for the URL
      }
      continue;
    }

    // Short options: cURL allows bundling (-sSL) and attached values (-XPOST).
    const chars = token.slice(1);
    for (let position = 0; position < chars.length; position += 1) {
      const char = chars[position];
      if (SHORT_VALUE_FLAGS.has(char)) {
        const inline = chars.slice(position + 1);
        applyValue(SHORT_VALUE_FLAGS.get(char), takeValue('-' + char, inline));
        break; // the rest of the token was the value
      }
      if (SHORT_BOOL_FLAGS.has(char)) {
        flags[SHORT_BOOL_FLAGS.get(char)] = true;
        continue;
      }
      markUnsupported('-' + char);
      if (SHORT_UNSUPPORTED_WITH_VALUE.has(char)) {
        const inline = chars.slice(position + 1);
        if (inline === '' && index < tokens.length) index += 1;
        break;
      }
    }
  }

  if (!url) {
    throw new ConversionError('No URL found in the cURL command.', {
      hint: 'Example: curl -X POST https://api.example.com/users -d \'{"name":"Ada"}\'',
    });
  }

  // cURL joins repeated -d values with "&" before sending them.
  let body = dataParts.length ? dataParts.join('&') : null;

  // -G moves the data into the query string and forces GET.
  if (flags.get && body !== null) {
    url += (url.includes('?') ? '&' : '?') + body;
    body = null;
  }

  // cURL still sends a body for `-X GET -d ...`; it is kept and the emitters warn.
  const method = resolveMethod(explicitMethod, flags, body);

  // Header shorthands are plain headers; -H wins when it sets the same one.
  addShorthandHeader(headers, 'User-Agent', flags.userAgent);
  addShorthandHeader(headers, 'Cookie', flags.cookie);
  addShorthandHeader(headers, 'Referer', flags.referer);
  if (flags.jsonFlag) {
    addShorthandHeader(headers, 'Content-Type', 'application/json');
    addShorthandHeader(headers, 'Accept', 'application/json');
  }

  return {
    url,
    method,
    headers,
    body,
    bodyKind: body === null ? null : detectBodyKind(body, flags.jsonFlag, headers),
    auth,
    flags,
    unsupported,
  };
}

function resolveMethod(explicitMethod, flags, body) {
  if (explicitMethod) return explicitMethod;
  if (flags.head) return 'HEAD';
  if (flags.get) return 'GET';
  if (flags.form) return 'POST';
  return body === null ? 'GET' : 'POST';
}

function parseHeader(raw) {
  // `-H "X-Trace;"` is cURL's way of sending a header with an empty value.
  if (/;\s*$/.test(raw) && !raw.includes(':')) {
    return { name: raw.replace(/;\s*$/, '').trim(), value: '' };
  }
  const colon = raw.indexOf(':');
  if (colon === -1) return { name: raw.trim(), value: '' };
  return { name: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim() };
}

function splitUserInfo(raw) {
  const colon = raw.indexOf(':');
  if (colon === -1) return { user: raw, password: '' };
  return { user: raw.slice(0, colon), password: raw.slice(colon + 1) };
}

function addShorthandHeader(headers, name, value) {
  if (value === null || value === undefined) return;
  const lower = name.toLowerCase();
  if (headers.some((header) => header.name.toLowerCase() === lower)) return;
  headers.push({ name, value });
}

const FORM_BODY = /^[^=&\s]+=[^&\s]*(?:&[^=&\s]+=[^&\s]*)*$/;

function detectBodyKind(body, jsonFlag, headers) {
  const trimmed = body.trim();
  if (looksLikeJson(trimmed)) return 'json';
  if (jsonFlag) return 'raw'; // --json was used but the payload is not valid JSON
  if (FORM_BODY.test(trimmed)) return 'form';
  const contentType = headers.find((header) => header.name.toLowerCase() === 'content-type');
  if (contentType && /urlencoded/i.test(contentType.value) && FORM_BODY.test(trimmed)) return 'form';
  return 'raw';
}

function looksLikeJson(trimmed) {
  if (!/^[{[]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch (error) {
    return false;
  }
}

/* ================================================================== *
 * 4. Base64 (for Basic auth headers)
 * ================================================================== */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * UTF-8 aware base64. btoa() throws on non-Latin-1 input and is unavailable
 * outside a browser, so the encoding is done by hand and behaves identically
 * in the app, in Node and in tests.
 */
export function toBase64(text) {
  const bytes = new TextEncoder().encode(String(text));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : null;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : null;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 === null ? 0 : b1) >> 4)];
    out += b1 === null ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 === null ? 0 : b2) >> 6)];
    out += b2 === null ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/* ================================================================== *
 * 5. Literal emitters
 * ================================================================== */

function jsLiteral(value, indent, ctx) {
  const pad = indent + '  ';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return String(value);
    ctx.lostNumbers = true;
    return 'null';
  }
  if (typeof value === 'string') return jsStringDouble(value);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const items = value.map((item) => pad + jsLiteral(item, pad, ctx) + ',');
    return ['[', ...items, indent + ']'].join('\n');
  }
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  const lines = entries.map(([key, item]) => pad + jsStringDouble(key) + ': ' + jsLiteral(item, pad, ctx) + ',');
  return ['{', ...lines, indent + '}'].join('\n');
}

function pyLiteral(value, indent, ctx) {
  const pad = indent + '    ';
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') {
    // Python has no literal for inf/nan, so fall back to json.loads instead.
    if (Number.isFinite(value)) return String(value);
    ctx.needsJson = true;
    return 'None';
  }
  if (typeof value === 'string') return pyString(value);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const items = value.map((item) => pad + pyLiteral(item, pad, ctx) + ',');
    return ['[', ...items, indent + ']'].join('\n');
  }
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  const lines = entries.map(([key, item]) => pad + pyString(key) + ': ' + pyLiteral(item, pad, ctx) + ',');
  return ['{', ...lines, indent + '}'].join('\n');
}

/* ================================================================== *
 * 6. Generation
 * ================================================================== */

const TARGETS = new Set(['fetch', 'axios', 'python']);

export function curlToCode(input, options = {}) {
  const target = options.target === undefined || options.target === null || options.target === ''
    ? 'fetch'
    : String(options.target);
  if (!TARGETS.has(target)) {
    throw new ConversionError('Unknown target "' + target + '".', {
      hint: 'Supported targets: fetch, axios, python.',
    });
  }

  const parsed = parseCurl(input);
  const ctx = { notes: [], warnings: [], needsJson: false, lostNumbers: false };

  collectSharedNotes(parsed, ctx, target);

  const headerEntries = mergeHeaders(parsed, ctx, target);
  const output =
    target === 'axios' ? emitAxios(parsed, headerEntries, ctx)
      : target === 'python' ? emitPython(parsed, headerEntries, ctx)
        : emitFetch(parsed, headerEntries, ctx);

  const details = [
    { label: 'Method', value: parsed.method },
    { label: 'URL', value: parsed.url },
    { label: 'Headers', value: String(headerEntries.length) },
    { label: 'Body', value: parsed.bodyKind || 'none' },
  ];

  return result(output, {
    notes: ctx.notes,
    warnings: ctx.warnings,
    details,
  });
}

function collectSharedNotes(parsed, ctx, target) {
  const flags = parsed.flags;

  for (const flag of parsed.unsupported) {
    ctx.warnings.push('Unsupported flag ignored: ' + flag);
  }
  for (const reference of flags.fileData) {
    ctx.warnings.push('Data read from a file (' + reference + ') cannot be inlined — load the file yourself.');
  }
  for (const extra of flags.extraUrls) {
    ctx.warnings.push('Only the first URL is converted; ignored: ' + extra);
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(parsed.url)) {
    ctx.notes.push('The URL has no scheme, so it is emitted exactly as written — add https:// if you meant an absolute URL.');
  }
  if (parsed.auth) {
    ctx.notes.push(target === 'python'
      ? '-u was converted to requests\' auth=(user, password) tuple.'
      : '-u was converted to an Authorization: Basic header, base64-encoded at conversion time.');
    ctx.warnings.push('The generated code contains the credentials from -u in plain text — move them to environment variables.');
  }
  if (flags.location) {
    ctx.notes.push(target === 'python'
      ? '-L is redundant: requests follows redirects by default.'
      : '-L / redirect following is the default in fetch, so no option is emitted.');
  } else if (target === 'python') {
    ctx.notes.push('requests follows redirects by default, while cURL only does so with -L — pass allow_redirects=False to match cURL exactly.');
  }
  if (flags.insecure) {
    ctx.warnings.push(target === 'python'
      ? '-k became verify=False, which disables TLS verification — do not ship that.'
      : '-k / --insecure has no equivalent in fetch or axios in the browser; TLS verification stays on.');
  }
  if (flags.compressed) {
    ctx.notes.push('--compressed needs no equivalent: fetch, axios and requests negotiate compression automatically.');
  }
  if (flags.silent || flags.verbose || flags.include) {
    ctx.notes.push('Output flags (-s, -v, -i) only affect cURL\'s terminal output and have no code equivalent.');
  }
  if (flags.output) {
    ctx.notes.push('-o wrote the response to a file; the generated code returns it in memory instead.');
  }
  if (flags.get && parsed.body === null && parsed.url.includes('?')) {
    ctx.notes.push('-G moved the -d data into the query string.');
  }
  if (flags.jsonFlag) {
    ctx.notes.push('--json implies Content-Type and Accept: application/json; both headers were added.');
  }
  if (parsed.body !== null && (parsed.method === 'GET' || parsed.method === 'HEAD')) {
    ctx.warnings.push('A body with ' + parsed.method + ' is unusual and fetch rejects it outright — check the command.');
  }
  if (flags.form) {
    ctx.warnings.push(target === 'python'
      ? '-F sends multipart/form-data; build the files= / data= arguments yourself — only the method was kept.'
      : '-F sends multipart/form-data; build a FormData body yourself — only the method was kept.');
  }
  if (parsed.bodyKind === 'form') {
    ctx.notes.push('The form body is sent verbatim, exactly as it appeared after -d — it is not re-encoded.');
  }
}

/** Header list to unique entries, plus the Authorization header from -u. */
function mergeHeaders(parsed, ctx, target) {
  const byLowerName = new Map();
  for (const header of parsed.headers) {
    const key = header.name.toLowerCase();
    if (byLowerName.has(key)) {
      ctx.warnings.push('Header "' + header.name + '" was given more than once; only the last value is kept.');
    }
    byLowerName.set(key, { name: header.name, value: header.value });
  }

  // Python passes credentials through auth=, so no header is synthesised there.
  if (parsed.auth && target !== 'python') {
    if (byLowerName.has('authorization')) {
      ctx.warnings.push('-u was ignored because an explicit Authorization header is already present.');
    } else {
      const encoded = toBase64(parsed.auth.user + ':' + parsed.auth.password);
      byLowerName.set('authorization', { name: 'Authorization', value: 'Basic ' + encoded });
    }
  }

  return [...byLowerName.values()];
}

function headerBlock(entries, indent, quote, unit = '  ') {
  const pad = indent + unit;
  const lines = entries.map((entry) => pad + quote(entry.name) + ': ' + quote(entry.value) + ',');
  return ['{', ...lines, indent + '}'].join('\n');
}

/** Trailing TODO block: the shell syntax a text converter cannot resolve. */
function todoBlock(parsed, prefix) {
  const lines = [
    '',
    prefix + ' TODO — cURL features this conversion does not cover:',
    prefix + '   - multipart uploads (-F / --form): build FormData (JS) or files= (requests)',
    prefix + '   - @file data references (-d @body.json): read the file explicitly',
    prefix + '   - shell expansion and subshells ($VAR, ${VAR}, $(...), backticks)',
    prefix + '   - option files (--config / -K) and ~/.curlrc defaults',
  ];
  if (parsed.unsupported.length) {
    lines.push(prefix + '   - flags dropped here: ' + commentSafe(parsed.unsupported.join(' ')));
  }
  if (parsed.flags.fileData.length) {
    lines.push(prefix + '   - file data seen: ' + commentSafe(parsed.flags.fileData.join(' ')));
  }
  if (parsed.flags.extraUrls.length) {
    lines.push(prefix + '   - extra URLs ignored: ' + commentSafe(parsed.flags.extraUrls.join(' ')));
  }
  if (parsed.flags.output) {
    lines.push(prefix + '   - cURL wrote the response to: ' + commentSafe(parsed.flags.output));
  }
  return lines;
}

/* ------------------------------ fetch ----------------------------- */

function emitFetch(parsed, headerEntries, ctx) {
  const lines = [
    '// Generated by DevConvert from a cURL command — review before running.',
    '',
    'const url = ' + jsStringDouble(parsed.url) + ';',
    '',
  ];

  let bodyExpression = null;
  if (parsed.body !== null) {
    if (parsed.bodyKind === 'json') {
      lines.push('const payload = ' + jsLiteral(JSON.parse(parsed.body.trim()), '', ctx) + ';');
      lines.push('');
      bodyExpression = 'JSON.stringify(payload)';
      if (ctx.lostNumbers) {
        ctx.warnings.push('The JSON body contains a number outside JavaScript\'s range; it was emitted as null.');
      }
    } else {
      bodyExpression = jsStringDouble(parsed.body);
    }
  }

  const init = ['  method: ' + jsStringDouble(parsed.method) + ','];
  if (headerEntries.length) {
    init.push('  headers: ' + headerBlock(headerEntries, '  ', jsStringDouble) + ',');
  }
  if (bodyExpression) init.push('  body: ' + bodyExpression + ',');

  lines.push('const response = await fetch(url, {');
  lines.push(...init);
  lines.push('});');
  lines.push('');
  lines.push('if (!response.ok) {');
  lines.push('  throw new Error("Request failed with status " + response.status);');
  lines.push('}');
  lines.push('');

  if (parsed.method === 'HEAD') {
    lines.push('// HEAD responses carry no body — only the status and headers are useful.');
    lines.push('console.log(response.status, Object.fromEntries(response.headers.entries()));');
  } else {
    lines.push('const data = await response.json();');
    lines.push('console.log(data);');
    ctx.notes.push('The response is parsed as JSON; use response.text() if the endpoint returns something else.');
  }

  lines.push(...todoBlock(parsed, '//'));
  return lines.join('\n') + '\n';
}

/* ------------------------------ axios ----------------------------- */

function emitAxios(parsed, headerEntries, ctx) {
  const lines = [
    '// Generated by DevConvert from a cURL command — review before running.',
    '',
    "import axios from 'axios';",
    '',
    'const url = ' + jsStringDouble(parsed.url) + ';',
    '',
  ];

  let dataExpression = null;
  if (parsed.body !== null) {
    if (parsed.bodyKind === 'json') {
      lines.push('const payload = ' + jsLiteral(JSON.parse(parsed.body.trim()), '', ctx) + ';');
      lines.push('');
      dataExpression = 'payload';
      if (ctx.lostNumbers) {
        ctx.warnings.push('The JSON body contains a number outside JavaScript\'s range; it was emitted as null.');
      }
    } else {
      dataExpression = jsStringDouble(parsed.body);
    }
  }

  const config = [
    '  method: ' + jsStringDouble(parsed.method.toLowerCase()) + ',',
    '  url,',
  ];
  if (headerEntries.length) {
    config.push('  headers: ' + headerBlock(headerEntries, '  ', jsStringDouble) + ',');
  }
  if (dataExpression) config.push('  data: ' + dataExpression + ',');

  lines.push('const response = await axios({');
  lines.push(...config);
  lines.push('});');
  lines.push('');
  lines.push('console.log(response.status, response.data);');

  ctx.notes.push('axios throws on non-2xx responses by default, so no status check is emitted.');
  lines.push(...todoBlock(parsed, '//'));
  return lines.join('\n') + '\n';
}

/* ----------------------------- python ----------------------------- */

function emitPython(parsed, headerEntries, ctx) {
  const body = [];
  let payloadKeyword = null;

  if (parsed.body !== null) {
    if (parsed.bodyKind === 'json') {
      const parsedBody = JSON.parse(parsed.body.trim());
      const literal = pyLiteral(parsedBody, '', ctx);
      if (ctx.needsJson) {
        // A value we cannot write as a Python literal — keep the raw text.
        body.push('payload = json.loads(' + pyString(parsed.body.trim()) + ')');
        ctx.notes.push('The JSON body holds a value with no Python literal form, so it is parsed with json.loads().');
      } else {
        body.push('payload = ' + literal);
      }
      body.push('');
      payloadKeyword = 'json=payload';
    } else {
      body.push('payload = ' + pyString(parsed.body));
      body.push('');
      payloadKeyword = 'data=payload';
    }
  }

  const imports = ['import requests'];
  if (ctx.needsJson) imports.unshift('import json');

  const lines = [
    '# Generated by DevConvert from a cURL command — review before running.',
    '',
    ...imports,
    '',
    'url = ' + pyString(parsed.url),
    '',
  ];

  const callArguments = [pyString(parsed.method), 'url'];
  if (headerEntries.length) {
    lines.push('headers = ' + headerBlock(headerEntries, '', pyString, '    '));
    lines.push('');
    callArguments.push('headers=headers');
  }
  lines.push(...body);
  if (payloadKeyword) callArguments.push(payloadKeyword);
  if (parsed.auth) {
    callArguments.push('auth=(' + pyString(parsed.auth.user) + ', ' + pyString(parsed.auth.password) + ')');
  }
  if (parsed.flags.insecure) callArguments.push('verify=False');

  lines.push('response = requests.request(' + callArguments.join(', ') + ')');
  lines.push('response.raise_for_status()');
  lines.push('');

  if (parsed.method === 'HEAD') {
    lines.push('# HEAD responses carry no body — only the status and headers are useful.');
    lines.push('print(response.status_code, dict(response.headers))');
  } else {
    lines.push('print(response.json())');
    ctx.notes.push('The response is parsed as JSON; use response.text if the endpoint returns something else.');
  }

  lines.push(...todoBlock(parsed, '#'));
  return lines.join('\n') + '\n';
}
