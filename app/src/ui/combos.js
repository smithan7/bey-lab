// Combos tab: one report card per combo, ordered by EV rating, with its results against every opponent faced.
// DOM is built with textContent only (part names can be user-entered).
import { blockingParts, comboLabel, comboParts, partRefName } from '../combo.js';
import { ratingsLeaderboard } from '../ratings.js';
import { variantsFor } from '../ideas.js';
import { matchupStats } from '../stats.js';
import { pairingScores, finishBreakdown, comboFlags } from '../matchups.js';
import { makeRng } from '../rng.js';
import { battleScore } from '../scoring.js';
import { h, comboThumbs, openComboBuilder, openSheet } from './pickers.js';
import { toast } from './log.js';

const ROW_SIMS = { draws: 4000, raceSims: 4000 };
const TOP_CLASH = 5;
const FLAG_TEXT = { 'burst-risk': 'Burst risk', 'ko-risk': 'KO risk', 'low-data': 'Low data' };
const FINISH_NAMES = [['xtreme', 'Xtreme'], ['pocket', 'Pocket'], ['burst', 'Burst'], ['spin', 'Spin'], ['unknown', 'Unknown type']];

export const fmtEv = (v) => `${Math.round(Math.abs(v) * 100) === 0 || v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
export const fmtPct = (v) => `${Math.round(v * 100)}%`;
// Race to N with its 95% posterior interval; null (n < 2 or no decisive battles) is unknown.
export const fmtRace = (r) => (r ? `${fmtPct(r.p)} [${fmtPct(r.lo)}–${fmtPct(r.hi)}]` : 'unknown');

// Fixed-seed stats cached by (combo, opponent, score content), so re-renders are cheap and stable.
const cache = new Map();

// Session memory: cards whose matchup table is open.
const openCards = new Set();

// Session memory: the combo just built here, so the "test it" panel survives re-renders.
let justBuilt = null;
function cachedStats(key, scores) {
  const k = `${key}#${scores.join(',')}`;
  if (!cache.has(k)) {
    if (cache.size >= 5000) cache.delete(cache.keys().next().value);
    cache.set(k, matchupStats(scores, { rng: makeRng(20260611), ...ROW_SIMS }));
  }
  return cache.get(k);
}

function finishText(label, counts) {
  const bits = FINISH_NAMES.filter(([k]) => counts[k] > 0).map(([k, name]) => `${counts[k]}× ${name}`);
  return `${label}: ${bits.length ? bits.join(', ') : 'none'}`;
}

function statCells(tr, st) {
  const td = (t) => tr.append(h('td', {}, t));
  td(String(st.n));
  td(`${st.wins}-${st.draws}-${st.losses}`);
  td(`${fmtEv(st.ev)} [${st.n >= 2 ? `${fmtEv(st.evCI[0])}, ${fmtEv(st.evCI[1])}` : 'n/a'}]`);
  td(fmtRace(st.race[5]));
  td(fmtRace(st.race[7]));
  td(fmtPct(st.pEvNeg));
}

const pctCI = (p, ci) => `${fmtPct(p)} [${fmtPct(ci[0])}–${fmtPct(ci[1])}]`;

// Tap-to-expand detail for one pairing: P(win)/P(lose) with Wilson 95% intervals,
// conditional points, and that pairing's own finish chips.
function detailRow(st, br, title) {
  const tr = h('tr', { class: 'detail', hidden: '' });
  const box = h('div', { class: 'detail-box' });
  box.append(h('p', { class: 'detail-title' }, title));
  const dl = h('dl', { class: 'kv' });
  const kv = (k, v) => dl.append(h('dt', {}, k), h('dd', {}, v));
  kv('P(win) [95%]', pctCI(st.pWin, st.pWinCI));
  kv('P(lose) [95%]', pctCI(st.pLose, st.pLoseCI));
  kv('E[points | win]', st.wins ? fmtEv(st.eWin) : 'n/a — no wins');
  kv('E[points | loss]', st.losses ? fmtEv(-st.eLoss) : 'n/a — no losses');
  box.append(dl);
  box.append(h('div', { class: 'chips' },
    h('span', { class: 'chip win' }, finishText('Wins', br.won)),
    h('span', { class: 'chip loss' }, finishText('Losses', br.lost)),
    ...(br.draws ? [h('span', { class: 'chip' }, `${br.draws}× Draw`)] : [])));
  tr.append(h('td', { colspan: '7' }, box));
  return tr;
}

function buildCard(ctx, state, c, ratingById, topIds) {
  const { partsById } = ctx;
  const battles = state.battles;
  const card = h('article', { class: 'report', 'data-combo': c.id });

  card.append(h('header', {}, comboThumbs(c, partsById), h('h3', {}, comboLabel(c, partsById))));
  const rr = ratingById.get(c.id);
  if (rr) card.append(h('p', {}, h('strong', {}, `Rating ${fmtEv(rr.r)}`), ` [${fmtEv(rr.lo)}, ${fmtEv(rr.hi)}] · ${rr.n} battles vs ${rr.opponents} combos`));

  // Every combo it has faced, strongest first.
  const faced = new Set();
  for (const b of battles) {
    if (b.left === c.id && b.right !== c.id) faced.add(b.right);
    else if (b.right === c.id && b.left !== c.id) faced.add(b.left);
  }
  for (const id of faced) if (!state.combos.some((x) => x.id === id)) faced.delete(id);
  const rOf = (id) => ratingById.get(id)?.r ?? -Infinity;
  const opps = [...faced].sort((a, b) => rOf(b) - rOf(a));
  // The matchup table runs full stats per opponent, so it is built only when opened
  // (and kept open across re-renders this session).
  const buildTable = () => {
    const table = h('table', { class: 'rtable' });
    table.append(h('thead', {}, h('tr', {}, ...['Opponent', 'n', 'W-D-L', 'EV [95%]', 'Race to 5', 'Race to 7', 'P(EV<0)'].map((t) => h('th', {}, t)))));
    const body = h('tbody');
    for (const o of opps) {
      const scores = pairingScores(battles, c.id, o);
      const oppLabel = comboLabel(state.combos.find((x) => x.id === o), partsById);
      if (!scores.length) {
        const tr = h('tr', {}, h('th', { scope: 'row' }, oppLabel));
        tr.append(h('td', { colspan: '6', class: 'muted' }, 'unknown — not tested'));
        body.append(tr);
        continue;
      }
      const st = cachedStats(`${c.id}|${o}`, scores);
      const btn = h('button', { type: 'button', class: 'rowtoggle', 'aria-expanded': 'false' }, h('span', { class: 'caret', 'aria-hidden': 'true' }, '▸'), h('span', {}, oppLabel));
      const tr = h('tr', { class: 'expandable' }, h('th', { scope: 'row' }, btn));
      statCells(tr, st);
      const detail = detailRow(st, finishBreakdown(battles, c.id, o), `${comboLabel(c, partsById)} vs ${oppLabel}`);
      btn.addEventListener('click', () => {
        const open = detail.hidden;
        detail.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        btn.firstChild.textContent = open ? '▾' : '▸';
      });
      body.append(tr, detail);
    }
    let all = [];
    for (const o of opps) all = all.concat(pairingScores(battles, c.id, o));
    const total = h('tr', { class: 'overall' }, h('th', { scope: 'row' }, 'Overall vs everyone faced'));
    if (!all.length) total.append(h('td', { colspan: '6', class: 'muted' }, 'unknown — not tested'));
    else statCells(total, cachedStats(`${c.id}|*${opps.join(',')}`, all));
    body.append(total);
    table.append(body);
    return h('div', { class: 'tscroll' }, table);
  };
  if (opps.length) {
    const d = h('details', { class: 'matchups' }, h('summary', {}, `Matchups vs ${opps.length} combo${opps.length === 1 ? '' : 's'}`));
    let built = false;
    const fill = () => { if (!built) { built = true; d.append(buildTable()); } };
    d.addEventListener('toggle', () => { if (d.open) { openCards.add(c.id); fill(); } else openCards.delete(c.id); });
    if (openCards.has(c.id)) { d.open = true; fill(); }
    card.append(d);
  }
  if (!opps.length) card.append(h('p', { class: 'muted' }, 'Not tested yet.'));

  // Finish chips and flags from all its battles.
  const br = finishBreakdown(battles.filter((b) => b.left !== b.right), c.id);
  const chips = h('div', { class: 'chips' });
  chips.append(h('span', { class: 'chip win' }, finishText('Wins', br.won)), h('span', { class: 'chip loss' }, finishText('Losses', br.lost)));
  for (const f of comboFlags(br)) chips.append(h('span', { class: `chip flag ${f}` }, FLAG_TEXT[f]));

  // Clashes with the top-rated combos.
  const mine = new Set(comboParts(c));
  const others = new Set(topIds);
  others.delete(c.id);
  for (const oid of others) {
    const o = state.combos.find((x) => x.id === oid);
    if (!o) continue;
    const shared = comboParts(o).filter((pid) => mine.has(pid)).map((pid) => partRefName(partsById, pid));
    if (shared.length) chips.append(h('span', { class: 'chip clash' }, `Shares ${shared.join(', ')} with ${comboLabel(o, partsById)}`));
  }
  card.append(chips);

  const toggles = h('div', { class: 'toggles' });
  const edit = h('button', { type: 'button', class: 'edit-combo' }, 'Edit');
  edit.addEventListener('click', () => openEditCombo(ctx, c));
  toggles.append(edit);
  card.append(toggles);
  return card;
}

// Edit menu for one combo: fix its parts (battles follow), make a variant (new combo), or delete if untested.
function openEditCombo(ctx, c) {
  const label = comboLabel(c, ctx.partsById);
  const n = ctx.store.state().battles.filter((b) => b.left === c.id || b.right === c.id).length;
  const sheet = openSheet(`Edit ${label}`);
  const cancel = h('button', { type: 'button' }, 'Cancel');
  cancel.addEventListener('click', () => sheet.done(null));
  sheet.head.append(cancel, sheet.heading);
  const choice = (title, desc, value, cls = '') => {
    const b = h('button', { type: 'button', class: `list-btn choice ${cls}`.trim() }, h('strong', {}, title), h('span', { class: 'muted' }, desc));
    b.addEventListener('click', () => sheet.done(value));
    return b;
  };
  const battles = n === 1 ? '1 battle' : `${n} battles`;
  sheet.body.append(
    choice('Fix parts', n ? `It was logged with a wrong part. Its ${battles} move to the corrected combo.` : 'Change its parts.', 'fix'),
    choice('Make a variant', 'Start a new combo from this one (e.g. a different ratchet). This one and its battles stay as they are.', 'variant'),
    choice('Suggest 3 variants', 'Three versions with other ratchets or bits you own, picked from WBO results and packaging stats.', 'suggest'));
  if (!n) sheet.body.append(choice('Delete combo', 'Remove it. It has no battles, so no test data is lost.', 'delete', 'danger'));
  else sheet.body.append(h('p', { class: 'muted' }, `Combos with battles can’t be deleted, so test data is never lost. Low-rated combos simply stop being suggested for testing.`));

  return sheet.promise.then(async (what) => {
    if (what === 'fix') {
      let merged = false;
      const id = await openComboBuilder(ctx, {
        initial: c, title: 'Fix parts', saveLabel: n ? `Save fix (moves ${battles})` : 'Save',
        onSave: async (full) => {
          merged = full.id !== c.id && ctx.store.state().combos.some((x) => x.id === full.id);
          await ctx.store.replaceCombo(c.id, full);
        },
      });
      if (!id) return;
      await ctx.refresh();
      const now = comboLabel(ctx.store.state().combos.find((x) => x.id === id), ctx.partsById);
      toast(id === c.id ? 'No change' : merged ? `Merged into existing ${now}` : `Fixed: ${now}`);
    } else if (what === 'variant') {
      const id = await openComboBuilder(ctx, {
        initial: c, title: 'Make a variant', saveLabel: 'Save variant',
        onSave: async (full) => {
          if (full.id === c.id) throw new Error('Change at least one part to make a variant.');
          await ctx.store.upsertCombo(full);
        },
      });
      if (!id) return;
      justBuilt = id;
      await ctx.refresh();
      document.getElementById('view')?.scrollTo?.(0, 0);
    } else if (what === 'suggest') {
      await openVariantIdeas(ctx, c);
    } else if (what === 'delete') {
      try { await ctx.store.deleteCombo(c.id); } catch (e) { toast(e.message); return; }
      if (justBuilt === c.id) justBuilt = null;
      toast(`Deleted ${label}`);
      await ctx.refresh();
    }
  });
}

// Three suggested variants of a combo; "Try it" saves one and opens the Battle tab against the strongest
// combo it can be built alongside.
function openVariantIdeas(ctx, c) {
  const state = ctx.store.state();
  const sheet = openSheet(`Variants of ${comboLabel(c, ctx.partsById)}`);
  const close = h('button', { type: 'button' }, 'Close');
  close.addEventListener('click', () => sheet.done(null));
  sheet.head.append(close, sheet.heading);
  const list = variantsFor(c, state, ctx.parts, { reference: ctx.reference });
  if (!list.length) sheet.body.append(h('p', { class: 'muted' }, 'No new variants: every ratchet and bit you own has been tried with this blade, or none fit.'));
  const ranked = ratingsLeaderboard(state).map((r) => r.comboId);
  for (const v of list) {
    const card = h('article', { class: 'report' });
    card.append(h('header', {}, comboThumbs(v.combo, ctx.partsById), h('h3', {}, comboLabel(v.combo, ctx.partsById))), h('p', {}, v.reason));
    const go = h('button', { type: 'button', class: 'primary' }, 'Try it');
    go.addEventListener('click', async () => {
      if (go.disabled) return;
      go.disabled = true;
      try {
        if (!ctx.store.state().combos.some((x) => x.id === v.combo.id)) await ctx.store.upsertCombo(v.combo);
        const opp = ranked.find((id) => id !== v.combo.id && !blockingParts(v.combo, ctx.store.state().combos.find((x) => x.id === id), ctx.partsById).length);
        sheet.done(null);
        await ctx.refresh();
        if (opp) ctx.goTo('log', { left: v.combo.id, right: opp });
        else toast(`Saved ${comboLabel(v.combo, ctx.partsById)}. It's on the Next tab.`);
      } catch (e) { go.disabled = false; toast(`Not saved: ${e.message}`); }
    });
    card.append(h('div', { class: 'toggles' }, go));
    sheet.body.append(card);
  }
  if (ctx.reference?.asOf) sheet.body.append(h('p', { class: 'muted' }, `WBO results from beywatch.gg; packaging stats from the Beyblade wiki (as of ${ctx.reference.asOf}).`));
  return sheet.promise;
}

function newComboBar(ctx) {
  const b = h('button', { type: 'button', class: 'primary' }, '＋ New combo');
  b.addEventListener('click', async () => {
    const id = await openComboBuilder(ctx);
    if (!id) return;
    justBuilt = id;
    toast(`Saved ${comboLabel(ctx.store.state().combos.find((c) => c.id === id), ctx.partsById)}`);
    await ctx.refresh();
    document.getElementById('view')?.scrollTo?.(0, 0);
  });
  return h('div', { class: 'combos-bar' }, b);
}

// After building: one tap to start logging the new combo against the strongest combos.
function justBuiltPanel(ctx, state, rankedIds) {
  const c = state.combos.find((x) => x.id === justBuilt);
  if (!c) { justBuilt = null; return null; }
  const label = comboLabel(c, ctx.partsById);
  const panel = h('section', { class: 'built', 'aria-label': 'New combo' });
  panel.append(h('p', { class: 'detail-title' }, `New: ${label}`));
  const byId = new Map(state.combos.map((x) => [x.id, x]));
  const shares = (id) => blockingParts(c, byId.get(id), ctx.partsById).length > 0;
  const pool = rankedIds.filter((id) => id !== c.id && byId.has(id));
  // Only opponents it can be built alongside (no shared part you have just one of).
  const opps = pool.filter((id) => !shares(id)).slice(0, 3);
  if (opps.length) {
    panel.append(h('p', { class: 'muted' }, 'Test it against the strongest combos — tap one to open the Battle tab with both combos picked:'));
    const row = h('div', { class: 'row-btns' });
    for (const o of opps) {
      const ob = h('button', { type: 'button' }, `vs ${comboLabel(state.combos.find((x) => x.id === o), ctx.partsById)}`);
      ob.addEventListener('click', () => { justBuilt = null; ctx.goTo('log', { left: c.id, right: o }); });
      row.append(ob);
    }
    panel.append(row);
  } else {
    panel.append(h('p', { class: 'muted' }, 'No other combos have been tested yet. Log a battle against any combo to start.'));
  }
  const done = h('button', { type: 'button', class: 'link' }, 'Dismiss');
  done.addEventListener('click', () => { justBuilt = null; ctx.refresh(); });
  panel.append(done);
  return panel;
}

export const SORTS = [
  { key: 'rating', label: 'Rating', note: 'Sorted by rating: expected points per battle against the average tested combo, counting how strong each opponent was.' },
  { key: 'ev', label: 'EV', note: 'Sorted by EV: plain average points per battle against everyone faced.' },
  { key: 'battles', label: 'Most battles', note: 'Most battles first.' },
  { key: 'newest', label: 'Newest', note: 'Newest combos first.' },
];

// Tested combos (those with a rating) in the chosen order; ties fall back to rating.
export function sortCombos(state, ratingById, by) {
  const known = new Set(state.combos.map((c) => c.id));
  const ids = state.combos.map((c) => c.id).filter((id) => ratingById.has(id));
  const r = (id) => ratingById.get(id).r;
  let key;
  if (by === 'ev') {
    const sum = new Map(), cnt = new Map();
    for (const b of state.battles) {
      if (b.left === b.right || !known.has(b.left) || !known.has(b.right)) continue;
      for (const id of [b.left, b.right]) {
        sum.set(id, (sum.get(id) ?? 0) + battleScore(b, id));
        cnt.set(id, (cnt.get(id) ?? 0) + 1);
      }
    }
    key = (id) => (cnt.get(id) ? sum.get(id) / cnt.get(id) : -Infinity);
  } else if (by === 'battles') key = (id) => ratingById.get(id).n;
  else if (by === 'newest') {
    const at = new Map(state.combos.map((c) => [c.id, c.createdAt ?? 0]));
    key = (id) => at.get(id);
  } else key = r;
  return ids.sort((a, b) => key(b) - key(a) || r(b) - r(a));
}

// Session memory: the chosen sort.
let sortBy = 'rating';

export const tab = {
  id: 'combos',
  label: 'Combos',
  render(ctx, el) {
    const state = ctx.store.state();
    el.append(newComboBar(ctx));
    const lb = ratingsLeaderboard(state);
    const ratingById = new Map(lb.map((r) => [r.comboId, r]));
    const ranked = lb.map((r) => r.comboId);
    const topIds = ranked.slice(0, TOP_CLASH);
    const played = new Set();
    for (const b of state.battles) { played.add(b.left); played.add(b.right); }
    const byId = new Map(state.combos.map((c) => [c.id, c]));
    const sorted = sortCombos(state, ratingById, sortBy);
    const ordered = [...sorted, ...state.combos.filter((c) => played.has(c.id) && !ratingById.has(c.id)).map((c) => c.id)];
    const untested = state.combos.filter((c) => !played.has(c.id));

    const panel = justBuiltPanel(ctx, state, ranked);
    if (panel) el.append(panel);
    if (!state.combos.length) { el.append(h('p', { class: 'muted' }, 'No combos yet. Tap New combo to build one.')); return; }
    const bar = h('div', { class: 'chips type-filter', role: 'group', 'aria-label': 'Sort combos' });
    for (const s of SORTS) {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s.key === sortBy) }, s.label);
      b.addEventListener('click', () => { sortBy = s.key; ctx.refresh(); });
      bar.append(b);
    }
    el.append(bar, h('p', { class: 'muted' }, `${SORTS.find((s) => s.key === sortBy).note} Intervals are 95%.`));
    for (const id of ordered) el.append(buildCard(ctx, state, byId.get(id), ratingById, topIds));
    if (untested.length) {
      const d = h('details', { class: 'untested' }, h('summary', {}, `Untested combos (${untested.length})`));
      for (const c of untested) d.append(buildCard(ctx, state, c, ratingById, topIds));
      el.append(d);
    }
  },
};
