// Log tab: pick two combos, tap who won and how. Fast and hard to mis-tap.
import { FINISH_POINTS } from '../scoring.js';
import { matchupStats } from '../stats.js';
import { pairingScores } from '../matchups.js';
import { comboLabel } from '../combo.js';
import { h, openComboPicker } from './pickers.js';

export function logReadout(state, left, right, opts = {}) {
  const scores = pairingScores(state.battles, left, right);
  const n = scores.length;
  const wins = scores.filter((s) => s > 0).length;
  const losses = scores.filter((s) => s < 0).length;
  const draws = n - wins - losses;
  const known = n >= 2;
  const st = known ? matchupStats(scores, { draws: 4000, raceSims: 0, ...opts }) : null;
  return {
    n, wins, draws, losses,
    record: `${wins}-${draws}-${losses}`, // wins-draws-losses, from the left combo's side
    batchCount: n % 10,
    ev: st ? st.ev : null,
    evCI: st ? st.evCI : null,
    pEvNeg: st ? st.pEvNeg : null,
  };
}

const FINISHES = [['spin', 'Spin'], ['burst', 'Burst'], ['pocket', 'Pocket'], ['xtreme', 'Xtreme']];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Session memory (not persisted).
let last = { left: null, right: null };
let lastParams;
let busy = false;

export function toast(text) {
  const host = document.getElementById('toast') ?? document.body.appendChild(h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }));
  host.textContent = text;
  host.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => host.classList.remove('show'), 2200);
}

function lastBattle(battles) {
  let idx = -1;
  battles.forEach((b, i) => { if (idx < 0 || (b.ts ?? 0) >= (battles[idx].ts ?? 0)) idx = i; });
  return idx < 0 ? null : battles[idx];
}

function intervalBar(r) {
  const pct = (v) => `${(Math.min(3, Math.max(-3, v)) + 3) / 6 * 100}%`;
  const track = h('div', { class: 'ibar', role: 'img',
    'aria-label': `95% interval ${r.evCI[0].toFixed(2)} to ${r.evCI[1].toFixed(2)}, EV ${r.ev.toFixed(2)}` });
  const fill = h('div', { class: 'ibar-fill' });
  fill.style.left = pct(r.evCI[0]);
  fill.style.width = `${(Math.min(3, r.evCI[1]) - Math.max(-3, r.evCI[0])) / 6 * 100}%`;
  const zero = h('div', { class: 'ibar-zero' }); zero.style.left = '50%';
  const dot = h('div', { class: 'ibar-ev' }); dot.style.left = pct(r.ev);
  track.append(fill, zero, dot);
  const axis = h('div', { class: 'ibar-axis' }, h('span', {}, '−3'), h('span', {}, '0'), h('span', {}, '+3'));
  return h('div', {}, track, axis);
}

export const tab = {
  id: 'log',
  label: 'Log',
  render(ctx, el, params) {
    if (params && params !== lastParams) {
      lastParams = params;
      if (params.left) last.left = params.left;
      if (params.right) last.right = params.right;
    }
    const state = ctx.store.state();
    const known = new Set(state.combos.map((c) => c.id));
    if (!known.has(last.left)) last.left = null;
    if (!known.has(last.right)) last.right = null;
    if (!last.left && !last.right) {
      const lb = lastBattle(state.battles);
      if (lb && known.has(lb.left) && known.has(lb.right)) last = { left: lb.left, right: lb.right };
    }
    const combosById = new Map(state.combos.map((c) => [c.id, c]));
    const labelOf = (id) => (id ? comboLabel(combosById.get(id), ctx.partsById) : null);
    const lName = labelOf(last.left), rName = labelOf(last.right);

    const errBox = h('p', { class: 'error', role: 'alert' });
    const acts = [];

    async function pick(side) {
      if (busy) return;
      const id = await openComboPicker(ctx);
      if (!id) return;
      last[side] = id;
      await ctx.refresh();
    }
    const card = (side, name) => {
      const b = h('button', { type: 'button', class: `combo-card ${side}` });
      b.append(h('span', { class: 'muted' }, side === 'left' ? 'LEFT' : 'RIGHT'), h('strong', {}, name ?? 'Tap to pick a combo'));
      b.addEventListener('click', () => pick(side));
      return b;
    };
    const swap = h('button', { type: 'button', class: 'swap', 'aria-label': 'Swap sides' }, '⇄');
    swap.addEventListener('click', async () => {
      if (busy) return;
      last = { left: last.right, right: last.left };
      await ctx.refresh();
    });

    async function record(winner, finish, points, note = '') {
      if (busy) return;
      errBox.textContent = '';
      if (!last.left || !last.right) { errBox.textContent = 'Pick both combos first.'; return; }
      busy = true;
      for (const b of acts) b.disabled = true;
      try {
        await ctx.store.addBattle({ id: crypto.randomUUID(), left: last.left, right: last.right, winner, finish, points, note, ts: Date.now() });
        const label = winner === 'draw' ? 'Draw' : finish === 'unknown' ? '2 pts (type unknown)' : cap(finish);
        const who = winner === 'draw' ? `${lName} vs ${rName}` : labelOf(winner === 'left' ? last.left : last.right);
        toast(winner === 'draw' ? `Draw: ${who}` : `${label} → ${who}`);
        busy = false;
        await ctx.refresh();
      } catch (e) {
        busy = false;
        errBox.textContent = e.message;
        for (const b of acts) b.disabled = false;
      }
    }
    const act = (text, onClick, cls = '') => {
      const b = h('button', { type: 'button', class: `act ${cls}`.trim() });
      b.textContent = text;
      b.addEventListener('click', onClick);
      acts.push(b);
      return b;
    };

    const grid = h('div', { class: 'grid' });
    for (const [f, name] of FINISHES) {
      const pts = FINISH_POINTS[f];
      grid.append(act(`◀ ${name} ${pts}`, () => record('left', f, pts), 'win'), act(`${name} ${pts} ▶`, () => record('right', f, pts), 'win'));
    }
    grid.append(act('◀ 2 pts (type unknown)', () => record('left', 'unknown', 2)), act('2 pts (type unknown) ▶', () => record('right', 'unknown', 2)));

    const draw = act('Draw', async () => {
      if (busy) return;
      if (!last.left || !last.right) { errBox.textContent = 'Pick both combos first.'; return; }
      const input = h('input', { type: 'text', class: 'search', placeholder: 'Note (optional)', maxlength: '200' });
      const choice = await ctx.showDialog({
        title: 'Log a draw', body: input,
        actions: [{ label: 'Cancel' }, { label: 'Log draw', kind: 'primary' }],
      });
      if (choice === 'Log draw') await record('draw', null, 0, input.value.trim());
    });
    const undo = act('Undo last battle', async () => {
      if (busy) return;
      const b = lastBattle(ctx.store.state().battles);
      if (!b) { toast('Nothing to undo'); return; }
      busy = true;
      for (const x of acts) x.disabled = true;
      try {
        const names = new Map(ctx.store.state().combos.map((c) => [c.id, comboLabel(c, ctx.partsById)]));
        const L = names.get(b.left) ?? b.left, R = names.get(b.right) ?? b.right;
        await ctx.store.undoLastBattle();
        toast(b.winner === 'draw' ? `Undid draw: ${L} vs ${R}`
          : `Undid ${b.finish === 'unknown' ? '2 pts' : cap(b.finish ?? 'win')} → ${b.winner === 'left' ? L : R} (vs ${b.winner === 'left' ? R : L})`);
        busy = false;
        await ctx.refresh();
      } catch (e) {
        busy = false;
        errBox.textContent = e.message;
        for (const x of acts) x.disabled = false;
      }
    });
    const bar = h('div', { class: 'row2' }, draw, undo);

    const readout = h('section', { class: 'readout' }, h('h3', {}, 'This pairing'));
    if (last.left && last.right && last.left !== last.right) {
      const r = logReadout(state, last.left, last.right);
      readout.append(h('p', {}, `Record (W-D-L for left): ${r.record}   Batch: ${r.batchCount}/10`));
      if (r.ev == null) readout.append(h('p', { class: 'muted' }, r.n ? 'Only 1 battle: EV unknown.' : 'No battles yet: unknown.'));
      else {
        readout.append(
          h('p', {}, `EV ${r.ev >= 0 ? '+' : ''}${r.ev.toFixed(2)} (95%: ${r.evCI[0].toFixed(2)} to ${r.evCI[1].toFixed(2)}) over ${r.n} battles`),
          intervalBar(r),
          h('p', {}, `P(EV < 0): ${Math.round(r.pEvNeg * 100)}%`),
        );
      }
    } else readout.append(h('p', { class: 'muted' }, 'Pick two different combos to see the record.'));

    el.append(h('div', { class: 'cards' }, card('left', lName), swap, card('right', rName)), errBox, grid, bar, readout);
  },
};
