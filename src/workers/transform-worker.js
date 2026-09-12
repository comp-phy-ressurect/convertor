/**
 * transform-worker.js — runs the heavy text-in/text-out converters off the
 * main thread.
 *
 * Parsing a 5 MiB JSON document and re-serializing it as YAML takes long enough
 * to drop frames and block input. Only converters whose entire contract is
 * (string, plain options) -> plain result can run here, because everything must
 * survive structured cloning; regex has its own worker (it needs a hard kill),
 * and hashing is already async through Web Crypto.
 */

import { formatJson } from '../converters/structured-data.js';
import {
  jsonToTypeScript, jsonToZod, jsonToPython, jsonToGo,
  jsonToSql, jsonToJsonSchema,
} from '../converters/codegen.js';
import { convertFormat } from '../converters/formats.js';

/**
 * Only these ids may be dispatched — a fixed table, never a dynamic lookup.
 *
 * Every format-matrix tool dispatches under 'format-converter': app.js rewrites
 * the id before sending, because the selected pair may no longer match the pair
 * the tool's page is named after. Listing 'json-to-yaml' and friends here as
 * well would be dead weight *and* a trap — those entries would point at the
 * pairwise functions, which take different options and would quietly diverge
 * from what the same tool does on the main thread.
 */
const TRANSFORMS = {
  'format-converter': convertFormat,
  'json-formatter': formatJson,
  'json-to-typescript': jsonToTypeScript,
  'json-to-zod': jsonToZod,
  'json-to-python': jsonToPython,
  'json-to-go': jsonToGo,
  'json-to-sql': jsonToSql,
  'json-to-json-schema': jsonToJsonSchema,
};

export const TRANSFORMABLE = Object.keys(TRANSFORMS);

/**
 * The main thread imports this module for TRANSFORMABLE alone. Registering the
 * listener unconditionally would attach it to `window` there, where it would
 * respond to any postMessage the page receives — so bind it only inside a real
 * worker global scope.
 */
const inWorker =
  typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope;

if (inWorker) {
  self.addEventListener('message', handleMessage);
}

function handleMessage(event) {
  const { id, toolId, inputBuffer, options } = event.data ?? {};
  const transform = TRANSFORMS[toolId];

  if (!transform) {
    self.postMessage({ id, ok: false, error: { message: 'Tool "' + toolId + '" cannot run in a worker.' } });
    return;
  }

  try {
    // Input and output cross the thread boundary as transferable ArrayBuffers.
    // Passing the strings directly would make structured clone copy every byte
    // on the sending thread — which is exactly the main-thread stall the worker
    // exists to avoid, and it measured slower than not using a worker at all.
    const input = new TextDecoder().decode(new Uint8Array(inputBuffer));
    const output = transform(input, options ?? {});
    const encoded = new TextEncoder().encode(output.output);

    self.postMessage(
      {
        id,
        ok: true,
        data: {
          outputBuffer: encoded.buffer,
          notes: output.notes,
          warnings: output.warnings,
          details: output.details,
        },
      },
      [encoded.buffer],
    );
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: {
        name: error?.name ?? 'Error',
        message: error?.message ?? 'Conversion failed.',
        line: error?.line,
        column: error?.column,
        hint: error?.hint,
      },
    });
  }
}
