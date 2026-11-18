import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../src/seed.js';
import { normalizeCatalog, mergeParts } from '../src/catalog.js';
import { comboId, comboLabel, isLegalDeck } from '../src/combo.js';
import { makeRng } from '../src/rng.js';
import {
  candidateCombos, opponentCombos, coverDecks, enumerateLegalDecks,
  rankLineups, decideDiffers, MIN_OPP_DECKS, PREFILTER, OPP_SEED, SCREEN_MATCHES, REFINE_OUTER, REFINE_INNER, TOP_N, LEAD_MIN_GAIN,
} from '../src/lineup.js';

const catalog = normalizeCatalog(JSON.parse(readFileSync(new URL('../data/parts-catalog.json', import.meta.url), 'utf8')));
const seed = buildSeed(catalog);
const seedParts = mergeParts(catalog, seed.userParts, seed.overrides);
const seedById = new Map(seedParts.map((p) => [p.id, p]));
const seedIdByLabel = new Map(seed.combos.map((c) => [comboLabel(c, seedById), c.id]));
const S = (label) => {
  const id = seedIdByLabel.get(label);
  assert.ok(id, `no seed combo ${label}`);
  return id;
};
const FAST = { screenMatches: 200, refineOuter: 40, refineInner: 20 };

test('constants match the global constraints', () => {
  assert.deepEqual([SCREEN_MATCHES, REFINE_OUTER, REFINE_INNER, TOP_N, LEAD_MIN_GAIN], [1000, 200, 50, 5, 0.02]);
});

test('coverDecks covers every id, has no duplicates and is deterministic', () => {
  assert.deepEqual([MIN_OPP_DECKS, PREFILTER, OPP_SEED], [20, 60, 20261118]);
  const ids = 'abcdefghij'.split('');
  const d = coverDecks(ids, makeRng(1));
  assert.equal(d.length, 20);
  for (const id of ids) assert.ok(d.some((t) => t.includes(id)), id);
  const keys = d.map((t) => [...t].sort().join());
  assert.equal(new Set(keys).size, d.length);
  for (const t of d) assert.equal(new Set(t).size, 3);
  assert.deepEqual(coverDecks(ids, makeRng(1)), d);
  const big = Array.from({ length: 80 }, (_, i) => `c${i}`);
  const db = coverDecks(big, makeRng(2));
  assert.ok(db.length >= 27);
  for (const id of big) assert.ok(db.some((t) => t.includes(id)), id);
});

test('coverDecks: 3 ids give one triple, 4 give all 4, fewer than 3 give none', () => {
  assert.equal(coverDecks(['a', 'b', 'c'], makeRng(1)).length, 1);
  assert.equal(coverDecks(['a', 'b', 'c', 'd'], makeRng(1)).length, 4);
  assert.deepEqual(coverDecks(['a', 'b'], makeRng(1)), []);
});

test('opponentCombos: every combo with a battle, mirrors ignored', () => {
  const state = { combos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], battles: [{ left: 'a', right: 'b' }, { left: 'c', right: 'c' }] };
  assert.deepEqual(opponentCombos(state), ['a', 'b']);
});

test('seed: ranks decks with no field rules; ratings cover every tested combo', () => {
  const r = rankLineups(seed, seedParts, { rng: makeRng(7), ...FAST });
  assert.equal(r.tooFew, false);
  assert.equal(r.noLegal, false);
  assert.ok(r.ranked.length > 0);
  const byId = new Map(seed.combos.map((c) => [c.id, c]));
  for (const d of r.ranked) {
    assert.ok(isLegalDeck(d.deck.map((id) => byId.get(id))));
    assert.ok(d.estimatedShare >= 0 && d.estimatedShare <= 1);
  }
  assert.equal(r.ratings.length, opponentCombos(seed).length);
  for (let i = 1; i < r.ratings.length; i++) assert.ok(r.ratings[i - 1].r >= r.ratings[i].r);
  // Baseline combos have never met each other, so decks containing two of them rest partly on estimates.
  assert.ok(r.ranked.some((d) => d.estimatedShare > 0));
});

test('seed: candidates exclude nothing owned and tested; legal decks never pair both Pegasus Blasts', () => {
  const cands = candidateCombos(seed, seedParts);
  assert.equal(cands.length, 6);
  const byId = new Map(seed.combos.map((c) => [c.id, c]));
  const decks = enumerateLegalDecks(cands, byId);
  assert.ok(decks.length > 0);
  for (const d of decks) assert.ok(isLegalDeck(d.map((id) => byId.get(id))));
});

// ---- synthetic states ----

const blade = (id) => ({ type: 'single', bladeId: `blade:${id}` });
const mk = (b, r, bit) => {
  const c = { blade: blade(b), ratchet: `ratchet:${r}`, bit: `bit:${bit}` };
  return { id: comboId(c), ...c };
};
let bid = 0;
// n battles a vs b with scores drawn from `gen(rng)` (score from a's side).
function battlesFor(a, b, n, gen, rng) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = gen(rng);
    out.push({
      id: `syn-${bid++}`, left: a.id, right: b.id,
      winner: s === 0 ? 'draw' : s > 0 ? 'left' : 'right',
      finish: Math.abs(s) === 1 ? 'spin' : Math.abs(s) === 3 ? 'xtreme' : s === 0 ? null : 'burst',
      points: Math.abs(s), ts: i,
    });
  }
  return out;
}
const ownAll = (combos) => {
  const o = {};
  for (const c of combos) for (const p of [c.blade.bladeId, c.ratchet, c.bit]) o[p] = { owned: true };
  return o;
};
const coin = (rng) => (rng() < 0.5 ? 1 : -1);

test('synthetic: combo that always wins +3 tops every ranking; ranked decks are legal', () => {
  const rng = makeRng(11);
  // Field: unowned parts, so not candidates.
  const F = [mk('wizard-arrow', '3-60', 'flat'), mk('leon-claw', '4-60', 'ball'), mk('hells-chain', '4-80', 'high-needle')];
  const X = mk('dran-dagger', '3-80', 'low-flat');
  const C = [X, mk('sphinx-cowl', '5-60', 'high-taper'), mk('dran-buster', '5-80', 'gear-flat'), mk('tyranno-beat', '9-60', 'gear-ball')];
  const clash = mk('croco-crunch', '9-80', 'gear-ball'); // shares a bit with C[3]
  const battles = [];
  for (const f of F) {
    battles.push(...battlesFor(X, f, 10, () => 3, rng));
    for (const c of [...C.slice(1), clash]) battles.push(...battlesFor(c, f, 10, coin, rng));
  }
  const state = {
    userParts: [], overrides: ownAll([...C, clash]), combos: [...F, ...C, clash], battles,
    field: F.map((c) => ({ comboId: c.id, active: true, core: true })),
  };
  const parts = mergeParts(catalog, [], state.overrides);
  assert.equal(candidateCombos(state, parts).length, 5);
  const r = rankLineups(state, parts, { rng: makeRng(5), ...FAST });
  assert.ok(r.ranked.length > 0 && r.ranked.length <= TOP_N);
  const byId = new Map(state.combos.map((c) => [c.id, c]));
  for (const d of r.ranked) {
    assert.ok(isLegalDeck(d.deck.map((id) => byId.get(id))), 'illegal ranked deck');
    for (const t of ['target5', 'target7']) {
      const b = d.best[t];
      assert.ok([0, 1, 2, null].includes(b.lead));
      assert.equal(typeof b.leadGain, 'number');
      if (b.lead == null) assert.deepEqual({ p: b.p, lo: b.lo, hi: b.hi }, d.randomOrder[t]);
      else assert.ok(b.leadGain >= LEAD_MIN_GAIN);
      assert.ok(b.lo <= b.p && b.p <= b.hi);
      assert.ok(d.randomOrder[t].lo <= d.randomOrder[t].p && d.randomOrder[t].p <= d.randomOrder[t].hi);
    }
  }
  for (let i = 1; i < r.ranked.length; i++) assert.ok(r.ranked[i - 1].best.target5.p >= r.ranked[i].best.target5.p);
  assert.ok(r.ranked[0].deck.includes(X.id));
});

test('smoke (sim-driven): Xtreme vs Spin decks; differs agrees across entries', () => {
  const rng = makeRng(23);
  const F = [mk('wizard-arrow', '3-60', 'flat'), mk('leon-claw', '4-60', 'ball'), mk('hells-chain', '4-80', 'high-needle')];
  const B1 = mk('dran-dagger', '3-80', 'low-flat');
  const B2 = mk('sphinx-cowl', '5-60', 'high-taper');
  // High-variance Xtreme combo (EV +0.2) and consistent Spin combo (EV +0.3); they share a bit.
  const XT = mk('dran-buster', '5-80', 'gear-flat');
  const SP = mk('tyranno-beat', '9-60', 'gear-flat');
  const xtreme = (r) => (r < 0.3 ? 3 : -1);
  const spin = (r) => (r < 0.65 ? 1 : -1);
  const battles = [];
  let k = 0;
  for (const f of F) {
    for (const c of [B1, B2]) battles.push(...battlesFor(c, f, 20, coin, rng));
    // stratified draws so the data match the intended rates exactly
    battles.push(...battlesFor(XT, f, 20, () => xtreme(((k++ % 20) + 0.5) / 20), rng));
    battles.push(...battlesFor(SP, f, 20, () => spin(((k++ % 20) + 0.5) / 20), rng));
  }
  const all = [B1, B2, XT, SP];
  const state = {
    userParts: [], overrides: ownAll(all), combos: [...F, ...all], battles,
    field: F.map((c) => ({ comboId: c.id, active: true, core: true })),
  };
  const parts = mergeParts(catalog, [], state.overrides);
  const r = rankLineups(state, parts, { rng: makeRng(9), screenMatches: 1000, refineOuter: 100, refineInner: 40 });
  assert.ok(r.ranked.length >= 2);
  const top = (t) => r.ranked.reduce((a, b) => (b.best[t].p > a.best[t].p ? b : a));
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const differs = !same(top('target5').deck, top('target7').deck);
  // Smoke only: at these sim sizes the Spin combo's deck tops both targets.
  assert.equal(differs, false);
  assert.ok(top('target5').deck.includes(SP.id));
  for (const d of r.ranked) assert.equal(d.differs, differs);
});

// ---- lead decision ----

function leadState(genFor) {
  const rng = makeRng(31);
  const F = [mk('wizard-arrow', '3-60', 'flat'), mk('leon-claw', '4-60', 'ball'), mk('hells-chain', '4-80', 'high-needle')];
  const C = [mk('dran-dagger', '3-80', 'low-flat'), mk('sphinx-cowl', '5-60', 'high-taper'), mk('dran-buster', '5-80', 'gear-flat')];
  const battles = [];
  C.forEach((c, i) => { for (const f of F) battles.push(...battlesFor(c, f, 20, genFor(i), rng)); });
  const state = {
    userParts: [], overrides: ownAll(C), combos: [...F, ...C], battles,
    field: F.map((c) => ({ comboId: c.id, active: true, core: true })),
  };
  return { state, C, parts: mergeParts(catalog, [], state.overrides) };
}

test('lead: a dominant combo (always +2, others always -1) is recommended as lead', () => {
  // (The Task 8 +3/-2 case gains ~0.57 at first to 5 but only ~0.01 at first to 7, so +2/-1 is used to show both targets.)
  const { state, C, parts } = leadState((i) => (i === 0 ? () => 2 : () => -1));
  const r = rankLineups(state, parts, { rng: makeRng(4), ...FAST });
  assert.equal(r.ranked.length, 1);
  const d = r.ranked[0];
  for (const t of ['target5', 'target7']) {
    assert.notEqual(d.best[t].lead, null, t);
    assert.equal(d.deck[d.best[t].lead], C[0].id);
    assert.ok(d.best[t].leadGain >= LEAD_MIN_GAIN);
  }
});

test('lead: symmetric coin-flip data gives no recommended lead', () => {
  let k = 0;
  const alternate = () => (k++ % 2 ? 1 : -1); // exactly 10 wins and 10 losses per pairing
  const { state, parts } = leadState(() => alternate);
  // Reduced sizes: lead and random order share rng streams in playMatch, so noise cancels.
  const r = rankLineups(state, parts, { rng: makeRng(4), ...FAST });
  const d = r.ranked[0];
  for (const t of ['target5', 'target7']) {
    assert.equal(d.best[t].lead, null, t);
    assert.ok(d.best[t].leadGain < LEAD_MIN_GAIN);
    assert.deepEqual({ p: d.best[t].p, lo: d.best[t].lo, hi: d.best[t].hi }, d.randomOrder[t]);
  }
});

// ---- differs noise guard ----

const row = (deck, p5, p7, w = 0.2) => ({
  deck,
  best: { target5: { lead: null, p: p5, lo: p5 - w, hi: p5 + w }, target7: { lead: null, p: p7, lo: p7 - w, hi: p7 + w } },
});

test('decideDiffers: a clear first-to-7 winner differs', () => {
  // se = 0.4/3.92/sqrt(200) = 0.0072; threshold = 2*hypot = 0.0204
  assert.equal(decideDiffers([row(['a', 'b', 'c'], 0.6, 0.55), row(['a', 'b', 'd'], 0.58, 0.6)], { outer: 200 }), true);
});

test('decideDiffers: a within-noise swap does not differ', () => {
  assert.equal(decideDiffers([row(['a', 'b', 'c'], 0.6, 0.55), row(['a', 'b', 'd'], 0.58, 0.56)], { outer: 200 }), false);
});

test('decideDiffers: the same deck on top at both targets does not differ', () => {
  assert.equal(decideDiffers([row(['a', 'b', 'c'], 0.6, 0.6), row(['a', 'b', 'd'], 0.5, 0.5)], { outer: 200 }), false);
  assert.equal(decideDiffers([], { outer: 200 }), false);
});

test('candidateCombos excludes an owned combo with zero battles', () => {
  const extra = mk('cobalt-dragoon', '3-70', 'disk-ball');
  const state = { ...seed, combos: [...seed.combos, extra] };
  const parts = mergeParts(catalog, seed.userParts, { ...seed.overrides, ...ownAll([extra]) });
  const cands = candidateCombos(state, parts);
  assert.ok(!cands.includes(extra.id));
  assert.equal(cands.length, 6);
});

test('tooFew and noLegal flags', () => {
  const A = mk('dran-dagger', '3-80', 'low-flat'), B = mk('sphinx-cowl', '5-60', 'high-taper'), C = mk('dran-dagger', '5-80', 'gear-flat');
  const rng = makeRng(3);
  const two = { combos: [A, B], battles: battlesFor(A, B, 4, coin, rng), field: [] };
  const p2 = mergeParts(catalog, [], ownAll([A, B]));
  const r2 = rankLineups(two, p2, { rng: makeRng(1), ...FAST });
  assert.equal(r2.tooFew, true);
  assert.deepEqual(r2.ranked, []);
  // A and C share a blade, so no legal deck of three exists.
  const three = { combos: [A, B, C], battles: [...battlesFor(A, B, 4, coin, rng), ...battlesFor(C, B, 4, coin, rng)], field: [] };
  const r3 = rankLineups(three, mergeParts(catalog, [], ownAll([A, B, C])), { rng: makeRng(1), ...FAST });
  assert.equal(r3.tooFew, false);
  assert.equal(r3.noLegal, true);
  assert.deepEqual(r3.ranked, []);
});

// ---- partial data ----

// Pool of 8 owned combos with distinct parts; P[0] is clearly the strongest.
function partialPool() {
  const names = [['wizard-arrow', '3-60', 'flat'], ['leon-claw', '4-60', 'ball'], ['hells-chain', '4-80', 'high-needle'],
    ['sphinx-cowl', '5-60', 'high-taper'], ['dran-buster', '5-80', 'gear-flat'], ['tyranno-beat', '9-60', 'gear-ball'],
    ['knight-shield', '3-80', 'needle'], ['shark-edge', '1-60', 'low-flat']];
  const P = names.map((n) => mk(...n));
  const rng = makeRng(41);
  const battles = [];
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const gen = i === 0 ? () => (rng() < 0.75 ? 2 : -1) : coin;
    battles.push(...battlesFor(P[i], P[j], 8, gen, rng));
  }
  return { P, battles };
}

test('a partly tested strong combo reaches the #1 deck', () => {
  const { P, battles } = partialPool();
  const X = mk('cobalt-dragoon', '2-70', 'rush');
  const state = { combos: [...P, X], battles: [...battles, ...battlesFor(X, P[0], 10, () => 2, makeRng(1))], field: [] };
  const r = rankLineups(state, mergeParts(catalog, [], ownAll([...P, X])), { rng: makeRng(5), ...FAST });
  assert.ok(r.ranked[0].deck.includes(X.id), 'X should be in the best deck');
  assert.ok(r.ranked[0].estimatedShare > 0);
  // Per-member shares expose X even when the deck-wide share looks fine.
  const i = r.ranked[0].deck.indexOf(X.id);
  assert.equal(r.ranked[0].memberEstimated.length, 3);
  assert.ok(r.ranked[0].memberEstimated[i] > 0.5, String(r.ranked[0].memberEstimated[i]));
  for (const [j, v] of r.ranked[0].memberEstimated.entries()) if (j !== i) assert.ok(v < 0.5);
});

test('two lucky battles do not out-rate an established top combo, and leave a wide range', () => {
  const { P, battles } = partialPool();
  const X = mk('cobalt-dragoon', '2-70', 'rush');
  const state = { combos: [...P, X], battles: [...battles, ...battlesFor(X, P[7], 2, () => 3, makeRng(1))], field: [] };
  const r = rankLineups(state, mergeParts(catalog, [], ownAll([...P, X])), { rng: makeRng(5), ...FAST });
  const row = (id) => r.ratings.find((x) => x.comboId === id);
  assert.equal(r.ratings[0].comboId, P[0].id);
  assert.ok(row(X.id).hi - row(X.id).lo > 2 * (row(P[0].id).hi - row(P[0].id).lo) - 0.2);
});

test('estimatedShare counts untested non-mirror pairings only', () => {
  // 4 combos; only A-B and C-D tested. Opponent triples = all 4 triples of {A,B,C,D}.
  const A = mk('wizard-arrow', '3-60', 'flat'), B = mk('leon-claw', '4-60', 'ball'), C = mk('hells-chain', '4-80', 'high-needle'), D = mk('sphinx-cowl', '5-60', 'high-taper');
  const rng = makeRng(9);
  const state = { combos: [A, B, C, D], battles: [...battlesFor(A, B, 6, coin, rng), ...battlesFor(C, D, 6, coin, rng)], field: [] };
  const r = rankLineups(state, mergeParts(catalog, [], ownAll([A, B, C, D])), { rng: makeRng(2), ...FAST });
  const deck = r.ranked.find((d) => ['A', 'B', 'C'].every((_, i) => d.deck.includes([A, B, C][i].id)));
  assert.ok(deck, 'deck A/B/C ranked');
  // Count by hand over the 4 opponent triples (each has 3 combos): per member, non-mirror cells and untested ones.
  const tested = new Set([[A.id, B.id].sort().join(), [C.id, D.id].sort().join()]);
  let cells = 0, est = 0;
  for (const t of coverDecks([A.id, B.id, C.id, D.id], makeRng(OPP_SEED))) for (const a of deck.deck) for (const b of t) {
    if (a === b) continue;
    cells++;
    if (!tested.has([a, b].sort().join())) est++;
  }
  assert.ok(Math.abs(deck.estimatedShare - est / cells) < 1e-12);
  for (const d of r.ranked) for (const t of ['target5', 'target7']) assert.ok(Number.isFinite(d.best[t].p));
});

test('ranking is deterministic for a seed', () => {
  const { P, battles } = partialPool();
  const state = { combos: P, battles, field: [] };
  const parts = mergeParts(catalog, [], ownAll(P));
  const a = rankLineups(state, parts, { rng: makeRng(5), ...FAST });
  const b = rankLineups(state, parts, { rng: makeRng(5), ...FAST });
  assert.deepEqual(a, b);
});

test('performance: 80 combos and 600 battles rank in time with default sizes', () => {
  const names = ['wizard-arrow', 'leon-claw', 'hells-chain', 'sphinx-cowl', 'dran-buster', 'tyranno-beat', 'knight-shield', 'shark-edge', 'cobalt-dragoon', 'dran-dagger'];
  const rats = ['1-60', '2-60', '3-60', '4-60', '5-60', '3-80', '4-80', '5-80'];
  const bits = ['flat', 'ball', 'needle', 'high-needle', 'gear-flat', 'gear-ball', 'low-flat', 'rush'];
  const C = [];
  names.forEach((b, i) => rats.forEach((r, j) => C.push(mk(b, r, bits[(i + j) % bits.length]))));
  const rng = makeRng(77);
  const battles = [];
  for (let i = 0; i < 600; i++) {
    const a = C[Math.floor(rng() * C.length)], b = C[Math.floor(rng() * C.length)];
    if (a.id !== b.id) battles.push(...battlesFor(a, b, 1, coin, rng));
  }
  // Own a spread of bits so legal decks exist: vary the bit per blade.
  const owned = ownAll(C);
  const state = { combos: C, battles, field: [] };
  const t0 = Date.now();
  const res = rankLineups(state, mergeParts(catalog, [], owned), { rng: makeRng(1) });
  const ms = Date.now() - t0;
  assert.equal(res.ranked.length, TOP_N);
  assert.ok(ms < 8000, `${ms} ms`);
});
