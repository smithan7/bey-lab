// Next-test suggestions. Pure: reads the lineup result and the data, runs no simulation.
import { comboId, comboLabel, comboParts, deckClashes, validateCombo } from './combo.js';
import { comboFlags, finishBreakdown, pairingDistribution, pairingScores } from './matchups.js';
import { matchupStats } from './stats.js';
import { candidateCombos, comboLeaderboard, fieldCombos, missingPairings } from './lineup.js';

export const MAX_SUGGESTIONS = 8;
export const NARROW_WIDTH = 1.5;
export const NARROW_MAX_N = 30;
const BATTLES = 10;

// Maps a part kind to the cx blade field that holds it.
const CX_FIELD = {
  lock_chip: 'lockChip', main_blade: 'mainBlade', over_blade: 'overBlade',
  metal_blade: 'metalBlade', assist_blade: 'assistBlade',
};

const withId = (c) => ({ ...c, id: comboId(c) });

/**
 * options: { rng, draws, raceSims } are passed to the combo leaderboard (stage 2 only uses
 * its t-interval, so the defaults of 0 skip the Monte Carlo work).
 * Returns at most MAX_SUGGESTIONS of {kind, left, right, battles: 10, reason, replaces}.
 */
export function suggestTests(state, parts, lineupResult, { rng, draws = 0, raceSims = 0 } = {}) {
  const battles = state.battles ?? [];
  const combosById = new Map((state.combos ?? []).map((c) => [c.id, c]));
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const name = (id) => partsById.get(id)?.displayName || partsById.get(id)?.name || id;
  const label = (c) => comboLabel(c, partsById);
  const lineup = lineupResult ?? { ranked: [], blocked: [] };
  const ranked = lineup.ranked ?? [];
  const blocked = lineup.blocked ?? [];

  const field = fieldCombos(state);
  const coreField = (state.field ?? []).filter((f) => f.active && f.core).map((f) => f.comboId);
  const activeNonCore = (state.field ?? []).filter((f) => f.active && !f.core).map((f) => f.comboId);

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

  const addPair = (kind, a, b, reason) => {
    const left = combosById.get(a);
    const right = combosById.get(b);
    if (left && right) add(kind, left, right, reason);
  };

  // 1. Baseline: missing pairings among core field combos.
  for (let i = 0; i < coreField.length; i++) {
    for (let j = i + 1; j < coreField.length; j++) {
      const [a, b] = [coreField[i], coreField[j]];
      if (pairingDistribution(battles, a, b)) continue;
      const [ca, cb] = [combosById.get(a), combosById.get(b)];
      if (ca && cb) addPair('baseline', a, b, `No battles yet between ${label(ca)} and ${label(cb)} — a baseline matchup.`);
    }
  }

  // 2. Blocking: missing pairings that keep the first few blocked decks from being ranked.
  for (const b of blocked.slice(0, 3)) {
    const deckText = b.deck.map((id) => (combosById.has(id) ? label(combosById.get(id)) : id)).join(' / ');
    for (const [x, y] of b.missing) {
      addPair('blocking', x, y, `Missing data is blocking the deck ${deckText} from being ranked.`);
    }
  }

  // 3. Stage 1: candidates missing any core pairing.
  const candidates = candidateCombos(state, parts);
  for (const c of candidates) {
    for (const [x, y] of missingPairings([c], coreField, battles)) {
      addPair('stage1', x, y, `${label(combosById.get(c))} has not faced every core field combo yet.`);
    }
  }

  // 4. Stage 2: candidates whose EV interval overlaps the top deck's member EV range.
  if (ranked.length && activeNonCore.length) {
    const lb = new Map(comboLeaderboard(state, { rng, draws, raceSims }).map((r) => [r.comboId, r]));
    const top = ranked[0].deck;
    const evs = top.filter((id) => lb.has(id)).map((id) => lb.get(id).ev);
    if (evs.length) {
      const [lo, hi] = [Math.min(...evs), Math.max(...evs)];
      for (const c of candidates) {
        const row = lb.get(c);
        if (top.includes(c) || !row || !Array.isArray(row.evCI) || row.evCI.some((x) => x == null || Number.isNaN(x)) || row.evCI[1] < lo || row.evCI[0] > hi) continue;
        for (const [x, y] of missingPairings([c], activeNonCore, battles)) {
          addPair('stage2', x, y, `${label(combosById.get(c))} is close to the top deck's combos but has not faced every other field combo.`);
        }
      }
    }
  }

  // 5a. Fixes for burst-risk / ko-risk combos.
  const owned = parts.filter((p) => p.owned);
  const ownedOf = (kind) => owned.filter((p) => p.kind === kind);
  const refDeck = ranked[0]?.deck ?? blocked[0]?.deck ?? [];

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
    if (!candidates.includes(combo.id)) continue;
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

  // 5b. Fix an illegal field using owned parts (including ratchet-integrated bits). Added before the
  // burst/ko fixes: an illegal field makes every other result moot, and the 8-suggestion cap could drop it.
  const fieldObjs = field.map((id) => combosById.get(id)).filter(Boolean);
  const battleCount = (id) => battles.filter((b) => b.left === id || b.right === id).length;
  for (const clash of deckClashes(fieldObjs)) {
    const fix = fixClash(clash);
    if (fix) add('fix', fix.left, fix.right, fix.reason, fix.replaces);
  }

  for (const f of fixes) add('fix', f.left, f.right, f.reason, f.replaces);

  // Each clash is fixed independently against the original field; with several clashes, applying
  // one fix does not necessarily make the whole field legal.
  function fixClash({ partId, comboIds }) {
    const kind = partsById.get(partId)?.kind;
    const before = new Set(deckClashes(fieldObjs).map((c) => c.partId));
    // Replace in the combo with the least data first; ties go to the later field entry.
    const order = comboIds.map((id, i) => ({ id, i })).sort((a, b) => battleCount(a.id) - battleCount(b.id) || b.i - a.i);
    for (const { id } of order) {
      const combo = combosById.get(id);
      const usedElsewhere = new Set(fieldObjs.filter((c) => c.id !== id).flatMap(comboParts));
      const free = (p) => p.id !== partId && !usedElsewhere.has(p.id) && !comboParts(combo).includes(p.id);
      for (const c of replacements(combo, partId, kind, free, usedElsewhere)) {
        if (validateCombo(c, partsById)) continue;
        const next = fieldObjs.map((f) => (f.id === id ? c : f));
        const after = deckClashes(next).map((x) => x.partId);
        if (after.some((p) => !before.has(p) || p === partId)) continue;
        const right = next.find((f) => f.id !== c.id && !comboParts(f).some((p) => comboParts(c).includes(p))) ?? next.find((f) => f.id !== c.id);
        return {
          left: c, right, replaces: id,
          reason: `${label(combo)} shares ${name(partId)} with another field combo, so the field is not a legal deck — test ${label(c)} instead.`,
        };
      }
    }
    return null;
  }

  function* replacements(combo, partId, kind, free, usedElsewhere) {
    const b = combo.blade;
    if (kind === 'blade' && b.type === 'single') {
      for (const p of ownedOf('blade').filter(free)) {
        const noRatchet = p.builtInRatchet || partsById.get(combo.bit)?.ratchetIntegrated;
        if (noRatchet || combo.ratchet) {
          yield withId({ ...combo, blade: { ...b, bladeId: p.id }, ratchet: noRatchet ? null : combo.ratchet });
        } else {
          // The old blade had a built-in ratchet; the new one needs an owned ratchet that doesn't clash.
          const usedHere = new Set(comboParts(combo));
          for (const r of ownedOf('ratchet').filter((x) => !usedElsewhere.has(x.id) && !usedHere.has(x.id))) {
            yield withId({ ...combo, blade: { ...b, bladeId: p.id }, ratchet: r.id });
          }
        }
      }
    } else if (CX_FIELD[kind] && b.type === 'cx') {
      for (const p of ownedOf(kind).filter(free)) yield withId({ ...combo, blade: { ...b, [CX_FIELD[kind]]: p.id } });
    } else if (kind === 'ratchet') {
      for (const p of ownedOf('ratchet').filter(free)) yield withId({ ...combo, ratchet: p.id });
      for (const p of ownedOf('bit').filter((x) => x.ratchetIntegrated && free(x))) yield withId({ ...combo, ratchet: null, bit: p.id });
    } else if (kind === 'bit') {
      for (const p of ownedOf('bit').filter(free)) {
        yield withId({ ...combo, ratchet: p.ratchetIntegrated ? null : combo.ratchet, bit: p.id });
      }
    }
  }

  // 6. Narrow: pairings inside the top deck whose EV interval is still too wide.
  if (ranked.length) {
    for (const a of ranked[0].deck) {
      for (const f of field) {
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
