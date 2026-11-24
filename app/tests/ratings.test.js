import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitRatings, ratingsLeaderboard, LAMBDA, SIGMA2_FLOOR } from '../src/ratings.js';
import { makeRng, shuffle } from '../src/rng.js';

let seq = 0;
// n battles of a vs b, each scoring s from a's side (s = 0 is a draw).
function games(a, b, s, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(s === 0
      ? { id: `g${seq++}`, left: a, right: b, winner: 'draw', points: 0 }
      : { id: `g${seq++}`, left: a, right: b, winner: s > 0 ? 'left' : 'right', points: Math.abs(s) });
  }
  return out;
}
const pool = (k, per) => {
  const out = [];
  for (let i = 1; i <= k; i++) for (let j = i + 1; j <= k; j++) out.push(...games(`P${i}`, `P${j}`, 1, per / 2), ...games(`P${j}`, `P${i}`, 1, per / 2));
  return out;
};
const poolAvg = (r, k) => { let s = 0; for (let i = 1; i <= k; i++) s += r.get(`P${i}`).r; return s / k; };

test('constants', () => {
  assert.equal(LAMBDA, 3);
  assert.equal(SIGMA2_FLOOR, 1);
});

test('symmetric results give ratings of 0', () => {
  const r = fitRatings([...games('A', 'B', 1, 5), ...games('B', 'A', 1, 5)]);
  assert.ok(Math.abs(r.get('A').r) < 1e-9);
  assert.ok(Math.abs(r.get('B').r) < 1e-9);
});

test('beating a strong combo rates higher than beating a weak one by the same margin', () => {
  const b = [...games('S', 'W', 2, 20), ...games('X', 'S', 1, 10), ...games('Y', 'W', 1, 10)];
  const r = fitRatings(b);
  assert.ok(r.get('X').r > r.get('Y').r + 0.5, `${r.get('X').r} vs ${r.get('Y').r}`);
});

test('one battle stays modest', () => {
  const r = fitRatings(games('X', 'Z', 3, 1));
  assert.ok(r.get('X').r - r.get('Z').r < 3);
  assert.ok(r.get('X').r < 1.5);
});

test('order independent', () => {
  const b = [...games('A', 'B', 2, 4), ...games('B', 'C', 1, 6), ...games('C', 'A', -3, 3), ...games('A', 'D', 0, 2)];
  const r1 = fitRatings(b);
  const r2 = fitRatings(shuffle(makeRng(5), b));
  for (const k of ['A', 'B', 'C', 'D']) assert.ok(Math.abs(r1.get(k).r - r2.get(k).r) < 1e-12);
});

test('se shrinks with more battles', () => {
  const few = fitRatings([...games('A', 'B', 1, 2), ...games('B', 'A', 2, 2)]);
  const many = fitRatings([...games('A', 'B', 1, 20), ...games('B', 'A', 2, 20)]);
  assert.ok(many.get('A').se < few.get('A').se);
  assert.ok(Math.abs(few.get('A').lo - (few.get('A').r - 1.96 * few.get('A').se)) < 1e-12);
});

test('centred, with n and opponents counted; mirrors ignored', () => {
  const b = [...games('A', 'B', 2, 3), ...games('A', 'C', 1, 2), ...games('B', 'C', -1, 4), { id: 'm', left: 'A', right: 'A', winner: 'left', points: 3 }];
  const r = fitRatings(b);
  const mean = [...r.values()].reduce((s, x) => s + x.r, 0) / r.size;
  assert.ok(Math.abs(mean) < 1e-9);
  assert.equal(r.get('A').n, 5);
  assert.equal(r.get('A').opponents, 2);
  assert.equal(r.size, 3);
});

test('disconnected groups stay finite and centred', () => {
  const r = fitRatings([...games('A', 'B', 2, 5), ...games('C', 'D', -1, 5)]);
  for (const v of r.values()) assert.ok(Number.isFinite(v.r) && Number.isFinite(v.se));
  const mean = [...r.values()].reduce((s, x) => s + x.r, 0) / r.size;
  assert.ok(Math.abs(mean) < 1e-9);
});

test('empty battles give an empty map', () => {
  assert.equal(fitRatings([]).size, 0);
});

test('heavily tested opponents barely move', () => {
  const base = [...pool(6, 10)];
  for (let i = 1; i <= 6; i++) base.push(...games('Y', `P${i}`, 2, 24), ...games('Y', `P${i}`, -1, 6));
  for (let i = 1; i <= 6; i++) base.push(...games('Z', `P${i}`, 1, 30));
  base.push(...games('Z', 'Y', -1, 5), ...games('Z', 'Y', 0, 5));
  const before = fitRatings(base);
  const after = fitRatings([...base, ...games('X', 'Y', 2, 10)]);
  const rel = (r) => r.get('Y').r - poolAvg(r, 6);
  assert.ok(rel(before) - rel(after) < 0.1, `${rel(before)} -> ${rel(after)}`);
  assert.ok(after.get('X').r > after.get('Y').r);
});

test('ratingsLeaderboard sorts by rating', () => {
  const state = { battles: [...games('A', 'B', 2, 5), ...games('C', 'B', 1, 5)] };
  const lb = ratingsLeaderboard(state);
  assert.deepEqual(lb.map((x) => x.comboId), ['A', 'C', 'B']);
  assert.ok(lb.every((x) => 'lo' in x && 'hi' in x && 'n' in x));
});

test('ratingsLeaderboard leaves out battles whose combo no longer exists', () => {
  const state = { combos: [{ id: 'A' }, { id: 'B' }], battles: [...games('A', 'B', 2, 5), ...games('A', 'ghost', 1, 3)] };
  const lb = ratingsLeaderboard(state);
  assert.deepEqual(lb.map((x) => x.comboId).sort(), ['A', 'B']);
});

import { fitModel } from '../src/ratings.js';

test('fitModel exposes the inverse matrix: A·A⁻¹ = I and r matches fitRatings up to centring', () => {
  const b = [...games('A', 'B', 2, 4), ...games('B', 'C', 1, 6), ...games('C', 'A', -3, 3)];
  const m = fitModel(b);
  const fr = fitRatings(b);
  const k = m.ids.length;
  // Rebuild A and check A·Ainv ≈ I.
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? LAMBDA : 0)));
  for (const g of b) { const i = m.idx.get(g.left), j = m.idx.get(g.right); A[i][i]++; A[j][j]++; A[i][j]--; A[j][i]--; }
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    let s = 0; for (let t = 0; t < k; t++) s += A[i][t] * m.Ainv[t][j];
    assert.ok(Math.abs(s - (i === j ? 1 : 0)) < 1e-9);
  }
  const mean = m.r.reduce((x, y) => x + y, 0) / k;
  for (const id of m.ids) assert.ok(Math.abs(m.r[m.idx.get(id)] - mean - fr.get(id).r) < 1e-12);
  assert.ok(m.sigma2 >= SIGMA2_FLOOR);
});

test('fitModel extraIds adds an untested combo without moving others', async () => {
  const { fitModel } = await import('../src/ratings.js');
  const battles = [...games('A', 'B', 2, 6), ...games('B', 'C', 1, 4)];
  const base = fitModel(battles);
  const m = fitModel(battles, { extraIds: ['X', 'A'] });
  assert.equal(m.ids.length, 4);
  for (const id of base.ids) assert.ok(Math.abs(base.r[base.idx.get(id)] - m.r[m.idx.get(id)]) < 1e-12, id);
  const ix = m.idx.get('X');
  assert.equal(m.r[ix], 0);
  assert.equal(m.n[ix], 0);
  assert.ok(Math.abs(m.Ainv[ix][ix] - 1 / LAMBDA) < 1e-12);
  const only = fitModel([], { extraIds: ['X'] });
  assert.ok(only && only.ids.length === 1);
});

test('fitModel extraIds leaves sigma2 alone', async () => {
  const { fitModel } = await import('../src/ratings.js');
  const battles = [...games('A', 'B', 2, 6), ...games('B', 'A', 1, 4), ...games('B', 'C', 1, 4), ...games('C', 'A', 3, 3)];
  assert.equal(fitModel(battles, { extraIds: ['X'] }).sigma2, fitModel(battles).sigma2);
});
