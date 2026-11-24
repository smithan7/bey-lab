// "Find its spot": for one combo, the opponents whose next batch is most likely to settle whether
// it is in the best deck (the legal three with the highest summed rating). Pure.
// Design: docs/superpowers/specs/2026-11-24-combo-spot-design.md
import { blockingParts, comboLabel, comboParts, partRefName } from './combo.js';
import { fitModel } from './ratings.js';
import { candidateCombos, enumerateLegalDecks, opponentCombos } from './lineup.js';
import { pairingScores } from './matchups.js';
import { BATCH, LOOKAHEAD_DECKS, UPSET_MIN, phi } from './suggest.js';

// Extra decks that contain the combo, so its best case is always in the look-ahead.
export const SPOT_DECKS = 50;

// Upper envelope of lines y = a + b·z: [{ tag, from, to }] left to right.
export function upperEnvelope(lines) {
  // Lines whose slopes match up to rounding are parallel: keep only the highest.
  const ls = [];
  for (const l of [...lines].sort((x, y) => x.b - y.b)) {
    const last = ls[ls.length - 1];
    if (last && Math.abs(l.b - last.b) <= 1e-12) { if (l.a > last.a) ls[ls.length - 1] = l; }
    else ls.push(l);
  }
  const cross = (l1, l2) => (l1.a - l2.a) / (l2.b - l1.b);
  const hull = [];
  for (const l of ls) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], l) <= cross(hull[hull.length - 2], hull[hull.length - 1])) hull.pop();
    hull.push(l);
  }
  return hull.map((l, i) => ({
    tag: l.tag,
    from: i === 0 ? -Infinity : cross(hull[i - 1], l),
    to: i === hull.length - 1 ? Infinity : cross(l, hull[i + 1]),
  }));
}

const pct = (p) => (p < 0.01 ? 'less than 1%' : `${Math.round(p * 100)}%`);

/**
 * spotTests(state, parts, x) → null (unknown combo) or
 * { x, status: 'in'|'out', rank, rated, untested, notOwned, blockedBy: [{ id, parts }], tests: [{ b, p, n, reason }] }.
 * rank: x's place among rated combos (1 = highest). p: chance n battles vs b flip x in/out of the
 * best deck. Tests with p ≥ UPSET_MIN come first by p; the rest by how much they narrow x's gap to
 * the deck line. Opponents are tested, fully owned, and share no part you have only one of.
 */
export function spotTests(state, parts, x, { k = 3, n = BATCH, maxDecks = LOOKAHEAD_DECKS } = {}) {
  const combos = state.combos ?? [];
  const combosById = new Map(combos.map((c) => [c.id, c]));
  const X = combosById.get(x);
  if (!X) return null;
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const owned = new Set(parts.filter((p) => p.owned).map((p) => p.id));
  const battles = state.battles ?? [];
  const model = fitModel(battles, { extraIds: [x] });
  const { idx, r, Ainv, sigma2 } = model;
  const iX = idx.get(x);
  const rOf = (id) => r[idx.get(id)];

  const untested = !model.n[iX];
  const notOwned = !comboParts(X).every((p) => owned.has(p));
  // Rank among combos that still exist and have battles, plus x.
  const rated = model.ids.filter((id) => combosById.has(id) && (id === x || model.n[idx.get(id)] > 0));
  const rank = 1 + rated.filter((id) => rOf(id) > rOf(x)).length;

  // Decks: the strongest legal decks plus the strongest that contain x.
  const cands = [...new Set([...candidateCombos(state, parts), x])].filter((id) => idx.has(id));
  const all = enumerateLegalDecks(cands, combosById)
    .map((d) => ({ d, s: d.reduce((t, id) => t + rOf(id), 0) }))
    .sort((a, b) => b.s - a.s);
  const decks = all.slice(0, maxDecks);
  for (const d of all.filter((d) => d.d.includes(x)).slice(0, SPOT_DECKS)) if (!decks.includes(d)) decks.push(d);
  const best = decks[0]?.d ?? [];
  const status = best.includes(x) ? 'in' : 'out';

  // Higher-rated x kept out by parts it shares with a deck member.
  const blockedBy = [];
  if (status === 'out' && best.length && rOf(x) > Math.min(...best.map(rOf))) {
    const mine = new Set(comboParts(X));
    for (const id of best) {
      const shared = [...new Set(comboParts(combosById.get(id)))].filter((p) => mine.has(p));
      if (shared.length) blockedBy.push({ id, parts: shared });
    }
  }

  // The combo on the other side of the line from x.
  let T = null;
  if (best.length) {
    if (status === 'out') T = best.reduce((a, b) => (rOf(b) < rOf(a) ? b : a));
    else T = cands.filter((id) => !best.includes(id)).sort((a, b) => rOf(b) - rOf(a))[0] ?? null;
  }

  const label = (id) => comboLabel(combosById.get(id), partsById);
  const opponents = opponentCombos(state).filter((b) => b !== x && idx.has(b)
    && comboParts(combosById.get(b)).every((p) => owned.has(p))
    && !blockingParts(X, combosById.get(b), partsById).length);

  const scored = opponents.map((b) => {
    const iB = idx.get(b);
    const u = Ainv[iX].map((v, j) => v - Ainv[iB][j]);
    const q = u[iX] - u[iB];
    const kz = (n / (1 + n * q)) * Math.sqrt(sigma2 * (1 / n + q));
    let p = 0;
    if (decks.length) {
      const lines = decks.map(({ d, s }) => ({ a: s, b: kz * d.reduce((t, id) => t + u[idx.get(id)], 0), tag: d.includes(x) }));
      for (const seg of upperEnvelope(lines)) if (seg.tag !== (status === 'in')) p += phi(seg.to) - phi(seg.from);
    }
    const cu = T ? u[iX] - u[idx.get(T)] : u[iX];
    const narrow = (sigma2 * n * cu * cu) / (1 + n * q);
    return { b, p: Math.min(1, Math.max(0, p)), narrow, n: pairingScores(battles, x, b).length };
  });
  scored.sort((a, b) => {
    const la = a.p >= UPSET_MIN, lb = b.p >= UPSET_MIN;
    if (la !== lb) return la ? -1 : 1;
    return la ? b.p - a.p || b.narrow - a.narrow : b.narrow - a.narrow;
  });

  let fallbacks = 0;
  const tests = scored.slice(0, k).map(({ b, p, n: nb }) => {
    const so = nb ? ` ${nb} battle${nb === 1 ? '' : 's'} between them so far.` : ' They haven\'t battled yet.';
    let reason;
    if (p >= UPSET_MIN) {
      reason = status === 'out'
        ? `If it does well, ${pct(p)} chance ${n} battles against ${label(b)} put it in your best deck.`
        : `${pct(p)} chance ${n} battles against ${label(b)} knock it out of your best deck if it does badly.`;
    } else {
      reason = fallbacks++ === 0
        ? 'Unlikely to change its spot either way. This one narrows its rating the most.'
        : 'Unlikely to change its spot either way, but it helps pin down its rating.';
    }
    return { b, p, n: nb, reason: reason + so };
  });

  return { x, status, rank, rated: rated.length, untested, notOwned, blockedBy, tests };
}

// The status line in plain words. nameOf: combo id → full name.
export function spotStatus(res, nameOf, partsById) {
  let text;
  if (res.untested) text = 'Not tested yet. These battles will show where it fits.';
  else if (res.status === 'in' && res.notOwned) {
    return `Would make your best deck (rated #${res.rank} of ${res.rated}) once all of ${nameOf(res.x)}'s parts are marked as owned.`;
  } else if (res.status === 'in') text = `In your best deck (rated #${res.rank} of ${res.rated}).`;
  else if (res.blockedBy.length) {
    const b = res.blockedBy[0];
    const shared = b.parts.map((p) => partRefName(partsById, p)).join(' and ');
    text = `Rated #${res.rank}, but it shares ${shared} with ${nameOf(b.id)}, so they can't both be in the deck.`;
  } else text = `Not in your best deck yet (rated #${res.rank} of ${res.rated}).`;
  if (res.notOwned) text += ` Some of ${nameOf(res.x)}'s parts aren't marked as owned, so it can't count for real until they are.`;
  return text;
}
