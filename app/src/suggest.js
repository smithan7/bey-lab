// Next-test suggestions. Pure: reads the lineup result and the data, runs no simulation.
import { comboId, comboParts, comboLabel, partRefName, validateCombo } from './combo.js';
import { comboFlags, finishBreakdown, pairingScores } from './matchups.js';
import { matchupStats } from './stats.js';
import { ratingsLeaderboard } from './ratings.js';
import { candidateCombos, opponentCombos } from './lineup.js';

export const MAX_SUGGESTIONS = 8;
export const MAX_SCREEN = 3;
export const UNDER_TESTED = 5;
export const NARROW_WIDTH = 1.5;
export const NARROW_MAX_N = 30;
const BATTLES = 10;

const withId = (c) => ({ ...c, id: comboId(c) });
const fmt = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;

/**
 * Returns at most MAX_SUGGESTIONS of {kind, left, right, battles: 10, reason, replaces}, in kind
 * order: screen (untested owned combos, newest first, at most MAX_SCREEN), contender (combos whose
 * rating range reaches the #1 deck), topcheck (#1 deck members thinly tested against strong
 * opponents), fix (burst/KO part swaps for #1 members and contenders), narrow (#1 deck pairings
 * still uncertain). Combos rated entirely below the #1 deck get no suggestions of their own.
 */
export function suggestTests(state, parts, lineupResult) {
  const battles = state.battles ?? [];
  const combosById = new Map((state.combos ?? []).map((c) => [c.id, c]));
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const name = (id) => partRefName(partsById, id);
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

  function add(kind, left, right, reason, replaces = null) {
    if (!left || !right || left.id === right.id || seen.has(key(left.id, right.id))) return false;
    seen.add(key(left.id, right.id));
    const rp = new Set(comboParts(right));
    const shared = [...new Set(comboParts(left))].filter((p) => rp.has(p));
    const note = shared.length ? ` (needs two of ${shared.map(name).join(', ')})` : '';
    out.push({ kind, left, right, battles: BATTLES, reason: reason + note, replaces });
    return true;
  }
  const addPair = (kind, a, b, reason) => add(kind, combosById.get(a), combosById.get(b), reason);
  const sharesParts = (a, b) => {
    const pa = new Set(comboParts(combosById.get(a)));
    return comboParts(combosById.get(b)).some((p) => pa.has(p));
  };

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
    const opp = pool.find((o) => o !== c.id && !sharesParts(c.id, o)) ?? pool.find((o) => o !== c.id);
    if (opp && addPair('screen', c.id, opp, `${label(c)} hasn't been tested yet — start with the strongest combo it can face.`)) screens++;
  }

  // 2. Contender: tested owned combos outside the #1 deck whose range reaches its weakest member.
  const threshold = top.length ? Math.min(...top.map(rOf)) : -Infinity;
  const contenders = candidates
    .filter((c) => !top.includes(c) && rating.has(c) && rating.get(c).hi >= threshold)
    .sort((a, b) => rating.get(b).hi - rating.get(a).hi);
  for (const c of contenders) {
    const row = rating.get(c);
    const unfaced = opponents.find((o) => o !== c && nBetween(c, o) === 0);
    if (unfaced) {
      addPair('contender', c, unfaced, `${label(combosById.get(c))} could make the best deck (rating ${fmt(row.r)}, up to ${fmt(row.hi)}) but hasn't faced ${label(combosById.get(unfaced))}.`);
    } else {
      const least = opponents.filter((o) => o !== c).sort((a, b) => nBetween(c, a) - nBetween(c, b) || rOf(b) - rOf(a))[0];
      if (least) addPair('contender', c, least, `${label(combosById.get(c))} could make the best deck (rating ${fmt(row.r)}, up to ${fmt(row.hi)}) — more battles against ${label(combosById.get(least))} will settle it.`);
    }
  }

  // 3. Top-deck check: #1 deck members with few battles against the strongest opponents.
  const checks = [];
  for (const a of top) for (const o of opponents) {
    if (o === a) continue;
    const n = nBetween(a, o);
    if (n < UNDER_TESTED) checks.push({ a, o, n });
  }
  checks.sort((x, y) => rOf(y.o) - rOf(x.o));
  for (const { a, o, n } of checks) {
    addPair('topcheck', a, o, `${label(combosById.get(a))} is in the best deck but has ${n === 0 ? 'no battles' : `only ${n} battle${n === 1 ? '' : 's'}`} against ${label(combosById.get(o))} (rated ${fmt(rOf(o))}).`);
  }

  // 4. Fix: burst-risk / ko-risk part swaps, only for #1 deck members and contenders.
  const ownedOf = (kind) => owned.filter((p) => p.kind === kind);
  const refDeck = top;
  const field = opponents;

  function mostDangerous(comboIdValue) {
    let best = null;
    let bestPts = 0;
    for (const f of field) {
      if (f === comboIdValue) continue;
      const pts = pairingScores(battles, f, comboIdValue).reduce((s, x) => s + Math.max(x, 0), 0);
      if (pts > bestPts) { best = f; bestPts = pts; }
    }
    return combosById.get(best) ?? combosById.get(field.find((f) => f !== comboIdValue));
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
    if (!top.includes(combo.id) && !contenders.includes(combo.id)) continue;
    const br = finishBreakdown(battles, combo.id);
    const flags = comboFlags(br);
    const burst = flags.includes('burst-risk');
    const ko = flags.includes('ko-risk');
    if (!burst && !ko) continue;
    const swap = swapOptions(combo)[0];
    const right = mostDangerous(combo.id);
    if (!swap || !right) continue;
    const text = burst
      ? `was burst in ${br.lost.burst} of ${br.n} battles`
      : `was knocked out (Pocket or Xtreme) in ${br.lost.pocket + br.lost.xtreme} of ${br.n} battles`;
    fixes.push({ left: swap.c, right, reason: `${label(combo)} ${text} — test a different ${swap.what}.`, replaces: combo.id });
  }

  for (const f of fixes) add('fix', f.left, f.right, f.reason, f.replaces);

  // 5. Narrow: #1 deck pairings whose EV interval is still too wide.
  if (ranked.length) {
    for (const a of ranked[0].deck) {
      for (const f of opponents) {
        if (a === f) continue;
        const scores = pairingScores(battles, a, f);
        if (scores.length === 0 || scores.length >= NARROW_MAX_N) continue;
        const { evCI } = matchupStats(scores, { draws: 0, raceSims: 0 });
        // A single battle gives no interval at all, which counts as narrow.
        if (scores.length < 2 || !evCI || evCI[1] - evCI[0] > NARROW_WIDTH) {
          const [ca, cf] = [combosById.get(a), combosById.get(f)];
          if (ca && cf) add('narrow', ca, cf, `${label(ca)} vs ${label(cf)} is still uncertain after ${scores.length} battles.`);
        }
      }
    }
  }

  return out.slice(0, MAX_SUGGESTIONS);
}
