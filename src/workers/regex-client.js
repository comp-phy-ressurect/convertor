/**
 * regex-client.js — main-thread side of the regex worker.
 *
 * Each run gets a fresh worker that is terminated on completion, on error and
 * on timeout. Reusing one worker would be cheaper, but a worker stuck in a
 * catastrophic backtrack can never be recovered — only killed — so a
 * per-run worker is the design that actually keeps the timeout meaningful.
 */

import { LIMITS } from '../config.js';
import { ConversionError } from '../converters/shared.js';
import { runRegex as runRegexSync, replaceWithRegex as replaceSync } from '../converters/regex.js';

/**
 * Set once a worker has actually failed to start or failed to load.
 *
 * There is deliberately no feature probe here. The obvious probe — building a
 * throwaway worker from a blob: URL and watching whether the `type` option is
 * read — is itself blocked by the production CSP (`worker-src 'self'`), so it
 * would report "no module workers" on exactly the deployment that supports
 * them, silently dropping the timeout that makes this tool safe. Instead we
 * try the real worker and fall back only when the real worker really fails.
 */
let workerUnavailable = typeof Worker === 'undefined';

function runSynchronously(payload, action) {
  // Degraded path: no worker, so no timeout is possible. Still correct, just
  // interruptible only by the browser's own slow-script dialog.
  const data = action === 'replace' ? replaceSync(payload) : runRegexSync(payload);
  return { data, degraded: true };
}

/**
 * Run a regex with a hard wall-clock limit.
 * @returns {Promise<{ data: object, degraded: boolean }>}
 */
export function runRegexInWorker(payload, { action = 'run', timeoutMs = LIMITS.regexTimeoutMs } = {}) {
  if (workerUnavailable) {
    return Promise.resolve(runSynchronously(payload, action));
  }

  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./regex-worker.js', import.meta.url), { type: 'module' });
    } catch {
      // A browser without module workers throws here. Remember it and run the
      // pattern on this thread rather than failing the conversion outright.
      workerUnavailable = true;
      resolve(runSynchronously(payload, action));
      return;
    }

    const id = Math.random().toString(36).slice(2);
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      worker.terminate();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new ConversionError('Regex timed out after ' + timeoutMs + ' ms.', {
          hint:
            'This pattern backtracks catastrophically on your input. Nested quantifiers such as (a+)+ are the usual cause — try making the inner group possessive-ish with a more specific character class.',
        }),
      );
    }, timeoutMs);

    worker.addEventListener('message', (event) => {
      if (settled || event.data?.id !== id) return;
      settled = true;
      cleanup();
      if (event.data.ok) {
        resolve({ data: event.data.data, degraded: false });
      } else {
        const { message, hint } = event.data.error ?? {};
        reject(new ConversionError(message ?? 'Regex execution failed.', { hint }));
      }
    });

    worker.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      cleanup();
      // The worker failed to load or parse — an old browser that treated the
      // module as a classic script, or a CSP that refuses it. Either way this
      // will fail every time, so stop trying and degrade for the rest of the
      // session instead of showing the user an error they cannot act on.
      workerUnavailable = true;
      resolve(runSynchronously(payload, action));
    });

    worker.postMessage({ id, action, payload });
  });
}
