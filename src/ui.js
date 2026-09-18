/**
 * ui.js — DOM construction and rendering.
 *
 * Hard rule for this file: untrusted text (user input, converter output, error
 * messages, regex matches, diff hunks) reaches the page ONLY through
 * textContent or createTextNode. There is not one innerHTML assignment here,
 * which is what makes highlighting and diffing safe with arbitrary input.
 */

import { el, clearNode, formatBytes } from './security.js';
import { formatDetection, TYPE_LABELS } from './detect.js';
import { FORMATS, formatChoices } from './converters/formats.js';
import { toolsByCategory, relatedTools, getToolBySlug, CATEGORY_META } from './tool-registry.js';
import { pathForSlug } from './router.js';
import { PRODUCT } from './config.js';

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

export function renderToolNav(container, activeSlug) {
  clearNode(container);
  container.appendChild(el('h2', { className: 'tool-nav__title', text: 'Tools' }));

  for (const group of toolsByCategory()) {
    const section = el('section', { className: 'tool-nav__group' });
    section.appendChild(el('h3', { className: 'tool-nav__heading', text: group.category }));
    const list = el('ul', { className: 'tool-nav__list' });

    for (const tool of group.tools) {
      const isActive = tool.slug === activeSlug;
      const link = el('a', {
        text: tool.label,
        attrs: {
          href: pathForSlug(tool.slug),
          'data-slug': tool.slug,
          'aria-current': isActive ? 'page' : null,
        },
      });
      list.appendChild(el('li', { children: [link] }));
    }
    section.appendChild(list);
    container.appendChild(section);
  }
}

/* ------------------------------------------------------------------ *
 * Workspace
 * ------------------------------------------------------------------ */

/**
 * Build the whole workspace for a tool. Returns a map of the live nodes the
 * controller needs, so app.js never has to query the DOM by selector.
 */
export function renderWorkspace(root, tool, { options, settings, formats, headingLevel = 'h1', showRelated = true }) {
  clearNode(root);
  const refs = {};
  // `formats` is present only for the format-matrix tools; everything else
  // renders exactly as before.
  const activeFormats = tool.formats ? formats ?? tool.formats : null;

  /* --- Breadcrumb ---------------------------------------------- */
  // The static landing page ships the same trail so a crawler sees it; this
  // rebuild is what keeps it correct after navigating to another tool.
  root.appendChild(buildBreadcrumb(tool));

  /* --- Heading ------------------------------------------------- */
  const head = el('header', { className: 'tool-head' });
  head.appendChild(el(headingLevel, { className: 'tool-head__title', text: tool.label }));
  head.appendChild(el('p', { className: 'tool-head__description', text: tool.description }));

  if (activeFormats) {
    // With selectors driving the conversion, swapping is a state change rather
    // than a navigation — the target pair may not even have its own page.
    const from = FORMATS[activeFormats.from];
    const to = FORMATS[activeFormats.to];
    refs.swapButton = el('button', {
      className: 'button button--ghost tool-head__swap',
      text: '⇄ ' + to.label + ' → ' + from.label,
      attrs: { type: 'button', 'data-action': 'swap-formats', title: 'Swap the input and output formats' },
    });
    head.appendChild(refs.swapButton);
  } else if (tool.swap) {
    const other = getToolBySlug(tool.swap);
    if (other) {
      const swap = el('a', {
        className: 'button button--ghost tool-head__swap',
        text: '⇄ ' + other.label,
        attrs: { href: pathForSlug(other.slug), 'data-slug': other.slug, title: 'Convert the other way' },
      });
      head.appendChild(swap);
    }
  }
  root.appendChild(head);

  // describeConversion() still exists and is still tested — it is simply not
  // shown above every conversion. The output itself is the answer.

  if (tool.banner) {
    root.appendChild(
      el('p', {
        className: 'banner banner--' + tool.banner.level,
        text: tool.banner.text,
        attrs: { role: tool.banner.level === 'warning' ? 'alert' : null },
      }),
    );
  }

  /* --- Panes --------------------------------------------------- */
  const panes = el('div', { className: 'panes' + (tool.secondaryInput ? ' panes--three' : '') });

  if (tool.input) {
    const inputPane = buildInputPane(tool, tool.input, 'input', activeFormats);
    refs.input = inputPane.textarea;
    refs.inputPane = inputPane.node;
    refs.detection = inputPane.detection;
    refs.inputMeta = inputPane.meta;
    refs.fileInput = inputPane.fileInput;
    refs.fromFormat = inputPane.formatSelect;
    panes.appendChild(inputPane.node);
  }

  if (tool.secondaryInput) {
    const secondPane = buildInputPane(tool, tool.secondaryInput, 'secondary', null);
    refs.secondaryInput = secondPane.textarea;
    refs.secondaryMeta = secondPane.meta;
    refs.secondaryFileInput = secondPane.fileInput;
    panes.appendChild(secondPane.node);
  }

  const outputPane = buildOutputPane(tool, settings, activeFormats);
  refs.output = outputPane.body;
  refs.outputPane = outputPane.node;
  refs.outputMeta = outputPane.meta;
  refs.copyButton = outputPane.copyButton;
  refs.downloadButton = outputPane.downloadButton;
  refs.toFormat = outputPane.formatSelect;
  panes.appendChild(outputPane.node);

  root.appendChild(panes);

  /* --- Run bar ------------------------------------------------- */
  const runBar = el('div', { className: 'run-bar' });
  const runButton = el('button', {
    className: 'button button--primary',
    text: tool.generator ? 'Generate' : 'Convert',
    attrs: { type: 'button', id: 'run-button' },
  });
  refs.runButton = runButton;
  runBar.appendChild(runButton);
  runBar.appendChild(el('kbd', { className: 'run-bar__kbd', text: 'Ctrl + Enter' }));

  for (const action of tool.actions ?? []) {
    runBar.appendChild(
      el('button', {
        className: 'button button--ghost',
        text: action.label,
        attrs: { type: 'button', 'data-action': action.id },
      }),
    );
  }
  /* --- Status (aria-live), inline with the run bar -------------- */
  const status = el('div', {
    className: 'status',
    attrs: { id: 'status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });
  refs.status = status;
  runBar.appendChild(status);

  root.appendChild(runBar);

  /* --- Options, below the panes -------------------------------- */
  const optionsPanel = renderOptions(tool, options);
  refs.optionsForm = optionsPanel.form;
  root.appendChild(optionsPanel.node);

  /* --- Related -------------------------------------------------- */
  // The static landing page already carries a richer related list, with a line
  // of description per link, and it survives this render. Drawing a second,
  // barer one under it would just repeat the heading.
  const related = showRelated ? relatedTools(tool, 5) : [];
  if (related.length) {
    const section = el('nav', { className: 'related', attrs: { 'aria-label': 'Related tools' } });
    section.appendChild(el('h2', { text: 'Related tools' }));
    const list = el('ul');
    for (const other of related) {
      list.appendChild(
        el('li', {
          children: [el('a', { text: other.label, attrs: { href: pathForSlug(other.slug), 'data-slug': other.slug } })],
        }),
      );
    }
    section.appendChild(list);
    root.appendChild(section);
  }

  return refs;
}

/**
 * The format selector that sits in a pane header.
 *
 * This is the control that turns fixed pairs into a matrix: pick JSON on the
 * left and XML on the right and the conversion follows, whether or not that
 * particular pair has its own page.
 */
/** Tools › Category › This tool, matching the BreadcrumbList in the page head. */
function buildBreadcrumb(tool) {
  const nav = el('nav', { className: 'breadcrumb', attrs: { 'aria-label': 'Breadcrumb' } });
  const list = el('ol');
  const meta = CATEGORY_META[tool.category];

  const steps = [
    { name: 'Tools', href: '/tools/' },
    ...(meta ? [{ name: tool.category, href: '/tools/' + meta.slug + '/' }] : []),
    { name: tool.label },
  ];

  for (const step of steps) {
    const item = el('li');
    if (step.href) {
      item.appendChild(el('a', { text: step.name, attrs: { href: step.href } }));
    } else {
      item.textContent = step.name;
      item.setAttribute('aria-current', 'page');
    }
    list.appendChild(item);
  }
  nav.appendChild(list);
  return nav;
}

function buildFormatSelect(kind, selected) {
  const id = 'format-' + kind;
  const wrap = el('div', { className: 'format-select' });
  wrap.appendChild(el('label', {
    className: 'visually-hidden',
    text: kind === 'to' ? 'Output format' : 'Input format',
    attrs: { for: id },
  }));

  const select = el('select', {
    className: 'format-select__control',
    attrs: { id, 'data-format-role': kind, title: (kind === 'to' ? 'Output' : 'Input') + ' format' },
  });
  for (const choice of formatChoices()) {
    const option = el('option', { text: choice.label, attrs: { value: choice.value } });
    if (choice.value === selected) option.selected = true;
    select.appendChild(option);
  }
  wrap.appendChild(select);
  return { node: wrap, select };
}

function buildInputPane(tool, spec, kind, formats) {
  const node = el('section', { className: 'pane pane--input', attrs: { 'data-kind': kind } });
  const head = el('div', { className: 'pane__head' });
  const id = 'field-' + kind;

  // With a format selector present the label would just repeat it, so the
  // selector *is* the title.
  const showSelect = Boolean(formats) && kind === 'input';
  let formatSelect = null;

  if (showSelect) {
    formatSelect = buildFormatSelect('from', formats.from);
    head.appendChild(formatSelect.node);
  } else {
    head.appendChild(el('label', { className: 'pane__title', text: spec.label, attrs: { for: id } }));
  }

  const tools = el('div', { className: 'pane__tools' });
  tools.appendChild(button('Example', { 'data-action': 'example', 'data-target': kind }));
  tools.appendChild(button('Upload', { 'data-action': 'upload', 'data-target': kind }));
  tools.appendChild(button('Clear', { 'data-action': 'clear', 'data-target': kind }));
  head.appendChild(tools);
  node.appendChild(head);

  // When the selector replaces the visible label the editor still needs an
  // accessible name, so it carries one that names the selected format.
  const fieldName = showSelect ? (FORMATS[formats.from]?.label ?? spec.label) + ' input' : null;

  const textarea = el('textarea', {
    className: 'editor',
    attrs: {
      id,
      spellcheck: 'false',
      autocapitalize: 'off',
      autocorrect: 'off',
      'data-kind': kind,
      placeholder: 'Paste ' + (showSelect ? FORMATS[formats.from]?.label ?? spec.label : spec.label) + ' here, or drop a file…',
      'aria-label': fieldName,
      'aria-describedby': kind === 'input' ? 'detection' : null,
    },
  });
  node.appendChild(textarea);

  const fileInput = el('input', {
    className: 'visually-hidden',
    attrs: {
      type: 'file',
      accept: spec.accept ?? '*',
      'data-target': kind,
      tabindex: '-1',
      'aria-hidden': 'true',
    },
  });
  node.appendChild(fileInput);

  const foot = el('div', { className: 'pane__foot' });
  const meta = el('span', { className: 'pane__meta', text: 'Empty' });
  foot.appendChild(meta);

  let detection = null;
  if (kind === 'input') {
    detection = el('span', {
      className: 'detection',
      text: '',
      attrs: { id: 'detection', 'aria-live': 'polite' },
    });
    foot.appendChild(detection);
  }
  node.appendChild(foot);

  return { node, textarea, meta, detection, fileInput, formatSelect: formatSelect?.select ?? null };
}

function buildOutputPane(tool, settings, formats) {
  const node = el('section', { className: 'pane pane--output' });
  const head = el('div', { className: 'pane__head' });

  let formatSelect = null;
  if (formats) {
    formatSelect = buildFormatSelect('to', formats.to);
    head.appendChild(formatSelect.node);
  } else {
    head.appendChild(el('h2', { className: 'pane__title', text: tool.output.label }));
  }

  const tools = el('div', { className: 'pane__tools' });
  const copyButton = button('Copy', { 'data-action': 'copy' });
  const downloadButton = button('Download', { 'data-action': 'download' });
  tools.appendChild(copyButton);
  tools.appendChild(downloadButton);
  head.appendChild(tools);
  node.appendChild(head);

  const body = el('div', {
    className: 'output' + (settings?.wrapOutput ? ' output--wrap' : ''),
    attrs: { id: 'output', tabindex: '0', 'aria-label': tool.output.label + ' result' },
  });
  body.appendChild(el('p', { className: 'output__placeholder', text: 'Output appears here.' }));
  node.appendChild(body);

  const foot = el('div', { className: 'pane__foot' });
  const meta = el('span', { className: 'pane__meta', text: '' });
  foot.appendChild(meta);
  node.appendChild(foot);

  return { node, body, meta, copyButton, downloadButton, formatSelect: formatSelect?.select ?? null };
}

function button(label, attrs) {
  return el('button', { className: 'button button--small', text: label, attrs: { type: 'button', ...attrs } });
}

/* ------------------------------------------------------------------ *
 * Options panel
 * ------------------------------------------------------------------ */

export function renderOptions(tool, values) {
  const node = el('section', { className: 'options', attrs: { 'aria-label': 'Options' } });
  const form = el('form', { className: 'options__form', attrs: { id: 'options-form' } });
  form.addEventListener('submit', (event) => event.preventDefault());

  if (!tool.options?.length) {
    node.appendChild(el('p', { className: 'options__empty', text: 'This tool has no options.' }));
    node.appendChild(form);
    return { node, form };
  }

  for (const option of tool.options) {
    form.appendChild(renderOption(option, values?.[option.id]));
  }

  const details = el('details', { className: 'options__wrapper', attrs: { open: true } });
  details.appendChild(el('summary', { text: 'Options' }));
  details.appendChild(form);
  node.appendChild(details);
  return { node, form };
}

function renderOption(option, value) {
  const id = 'option-' + option.id;
  const attrs = {};
  if (option.dependsOn) attrs['data-depends-on'] = JSON.stringify(option.dependsOn);
  if (option.appliesTo) attrs['data-applies-to'] = JSON.stringify(option.appliesTo);

  const field = el('div', {
    className: 'field field--' + option.type,
    attrs: Object.keys(attrs).length ? attrs : undefined,
  });

  switch (option.type) {
    case 'checkbox': {
      const input = el('input', {
        attrs: { type: 'checkbox', id, name: option.id, checked: Boolean(value) },
      });
      const label = el('label', { attrs: { for: id }, children: [input, document.createTextNode(' ' + option.label)] });
      field.appendChild(label);
      break;
    }
    case 'checkbox-group': {
      const group = el('fieldset', { className: 'field__group' });
      group.appendChild(el('legend', { text: option.label }));
      const selected = new Set(Array.isArray(value) ? value : []);
      for (const choice of option.choices) {
        const choiceId = id + '-' + choice.value;
        const input = el('input', {
          attrs: { type: 'checkbox', id: choiceId, name: option.id, value: choice.value, checked: selected.has(choice.value) },
        });
        const label = el('label', {
          className: 'field__choice',
          attrs: { for: choiceId },
          children: [input, document.createTextNode(' ' + choice.label)],
        });
        group.appendChild(label);
        if (choice.help) group.appendChild(el('span', { className: 'field__help', text: choice.help }));
      }
      field.appendChild(group);
      break;
    }
    case 'flags': {
      const group = el('fieldset', { className: 'field__group field__group--inline' });
      group.appendChild(el('legend', { text: option.label }));
      const active = new Set(String(value ?? '').split(''));
      for (const choice of option.choices) {
        const choiceId = id + '-' + choice.value;
        const input = el('input', {
          attrs: { type: 'checkbox', id: choiceId, name: option.id, value: choice.value, checked: active.has(choice.value) },
        });
        group.appendChild(
          el('label', {
            className: 'field__choice field__choice--flag',
            attrs: { for: choiceId, title: choice.label },
            children: [input, document.createTextNode(' ' + choice.value)],
          }),
        );
      }
      field.appendChild(group);
      break;
    }
    case 'select': {
      field.appendChild(el('label', { text: option.label, attrs: { for: id } }));
      const select = el('select', { attrs: { id, name: option.id } });
      for (const choice of option.choices) {
        const choiceEl = el('option', { text: choice.label, attrs: { value: choice.value } });
        if (String(choice.value) === String(value)) choiceEl.selected = true;
        select.appendChild(choiceEl);
      }
      field.appendChild(select);
      break;
    }
    case 'number': {
      field.appendChild(el('label', { text: option.label, attrs: { for: id } }));
      field.appendChild(
        el('input', {
          attrs: { type: 'number', id, name: option.id, value: value ?? option.default, min: option.min, max: option.max },
        }),
      );
      break;
    }
    default: {
      field.appendChild(el('label', { text: option.label, attrs: { for: id } }));
      field.appendChild(
        el('input', {
          className: option.monospace ? 'mono' : null,
          attrs: {
            type: 'text',
            id,
            name: option.id,
            value: value ?? option.default ?? '',
            placeholder: option.placeholder,
            spellcheck: 'false',
          },
        }),
      );
    }
  }

  if (option.help && option.type !== 'checkbox-group') {
    field.appendChild(el('span', { className: 'field__help', text: option.help }));
  }
  return field;
}

/**
 * Read an options form back into a plain object.
 * Checkbox groups collect values; the regex "flags" control joins letters.
 */
export function readOptionsForm(tool, form) {
  const values = {};
  for (const option of tool.options ?? []) {
    if (option.type === 'checkbox') {
      values[option.id] = form.querySelector('#option-' + cssEscape(option.id))?.checked ?? option.default;
    } else if (option.type === 'checkbox-group') {
      values[option.id] = [...form.querySelectorAll('input[name="' + cssEscape(option.id) + '"]:checked')].map((i) => i.value);
    } else if (option.type === 'flags') {
      values[option.id] = [...form.querySelectorAll('input[name="' + cssEscape(option.id) + '"]:checked')].map((i) => i.value).join('');
    } else {
      const node = form.querySelector('#option-' + cssEscape(option.id));
      values[option.id] = node ? node.value : option.default;
    }
  }
  return values;
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&');
}

/**
 * Show only the options that apply right now.
 *
 * Two mechanisms: `dependsOn` reacts to another option's value (the regex
 * replacement field), and `appliesTo` reacts to the selected formats — a CSV
 * delimiter control is noise when converting YAML to XML.
 */
export function applyOptionDependencies(form, values, formats) {
  for (const field of form.querySelectorAll('[data-depends-on]')) {
    let condition;
    try {
      condition = JSON.parse(field.dataset.dependsOn);
    } catch {
      continue;
    }
    const visible = Object.entries(condition).every(([key, expected]) => String(values[key]) === String(expected));
    field.hidden = !visible;
  }

  for (const field of form.querySelectorAll('[data-applies-to]')) {
    let rule;
    try {
      rule = JSON.parse(field.dataset.appliesTo);
    } catch {
      continue;
    }
    field.hidden = !optionApplies(rule, formats);
  }

  // An options panel whose every control is hidden is just a stray heading.
  const wrapper = form.closest('.options__wrapper');
  if (wrapper) {
    const fields = [...form.querySelectorAll('.field')];
    wrapper.hidden = fields.length > 0 && fields.every((f) => f.hidden);
  }
}

function optionApplies(rule, formats) {
  if (!rule || !formats) return true;
  if (rule.either) return rule.either.includes(formats.from) || rule.either.includes(formats.to);
  if (rule.from) return rule.from.includes(formats.from);
  if (rule.to) return rule.to.includes(formats.to);
  return true;
}

/* ------------------------------------------------------------------ *
 * Output rendering
 * ------------------------------------------------------------------ */

export function renderTextOutput(container, text) {
  clearNode(container);
  const pre = el('pre', { className: 'output__text' });
  pre.appendChild(document.createTextNode(text));
  container.appendChild(pre);
}

export function renderDetailsOutput(container, { details, output }) {
  clearNode(container);
  if (details?.length) {
    const list = el('dl', { className: 'details' });
    for (const item of details) {
      list.appendChild(el('dt', { text: item.label }));
      const dd = el('dd');
      dd.appendChild(el('code', { className: 'details__value', text: item.value }));
      dd.appendChild(
        el('button', {
          className: 'button button--tiny',
          text: 'Copy',
          attrs: { type: 'button', 'data-copy-value': item.value },
        }),
      );
      list.appendChild(dd);
    }
    container.appendChild(list);
  } else {
    renderTextOutput(container, output);
  }
}

/** Regex matches: highlight via text nodes and <mark>, never innerHTML. */
export function renderRegexOutput(container, data) {
  clearNode(container);
  if (!data) return;

  const summary = el('p', {
    className: 'regex__summary',
    text: data.count === 0
      ? 'No matches.'
      : data.count + (data.count === 1 ? ' match' : ' matches') + (data.truncated ? ' (truncated)' : ''),
  });
  container.appendChild(summary);

  const highlight = el('pre', { className: 'regex__highlight' });
  for (const segment of data.segments ?? []) {
    if (segment.isMatch) {
      const mark = el('mark', { className: 'regex__match' });
      mark.appendChild(document.createTextNode(segment.text));
      highlight.appendChild(mark);
    } else {
      highlight.appendChild(document.createTextNode(segment.text));
    }
  }
  container.appendChild(highlight);

  if (!data.matches?.length) return;

  const table = el('table', { className: 'regex__table' });
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['#', 'Match', 'Start', 'End', 'Groups']) {
    headRow.appendChild(el('th', { text: label, attrs: { scope: 'col' } }));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  data.matches.forEach((match, index) => {
    const row = el('tr');
    row.appendChild(el('td', { text: String(index + 1) }));
    row.appendChild(el('td', { children: [el('code', { text: match.match })] }));
    row.appendChild(el('td', { text: String(match.index) }));
    row.appendChild(el('td', { text: String(match.end) }));

    const groupCell = el('td');
    if (match.groups?.length) {
      const list = el('ul', { className: 'regex__groups' });
      match.groups.forEach((group, groupIndex) => {
        const label = (group.name ? group.name : String(groupIndex + 1)) + ': ';
        const item = el('li');
        item.appendChild(document.createTextNode(label));
        item.appendChild(el('code', { text: group.value === undefined ? '(no match)' : group.value }));
        list.appendChild(item);
      });
      groupCell.appendChild(list);
    } else {
      groupCell.appendChild(document.createTextNode('—'));
    }
    row.appendChild(groupCell);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

/** Diff: side-by-side or unified, always via text nodes. */
export function renderDiffOutput(container, diff, view) {
  clearNode(container);
  if (!diff) return;

  const stats = el('p', { className: 'diff__stats' });
  stats.appendChild(el('span', { className: 'diff__stat diff__stat--add', text: '+' + diff.stats.added + ' added' }));
  stats.appendChild(el('span', { className: 'diff__stat diff__stat--remove', text: '−' + diff.stats.removed + ' removed' }));
  stats.appendChild(el('span', { className: 'diff__stat', text: diff.stats.unchanged + ' unchanged' }));
  container.appendChild(stats);

  if (view === 'unified') {
    const pre = el('pre', { className: 'diff__unified' });
    for (const line of String(diff.unified).split('\n')) {
      const marker = line[0];
      const className =
        marker === '+' && !line.startsWith('+++') ? 'diff__line diff__line--add'
          : marker === '-' && !line.startsWith('---') ? 'diff__line diff__line--remove'
            : 'diff__line';
      const row = el('span', { className });
      row.appendChild(document.createTextNode(line + '\n'));
      pre.appendChild(row);
    }
    container.appendChild(pre);
    return;
  }

  const table = el('table', { className: 'diff__table' });
  const thead = el('thead');
  const headRow = el('tr');
  headRow.appendChild(el('th', { text: '#', attrs: { scope: 'col' } }));
  headRow.appendChild(el('th', { text: 'Original', attrs: { scope: 'col' } }));
  headRow.appendChild(el('th', { text: '#', attrs: { scope: 'col' } }));
  headRow.appendChild(el('th', { text: 'Changed', attrs: { scope: 'col' } }));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const row of diff.rows) {
    const tr = el('tr', { className: 'diff__row diff__row--' + row.type });
    tr.appendChild(el('td', { className: 'diff__num', text: row.left ? String(row.left.num) : '' }));
    tr.appendChild(sideCell(row.left, row.type, 'left'));
    tr.appendChild(el('td', { className: 'diff__num', text: row.right ? String(row.right.num) : '' }));
    tr.appendChild(sideCell(row.right, row.type, 'right'));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function sideCell(side, type, which) {
  const cell = el('td', { className: 'diff__cell' });
  if (!side) {
    cell.classList.add('diff__cell--empty');
    return cell;
  }
  // A marker glyph so the state is never conveyed by colour alone.
  const changed = type === 'modify' || (which === 'left' && type === 'remove') || (which === 'right' && type === 'add');
  if (changed) {
    cell.classList.add(which === 'left' ? 'diff__cell--remove' : 'diff__cell--add');
    cell.appendChild(el('span', { className: 'diff__marker', text: which === 'left' ? '−' : '+', attrs: { 'aria-hidden': 'true' } }));
  }
  cell.appendChild(document.createTextNode(side.text));
  return cell;
}

/* ------------------------------------------------------------------ *
 * Status, notes and errors
 * ------------------------------------------------------------------ */

/**
 * Render the status line.
 *
 * Only the outcome is shown. Converters still return `notes` and `warnings` —
 * the information is not lost and the tests still assert on it — but the panel
 * deliberately does not print them: a successful conversion should read as one
 * line, not as a lecture. Errors are the exception and stay fully detailed,
 * including line, column and hint, because those you have to act on.
 */
export function renderStatus(container, { level = 'info', message, error }) {
  clearNode(container);
  container.className = 'status status--' + level;

  if (message) {
    const line = el('p', { className: 'status__message' });
    // A glyph plus a colour, so errors are distinguishable without colour.
    line.appendChild(el('span', { className: 'status__icon', text: statusGlyph(level), attrs: { 'aria-hidden': 'true' } }));
    line.appendChild(document.createTextNode(message));
    container.appendChild(line);
  }

  if (error?.line) {
    container.appendChild(
      el('p', { className: 'status__detail', text: 'At line ' + error.line + (error.column ? ', column ' + error.column : '') + '.' }),
    );
  }
  if (error?.hint) {
    container.appendChild(el('p', { className: 'status__detail', text: error.hint }));
  }
}

function statusGlyph(level) {
  if (level === 'error') return '✕ ';
  if (level === 'warning') return '⚠ ';
  if (level === 'success') return '✓ ';
  return 'ℹ ';
}

export function updateDetection(node, detection) {
  if (!node) return;
  node.textContent = formatDetection(detection);
  node.title = detection?.reason ?? '';
  node.dataset.type = detection?.type ?? '';
}

export function updateMeta(node, text, extra) {
  if (!node) return;
  const bytes = new TextEncoder().encode(text ?? '').length;
  const lines = text ? text.split('\n').length : 0;
  node.textContent = text
    ? lines + (lines === 1 ? ' line' : ' lines') + ' · ' + formatBytes(bytes) + (extra ? ' · ' + extra : '')
    : 'Empty';
}

/**
 * Offer a suggestion when detection disagrees with the current tool, without
 * ever changing the user's input or switching tools behind their back.
 */
export function renderSuggestion(container, { detection, suggestion, onAccept }) {
  if (!container) return;
  const existing = container.querySelector('.suggestion');
  if (existing) existing.remove();
  if (!suggestion) return;

  const box = el('div', { className: 'suggestion' });
  box.appendChild(
    el('span', {
      text: 'This looks like ' + (TYPE_LABELS[detection.type] ?? detection.type) + '.',
    }),
  );
  const accept = el('button', {
    className: 'button button--small',
    text: suggestion.label,
    attrs: { type: 'button' },
  });
  accept.addEventListener('click', () => onAccept(suggestion));
  box.appendChild(accept);

  const dismiss = el('button', {
    className: 'button button--tiny',
    text: 'Dismiss',
    attrs: { type: 'button', 'aria-label': 'Dismiss suggestion' },
  });
  dismiss.addEventListener('click', () => box.remove());
  box.appendChild(dismiss);

  container.appendChild(box);
}

/* ------------------------------------------------------------------ *
 * Command palette
 * ------------------------------------------------------------------ */

export function renderPaletteResults(list, tools, activeIndex) {
  clearNode(list);
  if (!tools.length) {
    list.appendChild(el('li', { className: 'palette__empty', text: 'No tools match that search.' }));
    return;
  }
  tools.forEach((tool, index) => {
    const item = el('li', {
      className: 'palette__item' + (index === activeIndex ? ' is-active' : ''),
      attrs: {
        role: 'option',
        id: 'palette-option-' + index,
        'aria-selected': index === activeIndex ? 'true' : 'false',
        'data-slug': tool.slug,
        tabindex: '-1',
      },
    });
    item.appendChild(el('span', { className: 'palette__item-label', text: tool.label }));
    item.appendChild(el('span', { className: 'palette__item-category', text: tool.category }));
    item.appendChild(el('span', { className: 'palette__item-description', text: tool.description }));
    list.appendChild(item);
  });
}

/* ------------------------------------------------------------------ *
 * History & presets
 * ------------------------------------------------------------------ */

export function renderHistory(container, entries, { onRestore, onDelete }) {
  clearNode(container);
  if (!entries.length) {
    container.appendChild(el('p', { className: 'empty', text: 'No conversions recorded yet.' }));
    return;
  }

  const list = el('ul', { className: 'history' });
  for (const entry of entries) {
    const item = el('li', { className: 'history__item' });
    const head = el('div', { className: 'history__head' });
    head.appendChild(el('strong', { text: entry.toolLabel ?? entry.toolId }));
    head.appendChild(el('time', {
      className: 'history__time',
      text: new Date(entry.at).toLocaleString(),
      attrs: { datetime: new Date(entry.at).toISOString() },
    }));
    item.appendChild(head);

    const preview = el('pre', { className: 'history__preview' });
    preview.appendChild(document.createTextNode(previewText(entry.input)));
    item.appendChild(preview);

    if (entry.input?.truncated) {
      item.appendChild(el('p', {
        className: 'history__note',
        text: 'Stored preview truncated from ' + entry.input.originalLength + ' characters.',
      }));
    }

    const actions = el('div', { className: 'history__actions' });
    const restore = el('button', { className: 'button button--small', text: 'Restore', attrs: { type: 'button' } });
    restore.addEventListener('click', () => onRestore(entry));
    const remove = el('button', { className: 'button button--tiny', text: 'Delete', attrs: { type: 'button' } });
    remove.addEventListener('click', () => onDelete(entry));
    actions.appendChild(restore);
    actions.appendChild(remove);
    item.appendChild(actions);

    list.appendChild(item);
  }
  container.appendChild(list);
}

function previewText(value) {
  if (!value) return '';
  const text = typeof value === 'string' ? value : value.text ?? '';
  return text.length > 300 ? text.slice(0, 300) + '…' : text;
}

export function renderPresets(container, presets, { onApply, onDelete, onRename, toolLabelFor }) {
  clearNode(container);
  if (!presets.length) {
    container.appendChild(el('p', { className: 'empty', text: 'No presets saved yet.' }));
    return;
  }

  const list = el('ul', { className: 'presets' });
  for (const preset of presets) {
    const item = el('li', { className: 'presets__item' });
    item.appendChild(el('strong', { text: preset.name }));
    item.appendChild(el('span', { className: 'presets__tool', text: toolLabelFor(preset.toolId) }));

    const summary = Object.entries(preset.options ?? {})
      .map(([key, value]) => key + ': ' + (Array.isArray(value) ? value.join(', ') : String(value)))
      .join(' · ');
    if (summary) item.appendChild(el('span', { className: 'presets__summary', text: summary }));

    const actions = el('div', { className: 'presets__actions' });
    const apply = el('button', { className: 'button button--small', text: 'Apply', attrs: { type: 'button' } });
    apply.addEventListener('click', () => onApply(preset));
    const rename = el('button', { className: 'button button--tiny', text: 'Rename', attrs: { type: 'button' } });
    rename.addEventListener('click', () => onRename(preset));
    const remove = el('button', { className: 'button button--tiny', text: 'Delete', attrs: { type: 'button' } });
    remove.addEventListener('click', () => onDelete(preset));
    actions.appendChild(apply);
    actions.appendChild(rename);
    actions.appendChild(remove);
    item.appendChild(actions);

    list.appendChild(item);
  }
  container.appendChild(list);
}

export function renderSettings(container, settings, { onChange, footprint, persistent }) {
  clearNode(container);

  const items = [
    { id: 'historyEnabled', label: 'Record conversion history', help: 'When off, nothing is written to history and existing entries are left untouched.' },
    { id: 'autoRun', label: 'Convert automatically as I type', help: 'Off means conversions run only when you press Convert or Ctrl + Enter.' },
    { id: 'wrapOutput', label: 'Wrap long output lines' },
  ];

  const list = el('div', { className: 'settings' });
  for (const item of items) {
    const id = 'setting-' + item.id;
    const input = el('input', { attrs: { type: 'checkbox', id, checked: Boolean(settings[item.id]) } });
    input.addEventListener('change', () => onChange({ [item.id]: input.checked }));
    const row = el('div', { className: 'settings__row' });
    row.appendChild(el('label', { attrs: { for: id }, children: [input, document.createTextNode(' ' + item.label)] }));
    if (item.help) row.appendChild(el('span', { className: 'field__help', text: item.help }));
    list.appendChild(row);
  }

  const themeRow = el('div', { className: 'settings__row' });
  themeRow.appendChild(el('label', { text: 'Theme', attrs: { for: 'setting-theme' } }));
  const select = el('select', { attrs: { id: 'setting-theme' } });
  for (const [value, label] of [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']]) {
    const optionEl = el('option', { text: label, attrs: { value } });
    if (settings.theme === value) optionEl.selected = true;
    select.appendChild(optionEl);
  }
  select.addEventListener('change', () => onChange({ theme: select.value }));
  themeRow.appendChild(select);
  list.appendChild(themeRow);

  container.appendChild(list);

  container.appendChild(
    el('p', {
      className: 'settings__footprint',
      text: persistent
        ? 'Local data currently stored: ' + formatBytes(footprint) + '. Nothing is sent anywhere.'
        : 'This browser is blocking localStorage, so history and presets last only for this session.',
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Toast
 * ------------------------------------------------------------------ */

let toastTimer;

export function showToast(node, message) {
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  node.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.remove('is-visible');
    // Keep it in the a11y tree briefly so screen readers can finish reading.
    setTimeout(() => { node.hidden = true; }, 300);
  }, 2600);
}

/* ------------------------------------------------------------------ *
 * Modal focus management
 * ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function openDialog(dialog, { focus } = {}) {
  dialog.dataset.returnFocus = '';
  dialog._returnFocus = document.activeElement;
  dialog.hidden = false;
  document.body.classList.add('has-dialog');

  const target = focus ?? dialog.querySelector(FOCUSABLE);
  target?.focus();

  dialog._trap = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener('keydown', dialog._trap);
}

export function closeDialog(dialog) {
  if (dialog.hidden) return;
  dialog.hidden = true;
  document.body.classList.remove('has-dialog');
  if (dialog._trap) dialog.removeEventListener('keydown', dialog._trap);
  dialog._returnFocus?.focus?.();
}
