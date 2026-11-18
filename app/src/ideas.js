// New combos and variants worth testing, built only from owned parts and scored by WBO tournament
// results (beywatch.gg) and packaging stats (how well a part suits the blade's type).
// Pure; runs in Node and the browser.
import { comboId, comboLabel, partRefName, validateCombo } from './combo.js';

export const TIER_VALUE = { X: 1, S: 0.8, A: 0.6, B: 0.4, C: 0.2 };
const SMALL_SAMPLE = 0.35; // beywatch "?" tier: fewer than 60 top-3 finishes
const NO_RESULTS = 0.25;
const NO_STATS = 0.3;
// Rough top of each kind's packaging scale, so stats compare across kinds.
const SCALE = { blade: 70, main_blade: 70, ratchet: 20, bit: 55 };

const metaValue = (p) => (!p?.meta ? NO_RESULTS : p.meta.tier === '?' ? SMALL_SAMPLE : TIER_VALUE[p.meta.tier] ?? NO_RESULTS);

// How well a ratchet's or bit's packaging stats suit a blade of this type, 0..1.
function fit(p, type) {
  const s = p?.stats;
  if (!s) return NO_STATS;
  const scale = SCALE[p.kind] ?? 50;
  const a = s.attack ?? 0, d = s.defense ?? 0, st = s.stamina ?? 0;
  let v;
  if (type === 'attack') v = s.dash != null ? 0.6 * a + 0.4 * s.dash : a;
  else if (type === 'stamina') v = st;
  else if (type === 'defense') v = s.burst != null ? 0.7 * d + 0.3 * (s.burst * scale / 100) : d;
  else v = (a + d + st) / 3;
  return Math.max(0, Math.min(1, v / scale));
}

// A part's value on a blade of this type: mostly tournament results, partly packaging stats.
export function partScore(p, type) {
  return 0.6 * metaValue(p) + 0.4 * fit(p, type);
}

function bladeType(combo, partsById) {
  const b = combo.blade;
  const id = b.type === 'single' ? b.bladeId : b.mainBlade ?? b.overBlade;
  return partsById.get(id)?.type ?? 'balance';
}

function metaCombo(combo, reference) {
  if (combo.blade.type !== 'single') return null;
  return (reference?.combos ?? []).find((m) => m.blade === combo.blade.bladeId && (m.ratchet ?? null) === (combo.ratchet ?? null) && m.bit === combo.bit) ?? null;
}

function comboScore(combo, partsById, reference) {
  const type = bladeType(combo, partsById);
  const r = combo.ratchet ? partScore(partsById.get(combo.ratchet), type) : 0.5;
  const bit = partScore(partsById.get(combo.bit), type);
  const blade = combo.blade.type === 'single' ? 0.5 * metaValue(partsById.get(combo.blade.bladeId)) : 0.25;
  const m = metaCombo(combo, reference);
  return r + bit + blade + (m ? 0.5 + (TIER_VALUE[m.tier] ?? SMALL_SAMPLE) : 0);
}

const pct = (x) => `${Math.round(x * 100)}%`;
function statLine(p) {
  const s = p?.stats;
  if (!s) return '';
  const bits = [['attack', 'Attack'], ['defense', 'Defense'], ['stamina', 'Stamina'], ['dash', 'Dash'], ['burst', 'Burst']]
    .filter(([k]) => s[k] != null).map(([k, n]) => `${n} ${s[k]}`);
  return bits.join(', ');
}
function partFact(p, partsById) {
  const name = partRefName(partsById, p.id);
  const meta = p.meta
    ? p.meta.tier === '?' ? `${name} has only a few WBO top-3 finishes (${p.meta.cuts})` : `${name} is ${p.meta.tier} tier at WBO events (${pct(p.meta.firstRate)} 1st, ${p.meta.cuts.toLocaleString('en-US')} top-3 finishes)`
    : `${name} has no WBO results yet`;
  const st = statLine(p);
  return st ? `${meta}; packaging stats ${st}` : meta;
}

function reasonFor(combo, partsById, reference, changed = ['ratchet', 'bit']) {
  const m = metaCombo(combo, reference);
  const label = comboLabel(combo, partsById);
  if (m) return `${label} is a top WBO combo (${m.tier} tier, ${m.cuts.toLocaleString('en-US')} top-3 finishes, ${pct(m.firstRate)} 1st) and you own every part.`;
  const type = bladeType(combo, partsById);
  const facts = changed.map((k) => combo[k]).filter(Boolean).map((id) => partFact(partsById.get(id), partsById));
  const an = `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} blade`;
  const fits = changed.map((k) => combo[k]).filter(Boolean).map((id) => fit(partsById.get(id), type));
  const avg = fits.length ? fits.reduce((a, b) => a + b, 0) / fits.length : NO_STATS;
  const verdict = avg >= 0.45 ? `A good fit for ${an}.` : `Its stats don't lean towards ${an}, so this rests on its WBO results.`;
  return `${facts.join('. ')}. ${verdict}`;
}

// Every combo of this blade with owned ratchets and bits (respecting built-in ratchets and
// ratchet-integrated bits) that isn't one you already have.
function* buildsFor(blade, owned, partsById, existing) {
  const builtIn = blade.type === 'single' && partsById.get(blade.bladeId)?.builtInRatchet;
  const ratchets = owned.filter((p) => p.kind === 'ratchet');
  for (const bit of owned.filter((p) => p.kind === 'bit')) {
    const rs = builtIn || bit.ratchetIntegrated ? [null] : ratchets.map((r) => r.id);
    for (const ratchet of rs) {
      const c = { blade, ratchet, bit: bit.id };
      const full = { ...c, id: comboId(c) };
      if (existing.has(full.id) || validateCombo(full, partsById)) continue;
      yield full;
    }
  }
}

/**
 * The best untried combo for each owned single blade, highest score first: [{ combo, score, reason }].
 */
export function comboIdeas(state, parts, { limit = 2, reference } = {}) {
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const owned = parts.filter((p) => p.owned);
  const existing = new Set((state.combos ?? []).map((c) => c.id));
  const out = [];
  for (const b of owned.filter((p) => p.kind === 'blade' && !p.cxPreset)) {
    let best = null;
    for (const combo of buildsFor({ type: 'single', bladeId: b.id }, owned, partsById, existing)) {
      const score = comboScore(combo, partsById, reference);
      if (!best || score > best.score) best = { combo, score };
    }
    if (!best) continue;
    const r = reasonFor(best.combo, partsById, reference);
    out.push({ ...best, reason: metaCombo(best.combo, reference) ? r : `Try ${comboLabel(best.combo, partsById)}. ${r}` });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

/**
 * Up to k new variants of a combo (same blade; owned ratchet and/or bit swapped), best first.
 * At least one swaps a single part, when any does, so there's always a simple change to try.
 * Returns [{ combo, score, reason }].
 */
export function variantsFor(combo, state, parts, { k = 3, reference } = {}) {
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const owned = parts.filter((p) => p.owned);
  const existing = new Set([combo.id, ...(state.combos ?? []).map((c) => c.id)]);
  const all = [...buildsFor(combo.blade, owned, partsById, existing)].map((c) => {
    const changed = ['ratchet', 'bit'].filter((key) => c[key] !== combo[key]);
    return { combo: c, changed, score: comboScore(c, partsById, reference) };
  }).sort((x, y) => y.score - x.score);
  const pick = all.slice(0, k);
  const single = all.find((v) => v.changed.length === 1);
  if (single && !pick.some((v) => v.changed.length === 1)) pick[pick.length - 1] = single;
  return pick.sort((x, y) => y.score - x.score).map(({ combo: c, changed, score }) => {
    const swaps = changed.map((key) => `${partRefName(partsById, combo[key]) ?? 'none'} → ${partRefName(partsById, c[key]) ?? 'none'}`).join(', ');
    return { combo: c, score, reason: `Swap ${swaps}. ${reasonFor(c, partsById, reference, changed)}` };
  });
}
