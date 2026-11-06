// Next tab: what to test next, from suggestTests over the shared lineup computation.
import { comboLabel } from '../combo.js';
import { suggestTests } from '../suggest.js';
import { makeRng } from '../rng.js';
import { h } from './pickers.js';
import { toast } from './log.js';
import { getLineup } from './lineup.js';

const KIND = { baseline: 'Baseline', blocking: 'Blocking', stage1: 'Screen', stage2: 'Finalist', fix: 'Fix', narrow: 'Narrow' };

async function start(ctx, s) {
  const known = new Set(ctx.store.state().combos.map((c) => c.id));
  for (const c of [s.left, s.right]) if (!known.has(c.id)) await ctx.store.upsertCombo(c);
  await ctx.refresh();
  ctx.goTo('log', { left: s.left.id, right: s.right.id });
}

function swapInField(ctx, s) {
  const state = ctx.store.state();
  const target = s.replacesInField;
  const oldCombo = state.combos.find((c) => c.id === target);
  const oldLabel = oldCombo ? comboLabel(oldCombo, ctx.partsById) : target;
  const fresh = s.left; // suggestTests puts the replacement combo on the left
  const newLabel = comboLabel(fresh, ctx.partsById);
  const untested = !state.battles.some((b) => b.left === fresh.id || b.right === fresh.id);
  const warn = untested ? ` ${newLabel} has no battles yet — the Lineup can't rank decks until it's tested against the field.` : '';
  return ctx.showDialog({
    title: 'Change your test field?',
    body: `Take ${oldLabel} out of the field and add ${newLabel} in its place.${warn}`,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Swap', kind: 'primary',
        async onClick() {
          let step = 'nothing changed yet';
          try {
            const cur = ctx.store.state();
            const entry = cur.field.find((f) => f.comboId === target);
            const core = !!entry?.core;
            if (!cur.combos.some((c) => c.id === fresh.id)) await ctx.store.upsertCombo(fresh);
            step = `${newLabel} was created but is not in the field; ${oldLabel} is unchanged`;
            await ctx.store.setFieldEntry({ comboId: fresh.id, active: true, core });
            step = `${newLabel} is in the field, but ${oldLabel} is still active too`;
            await ctx.store.setFieldEntry({ comboId: target, active: false, core: false });
            toast(`${newLabel} replaces ${oldLabel} in the field`);
          } catch (e) { toast(`Not fully saved (${e.message}): ${step}.`); }
          await ctx.refresh();
        },
      },
    ],
  });
}

export const tab = {
  id: 'next',
  label: 'Next',
  render(ctx, el) {
    const status = h('p', { class: 'muted', role: 'status' }, 'Working out what to test next…');
    el.append(status);
    getLineup(ctx).then(({ result, state, parts }) => {
      if (!status.isConnected) return;
      el.replaceChildren();
      const partsById = new Map(parts.map((p) => [p.id, p]));
      const list = suggestTests(state, parts, result, { rng: makeRng(11) });
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
        // Only field-clash fixes swap the field, and only while that combo is still active in it.
        const inField = s.replacesInField && state.field.some((f) => f.active && f.comboId === s.replacesInField);
        if (s.kind === 'fix' && inField) {
          const old = state.combos.find((c) => c.id === s.replacesInField);
          const b = h('button', { type: 'button' }, `Use in field instead of ${old ? comboLabel(old, partsById) : s.replacesInField}`);
          b.addEventListener('click', () => swapInField(ctx, s));
          bar.append(b);
        }
        row.append(bar);
        el.append(row);
      });
    }, (e) => {
      if (!status.isConnected) return;
      status.className = 'error';
      status.textContent = `Could not compute suggestions: ${e.message}`;
    });
  },
};
