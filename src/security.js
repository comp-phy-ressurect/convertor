/**
 * security.js — hardening helpers shared by converters and UI.
 *
 * Rules enforced across this codebase:
 *  - No eval(), no new Function(), no dynamic import of user input.
 *  - Generated code (SQL, cURL translations, TS, Go, Python, Zod) is TEXT only
 *    and is never executed.
 *  - Untrusted text reaches the DOM through textContent / createTextNode only.
 */

/** Size policy (bytes). See README "Performance". */
export const SIZE_POLICY = Object.freeze({
  NORMAL_MAX: 2 * 1024 * 1024, //  2 MiB — converted without friction
  WARN_MAX: 10 * 1024 * 1024, // 10 MiB — warn, require explicit confirmation
});

export const SIZE_LEVEL = Object.freeze({
  NORMAL: 'normal',
  WARN: 'warn',
  REJECT: 'reject',
});

/** Byte length of a string as UTF-8. */
export function byteLength(text) {
  return new TextEncoder().encode(String(text ?? '')).length;
}

export function classifySize(bytes) {
  if (bytes <= SIZE_POLICY.NORMAL_MAX) return SIZE_LEVEL.NORMAL;
  if (bytes <= SIZE_POLICY.WARN_MAX) return SIZE_LEVEL.WARN;
  return SIZE_LEVEL.REJECT;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1);
  return rounded + ' ' + units[unit];
}

/* ------------------------------------------------------------------ *
 * DOM helpers — the only sanctioned way untrusted text reaches the page
 * ------------------------------------------------------------------ */

/** Create an element with safe text content and optional attributes. */
export function el(tag, { text, className, attrs, children } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (children) {
    for (const child of children) {
      if (child) node.appendChild(child);
    }
  }
  return node;
}

/** Remove every child of a node. */
export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/* ------------------------------------------------------------------ *
 * Identifier / literal escaping for generated code
 * ------------------------------------------------------------------ */

const JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** True when a key can be used as a bare JS/TS property name. */
export function isSafeJsIdentifier(name) {
  return JS_IDENTIFIER.test(name);
}

const PY_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

export function isSafePythonIdentifier(name) {
  return PY_IDENTIFIER.test(name) && !PY_KEYWORDS.has(name);
}

const GO_KEYWORDS = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
  'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
  'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var',
]);

export function isGoKeyword(name) {
  return GO_KEYWORDS.has(name);
}

/** Quote a JS/TS string literal safely (double quotes). */
export function jsStringDouble(value) {
  return JSON.stringify(String(value));
}

/** Quote a Python string literal safely. */
export function pyString(value) {
  // JSON string escapes are a subset of Python's, so this is safe for
  // double-quoted Python literals.
  return JSON.stringify(String(value));
}

/**
 * Quote an SQL identifier. Double quotes are the ANSI form used by both
 * PostgreSQL and SQLite; embedded double quotes are doubled.
 * The result is text only — this application never executes SQL.
 */
export function sqlIdentifier(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

/** Make a value safe to embed in a generated `/* ... *\/` or `#` comment. */
export function commentSafe(value) {
  return String(value)
    .replace(/\*\//g, '* /')
    .replace(/[\r\n]+/g, ' ');
}
