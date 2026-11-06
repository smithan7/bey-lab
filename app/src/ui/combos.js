// Combos tab: one report card per combo (ordered by EV vs the active field) plus field toggles.
// DOM is built with textContent only (part names can be user-entered).
import { comboLabel, comboParts } from '../combo.js';
import { comboLeaderboard, fieldCombos } from '../lineup.js';
import { matchupStats } from '../stats.js';
import { pairingScores, finishBreakdown, comboFlags } from '../matchups.js';
import { makeRng } from '../rng.js';
import { h } from './pickers.js';
import { toast } from './log.js';

const ROW_SIMS = { draws: 4000, raceSims: 4000 };
const TOP_CLASH = 5;
const FLAG_TEXT = { 'burst-risk': 'Burst risk', 'ko-risk': 'KO risk', 'low-data': 'Low data' };
const FINISH_NAMES = [['xtreme', 'Xtreme'], ['pocket', 'Pocket'], ['burst', 'Burst'], ['spin', 'Spin'], ['unknown', 'Unknown type']];

export const fmtEv = (v) => `${Math.round(Math.abs(v) * 100) === 0 || v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
export const fmtPct = (v) => `${Math.round(v * 100)}%`;

// Fixed-seed stats cached by (combo, opponent, score content), so re-renders are cheap and stable.
const cache = new Map();
function cachedStats(key, scores) {
  const k = `${key}#${scores.join(',')}`;
  if (!cache.has(k)) {
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(k, matchupStats(scores, { rng: makeRng(20260611), ...ROW_SIMS }));
  }
  return cache.get(k);
}

const partName = (p, id) => (p ? (p.displayName || p.name) : id);

function finishText(label, counts) {
  const bits = FINISH_NAMES.filter(([k]) => counts[k] > 0).map(([k, name]) => `${counts[k]}× ${name}`);
  return `${label}: ${bits.length ? bits.join(', ') : 'none'}`;
}

function statCells(tr, st) {
  const td = (t) => tr.append(h('td', {}, t));
  td(String(st.n));
  td(`${st.wins}-${st.draws}-${st.losses}`);
  td(`${fmtEv(st.ev)} [${st.n >= 2 ? `${fmtEv(st.evCI[0])}, ${fmtEv(st.evCI[1])}` : 'n/a'}]`);
  td(fmtPct(st.race[5]));
  td(fmtPct(st.race[7]));
  td(fmtPct(st.pEvNeg));
}

function buildCard(ctx, state, c, fieldIds, topIds) {
  const { partsById } = ctx;
  const battles = state.battles;
  const entry = state.field.find((f) => f.comboId === c.id);
  const card = h('article', { class: 'report', 'data-combo': c.id });

  const thumbs = h('div', { class: 'thumbs' });
  for (const pid of comboParts(c)) {
    const url = partsById.get(pid)?.imageUrl;
    if (url) thumbs.append(h('img', { src: url, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy', class: 'thumb' }));
  }
  card.append(h('header', {}, thumbs, h('h3', {}, comboLabel(c, partsById))));

  const opps = fieldIds.filter((f) => f !== c.id);
  const table = h('table', { class: 'rtable' });
  table.append(h('thead', {}, h('tr', {}, ...['Opponent', 'n', 'W-D-L', 'EV [95%]', 'Race to 5', 'Race to 7', 'P(EV<0)'].map((t) => h('th', {}, t)))));
  const body = h('tbody');
  for (const o of opps) {
    const scores = pairingScores(battles, c.id, o);
    const tr = h('tr', {}, h('th', { scope: 'row' }, comboLabel(state.combos.find((x) => x.id === o), partsById)));
    if (!scores.length) tr.append(h('td', { colspan: '6', class: 'muted' }, 'unknown — not tested'));
    else statCells(tr, cachedStats(`${c.id}|${o}`, scores));
    body.append(tr);
  }
  let all = [];
  for (const o of opps) all = all.concat(pairingScores(battles, c.id, o));
  const total = h('tr', { class: 'overall' }, h('th', { scope: 'row' }, 'Overall vs field'));
  if (!all.length) total.append(h('td', { colspan: '6', class: 'muted' }, 'unknown — not tested'));
  else statCells(total, cachedStats(`${c.id}|*${opps.join(',')}`, all));
  body.append(total);
  table.append(body);
  card.append(h('div', { class: 'tscroll' }, table));
  if (!opps.length) card.append(h('p', { class: 'muted' }, 'No other combos are in the field.'));

  // Finish chips and flags from battles against the active field.
  const fieldSet = new Set(opps);
  const vsField = battles.filter((b) => (b.left === c.id && fieldSet.has(b.right)) || (b.right === c.id && fieldSet.has(b.left)));
  const br = finishBreakdown(vsField, c.id);
  const chips = h('div', { class: 'chips' });
  chips.append(h('span', { class: 'chip win' }, finishText('Wins', br.won)), h('span', { class: 'chip loss' }, finishText('Losses', br.lost)));
  for (const f of comboFlags(br)) chips.append(h('span', { class: `chip flag ${f}` }, FLAG_TEXT[f]));

  // Clashes with field combos and the top leaderboard combos.
  const mine = new Set(comboParts(c));
  const others = new Set([...fieldIds, ...topIds]);
  others.delete(c.id);
  for (const oid of others) {
    const o = state.combos.find((x) => x.id === oid);
    if (!o) continue;
    const shared = comboParts(o).filter((pid) => mine.has(pid)).map((pid) => partName(partsById.get(pid), pid));
    if (shared.length) chips.append(h('span', { class: 'chip clash' }, `Shares ${shared.join(', ')} with ${comboLabel(o, partsById)}`));
  }
  card.append(chips);

  // Field toggles.
  const toggles = h('div', { class: 'toggles' });
  const sw = (label, key) => {
    const on = !!entry?.[key];
    const b = h('button', { type: 'button', class: `switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': String(on) });
    b.append(h('span', { class: 'knob' }), h('span', {}, label));
    b.addEventListener('click', async () => {
      if (b.disabled) return;
      b.disabled = true;
      const cur = ctx.store.state().field.find((f) => f.comboId === c.id) ?? { comboId: c.id, active: false, core: false };
      const next = { ...cur, [key]: !on };
      let note = '';
      if (key === 'core' && next.core && !next.active) { next.active = true; note = ' (also in field)'; }
      if (key === 'active' && !next.active && next.core) { next.core = false; note = ' (no longer core)'; }
      try {
        await ctx.store.setFieldEntry(next);
      } catch (e) { b.disabled = false; toast(`Not saved: ${e.message}`); return; }
      toast(`${comboLabel(c, partsById)}: ${key === 'active' ? (next.active ? 'in field' : 'out of field') : (next.core ? 'core' : 'not core')}${note}`);
      const view = document.getElementById('view');
      const top = view?.scrollTop ?? 0;
      try { await ctx.refresh(); } catch (e) { toast(`Saved, but the view failed to refresh: ${e.message}`); return; }
      if (view) view.scrollTop = top;
    });
    return b;
  };
  toggles.append(sw('In field', 'active'), sw('Core', 'core'));
  card.append(toggles);
  return card;
}

export const tab = {
  id: 'combos',
  label: 'Combos',
  render(ctx, el) {
    const state = ctx.store.state();
    const fieldIds = fieldCombos(state);
    const lb = comboLeaderboard(state, { rng: makeRng(7), draws: 500, raceSims: 0 });
    const ranked = lb.map((r) => r.comboId);
    const topIds = ranked.slice(0, TOP_CLASH);
    const played = new Set();
    for (const b of state.battles) { played.add(b.left); played.add(b.right); }
    const byId = new Map(state.combos.map((c) => [c.id, c]));
    const ordered = [...ranked, ...state.combos.filter((c) => played.has(c.id) && !ranked.includes(c.id)).map((c) => c.id)];
    const untested = state.combos.filter((c) => !played.has(c.id));

    if (!state.combos.length) { el.append(h('p', { class: 'muted' }, 'No combos yet. Build one from the Log tab.')); return; }
    el.append(h('p', { class: 'muted' }, `Ordered by average EV against the active field (${fieldIds.length} in field). Intervals are 95%.`));
    for (const id of ordered) el.append(buildCard(ctx, state, byId.get(id), fieldIds, topIds));
    if (untested.length) {
      const d = h('details', { class: 'untested' }, h('summary', {}, `Untested combos (${untested.length})`));
      for (const c of untested) d.append(buildCard(ctx, state, c, fieldIds, topIds));
      el.append(d);
    }
  },
};
