import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog, mergeParts } from '../src/catalog.js';
import { comboId, validateCombo, comboParts, comboLabel, deckClashes, isLegalDeck, partRefName } from '../src/combo.js';

const raw = JSON.parse(readFileSync(new URL('../data/parts-catalog.json', import.meta.url), 'utf8'));
const catalog = normalizeCatalog(raw);
const byId = (parts) => new Map(parts.map((p) => [p.id, p]));
const partsById = byId(mergeParts(catalog, [], {}));

const single = (bladeId, ratchet, bit) => ({ blade: { type: 'single', bladeId }, ratchet, bit });
const cxFromPreset = (id, ratchet, bit) => ({
  blade: { type: 'cx', ...partsById.get(id).cxPreset },
  ratchet,
  bit,
});

const wizard = () => single('blade:wizard-rod', 'ratchet:2-60', 'bit:gear-ball');
const pegasus = (ratchet = 'ratchet:2-60', bit = 'bit:free-ball') => cxFromPreset('blade:pegasus-blast', ratchet, bit);

test('shared ratchet clashes', () => {
  const a = wizard();
  const b = pegasus();
  assert.equal(validateCombo(a, partsById), null);
  assert.equal(validateCombo(b, partsById), null);
  const clashes = deckClashes([a, b]);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].partId, 'ratchet:2-60');
  assert.deepEqual(clashes[0].comboIds, [comboId(a), comboId(b)]);
  assert.equal(isLegalDeck([a, b]), false);
});

test('built-in ratchet blade uses null ratchet and never clashes on ratchet', () => {
  const a = single('blade:bullet-griffon', null, 'bit:hexa');
  assert.equal(validateCombo(a, partsById), null);
  assert.equal(validateCombo({ ...a, ratchet: 'ratchet:2-60' }, partsById) !== null, true);
  const clashes = deckClashes([a, wizard()]);
  assert.deepEqual(clashes, []);
  assert.equal(comboParts(a).includes(null), false);
});

test('ratchet-integrated bit', () => {
  const ok = pegasus(null, 'bit:turbo');
  assert.equal(validateCombo(ok, partsById), null);
  assert.equal(comboLabel(ok, partsById), 'Pegasus Blast Turbo');
  assert.equal(typeof validateCombo(pegasus('ratchet:2-60', 'bit:turbo'), partsById), 'string');
});

test('missing ratchet on normal blade/bit is an error', () => {
  assert.equal(typeof validateCombo(wizard() && single('blade:wizard-rod', null, 'bit:gear-ball'), partsById), 'string');
});

test('cx build needs required components', () => {
  const c = pegasus();
  assert.equal(typeof validateCombo({ ...c, blade: { ...c.blade, lockChip: null } }, partsById), 'string');
  assert.equal(typeof validateCombo({ ...c, blade: { ...c.blade, assistBlade: null } }, partsById), 'string');
  const noMain = { ...c, blade: { ...c.blade, mainBlade: null, overBlade: null, metalBlade: null } };
  assert.equal(typeof validateCombo(noMain, partsById), 'string');
});

test('cx combos sharing an assist blade clash on it', () => {
  const a = { blade: { type: 'cx', lockChip: 'lock_chip:pegasus', mainBlade: 'main_blade:blast', overBlade: null, metalBlade: null, assistBlade: 'assist_blade:assault' }, ratchet: 'ratchet:2-60', bit: 'bit:free-ball' };
  const b = { blade: { type: 'cx', lockChip: 'lock_chip:wizard', mainBlade: 'main_blade:blast2', overBlade: null, metalBlade: null, assistBlade: 'assist_blade:assault' }, ratchet: 'ratchet:3-60', bit: 'bit:flat' };
  const clashes = deckClashes([a, b]);
  assert.deepEqual(clashes.map((c) => c.partId), ['assist_blade:assault']);
});

test('label uses displayName overrides', () => {
  const parts = byId(mergeParts(catalog, [], { 'blade:bullet-griffon': { preferredName: 'Rocket Griffon' } }));
  assert.equal(comboLabel(single('blade:bullet-griffon', null, 'bit:hexa'), parts), 'Rocket Griffon Hexa');
  assert.equal(comboLabel(pegasus(), partsById), 'Pegasus Blast 2-60 Free Ball');
});

test('non-preset cx label lists components', () => {
  const c = { blade: { type: 'cx', lockChip: 'lock_chip:pegasus', mainBlade: 'main_blade:blast', overBlade: null, metalBlade: null, assistBlade: 'assist_blade:slash' }, ratchet: 'ratchet:2-60', bit: 'bit:free-ball' };
  const label = comboLabel(c, partsById);
  assert.match(label, /\[.+\]/);
  assert.equal(label.endsWith('2-60 Free Ball'), true);
});

test('comboId is deterministic', () => {
  assert.equal(comboId(pegasus()), comboId(pegasus()));
  assert.equal(comboId(wizard()), comboId(wizard()));
  assert.notEqual(comboId(wizard()), comboId(pegasus()));
});

test('partRefName prefixes CX components with their kind', () => {
  const m = new Map([
    ['lc', { kind: 'lock_chip', name: 'Pegasus' }], ['mb', { kind: 'main_blade', name: 'Blast', displayName: 'Blast' }],
    ['ab', { kind: 'assist_blade', name: 'Assault' }], ['ob', { kind: 'over_blade', name: 'Break' }],
    ['mt', { kind: 'metal_blade', name: 'Heavy' }], ['r', { kind: 'ratchet', name: '2-60' }],
    ['bt', { kind: 'bit', name: 'Free Ball' }], ['bl', { kind: 'blade', name: 'Wizard Rod', displayName: 'My Rod' }],
  ]);
  assert.deepEqual(['lc', 'mb', 'ab', 'ob', 'mt', 'r', 'bt', 'bl', 'nope'].map((id) => partRefName(m, id)), [
    'lock chip Pegasus', 'main blade Blast', 'assist blade Assault', 'over blade Break', 'metal blade Heavy',
    '2-60', 'Free Ball', 'My Rod', 'nope',
  ]);
});

import { blockingParts } from '../src/combo.js';

test('blockingParts: shared parts block unless owned and marked multiple', () => {
  const a = { blade: { type: 'single', bladeId: 'blade:x' }, ratchet: 'ratchet:3-60', bit: 'bit:flat' };
  const b = { blade: { type: 'single', bladeId: 'blade:x' }, ratchet: 'ratchet:4-60', bit: 'bit:flat' };
  const c = { blade: { type: 'single', bladeId: 'blade:y' }, ratchet: 'ratchet:5-60', bit: 'bit:ball' };
  const pm = (o) => new Map(Object.entries(o).map(([id, v]) => [id, { id, ...v }]));
  assert.deepEqual(blockingParts(a, c, pm({})), []);
  assert.deepEqual(blockingParts(a, b, pm({})).sort(), ['bit:flat', 'blade:x']);
  assert.deepEqual(blockingParts(a, b, pm({ 'blade:x': { owned: true, multiple: true } })), ['bit:flat']);
  assert.deepEqual(blockingParts(a, b, pm({ 'blade:x': { owned: true, multiple: true }, 'bit:flat': { owned: true, multiple: true } })), []);
  // Multiple without owned doesn't count.
  assert.deepEqual(blockingParts(a, b, pm({ 'blade:x': { owned: false, multiple: true }, 'bit:flat': { owned: true, multiple: true } })), ['blade:x']);
});
