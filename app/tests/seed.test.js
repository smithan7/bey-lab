import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../src/seed.js';
import { normalizeCatalog, mergeParts } from '../src/catalog.js';
import { comboId, comboLabel, validateCombo } from '../src/combo.js';
import { pairingScores } from '../src/matchups.js';
import { matchupStats } from '../src/stats.js';
import { makeRng } from '../src/rng.js';

const catalog = normalizeCatalog(JSON.parse(readFileSync(new URL('../data/parts-catalog.json', import.meta.url), 'utf8')));
const NOW = Date.UTC(2026, 10, 6);
const seed = buildSeed(catalog, NOW);
const parts = mergeParts(catalog, seed.userParts, seed.overrides);
const byId = new Map(parts.map((p) => [p.id, p]));
const idByLabel = new Map(seed.combos.map((c) => [comboLabel(c, byId), c.id]));

test('seed has 60 battles and 6 combos', () => {
  assert.equal(seed.battles.length, 60);
  assert.equal(seed.combos.length, 6);
  assert.equal(new Set(seed.combos.map((c) => c.id)).size, 6);
});

test('every seeded combo is valid and has a matching id', () => {
  for (const c of seed.combos) {
    assert.equal(validateCombo(c, byId), null, comboLabel(c, byId));
    assert.equal(c.id, comboId(c));
  }
});

test('combo labels use full names', () => {
  assert.deepEqual([...idByLabel.keys()].sort(), [
    'Cobalt Drake 1-60 Free Flat',
    'Pegasus Blast 2-60 Free Ball',
    'Pegasus Blast 2-60 Pop Out (unverified)',
    'Red Hulk 1-60 Low Rush',
    'Rocket Griffon Hexa',
    'Wizard Rod 2-60 Gear Ball',
  ]);
});

test('Pegasus Blast uses the cx preset', () => {
  const pb = seed.combos.find((c) => comboLabel(c, byId) === 'Pegasus Blast 2-60 Free Ball');
  const preset = catalog.find((p) => p.id === 'blade:pegasus-blast').cxPreset;
  assert.deepEqual(pb.blade, { type: 'cx', ...preset });
});

test('battle ids and timestamps are deterministic', () => {
  assert.equal(seed.battles[0].id, 'seed-1-1');
  assert.equal(seed.battles[59].id, 'seed-6-10');
  seed.battles.forEach((b, k) => assert.equal(b.ts, NOW + k * 60000));
});

const REF = [
  ['Red Hulk 1-60 Low Rush', 'Wizard Rod 2-60 Gear Ball', 2, 1, 7, -0.2],
  ['Red Hulk 1-60 Low Rush', 'Cobalt Drake 1-60 Free Flat', 5, 0, 5, -0.6],
  ['Red Hulk 1-60 Low Rush', 'Pegasus Blast 2-60 Free Ball', 4, 1, 5, 0.1],
  ['Pegasus Blast 2-60 Pop Out (unverified)', 'Wizard Rod 2-60 Gear Ball', 2, 0, 8, -0.7],
  ['Pegasus Blast 2-60 Pop Out (unverified)', 'Cobalt Drake 1-60 Free Flat', 3, 0, 7, -1.0],
  ['Rocket Griffon Hexa', 'Pegasus Blast 2-60 Free Ball', 2, 0, 8, -1.4],
];

REF.forEach(([l, r, w, d, lo, ev], i) => {
  test(`row ${i + 1} reproduces Appendix A W-D-L and EV`, () => {
    const s = matchupStats(pairingScores(seed.battles, idByLabel.get(l), idByLabel.get(r)), { rng: makeRng(1), draws: 2000, raceSims: 10 });
    assert.equal(s.n, 10);
    assert.deepEqual([s.wins, s.draws, s.losses], [w, d, lo]);
    assert.ok(Math.abs(s.ev - ev) < 1e-9, `ev ${s.ev}`);
  });
});

test('finish rules and draw notes', () => {
  const b = (row, i) => seed.battles[(row - 1) * 10 + i - 1];
  assert.deepEqual([b(1, 2).finish, b(1, 2).points, b(1, 2).winner], ['unknown', 2, 'left']);
  assert.deepEqual([b(6, 8).finish, b(6, 8).points, b(6, 8).winner], ['unknown', 2, 'right']);
  assert.deepEqual([b(1, 4).winner, b(1, 4).finish, b(1, 4).points, b(1, 4).note], ['draw', null, 0, 'Red Hulk Burst / Wizard Rod Pocket']);
  assert.deepEqual([b(3, 5).winner, b(3, 5).note], ['draw', '']);
  assert.equal(b(1, 10).finish, 'xtreme');
  assert.equal(b(1, 1).finish, 'spin');
  assert.equal(b(2, 5).finish, 'pocket');
  assert.equal(b(3, 8).finish, 'burst');
});

test('field has the 3 baseline combos as active core', () => {
  assert.equal(seed.field.length, 3);
  assert.ok(seed.field.every((f) => f.active === true && f.core === true));
  assert.deepEqual(seed.field.map((f) => comboLabel(seed.combos.find((c) => c.id === f.comboId), byId)), [
    'Wizard Rod 2-60 Gear Ball', 'Cobalt Drake 1-60 Free Flat', 'Pegasus Blast 2-60 Free Ball',
  ]);
});

test('overrides: Turbo and pegasus pieces owned, Rocket Griffon preferred name', () => {
  for (const id of ['bit:turbo', 'bit:pop-out-unverified', 'lock_chip:pegasus', 'main_blade:blast', 'assist_blade:assault', 'blade:wizard-rod', 'ratchet:1-60', 'bit:hexa']) {
    assert.equal(byId.get(id).owned, true, id);
  }
  assert.equal(byId.get('blade:bullet-griffon').displayName, 'Rocket Griffon');
  assert.equal(seed.userParts[0].id, 'bit:pop-out-unverified');
});
