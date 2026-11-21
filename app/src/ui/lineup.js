// Lineup tab: the best legal 3-bey deck. Ranking runs in a module worker; getLineup is shared with the Next tab.
import { comboLabel, comboParts } from '../combo.js';
import { h, comboThumbs, openSheet } from './pickers.js';
import { confirmTests } from '../suggest.js';
import { fmtEv, fmtPct } from './combos.js';

function hashStr(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

// Deterministic key of everything that decides the ranking: every battle,
// the combo ids and which parts are owned (display names don't matter).
export function lineupKey(state, parts) {
  const bats = state.battles.map((b) => `${b.id}|${b.winner}|${b.finish}|${b.points}|${b.left}|${b.right}`).join('\n');
  // Owned parts, with * marking ones owned more than once (Next can pair combos sharing them).
  const owned = parts.filter((p) => p.owned).map((p) => (p.multiple ? `${p.id}*` : p.id)).sort().join(',');
  return hashStr(`${bats}#${state.combos.map((c) => c.id).join(',')}#${owned}`);
}

let worker = null;
let cache = { key: null, promise: null };
let inflight = null; // { key, cancel } while a worker run is in progress
let last = null; // the most recent completed { key, result, state, parts }

// Thrown to callers of a run that a newer key replaced; they should ask getLineup again.
export class Superseded extends Error {
  constructor() { super('superseded by newer data'); this.name = 'Superseded'; }
}

function runWorker(state, parts, seed) {
  worker ??= new Worker(new URL('../lineup-worker.js', import.meta.url), { type: 'module' });
  const w = worker;
  return new Promise((resolve, reject) => {
    const cleanup = () => { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); };
    const onMsg = (e) => {
      if (e.data?.type === 'ranked') { cleanup(); resolve(e.data.result); }
      else if (e.data?.type === 'error') { cleanup(); reject(new Error(e.data.message)); }
    };
    const onErr = (e) => { cleanup(); if (worker === w) worker = null; reject(new Error(e.message || 'Lineup worker failed')); };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    // A newer key stops this run outright: the worker is terminated and replaced on the next run.
    inflight = { key: seed, cancel: () => { cleanup(); w.terminate(); if (worker === w) worker = null; reject(new Superseded()); } };
    const { photos, ...plain } = state;
    w.postMessage({ type: 'rank', state: JSON.parse(JSON.stringify(plain)), parts: JSON.parse(JSON.stringify(parts)), seed });
  });
}

// Cached per data key. One run at a time: a request for a new key terminates any stale run
// rather than queueing behind it.
export function getLineup(ctx) {
  const state = ctx.store.state();
  const parts = ctx.parts;
  const key = lineupKey(state, parts);
  if (cache.key === key) return cache.promise;
  if (inflight && inflight.key !== key) { const { cancel } = inflight; inflight = null; cancel(); }
  const promise = runWorker(state, parts, key).then((result) => {
    last = { key, result, state, parts };
    return { result, state, parts };
  });
  const done = () => { if (inflight?.key === key) inflight = null; };
  promise.then(done, done);
  cache = { key, promise };
  promise.catch(() => { if (cache.promise === promise) cache = { key: null, promise: null }; });
  return promise;
}

// Waits for the lineup of the current data, following any newer run that supersedes it.
// onStale(previous) is called first when an older completed result can be shown meanwhile.
export function watchLineup(ctx, { isLive, onStale, onResult, onError }) {
  const key = lineupKey(ctx.store.state(), ctx.parts);
  if (last && last.key !== key) onStale?.(last);
  const attempt = () => getLineup(ctx).then((r) => { if (isLive()) onResult(r); }, (e) => {
    if (!isLive()) return;
    if (e instanceof Superseded) attempt();
    else onError(e);
  });
  attempt();
}

const pctText = (r) => `${fmtPct(r.p)} [${fmtPct(r.lo)}–${fmtPct(r.hi)}]`;

export const tab = {
  id: 'lineup',
  label: 'Lineup',
  render(ctx, el) {
    const status = h('p', { class: 'muted', role: 'status' }, 'Working out the best deck…');
    el.append(status);
    const stillHere = () => status.isConnected;
    watchLineup(ctx, {
      isLive: stillHere,
      // While recomputing, keep the previous result on screen, clearly marked as updating.
      onStale: ({ result, state, parts }) => {
        status.textContent = 'Updating…';
        status.classList.add('updating');
        const prev = h('div', { class: 'stale', 'aria-busy': 'true' });
        renderResult(ctx, prev, result, state, parts);
        el.append(prev);
      },
      onResult: ({ result, state, parts }) => {
        el.replaceChildren(status);
        status.hidden = true;
        renderResult(ctx, el, result, state, parts);
      },
      onError: (e) => {
        el.replaceChildren(status);
        status.className = 'error';
        status.textContent = `Could not compute the lineup: ${e.message}`;
      },
    });
  },
};

// Rating table: every tested combo by EV rating, then untested owned combos.
function leaderboard(el, rows, state, parts, label) {
  el.append(h('h2', {}, 'Combo ratings'));
  el.append(h('p', { class: 'muted' }, 'Rating = expected points per battle against the average tested combo. Beating strong combos counts for more.'));
  const table = h('table', { class: 'rtable' });
  table.append(h('thead', {}, h('tr', {}, ...['Combo', 'Rating [95%]', 'Battles', 'Opponents'].map((t) => h('th', {}, t)))));
  const body = h('tbody');
  for (const r of rows) {
    body.append(h('tr', {}, h('th', { scope: 'row' }, label(r.comboId)), h('td', {}, `${fmtEv(r.r)} [${fmtEv(r.lo)}, ${fmtEv(r.hi)}]`),
      h('td', {}, String(r.n)), h('td', {}, String(r.opponents))));
  }
  const rated = new Set(rows.map((r) => r.comboId));
  const owned = new Set(parts.filter((p) => p.owned).map((p) => p.id));
  for (const c of state.combos) {
    if (rated.has(c.id) || !comboParts(c).every((p) => owned.has(p))) continue;
    const tr = h('tr', {}, h('th', { scope: 'row' }, label(c.id)));
    tr.append(h('td', { colspan: '3', class: 'muted' }, 'not yet tested'));
    body.append(tr);
  }
  table.append(body);
  el.append(h('div', { class: 'tscroll' }, table));
}

// Sheet with the tests that would best confirm a deck (confirmTests), each with a Battle button.
function openConfirm(ctx, state, parts, deck, label, partsById, byId) {
  const sheet = openSheet('Tests to confirm this deck');
  const close = h('button', { type: 'button' }, 'Close');
  close.addEventListener('click', () => sheet.done(null));
  sheet.head.replaceChildren(close, sheet.heading);
  const tests = confirmTests(state, parts, deck);
  sheet.body.append(h('p', { class: 'muted' }, `${deck.map(label).join(' / ')}. These matchups are the biggest guesses behind this deck's win chance. About 10 battles each; the list updates as you test.`));
  if (!tests.length) sheet.body.append(h('p', {}, 'Nothing to suggest: every matchup you can run for this deck is already tested.'));
  const side = (id) => h('div', { class: 'side' }, comboThumbs(byId.get(id), partsById), h('strong', {}, label(id)));
  tests.forEach((t, i) => {
    const go = h('button', { type: 'button', class: 'primary' }, 'Battle');
    go.addEventListener('click', () => { sheet.done(null); ctx.goTo('log', { left: t.a, right: t.b }); });
    sheet.body.append(h('article', { class: 'report' }, h('h3', {}, `Test ${i + 1}`),
      h('div', { class: 'matchup' }, side(t.a), h('span', { class: 'vs' }, 'vs'), side(t.b)),
      h('p', {}, t.reason), h('div', { class: 'toggles' }, go)));
  });
}

function renderResult(ctx, el, result, state, parts) {
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const byId = new Map(state.combos.map((c) => [c.id, c]));
  const label = (id) => comboLabel(byId.get(id), partsById);

  if (result.tooFew) el.append(h('p', { class: 'chip flag' }, 'Test at least 3 combos to rank decks.'));
  else if (result.noLegal) el.append(h('p', { class: 'chip flag' }, 'No legal deck from your owned, tested combos yet.'));

  if (result.ranked.length) {
    el.append(h('p', { class: 'muted' }, 'Best decks against all tested combos. Win chance is P(win the match), with its 95% range.'));
    const top = result.ranked.slice(0, 5);
    const first = top[0];
    if (first.differs) {
      const second = top.reduce((a, b) => (b.best.target7.p > a.best.target7.p ? b : a));
      const banner = h('div', { class: 'report', role: 'note' }, h('h3', {}, 'Best deck for first-to-7 is different'));
      const line = (tag, r) => h('p', {}, `${tag}: ${r.deck.map(label).join(' / ')} — first-to-5 ${pctText(r.best.target5)}, first-to-7 ${pctText(r.best.target7)}`);
      banner.append(line('First-to-5 best', first));
      if (second !== first) banner.append(line('First-to-7 best', second));
      el.append(banner);
    }
    const ratingOf = new Map((result.ratings ?? []).map((x) => [x.comboId, x]));
    const pct = (v) => `${Math.round(v * 100)}%`;
    const range = (bt) => `${pct(bt.lo)}–${pct(bt.hi)}`;
    top.forEach((r, i) => {
      const hero = i === 0;
      const b5 = r.best.target5, b7 = r.best.target7;
      const card = h('article', { class: `report deck${hero ? ' deck-hero' : ''}`, 'data-rank': String(i + 1) });
      // Header: rank (and "Run this" for #1) on the left, first-to-5 win chance on the right.
      const head = h('div', { class: 'deck-head' },
        h('div', {}, h('h3', {}, `#${i + 1}`), hero ? h('span', { class: 'chip run' }, 'Run this') : ''),
        h('div', { class: 'win' }, h('span', { class: 'win-pct' }, pct(b5.p)), h('span', { class: 'muted' }, `win chance · first to 5 · ${range(b5)}`)));
      card.append(head);
      // Members, lead first when one is recommended.
      const order = b5.lead == null ? [0, 1, 2] : [b5.lead, ...[0, 1, 2].filter((k) => k !== b5.lead)];
      const members = h('ul', { class: 'members' });
      for (const k of order) {
        const id = r.deck[k];
        const rr = ratingOf.get(id);
        const row = h('li', { class: 'member' }, comboThumbs(byId.get(id), partsById),
          h('div', { class: 'member-text' },
            h('strong', {}, label(id)),
            h('span', { class: 'muted' }, [rr ? `Rating ${fmtEv(rr.r)}` : '', (r.memberEstimated?.[k] ?? 0) > 0.5 ? 'mostly estimated' : ''].filter(Boolean).join(' · '))));
        if (b5.lead === k) row.append(h('span', { class: 'chip lead' }, 'Lead'));
        members.append(row);
      }
      card.append(members);
      const orderText = (bt) => (bt.lead == null ? 'any order' : `lead with ${label(r.deck[bt.lead])}`);
      if (hero) {
        card.append(h('p', {}, `First to 5: ${orderText(b5)}${b5.lead != null ? ` (random order ${pct(r.randomOrder.target5.p)})` : ''}.`));
        card.append(h('p', {}, `First to 7: ${pct(b7.p)} [${range(b7)}], ${orderText(b7)}.`));
      } else {
        card.append(h('p', { class: 'muted' }, `First to 7: ${pct(b7.p)} · ${b5.lead == null ? 'Any order' : `Lead: ${label(r.deck[b5.lead])}`}`));
      }
      const testedPct = Math.round((1 - (r.estimatedShare ?? 0)) * 100);
      const est = (r.estimatedShare ?? 0) > 0.5;
      // Warnings are buttons: tapping one lists the tests that would best confirm this deck.
      const flag = (txt) => {
        const b = h('button', { type: 'button', class: 'chip flag confirm' }, `${txt} › Tap for the 3 tests to run`);
        b.addEventListener('click', () => openConfirm(ctx, state, parts, r.deck, label, partsById, byId));
        return b;
      };
      const based = `Based on ${testedPct}% tested matchups`;
      card.append(est ? flag(`${based} — mostly estimated from ratings, test more to confirm.`) : h('p', { class: 'muted' }, based));
      // One mostly-estimated member can hide behind two well-tested ones, so name it.
      (r.memberEstimated ?? []).forEach((share, m) => {
        if (est || share <= 0.5) return;
        card.append(flag(`${label(r.deck[m])}: ${Math.round((1 - share) * 100)}% of its matchups tested — mostly estimated, test more to confirm.`));
      });
      el.append(card);
      if (hero && top.length > 1) el.append(h('h2', { class: 'runners' }, 'Runners-up'));
    });
  }
  if (result.ratings?.length || state.combos.length) leaderboard(el, result.ratings ?? [], state, parts, label);
}
