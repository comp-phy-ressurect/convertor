/**
 * vendor.js — single choke point for third-party code.
 *
 * All dependencies are vendored under /vendor as version-pinned ESM bundles so
 * that the application makes zero network requests at runtime. If you ever need
 * to swap a vendored file for a CDN copy (or vice versa), change ONLY the
 * import specifiers in this file — no converter imports a dependency directly.
 *
 * Pinned versions:
 *   js-yaml    4.1.0   (MIT)
 *   smol-toml  1.3.1   (BSD-3-Clause)
 *   papaparse  5.4.1   (MIT)
 *   diff       5.2.0   (BSD-3-Clause)
 *   ulid       2.3.0   (MIT)
 *   js-md5     0.8.3   (MIT)
 *
 * Privacy note: none of these libraries perform network I/O. User input is
 * never transmitted to a dependency provider.
 */

import * as jsyaml from '../vendor/js-yaml.mjs';
import * as smolToml from '../vendor/smol-toml.mjs';
import Papa from '../vendor/papaparse.mjs';
import * as jsdiff from '../vendor/diff.mjs';
import { factory as ulidFactory, monotonicFactory } from '../vendor/ulid.mjs';
import { md5 as jsmd5 } from '../vendor/js-md5.mjs';

export const YAML = {
  parse: (text) => jsyaml.load(text, { schema: jsyaml.DEFAULT_SCHEMA }),
  stringify: (value, options = {}) => jsyaml.dump(value, options),
  Exception: jsyaml.YAMLException,
};

export const TOML = {
  parse: (text) => smolToml.parse(text),
  stringify: (value) => smolToml.stringify(value),
  Error: smolToml.TomlError,
};

export const CSV = Papa;

export const Diff = {
  diffLines: jsdiff.diffLines,
  diffWords: jsdiff.diffWords,
  diffWordsWithSpace: jsdiff.diffWordsWithSpace,
  diffChars: jsdiff.diffChars,
  createTwoFilesPatch: jsdiff.createTwoFilesPatch,
};

/**
 * ulid@2.3.0 sniffs for `window.crypto` and otherwise tries `require('crypto')`,
 * which fails inside a Web Worker and inside ESM. We pass an explicit CSPRNG
 * built on the standard Web Crypto API so ULIDs are cryptographically random in
 * every context this app runs in.
 */
const secureRandomFloat = () => {
  const buffer = new Uint8Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 255;
};

export const ulid = ulidFactory(secureRandomFloat);
export const ulidMonotonic = monotonicFactory(secureRandomFloat);
export const md5 = jsmd5;

export const VENDOR_VERSIONS = Object.freeze({
  'js-yaml': '4.1.0',
  'smol-toml': '1.3.1',
  papaparse: '5.4.1',
  diff: '5.2.0',
  ulid: '2.3.0',
  'js-md5': '0.8.3',
});
