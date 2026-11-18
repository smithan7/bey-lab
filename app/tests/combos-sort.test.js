import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortCombos, SORTS } from '../src/ui/combos.js';
import { ratingsLeaderboard } from '../src/ratings.js';

let n = 0;
const g = (l, r, s, k = 1) => Array.from({ length: k }, () => ({ id: `b${n++}`, left: l, right: r, winner: s > 0 ? 'left' : 'right', points: Math.abs(s) }));

test('sortCombos orders tested combos by rating, EV, battles or newest', () => {
  assert.deepEqual(SORTS.map((s) => s.key), ['rating', 'ev', 'battles', 'newest']);
  // A beats strong S narrowly; B crushes weak W. B has the higher raw EV, A the higher rating.
  const battles = [...g('S', 'W', 2, 20), ...g('A', 'S', 1, 6), ...g('S', 'A', 1, 2), ...g('B', 'W', 2, 3)];
  const state = {
    combos: [{ id: 'A', createdAt: 5 }, { id: 'B', createdAt: 9 }, { id: 'S' }, { id: 'W', createdAt: 1 }, { id: 'U', createdAt: 99 }],
    battles,
  };
  const rb = new Map(ratingsLeaderboard(state).map((r) => [r.comboId, r]));
  const rating = sortCombos(state, rb, 'rating');
  assert.ok(rating.indexOf('A') < rating.indexOf('B'), rating.join());
  const ev = sortCombos(state, rb, 'ev');
  assert.equal(ev[0], 'B'); // +2 per battle
  assert.deepEqual(sortCombos(state, rb, 'battles').slice(0, 2), ['S', 'W']); // 28 and 23 battles
  assert.deepEqual(sortCombos(state, rb, 'newest'), ['B', 'A', 'W', 'S']); // untested U is left out; S has no date
  for (const by of ['rating', 'ev', 'battles', 'newest']) assert.ok(!sortCombos(state, rb, by).includes('U'));
});
