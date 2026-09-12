/**
 * codegen.js — JSON to TypeScript / Zod / Python dataclasses / Go structs /
 * SQL CREATE TABLE / JSON Schema.
 *
 * Everything here produces TEXT. Generated code is never executed, imported or
 * evaluated by this application.
 */

import {
  ConversionError,
  parseJson,
  stringifyJson,
  result,
} from './shared.js';
import {
  inferShape,
  mergeShapes,
  extractNullable,
  pascalCase,
  snakeCase,
  typeNameFrom,
  uniqueName,
  singularize,
} from './shape.js';
import {
  isSafeJsIdentifier,
  isSafePythonIdentifier,
  isGoKeyword,
  jsStringDouble,
  sqlIdentifier,
} from '../security.js';

const INFERENCE_NOTE =
  'Types are inferred from the sample you pasted. Fields that are never null in the sample are typed as non-nullable — review before using in production.';

/* ================================================================== *
 * 1. JSON -> TypeScript
 * ================================================================== */

export function jsonToTypeScript(input, options = {}) {
  const value = parseJson(input);
  const rootName = safeTypeName(options.rootName, 'Root');
  const style = options.style === 'type' ? 'type' : 'interface';
  const useUnknown = options.unknownType !== 'any';
  const shape = inferShape(value);

  const declarations = [];
  const used = new Set([rootName]);
  const emitted = new Map(); // structural key -> type name, so identical shapes are reused

  const rootType = tsTypeFor(shape, rootName, { declarations, used, emitted, style, useUnknown, isRoot: true });

  // When the root is not an object we still emit a named alias.
  if (!declarations.length || !declarations.some((d) => d.name === rootName)) {
    declarations.push({ name: rootName, text: 'export type ' + rootName + ' = ' + rootType + ';' });
  }

  const notes = [INFERENCE_NOTE];
  return result(declarations.map((d) => d.text).join('\n\n') + '\n', { notes });
}

function tsTypeFor(shape, nameHint, ctx) {
  switch (shape.kind) {
    case 'null':
      return 'null';
    case 'boolean':
      return 'boolean';
    case 'integer':
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'unknown':
      return ctx.useUnknown ? 'unknown' : 'any';
    case 'array': {
      const itemName = singularize(nameHint) || 'Item';
      const inner = tsTypeFor(shape.items, itemName, { ...ctx, isRoot: false });
      return needsParens(inner) ? '(' + inner + ')[]' : inner + '[]';
    }
    case 'union':
      return shape.variants.map((v) => tsTypeFor(v, nameHint, { ...ctx, isRoot: false })).join(' | ');
    case 'object': {
      if (shape.fields.length === 0) return 'Record<string, ' + (ctx.useUnknown ? 'unknown' : 'any') + '>';
      const structural = JSON.stringify(shape.fields.map((f) => [f.key, f.optional]));
      const existing = ctx.emitted.get(structural + declKeyOf(shape));
      if (existing) return existing;

      const name = ctx.isRoot ? nameHint : uniqueName(typeNameFrom(nameHint, 'Item'), ctx.used);
      if (ctx.isRoot) ctx.used.add(name);
      ctx.emitted.set(structural + declKeyOf(shape), name);

      const lines = shape.fields.map((field) => {
        const { nullable, shape: inner } = extractNullable(field.shape);
        // A field that was null in every sample carries no other type information.
        let type = nullable && inner.kind === 'unknown'
          ? 'null'
          : tsTypeFor(inner, field.key, { ...ctx, isRoot: false });
        if (nullable && type !== 'null') type += ' | null';
        const key = isSafeJsIdentifier(field.key) ? field.key : jsStringDouble(field.key);
        return '  ' + key + (field.optional ? '?' : '') + ': ' + type + ';';
      });

      const body = '{\n' + lines.join('\n') + '\n}';
      const text =
        ctx.style === 'type'
          ? 'export type ' + name + ' = ' + body + ';'
          : 'export interface ' + name + ' ' + body;
      // Nested declarations are emitted before the type that references them.
      ctx.declarations.push({ name, text });
      return name;
    }
    default:
      return 'unknown';
  }
}

function declKeyOf(shape) {
  return shape.fields.map((f) => f.key + ':' + f.shape.kind).join(',');
}

function needsParens(type) {
  return type.includes(' | ');
}

function safeTypeName(value, fallback) {
  const name = pascalCase(value || '') || fallback;
  return /^\d/.test(name) ? 'N' + name : name;
}

/* ================================================================== *
 * 2. JSON -> Zod
 * ================================================================== */

export function jsonToZod(input, options = {}) {
  const value = parseJson(input);
  const rootName = safeSchemaName(options.rootName, 'RootSchema');
  const shape = inferShape(value);
  const includeImport = options.includeImport !== false;
  const inferType = options.inferType !== false;

  const body = zodFor(shape, 0, options);
  const lines = [];
  if (includeImport) lines.push("import { z } from 'zod';", '');
  lines.push('export const ' + rootName + ' = ' + body + ';');
  if (inferType) {
    const typeName = rootName.replace(/Schema$/, '') || 'Root';
    lines.push('', 'export type ' + safeTypeName(typeName, 'Root') + ' = z.infer<typeof ' + rootName + '>;');
  }
  return result(lines.join('\n') + '\n', {
    notes: [INFERENCE_NOTE, 'Generated schema text is never executed by DevConvert.'],
  });
}

function zodFor(shape, depth, options) {
  const pad = '  '.repeat(depth + 1);
  const closePad = '  '.repeat(depth);
  switch (shape.kind) {
    case 'null':
      return 'z.null()';
    case 'boolean':
      return 'z.boolean()';
    case 'integer':
      return options.intAsInt === false ? 'z.number()' : 'z.number().int()';
    case 'number':
      return 'z.number()';
    case 'string':
      return 'z.string()';
    case 'unknown':
      return 'z.unknown()';
    case 'array':
      return 'z.array(' + zodFor(shape.items, depth, options) + ')';
    case 'union':
      return 'z.union([' + shape.variants.map((v) => zodFor(v, depth, options)).join(', ') + '])';
    case 'object': {
      if (!shape.fields.length) return 'z.object({})';
      const lines = shape.fields.map((field) => {
        const { nullable, shape: inner } = extractNullable(field.shape);
        let expr = nullable && inner.kind === 'unknown'
          ? 'z.null()'
          : zodFor(inner, depth + 1, options);
        if (nullable && expr !== 'z.null()') expr += '.nullable()';
        if (field.optional) expr += '.optional()';
        const key = isSafeJsIdentifier(field.key) ? field.key : jsStringDouble(field.key);
        return pad + key + ': ' + expr + ',';
      });
      return 'z.object({\n' + lines.join('\n') + '\n' + closePad + '})';
    }
    default:
      return 'z.unknown()';
  }
}

function safeSchemaName(value, fallback) {
  if (!value) return fallback;
  const name = String(value).replace(/[^A-Za-z0-9_$]/g, '');
  if (!name) return fallback;
  return /^\d/.test(name) ? '_' + name : name;
}

/* ================================================================== *
 * 3. JSON -> Python dataclass
 * ================================================================== */

export function jsonToPython(input, options = {}) {
  const value = parseJson(input);
  const rootName = safeTypeName(options.rootName, 'Root');
  const shape = inferShape(value);
  const classes = [];
  const used = new Set([rootName]);
  const needs = new Set();

  const rootType = pyTypeFor(shape, rootName, { classes, used, needs, isRoot: true, options });

  const header = ['from __future__ import annotations', '', 'from dataclasses import dataclass, field'];
  const typingImports = [...needs].filter((n) => n !== 'Any' || true).sort();
  if (typingImports.length) header.push('from typing import ' + typingImports.join(', '));
  header.push('');

  let body;
  if (classes.length) {
    body = classes.map((c) => c.text).join('\n\n');
  } else {
    body = rootName + ' = ' + rootType;
  }

  const notes = [INFERENCE_NOTE];
  if (!classes.length) {
    notes.push('The root value is not an object, so a type alias was generated instead of a dataclass.');
  }
  return result(header.join('\n') + '\n' + body + '\n', { notes });
}

function pyTypeFor(shape, nameHint, ctx) {
  switch (shape.kind) {
    case 'null':
      ctx.needs.add('Any');
      ctx.needs.add('Optional');
      return 'Optional[Any]';
    case 'boolean':
      return 'bool';
    case 'integer':
      return 'int';
    case 'number':
      return 'float';
    case 'string':
      return 'str';
    case 'unknown':
      ctx.needs.add('Any');
      return 'Any';
    case 'array':
      return 'list[' + pyTypeFor(shape.items, singularize(nameHint) || 'Item', { ...ctx, isRoot: false }) + ']';
    case 'union': {
      ctx.needs.add('Union');
      return (
        'Union[' +
        shape.variants.map((v) => pyTypeFor(v, nameHint, { ...ctx, isRoot: false })).join(', ') +
        ']'
      );
    }
    case 'object': {
      if (!shape.fields.length) {
        ctx.needs.add('Any');
        return 'dict[str, Any]';
      }
      // Keys that are not valid Python identifiers cannot become attributes.
      const invalid = shape.fields.filter((f) => !isSafePythonIdentifier(f.key));
      if (invalid.length && invalid.length === shape.fields.length) {
        ctx.needs.add('Any');
        return 'dict[str, Any]';
      }

      const name = ctx.isRoot ? nameHint : uniqueName(typeNameFrom(nameHint, 'Item'), ctx.used);
      const attributes = [];
      const optionalAttributes = [];

      for (const fieldDef of shape.fields) {
        if (!isSafePythonIdentifier(fieldDef.key)) continue;
        const { nullable, shape: inner } = extractNullable(fieldDef.shape);
        let type = pyTypeFor(inner, fieldDef.key, { ...ctx, isRoot: false });
        if (nullable && inner.kind !== 'null') {
          ctx.needs.add('Optional');
          type = 'Optional[' + type + ']';
        }
        const line = '    ' + snakeAttr(fieldDef.key) + ': ' + type;
        if (fieldDef.optional || nullable) {
          ctx.needs.add('Optional');
          const optionalType = type.startsWith('Optional[') ? type : 'Optional[' + type + ']';
          optionalAttributes.push('    ' + snakeAttr(fieldDef.key) + ': ' + optionalType + ' = None');
        } else if (type.startsWith('list[') || type.startsWith('dict[')) {
          // Mutable defaults are illegal in dataclasses; keep them required.
          attributes.push(line);
        } else {
          attributes.push(line);
        }
      }

      const skipped = invalid.length
        ? ['    # Skipped keys that are not valid Python identifiers: ' + invalid.map((f) => JSON.stringify(f.key)).join(', ')]
        : [];

      const lines = ['@dataclass', 'class ' + name + ':', ...skipped, ...attributes, ...optionalAttributes];
      if (!attributes.length && !optionalAttributes.length) lines.push('    pass');
      ctx.classes.push({ name, text: lines.join('\n') });
      return name;
    }
    default:
      ctx.needs.add('Any');
      return 'Any';
  }
}

function snakeAttr(key) {
  const name = snakeCase(key) || key;
  return isSafePythonIdentifier(name) ? name : key;
}

/* ================================================================== *
 * 4. JSON -> Go struct
 * ================================================================== */

export function jsonToGo(input, options = {}) {
  const value = parseJson(input);
  const rootName = safeGoName(options.rootName, 'Root');
  const packageName = (options.packageName || 'main').replace(/[^a-zA-Z0-9_]/g, '') || 'main';
  const shape = inferShape(value);
  const structs = [];
  const used = new Set([rootName]);
  const omitempty = options.omitempty !== false;

  const rootType = goTypeFor(shape, rootName, { structs, used, isRoot: true, omitempty });

  const parts = [];
  if (options.includePackage !== false) parts.push('package ' + packageName, '');
  if (structs.length) {
    // Root struct first, then nested declarations in discovery order.
    parts.push(structs.map((s) => s.text).join('\n\n'));
  } else {
    parts.push('type ' + rootName + ' ' + rootType);
  }
  return result(parts.join('\n') + '\n', {
    notes: [
      INFERENCE_NOTE,
      'Pointer types are not generated; nullable fields fall back to interface{} or the zero value.',
    ],
  });
}

function goTypeFor(shape, nameHint, ctx) {
  switch (shape.kind) {
    case 'null':
      return 'interface{}';
    case 'boolean':
      return 'bool';
    case 'integer':
      return 'int';
    case 'number':
      return 'float64';
    case 'string':
      return 'string';
    case 'unknown':
      return 'interface{}';
    case 'array':
      return '[]' + goTypeFor(shape.items, singularize(nameHint) || 'Item', { ...ctx, isRoot: false });
    case 'union':
      return 'interface{}';
    case 'object': {
      if (!shape.fields.length) return 'map[string]interface{}';
      const name = ctx.isRoot ? nameHint : uniqueName(safeGoName(nameHint, 'Item'), ctx.used);
      const rows = shape.fields.map((fieldDef) => {
        const { nullable, shape: inner } = extractNullable(fieldDef.shape);
        const type = nullable && inner.kind === 'unknown'
          ? 'interface{}'
          : goTypeFor(inner, fieldDef.key, { ...ctx, isRoot: false });
        const fieldName = exportedGoName(fieldDef.key, name);
        const tagParts = [fieldDef.key];
        if (ctx.omitempty && (fieldDef.optional || nullable)) tagParts.push('omitempty');
        return {
          name: fieldName,
          type,
          tag: '`json:"' + tagParts.join(',') + '"`',
        };
      });

      const nameWidth = Math.max(...rows.map((r) => r.name.length));
      const typeWidth = Math.max(...rows.map((r) => r.type.length));
      const lines = rows.map(
        (r) => '\t' + r.name.padEnd(nameWidth) + ' ' + r.type.padEnd(typeWidth) + ' ' + r.tag,
      );
      ctx.structs.push({ name, text: 'type ' + name + ' struct {\n' + lines.join('\n') + '\n}' });
      return name;
    }
    default:
      return 'interface{}';
  }
}

function safeGoName(value, fallback) {
  let name = pascalCase(value || '') || fallback;
  if (/^\d/.test(name)) name = 'X' + name;
  if (isGoKeyword(name.toLowerCase()) && name === name.toLowerCase()) name = pascalCase(name);
  return name;
}

const GO_INITIALISMS = new Set(['id', 'url', 'uri', 'api', 'http', 'https', 'json', 'xml', 'html', 'sql', 'uuid', 'ip', 'db']);

function exportedGoName(key, structName) {
  const name = pascalCase(key)
    .replace(/[A-Z][a-z0-9]*|[0-9]+/g, (part) =>
      GO_INITIALISMS.has(part.toLowerCase()) ? part.toUpperCase() : part,
    );
  let out = name || 'Field';
  if (/^\d/.test(out)) out = 'F' + out;
  // A field may not collide with its own struct name in Go.
  if (out === structName) out += 'Field';
  return out;
}

/* ================================================================== *
 * 5. JSON -> SQL CREATE TABLE
 * ================================================================== */

export const SQL_LIMITATIONS = [
  'Supports a flat JSON object or an array of similar flat objects.',
  'Nested objects and arrays are stored as JSONB (PostgreSQL) or TEXT (SQLite) — they are not normalized into related tables.',
  'Column types come from the sample only; widths, indexes, constraints and foreign keys are not inferred.',
  'Generated SQL is text. DevConvert never connects to a database and never executes it.',
];

export function jsonToSql(input, options = {}) {
  const value = parseJson(input);
  const dialect = options.dialect === 'postgres' ? 'postgres' : options.dialect === 'sqlite' ? 'sqlite' : 'postgres';
  const tableName = sanitizeTableName(options.tableName || 'my_table');
  const rows = Array.isArray(value) ? value : [value];

  if (!rows.length) {
    throw new ConversionError('The JSON array is empty — no columns can be inferred.');
  }
  rows.forEach((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new ConversionError(
        'Row ' + (index + 1) + ' is not an object. This tool expects a flat object or an array of flat objects.',
        { hint: 'Example: [{"id":1,"name":"Ada","active":true}]' },
      );
    }
  });

  const merged = rows.map(inferShape).reduce(mergeShapes);
  if (merged.kind !== 'object' || !merged.fields.length) {
    throw new ConversionError('No columns could be inferred from this JSON.');
  }

  const notes = [];
  const warnings = [];
  const columns = merged.fields.map((fieldDef) => {
    const { nullable, shape } = extractNullable(fieldDef.shape);
    const type = sqlTypeFor(shape, dialect, fieldDef.key, notes);
    const isNullable = nullable || fieldDef.optional;
    return {
      name: fieldDef.key,
      type,
      nullable: isNullable,
    };
  });

  const primaryKey = options.primaryKey && options.primaryKey !== 'none'
    ? columns.find((c) => c.name === options.primaryKey)
    : columns.find((c) => c.name.toLowerCase() === 'id');

  const nameWidth = Math.max(...columns.map((c) => sqlIdentifier(c.name).length));
  const typeWidth = Math.max(...columns.map((c) => c.type.length));

  const lines = columns.map((column) => {
    const parts = [
      '    ' + sqlIdentifier(column.name).padEnd(nameWidth),
      column.type.padEnd(typeWidth),
    ];
    if (!column.nullable) parts.push('NOT NULL');
    if (primaryKey && column.name === primaryKey.name) parts.push('PRIMARY KEY');
    return parts.join(' ').replace(/\s+$/, '');
  });

  const statement =
    'CREATE TABLE ' + sqlIdentifier(tableName) + ' (\n' + lines.join(',\n') + '\n);';

  const header = [
    '-- Generated by DevConvert from a JSON sample. Review before running.',
    '-- Dialect: ' + (dialect === 'postgres' ? 'PostgreSQL' : 'SQLite'),
    '-- ' + SQL_LIMITATIONS[0],
  ].join('\n');

  if (!primaryKey) {
    notes.push('No "id" column was found, so no PRIMARY KEY was declared.');
  }
  warnings.push('NOT NULL was inferred from the sample only — a column that is never null in your sample may still be nullable in reality.');

  return result(header + '\n\n' + statement + '\n', {
    notes: notes.length ? [...new Set(notes)] : undefined,
    warnings,
  });
}

function sqlTypeFor(shape, dialect, key, notes) {
  const json = dialect === 'postgres' ? 'JSONB' : 'TEXT';
  switch (shape.kind) {
    case 'boolean':
      return dialect === 'postgres' ? 'BOOLEAN' : 'BOOLEAN';
    case 'integer':
      return dialect === 'postgres' ? 'BIGINT' : 'INTEGER';
    case 'number':
      return dialect === 'postgres' ? 'DOUBLE PRECISION' : 'REAL';
    case 'string':
      return 'TEXT';
    case 'null':
    case 'unknown':
      notes.push('Column "' + key + '" had no non-null sample value, so it defaults to TEXT.');
      return 'TEXT';
    case 'array':
    case 'object':
      notes.push('Column "' + key + '" holds nested data and is stored as ' + json + '.');
      return json;
    case 'union':
      notes.push('Column "' + key + '" mixes several types in the sample and is stored as TEXT.');
      return 'TEXT';
    default:
      return 'TEXT';
  }
}

function sanitizeTableName(name) {
  const cleaned = snakeCase(name) || 'my_table';
  return /^\d/.test(cleaned) ? 't_' + cleaned : cleaned;
}

/* ================================================================== *
 * 6. JSON -> JSON Schema
 * ================================================================== */

export function jsonToJsonSchema(input, options = {}) {
  const value = parseJson(input);
  const shape = inferShape(value);
  const notes = [INFERENCE_NOTE];
  const schema = schemaFor(shape, options, notes);

  const doc = {
    $schema: options.draft === '2020-12'
      ? 'https://json-schema.org/draft/2020-12/schema'
      : 'http://json-schema.org/draft-07/schema#',
    ...(options.title ? { title: String(options.title) } : {}),
    ...schema,
  };

  return result(stringifyJson(doc, 2) + '\n', { notes });
}

function schemaFor(shape, options, notes) {
  switch (shape.kind) {
    case 'null':
      return { type: 'null' };
    case 'boolean':
      return { type: 'boolean' };
    case 'integer':
      return { type: 'integer' };
    case 'number':
      return { type: 'number' };
    case 'string':
      return { type: 'string' };
    case 'unknown':
      notes.push('An empty array was found, so its "items" schema is unconstrained.');
      return {};
    case 'array':
      return { type: 'array', items: schemaFor(shape.items, options, notes) };
    case 'union': {
      const simple = shape.variants.every((v) => ['null', 'boolean', 'integer', 'number', 'string'].includes(v.kind));
      if (simple) {
        return { type: shape.variants.map((v) => v.kind) };
      }
      notes.push('A value mixed object/array types; "anyOf" is used and may be broader than your real contract.');
      return { anyOf: shape.variants.map((v) => schemaFor(v, options, notes)) };
    }
    case 'object': {
      const properties = {};
      const required = [];
      for (const fieldDef of shape.fields) {
        properties[fieldDef.key] = schemaFor(fieldDef.shape, options, notes);
        if (!fieldDef.optional) required.push(fieldDef.key);
      }
      const out = { type: 'object', properties };
      if (required.length) out.required = required;
      if (options.additionalProperties === false) out.additionalProperties = false;
      return out;
    }
    default:
      return {};
  }
}
