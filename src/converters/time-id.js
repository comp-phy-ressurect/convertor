/**
 * time-id.js — Unix timestamp conversion and UUID / ULID generation.
 *
 * Time zone handling uses Intl.DateTimeFormat exclusively; no tz database is
 * bundled and no network lookup happens. Identifiers come from Web Crypto, so
 * they are cryptographically random rather than Math.random based.
 */

import { ulid as makeUlid, ulidMonotonic } from '../vendor.js';
import { ConversionError, requireInput, result } from './shared.js';

/* ------------------------------------------------------------------ *
 * Unix timestamps
 * ------------------------------------------------------------------ */

/** Time zones offered in the UI. "local" resolves at render time. */
export const COMMON_TIME_ZONES = [
  'UTC',
  'local',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Prague',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
];

/**
 * Decide whether a bare number is seconds, milliseconds or microseconds.
 * Digit count is the only reliable signal: a 10-digit value lands in 2001-2286
 * when read as seconds, while a 13-digit value only makes sense as ms.
 */
export function detectTimestampUnit(value) {
  const digits = Math.abs(Math.trunc(value)).toString().length;
  if (digits <= 11) return 'seconds';
  if (digits <= 14) return 'milliseconds';
  if (digits <= 17) return 'microseconds';
  return 'nanoseconds';
}

export function timestampToDate(value, unit) {
  switch (unit) {
    case 'seconds':
      return new Date(value * 1000);
    case 'milliseconds':
      return new Date(value);
    case 'microseconds':
      return new Date(value / 1000);
    case 'nanoseconds':
      return new Date(value / 1e6);
    default:
      return new Date(value * 1000);
  }
}

/** Format a Date in a named zone. `local` means the browser's own zone. */
export function formatInZone(date, timeZone, { withZoneName = true } = {}) {
  const options = {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };
  if (timeZone && timeZone !== 'local') options.timeZone = timeZone;
  if (withZoneName) options.timeZoneName = 'short';
  try {
    return new Intl.DateTimeFormat('en-GB', options).format(date);
  } catch {
    // An unknown IANA zone should degrade rather than break the conversion.
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date) + ' (zone unavailable)';
  }
}

/** ISO 8601 with the offset of a given zone, e.g. 2024-05-01T12:00:00+02:00. */
export function isoInZone(date, timeZone) {
  if (!timeZone || timeZone === 'UTC') return date.toISOString();
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone === 'local' ? undefined : timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(date);
  } catch {
    return date.toISOString();
  }
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  const local = get('year') + '-' + get('month') + '-' + get('day') + 'T' + hour + ':' + get('minute') + ':' + get('second');
  const offset = zoneOffsetMinutes(date, timeZone);
  return local + formatOffset(offset);
}

function zoneOffsetMinutes(date, timeZone) {
  if (timeZone === 'local') return -date.getTimezoneOffset();
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return Math.round((asUtc - date.getTime()) / 60000);
  } catch {
    return 0;
  }
}

function formatOffset(minutes) {
  if (minutes === 0) return 'Z';
  const sign = minutes > 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
}

export function relativeToNow(date, now = Date.now()) {
  const deltaSeconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(deltaSeconds);
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, seconds] of units) {
    if (abs >= seconds || unit === 'second') {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return 'now';
}

/**
 * Convert either direction:
 *  - a bare number  -> ISO / human dates
 *  - a date string  -> Unix seconds and milliseconds
 */
export function convertTimestamp(input, options = {}) {
  requireInput(input, 'timestamp or date');
  const raw = input.trim();
  const timeZone = options.timeZone || 'UTC';
  const now = typeof options.now === 'number' ? options.now : Date.now();

  const numeric = /^[-+]?\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
  let date;
  let direction;
  let unit;

  if (numeric !== null) {
    direction = 'timestamp-to-date';
    unit = options.unit && options.unit !== 'auto' ? options.unit : detectTimestampUnit(numeric);
    date = timestampToDate(numeric, unit);
  } else {
    direction = 'date-to-timestamp';
    date = parseDateInput(raw, timeZone);
  }

  if (Number.isNaN(date.getTime())) {
    throw new ConversionError('Could not interpret "' + raw + '" as a timestamp or a date.', {
      hint: 'Try 1700000000, 1700000000000, or 2024-05-01T12:00:00Z.',
    });
  }

  const seconds = Math.floor(date.getTime() / 1000);
  const milliseconds = date.getTime();

  const details = [
    { label: 'ISO 8601 (UTC)', value: date.toISOString() },
    { label: 'Unix seconds', value: String(seconds) },
    { label: 'Unix milliseconds', value: String(milliseconds) },
    { label: 'Local time', value: formatInZone(date, 'local') },
    { label: timeZone === 'local' ? 'Selected zone (local)' : 'Selected zone (' + timeZone + ')', value: formatInZone(date, timeZone) },
    { label: 'ISO in selected zone', value: isoInZone(date, timeZone) },
    { label: 'Relative', value: relativeToNow(date, now) },
    { label: 'Day of week', value: new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: timeZone === 'local' ? undefined : timeZone }).format(date) },
  ];

  const notes = [];
  if (direction === 'timestamp-to-date') {
    notes.push('Interpreted the number as ' + unit + (options.unit && options.unit !== 'auto' ? ' (manual override).' : ' (auto-detected from digit count).'));
  } else {
    notes.push('Parsed the input as a date. Values without a zone offset are read in the selected zone where possible.');
  }

  const output = details.map((d) => d.label + ': ' + d.value).join('\n');
  return result(output, { details, notes, date, seconds, milliseconds, unit, direction });
}

/**
 * Date.parse treats "2024-05-01T12:00" as local time and "2024-05-01" as UTC,
 * which surprises everyone. We normalize zone-less input into the selected zone.
 */
function parseDateInput(raw, timeZone) {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw);

  if (hasZone) return new Date(raw);
  if ((dateOnly || naive) && timeZone && timeZone !== 'local') {
    const normalized = raw.replace(' ', 'T');
    const withSeconds = dateOnly ? normalized + 'T00:00:00' : normalized;
    // Guess the offset by probing the target zone at roughly that instant.
    const provisional = new Date(withSeconds + 'Z');
    const offset = zoneOffsetMinutes(provisional, timeZone);
    return new Date(provisional.getTime() - offset * 60000);
  }
  return new Date(raw.replace(' ', 'T'));
}

export function currentTimestamp() {
  const now = Date.now();
  return { seconds: Math.floor(now / 1000), milliseconds: now, iso: new Date(now).toISOString() };
}

/* ------------------------------------------------------------------ *
 * UUID / ULID
 * ------------------------------------------------------------------ */

export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** UUID v4 from the platform CSPRNG, with a Web Crypto fallback path. */
export function generateUuidV4() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // randomUUID needs a secure context; getRandomValues is available more widely.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  );
}

export function generateUlid({ monotonic = false } = {}) {
  return monotonic ? ulidMonotonic() : makeUlid();
}

/** Shared entry point for both generator tools. */
export function generateIds(_input, options = {}) {
  const kind = options.kind === 'ulid' ? 'ulid' : 'uuid';
  const count = clampCount(options.count);
  const uppercase = Boolean(options.uppercase);

  const values = [];
  for (let i = 0; i < count; i += 1) {
    let value = kind === 'ulid'
      ? generateUlid({ monotonic: options.monotonic })
      : generateUuidV4();
    if (kind === 'uuid') value = uppercase ? value.toUpperCase() : value;
    values.push(value);
  }

  const notes = kind === 'ulid'
    ? [
        'ULIDs are lexicographically sortable: the first 10 characters encode the millisecond timestamp.',
        options.monotonic
          ? 'Monotonic mode guarantees strictly increasing values within the same millisecond.'
          : 'Enable monotonic mode if you need strict ordering within a single millisecond.',
      ]
    : ['Version 4 UUIDs are random, generated here with the Web Crypto CSPRNG.'];

  return result(values.join('\n'), { notes, values, kind });
}

function clampCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1000, Math.max(1, Math.round(n)));
}

/** Decode the timestamp half of a ULID so the UI can show when it was made. */
export function inspectUlid(value) {
  const trimmed = String(value).trim().toUpperCase();
  if (!ULID_PATTERN.test(trimmed)) {
    throw new ConversionError('That is not a valid 26-character Crockford Base32 ULID.');
  }
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = 0;
  for (const char of trimmed.slice(0, 10)) {
    time = time * 32 + alphabet.indexOf(char);
  }
  return { timestamp: time, date: new Date(time) };
}
