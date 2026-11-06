// Lineup tab: the best legal 3-bey deck. Ranking runs in a module worker; getLineup is shared with the Next tab.
import { comboLabel } from '../combo.js';
import { comboLeaderboard } from '../lineup.js';
import { makeRng } from '../rng.js';
import { h } from './pickers.js';
import { toast } from './log.js';
import { fmtEv, fmtPct } from './combos.js';

function hashStr(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

// Deterministic key of everything that decides the ranking: every battle, the field,
// the combo ids and which parts are owned (display names don't matter).
export function lineupKey(state, parts) {
  const bats = state.battles.map((b) => `${b.id}|${b.winner}|${b.finish}|${b.points}|${b.left}|${b.right}`).join('\n');
  const owned = parts.filter((p) => p.owned).map((p) => p.id).sort().join(',');
  return hashStr(`${bats}#${JSON.stringify(state.field)}#${state.combos.map((c) => c.id).join(',')}#${owned}`);
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
        renderResult(ctx, prev, result, state, parts, { stale: true });
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

function renderResult(ctx, el, result, state, parts, { stale = false } = {}) {
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const byId = new Map(state.combos.map((c) => [c.id, c]));
  const label = (id) => comboLabel(byId.get(id), partsById);
  const activeField = new Set(state.field.filter((f) => f.active || f.core).map((f) => f.comboId));

  if (result.fieldTooSmall) el.append(h('p', { class: 'chip flag' }, 'Add at least 3 combos to the field (Combos tab)'));
  else if (!result.fieldLegal) {
    el.append(h('p', { class: 'chip flag' }, "Your test field isn't a legal deck (shares parts) — results still valid as a yardstick"));
  }

  if (result.ranked.length) {
    el.append(h('p', { class: 'muted' }, 'Best decks against your test field. Percentages are P(win the match) with 95% intervals.'));
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
    top.forEach((r, i) => {
      const card = h('article', { class: 'report', 'data-rank': String(i + 1) });
      card.append(h('h3', {}, `#${i + 1}`));
      const list = h('ol', {});
      for (const id of r.deck) {
        const li = h('li', {}, label(id));
        if (i === 0 && !stale && !activeField.has(id)) {
          const b = h('button', { type: 'button' }, 'Add to field');
          b.addEventListener('click', async () => {
            if (b.disabled) return;
            b.disabled = true;
            try { await ctx.store.setFieldEntry({ comboId: id, active: true, core: false }); } catch (e) { b.disabled = false; toast(`Not saved: ${e.message}`); return; }
            toast(`${label(id)} added to the field`);
            await ctx.refresh();
          });
          li.append(' ', b);
        }
        list.append(li);
      }
      card.append(list);
      for (const [name, key] of [['First-to-5', 'target5'], ['First-to-7', 'target7']]) {
        const bt = r.best[key];
        const leadText = bt.lead == null ? 'Any order' : `Lead with ${label(r.deck[bt.lead])}`;
        card.append(h('p', {}, h('strong', {}, `${name}: ${pctText(bt)}`), ` — ${leadText}`));
        if (bt.lead != null) card.append(h('small', { class: 'muted' }, `Random order: ${pctText(r.randomOrder[key])}`), h('br'));
      }
      el.append(card);
    });
    return;
  }

  // No ranked decks: explain what's missing.
  if (!result.fieldTooSmall) {
    el.append(h('p', {}, 'No deck can be ranked yet: every pairing between a deck member and the field needs data.'));
  }
  if (result.blocked.length) {
    el.append(h('h2', {}, 'Closest decks'));
    for (const b of result.blocked.slice(0, 5)) {
      const card = h('article', { class: 'report' }, h('h3', {}, b.deck.map(label).join(' / ')));
      card.append(h('p', { class: 'muted' }, `${b.missing.length} untested pairing${b.missing.length === 1 ? '' : 's'} — tap one to log it:`));
      const chips = h('div', { class: 'chips' });
      for (const [l, r] of b.missing) {
        const chip = h('button', { type: 'button', class: 'chip' }, `${label(l)} vs ${label(r)}`);
        chip.addEventListener('click', () => ctx.goTo('log', { left: l, right: r }));
        chips.append(chip);
      }
      card.append(chips);
      el.append(card);
    }
  }
  const lb = comboLeaderboard(state, { rng: makeRng(7), draws: 500, raceSims: 0 });
  if (lb.length) {
    el.append(h('h2', {}, 'Combo leaderboard'));
    const table = h('table', { class: 'rtable' });
    table.append(h('thead', {}, h('tr', {}, ...['Combo', 'EV [95%]', 'Tested'].map((t) => h('th', {}, t)))));
    const body = h('tbody');
    for (const r of lb) {
      const ci = r.evCI && r.evCI.every(Number.isFinite) ? `[${fmtEv(r.evCI[0])}, ${fmtEv(r.evCI[1])}]` : '[n/a]';
      body.append(h('tr', {}, h('th', { scope: 'row' }, label(r.comboId)), h('td', {}, `${fmtEv(r.ev)} ${ci}`),
        h('td', {}, `${r.tested}/${r.of}`)));
    }
    table.append(body);
    el.append(h('div', { class: 'tscroll' }, table));
  }
}
