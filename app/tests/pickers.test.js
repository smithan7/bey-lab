import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../src/seed.js';
import { normalizeCatalog, mergeParts } from '../src/catalog.js';
import { comboLabel } from '../src/combo.js';
import { recentCombos } from '../src/ui/pickers.js';
import { logReadout } from '../src/ui/log.js';

const catalog = normalizeCatalog(JSON.parse(readFileSync(new URL('../data/parts-catalog.json', import.meta.url), 'utf8')));
const seed = buildSeed(catalog);
const byId = new Map(mergeParts(catalog, seed.userParts, seed.overrides).map((p) => [p.id, p]));
const state = { combos: seed.combos, battles: seed.battles };
const idOf = (label) => seed.combos.find((c) => comboLabel(c, byId) === label).id;

test('recentCombos: most recently battled first', () => {
  const r = recentCombos(state);
  assert.deepEqual(new Set(r.slice(0, 2)), new Set([idOf('Rocket Griffon Hexa'), idOf('Pegasus Blast 2-60 Free Ball')]));
  assert.equal(new Set(r).size, r.length);
  assert.equal(recentCombos(state, 3).length, 3);
});

test('recentCombos: unbattled combos follow, unknown ids are dropped', () => {
  const extra = { id: 'single:x|-|bit:hexa', blade: { type: 'single', bladeId: 'blade:x' }, ratchet: null, bit: 'bit:hexa' };
  const r = recentCombos({ combos: [...seed.combos, extra], battles: seed.battles }, 20);
  assert.equal(r.at(-1), extra.id);
  assert.deepEqual(recentCombos({ combos: [], battles: seed.battles }), []);
});

test('logReadout: Red Hulk vs Wizard Rod', () => {
  const r = logReadout(state, idOf('Red Hulk 1-60 Low Rush'), idOf('Wizard Rod 2-60 Gear Ball'));
  assert.equal(r.record, '2-1-7');
  assert.equal(r.batchCount, 0);
  assert.equal(r.n, 10);
  assert.ok(r.ev < 0 && r.evCI[0] < r.ev && r.ev < r.evCI[1]);
  assert.ok(r.pEvNeg > 0.5 && r.pEvNeg <= 1);
});

test('logReadout: no data is unknown, partial batch counts', () => {
  const a = idOf('Red Hulk 1-60 Low Rush'), b = idOf('Rocket Griffon Hexa');
  const r = logReadout(state, a, b);
  assert.equal(r.n, 0); assert.equal(r.ev, null); assert.equal(r.pEvNeg, null);
  const s2 = { ...state, battles: [...state.battles, { id: 'z', left: a, right: b, winner: 'left', finish: 'spin', points: 1, ts: 1 }] };
  assert.equal(logReadout(s2, a, b).batchCount, 1);
});
