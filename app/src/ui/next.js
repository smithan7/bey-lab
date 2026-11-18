// Next tab: what to test next, from suggestTests over the shared lineup computation.
import { comboLabel } from '../combo.js';
import { lookaheadDeck, suggestTests } from '../suggest.js';
import { h, comboThumbs } from './pickers.js';
import { toast } from './log.js';
import { watchLineup } from './lineup.js';

const KIND = { screen: 'New', unlock: 'Unlock', upset: 'Could change best deck', fix: 'Fix' };

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
      if (!list.length) {
        el.append(h('p', { class: 'muted' }, state.battles.length
          ? 'Your best deck is settled on current data — no matchup has a real chance of changing it. Build a new combo to test.'
          : 'Build some combos to get started.'));
        return;
      }
      el.append(h('p', { class: 'muted' }, 'Suggested tests: new combos, then unlocks (a part swap so two top combos can share a deck), then the matchups most likely to change your best deck. Each is about 10 battles.'));
      const ahead = lookaheadDeck(state, parts);
      if (ahead && list.some((s) => s.kind === 'upset')) {
        const names = ahead.map((id) => comboLabel(state.combos.find((c) => c.id === id), partsById)).join(' / ');
        const top = result.ranked?.[0]?.deck;
        const same = top && top.length === ahead.length && top.every((id) => ahead.includes(id));
        el.append(h('p', { class: 'muted' }, `"Best deck" here means ${names}: your three highest-rated legal combos.${top && !same ? ' The Lineup tab\'s #1 differs on a close call, because it runs full match simulations.' : ''}`));
      }
      list.forEach((s) => {
        const row = h('article', { class: 'report', 'data-kind': s.kind });
        row.append(h('div', { class: 'chips' }, h('span', { class: 'chip' }, KIND[s.kind] ?? s.kind)));
        row.append(h('h3', { class: 'sr-only' }, `${comboLabel(s.left, partsById)} vs ${comboLabel(s.right, partsById)}`));
        // Each side with its part photos, so it's clear which physical beys to build.
        const side = (c) => h('div', { class: 'side' }, comboThumbs(c, partsById), h('strong', {}, comboLabel(c, partsById)));
        row.append(h('div', { class: 'matchup', 'aria-hidden': 'true' }, side(s.left), h('span', { class: 'vs' }, 'vs'), side(s.right)));
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
