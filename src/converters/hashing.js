/**
 * hashing.js — MD5 and SHA family digests.
 *
 * SHA-1/256/384/512 go through the platform's Web Crypto implementation.
 * MD5 is not available in Web Crypto (by design — it is broken), so the
 * vendored js-md5 provides it purely as a legacy checksum.
 */

import { md5 as jsmd5 } from '../vendor.js';
import { ConversionError, requireInput, result } from './shared.js';

export const MD5_WARNING = 'Legacy checksum only — not secure for cryptographic use.';
export const SHA1_WARNING = 'SHA-1 is broken for collision resistance. Use it only for legacy compatibility.';

export const HASH_ALGORITHMS = [
  { id: 'sha256', label: 'SHA-256', subtle: 'SHA-256', recommended: true },
  { id: 'sha384', label: 'SHA-384', subtle: 'SHA-384' },
  { id: 'sha512', label: 'SHA-512', subtle: 'SHA-512' },
  { id: 'sha1', label: 'SHA-1', subtle: 'SHA-1', warning: SHA1_WARNING },
  { id: 'md5', label: 'MD5', subtle: null, warning: MD5_WARNING },
];

export function bytesToHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Hash raw bytes with any supported algorithm. */
export async function hashBytes(bytes, algorithmId = 'sha256') {
  const algorithm = HASH_ALGORITHMS.find((a) => a.id === algorithmId);
  if (!algorithm) {
    throw new ConversionError('Unknown hash algorithm: ' + algorithmId + '.');
  }
  if (algorithm.subtle) {
    if (!globalThis.crypto?.subtle) {
      throw new ConversionError(
        'Web Crypto is unavailable in this context.',
        { hint: 'crypto.subtle requires a secure context — use https:// or http://localhost.' },
      );
    }
    const digest = await globalThis.crypto.subtle.digest(algorithm.subtle, bytes);
    return bytesToHex(digest);
  }
  // MD5 — the vendored implementation works on bytes directly.
  return jsmd5(bytes);
}

export async function hashText(text, algorithmId = 'sha256') {
  return hashBytes(new TextEncoder().encode(String(text)), algorithmId);
}

/**
 * Tool entry point. Async, unlike most converters, because crypto.subtle is
 * promise based. `options.algorithms` selects which digests to emit.
 */
export async function hashInput(input, options = {}) {
  requireInput(input, 'text');
  const selected = normalizeSelection(options.algorithms, options.algorithm);
  const bytes = new TextEncoder().encode(input);

  const details = [];
  const warnings = [];
  for (const id of selected) {
    const algorithm = HASH_ALGORITHMS.find((a) => a.id === id);
    const digest = await hashBytes(bytes, id);
    details.push({ label: algorithm.label, value: options.uppercase ? digest.toUpperCase() : digest });
    if (algorithm.warning) warnings.push(algorithm.label + ': ' + algorithm.warning);
  }

  const width = Math.max(...details.map((d) => d.label.length));
  const output = details.map((d) => d.label.padEnd(width) + '  ' + d.value).join('\n');

  return result(output, {
    details,
    warnings: warnings.length ? warnings : undefined,
    notes: ['Input length: ' + bytes.length + ' bytes (UTF-8). Hashing happens entirely in this browser.'],
  });
}

/**
 * Hash a File/Blob. Files are read with FileReader/arrayBuffer locally; nothing
 * is uploaded. Large files are read in one shot, so the caller must enforce the
 * size policy before calling this.
 */
export async function hashFile(file, options = {}) {
  if (!file) throw new ConversionError('No file was provided.');
  const selected = normalizeSelection(options.algorithms, options.algorithm);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const details = [{ label: 'File', value: file.name + ' (' + bytes.length + ' bytes)' }];
  const warnings = [];
  for (const id of selected) {
    const algorithm = HASH_ALGORITHMS.find((a) => a.id === id);
    const digest = await hashBytes(bytes, id);
    details.push({ label: algorithm.label, value: options.uppercase ? digest.toUpperCase() : digest });
    if (algorithm.warning) warnings.push(algorithm.label + ': ' + algorithm.warning);
  }

  const rows = details.slice(1);
  const width = Math.max(...rows.map((d) => d.label.length));
  const output = [
    '# ' + file.name,
    ...rows.map((d) => d.label.padEnd(width) + '  ' + d.value),
  ].join('\n');

  return result(output, {
    details,
    warnings: warnings.length ? warnings : undefined,
    notes: ['The file was read locally with the File API and was not uploaded anywhere.'],
  });
}

function normalizeSelection(algorithms, single) {
  const list = Array.isArray(algorithms) && algorithms.length
    ? algorithms
    : [single || 'sha256'];
  const valid = list.filter((id) => HASH_ALGORITHMS.some((a) => a.id === id));
  return valid.length ? valid : ['sha256'];
}
