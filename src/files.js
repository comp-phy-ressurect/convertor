/**
 * files.js — local file reading and downloading.
 *
 * Files are read with the File API in this tab. There is no upload: no fetch,
 * no XHR, no form submission. Downloads are produced from an in-memory Blob and
 * a revoked object URL.
 */

import { SIZE_LEVEL, byteLength, classifySize, formatBytes, SIZE_POLICY } from './security.js';
import { FEATURES } from './config.js';

/**
 * Decide what to do with a file or pasted payload before touching it.
 * @returns {{ level: string, message?: string, blocked: boolean }}
 */
export function checkSize(bytes, { forceAllow = false } = {}) {
  const level = classifySize(bytes);
  if (level === SIZE_LEVEL.NORMAL) {
    return { level, blocked: false };
  }
  if (level === SIZE_LEVEL.WARN) {
    return {
      level,
      blocked: false,
      message:
        formatBytes(bytes) + ' is large. Conversion may take a few seconds and can make the page unresponsive.',
    };
  }
  if (forceAllow || FEATURES.largeInputs) {
    return {
      level,
      blocked: false,
      message: formatBytes(bytes) + ' exceeds the usual limit and is being processed at your request.',
    };
  }
  return {
    level,
    blocked: true,
    message:
      formatBytes(bytes) + ' is above the ' + formatBytes(SIZE_POLICY.WARN_MAX) +
      ' limit. Split it first, or use a streaming tool.',
  };
}

export function checkTextSize(text, options) {
  return checkSize(byteLength(text), options);
}

/**
 * Read a file as text. Resolves with { text, file, warning }.
 * Rejects with a friendly Error when the file is too large or unreadable.
 */
export async function readFileAsText(file, { forceAllow = false } = {}) {
  if (!file) throw new Error('No file selected.');
  const verdict = checkSize(file.size, { forceAllow });
  if (verdict.blocked) throw new Error(verdict.message);

  try {
    const text = await file.text();
    return { text, file, warning: verdict.message };
  } catch (error) {
    throw new Error('Could not read "' + file.name + '": ' + (error?.message ?? 'unknown error') + '.');
  }
}

/**
 * Stream a CSV file through Papa Parse's worker so a large file never has to
 * exist as one giant string. Falls back to a plain read when streaming is not
 * worthwhile.
 */
export async function streamCsvFile(file, papa, { header = true, dynamicTyping = false, delimiter = '', maxRows = 100000 } = {}) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const errors = [];
    let truncated = false;

    papa.parse(file, {
      header,
      dynamicTyping,
      delimiter,
      skipEmptyLines: 'greedy',
      worker: true,
      step: (results, parser) => {
        if (rows.length >= maxRows) {
          truncated = true;
          parser.abort();
          return;
        }
        if (results.errors?.length) errors.push(...results.errors);
        rows.push(results.data);
      },
      complete: () => resolve({ rows, errors, truncated, meta: { rowCount: rows.length } }),
      error: (error) => reject(new Error('CSV streaming failed: ' + error.message)),
    });
  });
}

/** Trigger a download of text content. Nothing leaves the machine. */
export function downloadText(filename, text, mimeType = 'text/plain') {
  const blob = new Blob([text], { type: mimeType + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MIME_BY_EXTENSION = {
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.ts': 'text/plain',
  '.py': 'text/x-python',
  '.go': 'text/plain',
  '.sql': 'application/sql',
  '.txt': 'text/plain',
  '.diff': 'text/x-diff',
  '.js': 'text/javascript',
};

export function mimeForExtension(extension) {
  return MIME_BY_EXTENSION[extension] ?? 'text/plain';
}

/** Build a stable, filesystem-safe download name for a tool's output. */
export function downloadNameFor(tool, extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = (tool?.slug ?? 'devconvert').replace(/[^a-z0-9-]/gi, '-');
  return base + '-' + stamp + (extension ?? '.txt');
}

/** Copy to clipboard with a fallback for browsers without the async API. */
export async function copyToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the legacy path — usually a permissions issue.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Pull the first usable file out of a drag-and-drop event. */
export function fileFromDropEvent(event) {
  const items = event.dataTransfer?.items;
  if (items?.length) {
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  return event.dataTransfer?.files?.[0] ?? null;
}
