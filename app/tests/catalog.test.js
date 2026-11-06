import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PART_KINDS, normalizeCatalog, mergeParts, searchParts } from '../src/catalog.js';

const raw = JSON.parse(readFileSync(new URL('../data/parts-catalog.json', import.meta.url), 'utf8'));
const parts = normalizeCatalog(raw);
const count = (k) => parts.filter((p) => p.kind === k).length;

test('PART_KINDS lists all kinds', () => {
  assert.deepEqual(PART_KINDS, ['blade', 'ratchet', 'bit', 'lock_chip', 'main_blade', 'over_blade', 'metal_blade', 'assist_blade']);
});

test('real catalog counts', () => {
  assert.equal(count('blade'), 159);
  assert.equal(count('ratchet'), 38);
  assert.equal(count('bit'), 55);
  assert.equal(count('lock_chip'), 31);
  assert.equal(count('main_blade'), 16);
  assert.equal(count('over_blade'), 8);
  assert.equal(count('metal_blade'), 8);
  assert.equal(count('assist_blade'), 19);
});

test('built-in ratchet blade and alt-name search', () => {
  const b = parts.find((p) => p.id === 'blade:bullet-griffon');
  assert.equal(b.builtInRatchet, true);
  assert.equal(searchParts(parts, 'Rocket Griffon')[0].id, 'blade:bullet-griffon');
});

test('ratchet-integrated bit', () => {
  assert.equal(parts.find((p) => p.id === 'bit:turbo').ratchetIntegrated, true);
});

test('cx preset', () => {
  assert.deepEqual(parts.find((p) => p.id === 'blade:pegasus-blast').cxPreset, {
    lockChip: 'lock_chip:pegasus', mainBlade: 'main_blade:blast', overBlade: null, metalBlade: null, assistBlade: 'assist_blade:assault',
  });
});

test('every CX component resolves to an existing part', () => {
  const ids = new Set(parts.map((p) => p.id));
  const bad = [];
  for (const p of parts) {
    if (!p.cxPreset) continue;
    for (const [k, v] of Object.entries(p.cxPreset)) if (v !== null && !ids.has(v)) bad.push(`${p.id} ${k} -> ${v}`);
  }
  assert.deepEqual(bad, []);
});

test('Wand Wizard finds Wizard Rod', () => {
  assert.equal(searchParts(parts, 'Wand Wizard')[0].id, 'blade:wizard-rod');
});

test('mergeParts keeps user parts and applies overrides', () => {
  const user = [{ id: 'bit:pop-out-unverified', kind: 'bit', name: 'Pop Out', altNames: [], source: 'user' }];
  const extra = [...parts, { ...parts[0], id: 'blade:brand-new', name: 'Brand New' }];
  const merged = mergeParts(extra, user, {});
  assert.ok(merged.find((p) => p.id === 'bit:pop-out-unverified'));
  assert.ok(merged.find((p) => p.id === 'blade:brand-new'));
  const m = mergeParts(parts, [], { 'blade:bullet-griffon': { preferredName: 'Rocket Griffon', owned: true, coverPhotoId: 'x' } });
  const g = m.find((p) => p.id === 'blade:bullet-griffon');
  assert.equal(g.displayName, 'Rocket Griffon');
  assert.equal(g.name, 'Bullet Griffon');
  assert.equal(g.owned, true);
  assert.equal(g.coverPhotoId, 'x');
  assert.equal(m.find((p) => p.id === 'bit:turbo').owned, false);
});

test('user part wins on id collision; search ranking', () => {
  const m = mergeParts(parts, [{ id: 'bit:turbo', kind: 'bit', name: 'Turbo', altNames: [], source: 'user' }], {});
  assert.equal(m.filter((p) => p.id === 'bit:turbo').length, 1);
  assert.equal(m.find((p) => p.id === 'bit:turbo').source, 'user');
  assert.equal(searchParts(parts, 'turbo', 'bit')[0].id, 'bit:turbo');
});
