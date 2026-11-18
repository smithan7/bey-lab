import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../src/seed.js';
import { normalizeCatalog, mergeParts } from '../src/catalog.js';
import { comboLabel, comboParts, isLegalDeck, validateCombo, comboId } from '../src/combo.js';
import { makeRng } from '../src/rng.js';
import { rankLineups } from '../src/lineup.js';
import { suggestTests, MAX_SCREEN } from '../src/suggest.js';
import { ratingsLeaderboard } from '../src/ratings.js';

const catalog = normalizeCatalog(JSON.parse(readFileSync(new URL('../data/parts-catalog.json', import.meta.url), 'utf8')));
const seed = buildSeed(catalog);
const parts = mergeParts(catalog, seed.userParts, seed.overrides);
const byId = new Map(parts.map((p) => [p.id, p]));
const label = (c) => comboLabel(c, byId);
const FAST = { screenMatches: 200, refineOuter: 40, refineInner: 20 };

const ownedIds = new Set(parts.filter((p) => p.owned).map((p) => p.id));
function assertOwnedOrReplaced(fix) {
  const old = new Set(comboParts(seed.combos.find((c) => c.id === fix.replaces)));
  for (const p of comboParts(fix.left)) assert.ok(ownedIds.has(p) || old.has(p), `not owned: ${p}`);
}

const lineup = rankLineups(seed, parts, { rng: makeRng(7), ...FAST });
const sugg = suggestTests(seed, parts, lineup);

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

test('empty state yields no suggestions', () => {
  assert.deepEqual(suggestTests({ combos: [], battles: [], field: [] }, parts, { ranked: [] }), []);
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
const mkState = (battles, combos = seed.combos) => ({ ...seed, combos, battles });
const none = { ranked: [] };
const ORDER = ['screen', 'contender', 'topcheck', 'fix', 'narrow'];
const kindOk = (list) => list.every((s, i) => i === 0 || ORDER.indexOf(list[i - 1].kind) <= ORDER.indexOf(s.kind));
const idsOf = (s) => [s.left.id, s.right.id].sort().join('|');
const pair = (a, b) => [a, b].sort().join('|');
const withRatings = (st, ranked) => ({ ranked, ratings: ratingsLeaderboard(st) });

test('seed suggestions are in kind order with no old kinds', () => {
  assert.ok(sugg.length > 0 && sugg.length <= 8);
  assert.ok(kindOk(sugg));
  for (const s of sugg) assert.ok(ORDER.includes(s.kind), s.kind);
});

test('screen: newest untested owned combos first, one each, at most 3', () => {
  // Hulk, Pop Out and Griffon tested; Wizard, Cobalt, Pegasus untested (seed parts are owned).
  const st = mkState([...many(H, O, [1, -1, 2]), ...many(G, H, [1, 1, -1])]);
  st.combos = st.combos.map((c) => (c.id === W ? { ...c, createdAt: 1 } : c.id === C ? { ...c, createdAt: 3 } : c));
  const out = suggestTests(st, parts, withRatings(st, []));
  const screens = out.filter((s) => s.kind === 'screen');
  assert.equal(MAX_SCREEN, 3);
  assert.deepEqual(screens.map((s) => s.left.id), [C, W, P]);
  // Opponent: the strongest tested combo.
  const lb = ratingsLeaderboard(st);
  for (const s of screens) assert.ok(lb.slice(0, 2).map((r) => r.comboId).includes(s.right.id));
});

test('screen caps at MAX_SCREEN and skips combos with unowned parts', () => {
  const extra = ['dran-dagger', 'leon-claw', 'shark-edge'].map((b) => {
    const c = { blade: { type: 'single', bladeId: `blade:${b}` }, ratchet: 'ratchet:3-60', bit: 'bit:flat' };
    return { ...c, id: comboId(c), createdAt: 99 };
  });
  const st = mkState(many(H, O, [1, -1]), [...seed.combos, ...extra]);
  const out = suggestTests(st, parts, withRatings(st, []));
  const screens = out.filter((s) => s.kind === 'screen');
  assert.equal(screens.length, 3);
  for (const s of screens) assert.ok(!extra.some((e) => e.id === s.left.id), 'unowned combo screened');
});

test('contender: range reaching the #1 deck gets its strongest unfaced opponent; lower ones get nothing', () => {
  // H strong vs everyone; G weak. #1 deck [H, O, P]; candidate W close; candidate C far below.
  const b = [...many(H, O, [2, 2, 1, 2]), ...many(H, P, [2, 1, 2, 2]), ...many(O, P, [1, -1, 1, -1]),
    ...many(W, O, [1, -1, 1]), ...many(C, H, Array(20).fill(-3)), ...many(C, O, Array(20).fill(-3)), ...many(C, P, Array(20).fill(-3))];
  const st = mkState(b);
  const out = suggestTests(st, parts, withRatings(st, [{ deck: [H, O, P] }]));
  const cont = out.filter((s) => s.kind === 'contender');
  assert.ok(cont.some((s) => s.left.id === W && s.right.id === H), JSON.stringify(cont.map(idsOf)));
  assert.ok(!cont.some((s) => s.left.id === C));
  assert.ok(!out.some((s) => s.kind === 'fix' && s.replaces === C));
});

test('contender who has faced everyone gets its least-tested opponent', () => {
  // W shares no parts with C or H (W and P share 2-60, so P is avoided here).
  const b = [...many(W, C, [1, 1, 1, 1, 1]), ...many(W, H, [1]), ...many(C, H, [1, -1, 1, -1])];
  const st = mkState(b, seed.combos.filter((c) => [W, C, H].includes(c.id)));
  const out = suggestTests(st, parts, withRatings(st, []));
  const s = out.find((x) => x.kind === 'contender' && x.left.id === W);
  assert.ok(s);
  assert.equal(s.right.id, H);
});

test('no ranked deck: every tested candidate is a contender, ordered by upper bound', () => {
  const b = [...many(W, C, [2, 2, 2]), ...many(P, H, [1, -1])];
  const st = mkState(b);
  const out = suggestTests(st, parts, withRatings(st, []));
  const cont = out.filter((s) => s.kind === 'contender').map((s) => s.left.id);
  const lb = ratingsLeaderboard(st);
  const hi = new Map(lb.map((r) => [r.comboId, r.hi]));
  for (let i = 1; i < cont.length; i++) assert.ok(hi.get(cont[i - 1]) >= hi.get(cont[i]));
  assert.ok(cont.includes(W));
});

test('topcheck: #1 member thinly tested vs a strong opponent, strongest first', () => {
  const b = [...many(G, O, [3, 3, 3, 3, 3, 3]), ...many(G, H, [3, 3, 3, 3, 3]), ...many(W, H, [1, -1, 1, -1, 1, -1]), ...many(W, O, [1, -1, 1, -1, 1, -1]),
    ...many(C, O, [1, -1, 1, -1, 1, -1]), ...many(P, O, [1, -1, 1, -1, 1, -1])];
  const st = mkState(b);
  const out = suggestTests(st, parts, withRatings(st, [{ deck: [W, C, P] }]));
  const tc = out.filter((s) => s.kind === 'topcheck');
  assert.ok(tc.length > 0);
  assert.equal(tc[0].right.id, G); // G is the strongest opponent
  assert.match(tc[0].reason, /no battles against/);
});

test('narrow: wide intervals past the top-deck check are narrow; tight ones are not', () => {
  const st = mkState([...many(W, C, [1]), ...many(W, G, [3, -3, 3, -3, 3, -3]), ...many(C, G, [1, 1, 1, 1, 1, 1])],
    seed.combos.filter((c) => [W, C, G].includes(c.id)));
  const out = suggestTests(st, parts, withRatings(st, [{ deck: [W, C, G] }]));
  const kindOf = new Map(out.map((s) => [idsOf(s), s.kind]));
  assert.equal(kindOf.get(pair(W, C)), 'topcheck'); // 1 battle: under-tested
  assert.equal(kindOf.get(pair(W, G)), 'narrow'); // 6 battles, wide interval
  assert.ok(!kindOf.has(pair(C, G)));
});

test('ko-risk fix swaps the bit of Rocket Griffon when it is in the #1 deck', () => {
  const st = mkState([...many(G, W, [-3, -3, -3, -3, 1, 1, 1, 1, 1, 1])]);
  const out = suggestTests(st, parts, withRatings(st, [{ deck: [G, C, H] }]));
  const fix = out.find((s) => s.kind === 'fix' && s.replaces === G);
  assert.ok(fix);
  assert.match(fix.reason, /^Rocket Griffon Hexa was knocked out \(Pocket or Xtreme\) in 4 of 10 battles — test a different bit\./);
  assert.notEqual(fix.left.bit, 'bit:hexa');
  assert.equal(validateCombo(fix.left, byId), null);
  assertOwnedOrReplaced(fix);
});

test('a zero-clash ratchet swap beats a clashing bit swap', () => {
  const only = new Set(['bit:pop-out-unverified', 'bit:free-flat', 'bit:low-rush']);
  const ps = parts.map((p) => (p.kind === 'bit' ? { ...p, owned: only.has(p.id) } : p.id === 'ratchet:3-60' ? { ...p, owned: true } : p));
  const st = mkState([...many(O, W, [-2, -2, -2, -2, -2, 1])]);
  st.battles.forEach((b) => { if (b.points === 2) b.finish = 'burst'; });
  const out = suggestTests(st, ps, withRatings(st, [{ deck: [O, C, H] }]));
  const fix = out.find((s) => s.kind === 'fix' && s.replaces === O);
  assert.ok(fix);
  assert.equal(fix.left.bit, 'bit:pop-out-unverified');
  assert.equal(fix.left.ratchet, 'ratchet:3-60');
  assert.match(fix.reason, /different ratchet/);
});

test('cap of 8, kind order, and no duplicates', () => {
  const b = [];
  const ids = [W, C, P, H, O, G];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) b.push(...many(ids[i], ids[j], [1]));
  const st = mkState(b);
  const out = suggestTests(st, parts, withRatings(st, [{ deck: [W, C, H] }]));
  assert.equal(out.length, 8);
  assert.ok(kindOk(out));
  assert.equal(new Set(out.map(idsOf)).size, 8);
});

test('no battles at all: untested owned combos are screened against each other', () => {
  const st = mkState([]);
  const out = suggestTests(st, parts, { ranked: [], ratings: [] });
  const screens = out.filter((s) => s.kind === 'screen');
  assert.equal(screens.length, 3);
  for (const s of screens) assert.notEqual(s.left.id, s.right.id);
});

test('no suggestion ever pairs combos that share a part', () => {
  const shares = (x) => comboParts(x.left).some((p) => comboParts(x.right).includes(p));
  const states = [
    [mkState([...many(O, H, [3, 3, 3, 3, 3]), ...many(O, G, [3, 3, 3, 3]), ...many(P, H, [1, -1, 1]), ...many(W, C, [1, -1, 1, -1])]), [{ deck: [W, C, G] }]],
    [mkState([]), []],
    [mkState(many(H, O, [1, -1, 2])), []],
    [mkState([...many(G, W, [-3, -3, -3, -3, 1, 1, 1, 1, 1, 1])]), [{ deck: [G, C, H] }]],
  ];
  let total = 0;
  for (const [st, ranked] of states) {
    const out = suggestTests(st, parts, withRatings(st, ranked));
    total += out.length;
    for (const x of out) assert.ok(!shares(x), `${x.kind}: ${label(x.left)} vs ${label(x.right)}`);
    for (const x of out) assert.ok(!/needs two of/.test(x.reason));
  }
  assert.ok(total > 10);
  for (const x of sugg) assert.ok(!shares(x), `seed ${x.kind}: ${label(x.left)} vs ${label(x.right)}`);
});
