/**
 * regex-worker.js — runs user regular expressions off the main thread.
 *
 * A catastrophically backtracking pattern such as /(a+)+b/ against a long
 * string of "a" will spin for minutes. On the main thread that freezes the tab
 * with no way out; here the client simply terminates the worker after its
 * timeout and reports "Regex timed out".
 *
 * The worker imports only pure functions and has no network or storage access.
 */

import { runRegex, replaceWithRegex } from '../converters/regex.js';

self.addEventListener('message', (event) => {
  const { id, action, payload } = event.data ?? {};
  try {
    const data = action === 'replace' ? replaceWithRegex(payload) : runRegex(payload);
    self.postMessage({ id, ok: true, data });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: {
        name: error?.name ?? 'Error',
        message: error?.message ?? 'Regex execution failed.',
        hint: error?.hint,
      },
    });
  }
});
