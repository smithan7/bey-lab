// Next tab: what to test next, from suggestTests over the shared lineup computation.
import { comboLabel } from '../combo.js';
import { suggestTests } from '../suggest.js';
import { h } from './pickers.js';
import { toast } from './log.js';
import { watchLineup } from './lineup.js';

const KIND = { screen: 'New', contender: 'Contender', topcheck: 'Top deck', fix: 'Fix', narrow: 'Narrow' };

async function start(ctx, s) {
  const known = new Set(ctx.store.state().combos.map((c) => c.id));
  for (const c of [s.left, s.right]) if (!known.has(c.id)) await ctx.store.upsertCombo(c);
  await ctx.refresh();
  ctx.goTo('log', { left: s.left.id, right: s.right.id });
}

export const tab = {
  id: 'next',
  label: 'Next',
  render(ctx, el) {
    const status = h('p', { class: 'muted', role: 'status' }, 'Working out what to test next…');
    el.append(status);
    const onResult = ({ result, state, parts }) => {
      el.replaceChildren();
      const partsById = new Map(parts.map((p) => [p.id, p]));
      const list = suggestTests(state, parts, result);
      if (!list.length) { el.append(h('p', { class: 'muted' }, 'Nothing to suggest right now.')); return; }
      el.append(h('p', { class: 'muted' }, 'Suggested tests, most useful first. Each is about 10 battles.'));
      list.forEach((s) => {
        const row = h('article', { class: 'report', 'data-kind': s.kind });
        row.append(h('div', { class: 'chips' }, h('span', { class: 'chip' }, KIND[s.kind] ?? s.kind)));
        row.append(h('h3', {}, `${comboLabel(s.left, partsById)} vs ${comboLabel(s.right, partsById)}`));
        row.append(h('p', {}, s.reason));
        const bar = h('div', { class: 'toggles' });
        const go = h('button', { type: 'button', class: 'primary' }, 'Start');
        go.addEventListener('click', async () => {
          if (go.disabled) return;
          go.disabled = true;
          try { await start(ctx, s); } catch (e) { go.disabled = false; toast(`Could not start: ${e.message}`); }
        });
        bar.append(go);
        row.append(bar);
        el.append(row);
      });
    };
    watchLineup(ctx, {
      isLive: () => status.isConnected,
      onResult,
      onError: (e) => {
        status.className = 'error';
        status.textContent = `Could not compute suggestions: ${e.message}`;
      },
    });
  },
};
