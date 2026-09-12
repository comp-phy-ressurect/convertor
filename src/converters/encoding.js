/**
 * encoding.js — Base64, URL encoding and JWT decoding.
 *
 * Everything here is byte-exact and local. The JWT decoder deliberately does
 * NOT verify signatures: verification needs the signing key, and fetching a
 * JWKS would mean sending your token to a third party. See decodeJwt().
 */

import {
  ConversionError,
  requireInput,
  stringifyJson,
  result,
} from './shared.js';

/* ------------------------------------------------------------------ *
 * Byte <-> Base64 primitives
 *
 * btoa() operates on "binary strings" and throws on any code point above
 * U+00FF, so it cannot encode "hello ✓" directly. We always go through
 * TextEncoder/TextDecoder and convert bytes ourselves.
 * ------------------------------------------------------------------ */

const B64_STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Encode raw bytes as Base64 / Base64URL. */
export function bytesToBase64(bytes, { urlSafe = false, padding = true } = {}) {
  const alphabet = urlSafe ? B64_URL : B64_STANDARD;
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : alphabet[b2 & 0x3f];
  }
  return padding ? out : out.replace(/=+$/, '');
}

const DECODE_TABLE = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_STANDARD.length; i += 1) table[B64_STANDARD.charCodeAt(i)] = i;
  // Base64URL shares the first 62 symbols and only differs in the last two.
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
})();

/** Decode Base64 or Base64URL (padded or not) into raw bytes. */
export function base64ToBytes(text) {
  const cleaned = String(text).replace(/\s+/g, '');
  const body = cleaned.replace(/=+$/, '');

  for (let i = 0; i < body.length; i += 1) {
    const code = body.charCodeAt(i);
    if (code > 127 || DECODE_TABLE[code] === -1) {
      throw new ConversionError(
        'Invalid Base64: unexpected character ' + JSON.stringify(body[i]) + ' at position ' + i + '.',
        { hint: 'Base64 uses A-Z a-z 0-9 + / (or - _ for Base64URL) and "=" padding.' },
      );
    }
  }
  if (body.length % 4 === 1) {
    throw new ConversionError('Invalid Base64: the input length is not a valid Base64 length.', {
      hint: 'A Base64 string never has a remainder of exactly one character.',
    });
  }

  const byteLength = Math.floor((body.length * 3) / 4);
  const bytes = new Uint8Array(byteLength);
  let position = 0;
  for (let i = 0; i < body.length; i += 4) {
    const c0 = DECODE_TABLE[body.charCodeAt(i)];
    const c1 = DECODE_TABLE[body.charCodeAt(i + 1)];
    const c2 = i + 2 < body.length ? DECODE_TABLE[body.charCodeAt(i + 2)] : -1;
    const c3 = i + 3 < body.length ? DECODE_TABLE[body.charCodeAt(i + 3)] : -1;
    bytes[position++] = (c0 << 2) | (c1 >> 4);
    if (c2 !== -1) bytes[position++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (c3 !== -1) bytes[position++] = ((c2 & 0x03) << 6) | c3;
  }
  return bytes;
}

export function textToBase64(text, options) {
  return bytesToBase64(new TextEncoder().encode(text), options);
}

export function base64ToText(text, { strict = true } = {}) {
  const bytes = base64ToBytes(text);
  try {
    return new TextDecoder('utf-8', { fatal: strict }).decode(bytes);
  } catch {
    throw new ConversionError('The decoded bytes are not valid UTF-8 text.', {
      hint: 'This Base64 probably holds binary data (an image, a key, a compressed blob) rather than text.',
    });
  }
}

/* ------------------------------------------------------------------ *
 * Base64 tool
 * ------------------------------------------------------------------ */

export function base64Encode(input, options = {}) {
  requireInput(input, 'text');
  const urlSafe = options.variant === 'url';
  const padding = options.padding !== false;
  const output = textToBase64(input, { urlSafe, padding });
  const notes = [];
  if (urlSafe) notes.push('Base64URL replaces "+" with "-" and "/" with "_".');
  if (!padding) notes.push('Padding "=" characters were stripped.');
  return result(output, { notes: notes.length ? notes : undefined });
}

export function base64Decode(input, options = {}) {
  requireInput(input, 'Base64 text');
  const output = base64ToText(input, { strict: options.strictUtf8 !== false });
  const notes = [];
  if (/[-_]/.test(input) && !/[+/]/.test(input)) notes.push('Input looked like Base64URL and was decoded accordingly.');
  return result(output, { notes: notes.length ? notes : undefined });
}

/* ------------------------------------------------------------------ *
 * URL encoding
 * ------------------------------------------------------------------ */

export function urlEncode(input, options = {}) {
  requireInput(input, 'text');
  const mode = options.mode || 'component';
  const output = mode === 'full' ? encodeURI(input) : encodeURIComponent(input);
  return result(output, {
    notes: [
      mode === 'full'
        ? 'encodeURI() leaves reserved URL characters such as : / ? # & = intact.'
        : 'encodeURIComponent() escapes every reserved character, which is what you want for a single query value.',
    ],
  });
}

export function urlDecode(input, options = {}) {
  requireInput(input, 'encoded text');
  const mode = options.mode || 'component';
  const source = options.plusAsSpace ? input.replace(/\+/g, ' ') : input;
  try {
    const output = mode === 'full' ? decodeURI(source) : decodeURIComponent(source);
    const notes = [];
    if (options.plusAsSpace) notes.push('"+" was treated as a space (application/x-www-form-urlencoded rule).');
    return result(output, { notes: notes.length ? notes : undefined });
  } catch {
    const bad = /%(?![0-9A-Fa-f]{2})/.exec(source);
    throw new ConversionError('Malformed percent-encoding in the input.', {
      hint: bad
        ? 'A "%" at position ' + bad.index + ' is not followed by two hexadecimal digits.'
        : 'A percent escape sequence does not form valid UTF-8.',
    });
  }
}

/** Whole-URL inspection: protocol, host, path, query params, hash. */
export function inspectUrl(input, options = {}) {
  requireInput(input, 'URL');
  const trimmed = input.trim();
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConversionError('This is not an absolute URL.', {
      hint: 'Include the scheme, for example https://example.com/path?q=1',
    });
  }

  const params = [...url.searchParams.entries()].map(([key, value]) => ({ key, value }));
  const parts = {
    protocol: url.protocol.replace(/:$/, ''),
    username: url.username || undefined,
    password: url.password ? '(present — not shown)' : undefined,
    host: url.host,
    hostname: url.hostname,
    port: url.port || undefined,
    pathname: url.pathname,
    search: url.search || undefined,
    query: params.length ? Object.fromEntries(params.map((p) => [p.key, p.value])) : undefined,
    hash: url.hash || undefined,
  };

  const clean = Object.fromEntries(Object.entries(parts).filter(([, v]) => v !== undefined));
  const details = [
    { label: 'Protocol', value: clean.protocol },
    { label: 'Host', value: url.host },
    { label: 'Path', value: url.pathname },
    { label: 'Query parameters', value: String(params.length) },
  ];
  if (url.hash) details.push({ label: 'Fragment', value: url.hash });

  const notes = [];
  if (url.username || url.password) {
    notes.push('This URL embeds credentials. They are shown redacted and are never transmitted anywhere.');
  }
  return result(stringifyJson(clean, options.indent ?? 2), { details, notes: notes.length ? notes : undefined });
}

/* ------------------------------------------------------------------ *
 * JWT decoding
 * ------------------------------------------------------------------ */

export const JWT_DISCLAIMER = 'Decoded only — signature not verified.';

const CLAIM_DESCRIPTIONS = {
  iss: 'Issuer',
  sub: 'Subject',
  aud: 'Audience',
  exp: 'Expires at',
  nbf: 'Not valid before',
  iat: 'Issued at',
  jti: 'JWT ID',
};

export function decodeJwt(input, options = {}) {
  requireInput(input, 'JWT');
  const token = input.trim().replace(/^Bearer\s+/i, '');
  const segments = token.split('.');

  if (segments.length !== 3) {
    throw new ConversionError(
      'A JWT has exactly three dot-separated segments; this input has ' + segments.length + '.',
      { hint: 'Format: header.payload.signature' },
    );
  }

  const header = decodeSegment(segments[0], 'header');
  const payload = decodeSegment(segments[1], 'payload');

  const details = [{ label: 'Verification', value: JWT_DISCLAIMER }];
  if (header.alg) details.push({ label: 'Algorithm', value: String(header.alg) });
  if (header.kid) details.push({ label: 'Key ID (kid)', value: String(header.kid) });

  const warnings = [JWT_DISCLAIMER];
  if (header.alg === 'none') {
    warnings.push('The header declares alg "none", meaning the token is unsigned. Treat it as untrusted.');
  }

  // Time claims are far more useful as human dates than as raw epochs.
  const now = Date.now();
  for (const claim of ['iat', 'nbf', 'exp']) {
    const value = payload[claim];
    if (typeof value !== 'number') continue;
    const date = new Date(value * 1000);
    if (Number.isNaN(date.getTime())) continue;
    let suffix = '';
    if (claim === 'exp') suffix = value * 1000 < now ? ' — EXPIRED' : ' — valid for ' + humanDelta(value * 1000 - now);
    if (claim === 'nbf' && value * 1000 > now) suffix = ' — not valid yet';
    details.push({
      label: CLAIM_DESCRIPTIONS[claim] + ' (' + claim + ')',
      value: date.toISOString() + suffix,
    });
    if (claim === 'exp' && value * 1000 < now) warnings.push('This token expired on ' + date.toISOString() + '.');
  }

  const indent = options.indent ?? 2;
  const output = [
    '// Header',
    stringifyJson(header, indent),
    '',
    '// Payload',
    stringifyJson(payload, indent),
    '',
    '// Signature (not verified, shown as-is)',
    segments[2] || '(empty)',
  ].join('\n');

  return result(output, { details, warnings, header, payload, signature: segments[2] });
}

function decodeSegment(segment, label) {
  if (!segment) {
    throw new ConversionError('The JWT ' + label + ' segment is empty.');
  }
  let text;
  try {
    text = base64ToText(segment, { strict: true });
  } catch (error) {
    throw new ConversionError('The JWT ' + label + ' is not valid Base64URL.', { cause: error });
  }
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object') {
      throw new Error('not an object');
    }
    return value;
  } catch {
    throw new ConversionError('The JWT ' + label + ' does not contain a JSON object.');
  }
}

function humanDelta(milliseconds) {
  const seconds = Math.round(Math.abs(milliseconds) / 1000);
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.round(seconds / 60) + ' min';
  if (seconds < 86400) return Math.round(seconds / 3600) + ' h';
  return Math.round(seconds / 86400) + ' days';
}

export const JWT_EXAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjoxNzE2MjM5MDIyfQ.dummy-signature-not-verified';

/**
 * Pick the action for a URL input: inspect an absolute URL, decode text that
 * already carries percent escapes, and encode anything else.
 */
export function detectUrlAction(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return 'encode';

  try {
    const url = new URL(trimmed);
    if (url.protocol) return 'inspect';
  } catch {
    /* not an absolute URL — fall through */
  }

  return /%[0-9A-Fa-f]{2}/.test(trimmed) ? 'decode' : 'encode';
}
