/**
 * xml.js — XML <-> JSON with a hand-written parser.
 *
 * WHY NOT DOMParser: `DOMParser` does not exist inside a Web Worker, and these
 * converters must be importable from src/workers/transform-worker.js and from
 * plain Node for the unit tests. So this file contains a real scanner plus a
 * recursive-descent parser over strings — no DOM API, no `document`, no eval,
 * no `new Function`, and no "parse it with one big regex" (that falls apart on
 * the first nested element).
 *
 * MAPPING CONVENTION (both directions)
 *
 *   <a><b>1</b></a>        -> rootName 'a', value { b: '1' }
 *   <a x="1">t</a>         -> { '@x': '1', '#text': 't' }   attributes are '@'-prefixed
 *   <r><i>1</i><i>2</i></r>-> { i: ['1', '2'] }             repeated siblings become an array
 *   <b>hi</b>              -> 'hi'                          text-only element is its string
 *   <a/> and <a></a>       -> null                          empty element
 *   <a>x<b/>y</a>          -> { b: null, '#text': 'xy' }    mixed content, plus a warning
 *
 * Deliberate asymmetries, because XML carries less structure than JSON does:
 *  - A single occurrence is a scalar, not a one-element array; `{ i: ['1'] }`
 *    therefore comes back as `{ i: '1' }`.
 *  - Mixed content is lossy: the text pieces are joined under '#text' and the
 *    original interleaving with the child elements is gone. Warned about.
 *  - `''` serializes to `<a></a>`, which parses back as null.
 *  - With `trim` on (the default) leading/trailing whitespace of a text node is
 *    not preserved. CDATA sections are exempt — they are always verbatim.
 *  - Everything is a string unless `dynamicTyping` is enabled, so "007" and
 *    "+1-555" survive intact.
 *
 * NAMESPACES are not resolved. A prefix is kept verbatim as part of the key
 * (`<ns:tag>` -> 'ns:tag'), and `xmlns` declarations stay ordinary attributes
 * ('@xmlns:ns'). Nothing here looks a prefix up or rewrites it.
 *
 * SECURITY
 *  - `<!DOCTYPE` is rejected outright rather than skipped. No DTD means no
 *    entity definitions, which is what closes off billion-laughs style entity
 *    expansion and XXE-style external entity fetches. Only the five predefined
 *    entities and numeric character references are recognised.
 *  - Nesting is capped at MAX_DEPTH in both directions so a pathological
 *    document cannot exhaust the JS stack.
 *  - Nothing is fetched, executed, or written to the DOM; see security.js.
 */

import {
  ConversionError,
  parseJson,
  requireInput,
  stringifyJson,
  normalizeNewlines,
  result,
} from './shared.js';

/** Nesting cap for both parsing and serializing — well past any real document. */
const MAX_DEPTH = 256;

/** The only entities that exist without a DTD. */
const PREDEFINED_ENTITIES = Object.freeze({
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
});

export const XML_EXAMPLE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<catalog updated="2024-05-01">',
  '  <library name="Bodleian" city="Oxford"/>',
  '  <book id="bk-101" lang="en">',
  '    <title>Structure and Interpretation of Computer Programs</title>',
  '    <author>Harold Abelson</author>',
  '    <tags>',
  '      <tag>lisp</tag>',
  '      <tag>compilers</tag>',
  '    </tags>',
  '  </book>',
  '  <book id="bk-102" lang="en">',
  '    <title>The Art of Computer Programming</title>',
  '    <author>Donald Knuth</author>',
  '  </book>',
  '</catalog>',
].join('\n');

/* ================================================================== *
 * 1. Names
 *
 * The XML Name production, minus the astral-plane ranges (they cannot be
 * expressed as single UTF-16 code units and never appear in practice here).
 * ':' is allowed anywhere because namespace prefixes are kept verbatim.
 * ================================================================== */

const NAME_START_RANGES =
  'A-Za-z_:' +
  '\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF' +
  '\u0370-\u037D\u037F-\u1FFF' +
  '\u200C\u200D\u2070-\u218F\u2C00-\u2FEF' +
  '\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD';

const NAME_START_CHAR = new RegExp('[' + NAME_START_RANGES + ']');

const NAME_CHAR = new RegExp(
  '[' + NAME_START_RANGES + '.0-9\u00B7\u0300-\u036F\u203F\u2040-]',
);

/** True when `name` can be written as an element or attribute name as-is. */
export function isValidXmlName(name) {
  const text = String(name);
  if (text === '') return false;
  if (!NAME_START_CHAR.test(text[0])) return false;
  for (let i = 1; i < text.length; i += 1) {
    if (!NAME_CHAR.test(text[i])) return false;
  }
  return true;
}

/* ================================================================== *
 * 2. Scanner
 *
 * One mutable cursor threaded through the parser. Line and column are tracked
 * as we go so every error can point at the character that caused it — after
 * the fact we would only have a byte offset, which is useless in a textarea.
 * ================================================================== */

function createScanner(text) {
  return { text, pos: 0, line: 1, lineStart: 0 };
}

function at(s) {
  return { line: s.line, column: s.pos - s.lineStart + 1 };
}

/**
 * Consume `n` characters. Newlines are located with indexOf rather than by
 * inspecting every character, so scanning stays linear on megabyte documents.
 */
function advance(s, n) {
  const end = s.pos + n;
  let idx = s.text.indexOf('\n', s.pos);
  while (idx !== -1 && idx < end) {
    s.line += 1;
    s.lineStart = idx + 1;
    idx = s.text.indexOf('\n', idx + 1);
  }
  s.pos = end;
}

function eof(s) {
  return s.pos >= s.text.length;
}

function peek(s, offset = 0) {
  return s.text[s.pos + offset];
}

function ahead(s, literal) {
  return s.text.startsWith(literal, s.pos);
}

function skipWhitespace(s) {
  const start = s.pos;
  let end = s.pos;
  while (end < s.text.length) {
    const ch = s.text[end];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') break;
    end += 1;
  }
  advance(s, end - start);
  return end - start;
}

/** Throw a positioned ConversionError; `where` defaults to the cursor. */
function fail(s, message, hint, where) {
  const spot = where || at(s);
  throw new ConversionError(message, { line: spot.line, column: spot.column, hint });
}

/** Keep hostile input out of error messages. */
function snip(text, max = 40) {
  const value = String(text);
  return value.length > max ? value.slice(0, max) + '…' : value;
}

/* ================================================================== *
 * 3. Low-level readers
 * ================================================================== */

function readName(s, what = 'name') {
  if (eof(s) || !NAME_START_CHAR.test(peek(s))) {
    fail(
      s,
      'Expected an XML ' + what + ' but found ' + describeHere(s) + '.',
      'Names must start with a letter or underscore.',
    );
  }
  const start = s.pos;
  let end = s.pos + 1;
  while (end < s.text.length && NAME_CHAR.test(s.text[end])) end += 1;
  const name = s.text.slice(start, end);
  advance(s, end - start);
  return name;
}

function describeHere(s) {
  if (eof(s)) return 'the end of the document';
  return '"' + snip(s.text.slice(s.pos, s.pos + 12), 12) + '"';
}

/**
 * Read one `&...;` reference. Without a DTD there is nothing to resolve an
 * unknown name against, so an unknown entity is an error rather than a silent
 * pass-through — silently keeping it would corrupt the value.
 */
function readReference(s) {
  const start = at(s);
  const semicolon = s.text.indexOf(';', s.pos + 1);
  // 32 is generous for "&#x10FFFF;" and every predefined name.
  if (semicolon === -1 || semicolon - s.pos > 32) {
    fail(
      s,
      'Unterminated entity reference — "&" must be written as "&amp;".',
      'Literal ampersands are not allowed in XML text.',
      start,
    );
  }
  const body = s.text.slice(s.pos + 1, semicolon);
  advance(s, semicolon - s.pos + 1);

  if (body[0] === '#') {
    const hex = body[1] === 'x' || body[1] === 'X';
    const digits = hex ? body.slice(2) : body.slice(1);
    const valid = hex ? /^[0-9A-Fa-f]+$/.test(digits) : /^[0-9]+$/.test(digits);
    const code = valid ? parseInt(digits, hex ? 16 : 10) : NaN;
    if (!valid || !isXmlCodePoint(code)) {
      fail(s, 'Invalid character reference "&' + snip(body) + ';".', undefined, start);
    }
    return String.fromCodePoint(code);
  }

  const resolved = PREDEFINED_ENTITIES[body];
  if (resolved === undefined) {
    fail(
      s,
      'Unknown entity "&' + snip(body) + ';".',
      'Only &lt; &gt; &amp; &quot; &apos; and numeric references such as &#65; are supported, because DTDs are not processed.',
      start,
    );
  }
  return resolved;
}

function isXmlCodePoint(code) {
  if (!Number.isFinite(code)) return false;
  if (code === 0x9 || code === 0xa || code === 0xd) return true;
  if (code >= 0x20 && code <= 0xd7ff) return true;
  if (code >= 0xe000 && code <= 0xfffd) return true;
  return code >= 0x10000 && code <= 0x10ffff;
}

/** Character data up to the next '<'. Entities are decoded as we pass them. */
function readCharData(s) {
  let out = '';
  const len = s.text.length;
  while (s.pos < len) {
    const ch = s.text[s.pos];
    if (ch === '<') break;
    if (ch === '&') {
      out += readReference(s);
      continue;
    }
    // Copy the plain run in one slice instead of one character at a time.
    let end = s.pos;
    while (end < len && s.text[end] !== '<' && s.text[end] !== '&') end += 1;
    out += s.text.slice(s.pos, end);
    advance(s, end - s.pos);
  }
  return out;
}

function readCdata(s) {
  const start = at(s);
  advance(s, '<![CDATA['.length);
  const end = s.text.indexOf(']]>', s.pos);
  if (end === -1) {
    fail(s, 'Unterminated CDATA section — no matching "]]>".', undefined, start);
  }
  const content = s.text.slice(s.pos, end);
  advance(s, end - s.pos + 3);
  return content;
}

function skipComment(s) {
  const start = at(s);
  advance(s, 4);
  const end = s.text.indexOf('-->', s.pos);
  if (end === -1) {
    fail(s, 'Unterminated comment — no matching "-->".', undefined, start);
  }
  advance(s, end - s.pos + 3);
}

function skipProcessingInstruction(s) {
  const start = at(s);
  advance(s, 2);
  const end = s.text.indexOf('?>', s.pos);
  if (end === -1) {
    fail(s, 'Unterminated processing instruction — no matching "?>".', undefined, start);
  }
  advance(s, end - s.pos + 2);
}

/**
 * Markup that is neither an element nor text. Returns false when the cursor is
 * on something the caller has to deal with itself.
 */
function skipMisc(s) {
  if (ahead(s, '<!--')) {
    skipComment(s);
    return true;
  }
  if (ahead(s, '<?')) {
    skipProcessingInstruction(s);
    return true;
  }
  if (ahead(s, '<!DOCTYPE') || ahead(s, '<!doctype')) {
    rejectDoctype(s);
  }
  return false;
}

function rejectDoctype(s) {
  fail(
    s,
    'This document contains a <!DOCTYPE declaration. DTDs and entity definitions are not processed.',
    'DTD support is deliberately absent: custom entity definitions are how "billion laughs" expansion and XXE external-entity attacks work. Remove the DOCTYPE and use only &lt; &gt; &amp; &quot; &apos; or numeric references.',
  );
}

/* ================================================================== *
 * 4. Parser — builds a small node tree, then maps it to plain JS
 * ================================================================== */

/**
 * Parse an XML document.
 *
 * @param {string} text
 * @param {{dynamicTyping?: boolean, trim?: boolean}} [options]
 * @returns {{ value: unknown, rootName: string, warnings: string[] }}
 */
export function parseXml(text, options = {}) {
  requireInput(text, 'XML input');
  const s = createScanner(stripBom(normalizeNewlines(text)));

  // Prolog: whitespace, the XML declaration, other PIs and comments.
  for (;;) {
    skipWhitespace(s);
    if (eof(s)) break;
    if (!ahead(s, '<')) {
      fail(
        s,
        'Text is not allowed before the root element (found ' + describeHere(s) + ').',
        'An XML document has exactly one root element and nothing but markup around it.',
      );
    }
    if (!skipMisc(s)) break;
  }

  if (eof(s)) {
    throw new ConversionError('This document has no root element.', {
      hint: 'A well-formed document needs one element, e.g. <root>…</root>.',
    });
  }
  if (ahead(s, '</')) {
    fail(s, 'Found a closing tag before any element was opened.');
  }
  if (ahead(s, '<!')) {
    fail(s, 'Unsupported declaration ' + describeHere(s) + '.');
  }

  const root = parseElement(s, 1);

  // Trailing misc only — a second root element is not a document.
  for (;;) {
    skipWhitespace(s);
    if (eof(s)) break;
    if (ahead(s, '<') && skipMisc(s)) continue;
    fail(
      s,
      'Unexpected content after the root element </' + root.name + '>: ' + describeHere(s) + '.',
      'XML allows only one root element; wrap the siblings in a single container element.',
    );
  }

  const warnings = [];
  const value = nodeToValue(root, options, warnings);
  return { value, rootName: root.name, warnings: dedupe(warnings) };
}

/**
 * One element, cursor sitting on its '<'.
 * @returns {{name: string, at: object, attrs: Array, elements: Array, texts: Array}}
 */
function parseElement(s, depth) {
  const openedAt = at(s);
  if (depth > MAX_DEPTH) {
    fail(
      s,
      'Element nesting is deeper than ' + MAX_DEPTH + ' levels.',
      'Documents that deep are almost always generated to exhaust the parser, so they are refused rather than parsed.',
      openedAt,
    );
  }

  advance(s, 1);
  const name = readName(s, 'element name');
  const node = { name, at: openedAt, attrs: [], elements: [], texts: [] };
  const seenAttrs = new Set();

  for (;;) {
    const spaced = skipWhitespace(s) > 0;
    if (ahead(s, '/>')) {
      advance(s, 2);
      return node;
    }
    if (peek(s) === '>') {
      advance(s, 1);
      break;
    }
    if (eof(s)) {
      fail(s, 'Unclosed start tag <' + name + '>.', undefined, openedAt);
    }
    if (!spaced) {
      fail(s, 'Expected whitespace before the next attribute of <' + name + '>.');
    }

    const attrAt = at(s);
    const attrName = readName(s, 'attribute name');
    if (seenAttrs.has(attrName)) {
      fail(s, 'Duplicate attribute "' + attrName + '" on <' + name + '>.', undefined, attrAt);
    }
    seenAttrs.add(attrName);
    skipWhitespace(s);
    if (peek(s) !== '=') {
      fail(
        s,
        'Attribute "' + attrName + '" is missing a value.',
        'XML has no bare attributes; write ' + attrName + '="value".',
      );
    }
    advance(s, 1);
    skipWhitespace(s);
    node.attrs.push({ name: attrName, value: readAttributeValue(s, attrName) });
  }

  parseContent(s, node, depth);

  // parseContent only returns on '</' or at EOF.
  if (eof(s)) {
    fail(
      s,
      'Unclosed element <' + name + '> — no matching </' + name + '>.',
      'Every element needs a closing tag, or must be written self-closing as <' + name + '/>.',
      openedAt,
    );
  }
  const closeAt = at(s);
  advance(s, 2);
  const closeName = readName(s, 'closing tag name');
  skipWhitespace(s);
  if (peek(s) !== '>') {
    fail(s, 'Malformed closing tag </' + closeName + '>.', 'A closing tag takes no attributes.');
  }
  advance(s, 1);
  if (closeName !== name) {
    fail(
      s,
      'Mismatched closing tag: <' + name + '> (line ' + openedAt.line + ') is closed by </' + closeName + '>.',
      'Tags must nest, so the innermost open element has to be closed first.',
      closeAt,
    );
  }
  return node;
}

function readAttributeValue(s, attrName) {
  const quote = peek(s);
  if (quote !== '"' && quote !== "'") {
    fail(
      s,
      'The value of "' + attrName + '" is not quoted.',
      'Attribute values must be wrapped in single or double quotes.',
    );
  }
  const start = at(s);
  advance(s, 1);
  let out = '';
  const len = s.text.length;
  for (;;) {
    if (s.pos >= len) {
      fail(s, 'Unterminated value for attribute "' + attrName + '".', undefined, start);
    }
    const ch = s.text[s.pos];
    if (ch === quote) {
      advance(s, 1);
      return out;
    }
    if (ch === '<') {
      fail(s, 'A literal "<" is not allowed inside an attribute value.', 'Write it as &lt;.');
    }
    if (ch === '&') {
      out += readReference(s);
      continue;
    }
    let end = s.pos;
    while (end < len && s.text[end] !== quote && s.text[end] !== '<' && s.text[end] !== '&') end += 1;
    out += s.text.slice(s.pos, end);
    advance(s, end - s.pos);
  }
}

/** Children of an open element; returns with the cursor on '</' or at EOF. */
function parseContent(s, node, depth) {
  for (;;) {
    if (eof(s)) return;
    if (peek(s) !== '<') {
      const text = readCharData(s);
      if (text !== '') node.texts.push({ value: text, cdata: false });
      continue;
    }
    if (ahead(s, '</')) return;
    if (ahead(s, '<![CDATA[')) {
      // Verbatim by definition: '<' and '&' inside are plain characters.
      node.texts.push({ value: readCdata(s), cdata: true });
      continue;
    }
    if (skipMisc(s)) continue;
    if (ahead(s, '<!')) {
      fail(s, 'Unsupported declaration ' + describeHere(s) + ' inside <' + node.name + '>.');
    }
    node.elements.push(parseElement(s, depth + 1));
  }
}

/* ================================================================== *
 * 5. Node tree -> plain JS value
 * ================================================================== */

function nodeToValue(node, options, warnings) {
  const trim = options.trim !== false;
  const hasCdata = node.texts.some((piece) => piece.cdata);

  // Pretty-printed XML is full of indentation-only text nodes; dropping them is
  // the difference between 'Ada' and '\n    Ada\n  '. CDATA is never touched.
  const pieces = trim
    ? node.texts.filter((piece) => piece.cdata || piece.value.trim() !== '')
    : node.texts;
  let text = pieces.map((piece) => piece.value).join('');
  if (trim && !hasCdata) text = text.trim();

  const hasAttrs = node.attrs.length > 0;
  const hasElements = node.elements.length > 0;

  if (!hasAttrs && !hasElements) {
    // <a/>, <a></a> and whitespace-only elements carry no information.
    if (text === '') return null;
    return coerce(text, options);
  }

  const out = {};
  for (const attr of node.attrs) {
    out['@' + attr.name] = coerce(attr.value, options);
  }

  // Repetition is the only way XML expresses a list, so grouping by name has to
  // happen here; a name seen once stays a scalar.
  const groups = new Map();
  for (const child of node.elements) {
    const value = nodeToValue(child, options, warnings);
    const bucket = groups.get(child.name);
    if (bucket) bucket.push(value);
    else groups.set(child.name, [value]);
  }
  for (const [name, values] of groups) {
    out[name] = values.length === 1 ? values[0] : values;
  }

  if (text !== '') {
    out['#text'] = coerce(text, options);
    if (hasElements) {
      warnings.push(
        'Mixed content in <' + node.name + '> is lossy: the text was collected under "#text" and its original position between the child elements is not preserved.',
      );
    }
  }
  return out;
}

/**
 * XML has no types — every value is text. Coercion is therefore opt-in, so
 * "007", "+1-555" and "1e5" style identifiers are not quietly mangled.
 */
const NUMERIC_TEXT = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

function coerce(text, options) {
  if (!options.dynamicTyping) return text;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (NUMERIC_TEXT.test(text)) {
    const value = Number(text);
    if (Number.isFinite(value)) return value;
  }
  return text;
}

/* ================================================================== *
 * 6. Serializer
 * ================================================================== */

/**
 * Serialize a JS value as XML and report every compromise made on the way.
 *
 * @param {unknown} value
 * @param {{rootName?: string, indent?: number, declaration?: boolean, arrayItemName?: string}} [options]
 * @returns {{ xml: string, warnings: string[] }}
 */
export function buildXmlWithReport(value, options = {}) {
  const indent = clampIndent(options.indent, 2);
  const ctx = {
    indent,
    newline: indent > 0 ? '\n' : '',
    lines: [],
    warnings: [],
    itemName: safeName(options.arrayItemName || 'item', null),
  };

  const requestedRoot =
    options.rootName === undefined || options.rootName === null || options.rootName === ''
      ? 'root'
      : options.rootName;
  const rootName = safeName(requestedRoot, ctx.warnings);

  if (Array.isArray(value)) {
    // Repeating the root would produce several root elements, which is not a
    // document at all — so the array is wrapped instead.
    ctx.warnings.push(
      'The top-level value is an array; its items were wrapped in <' + rootName + '> as repeated <' + ctx.itemName + '> elements, because XML allows only one root element.',
    );
    if (value.length === 0) {
      ctx.lines.push('<' + rootName + '/>');
    } else {
      ctx.lines.push('<' + rootName + '>');
      for (const item of value) writeElement(ctx.itemName, item, 1, ctx);
      ctx.lines.push('</' + rootName + '>');
    }
  } else {
    writeAny(rootName, value, 0, ctx);
  }

  const body = ctx.lines.join(ctx.newline);
  const declaration = options.declaration === false ? '' : '<?xml version="1.0" encoding="UTF-8"?>';
  const xml = declaration ? declaration + (indent > 0 ? '\n' : '') + body : body;
  return { xml, warnings: dedupe(ctx.warnings) };
}

/** Thin wrapper for callers that only want the text. */
export function buildXml(value, options = {}) {
  return buildXmlWithReport(value, options).xml;
}

function writeAny(name, value, level, ctx) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      ctx.warnings.push(
        'Dropped "' + name + '": an empty array has no XML representation (no elements to emit).',
      );
      return;
    }
    // An array repeats its key as sibling elements — the inverse of grouping.
    for (const item of value) writeElement(name, item, level, ctx);
    return;
  }
  writeElement(name, value, level, ctx);
}

function writeElement(name, value, level, ctx) {
  if (level > MAX_DEPTH) {
    throw new ConversionError('This value nests deeper than ' + MAX_DEPTH + ' levels.', {
      hint: 'Flatten the structure before converting it to XML.',
    });
  }
  const pad = padding(level, ctx);

  if (value === null || value === undefined) {
    ctx.lines.push(pad + '<' + name + '/>');
    return;
  }
  if (typeof value !== 'object') {
    ctx.lines.push(pad + '<' + name + '>' + escapeText(value) + '</' + name + '>');
    return;
  }
  if (typeof value.toISOString === 'function') {
    // Dates only reach here from YAML/TOML pipelines; ISO 8601 is the one form
    // every XML consumer understands.
    ctx.lines.push(pad + '<' + name + '>' + escapeText(value.toISOString()) + '</' + name + '>');
    return;
  }

  const attrs = [];
  const children = [];
  let text;
  let hasText = false;
  for (const [key, item] of Object.entries(value)) {
    if (key === '#text') {
      if (item !== null && item !== undefined && typeof item !== 'object') {
        text = item;
        hasText = true;
      } else if (item !== null && item !== undefined) {
        ctx.warnings.push('Dropped "#text" in <' + name + '>: element text must be a scalar value.');
      }
      continue;
    }
    if (key.startsWith('@')) {
      attrs.push([key.slice(1), item]);
      continue;
    }
    children.push([key, item]);
  }

  const attrText = attrs
    .map(([rawKey, rawValue]) => {
      const attrName = safeName(rawKey, ctx.warnings, 'attribute');
      let attrValue = rawValue;
      if (attrValue === null || attrValue === undefined) {
        // There is no "null attribute"; an empty value is the honest mapping.
        ctx.warnings.push('Attribute "' + attrName + '" on <' + name + '> was null and became an empty string.');
        attrValue = '';
      } else if (typeof attrValue === 'object') {
        ctx.warnings.push(
          'Attribute "' + attrName + '" on <' + name + '> held a nested value and was serialized as JSON text.',
        );
        attrValue = JSON.stringify(attrValue);
      }
      return ' ' + attrName + '="' + escapeAttribute(attrValue) + '"';
    })
    .join('');

  if (children.length === 0) {
    if (!hasText) {
      ctx.lines.push(pad + '<' + name + attrText + '/>');
    } else {
      ctx.lines.push(pad + '<' + name + attrText + '>' + escapeText(text) + '</' + name + '>');
    }
    return;
  }

  ctx.lines.push(pad + '<' + name + attrText + '>');
  if (hasText) {
    ctx.warnings.push(
      'Mixed content in <' + name + '>: "#text" was written before the child elements, which may not be where it originally sat.',
    );
    ctx.lines.push(padding(level + 1, ctx) + escapeText(text));
  }
  for (const [key, item] of children) {
    writeAny(safeName(key, ctx.warnings), item, level + 1, ctx);
  }
  ctx.lines.push(pad + '</' + name + '>');
}

function padding(level, ctx) {
  return ctx.indent > 0 ? ' '.repeat(level * ctx.indent) : '';
}

/**
 * Escape character data. Ampersand MUST go first — doing '<' first would turn
 * "<" into "&lt;" and then the ampersand pass would mangle it to "&amp;lt;".
 * '>' is escaped too so a literal "]]>" can never appear in the output.
 */
function escapeText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape an attribute value for double quotes. Tabs and newlines become
 * numeric references because a conforming parser normalizes literal ones to
 * plain spaces, which would silently corrupt the value.
 */
function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

/**
 * JSON keys are far more permissive than XML names, so keys such as "2024",
 * "first name" or "a<b" have to be rewritten. Every rename is reported instead
 * of happening quietly, since it changes the shape of the output.
 */
function safeName(rawName, warnings, kind = 'element') {
  const name = String(rawName);
  if (isValidXmlName(name)) return name;

  let cleaned = '';
  for (const ch of name) {
    cleaned += NAME_CHAR.test(ch) ? ch : '_';
  }
  if (cleaned === '') cleaned = '_';
  if (!NAME_START_CHAR.test(cleaned[0])) cleaned = '_' + cleaned;

  if (warnings) {
    warnings.push(
      'Renamed ' + kind + ' "' + snip(name) + '" to "' + snip(cleaned) + '" — it is not a valid XML name.',
    );
  }
  return cleaned;
}

/* ================================================================== *
 * 7. Tool-level entry points (see shared.js for the contract)
 * ================================================================== */

export function xmlToJson(input, options = {}) {
  requireInput(input, 'XML input');
  const parsed = parseXml(input, options);

  // The root element name is data too, so it is kept as the single top-level
  // key; jsonToXml reads it straight back out, making the pair round-trippable.
  const wrapped = { [parsed.rootName]: parsed.value };
  const notes = [
    'Root element <' + parsed.rootName + '> became the single top-level key.',
    'Attributes are prefixed with "@", element text is stored under "#text", and repeated sibling elements become arrays.',
  ];
  if (!options.dynamicTyping) {
    notes.push('Every value is a string — enable dynamic typing to convert numbers and booleans.');
  }
  return result(stringifyJson(wrapped, clampIndent(options.indent, 2)), {
    notes,
    warnings: parsed.warnings.length ? parsed.warnings : undefined,
  });
}

export function jsonToXml(input, options = {}) {
  const value = parseJson(input);
  const notes = [];

  let rootName = options.rootName;
  let payload = value;
  if (!rootName && value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    // A document produced by xmlToJson has exactly this shape, so unwrapping it
    // restores the original root element name instead of inventing <root>.
    if (keys.length === 1 && !keys[0].startsWith('@') && keys[0] !== '#text') {
      rootName = keys[0];
      payload = value[keys[0]];
      notes.push('Used the single top-level key "' + keys[0] + '" as the root element name.');
    }
  }

  const built = buildXmlWithReport(payload, { ...options, rootName: rootName || 'root' });
  notes.push('Keys starting with "@" became attributes; "#text" became element text.');
  return result(built.xml, {
    notes,
    warnings: built.warnings.length ? built.warnings : undefined,
  });
}

/* ================================================================== *
 * 8. Utilities
 * ================================================================== */

/** Editors and Windows tools like to prefix files with a UTF-8 byte order mark. */
function stripBom(text) {
  return String(text).replace(/^﻿/, '');
}

function clampIndent(value, fallback = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(8, Math.max(0, Math.round(n)));
}

function dedupe(list) {
  return [...new Set(list)];
}
