import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../src/seed.js';
import { normalizeCatalog, mergeParts } from '../src/catalog.js';
import { comboLabel, isLegalDeck, validateCombo, comboId } from '../src/combo.js';
import { makeRng } from '../src/rng.js';
import { rankLineups, fieldCombos } from '../src/lineup.js';
import { suggestTests } from '../src/suggest.js';

const catalog = normalizeCatalog(JSON.parse(readFileSync(new URL('../data/parts-catalog.json', import.meta.url), 'utf8')));
const seed = buildSeed(catalog);
const parts = mergeParts(catalog, seed.userParts, seed.overrides);
const byId = new Map(parts.map((p) => [p.id, p]));
const label = (c) => comboLabel(c, byId);
const FAST = { screenMatches: 200, refineOuter: 40, refineInner: 20 };
const OPTS = { draws: 200, raceSims: 200 };

const lineup = rankLineups(seed, parts, { rng: makeRng(7), ...FAST, leaderboardOptions: OPTS });
const sugg = suggestTests(seed, parts, lineup, { rng: makeRng(8), ...OPTS });

test('baseline suggestions come first and cover the core field pairs', () => {
  assert.ok(sugg.length <= 8);
  const first = sugg.slice(0, 3);
  assert.ok(first.every((s) => s.kind === 'baseline' && s.battles === 10));
  const pairs = first.map((s) => [label(s.left), label(s.right)].sort().join(' | '));
  const want = [
    ['Wizard Rod 2-60 Gear Ball', 'Cobalt Drake 1-60 Free Flat'],
    ['Wizard Rod 2-60 Gear Ball', 'Pegasus Blast 2-60 Free Ball'],
    ['Cobalt Drake 1-60 Free Flat', 'Pegasus Blast 2-60 Free Ball'],
  ];
  for (const w of want) assert.ok(pairs.includes([...w].sort().join(' | ')), `missing ${w}`);
});

test('every suggestion is a valid, unique pair of full combos', () => {
  const seen = new Set();
  for (const s of sugg) {
    for (const c of [s.left, s.right]) {
      assert.equal(c.id, comboId(c));
      assert.equal(validateCombo(c, byId), null, label(c));
    }
    const k = [s.left.id, s.right.id].sort().join('\n');
    assert.ok(!seen.has(k), 'duplicate pair');
    seen.add(k);
    assert.ok(!s.reason.includes('\n'));
  }
});

test('burst-risk fix swaps the bit on Pegasus Blast Pop Out', () => {
  const fix = sugg.find((s) => s.kind === 'fix' && /burst/.test(s.reason) && s.left.blade.type === 'cx');
  assert.ok(fix, 'no burst fix');
  assert.notEqual(fix.left.bit, 'bit:pop-out-unverified');
  assert.match(fix.reason, /^Pegasus Blast 2-60 Pop Out \(unverified\) was burst in 5 of 20 battles — test a different bit\./);
  assert.equal(fix.replaces, seed.combos.find((c) => label(c) === 'Pegasus Blast 2-60 Pop Out (unverified)').id);
});

test('field-illegal fix makes the field legal with owned parts', () => {
  const field = fieldCombos(seed);
  assert.equal(lineup.fieldLegal, false);
  const fix = sugg.find((s) => s.kind === 'fix' && s.replaces && field.includes(s.replaces));
  assert.ok(fix, 'no field fix');
  const next = field.map((id) => (id === fix.replaces ? fix.left : seed.combos.find((c) => c.id === id)));
  assert.ok(isLegalDeck(next));
  assert.ok(fix.right && fieldCombos(seed).includes(fix.right.id));
  const ownedIds = new Set(parts.filter((p) => p.owned).map((p) => p.id));
  const used = [fix.left.bit, fix.left.ratchet, fix.left.blade.bladeId].filter(Boolean);
  assert.ok(used.filter((p) => !p.startsWith('lock_')).every((p) => ownedIds.has(p) || p === undefined));
});

test('shared part is called out in the reason', () => {
  const s = sugg.find((x) => x.kind === 'baseline' && /Wizard Rod/.test(label(x.left) + label(x.right)) && /Pegasus/.test(label(x.left) + label(x.right)));
  assert.match(s.reason, /\(needs two of 2-60\)$/);
});

test('empty state yields no suggestions', () => {
  assert.deepEqual(suggestTests({ combos: [], battles: [], field: [] }, parts, { ranked: [], blocked: [] }), []);
});
