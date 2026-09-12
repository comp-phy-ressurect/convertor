/**
 * shape.js — structural type inference shared by every code generator.
 *
 * Inference is observational: it describes the sample you pasted, not the API
 * that produced it. A field that happens to be non-null in every sample row is
 * reported as non-nullable. Generators surface this caveat in their notes.
 *
 * Shape =
 *   | { kind: 'null' }
 *   | { kind: 'boolean' }
 *   | { kind: 'integer' }
 *   | { kind: 'number' }
 *   | { kind: 'string' }
 *   | { kind: 'unknown' }                                  // empty array / no samples
 *   | { kind: 'array', items: Shape }
 *   | { kind: 'object', fields: Array<{ key, shape, optional }> }
 *   | { kind: 'union', variants: Shape[] }
 */

export const UNKNOWN = { kind: 'unknown' };

export function inferShape(value) {
  if (value === null) return { kind: 'null' };
  switch (typeof value) {
    case 'boolean':
      return { kind: 'boolean' };
    case 'number':
      return Number.isInteger(value) ? { kind: 'integer' } : { kind: 'number' };
    case 'string':
      return { kind: 'string' };
    default:
      break;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'array', items: UNKNOWN };
    return { kind: 'array', items: value.map(inferShape).reduce(mergeShapes) };
  }
  if (typeof value === 'object') {
    const fields = Object.keys(value).map((key) => ({
      key,
      shape: inferShape(value[key]),
      optional: false,
    }));
    return { kind: 'object', fields };
  }
  return UNKNOWN;
}

/** Merge two observed shapes into the narrowest shape describing both. */
export function mergeShapes(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.kind === 'unknown') return b;
  if (b.kind === 'unknown') return a;
  if (shapeKey(a) === shapeKey(b)) return a;

  // integer widens to number.
  if ((a.kind === 'integer' && b.kind === 'number') || (a.kind === 'number' && b.kind === 'integer')) {
    return { kind: 'number' };
  }
  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', items: mergeShapes(a.items, b.items) };
  }
  if (a.kind === 'object' && b.kind === 'object') {
    return mergeObjects(a, b);
  }
  return unionOf([a, b]);
}

function mergeObjects(a, b) {
  const byKey = new Map();
  for (const field of a.fields) byKey.set(field.key, { ...field });
  for (const field of b.fields) {
    const existing = byKey.get(field.key);
    if (!existing) {
      // Present in one sample only => optional.
      byKey.set(field.key, { ...field, optional: true });
    } else {
      existing.shape = mergeShapes(existing.shape, field.shape);
      existing.optional = existing.optional || field.optional;
    }
  }
  // A key that "a" had but "b" lacked is optional too.
  const bKeys = new Set(b.fields.map((f) => f.key));
  for (const field of byKey.values()) {
    if (!bKeys.has(field.key) && a.fields.some((f) => f.key === field.key)) {
      field.optional = field.optional || !bKeys.has(field.key);
    }
  }
  return { kind: 'object', fields: [...byKey.values()] };
}

/** Flatten and de-duplicate a union. */
export function unionOf(shapes) {
  const flat = [];
  const seen = new Set();
  const push = (shape) => {
    if (shape.kind === 'union') {
      shape.variants.forEach(push);
      return;
    }
    const key = shapeKey(shape);
    if (seen.has(key)) return;
    seen.add(key);
    flat.push(shape);
  };
  shapes.forEach(push);
  if (flat.length === 1) return flat[0];
  return { kind: 'union', variants: flat };
}

/** Stable structural key, used for de-duplication and equality. */
export function shapeKey(shape) {
  switch (shape.kind) {
    case 'array':
      return 'array<' + shapeKey(shape.items) + '>';
    case 'object':
      return (
        'object{' +
        shape.fields
          .map((f) => f.key + (f.optional ? '?' : '') + ':' + shapeKey(f.shape))
          .sort()
          .join(',') +
        '}'
      );
    case 'union':
      return 'union(' + shape.variants.map(shapeKey).sort().join('|') + ')';
    default:
      return shape.kind;
  }
}

/** Split a union into { nullable, shape } so generators can emit T | null. */
export function extractNullable(shape) {
  if (shape.kind === 'null') return { nullable: true, shape: UNKNOWN };
  if (shape.kind !== 'union') return { nullable: false, shape };
  const variants = shape.variants.filter((v) => v.kind !== 'null');
  const nullable = variants.length !== shape.variants.length;
  if (variants.length === 0) return { nullable: true, shape: UNKNOWN };
  return { nullable, shape: variants.length === 1 ? variants[0] : { kind: 'union', variants } };
}

/* ------------------------------------------------------------------ *
 * Naming helpers used by TypeScript / Python / Go generators
 * ------------------------------------------------------------------ */

/** Split an arbitrary key into word tokens (handles camel, snake, kebab, spaces). */
export function words(input) {
  return String(input)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function pascalCase(input) {
  const parts = words(input);
  if (!parts.length) return '';
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

export function snakeCase(input) {
  return words(input).map((w) => w.toLowerCase()).join('_');
}

/** Turn a JSON key into a valid, unique type name for nested declarations. */
export function typeNameFrom(key, fallback = 'Item') {
  let name = pascalCase(key) || fallback;
  if (/^\d/.test(name)) name = 'N' + name;
  return name;
}

/** Return a name not already present in `used`, appending 2, 3, ... */
export function uniqueName(base, used) {
  let name = base;
  let counter = 2;
  while (used.has(name)) {
    name = base + counter;
    counter += 1;
  }
  used.add(name);
  return name;
}

/** Naive but predictable singularization for nested array element type names. */
export function singularize(name) {
  if (/ies$/i.test(name) && name.length > 4) return name.slice(0, -3) + 'y';
  if (/(s|x|z|ch|sh)es$/i.test(name)) return name.replace(/es$/i, '');
  if (/[^s]s$/i.test(name)) return name.slice(0, -1);
  return name;
}
