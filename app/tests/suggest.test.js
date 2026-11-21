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
const ORDER = ['screen', 'unlock', 'idea', 'upset', 'fix'];
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

test('ko-risk fix swaps the bit of Rocket Griffon when it is in the #1 deck', () => {
  const st = mkState([...many(G, W, [-3, -3, -3, -3, 1, 1, 1, 1, 1, 1])]);
  const out = suggestTests(st, parts, withRatings(st, [{ deck: [G, C, H] }]));
  const fix = out.find((s) => s.kind === 'fix' && s.replaces === G);
  assert.ok(fix);
  assert.match(fix.reason, /^Rocket Griffon Hexa was knocked out \(Pocket, Xtreme or out of the arena\) in 4 of 10 battles — test a different bit\./);
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

test('at most 8, kind order, and no duplicates', () => {
  const b = [];
  const ids = [W, C, P, H, O, G];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) b.push(...many(ids[i], ids[j], [1]));
  const st = mkState(b);
  const out = suggestTests(st, parts, withRatings(st, [{ deck: [W, C, H] }]));
  assert.ok(out.length > 0 && out.length <= 8);
  assert.ok(kindOk(out));
  assert.equal(new Set(out.map(idsOf)).size, out.length);
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

// ---- look-ahead: chance a matchup changes the best deck ----
import { upsetChances, ratingShift, UPSET_MIN } from '../src/suggest.js';
import { fitModel } from '../src/ratings.js';
import { enumerateLegalDecks, candidateCombos as cands } from '../src/lineup.js';

const lookState = () => mkState([
  ...many(W, C, [1, 1, -1, 2, 1, -1, 1, 1]), ...many(W, G, [2, 1, 1, -1, 1, 1]), ...many(C, G, [1, -1, 1, -1, 1, -1]),
  ...many(H, W, [1, -2]), ...many(O, C, [-1, -1, 1, -2, -1, -1, -1, -2, -1, 1]), ...many(P, G, [1, -1, -1, 1, -1, 1, -1, -1]),
]);

test('ratingShift matches a full refit after adding n battles', () => {
  const st = lookState();
  const model = fitModel(st.battles);
  const sbar = 1;
  const shifted = ratingShift(model, H, C, 10, sbar);
  const refit = fitModel([...st.battles, ...many(H, C, Array(10).fill(1))]);
  for (const id of model.ids) assert.ok(Math.abs(shifted[model.idx.get(id)] - refit.r[refit.idx.get(id)]) < 1e-9, id);
});

test('closed-form chance matches brute force over the predictive distribution', () => {
  const st = lookState();
  const model = fitModel(st.battles);
  const list = upsetChances(st, parts, { model });
  assert.ok(list.length > 0);
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].p >= list[i].p);
  // Brute force for the top pairing: sample s̄, shift, argmax over the same deck set.
  const { a, b, p } = list[0];
  const byIdC = new Map(st.combos.map((c) => [c.id, c]));
  const decks = enumerateLegalDecks(cands(st, parts), byIdC);
  const score = (r, d) => d.reduce((s, id) => s + r[model.idx.get(id)], 0);
  const best = (r) => decks.reduce((x, d) => (score(r, d) > score(r, x) ? d : x)).join();
  const i = model.idx.get(a), j = model.idx.get(b);
  const q = model.Ainv[i][i] - 2 * model.Ainv[i][j] + model.Ainv[j][j];
  const mu = model.r[i] - model.r[j];
  const sd = Math.sqrt(model.sigma2 * (1 / 10 + q));
  const rng = makeRng(3);
  const now = best(model.r);
  let changed = 0;
  const N = 20000;
  for (let k = 0; k < N; k++) {
    const z = Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());
    if (best(ratingShift(model, a, b, 10, mu + sd * z)) !== now) changed++;
  }
  assert.ok(Math.abs(changed / N - p) < 0.02, `brute ${changed / N} vs closed ${p}`);
});

test('look-ahead only offers runnable matchups: owned, no shared parts', () => {
  const st = lookState();
  const owned = new Set(parts.filter((p) => p.owned).map((p) => p.id));
  for (const { a, b } of upsetChances(st, parts, { model: fitModel(st.battles) })) {
    const ca = st.combos.find((c) => c.id === a), cb = st.combos.find((c) => c.id === b);
    assert.ok([...comboParts(ca), ...comboParts(cb)].every((x) => owned.has(x)));
    assert.ok(!comboParts(ca).some((x) => comboParts(cb).includes(x)));
  }
});

test('a settled pool offers no upsets above the threshold', () => {
  // Three combos crush the rest over many battles: nothing plausible changes the best deck.
  const strong = [W, C, G], weak = [H, O];
  const b = [];
  for (const s of strong) for (const w of weak) b.push(...many(s, w, Array(40).fill(3)));
  b.push(...many(W, C, Array(30).fill(0).map((_, i) => (i % 2 ? 1 : -1))), ...many(W, G, Array(30).fill(0).map((_, i) => (i % 2 ? 1 : -1))));
  const st = mkState(b);
  assert.equal(UPSET_MIN, 0.02);
  const out = suggestTests(st, parts, withRatings(st, [{ deck: strong }]));
  assert.ok(!out.some((x) => x.kind === 'upset'), JSON.stringify(out.map((x) => [x.kind, idsOf(x)])));
});

test('upset suggestions come between New and Fix, with the chance in the reason', () => {
  const st = lookState();
  const out = suggestTests(st, parts, withRatings(st, [{ deck: [W, C, G] }]));
  const kinds = out.map((x) => x.kind);
  assert.ok(kinds.includes('upset'));
  const order = ['screen', 'upset', 'fix'];
  for (let i = 1; i < kinds.length; i++) assert.ok(order.indexOf(kinds[i - 1]) <= order.indexOf(kinds[i]));
  const u = out.find((x) => x.kind === 'upset');
  assert.match(u.reason, /^\d+% chance this changes your best deck\./);
  assert.ok(out.length <= 8);
  assert.ok(out.filter((x) => x.kind === 'fix').length <= 2);
});

test('a shared part marked "have multiple" allows the matchup', () => {
  // Wizard Rod 2-60 Gear Ball vs a second Wizard Rod combo: allowed only with multiple Wizard Rods.
  const w2c = { blade: { type: 'single', bladeId: 'blade:wizard-rod' }, ratchet: 'ratchet:9-60', bit: 'bit:ball' };
  const W2 = { ...w2c, id: comboId(w2c) };
  const st = mkState([], [...seed.combos.filter((c) => c.id === W), W2]);
  st.combos = st.combos.map((c) => ({ ...c, createdAt: c.id === W2.id ? 2 : 1 }));
  const own = (extra) => parts.map((p) => (['ratchet:9-60', 'bit:ball'].includes(p.id) ? { ...p, owned: true } : p))
    .map((p) => (p.id === 'blade:wizard-rod' ? { ...p, ...extra } : p));
  const without = suggestTests(st, own({}), { ranked: [], ratings: [] });
  assert.equal(without.length, 0);
  const withMulti = suggestTests(st, own({ multiple: true }), { ranked: [], ratings: [] });
  assert.equal(withMulti.length, 1);
  assert.deepEqual([withMulti[0].left.id, withMulti[0].right.id].sort(), [W, W2.id].sort());
});

import { lookaheadDeck } from '../src/suggest.js';

test('look-ahead reports which deck takes over at each end, matching a direct check', () => {
  const st = lookState();
  const model = fitModel(st.battles);
  const list = upsetChances(st, parts, { model });
  const byIdC = new Map(st.combos.map((c) => [c.id, c]));
  const decks = enumerateLegalDecks(cands(st, parts), byIdC);
  const score = (r, d) => d.reduce((s, id) => s + r[model.idx.get(id)], 0);
  const bestOf = (r) => decks.reduce((x, d) => (score(r, d) > score(r, x) ? d : x));
  const now = lookaheadDeck(st, parts, model);
  assert.deepEqual([...now].sort(), [...bestOf(model.r)].sort());
  let checked = 0;
  for (const u of list.slice(0, 5)) {
    const i = model.idx.get(u.a), j = model.idx.get(u.b);
    const mu = model.r[i] - model.r[j];
    const q = model.Ainv[i][i] - 2 * model.Ainv[i][j] + model.Ainv[j][j];
    const sd = Math.sqrt(model.sigma2 * (1 / 10 + q));
    for (const [side, z] of [['up', u.zhi + 0.01], ['down', u.zlo - 0.01]]) {
      if (!Number.isFinite(z)) { assert.equal(u[side], null); continue; }
      const after = bestOf(ratingShift(model, u.a, u.b, 10, mu + sd * z));
      assert.deepEqual([...after].sort(), [...u[side]].sort(), `${side} for ${u.a}/${u.b}`);
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test('upset reasons say what would change', () => {
  const st = lookState();
  const out = suggestTests(st, parts, withRatings(st, [{ deck: [W, C, G] }]));
  const u = out.find((x) => x.kind === 'upset');
  assert.match(u.reason, /If .+ does (well|badly), .+ (could|would) (replace|come in for) /);
});

// ---- unlock: two top combos that can't share a deck ----
import { MAX_UNLOCK } from '../src/suggest.js';

// C (Cobalt Drake 1-60 Free Flat) and H (Red Hulk 1-60 Low Rush) top the ratings and share 1-60.
const unlockState = () => mkState([
  ...many(C, W, [2, 2, 1, 2, 1, 2]), ...many(C, P, [2, 1, 2, 2, 1]), ...many(H, W, [2, 1, 2, 1, 2]), ...many(H, P, [1, 2, 2, 1, 2]),
  ...many(W, P, [1, -1, 1, -1]), ...many(G, W, [-1, -1, 1, -1]),
]);
const withRatchet = (id) => parts.map((p) => (p.id === id ? { ...p, owned: true } : p));

test('unlock: top combos sharing a part get a variant of the lower-rated one', () => {
  const st = unlockState();
  const lb = ratingsLeaderboard(st);
  assert.deepEqual(lb.slice(0, 2).map((r) => r.comboId).sort(), [C, H].sort());
  const lower = lb[0].comboId === C ? H : C, higher = lower === C ? H : C;
  // 4-80 is listed first but 3-60 keeps the original's height, so 3-60 wins the tie.
  const ps = [...withRatchet('ratchet:3-60').filter((p) => p.id === 'ratchet:4-80').map((p) => ({ ...p, owned: true })), ...withRatchet('ratchet:3-60').filter((p) => p.id !== 'ratchet:4-80')];
  const out = suggestTests(st, ps, withRatings(st, []));
  const un = out.filter((s) => s.kind === 'unlock');
  assert.equal(MAX_UNLOCK, 2);
  assert.ok(un.length >= 1 && un.length <= 2);
  const u = un[0];
  const old = st.combos.find((c) => c.id === lower);
  assert.equal(u.replaces, lower);
  assert.equal(u.left.blade.bladeId, old.blade.bladeId);
  assert.equal(u.left.bit, old.bit);
  assert.equal(u.left.ratchet, 'ratchet:3-60'); // 2-60 is taken by other top combos (W, P)
  assert.equal(validateCombo(u.left, byId), null);
  const hi = st.combos.find((c) => c.id === higher);
  assert.ok(!comboParts(u.left).some((p) => comboParts(hi).includes(p)), 'variant still clashes with the higher combo');
  assert.match(u.reason, /both need 1-60/);
  assert.match(u.reason, /run both/);
  // Order: unlock right after new combos.
  const order = ['screen', 'unlock', 'upset', 'fix'];
  for (let i = 1; i < out.length; i++) assert.ok(order.indexOf(out[i - 1].kind) <= order.indexOf(out[i].kind));
});

test('unlock falls back to a part other top combos use when nothing else is owned', () => {
  const st = unlockState();
  const out = suggestTests(st, parts, withRatings(st, []));
  const u = out.find((s) => s.kind === 'unlock');
  assert.ok(u);
  assert.equal(u.left.ratchet, 'ratchet:2-60');
});

test('unlock ignores "have multiple": a deck still cannot repeat a part', () => {
  const st = unlockState();
  const ps = withRatchet('ratchet:3-60').map((p) => (p.id === 'ratchet:1-60' ? { ...p, multiple: true } : p));
  assert.ok(suggestTests(st, ps, withRatings(st, [])).some((s) => s.kind === 'unlock'));
});

test('no unlock when the variant has already been tested, or only a blade is shared', () => {
  const st = unlockState();
  const lb = ratingsLeaderboard(st);
  const lower = lb[1].comboId;
  const old = st.combos.find((c) => c.id === lower);
  const v = { blade: old.blade, ratchet: 'ratchet:2-60', bit: old.bit };
  const V = { ...v, id: comboId(v) };
  const st2 = { ...st, combos: [...st.combos, V], battles: [...st.battles, ...many(V.id, G, [1, -1])] };
  // Only 2-60 is an alternative and that variant exists with battles: nothing new to suggest for it.
  const out = suggestTests(st2, parts, withRatings(st2, []));
  assert.ok(!out.some((s) => s.kind === 'unlock' && s.left.id === V.id));
  // Two Wizard Rod combos share only the blade: no unlock (it's the same bey).
  const w2 = { blade: { type: 'single', bladeId: 'blade:wizard-rod' }, ratchet: 'ratchet:1-60', bit: 'bit:hexa' };
  const W2 = { ...w2, id: comboId(w2) };
  const st3 = mkState([...many(W, C, [3, 3, 3, 3]), ...many(W2.id, C, [3, 3, 3, 3]), ...many(W, W2.id, [1, -1])], [...seed.combos, W2]);
  const out3 = suggestTests(st3, parts, withRatings(st3, []));
  assert.ok(!out3.some((s) => s.kind === 'unlock' && [W, W2.id].includes(s.replaces) && s.reason.includes('Wizard Rod') && /both need Wizard Rod/.test(s.reason)));
});

// ---- ideas from WBO results and packaging stats ----
import { MAX_IDEA } from '../src/suggest.js';
import { withReference } from '../src/catalog.js';

test('idea: untried combos from owned parts come after unlocks, at most 2, never existing combos', () => {
  const reference = JSON.parse(readFileSync(new URL('../data/reference.json', import.meta.url), 'utf8'));
  const refParts = withReference(parts, reference);
  const st = unlockState();
  const out = suggestTests(st, refParts, withRatings(st, []), { reference });
  const ideas = out.filter((s) => s.kind === 'idea');
  assert.equal(MAX_IDEA, 2);
  assert.ok(ideas.length >= 1 && ideas.length <= 2, out.map((s) => s.kind).join());
  const existing = new Set(st.combos.map((c) => c.id));
  const owned = new Set(refParts.filter((p) => p.owned).map((p) => p.id));
  for (const s of ideas) {
    assert.ok(!existing.has(s.left.id));
    assert.ok(comboParts(s.left).every((p) => owned.has(p)));
    assert.ok(!comboParts(s.left).some((p) => comboParts(s.right).includes(p)));
    assert.match(s.reason, /^Idea: /);
  }
  const order = ['screen', 'unlock', 'idea', 'upset', 'fix'];
  for (let i = 1; i < out.length; i++) assert.ok(order.indexOf(out[i - 1].kind) <= order.indexOf(out[i].kind));
  // Without reference data there are no ideas.
  assert.ok(!suggestTests(st, parts, withRatings(st, [])).some((s) => s.kind === 'idea'));
});

test('confirmTests: three uncertain matchups for a deck, spread across its members', async () => {
  const { confirmTests } = await import('../src/suggest.js');
  const { normalizeCatalog, mergeParts } = await import('../src/catalog.js');
  const { comboId } = await import('../src/combo.js');
  const { readFileSync } = await import('node:fs');
  const raw = JSON.parse(readFileSync(new URL('../data/parts-catalog.json', import.meta.url), 'utf8'));
  const blades = ['blade:wizard-rod', 'blade:shark-scale', 'blade:phoenix-wing', 'blade:dran-sword', 'blade:hells-scythe', 'blade:knight-shield'];
  const ratchets = ['ratchet:1-60', 'ratchet:3-60', 'ratchet:4-60', 'ratchet:5-60', 'ratchet:9-60', 'ratchet:3-80'];
  const bits = ['bit:hexa', 'bit:point', 'bit:ball', 'bit:flat', 'bit:needle', 'bit:rush'];
  const parts = mergeParts(normalizeCatalog(raw), [], Object.fromEntries([...blades, ...ratchets, ...bits].map((id) => [id, { owned: true }])));
  const combos = blades.map((b, i) => { const c = { blade: { type: 'single', bladeId: b }, ratchet: ratchets[i], bit: bits[i] }; return { ...c, id: comboId(c) }; });
  const [A, B, C, D, E, F] = combos.map((c) => c.id);
  let t = 0;
  const bat = (l, r, w, x = 10) => Array.from({ length: x }, () => ({ id: `b${t++}`, left: l, right: r, winner: w, finish: 'spin', points: 1, ts: t }));
  // Deck A/B/C. A vs D well tested; E and F battled only each other and D.
  const battles = [...bat(A, D, 'left'), ...bat(B, D, 'left'), ...bat(C, D, 'right'), ...bat(E, F, 'left'), ...bat(D, E, 'left', 1), ...bat(A, B, 'left', 2), ...bat(B, C, 'left', 2)];
  const state = { combos, battles };
  const tests = confirmTests(state, parts, [A, B, C]);
  assert.equal(tests.length, 3);
  assert.deepEqual(new Set(tests.map((x) => x.a)), new Set([A, B, C]), 'one per member');
  for (const x of tests) {
    assert.ok([A, B, C].includes(x.a));
    assert.ok(![A, B, C].includes(x.b), 'never a deck-mate');
    assert.ok(x.n < 10, 'not a well-tested pair');
    assert.ok(x.reason.length > 10);
  }
  assert.ok(tests.some((x) => x.n === 0 && /Never battled/.test(x.reason)));
  assert.equal(new Set(tests.map((x) => [x.a, x.b].sort().join())).size, 3, 'no repeated pair');
});
