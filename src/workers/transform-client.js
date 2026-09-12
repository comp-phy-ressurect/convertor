/**
 * transform-client.js — main-thread side of the transform worker.
 *
 * One worker is kept alive and reused: unlike regex, these converters always
 * terminate, so there is nothing to kill and paying the worker startup cost on
 * every keystroke would be worse than the problem it solves.
 */

import { ConversionError } from '../converters/shared.js';
import { TRANSFORMABLE } from './transform-worker.js';

/** Below this size, the round trip costs more than it saves. */
export const WORKER_THRESHOLD_BYTES = 512 * 1024;

let worker = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map();

export function canUseWorker(toolId, byteLength) {
  return (
    !workerBroken &&
    typeof Worker !== 'undefined' &&
    TRANSFORMABLE.includes(toolId) &&
    byteLength >= WORKER_THRESHOLD_BYTES
  );
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./transform-worker.js', import.meta.url), { type: 'module' });

  worker.addEventListener('message', (event) => {
    const { id, ok, data, error } = event.data ?? {};
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok) {
      entry.resolve({
        output: new TextDecoder().decode(new Uint8Array(data.outputBuffer)),
        notes: data.notes,
        warnings: data.warnings,
        details: data.details,
      });
    } else {
      entry.reject(new ConversionError(error?.message ?? 'Conversion failed.', error));
    }
  });

  worker.addEventListener('error', () => {
    // A broken worker must not take the app down: reject everything in flight
    // and fall back to the main thread from now on.
    workerBroken = true;
    for (const entry of pending.values()) entry.reject(new Error('worker-unavailable'));
    pending.clear();
    worker?.terminate();
    worker = null;
  });

  return worker;
}

/**
 * Run a transform in the worker.
 * @throws {Error} with message 'worker-unavailable' when the caller should
 *   simply run the pure function itself.
 */
export function runInWorker(toolId, input, options) {
  let instance;
  try {
    instance = ensureWorker();
  } catch {
    workerBroken = true;
    return Promise.reject(new Error('worker-unavailable'));
  }

  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      // Transfer the bytes rather than cloning the string: ownership moves to
      // the worker in constant time instead of copying half a megabyte.
      const encoded = new TextEncoder().encode(input);
      instance.postMessage({ id, toolId, inputBuffer: encoded.buffer, options }, [encoded.buffer]);
    } catch (error) {
      pending.delete(id);
      reject(new ConversionError('Could not hand this input to the worker: ' + error.message));
    }
  });
}
