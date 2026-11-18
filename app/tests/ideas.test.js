import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog, mergeParts, withReference } from '../src/catalog.js';
import { comboId, comboLabel, comboParts, validateCombo } from '../src/combo.js';
import { partScore, comboIdeas, variantsFor, partsToFind, TIER_VALUE } from '../src/ideas.js';

const raw = JSON.parse(readFileSync(new URL('../data/parts-catalog.json', import.meta.url), 'utf8'));
const ref = JSON.parse(readFileSync(new URL('../data/reference.json', import.meta.url), 'utf8'));
const catalog = withReference(normalizeCatalog(raw), ref);
const own = (ids) => mergeParts(catalog, [], Object.fromEntries(ids.map((id) => [id, { owned: true }])));
const mk = (b, r, bit) => { const c = { blade: { type: 'single', bladeId: b }, ratchet: r, bit }; return { ...c, id: comboId(c) }; };

test('tier values and part scores', () => {
  assert.deepEqual(['X', 'S', 'A', 'B', 'C'].map((t) => TIER_VALUE[t]), [1, 0.8, 0.6, 0.4, 0.2]);
  const parts = own([]);
  const byId = new Map(parts.map((p) => [p.id, p]));
  // On an attack blade, Low Rush (attack bit, S tier) beats Ball (stamina bit).
  assert.ok(partScore(byId.get('bit:low-rush'), 'attack') > partScore(byId.get('bit:ball'), 'attack'));
  // On a stamina blade, Ball's stamina counts for more than on an attack blade.
  assert.ok(partScore(byId.get('bit:ball'), 'stamina') > partScore(byId.get('bit:ball'), 'attack'));
  // 1-60 (X tier) beats an untiered ratchet.
  const r0 = parts.find((p) => p.kind === 'ratchet' && !p.meta);
  if (r0) assert.ok(partScore(byId.get('ratchet:1-60'), 'attack') > partScore(r0, 'attack'));
});

test('comboIdeas: owned parts only, new combos only, one per blade, best first, with reasons', () => {
  const ownedIds = ['blade:shark-scale', 'blade:wizard-rod', 'ratchet:1-70', 'ratchet:1-60', 'ratchet:4-60', 'bit:low-rush', 'bit:hexa', 'bit:ball'];
  const parts = own(ownedIds);
  const existing = mk('blade:shark-scale', 'ratchet:1-60', 'bit:hexa');
  const state = { combos: [existing], battles: [] };
  const ideas = comboIdeas(state, parts, { limit: 5, reference: ref });
  assert.ok(ideas.length >= 2);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const blades = new Set();
  for (const i of ideas) {
    assert.equal(validateCombo(i.combo, byId), null);
    assert.ok(comboParts(i.combo).every((p) => ownedIds.includes(p)), comboLabel(i.combo, byId));
    assert.notEqual(i.combo.id, existing.id);
    assert.ok(!blades.has(i.combo.blade.bladeId), 'one idea per blade');
    blades.add(i.combo.blade.bladeId);
    assert.ok(i.reason.length > 20);
  }
  for (let k = 1; k < ideas.length; k++) assert.ok(ideas[k - 1].score >= ideas[k].score);
  // Shark Scale 1-70 Low Rush is a top WBO combo and fully owned: it should be the Shark Scale idea.
  const shark = ideas.find((i) => i.combo.blade.bladeId === 'blade:shark-scale');
  assert.equal(shark.combo.ratchet, 'ratchet:1-70');
  assert.equal(shark.combo.bit, 'bit:low-rush');
  assert.match(shark.reason, /top WBO combo/);
});

test('variantsFor: three new owned variants of a combo, keeping the blade, at least one single-part swap', () => {
  const ownedIds = ['blade:wizard-rod', 'ratchet:1-60', 'ratchet:4-60', 'ratchet:9-60', 'ratchet:5-70', 'bit:hexa', 'bit:ball', 'bit:low-rush', 'bit:free-ball'];
  const parts = own(ownedIds);
  const base = mk('blade:wizard-rod', 'ratchet:4-60', 'bit:ball');
  const tried = mk('blade:wizard-rod', 'ratchet:1-60', 'bit:ball');
  const state = { combos: [base, tried], battles: [] };
  const vs = variantsFor(base, state, parts, { reference: ref });
  assert.equal(vs.length, 3);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const ids = new Set(vs.map((v) => v.combo.id));
  assert.equal(ids.size, 3);
  for (const v of vs) {
    assert.equal(v.combo.blade.bladeId, 'blade:wizard-rod');
    assert.ok(![base.id, tried.id].includes(v.combo.id));
    assert.equal(validateCombo(v.combo, byId), null);
    assert.ok(comboParts(v.combo).every((p) => ownedIds.includes(p)));
    assert.ok(v.reason.length > 10);
  }
  assert.ok(vs.some((v) => (v.combo.ratchet !== base.ratchet) !== (v.combo.bit !== base.bit)), 'a single-part swap');
  for (let i = 1; i < vs.length; i++) assert.ok(vs[i - 1].score >= vs[i].score);
  // Wizard Rod 1-60 Hexa is beywatch's best Wizard Rod combo; with 1-60 and Hexa owned it should appear.
  assert.ok(vs.some((v) => v.combo.ratchet === 'ratchet:1-60' && v.combo.bit === 'bit:hexa'));
});

test('idea reasons name the combo and use the right article', () => {
  const parts = own(['blade:shark-scale', 'ratchet:4-60', 'bit:low-rush']);
  const [idea] = comboIdeas({ combos: [], battles: [] }, parts, { reference: ref });
  assert.match(idea.reason, /^Try Shark Scale 4-60 Low Rush\. /);
  assert.match(idea.reason, /an attack blade\.$/);
});

test('the fit line only claims a good fit when the stats suit the blade type', () => {
  const parts = own(['blade:shark-scale', 'ratchet:4-60', 'bit:low-rush', 'bit:ball']);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const base = mk('blade:shark-scale', 'ratchet:4-60', 'bit:low-rush');
  const vs = variantsFor(base, { combos: [base] }, parts, { reference: ref, k: 5 });
  const ball = vs.find((v) => v.combo.bit === 'bit:ball');
  assert.ok(ball, vs.map((v) => comboLabel(v.combo, byId)).join());
  assert.match(ball.reason, /stats don't lean towards an attack blade/);
});

test('partsToFind: unowned parts that improve your top combos, best first', () => {
  const ownedIds = ['blade:wizard-rod', 'blade:shark-scale', 'ratchet:4-60', 'ratchet:1-60', 'bit:hexa', 'bit:point'];
  const parts = own(ownedIds);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const wiz = mk('blade:wizard-rod', 'ratchet:4-60', 'bit:hexa');
  const shark = mk('blade:shark-scale', 'ratchet:1-60', 'bit:point');
  const ratings = new Map([[shark.id, { r: 1.2 }], [wiz.id, { r: 0.8 }]]);
  const list = partsToFind({ combos: [wiz, shark], battles: [] }, parts, { reference: ref, ratings });
  assert.ok(list.length >= 3);
  for (const x of list) {
    assert.ok(!x.part.owned, x.part.id);
    assert.ok(x.gain > 0);
    assert.equal(validateCombo(x.combo, byId), null);
    assert.ok(comboParts(x.combo).every((id) => id === x.part.id || ownedIds.includes(id)), comboLabel(x.combo, byId));
    assert.ok(comboParts(x.combo).includes(x.part.id));
    assert.match(x.reason, /^Would (make|let you build) /);
  }
  const groups = [list.filter((x) => x.part.kind !== 'blade'), list.filter((x) => x.part.kind === 'blade')];
  assert.deepEqual([...groups[0], ...groups[1]], list, 'ratchets and bits first, then blades');
  for (const g of groups) {
    assert.ok(g.length <= 8);
    for (let i = 1; i < g.length; i++) assert.ok(g[i - 1].gain >= g[i].gain);
    const per = new Map();
    for (const x of g) per.set(x.from.id, (per.get(x.from.id) ?? 0) + 1);
    assert.ok([...per.values()].every((n) => n <= 2), 'at most 2 per combo');
  }
  // A better ratchet than 4-60 for Wizard Rod Hexa should be on the list (e.g. an S-tier ratchet).
  assert.ok(list.some((x) => x.part.kind === 'ratchet' && x.from.id === wiz.id), list.map((x) => x.part.id).join());
  // Owning nothing tested → nothing to compare against.
  assert.deepEqual(partsToFind({ combos: [], battles: [] }, parts, { reference: ref }), []);
});
