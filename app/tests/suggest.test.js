import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../src/seed.js';
import { normalizeCatalog, mergeParts } from '../src/catalog.js';
import { comboLabel, comboParts, isLegalDeck, validateCombo, comboId } from '../src/combo.js';
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

const ownedIds = new Set(parts.filter((p) => p.owned).map((p) => p.id));
function assertOwnedOrReplaced(fix) {
  const old = new Set(comboParts(seed.combos.find((c) => c.id === fix.replaces)));
  for (const p of comboParts(fix.left)) assert.ok(ownedIds.has(p) || old.has(p), `not owned: ${p}`);
}

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
  assertOwnedOrReplaced(fix);
  assert.equal(fix.left.bit, 'bit:turbo');
  assert.equal(fix.left.ratchet, null);
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
  assertOwnedOrReplaced(fix);
  assert.equal(fix.left.bit, 'bit:turbo');
  assert.equal(fix.left.ratchet, null);
});

test('shared part is called out in the reason', () => {
  const s = sugg.find((x) => x.kind === 'baseline' && /Wizard Rod/.test(label(x.left) + label(x.right)) && /Pegasus/.test(label(x.left) + label(x.right)));
  assert.match(s.reason, /\(needs two of 2-60\)$/);
});

test('empty state yields no suggestions', () => {
  assert.deepEqual(suggestTests({ combos: [], battles: [], field: [] }, parts, { ranked: [], blocked: [] }), []);
});

// ---- synthetic states for the other tiers ----
const [W, C, P, H, O, G] = ['wizard', 'cobalt', 'pegasus', 'hulk', 'popout', 'griffon']
  .map((_, i) => seed.combos[i].id);
// seed.combos order: wizard, cobalt, pegasus, hulk, popout, griffon
let bn = 0;
const bat = (left, right, pts, finish) => ({
  id: `t${bn++}`, left, right, winner: pts > 0 ? 'left' : 'right', finish: finish ?? (Math.abs(pts) === 3 ? 'xtreme' : Math.abs(pts) === 2 ? 'pocket' : 'spin'),
  points: Math.abs(pts), note: '', ts: bn,
});
const many = (l, r, list) => list.map((p) => bat(l, r, p));
const mkState = (battles, coreIds, extraIds = []) => ({
  ...seed, battles,
  field: [...coreIds.map((c) => ({ comboId: c, active: true, core: true })), ...extraIds.map((c) => ({ comboId: c, active: true, core: false }))],
});
const none = { ranked: [], blocked: [] };
const ORDER = ['baseline', 'blocking', 'stage1', 'stage2', 'fix', 'narrow'];
const tierOk = (list) => list.every((s, i) => i === 0 || ORDER.indexOf(list[i - 1].kind) <= ORDER.indexOf(s.kind));
const idsOf = (s) => [s.left.id, s.right.id].sort().join('|');

test('blocking: missing pairings of blocked decks', () => {
  const st = mkState(many(H, W, [1, -1]), []);
  const out = suggestTests(st, parts, { ranked: [], blocked: [{ deck: [H, O, G], missing: [[H, O]] }] });
  assert.deepEqual(out.map((s) => [s.kind, idsOf(s)]), [['blocking', [H, O].sort().join('|')]]);
});

test('stage1: candidate missing a core pairing', () => {
  const st = mkState([...many(H, W, [1, -1]), ...many(W, C, [1, -1])], [W, C]);
  const out = suggestTests(st, parts, none);
  assert.deepEqual(out.map((s) => [s.kind, idsOf(s)]), [['stage1', [H, C].sort().join('|')]]);
});

test('stage2: close candidates missing a non-core pairing; untested combos are skipped', () => {
  const st = mkState([...many(H, W, [1, -1, 1, -1]), ...many(W, C, [1, -1, 1, 1]), ...many(G, W, [1, -1, 1, -1])], [W], [C]);
  const out = suggestTests(st, parts, { ranked: [{ deck: [W, H, P] }], blocked: [] });
  const s2 = out.filter((s) => s.kind === 'stage2').map(idsOf);
  assert.ok(s2.includes([G, C].sort().join('|')));
  assert.ok(!out.some((s) => [s.left.id, s.right.id].includes(P) && s.kind === 'stage2'));
  assert.ok(tierOk(out));
});

test('narrow: n=1 and wide intervals are narrow; tight ones are not', () => {
  const st = mkState([...many(W, C, [1]), ...many(W, P, [3, -3, 3, -3]), ...many(C, P, [1, 1, 1, 1, 1, 1])], [W, C, P]);
  const out = suggestTests(st, parts, { ranked: [{ deck: [W, C, P] }], blocked: [] });
  const nar = out.filter((s) => s.kind === 'narrow').map(idsOf);
  assert.ok(nar.includes([W, C].sort().join('|')));
  assert.ok(nar.includes([W, P].sort().join('|')));
  assert.ok(!nar.includes([C, P].sort().join('|')));
});

test('ko-risk fix swaps the bit of Rocket Griffon', () => {
  const st = mkState([...many(G, W, [-3, -3, -3, -3, 1, 1, 1, 1, 1, 1])], [W]);
  const out = suggestTests(st, parts, none);
  const fix = out.find((s) => s.kind === 'fix' && s.replaces === G);
  assert.ok(fix);
  assert.match(fix.reason, /^Rocket Griffon Hexa was knocked out \(Pocket or Xtreme\) in 4 of 10 battles — test a different bit\./);
  assert.notEqual(fix.left.bit, 'bit:hexa');
  assert.equal(validateCombo(fix.left, byId), null);
});

test('a zero-clash ratchet swap beats a clashing bit swap', () => {
  const only = new Set(['bit:pop-out-unverified', 'bit:free-flat', 'bit:low-rush']);
  const ps = parts.map((p) => (p.kind === 'bit' ? { ...p, owned: only.has(p.id) } : p.id === 'ratchet:3-60' ? { ...p, owned: true } : p));
  const st = mkState([...many(O, W, [-2, -2, -2, -2, -2, 1]), ], [W]);
  st.battles.forEach((b) => { if (b.points === 2) b.finish = 'burst'; });
  const out = suggestTests(st, ps, { ranked: [{ deck: [O, C, H] }], blocked: [] });
  const fix = out.find((s) => s.kind === 'fix' && s.replaces === O);
  assert.ok(fix);
  assert.equal(fix.left.bit, 'bit:pop-out-unverified');
  assert.equal(fix.left.ratchet, 'ratchet:3-60');
  assert.match(fix.reason, /different ratchet/);
});

test('cap of 8, tier order, and no duplicates', () => {
  const st = mkState([], [W, C, P, H, O, G]);
  const out = suggestTests(st, parts, none);
  assert.equal(out.length, 8);
  assert.ok(tierOk(out));
  assert.equal(new Set(out.map(idsOf)).size, 8);
  assert.ok(tierOk(sugg));
});
