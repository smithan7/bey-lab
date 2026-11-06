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

// Deterministic key of the data that decides the ranking.
export function lineupKey(state) {
  const b = state.battles;
  const last = b.reduce((m, x) => Math.max(m, x.ts ?? 0), 0);
  return hashStr(`${b.length}|${last}|${JSON.stringify(state.field)}|${state.combos.map((c) => c.id).join(',')}`);
}

let worker;
let cache = { key: null, promise: null };

function runWorker(state, parts, seed) {
  worker ??= new Worker(new URL('../lineup-worker.js', import.meta.url), { type: 'module' });
  const w = worker;
  return new Promise((resolve, reject) => {
    const cleanup = () => { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); };
    const onMsg = (e) => {
      if (e.data?.type === 'ranked') { cleanup(); resolve(e.data.result); }
      else if (e.data?.type === 'error') { cleanup(); reject(new Error(e.data.message)); }
    };
    const onErr = (e) => { cleanup(); worker = null; reject(new Error(e.message || 'Lineup worker failed')); };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    const { photos, ...plain } = state;
    w.postMessage({ type: 'rank', state: JSON.parse(JSON.stringify(plain)), parts: JSON.parse(JSON.stringify(parts)), seed });
  });
}

// Cached per data key. Runs of the one worker are serialised so replies can't cross.
let chain = Promise.resolve();
export function getLineup(ctx) {
  const state = ctx.store.state();
  const key = lineupKey(state);
  if (cache.key === key) return cache.promise;
  const parts = ctx.parts;
  const promise = chain.catch(() => {}).then(() => runWorker(state, parts, key));
  chain = promise;
  cache = { key, promise };
  promise.catch(() => { if (cache.promise === promise) cache = { key: null, promise: null }; });
  return promise;
}

const pctText = (r) => `${fmtPct(r.p)} [${fmtPct(r.lo)}–${fmtPct(r.hi)}]`;

export const tab = {
  id: 'lineup',
  label: 'Lineup',
  render(ctx, el) {
    const status = h('p', { class: 'muted', role: 'status' }, 'Working out the best deck…');
    el.append(status);
    const stillHere = () => status.isConnected;
    getLineup(ctx).then((result) => {
      if (!stillHere()) return;
      el.replaceChildren();
      renderResult(ctx, el, result);
    }, (e) => {
      if (!stillHere()) return;
      status.className = 'error';
      status.textContent = `Could not compute the lineup: ${e.message}`;
    });
  },
};

function renderResult(ctx, el, result) {
  const state = ctx.store.state();
  const byId = new Map(state.combos.map((c) => [c.id, c]));
  const label = (id) => comboLabel(byId.get(id), ctx.partsById);
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
      if (second) banner.append(line('First-to-7 best', second));
      el.append(banner);
    }
    top.forEach((r, i) => {
      const card = h('article', { class: 'report', 'data-rank': String(i + 1) });
      card.append(h('h3', {}, `#${i + 1}`));
      const list = h('ol', {});
      for (const id of r.deck) {
        const li = h('li', {}, label(id));
        if (i === 0 && !activeField.has(id)) {
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
        card.append(h('small', { class: 'muted' }, `Random order: ${pctText(r.randomOrder[key])}`), h('br'));
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
