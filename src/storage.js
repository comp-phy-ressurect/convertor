/**
 * storage.js — history, presets and settings.
 *
 * Everything lives in localStorage on this device. Nothing is sent anywhere and
 * nothing is ever put in the URL: a conversion history in a query string would
 * leak your input into browser history, referrer headers and server logs.
 *
 * All access is wrapped in try/catch because localStorage throws in private
 * browsing modes, when quota is exceeded, and when cookies are blocked.
 */

import { LIMITS, STORAGE_KEYS, FEATURES } from './config.js';

const memoryFallback = new Map();
let storageAvailable = null;

function isAvailable() {
  if (storageAvailable !== null) return storageAvailable;
  try {
    const probe = '__devconvert_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  return storageAvailable;
}

/** True when persistence works; the UI tells the user when it does not. */
export function isPersistent() {
  return isAvailable();
}

function readRaw(key) {
  if (!isAvailable()) return memoryFallback.get(key) ?? null;
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key, value) {
  if (!isAvailable()) {
    memoryFallback.set(key, value);
    return true;
  }
  try {
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch {
    // Most likely QuotaExceededError. Degrade to this session only.
    memoryFallback.set(key, value);
    return false;
  }
}

function removeRaw(key) {
  memoryFallback.delete(key);
  if (!isAvailable()) return;
  try {
    globalThis.localStorage.removeItem(key);
  } catch {
    /* nothing sensible to do */
  }
}

function readJson(key, fallback) {
  const raw = readRaw(key);
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch {
    // Corrupt entry — drop it rather than breaking the app on every load.
    removeRaw(key);
    return fallback;
  }
}

function writeJson(key, value) {
  return writeRaw(key, JSON.stringify(value));
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = Object.freeze({
  historyEnabled: true,
  autoRun: true,
  wrapOutput: true,
  theme: 'system',
});

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(STORAGE_KEYS.settings, {}) };
}

export function updateSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson(STORAGE_KEYS.settings, next);
  return next;
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

function historyLimit() {
  return FEATURES.unlimitedHistory ? LIMITS.historyEntriesPro : LIMITS.historyEntries;
}

export function getHistory() {
  const entries = readJson(STORAGE_KEYS.history, []);
  return Array.isArray(entries) ? entries : [];
}

/**
 * Record a conversion. Input and output are truncated so that a 5 MiB paste
 * cannot fill the origin's storage quota.
 */
export function addHistoryEntry({ toolId, toolLabel, input, output, options }) {
  if (!getSettings().historyEnabled) return getHistory();

  const entry = {
    id: newId(),
    toolId,
    toolLabel,
    at: Date.now(),
    options: options ? clone(options) : {},
    input: truncate(input),
    output: truncate(output),
    inputLength: typeof input === 'string' ? input.length : 0,
    outputLength: typeof output === 'string' ? output.length : 0,
  };

  const entries = [entry, ...getHistory()].slice(0, historyLimit());
  writeJson(STORAGE_KEYS.history, entries);
  return entries;
}

export function removeHistoryEntry(id) {
  const entries = getHistory().filter((entry) => entry.id !== id);
  writeJson(STORAGE_KEYS.history, entries);
  return entries;
}

export function clearHistory() {
  removeRaw(STORAGE_KEYS.history);
  return [];
}

function truncate(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (text.length <= LIMITS.historyValueChars) return { text, truncated: false };
  return {
    text: text.slice(0, LIMITS.historyValueChars),
    truncated: true,
    originalLength: text.length,
  };
}

/* ------------------------------------------------------------------ *
 * Presets
 * ------------------------------------------------------------------ */

export function getPresets() {
  const presets = readJson(STORAGE_KEYS.presets, []);
  return Array.isArray(presets) ? presets : [];
}

export function savePreset({ id, name, toolId, options }) {
  const presets = getPresets();
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('A preset needs a name.');

  if (id) {
    const index = presets.findIndex((preset) => preset.id === id);
    if (index >= 0) {
      presets[index] = { ...presets[index], name: trimmedName, toolId, options: clone(options), updatedAt: Date.now() };
      writeJson(STORAGE_KEYS.presets, presets);
      return presets;
    }
  }

  if (presets.length >= LIMITS.presets) {
    throw new Error('Preset limit reached (' + LIMITS.presets + '). Delete one first.');
  }

  presets.unshift({
    id: newId(),
    name: trimmedName,
    toolId,
    options: clone(options),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  writeJson(STORAGE_KEYS.presets, presets);
  return presets;
}

export function removePreset(id) {
  const presets = getPresets().filter((preset) => preset.id !== id);
  writeJson(STORAGE_KEYS.presets, presets);
  return presets;
}

/** Wipe every trace of this app from the browser. */
export function clearEverything() {
  for (const key of Object.values(STORAGE_KEYS)) removeRaw(key);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function newId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clone(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? {}));
  }
}

/** Rough byte usage, shown in the History dialog so the cost is visible. */
export function storageFootprint() {
  let bytes = 0;
  for (const key of Object.values(STORAGE_KEYS)) {
    const raw = readRaw(key);
    if (raw) bytes += raw.length * 2; // UTF-16 code units
  }
  return bytes;
}
