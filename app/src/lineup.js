// Lineup ranking and per-combo leaderboard. Pure; runs in Node and the browser.
import { comboParts, isLegalDeck } from './combo.js';
import { pairingDistribution, pairingScores } from './matchups.js';
import { matchWinPoint, matchWinPosterior } from './sim.js';
import { matchupStats } from './stats.js';
import { makeRng, shuffle } from './rng.js';

export const SCREEN_MATCHES = 1000;
export const REFINE_OUTER = 200;
export const REFINE_INNER = 50;
export const TOP_N = 5;
// Cap on field decks simulated per candidate deck, so ranking stays fast as the field grows.
export const MAX_FIELD_DECKS = 10;
// A fixed lead is only recommended if it beats random order by at least this much.
export const LEAD_MIN_GAIN = 0.02;
const BLOCKED_N = 5;
const LEADS = [0, 1, 2];
const TARGETS = { target5: 5, target7: 7 };

const byIdMap = (combos) => new Map((combos ?? []).map((c) => [c.id, c]));

function triples(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      for (let k = j + 1; k < ids.length; k++) out.push([ids[i], ids[j], ids[k]]);
  return out;
}

// Combos whose physical parts are all owned and that have at least one battle.
export function candidateCombos(state, parts) {
  const owned = new Set(parts.filter((p) => p.owned).map((p) => p.id));
  const tested = new Set();
  for (const b of state.battles ?? []) { tested.add(b.left); tested.add(b.right); }
  return (state.combos ?? [])
    .filter((c) => tested.has(c.id) && comboParts(c).every((p) => owned.has(p)))
    .map((c) => c.id);
}

export function fieldCombos(state) {
  return (state.field ?? []).filter((f) => f.active).map((f) => f.comboId);
}

// Every 3-subset of the field, legal or not. Fewer than 3 combos gives [].
export function fieldDecks(fieldIds) {
  return triples(fieldIds);
}

// All field decks when there are at most MAX_FIELD_DECKS, else a seeded sample of that many
// (the order of the sample comes from rng, so it is deterministic for a given seed).
export function sampleFieldDecks(fieldIds, rng) {
  const all = triples(fieldIds);
  return all.length <= MAX_FIELD_DECKS ? all : shuffle(rng, all).slice(0, MAX_FIELD_DECKS);
}

export function enumerateLegalDecks(candidateIds, combosById) {
  const get = (id) => (combosById instanceof Map ? combosById.get(id) : combosById[id]);
  return triples(candidateIds).filter((d) => isLegalDeck(d.map(get)));
}

// Pairings (member vs field combo) with no data. Mirrors never count; each unordered pairing appears once.
export function missingPairings(deck, fieldIds, battles) {
  const seen = new Set();
  const out = [];
  for (const a of deck) for (const b of fieldIds) {
    if (a === b) continue;
    const key = a < b ? `${a}\n${b}` : `${b}\n${a}`;
    if (seen.has(key) || pairingDistribution(battles, a, b)) continue;
    seen.add(key);
    out.push([a, b]);
  }
  return out;
}

// Per-combo "average EV vs field": each combo's battles against active field combos
// (excluding itself) pooled through matchupStats. Combos with no such battles are left out.
export function comboLeaderboard(state, { rng = makeRng(Date.now()), draws, raceSims } = {}) {
  const field = fieldCombos(state);
  const battles = state.battles ?? [];
  const rows = [];
  for (const c of state.combos ?? []) {
    const opps = field.filter((f) => f !== c.id);
    let scores = [];
    let tested = 0;
    for (const f of opps) {
      const s = pairingScores(battles, c.id, f);
      if (s.length) tested++;
      scores = scores.concat(s);
    }
    if (!scores.length) continue;
    const st = matchupStats(scores, { rng, draws, raceSims });
    rows.push({ comboId: c.id, ev: st.ev, evCI: st.evCI, pEvNeg: st.pEvNeg, tested, of: opps.length, n: st.n });
  }
  return rows.sort((a, b) => b.ev - a.ev);
}

const matrix = (battles, deck, fd) => deck.map((a) => fd.map((b) => pairingDistribution(battles, a, b)));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Posterior P(match win) averaged across field decks: p, lo and hi are each the mean
// of the per-field-deck values (an approximation to the interval of the average).
function refine(mats, target, lead, rng, outer, inner) {
  const rs = mats.map((m) => matchWinPosterior(m, target, { rng, outer, inner, lead }));
  return { p: mean(rs.map((r) => r.p)), lo: mean(rs.map((r) => r.lo)), hi: mean(rs.map((r) => r.hi)) };
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// Lead choice with common random numbers: every lead (and random order) replays the same
// rng stream, so differences reflect the lead rather than Monte Carlo noise.
function decideLead(mats, target, seed, matches) {
  const at = (lead) => mean(mats.map((m) => matchWinPoint(m, target, { rng: makeRng(seed), matches, lead })));
  const pNull = at(null);
  let best = null;
  for (const lead of LEADS) {
    const p = at(lead);
    if (!best || p > best.p) best = { lead, p };
  }
  const leadGain = best.p - pNull;
  return { lead: leadGain >= LEAD_MIN_GAIN ? best.lead : null, leadGain };
}

// True only when the best first-to-7 deck beats the best first-to-5 deck at first to 7 by
// more than 2 standard errors. se is taken from the refined 95% interval over `outer` draws.
export function decideDiffers(ranked, { outer = REFINE_OUTER } = {}) {
  if (!ranked.length) return false;
  const top5 = ranked[0];
  const top7 = ranked.reduce((a, b) => (b.best.target7.p > a.best.target7.p ? b : a));
  if (top7 === top5 || sameSet(top7.deck, top5.deck)) return false;
  const se = (r) => ((r.hi - r.lo) / 3.92) / Math.sqrt(outer);
  const gap = top7.best.target7.p - top5.best.target7.p;
  return gap > 2 * Math.hypot(se(top7.best.target7), se(top5.best.target7));
}

/**
 * Ranks legal decks of owned, tested combos against the active field.
 * Field decks: every 3-subset of the field, sampled down to MAX_FIELD_DECKS (seeded by rng).
 * ranked: the TOP_N decks by screened first-to-5 P(win), refined, sorted by refined
 *   best.target5.p descending. `lead` is an index into `deck`, or null when no lead beats
 *   random order by LEAD_MIN_GAIN (then best equals randomOrder). `differs` (same on
 *   every entry) comes from decideDiffers.
 * blocked: legal decks with missing pairings, fewest missing first.
 */
export function rankLineups(state, parts, {
  rng = makeRng(Date.now()),
  screenMatches = SCREEN_MATCHES, refineOuter = REFINE_OUTER, refineInner = REFINE_INNER, topN = TOP_N,
  leaderboardOptions = { draws: 200, raceSims: 200 },
} = {}) {
  const combosById = byIdMap(state.combos);
  const battles = state.battles ?? [];
  const field = fieldCombos(state);
  const fds = sampleFieldDecks(field, rng);
  const fieldLegal = isLegalDeck(field.map((id) => combosById.get(id)).filter(Boolean));

  const legal = enumerateLegalDecks(candidateCombos(state, parts), combosById);
  const rankable = [];
  const notRankable = [];
  for (const deck of legal) {
    const missing = missingPairings(deck, field, battles);
    (missing.length ? notRankable : rankable).push({ deck, missing });
  }

  let ranked = [];
  if (fds.length) {
    // Screening: deck quality under its best lead at first to 5.
    const screened = rankable.map(({ deck }) => {
      const mats = fds.map((fd) => matrix(battles, deck, fd));
      let p5 = -Infinity;
      for (const lead of LEADS) {
        p5 = Math.max(p5, mean(mats.map((m) => matchWinPoint(m, 5, { rng, matches: screenMatches, lead }))));
      }
      return { deck, mats, p5 };
    });
    screened.sort((a, b) => b.p5 - a.p5);
    ranked = screened.slice(0, topN).map(({ deck, mats }) => {
      const out = { deck, best: {}, randomOrder: {} };
      const seed = Math.floor(rng() * 4294967296);
      for (const [t, target] of Object.entries(TARGETS)) {
        const random = refine(mats, target, null, rng, refineOuter, refineInner);
        const { lead, leadGain } = decideLead(mats, target, seed, 3 * screenMatches);
        out.randomOrder[t] = random;
        out.best[t] = { lead, leadGain, ...(lead == null ? random : refine(mats, target, lead, rng, refineOuter, refineInner)) };
      }
      return out;
    });
    ranked.sort((a, b) => b.best.target5.p - a.best.target5.p);
    const differs = decideDiffers(ranked, { outer: refineOuter });
    for (const r of ranked) r.differs = differs;
  }

  let blocked = [];
  if (notRankable.length) {
    const lb = new Map(comboLeaderboard(state, { rng, ...leaderboardOptions }).map((r) => [r.comboId, r.ev]));
    const score = (deck) => mean(deck.map((id) => (lb.has(id) ? lb.get(id) : -Infinity)));
    blocked = notRankable
      .map((b) => ({ ...b, ev: score(b.deck) }))
      .sort((a, b) => a.missing.length - b.missing.length || b.ev - a.ev)
      .slice(0, BLOCKED_N)
      .map(({ deck, missing }) => ({ deck, missing }));
  }

  return { ranked, blocked, fieldLegal, fieldTooSmall: field.length < 3 };
}
