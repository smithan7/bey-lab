import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng.js';
import { outcomeCounts } from '../src/scoring.js';
import { matchupStats } from '../src/stats.js';
import { playMatch, matchWinPoint, matchWinPosterior } from '../src/sim.js';

const rhWr = [-1, 2, -1, 0, -1, -1, -1, -1, -1, 3];
const grid = (v) => [0, 1, 2].map(() => [0, 1, 2].map(() => v));
const point = (k) => { const p = [0, 0, 0, 0, 0, 0, 0]; p[k] = 1; return p; }; // k: index in OUTCOMES
const winRate = (probs, target, rng, n, lead) => {
  let w = 0;
  for (let i = 0; i < n; i++) if (playMatch(probs, target, rng, lead)) w++;
  return w / n;
};

test('always +1 wins every match', () => {
  assert.equal(winRate(grid(point(4)), 5, makeRng(1), 2000, null), 1);
});

test('symmetric cells give ~0.5', () => {
  const s = [0.1, 0.1, 0.2, 0.2, 0.2, 0.1, 0.1];
  const w = winRate(grid(s), 5, makeRng(2), 20000, null);
  assert.ok(Math.abs(w - 0.5) < 0.03, `got ${w}`);
});

test('single-pairing cells match the race estimate', () => {
  const p = outcomeCounts(rhWr).map(c => c / 10);
  const w = winRate(grid(p), 5, makeRng(3), 20000, null);
  const race = matchupStats(rhWr, { rng: makeRng(4) }).race[5];
  assert.ok(Math.abs(w - race) < 0.03, `sim ${w} vs race ${race}`);
});

// Others lose 2 (not 1): with -1 the dominant combo wins every match either way, so lead could not matter.
test('lead on the dominant combo beats shuffled order', () => {
  const probs = [0, 1, 2].map(i => [0, 1, 2].map(() => point(i === 0 ? 6 : 1)));
  const led = winRate(probs, 5, makeRng(5), 5000, 0);
  const free = winRate(probs, 5, makeRng(5), 5000, null);
  assert.ok(led > free, `lead ${led} vs null ${free}`);
});

test('higher target lowers the win rate (variance effect)', () => {
  const p = outcomeCounts(rhWr).map(c => c / 10);
  const w5 = winRate(grid(p), 5, makeRng(6), 20000, null);
  const w7 = winRate(grid(p), 7, makeRng(6), 20000, null);
  assert.ok(w7 < w5, `target7 ${w7} vs target5 ${w5}`);
});

test('matchWinPoint and matchWinPosterior are sane and fast', () => {
  const cell = { counts: outcomeCounts(rhWr), n: 10 };
  const m = grid(cell);
  let t = performance.now();
  const p = matchWinPoint(m, 5, { rng: makeRng(7), matches: 1000, lead: null });
  const tPoint = performance.now() - t;
  assert.ok(p > 0 && p < 1);
  t = performance.now();
  const r = matchWinPosterior(m, 5, { rng: makeRng(8), outer: 200, inner: 50, lead: null });
  const tPost = performance.now() - t;
  assert.ok(r.lo <= r.p && r.p <= r.hi && r.lo >= 0 && r.hi <= 1);
  assert.ok(tPoint < 100 && tPost < 100, `point ${tPoint}ms posterior ${tPost}ms`);
});
