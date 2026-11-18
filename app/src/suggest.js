// Next-test suggestions. Pure: reads the lineup result and the data, runs no match simulation.
import { blockingParts, comboId, comboParts, comboLabel, validateCombo } from './combo.js';
import { comboFlags, finishBreakdown, pairingScores } from './matchups.js';
import { fitModel, ratingsLeaderboard } from './ratings.js';
import { candidateCombos, enumerateLegalDecks, opponentCombos } from './lineup.js';

export const MAX_SUGGESTIONS = 8;
export const MAX_SCREEN = 3;
export const MAX_FIX = 2;
// Battles per suggested test, and the look-ahead's batch size.
export const BATCH = 10;
// Upsets below this chance of changing the best deck aren't shown.
export const UPSET_MIN = 0.02;
// Legal decks (highest summed rating first) the look-ahead compares.
export const LOOKAHEAD_DECKS = 200;

const withId = (c) => ({ ...c, id: comboId(c) });
const fmt = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;

// Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7).
function phi(z) {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Ratings (uncentred, model order) after n battles of a vs b averaging sbar: a rank-one update
// of the ridge fit, r' = r + n/(1 + n·q) · u · (sbar − μ), with u = A⁻¹(e_a − e_b), q = u_a − u_b.
export function ratingShift(model, a, b, n, sbar) {
  const i = model.idx.get(a), j = model.idx.get(b);
  const u = model.Ainv[i].map((x, k) => x - model.Ainv[j][k]);
  const q = u[i] - u[j];
  const mu = model.r[i] - model.r[j];
  const g = (n / (1 + n * q)) * (sbar - mu);
  return model.r.map((x, k) => x + g * u[k]);
}

// Legal decks of rated, owned combos by summed rating (highest first), at most maxDecks.
function ratedDecks(state, parts, model, maxDecks) {
  const combosById = new Map((state.combos ?? []).map((c) => [c.id, c]));
  const cands = candidateCombos(state, parts).filter((id) => model.idx.has(id));
  const rOf = (id) => model.r[model.idx.get(id)];
  const decks = enumerateLegalDecks(cands, combosById)
    .map((d) => ({ d, s: d.reduce((t, id) => t + rOf(id), 0) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, maxDecks);
  return { cands, decks, combosById };
}

// The deck the look-ahead treats as best: the legal three with the highest summed rating.
export function lookaheadDeck(state, parts, model = fitModel(state.battles), maxDecks = LOOKAHEAD_DECKS) {
  if (!model) return null;
  return ratedDecks(state, parts, model, maxDecks).decks[0]?.d ?? null;
}

/**
 * For every runnable matchup (both combos rated and fully owned, no part you have only one of
 * shared): the chance that n more battles change the best deck (the legal three with the
 * highest summed rating). The batch mean is s̄ ~ N(μ, σ²(1/n + q)), and every deck's summed
 * rating moves linearly in that one normal variable z, so the chance is exact:
 * Φ(z_lo) + 1 − Φ(z_hi). up / down: the deck that takes over if a does better than expected
 * (z > z_hi) / worse (z < z_lo), or null.
 * Returns [{ a, b, p, zlo, zhi, up, down }], highest p first.
 */
export function upsetChances(state, parts, { model = fitModel(state.battles), n = BATCH, maxDecks = LOOKAHEAD_DECKS } = {}) {
  if (!model) return [];
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const { cands, decks, combosById } = ratedDecks(state, parts, model, maxDecks);
  if (decks.length < 2) return [];
  const best = decks[0];
  const out = [];
  for (let x = 0; x < cands.length; x++) for (let y = x + 1; y < cands.length; y++) {
    const a = cands[x], b = cands[y];
    if (blockingParts(combosById.get(a), combosById.get(b), partsById).length) continue;
    const i = model.idx.get(a), j = model.idx.get(b);
    const u = model.Ainv[i].map((v, k) => v - model.Ainv[j][k]);
    const q = u[i] - u[j];
    // Shift of rating k per unit z: kz · u_k.
    const kz = (n / (1 + n * q)) * Math.sqrt(model.sigma2 * (1 / n + q));
    const U = (d) => d.reduce((t, id) => t + u[model.idx.get(id)], 0);
    const uBest = U(best.d);
    let zlo = -Infinity, zhi = Infinity, up = null, down = null;
    for (let k = 1; k < decks.length; k++) {
      const gap = best.s - decks[k].s; // ≥ 0
      const slope = kz * (U(decks[k].d) - uBest);
      if (slope > 1e-12 && gap / slope < zhi) { zhi = gap / slope; up = decks[k].d; }
      else if (slope < -1e-12 && gap / slope > zlo) { zlo = gap / slope; down = decks[k].d; }
    }
    out.push({ a, b, p: phi(zlo) + 1 - phi(zhi), zlo, zhi, up, down });
  }
  return out.sort((x, y) => y.p - x.p);
}

/**
 * Returns at most MAX_SUGGESTIONS of {kind, left, right, battles: 10, reason, replaces}, in kind
 * order: screen (untested owned combos, newest first, at most MAX_SCREEN), upset (runnable
 * matchups by chance of changing the best deck, at least UPSET_MIN), fix (burst/KO part swaps
 * for #1 deck members, at most MAX_FIX). Never pairs combos that share a part.
 */
export function suggestTests(state, parts, lineupResult) {
  const battles = state.battles ?? [];
  const combosById = new Map((state.combos ?? []).map((c) => [c.id, c]));
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const label = (c) => comboLabel(c, partsById);
  const ranked = lineupResult?.ranked ?? [];
  const rows = lineupResult?.ratings ?? ratingsLeaderboard(state);
  const rating = new Map(rows.map((r) => [r.comboId, r]));
  const rOf = (id) => rating.get(id)?.r ?? -Infinity;
  const opponents = opponentCombos(state).sort((a, b) => rOf(b) - rOf(a)); // strongest first
  const top = ranked[0]?.deck ?? [];
  const candidates = candidateCombos(state, parts);
  const owned = parts.filter((p) => p.owned);
  const ownedSet = new Set(owned.map((p) => p.id));
  const nBetween = (a, b) => pairingScores(battles, a, b).length;

  const out = [];
  const seen = new Set();
  const key = (a, b) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);

  // Never suggests two combos that can't both be built at once (a shared part you have only one of).
  function add(kind, left, right, reason, replaces = null) {
    if (!left || !right || left.id === right.id || seen.has(key(left.id, right.id))) return false;
    if (blockingParts(left, right, partsById).length) return false;
    seen.add(key(left.id, right.id));
    out.push({ kind, left, right, battles: BATCH, reason, replaces });
    return true;
  }
  const addPair = (kind, a, b, reason) => add(kind, combosById.get(a), combosById.get(b), reason);
  const sharesParts = (a, b) => blockingParts(combosById.get(a), combosById.get(b), partsById).length > 0;

  // 1. Screen: owned combos with no battles, newest first, against the strongest opponent they
  // share no parts with (else the strongest).
  const tested = new Set(opponents);
  const fresh = (state.combos ?? [])
    .filter((c) => !tested.has(c.id) && comboParts(c).every((p) => ownedSet.has(p)))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  let screens = 0;
  for (const c of fresh) {
    if (screens >= MAX_SCREEN) break;
    // With nothing tested yet, pair new combos with each other.
    const pool = opponents.length ? opponents : fresh.map((x) => x.id);
    const opp = pool.find((o) => o !== c.id && !sharesParts(c.id, o));
    if (opp && addPair('screen', c.id, opp, `${label(c)} hasn't been tested yet — start with the strongest combo it can face.`)) screens++;
  }

  // 2. Fix (added after the upsets): burst-risk / ko-risk part swaps for #1 deck members, at most MAX_FIX.
  const ownedOf = (kind) => owned.filter((p) => p.kind === kind);
  const refDeck = top;
  const field = opponents;

  // The opponent that took the most points off this combo, among those the swapped combo
  // shares no parts with.
  function mostDangerous(comboIdValue, swapped) {
    const ok = (f) => f !== comboIdValue && f !== swapped.id && combosById.has(f) && !blockingParts(swapped, combosById.get(f), partsById).length;
    let best = null;
    let bestPts = 0;
    for (const f of field) {
      if (!ok(f)) continue;
      const pts = pairingScores(battles, f, comboIdValue).reduce((s, x) => s + Math.max(x, 0), 0);
      if (pts > bestPts) { best = f; bestPts = pts; }
    }
    return combosById.get(best) ?? combosById.get(field.find(ok));
  }

  // Candidate replacement combos: another owned bit first (ratchet nulled for integrated bits),
  // then another owned ratchet. Parts used by the rest of the reference deck are avoided first.
  function swapOptions(combo) {
    const others = new Set(refDeck.filter((id) => id !== combo.id).flatMap((id) => (combosById.has(id) ? comboParts(combosById.get(id)) : [])));
    const fieldIds = new Set(field);
    const inField = new Set(field.filter((id) => id !== combo.id).flatMap((id) => (combosById.has(id) ? comboParts(combosById.get(id)) : [])));
    const ok = (c) => !validateCombo(c, partsById) && !fieldIds.has(comboId(c)) && comboId(c) !== combo.id;
    const bladeBuiltIn = combo.blade.type === 'single' && partsById.get(combo.blade.bladeId)?.builtInRatchet;
    const bits = [];
    for (const bit of ownedOf('bit')) {
      if (bit.id === combo.bit) continue;
      const noRatchet = bladeBuiltIn || bit.ratchetIntegrated;
      const ratchets = noRatchet ? [null] : [combo.ratchet, ...ownedOf('ratchet').map((r) => r.id)].filter((r, i, a) => r && a.indexOf(r) === i);
      for (const ratchet of ratchets) {
        const c = withId({ ...combo, ratchet, bit: bit.id });
        if (ok(c)) { bits.push({ c, what: 'bit', clash: comboParts(c).filter((p) => others.has(p)).length, field: comboParts(c).filter((p) => inField.has(p)).length }); break; }
      }
    }
    const ratchets = [];
    if (combo.ratchet && !(partsById.get(combo.bit)?.ratchetIntegrated)) {
      for (const r of ownedOf('ratchet')) {
        if (r.id === combo.ratchet) continue;
        const c = withId({ ...combo, ratchet: r.id });
        if (ok(c)) ratchets.push({ c, what: 'ratchet', clash: comboParts(c).filter((p) => others.has(p)).length, field: comboParts(c).filter((p) => inField.has(p)).length });
      }
    }
    const byClash = (a, b) => a.clash - b.clash || a.field - b.field;
    // Fewest clashes with the reference deck, then fewest with the field, then bit before ratchet.
    return [...bits, ...ratchets].sort(byClash);
  }

  const fixes = [];
  for (const combo of state.combos ?? []) {
    if (!top.includes(combo.id)) continue;
    const br = finishBreakdown(battles, combo.id);
    const flags = comboFlags(br);
    const burst = flags.includes('burst-risk');
    const ko = flags.includes('ko-risk');
    if (!burst && !ko) continue;
    const swap = swapOptions(combo)[0];
    const right = swap && mostDangerous(combo.id, swap.c);
    if (!swap || !right) continue;
    const text = burst
      ? `was burst in ${br.lost.burst} of ${br.n} battles`
      : `was knocked out (Pocket or Xtreme) in ${br.lost.pocket + br.lost.xtreme} of ${br.n} battles`;
    fixes.push({ left: swap.c, right, reason: `${label(combo)} ${text} — test a different ${swap.what}.`, replaces: combo.id });
  }

  // 3. Upset: the matchups most likely to change the best deck. Room is kept for the fixes there are.
  const upsetRoom = () => MAX_SUGGESTIONS - out.length - Math.min(MAX_FIX, fixes.length);
  const model = fitModel(battles);
  const bestNow = model ? lookaheadDeck(state, parts, model) : null;
  const nameOf = (id) => label(combosById.get(id));
  const list = (ids) => ids.map(nameOf).join(' and ');
  // "If A does well, X could replace Y." from the deck that would take over.
  const change = (who, how, deck) => {
    if (!deck || !bestNow) return '';
    const inn = deck.filter((id) => !bestNow.includes(id));
    const out = bestNow.filter((id) => !deck.includes(id));
    const incoming = inn.length === 1 && inn[0] === who ? 'it' : list(inn);
    return inn.length ? ` If ${nameOf(who)} does ${how}, ${incoming} could replace ${list(out)}.` : '';
  };
  for (const { a, b, p, up, down } of upsetChances(state, parts, { model })) {
    if (p < UPSET_MIN || upsetRoom() <= 0) break;
    const ra = rating.get(a), rb = rating.get(b);
    const n = nBetween(a, b);
    const desc = (id, r) => `${nameOf(id)} ${fmt(r.r)} [${fmt(r.lo)}, ${fmt(r.hi)}]`;
    addPair('upset', a, b, `${Math.round(p * 100)}% chance this changes your best deck.${change(a, 'well', up)}${change(a, 'badly', down)} Ratings: ${desc(a, ra)}, ${desc(b, rb)}; ${n ? `${n} battle${n === 1 ? '' : 's'} between them so far` : 'they haven\'t met yet'}.`);
  }

  let fixCount = 0;
  for (const f of fixes) if (fixCount < MAX_FIX && add('fix', f.left, f.right, f.reason, f.replaces)) fixCount++;

  return out.slice(0, MAX_SUGGESTIONS);
}
