// Lineup ranking against every tested combo. Pure; runs in Node and the browser.
import { comboParts, isLegalDeck } from './combo.js';
import { ratedDistribution } from './matchups.js';
import { matchWinPoint, matchWinPosterior } from './sim.js';
import { fitRatings, ratingsLeaderboard } from './ratings.js';
import { makeRng, shuffle } from './rng.js';

export const SCREEN_MATCHES = 1000;
export const REFINE_OUTER = 200;
export const REFINE_INNER = 50;
export const TOP_N = 5;
// Opponent triples per ranking: every tested combo at least once, topped up to this many.
export const MIN_OPP_DECKS = 20;
// Legal decks kept (by summed rating) for the full match simulation.
export const PREFILTER = 60;
// Fixed seed for the opponent sample, so logging a battle doesn't reshuffle opponents.
export const OPP_SEED = 20261118;
// A fixed lead is only recommended if it beats random order by at least this much.
export const LEAD_MIN_GAIN = 0.02;
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

const played = (state) => {
  const s = new Set();
  for (const b of state.battles ?? []) if (b.left !== b.right) { s.add(b.left); s.add(b.right); }
  return s;
};

// Combos whose physical parts are all owned and that have at least one battle.
export function candidateCombos(state, parts) {
  const owned = new Set(parts.filter((p) => p.owned).map((p) => p.id));
  const tested = played(state);
  return (state.combos ?? [])
    .filter((c) => tested.has(c.id) && comboParts(c).every((p) => owned.has(p)))
    .map((c) => c.id);
}

// "Everyone": every combo with at least one battle, owned or not, in state.combos order.
export function opponentCombos(state) {
  const tested = played(state);
  return (state.combos ?? []).filter((c) => tested.has(c.id)).map((c) => c.id);
}

// Opponent triples covering every id at least once (disjoint chunks of a shuffle, the last one
// topped up from the head), then more shuffled chunks until `min` or every 3-subset is used.
export function coverDecks(ids, rng, min = MIN_OPP_DECKS) {
  if (ids.length < 3) return [];
  const total = (ids.length * (ids.length - 1) * (ids.length - 2)) / 6;
  const want = Math.min(total, Math.max(min, Math.ceil(ids.length / 3)));
  const seen = new Set();
  const out = [];
  const push = (t) => {
    const k = [...t].sort().join('\n');
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (let round = 0; out.length < want && round < 200; round++) {
    const order = shuffle(rng, ids);
    for (let i = 0; i < order.length && out.length < want; i += 3) {
      const t = order.slice(i, i + 3);
      for (let j = 0; t.length < 3; j++) if (!t.includes(order[j])) t.push(order[j]);
      push(t);
    }
  }
  if (out.length < want) for (const t of triples(ids)) { if (out.length >= want) break; push(t); }
  return out;
}

export function enumerateLegalDecks(candidateIds, combosById) {
  const get = (id) => (combosById instanceof Map ? combosById.get(id) : combosById[id]);
  return triples(candidateIds).filter((d) => isLegalDeck(d.map(get)));
}

const matrix = (battles, ratings, deck, fd) => deck.map((a) => fd.map((b) => ratedDistribution(battles, ratings, a, b)));
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
 * Ranks legal decks of owned, tested combos against every tested combo.
 * Opponents: coverDecks(opponentCombos) with a fixed seed. Pairings without data are estimated
 * from EV ratings (ratedDistribution). Legal decks are prefiltered to the PREFILTER highest
 * summed ratings, screened by first-to-5 P(win) under their best lead, and the TOP_N are refined.
 * ranked: sorted by refined best.target5.p (best estimate). estimatedShare: fraction of the
 *   deck's non-mirror pairings in the opponent sample that have no battles.
 * ratings: leaderboard rows (ratingsLeaderboard). tooFew: fewer than 3 tested combos.
 * noLegal: no legal deck of owned, tested combos.
 */
export function rankLineups(state, parts, {
  rng = makeRng(Date.now()),
  screenMatches = SCREEN_MATCHES, refineOuter = REFINE_OUTER, refineInner = REFINE_INNER, topN = TOP_N,
  prefilter = PREFILTER, minOppDecks = MIN_OPP_DECKS,
} = {}) {
  const combosById = byIdMap(state.combos);
  const battles = state.battles ?? [];
  const fitted = fitRatings(battles);
  const ratings = ratingsLeaderboard(state, fitted);
  const opponents = opponentCombos(state);
  const tooFew = opponents.length < 3;
  const fds = tooFew ? [] : coverDecks(opponents, makeRng(OPP_SEED), minOppDecks);

  const rOf = (id) => fitted.get(id)?.r ?? 0;
  const legal = enumerateLegalDecks(candidateCombos(state, parts), combosById)
    .map((deck) => ({ deck, score: deck.reduce((s, id) => s + rOf(id), 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, prefilter)
    .map((x) => x.deck);
  const noLegal = !tooFew && legal.length === 0;

  let ranked = [];
  if (fds.length && legal.length) {
    const screened = legal.map((deck) => {
      const mats = fds.map((fd) => matrix(battles, fitted, deck, fd));
      let p5 = -Infinity;
      for (const lead of LEADS) {
        p5 = Math.max(p5, mean(mats.map((m) => matchWinPoint(m, 5, { rng, matches: screenMatches, lead }))));
      }
      let cells = 0, est = 0;
      deck.forEach((a, i) => fds.forEach((fd, j) => fd.forEach((b, k) => {
        if (a === b) return;
        cells++;
        if (mats[j][i][k].estimated) est++;
      })));
      return { deck, mats, p5, estimatedShare: cells ? est / cells : 0 };
    });
    screened.sort((a, b) => b.p5 - a.p5);
    ranked = screened.slice(0, topN).map(({ deck, mats, estimatedShare }) => {
      const out = { deck, best: {}, randomOrder: {}, estimatedShare };
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

  return { ranked, ratings, tooFew, noLegal };
}
