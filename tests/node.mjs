/**
 * node.mjs — run the whole suite from a terminal.
 *
 * tests/index.html is still the place to run the converter tests while
 * developing, because it shows them next to the app they exercise. This driver
 * exists so the same suite can run in CI, and so the SEO checks in seo.mjs —
 * which read generated files off disk and therefore cannot run in a browser —
 * have somewhere to live.
 *
 * The handful of tests that genuinely need a DOM report as skipped rather than
 * passing: a silent pass would misrepresent what was checked.
 *
 * Run:  node tests/node.mjs
 * Exit: 0 when everything passed, 1 on the first failure reported.
 */

import { runTests, getTests } from './tests.js';
import { seoTests } from './seo.mjs';

const RESET = '[0m';
const RED = '[31m';
const GREEN = '[32m';
const DIM = '[2m';

async function runList(tests) {
  const results = [];
  for (const entry of tests) {
    const started = performance.now();
    try {
      await entry.fn();
      results.push({ ...entry, status: 'pass', duration: performance.now() - started });
    } catch (error) {
      results.push({
        ...entry,
        status: error.name === 'SkipTest' ? 'skip' : 'fail',
        duration: performance.now() - started,
        message: error.message,
        actual: error.actual,
        expected: error.expected,
      });
    }
  }
  return results;
}

function report(label, results) {
  const passed = results.filter((r) => r.status === 'pass').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const failures = results.filter((r) => r.status === 'fail');

  const colour = failures.length ? RED : GREEN;
  console.log(
    `${colour}${label}${RESET}  ${passed} passed` +
      (skipped ? `, ${skipped} skipped` : '') +
      (failures.length ? `, ${RED}${failures.length} failed${RESET}` : ''),
  );

  for (const failure of failures) {
    console.log(`\n  ${RED}FAIL${RESET} ${failure.group} › ${failure.name}`);
    console.log(`       ${failure.message}`);
    if (failure.expected !== undefined || failure.actual !== undefined) {
      console.log(`       ${DIM}expected:${RESET} ${preview(failure.expected)}`);
      console.log(`       ${DIM}actual:  ${RESET} ${preview(failure.actual)}`);
    }
  }
  return failures.length;
}

function preview(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return '(nothing)';
  return text.length > 300 ? text.slice(0, 300) + ' …' : text;
}

const appResults = await runTests();
const seoResults = await runList(seoTests);

console.log('');
let failed = report('converters ', appResults);
failed += report('seo        ', seoResults);

console.log(
  `\n${appResults.length + seoResults.length} tests ` +
    `(${getTests().length} converter, ${seoTests.length} seo)`,
);

process.exit(failed ? 1 : 0);
