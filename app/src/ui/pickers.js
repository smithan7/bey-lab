// Combo picker and builder. recentCombos is a pure view-model (Node-testable);
// everything else builds DOM with textContent only (part names can be user-entered).
import { comboId, comboLabel, validateCombo } from '../combo.js';
import { searchParts } from '../catalog.js';

export function recentCombos(state, limit = 8) {
  const known = new Set((state.combos ?? []).map((c) => c.id));
  const order = (state.battles ?? []).map((b, i) => [b, i])
    .sort((a, b) => (b[0].ts ?? 0) - (a[0].ts ?? 0) || b[1] - a[1]);
  const out = [];
  const seen = new Set();
  const add = (id) => {
    if (known.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  };
  for (const [b] of order) { add(b.left); add(b.right); }
  // Combos that never battled (e.g. just built) go after, newest first.
  for (const c of [...(state.combos ?? [])].reverse()) add(c.id);
  return out.slice(0, limit);
}

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

// A full-screen sheet; resolves via sheet.done(value).
export function openSheet(title) {
  const overlay = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
  const heading = h('h2', {});
  heading.textContent = title;
  const head = h('div', { class: 'sheet-head' });
  const body = h('div', { class: 'sheet-body' });
  overlay.append(head, body);
  document.getElementById('dialog-host').append(overlay);
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return {
    head, body, heading, promise,
    setTitle: (t) => { heading.textContent = t; },
    done(v) { overlay.remove(); resolve(v); },
  };
}

export function searchBox(onInput, placeholder) {
  const input = h('input', { type: 'search', placeholder, autocomplete: 'off', autocapitalize: 'off', class: 'search' });
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

export function listButton(text, onClick, extra = '') {
  const b = h('button', { type: 'button', class: 'list-btn' });
  b.textContent = text;
  if (extra) b.append(h('span', { class: 'muted' }, ` ${extra}`));
  b.addEventListener('click', onClick);
  return b;
}

export function openComboPicker(ctx) {
  const sheet = openSheet('Pick a combo');
  const cancel = h('button', { type: 'button' }); cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => sheet.done(null));
  const newBtn = h('button', { type: 'button', class: 'primary' }); newBtn.textContent = 'New combo';
  newBtn.addEventListener('click', async () => {
    const id = await openComboBuilder(ctx);
    if (id) sheet.done(id);
  });
  sheet.head.append(cancel, sheet.heading, newBtn);

  const list = h('div', {});
  const labelOf = (c) => comboLabel(c, ctx.partsById);
  function fill(q) {
    const s = ctx.store.state();
    const byId = new Map(s.combos.map((c) => [c.id, c]));
    list.replaceChildren();
    const needle = q.trim().toLowerCase();
    let ids;
    let heading;
    if (needle) {
      ids = s.combos.filter((c) => labelOf(c).toLowerCase().includes(needle)).map((c) => c.id);
      heading = ids.length ? 'Matches' : 'No combos match. Use New combo to build it.';
    } else {
      ids = recentCombos(s, 8);
      heading = ids.length ? 'Recent' : 'No combos yet. Use New combo.';
    }
    list.append(h('p', { class: 'muted' }, heading));
    for (const id of ids) list.append(listButton(labelOf(byId.get(id)), () => sheet.done(id)));
    if (!needle && s.combos.length > ids.length) list.append(h('p', { class: 'muted' }, 'Type above to search all combos.'));
  }
  sheet.body.append(searchBox(fill, 'Search combos'), list);
  fill('');
  return sheet.promise;
}

const KIND_TITLE = {
  blade: 'Blade', lock_chip: 'Lock chip', main_blade: 'Main blade', over_blade: 'Over blade',
  metal_blade: 'Metal blade', assist_blade: 'Assist blade', bit: 'Bit', ratchet: 'Ratchet',
};

const BLADE_KEYS = ['mode', 'bladeId', 'lockChip', 'body', 'mainBlade', 'overBlade', 'metalBlade', 'assistBlade'];

function selFromCombo(c) {
  const b = c.blade;
  const sel = b.type === 'cx'
    ? { mode: 'cx', lockChip: b.lockChip, assistBlade: b.assistBlade, body: b.mainBlade ? 'main' : 'over',
        ...(b.mainBlade ? { mainBlade: b.mainBlade } : { overBlade: b.overBlade, metalBlade: b.metalBlade }) }
    : { mode: 'single', bladeId: b.bladeId };
  sel.bit = c.bit;
  if (c.ratchet != null) { sel.ratchet = c.ratchet; sel.ratchetChosen = true; }
  return sel;
}

// opts.initial: an existing combo to start from (opens on the summary).
// opts.onSave(combo): called instead of saving a new combo; may throw to show an error.
// opts.title / opts.saveLabel: header and button text for the summary.
export function openComboBuilder(ctx, opts = {}) {
  const sheet = openSheet(opts.title ?? 'New combo');
  const parts = ctx.parts.filter((p) => !p.hidden);
  let sel = opts.initial ? selFromCombo(opts.initial) : {};
  const history = []; // snapshots of sel before each change
  const set = (obj) => { history.push({ ...sel }); Object.assign(sel, obj); };
  const clear = (keys) => { history.push({ ...sel }); for (const k of keys) delete sel[k]; };
  const back = () => { sel = history.pop() ?? sel; };
  const byId = ctx.partsById;

  function nextStep() {
    if (!sel.mode) return { kind: 'blade' };
    if (sel.mode === 'cx') {
      if (!sel.lockChip) return { kind: 'lock_chip' };
      if (!sel.body) return { kind: 'main_blade', altBody: true };
      if (sel.body === 'main' && !sel.mainBlade) return { kind: 'main_blade', altBody: true };
      if (sel.body === 'over') {
        if (!sel.overBlade) return { kind: 'over_blade' };
        if (!sel.metalBlade) return { kind: 'metal_blade' };
      }
      if (!sel.assistBlade) return { kind: 'assist_blade' };
    } else if (!sel.bladeId) return { kind: 'blade' };
    if (!sel.bit) return { kind: 'bit' };
    const builtIn = sel.mode === 'single' && byId.get(sel.bladeId)?.builtInRatchet;
    if (!builtIn && !byId.get(sel.bit)?.ratchetIntegrated && !('ratchetChosen' in sel)) return { kind: 'ratchet' };
    return null;
  }

  function assemble() {
    const blade = sel.mode === 'cx'
      ? { type: 'cx', lockChip: sel.lockChip, mainBlade: sel.body === 'main' ? sel.mainBlade : null,
          overBlade: sel.body === 'over' ? sel.overBlade : null, metalBlade: sel.body === 'over' ? sel.metalBlade : null,
          assistBlade: sel.assistBlade }
      : { type: 'single', bladeId: sel.bladeId };
    const noRatchet = (sel.mode === 'single' && byId.get(sel.bladeId)?.builtInRatchet) || byId.get(sel.bit)?.ratchetIntegrated;
    return { blade, ratchet: noRatchet ? null : (sel.ratchet ?? null), bit: sel.bit };
  }

  async function save() {
    const combo = assemble();
    const err = validateCombo(combo, byId);
    if (err) { showError(err); return; }
    const full = { id: comboId(combo), ...combo };
    try {
      if (opts.onSave) await opts.onSave(full);
      else await ctx.store.upsertCombo(full);
    } catch (e) { showError(e.message); return; }
    sheet.done(full.id);
  }

  let errorText = '';
  const showError = (t) => { errorText = t; render(); };

  function render() {
    const step = nextStep();
    sheet.head.replaceChildren();
    const left = h('button', { type: 'button' });
    left.textContent = history.length ? 'Back' : 'Cancel';
    left.addEventListener('click', () => {
      errorText = '';
      if (history.length) { back(); render(); } else sheet.done(null);
    });
    sheet.head.append(left, sheet.heading);
    if (history.length) {
      const cancel = h('button', { type: 'button' }, 'Cancel');
      cancel.addEventListener('click', () => sheet.done(null));
      sheet.head.append(cancel);
    }
    sheet.body.replaceChildren();
    if (errorText) sheet.body.append(h('p', { class: 'error', role: 'alert' }, errorText));
    if (!step) { summary(); return; }
    sheet.setTitle(`${KIND_TITLE[step.kind]}${step.kind === 'main_blade' && sel.mode === 'cx' ? ' (CX)' : ''}`);
    const list = h('div', {});
    const extras = h('div', {});
    if (step.kind === 'blade') {
      const cx = h('button', { type: 'button', class: 'list-btn' }); cx.textContent = 'Build CX (lock chip + blade + assist blade)';
      cx.addEventListener('click', () => { errorText = ''; set({ mode: 'cx' }); render(); });
      extras.append(cx);
    }
    if (step.altBody) {
      const alt = h('button', { type: 'button', class: 'list-btn' }); alt.textContent = 'Use an over blade + metal blade instead';
      alt.addEventListener('click', () => { errorText = ''; set({ body: 'over' }); render(); });
      extras.append(alt);
    }
    function fill(q) {
      list.replaceChildren();
      const hits = searchParts(parts, q, step.kind);
      const owned = hits.filter((p) => p.owned), rest = hits.filter((p) => !p.owned);
      const LIMIT = 80;
      let shown = 0;
      for (const [title, group] of [['Owned', owned], ['Not owned', rest]]) {
        if (!group.length) continue;
        list.append(h('p', { class: 'muted' }, title));
        for (const p of group) {
          if (shown++ >= LIMIT) break;
          list.append(listButton(p.displayName || p.name, () => choose(p), p.line ?? ''));
        }
      }
      if (!hits.length) list.append(h('p', { class: 'muted' }, 'Nothing matches.'));
      else if (shown >= LIMIT) list.append(h('p', { class: 'muted' }, 'Keep typing to narrow the list.'));
    }
    function choose(p) {
      errorText = '';
      switch (step.kind) {
        case 'blade':
          if (p.cxPreset) set({ mode: 'cx', ...presetKeys(p.cxPreset) });
          else set({ mode: 'single', bladeId: p.id });
          break;
        case 'lock_chip': set({ lockChip: p.id }); break;
        case 'main_blade': set({ body: 'main', mainBlade: p.id }); break;
        case 'over_blade': set({ overBlade: p.id }); break;
        case 'metal_blade': set({ metalBlade: p.id }); break;
        case 'assist_blade': set({ assistBlade: p.id }); break;
        case 'bit': set({ bit: p.id }); break;
        case 'ratchet': set({ ratchet: p.id, ratchetChosen: true }); break;
        default: break;
      }
      render();
    }
    sheet.body.append(searchBox(fill, `Search ${KIND_TITLE[step.kind].toLowerCase()}s`), extras, list);
    fill('');
  }

  function summary() {
    sheet.setTitle(opts.title ?? 'Save this combo?');
    const combo = assemble();
    const p = h('p', { class: 'combo-name' });
    p.textContent = comboLabel(combo, byId);
    const name = (id) => byId.get(id)?.displayName ?? id;
    const rows = h('div', { class: 'combo-parts' });
    const row = (label, value, keys) => {
      const ch = h('button', { type: 'button' }, 'Change');
      ch.addEventListener('click', () => { errorText = ''; clear(keys); render(); });
      rows.append(h('div', { class: 'combo-part' }, h('span', { class: 'muted' }, label), h('strong', {}, value), ch));
    };
    if (sel.mode === 'cx') {
      const body = sel.body === 'main' ? name(sel.mainBlade) : `${name(sel.overBlade)} + ${name(sel.metalBlade)}`;
      row('Blade (CX)', `${name(sel.lockChip)} · ${body} · ${name(sel.assistBlade)}`, BLADE_KEYS);
    } else {
      row('Blade', name(sel.bladeId), BLADE_KEYS);
    }
    if (combo.ratchet) row('Ratchet', name(combo.ratchet), ['ratchet', 'ratchetChosen']);
    row('Bit', name(sel.bit), ['bit']);
    const ok = h('button', { type: 'button', class: 'primary' }); ok.textContent = opts.saveLabel ?? 'Save combo';
    ok.addEventListener('click', save);
    sheet.body.append(p, rows, ok);
  }

  render();
  return sheet.promise;
}

function presetKeys(c) {
  const main = !!c.mainBlade;
  return {
    lockChip: c.lockChip, assistBlade: c.assistBlade, body: main ? 'main' : 'over',
    ...(main ? { mainBlade: c.mainBlade } : { overBlade: c.overBlade, metalBlade: c.metalBlade }),
  };
}
