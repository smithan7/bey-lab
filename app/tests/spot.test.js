import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../src/seed.js';
import { normalizeCatalog, mergeParts } from '../src/catalog.js';
import { blockingParts, comboLabel, comboParts } from '../src/combo.js';
import { fitModel } from '../src/ratings.js';
import { ratingShift, UPSET_MIN } from '../src/suggest.js';
import { enumerateLegalDecks, candidateCombos } from '../src/lineup.js';
import { makeRng } from '../src/rng.js';
import { spotTests, spotStatus, upperEnvelope } from '../src/spot.js';

const catalog = normalizeCatalog(JSON.parse(readFileSync(new URL('../data/parts-catalog.json', import.meta.url), 'utf8')));
const seed = buildSeed(catalog);
const parts = mergeParts(catalog, seed.userParts, seed.overrides);
const byId = new Map(parts.map((p) => [p.id, p]));
const label = (c) => comboLabel(c, byId);

// seed.combos order: Wizard Rod 2-60 Gear Ball, Cobalt Drake 1-60 Free Flat, Pegasus Blast 2-60 Free Ball,
// Red Hulk, Pop-out, Rocket Griffon. Wizard Rod and Pegasus Blast share the 2-60 ratchet.
const [W, C, P, H, O, G] = seed.combos.slice(0, 6).map((c) => c.id);
let bn = 0;
const bat = (left, right, pts) => ({
  id: `s${bn++}`, left, right, winner: pts > 0 ? 'left' : 'right',
  finish: Math.abs(pts) === 3 ? 'xtreme' : Math.abs(pts) === 2 ? 'pocket' : 'spin', points: Math.abs(pts), note: '', ts: bn,
});
const many = (l, r, list) => list.map((p) => bat(l, r, p));
const rep = (l, r, pts, n) => many(l, r, Array(n).fill(pts));
const mkState = (battles) => ({ ...seed, battles });

const lookState = () => mkState([
  ...many(W, C, [1, 1, -1, 2, 1, -1, 1, 1]), ...many(W, G, [2, 1, 1, -1, 1, 1]), ...many(C, G, [1, -1, 1, -1, 1, -1]),
  ...many(H, W, [1, -2]), ...many(O, C, [-1, -1, 1, -2, -1, -1, -1, -2, -1, 1]), ...many(P, G, [1, -1, -1, 1, -1, 1, -1, -1]),
]);
// W, C and G beat H and O hard over many battles; the deck is settled.
const settled = () => mkState([
  ...rep(W, H, 3, 20), ...rep(C, H, 3, 20), ...rep(G, H, 3, 20),
  ...rep(W, O, 3, 20), ...rep(C, O, 3, 20), ...rep(G, O, 3, 20),
  ...many(W, C, [1, -1, 1, -1]), ...many(C, G, [1, -1, 1, -1]), ...many(G, W, [1, -1, 1, -1]),
]);

test('envelope keeps the higher of two lines whose slopes differ only by rounding', () => {
  const env = upperEnvelope([{ a: 1, b: -1e-17, tag: 'low' }, { a: 10, b: 1e-17, tag: 'high' }]);
  assert.deepEqual(env.map((s) => s.tag), ['high']);
});

test('unknown combo → null', () => {
  assert.equal(spotTests(lookState(), parts, 'nope'), null);
});

test('chance of a flip matches brute force', () => {
  const st = lookState();
  const res = spotTests(st, parts, H, { k: 10 });
  assert.ok(res.tests.length > 0);
  const model = fitModel(st.battles, { extraIds: [H] });
  const combosById = new Map(st.combos.map((c) => [c.id, c]));
  const cands = [...new Set([...candidateCombos(st, parts), H])];
  const decks = enumerateLegalDecks(cands, combosById);
  const score = (r, d) => d.reduce((s, id) => s + r[model.idx.get(id)], 0);
  const best = (r) => decks.reduce((x, d) => (score(r, d) > score(r, x) ? d : x));
  const inNow = best(model.r).includes(H);
  assert.equal(res.status, inNow ? 'in' : 'out');
  const rng = makeRng(11);
  for (const t of res.tests.slice(0, 3)) {
    const i = model.idx.get(H), j = model.idx.get(t.b);
    const q = model.Ainv[i][i] - 2 * model.Ainv[i][j] + model.Ainv[j][j];
    const mu = model.r[i] - model.r[j];
    const sd = Math.sqrt(model.sigma2 * (1 / 10 + q));
    let flips = 0;
    const N = 20000;
    for (let k = 0; k < N; k++) {
      const z = Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());
      if (best(ratingShift(model, H, t.b, 10, mu + sd * z)).includes(H) !== inNow) flips++;
    }
    assert.ok(Math.abs(flips / N - t.p) < 0.02, `${label(combosById.get(t.b))}: brute ${flips / N} vs ${t.p}`);
  }
});

test('only runnable opponents: tested, owned, not blocking, not itself', () => {
  const owned = new Set(parts.filter((p) => p.owned).map((p) => p.id));
  for (const st of [lookState(), settled()]) {
    const tested = new Set(st.battles.flatMap((b) => [b.left, b.right]));
    for (const x of [W, C, P, H, O, G]) {
      const res = spotTests(st, parts, x, { k: 10 });
      const cx = st.combos.find((c) => c.id === x);
      for (const t of res.tests) {
        const cb = st.combos.find((c) => c.id === t.b);
        assert.notEqual(t.b, x);
        assert.ok(tested.has(t.b));
        assert.ok(comboParts(cb).every((p) => owned.has(p)));
        assert.equal(blockingParts(cx, cb, byId).length, 0);
      }
    }
  }
});

test('ranked by chance, then the "unlikely" fallback', () => {
  const res = spotTests(lookState(), parts, H, { k: 10 });
  const likely = res.tests.filter((t) => t.p >= UPSET_MIN);
  for (let i = 1; i < likely.length; i++) assert.ok(likely[i - 1].p >= likely[i].p);
  assert.ok(res.tests.findIndex((t) => t.p < UPSET_MIN) === -1 || res.tests.slice(res.tests.findIndex((t) => t.p < UPSET_MIN)).every((t) => t.p < UPSET_MIN));
});

test('a combo far below the line gets the fallback', () => {
  const res = spotTests(settled(), parts, O);
  assert.equal(res.status, 'out');
  assert.ok(res.tests.length > 0);
  for (const t of res.tests) {
    assert.ok(t.p < UPSET_MIN);
    assert.match(t.reason, /^Unlikely/);
  }
});

test('a deck member reports in', () => {
  const res = spotTests(settled(), parts, W);
  assert.equal(res.status, 'in');
  assert.match(spotStatus(res, nameIn(settled()), byId), /^In your best deck \(rated #\d of \d+\)/);
});
const nameIn = (st) => (id) => label(st.combos.find((c) => c.id === id));

test('an untested combo still gets suggestions', () => {
  const st = mkState(settled().battles.filter((b) => b.left !== P && b.right !== P));
  const res = spotTests(st, parts, P);
  assert.equal(res.untested, true);
  assert.ok(res.tests.length > 0 && res.tests.length <= 3);
  assert.match(spotStatus(res, nameIn(st), byId), /Not tested yet/);
});

test('rated above a deck member but sharing a part → blockedBy', () => {
  // Wizard Rod best, Pegasus Blast next, but both need 2-60.
  const st = mkState([
    ...rep(W, H, 3, 15), ...rep(P, H, 2, 15), ...rep(C, H, 1, 15), ...rep(G, H, 1, 15),
    ...rep(W, O, 3, 15), ...rep(P, O, 2, 15), ...rep(C, O, 1, 15), ...rep(G, O, 1, 15),
    ...many(W, P, [1, 1, 1, -1]),
  ]);
  const res = spotTests(st, parts, P);
  assert.equal(res.status, 'out');
  assert.equal(res.rank, 2);
  assert.ok(res.blockedBy.some((x) => x.id === W && x.parts.length >= 1));
  const text = spotStatus(res, nameIn(st), byId);
  assert.match(text, /^Rated #2, but it shares 2-60 with Wizard Rod/);
});

test('tiny pool does not throw', () => {
  const st = mkState(rep(W, C, 1, 4));
  const res = spotTests(st, parts, W);
  assert.equal(res.status, 'out');
  assert.ok(Array.isArray(res.tests));
});

test('in the deck only because its parts count as owned → "Would make"', () => {
  const res = { x: W, status: 'in', rank: 2, rated: 5, untested: false, notOwned: true, blockedBy: [], tests: [] };
  assert.match(spotStatus(res, nameIn(settled()), byId), /^Would make your best deck \(rated #2 of 5\) once all of Wizard Rod 2-60 Gear Ball's parts are marked as owned\.$/);
});
