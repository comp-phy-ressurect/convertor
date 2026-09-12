/**
 * app.js — application controller.
 *
 * Wires the registry, router, storage and UI together. This is the only module
 * that owns mutable state; everything it calls is either pure or a thin DOM
 * helper, which is what keeps the converters testable without a browser.
 *
 * Privacy invariants enforced here:
 *   - no fetch/XHR/sendBeacon anywhere in the app
 *   - user input never enters the URL
 *   - history/presets are written to localStorage only, and only with consent
 */

import { LIMITS, PRODUCT, FEATURES } from './config.js';
import {
  getTools, getToolBySlug, getToolById, isToolSlug, searchTools,
  defaultOptions, coerceOptions, extensionFor, mimeFor, exampleFor,
  formatLabel, toolForFormats,
} from './tool-registry.js';
import { createRouter, pathForSlug, slugFromPath } from './router.js';
import { detect } from './detect.js';
import { FORMAT_IDS } from './converters/formats.js';
import * as storage from './storage.js';
import {
  readFileAsText, downloadText, downloadNameFor, mimeForExtension,
  copyToClipboard, fileFromDropEvent, checkTextSize, checkSize, streamCsvFile,
} from './files.js';
import {
  ConversionError, headerMode, looksLikeHeaderRow, generatedColumnNames, rowsToRecords,
} from './converters/shared.js';
import { hashFile } from './converters/hashing.js';
import { delimiterFor } from './converters/structured-data.js';
import { currentTimestamp } from './converters/time-id.js';
import { CSV } from './vendor.js';
import { canUseWorker, runInWorker } from './workers/transform-client.js';
import { byteLength, formatBytes, SIZE_POLICY } from './security.js';
import * as ui from './ui.js';

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const state = {
  tool: null,
  options: {},
  /** Selected { from, to } format ids for matrix tools; null for the rest. */
  formats: null,
  refs: {},
  settings: storage.getSettings(),
  lastResult: null,
  paletteIndex: 0,
  paletteMatches: [],
  detectTimer: null,
  runToken: 0,
  suggestionDismissedFor: null,
  /**
   * Exactly what the Example button last put in each editor, plus the source
   * format it was generated for. Compared by value rather than tracked with a
   * flag, so every way of changing the text — typing, pasting, dropping a file,
   * restoring history — counts as the user taking it over, with nothing to
   * reset. See `isUntouchedExample`.
   */
  exampleFill: { input: null, secondary: null, formatId: null },
  /**
   * The uploaded file the editor is only standing in for. Hashing reads bytes
   * and streaming reads rows, so in both cases the editor holds something other
   * than what was actually converted — a 64 KiB preview, or nothing at all.
   * Keeping the File means a re-run reads the file again instead of silently
   * converting the leftover text, which looked like a complete result and was
   * a fraction of one.
   */
  sourceFile: null, // { file, mode: 'hash' | 'stream', preview: string | null }
};

/**
 * True when `text` is still the untouched example, i.e. sample data the app
 * produced and the user has not edited.
 */
function isUntouchedExample(text, loaded) {
  return typeof loaded === 'string' && loaded !== '' && text === loaded;
}

/**
 * Whether `tool` would reach the CSV streaming path for the selected pair.
 * Streaming parses delimited text and emits JSON, so it is only ever the right
 * reader for a delimited source going to JSON — the universal converter also
 * carries `streamsFiles`, and a large JSON or XML file dropped there must not
 * be read as CSV.
 */
function canStreamFile(tool, formats) {
  if (!tool?.streamsFiles) return false;
  const from = formats?.from ?? tool.formats?.from;
  const to = formats?.to ?? tool.formats?.to;
  return (from === 'csv' || from === 'tsv') && to === 'json';
}

/** Forget the uploaded file; the editor's own text becomes the input again. */
function forgetSourceFile() {
  state.sourceFile = null;
}

const dom = {
  app: document.getElementById('app'),
  toolNav: document.getElementById('tool-nav'),
  palette: document.getElementById('palette'),
  paletteInput: document.getElementById('palette-input'),
  paletteResults: document.getElementById('palette-results'),
  historyDrawer: document.getElementById('history-drawer'),
  historyBody: document.getElementById('history-body'),
  historyNote: document.getElementById('history-note'),
  presetsDrawer: document.getElementById('presets-drawer'),
  presetsBody: document.getElementById('presets-body'),
  presetForm: document.getElementById('preset-form'),
  settingsDrawer: document.getElementById('settings-drawer'),
  settingsBody: document.getElementById('settings-body'),
  toast: document.getElementById('toast'),
};

let router;

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot() {
  applyTheme(state.settings.theme);

  router = createRouter({
    onNavigate: (slug) => selectTool(slug),
    isKnownSlug: (slug) => isToolSlug(slug),
  });

  wireGlobalControls();
  wireKeyboardShortcuts();

  // #app outlives every rerender, so these are bound exactly once.
  dom.app.addEventListener('click', handleWorkspaceClick);
  wireWorkspaceDropZone();

  // A static SEO shell declares its tool on <body data-tool="...">; that wins
  // over the path so a shell served from a rewrite still opens the right tool.
  const declared = document.body.dataset.tool;
  const initial = declared && isToolSlug(declared) ? declared : slugFromPath();

  if (initial !== slugFromPath() && isToolSlug(initial)) {
    globalThis.history.replaceState({ slug: initial }, '', pathForSlug(initial));
  }
  router.start();
}

/* ------------------------------------------------------------------ *
 * Tool selection & rendering
 * ------------------------------------------------------------------ */

/**
 * Set just before a navigation that was caused by a format selector, so the
 * chosen pair survives the tool switch instead of being reset to the target
 * page's own defaults.
 */
let keepFormatsOnNavigate = false;

function selectTool(slug) {
  const tool = slug === 'home' ? getToolBySlug('json-to-yaml') : getToolBySlug(slug);
  if (!tool) {
    renderHome();
    return;
  }

  // Whatever the user put in the editor is carried into the new workspace —
  // switching tools, or re-selecting the same one, must never silently discard
  // it. A loaded example is the exception: it is sample data belonging to the
  // tool that generated it, so carrying YAML sample text into JSON to Python
  // would greet the new tool with a parse error over content nobody typed.
  const previousInput = state.tool && state.refs.input ? state.refs.input.value : null;
  const previousSecondary = state.tool && state.refs.secondaryInput ? state.refs.secondaryInput.value : null;

  // An example does survive a format-selector navigation that leaves the input
  // format alone: /yaml-to-json/ → /yaml-to-toml/ is still the same YAML.
  const exampleStillApplies = keepFormatsOnNavigate && Boolean(tool.formats) &&
    state.formats?.from === state.exampleFill.formatId;
  const droppingExample = isUntouchedExample(previousInput, state.exampleFill.input) && !exampleStillApplies;
  const droppingSecondaryExample = isUntouchedExample(previousSecondary, state.exampleFill.secondary);

  // A streamed file's preview is the same kind of app-supplied placeholder as
  // an example, and an even worse thing to carry: the next tool would convert
  // the first 64 KiB of a file the user believes it read whole. The file itself
  // belongs to the tool that read it, so it does not travel either.
  const droppingPreview = isUntouchedExample(previousInput, state.sourceFile?.preview ?? null);
  forgetSourceFile();

  const carryInput = Boolean(previousInput) && !droppingExample && !droppingPreview;
  const carrySecondary = Boolean(previousSecondary) && !droppingSecondaryExample;
  state.exampleFill = {
    input: carryInput ? state.exampleFill.input : null,
    secondary: carrySecondary ? state.exampleFill.secondary : null,
    formatId: carryInput ? state.exampleFill.formatId : null,
  };

  // Landing on a pair's own page resets the selectors to that pair; that is
  // what makes /json-to-csv/ mean something.
  // Invalidate any conversion still in flight. A worker job started on the
  // previous tool would otherwise resolve here and render its result — with the
  // old tool's renderer — into the new workspace.
  state.runToken += 1;
  clearTimeout(state.detectTimer);

  const keepFormats = keepFormatsOnNavigate && state.formats && tool.formats;
  state.tool = tool;
  state.formats = tool.formats ? (keepFormats ? state.formats : { ...tool.formats }) : null;
  state.options = defaultOptions(tool);
  state.lastResult = null;
  state.suggestionDismissedFor = null;
  keepFormatsOnNavigate = false;

  document.title = tool.seoTitle ? tool.seoTitle + ' · ' + PRODUCT.name : tool.label + ' · ' + PRODUCT.name;
  ui.renderToolNav(dom.toolNav, tool.slug);

  state.refs = ui.renderWorkspace(dom.app, tool, {
    options: state.options,
    settings: state.settings,
    formats: state.formats,
  });

  wireWorkspace();

  if (carryInput && state.refs.input) {
    state.refs.input.value = previousInput;
    // Convert straight away: arriving at a tool with content already in the
    // editor and an empty output pane looks broken, and this is the path a
    // format selector takes when the chosen pair has its own page.
    handleInputChanged({ run: true });
  }
  if (carrySecondary && state.refs.secondaryInput) {
    state.refs.secondaryInput.value = previousSecondary;
    ui.updateMeta(state.refs.secondaryMeta, previousSecondary);
  }

  if (tool.generator) {
    run({ silent: true });
  } else if (!state.refs.input?.value) {
    ui.renderStatus(state.refs.status, {
      level: 'info',
      message: 'Paste ' + (tool.input?.label ?? 'input') + ', drop a file, or load the example.',
    });
    // Land with the caret in the editor so Ctrl+V is the first thing that works.
    // preventScroll keeps arriving at a tool from jumping past the heading.
    state.refs.input?.focus({ preventScroll: true });
  }
}

function renderHome() {
  selectTool('json-to-yaml');
}

/**
 * Rebuild the workspace for the current tool — used when options change
 * structurally, e.g. after applying a preset. Whatever the user had typed is
 * carried across: losing someone's input because they picked a preset would be
 * an unpleasant surprise.
 */
function rerenderWorkspace() {
  const carried = {
    input: state.refs.input?.value ?? '',
    secondary: state.refs.secondaryInput?.value ?? '',
  };

  clearTimeout(state.detectTimer); // a pending detection would target dead nodes
  state.refs = ui.renderWorkspace(dom.app, state.tool, {
    options: state.options,
    settings: state.settings,
    formats: state.formats,
  });
  wireWorkspace();

  if (state.refs.input) state.refs.input.value = carried.input;
  if (state.refs.secondaryInput) state.refs.secondaryInput.value = carried.secondary;

  ui.updateMeta(state.refs.inputMeta, carried.input);
  ui.updateMeta(state.refs.secondaryMeta, carried.secondary);
  if (carried.input) scheduleDetection(carried.input);
}

/* ------------------------------------------------------------------ *
 * Workspace wiring
 * ------------------------------------------------------------------ */

function wireWorkspace() {
  const { input, secondaryInput, optionsForm, runButton, output, outputPane } = state.refs;

  if (optionsForm) {
    optionsForm.addEventListener('change', () => {
      state.options = coerceOptions(state.tool, ui.readOptionsForm(state.tool, optionsForm));
      ui.applyOptionDependencies(optionsForm, state.options, state.formats);
      if (state.settings.autoRun || state.tool.generator) run({ silent: true });
    });
    optionsForm.addEventListener('input', (event) => {
      // Text options (regex pattern, root type name) should feel live.
      if (event.target.type !== 'text') return;
      state.options = coerceOptions(state.tool, ui.readOptionsForm(state.tool, optionsForm));
      scheduleRun();
    });
    ui.applyOptionDependencies(optionsForm, state.options, state.formats);
  }

  // These are fresh nodes on every render, so per-render binding is correct
  // here — unlike the click delegation, which lives on the persistent #app.
  state.refs.fromFormat?.addEventListener('change', (event) => changeFormat('from', event.target.value));
  state.refs.toFormat?.addEventListener('change', (event) => changeFormat('to', event.target.value));
  // The swap button is handled by handleWorkspaceClick via data-action.

  if (input) {
    input.addEventListener('input', () => handleInputChanged({ run: true }));
    wireDropZone(input, 'input');
  }
  if (secondaryInput) {
    secondaryInput.addEventListener('input', () => {
      ui.updateMeta(state.refs.secondaryMeta, secondaryInput.value);
      scheduleRun();
    });
    wireDropZone(secondaryInput, 'secondary');
  }

  runButton?.addEventListener('click', () => run());

  // Clicks inside the workspace are handled by a single delegated listener bound
  // once in boot(). It must NOT be bound here: #app survives every rerender, so
  // a listener added per render accumulates and fires the same action N times —
  // which meant one click on Download saved two files.

  state.refs.fileInput?.addEventListener('change', (event) => loadFile(event.target.files?.[0], 'input'));
  state.refs.secondaryFileInput?.addEventListener('change', (event) => loadFile(event.target.files?.[0], 'secondary'));
}

/**
 * Apply a format selection.
 *
 * When the chosen pair has its own landing page we navigate there, so the URL
 * keeps describing what the page does and the SEO entry stays honest. When it
 * does not — YAML → XML, say — we stay put and convert in place. Either way the
 * user's input is preserved; only the conversion changes.
 */
function changeFormat(which, value) {
  if (!state.formats) return;

  const next = which === 'both'
    ? { from: value.from, to: value.to }
    : { ...state.formats, [which]: value };

  if (next.from === state.formats.from && next.to === state.formats.to) return;

  // The example was generated for the old input format; once that changes it is
  // no longer a sample of what this tool now reads, so it goes rather than
  // sitting there as a parse error.
  if (next.from !== state.formats.from &&
      state.refs.input &&
      isUntouchedExample(state.refs.input.value, state.exampleFill.input)) {
    state.refs.input.value = '';
    state.exampleFill = { ...state.exampleFill, input: null, formatId: null };
  }

  state.formats = next;

  // Prefer the page named after this exact pair. Failing that, fall back to the
  // universal converter rather than leaving a page titled "JSON → CSV" quietly
  // producing XML — an honest URL matters more than staying put.
  const target = toolForFormats(next.from, next.to) ?? getToolBySlug('convert');

  if (target && target.id !== state.tool.id) {
    // Navigating resets formats by default, so flag that this one is deliberate.
    keepFormatsOnNavigate = true;
    router.go(target.slug);
    return;
  }

  rerenderWorkspace();
  ui.renderStatus(state.refs.status, {
    level: 'info',
    message: 'Converting ' + formatLabel(next.from) + ' to ' + formatLabel(next.to) + '.',
  });
  if (state.refs.input?.value.trim()) run({ silent: true });
}

/**
 * The one click handler for everything inside the workspace.
 *
 * Bound once to #app in boot(). Every button carries `data-action`, so there is
 * exactly one path from a click to its effect — no per-pane listeners, and
 * therefore no way for a rerender to double up the handlers.
 */
function handleWorkspaceClick(event) {
  const copyTarget = event.target.closest('[data-copy-value]');
  if (copyTarget) {
    copyValue(copyTarget.dataset.copyValue);
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, target = 'input' } = button.dataset;

  switch (action) {
    case 'now': {
      if (!state.refs.input) return;
      state.refs.input.value = String(currentTimestamp().seconds);
      handleInputChanged({ run: true, immediate: true });
      break;
    }
    case 'swap-formats': {
      if (state.formats) changeFormat('both', { from: state.formats.to, to: state.formats.from });
      break;
    }
    case 'example': {
      const spec = target === 'secondary' ? state.tool.secondaryInput : state.tool.input;
      const field = target === 'secondary' ? state.refs.secondaryInput : state.refs.input;
      if (!spec || !field) return;
      field.value = target === 'secondary'
        ? spec.example ?? ''
        : exampleFor(state.tool, state.formats);
      if (target === 'secondary') {
        state.exampleFill = { ...state.exampleFill, secondary: field.value };
        ui.updateMeta(state.refs.secondaryMeta, field.value);
        run();
      } else {
        state.exampleFill = {
          ...state.exampleFill,
          input: field.value,
          formatId: state.formats?.from ?? null,
        };
        handleInputChanged({ run: true, immediate: true });
      }
      break;
    }
    case 'upload': {
      const picker = target === 'secondary' ? state.refs.secondaryFileInput : state.refs.fileInput;
      picker?.click();
      break;
    }
    case 'clear': {
      const field = target === 'secondary' ? state.refs.secondaryInput : state.refs.input;
      if (!field) return;
      field.value = '';
      if (target !== 'secondary') forgetSourceFile();
      if (target === 'secondary') {
        ui.updateMeta(state.refs.secondaryMeta, '');
      } else {
        ui.updateDetection(state.refs.detection, null);
        ui.updateMeta(state.refs.inputMeta, '');
      }
      clearOutput();
      field.focus();
      break;
    }
    case 'copy':
      copyOutput();
      break;
    case 'download':
      downloadOutput();
      break;
    default:
      break;
  }
}

/**
 * A file dropped anywhere in the workspace loads into the primary editor.
 * Bound once on #app, which outlives every rerender; drops that land on an
 * editor pane are left to that pane's own handler.
 */
function wireWorkspaceDropZone() {
  const setActive = (active) => dom.app.classList.toggle('is-dropping', active);

  const onEditorPane = (event) => {
    const pane = event.target instanceof Element ? event.target.closest('.pane') : null;
    if (!pane) return false;
    return pane === state.refs.inputPane || pane === state.refs.secondaryInput?.closest('.pane');
  };

  dom.app.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files') || onEditorPane(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setActive(true);
  });
  dom.app.addEventListener('dragleave', (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setActive(false);
  });
  dom.app.addEventListener('drop', (event) => {
    setActive(false);
    if (onEditorPane(event)) return;
    event.preventDefault();
    const file = fileFromDropEvent(event);
    if (file) loadFile(file, 'input');
  });
}

function wireDropZone(field, kind) {
  const pane = field.closest('.pane');
  if (!pane) return;

  const setActive = (active) => pane.classList.toggle('is-dropping', active);

  pane.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setActive(true);
  });
  pane.addEventListener('dragleave', (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setActive(false);
  });
  pane.addEventListener('drop', (event) => {
    event.preventDefault();
    setActive(false);
    const file = fileFromDropEvent(event);
    if (file) loadFile(file, kind);
  });
}

async function loadFile(file, kind) {
  if (!file) return;
  const field = kind === 'secondary' ? state.refs.secondaryInput : state.refs.input;
  if (!field) return;

  // This file supersedes whatever the editor was previously standing in for.
  if (kind === 'input') forgetSourceFile();

  // Hashing reads bytes, not text: a binary file has no sensible text form,
  // and turning a 50 MB archive into a JS string just to hash it is wasteful.
  if (state.tool.supportsFileHashing && kind === 'input') {
    await hashUploadedFile(file);
    return;
  }

  // A very large CSV is streamed row by row in Papa's own worker rather than
  // materialized as one enormous string.
  if (kind === 'input' && canStreamFile(state.tool, state.formats) && file.size > SIZE_POLICY.NORMAL_MAX) {
    await streamLargeCsv(file);
    return;
  }

  try {
    const { text, warning } = await readFileAsText(file);
    field.value = text;
    if (kind === 'secondary') {
      ui.updateMeta(state.refs.secondaryMeta, text);
    } else {
      handleInputChanged({ run: false });
    }
    ui.renderStatus(state.refs.status, {
      level: warning ? 'warning' : 'success',
      // The size caveat, if any, replaces the message rather than trailing it.
      message: warning ?? ('Loaded "' + file.name + '"'),
    });
    run();
  } catch (error) {
    ui.renderStatus(state.refs.status, { level: 'error', message: error.message });
  }
}

/** Hash a file's bytes locally. Nothing is uploaded; see files.js. */
async function hashUploadedFile(file) {
  const verdict = checkSize(file.size);
  if (verdict.blocked) {
    ui.renderStatus(state.refs.status, { level: 'error', message: verdict.message });
    return;
  }
  ui.renderStatus(state.refs.status, {
    level: 'info',
    message: 'Hashing "' + file.name + '" (' + formatBytes(file.size) + ') on this device…',
  });
  try {
    const outcome = await hashFile(file, state.options);
    // Remember the file: the digests on screen are the file's, not the
    // editor's, so changing an algorithm has to re-read the file.
    state.sourceFile = { file, mode: 'hash', preview: null };
    state.lastResult = outcome;
    ui.renderDetailsOutput(state.refs.output, outcome);
    ui.updateMeta(state.refs.outputMeta, outcome.output);
    ui.renderStatus(state.refs.status, {
      level: 'success',
      message: 'Hashed "' + file.name + '"',
    });
  } catch (error) {
    ui.renderStatus(state.refs.status, { level: 'error', message: error.message });
  }
}

/**
 * Stream a large CSV through Papa Parse's worker.
 *
 * The textarea shows only a preview — putting 200 MB of text into a DOM node
 * is what actually kills the tab — while the conversion itself sees every row.
 */
async function streamLargeCsv(file) {
  const verdict = checkSize(file.size, { forceAllow: true });
  ui.renderStatus(state.refs.status, {
    level: 'info',
    message: 'Streaming "' + file.name + '" (' + formatBytes(file.size) + ') row by row…',
  });

  const preview = await file.slice(0, 64 * 1024).text();
  const delimiter = state.options.delimiter && state.options.delimiter !== 'auto'
    ? delimiterFor(state.options.delimiter)
    : '';

  // Streaming sees one row at a time, so the header question is settled up
  // front from the same slice the editor shows.
  const mode = headerMode(state.options.header);
  const hasHeader = mode === 'auto'
    ? looksLikeHeaderRow(CSV.parse(preview, {
        header: false, delimiter, skipEmptyLines: 'greedy', preview: 21,
      }).data)
    : mode === 'yes';

  try {
    const { rows, errors, truncated } = await streamCsvFile(file, CSV, {
      header: hasHeader,
      dynamicTyping: Boolean(state.options.dynamicTyping),
      delimiter,
    });

    const named = hasHeader
      ? rows
      : rowsToRecords(rows, generatedColumnNames(rows.reduce((max, row) => Math.max(max, row?.length ?? 0), 0)));
    const output = JSON.stringify(named, null, state.options.indent || 2);
    state.lastResult = { output };
    ui.renderTextOutput(state.refs.output, output);
    ui.updateMeta(state.refs.outputMeta, output);

    state.refs.input.value = preview;
    // Remember the file and the exact preview text standing in for it, so a
    // later run streams all the rows again instead of converting the preview.
    state.sourceFile = { file, mode: 'stream', preview };
    ui.updateMeta(state.refs.inputMeta, preview, 'preview of ' + formatBytes(file.size));

    // Streaming genuinely changes what you are looking at — the editor holds a
    // preview, not the file — so that stays in the message itself.
    const caveat = truncated ? ', stopped at the first 100,000 rows' : '';
    ui.renderStatus(state.refs.status, {
      level: 'warning',
      message: 'Streamed ' + rows.length.toLocaleString('en') + ' rows from "' + file.name +
        '"' + caveat + '. The editor shows only the first 64 KiB; the conversion used every row.',
    });
  } catch (error) {
    ui.renderStatus(state.refs.status, { level: 'error', message: error.message });
  }
}

/* ------------------------------------------------------------------ *
 * Input handling, detection and running
 * ------------------------------------------------------------------ */

function handleInputChanged({ run: shouldRun = true, immediate = false } = {}) {
  const field = state.refs.input;
  if (!field) return;
  const text = field.value;

  // Editing the placeholder hands the editor back to the user: from here on
  // what they can see is the input, and the file is no longer standing behind it.
  if (state.sourceFile && text !== state.sourceFile.preview) forgetSourceFile();

  ui.updateMeta(state.refs.inputMeta, text);
  scheduleDetection(text);

  if (!shouldRun) return;
  if (immediate) run();
  else scheduleRun();
}

function scheduleDetection(text) {
  clearTimeout(state.detectTimer);
  state.detectTimer = setTimeout(() => {
    if (!text.trim()) {
      ui.updateDetection(state.refs.detection, null);
      ui.renderSuggestion(state.refs.inputPane, { suggestion: null });
      return;
    }
    const detection = detect(text);
    ui.updateDetection(state.refs.detection, detection);
    offerSuggestion(detection);
  }, LIMITS.detectDebounceMs);
}

/**
 * Suggest a better-suited tool, but never switch automatically and never
 * rewrite the input. The user stays in control.
 */
function offerSuggestion(detection) {
  // On a matrix tool the useful offer is "switch the input selector", not
  // "go to a different page" — the selectors can already express this.
  if (state.formats && FORMAT_IDS.includes(detection.type) && detection.type !== state.formats.from) {
    const key = 'format:' + detection.type;
    ui.renderSuggestion(state.refs.inputPane, {
      detection,
      suggestion: detection.confidence >= 0.8 && state.suggestionDismissedFor !== key
        ? { label: 'Read input as ' + formatLabel(detection.type), formatId: detection.type }
        : null,
      onAccept: (offer) => {
        state.suggestionDismissedFor = key;
        changeFormat('from', offer.formatId);
      },
    });
    return;
  }

  const suggestion = suggestToolFor(detection);
  const shouldOffer =
    suggestion &&
    suggestion.id !== state.tool.id &&
    detection.confidence >= 0.85 &&
    state.suggestionDismissedFor !== suggestion.id;

  ui.renderSuggestion(state.refs.inputPane, {
    detection,
    suggestion: shouldOffer ? { label: 'Open ' + suggestion.label, slug: suggestion.slug, id: suggestion.id } : null,
    onAccept: (offer) => {
      state.suggestionDismissedFor = offer.id;
      const carried = state.refs.input.value;
      router.go(offer.slug);
      if (state.refs.input) {
        state.refs.input.value = carried;
        handleInputChanged({ run: true, immediate: true });
      }
    },
  });
}

const SUGGESTION_MAP = {
  curl: 'curl-to-code',
  jwt: 'jwt-decoder',
  json: 'json-to-yaml',
  url: 'url-encoder-decoder',
  timestamp: 'unix-timestamp-converter',
  yaml: 'yaml-to-json',
  csv: 'csv-to-json',
  toml: 'toml-to-json',
  base64: 'base64-encoder-decoder',
  // XML and HTML have no pairwise landing page, so they point at the matrix.
  xml: 'convert',
  html: 'convert',
};

function suggestToolFor(detection) {
  // Never nag when the current tool already handles this kind of input —
  // the diff checker happily takes JSON, and so does the formatter.
  const accepts =
    (state.tool.keywords ?? []).includes(detection.type) ||
    state.tool.input?.language === detection.type ||
    state.tool.secondaryInput?.language === detection.type;
  if (accepts) return null;

  const slug = SUGGESTION_MAP[detection.type];
  if (!slug) return null;

  // Nor when the conversion is currently succeeding: a working tool is the
  // right tool, whatever the detector thinks.
  if (state.lastResult) return null;

  return getToolBySlug(slug);
}

let runTimer;

function scheduleRun() {
  if (!state.settings.autoRun) return;
  clearTimeout(runTimer);
  runTimer = setTimeout(() => run({ silent: true }), LIMITS.detectDebounceMs + 100);
}

async function run({ silent = false } = {}) {
  const tool = state.tool;
  if (!tool) return;

  // The editor is standing in for an uploaded file. Read the file again rather
  // than the placeholder it left behind: converting a 64 KiB preview of a 2 MiB
  // CSV produced a result that looked complete and was missing most of it.
  if (state.sourceFile) {
    const { file, mode } = state.sourceFile;
    if (mode === 'hash' && tool.supportsFileHashing) {
      await hashUploadedFile(file);
      return;
    }
    if (mode === 'stream' && canStreamFile(tool, state.formats)) {
      await streamLargeCsv(file);
      return;
    }
    // These settings cannot reproduce what was read. Refusing beats converting
    // the preview and calling it done.
    forgetSourceFile();
    if (state.refs.input) state.refs.input.value = '';
    ui.updateMeta(state.refs.inputMeta, '');
    clearOutput();
    ui.renderStatus(state.refs.status, {
      level: 'warning',
      message: 'The editor only held a preview of "' + file.name +
        '". Open the file again to convert it with these settings.',
    });
    return;
  }

  const input = state.refs.input?.value ?? '';
  const secondaryInput = state.refs.secondaryInput?.value ?? '';

  if (!tool.generator && !input.trim() && !secondaryInput.trim()) {
    clearOutput();
    if (!silent) {
      ui.renderStatus(state.refs.status, { level: 'info', message: 'Nothing to convert yet.' });
    }
    return;
  }

  const sizeCheck = checkTextSize(input);
  if (sizeCheck.blocked) {
    ui.renderStatus(state.refs.status, { level: 'error', message: sizeCheck.message });
    return;
  }

  const token = ++state.runToken;
  state.refs.runButton?.setAttribute('aria-busy', 'true');

  try {
    const output = await execute(tool, { input, secondaryInput, options: state.options, formats: state.formats });
    if (token !== state.runToken) return; // a newer run superseded this one

    state.lastResult = output;
    renderResult(tool, output, sizeCheck);

    if (state.settings.historyEnabled && !silent) {
      storage.addHistoryEntry({
        toolId: tool.id,
        toolLabel: tool.label,
        input,
        output: output.output,
        options: state.options,
      });
    }
  } catch (error) {
    if (token !== state.runToken) return;
    state.lastResult = null;
    clearOutput();
    const conversionError = error instanceof ConversionError ? error : null;
    ui.renderStatus(state.refs.status, {
      level: 'error',
      message: error?.message ?? 'Conversion failed.',
      error: conversionError ?? undefined,
    });
  } finally {
    // Only the newest run may clear the busy state; a superseded one finishing
    // must not make the button look idle while the current run is still going.
    if (token === state.runToken) state.refs.runButton?.removeAttribute('aria-busy');
  }
}

/**
 * Run a conversion, offloading big text-in/text-out jobs to the transform
 * worker so the UI keeps responding. Any worker problem falls back to the
 * pure function on this thread rather than surfacing as an error.
 */
async function execute(tool, args) {
  // A matrix tool dispatches on the shared 'format-converter' entry rather than
  // its own id: the selected pair may no longer be the pair its page is named
  // after, and the worker must convert what the selectors say.
  const workerToolId = tool.formats ? 'format-converter' : tool.id;
  const workerOptions = tool.formats ? { ...args.options, ...args.formats } : args.options;

  if (canUseWorker(workerToolId, byteLength(args.input))) {
    try {
      return await runInWorker(workerToolId, args.input, workerOptions);
    } catch (error) {
      if (error?.message !== 'worker-unavailable') throw error;
    }
  }
  return tool.run(args);
}

function renderResult(tool, output, sizeCheck) {
  const container = state.refs.output;
  container.classList.toggle('output--wrap', Boolean(state.settings.wrapOutput));

  switch (tool.render) {
    case 'regex':
      ui.renderRegexOutput(container, output.regex);
      break;
    case 'diff':
      ui.renderDiffOutput(container, output.diff, state.options.view);
      break;
    case 'details':
      ui.renderDetailsOutput(container, output);
      break;
    default:
      ui.renderTextOutput(container, output.output);
  }

  ui.updateMeta(state.refs.outputMeta, output.output);

  // One line on success. The exceptions are caveats that change what you
  // actually got back, or what the tool can still protect you from: an
  // oversized input, or a converter that asks to speak up via statusMessage.
  const caveat = sizeCheck?.message ?? output.statusMessage;
  ui.renderStatus(state.refs.status, caveat
    ? { level: output.statusLevel ?? 'warning', message: caveat }
    : { level: 'success', message: 'Converted' });
}

function clearOutput() {
  const container = state.refs.output;
  if (!container) return;
  container.textContent = '';
  const placeholder = document.createElement('p');
  placeholder.className = 'output__placeholder';
  placeholder.textContent = 'Output appears here.';
  container.appendChild(placeholder);
  ui.updateMeta(state.refs.outputMeta, '');
  state.lastResult = null;
}

/* ------------------------------------------------------------------ *
 * Copy / download
 * ------------------------------------------------------------------ */

async function copyOutput() {
  const text = state.lastResult?.output;
  if (!text) {
    ui.showToast(dom.toast, 'There is no output to copy yet.');
    return;
  }
  copyValue(text);
}

async function copyValue(text) {
  const ok = await copyToClipboard(text);
  ui.showToast(dom.toast, ok ? 'Copied to clipboard.' : 'Could not access the clipboard — select and copy manually.');
}

function downloadOutput() {
  const text = state.lastResult?.output;
  if (!text) {
    ui.showToast(dom.toast, 'There is no output to download yet.');
    return;
  }
  const extension = extensionFor(state.tool, state.options, state.formats);
  const mime = mimeFor(state.tool, state.formats) ?? mimeForExtension(extension);
  downloadText(downloadNameFor(state.tool, extension), text, mime);
  ui.showToast(dom.toast, 'Saved to your downloads folder.');
}

/* ------------------------------------------------------------------ *
 * Global controls: palette, history, presets, settings
 * ------------------------------------------------------------------ */

function wireGlobalControls() {
  document.getElementById('search-trigger')?.addEventListener('click', openPalette);
  document.getElementById('history-trigger')?.addEventListener('click', openHistory);
  document.getElementById('presets-trigger')?.addEventListener('click', openPresets);
  document.getElementById('settings-trigger')?.addEventListener('click', openSettings);

  for (const dialog of [dom.palette, dom.historyDrawer, dom.presetsDrawer, dom.settingsDrawer]) {
    dialog?.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-dialog]')) ui.closeDialog(dialog);
    });
  }

  dom.paletteInput?.addEventListener('input', () => updatePalette(dom.paletteInput.value));
  dom.paletteInput?.addEventListener('keydown', handlePaletteKeys);
  dom.paletteResults?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-slug]');
    if (!item) return;
    ui.closeDialog(dom.palette);
    router.go(item.dataset.slug);
  });

  document.getElementById('history-clear')?.addEventListener('click', () => {
    storage.clearHistory();
    refreshHistory();
    ui.showToast(dom.toast, 'History cleared.');
  });

  dom.presetForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = new FormData(dom.presetForm).get('name');
    try {
      storage.savePreset({ name, toolId: state.tool.id, options: state.options });
      dom.presetForm.reset();
      refreshPresets();
      ui.showToast(dom.toast, 'Preset saved in this browser.');
    } catch (error) {
      ui.showToast(dom.toast, error.message);
    }
  });

  document.getElementById('clear-everything')?.addEventListener('click', () => {
    storage.clearEverything();
    state.settings = storage.getSettings();
    applyTheme(state.settings.theme);
    refreshSettings();
    ui.showToast(dom.toast, 'All locally stored DevConvert data was deleted.');
  });
}

function openPalette() {
  updatePalette('');
  ui.openDialog(dom.palette, { focus: dom.paletteInput });
  dom.paletteInput.value = '';
  dom.paletteInput.select();
}

function updatePalette(query) {
  state.paletteMatches = searchTools(query);
  state.paletteIndex = 0;
  ui.renderPaletteResults(dom.paletteResults, state.paletteMatches, state.paletteIndex);
  syncPaletteActiveDescendant();
}

function handlePaletteKeys(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const count = state.paletteMatches.length;
    if (!count) return;
    state.paletteIndex = (state.paletteIndex + delta + count) % count;
    ui.renderPaletteResults(dom.paletteResults, state.paletteMatches, state.paletteIndex);
    syncPaletteActiveDescendant();
    dom.paletteResults.children[state.paletteIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const tool = state.paletteMatches[state.paletteIndex];
    if (!tool) return;
    ui.closeDialog(dom.palette);
    router.go(tool.slug);
  }
}

function syncPaletteActiveDescendant() {
  if (state.paletteMatches.length) {
    dom.paletteInput.setAttribute('aria-activedescendant', 'palette-option-' + state.paletteIndex);
  } else {
    dom.paletteInput.removeAttribute('aria-activedescendant');
  }
}

function openHistory() {
  refreshHistory();
  ui.openDialog(dom.historyDrawer);
}

function refreshHistory() {
  const entries = storage.getHistory();
  dom.historyNote.textContent = state.settings.historyEnabled
    ? 'The last ' + (FEATURES.unlimitedHistory ? 'few hundred' : LIMITS.historyEntries) +
      ' conversions, stored in this browser only. Long inputs are truncated.'
    : 'History recording is turned off in Settings. Existing entries are still listed below.';

  ui.renderHistory(dom.historyBody, entries, {
    onRestore: (entry) => {
      const tool = getToolById(entry.toolId);
      if (!tool) {
        ui.showToast(dom.toast, 'That tool is no longer available.');
        return;
      }
      ui.closeDialog(dom.historyDrawer);
      router.go(tool.slug);
      // Restore the options first, then redraw so the controls actually show
      // the settings this entry was produced with.
      state.options = coerceOptions(tool, { ...defaultOptions(tool), ...entry.options });
      rerenderWorkspace();
      if (state.refs.input) {
        state.refs.input.value = entry.input?.text ?? '';
        handleInputChanged({ run: true, immediate: true });
      } else if (tool.generator) {
        run({ silent: true });
      }
    },
    onDelete: (entry) => {
      storage.removeHistoryEntry(entry.id);
      refreshHistory();
    },
  });
}

function openPresets() {
  refreshPresets();
  ui.openDialog(dom.presetsDrawer);
}

function refreshPresets() {
  ui.renderPresets(dom.presetsBody, storage.getPresets(), {
    toolLabelFor: (id) => getToolById(id)?.label ?? id,
    onApply: (preset) => {
      const tool = getToolById(preset.toolId);
      if (!tool) {
        ui.showToast(dom.toast, 'That tool is no longer available.');
        return;
      }
      ui.closeDialog(dom.presetsDrawer);
      router.go(tool.slug);
      state.options = coerceOptions(tool, { ...defaultOptions(tool), ...preset.options });
      rerenderWorkspace();
      ui.showToast(dom.toast, 'Applied preset "' + preset.name + '".');
      if (tool.generator || state.refs.input?.value) run({ silent: true });
    },
    onRename: (preset) => {
      const name = globalThis.prompt('New name for this preset', preset.name);
      if (!name) return;
      storage.savePreset({ ...preset, name });
      refreshPresets();
    },
    onDelete: (preset) => {
      storage.removePreset(preset.id);
      refreshPresets();
    },
  });
}

function openSettings() {
  refreshSettings();
  ui.openDialog(dom.settingsDrawer);
}

function refreshSettings() {
  ui.renderSettings(dom.settingsBody, state.settings, {
    footprint: storage.storageFootprint(),
    persistent: storage.isPersistent(),
    onChange: (patch) => {
      state.settings = storage.updateSettings(patch);
      if ('theme' in patch) applyTheme(state.settings.theme);
      if ('wrapOutput' in patch) {
        state.refs.output?.classList.toggle('output--wrap', Boolean(state.settings.wrapOutput));
      }
      refreshSettings();
    },
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'system' ? '' : theme;
}

/* ------------------------------------------------------------------ *
 * Keyboard shortcuts
 * ------------------------------------------------------------------ */

function wireKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey;

    if (event.key === 'Escape') {
      for (const dialog of [dom.palette, dom.historyDrawer, dom.presetsDrawer, dom.settingsDrawer]) {
        if (dialog && !dialog.hidden) {
          event.preventDefault();
          ui.closeDialog(dialog);
          return;
        }
      }
      return;
    }

    if (modifier && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault();
      if (dom.palette.hidden) openPalette();
      else ui.closeDialog(dom.palette);
      return;
    }

    if (modifier && event.key === 'Enter') {
      // Works from inside a textarea, which is exactly where you want it.
      event.preventDefault();
      run();
      return;
    }

    if (modifier && event.shiftKey && (event.key === 'c' || event.key === 'C')) {
      // Do not steal Ctrl+Shift+C when the user is selecting text to copy.
      const selection = globalThis.getSelection?.().toString();
      if (selection) return;
      event.preventDefault();
      copyOutput();
    }
  });
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

// Exposed for the browser test harness only; nothing here reads user input.
globalThis.DevConvert = { getTools, state };
