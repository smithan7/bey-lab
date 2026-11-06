import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../src/seed.js';
import { normalizeCatalog, mergeParts } from '../src/catalog.js';
import { comboId, comboLabel, isLegalDeck } from '../src/combo.js';
import { makeRng } from '../src/rng.js';
import {
  candidateCombos, fieldCombos, fieldDecks, enumerateLegalDecks, missingPairings,
  rankLineups, comboLeaderboard, SCREEN_MATCHES, REFINE_OUTER, REFINE_INNER, TOP_N,
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
  assert.deepEqual([SCREEN_MATCHES, REFINE_OUTER, REFINE_INNER, TOP_N], [1000, 200, 50, 5]);
});

test('fieldDecks: one deck for 3, all 3-subsets for more, none for fewer', () => {
  assert.deepEqual(fieldDecks(['a', 'b', 'c']), [['a', 'b', 'c']]);
  assert.equal(fieldDecks(['a', 'b', 'c', 'd']).length, 4);
  assert.equal(fieldDecks(['a', 'b', 'c', 'd', 'e']).length, 10);
  assert.deepEqual(fieldDecks(['a', 'b']), []);
});

test('fieldCombos returns only active field entries', () => {
  const state = { field: [{ comboId: 'a', active: true }, { comboId: 'b', active: false }, { comboId: 'c', active: true }] };
  assert.deepEqual(fieldCombos(state), ['a', 'c']);
});

test('missingPairings excludes mirrors and lists each pairing once', () => {
  const battles = [{ left: 'x', right: 'a', winner: 'left', points: 1 }];
  const m = missingPairings(['a', 'b', 'x'], ['a', 'b'], battles);
  // a-a and b-b are mirrors; a-b appears once; x-a has data
  const keys = m.map((p) => [...p].sort().join('/')).sort();
  assert.deepEqual(keys, ['a/b', 'b/x']);
});

test('seed: nothing ranked, blocked decks are legal and list baseline pairings', () => {
  const r = rankLineups(seed, seedParts, { rng: makeRng(7), ...FAST });
  assert.equal(r.ranked.length, 0);
  assert.equal(r.fieldLegal, false);
  assert.ok(r.blocked.length > 0 && r.blocked.length <= 5);
  const pb = [S('Pegasus Blast 2-60 Free Ball'), S('Pegasus Blast 2-60 Pop Out (unverified)')];
  const byId = new Map(seed.combos.map((c) => [c.id, c]));
  for (const b of r.blocked) {
    assert.ok(!(b.deck.includes(pb[0]) && b.deck.includes(pb[1])), 'blocked deck has both Pegasus Blast combos');
    assert.ok(isLegalDeck(b.deck.map((id) => byId.get(id))));
    assert.ok(b.missing.length > 0);
  }
  for (let i = 1; i < r.blocked.length; i++) assert.ok(r.blocked[i - 1].missing.length <= r.blocked[i].missing.length);
  const wr = S('Wizard Rod 2-60 Gear Ball'), cd = S('Cobalt Drake 1-60 Free Flat');
  assert.ok(r.blocked.some((b) => b.missing.some(([a, c]) => (a === wr && c === cd) || (a === cd && c === wr))));
});

test('seed: candidates exclude nothing owned and tested; legal decks never pair both Pegasus Blasts', () => {
  const cands = candidateCombos(seed, seedParts);
  assert.equal(cands.length, 6);
  const byId = new Map(seed.combos.map((c) => [c.id, c]));
  const decks = enumerateLegalDecks(cands, byId);
  assert.ok(decks.length > 0);
  for (const d of decks) assert.ok(isLegalDeck(d.map((id) => byId.get(id))));
});

test('seed: leaderboard row for Red Hulk 1-60 Low Rush', () => {
  const lb = comboLeaderboard(seed, { rng: makeRng(3) });
  const row = lb.find((r) => r.comboId === S('Red Hulk 1-60 Low Rush'));
  assert.ok(row);
  assert.ok(Math.abs(row.ev - -0.233) < 0.001, `ev ${row.ev}`);
  assert.equal(row.tested, 3);
  assert.equal(row.of, 3);
  assert.equal(row.n, 30);
  assert.ok(row.evCI[0] < row.ev && row.ev < row.evCI[1]);
  for (let i = 1; i < lb.length; i++) assert.ok(lb[i - 1].ev >= lb[i].ev);
  // Baseline combos have no battles against other field combos yet, so they have no row.
  assert.equal(lb.find((r) => r.comboId === S('Wizard Rod 2-60 Gear Ball')), undefined);
  const po = lb.find((r) => r.comboId === S('Pegasus Blast 2-60 Pop Out (unverified)'));
  assert.deepEqual([po.tested, po.of, po.n], [2, 3, 20]);
  const rg = lb.find((r) => r.comboId === S('Rocket Griffon Hexa'));
  assert.deepEqual([rg.tested, rg.of, rg.n], [1, 3, 10]);
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
  assert.equal(r.fieldLegal, true);
  assert.ok(r.ranked.length > 0 && r.ranked.length <= TOP_N);
  const byId = new Map(state.combos.map((c) => [c.id, c]));
  for (const d of r.ranked) {
    assert.ok(isLegalDeck(d.deck.map((id) => byId.get(id))), 'illegal ranked deck');
    for (const t of ['target5', 'target7']) {
      const b = d.best[t];
      assert.ok([0, 1, 2].includes(b.lead));
      assert.ok(b.lo <= b.p && b.p <= b.hi);
      assert.ok(d.randomOrder[t].lo <= d.randomOrder[t].p && d.randomOrder[t].p <= d.randomOrder[t].hi);
    }
  }
  for (let i = 1; i < r.ranked.length; i++) assert.ok(r.ranked[i - 1].best.target5.p >= r.ranked[i].best.target5.p);
  assert.ok(r.ranked[0].deck.includes(X.id));
  assert.deepEqual(r.blocked, []);
});

test('synthetic: differs matches whether the best first-to-5 and first-to-7 decks differ', () => {
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
  // At these sim sizes the Spin combo's deck tops both targets; `differs` must agree either way.
  assert.equal(differs, false);
  assert.ok(top('target5').deck.includes(SP.id));
  for (const d of r.ranked) assert.equal(d.differs, differs);
});
