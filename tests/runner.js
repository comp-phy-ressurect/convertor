/**
 * runner.js — wiring for the test harness page.
 *
 * Kept in its own file rather than inline so that the production CSP
 * (script-src 'self', no unsafe-inline) applies to this page too.
 *
 * Every value below reaches the DOM through textContent or createTextNode:
 * a failing assertion prints user-supplied-looking data, and the harness must
 * not become the one place where that is unsafe.
 */

import { runTests, getTests } from './tests.js';

const resultsNode = document.getElementById('results');
const summaryNode = document.getElementById('summary');
const runButton = document.getElementById('run');
const onlyFailures = document.getElementById('only-failures');

const groups = new Map();

function groupNode(name) {
  if (groups.has(name)) return groups.get(name);
  const section = document.createElement('section');
  section.className = 'test-group';
  const heading = document.createElement('h2');
  heading.textContent = name;
  section.appendChild(heading);
  const list = document.createElement('ul');
  list.className = 'test-list';
  section.appendChild(list);
  resultsNode.appendChild(section);
  groups.set(name, list);
  return list;
}

/** Every value below is rendered with textContent — never innerHTML. */
function renderResult(result) {
  const item = document.createElement('li');
  item.className = 'test test--' + result.status;
  item.dataset.status = result.status;

  const head = document.createElement('div');
  head.className = 'test__head';

  const badge = document.createElement('span');
  badge.className = 'test__badge';
  badge.textContent = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }[result.status] ?? result.status.toUpperCase();
  head.appendChild(badge);

  const name = document.createElement('span');
  name.className = 'test__name';
  name.textContent = result.name;
  head.appendChild(name);

  const time = document.createElement('span');
  time.className = 'test__time';
  time.textContent = result.duration.toFixed(1) + ' ms';
  head.appendChild(time);

  item.appendChild(head);

  if (result.status === 'skip' && result.message) {
    const why = document.createElement('p');
    why.className = 'test__message test__message--skip';
    why.textContent = result.message;
    item.appendChild(why);
  }

  if (result.status === 'fail') {
    const message = document.createElement('p');
    message.className = 'test__message';
    message.textContent = result.message;
    item.appendChild(message);

    if (result.expected !== undefined || result.actual !== undefined) {
      const table = document.createElement('div');
      table.className = 'test__diff';
      for (const [label, value] of [['Expected', result.expected], ['Actual', result.actual]]) {
        if (value === undefined) continue;
        const block = document.createElement('div');
        block.className = 'test__block';
        const title = document.createElement('h3');
        title.textContent = label;
        const pre = document.createElement('pre');
        pre.appendChild(document.createTextNode(String(value)));
        block.appendChild(title);
        block.appendChild(pre);
        table.appendChild(block);
      }
      item.appendChild(table);
    }
  }

  groupNode(result.group).appendChild(item);
}

function applyFilter() {
  document.body.classList.toggle('only-failures', onlyFailures.checked);
}

onlyFailures.addEventListener('change', applyFilter);

async function run() {
  runButton.disabled = true;
  runButton.textContent = 'Running…';
  resultsNode.textContent = '';
  groups.clear();
  summaryNode.textContent = 'Running ' + getTests().length + ' tests…';

  const started = performance.now();
  const results = await runTests(renderResult);
  const elapsed = performance.now() - started;

  const passed = results.filter((r) => r.status === 'pass').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const failed = results.length - passed - skipped;

  summaryNode.textContent =
    passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' skipped' : '') + ', ' + results.length + ' total in ' + elapsed.toFixed(0) + ' ms';
  summaryNode.className = 'test-summary ' + (failed ? 'test-summary--fail' : 'test-summary--pass');
  document.title = (failed ? '✗ ' + failed + ' failing' : '✓ all passing') + ' — DevConvert tests';

  runButton.disabled = false;
  runButton.textContent = 'Run all tests';
  applyFilter();
}

runButton.addEventListener('click', run);
run();
