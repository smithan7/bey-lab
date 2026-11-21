import { OUTCOMES, battleScore, outcomeCounts } from './scoring.js';

const involves = (b, id) => b.left === id || b.right === id;

// Scores from a's side for battles between a and b (either orientation).
export function pairingScores(battles, a, b) {
  return battles
    .filter(x => (x.left === a && x.right === b) || (x.left === b && x.right === a))
    .map(x => battleScore(x, a));
}

// Scores from a's side for every battle a took part in.
export function pooledScores(battles, a) {
  return battles.filter(x => involves(x, a)).map(x => battleScore(x, a));
}

const mirror = counts => counts.map((c, k) => (c + counts[counts.length - 1 - k]) / 2);

// Mirror (a === b): symmetric average of pooled counts and their reverse.
// With no data, spin-only 50/50 with n: 1 so posterior math (counts + 1/7) works.
export function pairingDistribution(battles, a, b) {
  if (a === b) {
    const scores = pooledScores(battles, a);
    if (!scores.length) return { counts: [0, 0, 0.5, 0, 0.5, 0, 0], n: 1 };
    return { counts: mirror(outcomeCounts(scores)), n: scores.length };
  }
  const scores = pairingScores(battles, a, b);
  if (!scores.length) return null;
  return { counts: outcomeCounts(scores), n: scores.length };
}

const emptyFinishes = () => ({ spin: 0, burst: 0, pocket: 0, out: 0, xtreme: 0, unknown: 0 });

// b omitted: pool over all of a's battles. won/lost are from a's side.
export function finishBreakdown(battles, a, b) {
  const rel = battles.filter(x => b === undefined
    ? involves(x, a)
    : (x.left === a && x.right === b) || (x.left === b && x.right === a));
  const out = { n: rel.length, won: emptyFinishes(), lost: emptyFinishes(), draws: 0 };
  for (const x of rel) {
    if (x.winner === 'draw') { out.draws++; continue; }
    const s = battleScore(x, a);
    const f = x.finish in out.won ? x.finish : 'unknown';
    (s > 0 ? out.won : out.lost)[f]++;
  }
  return out;
}

export function comboFlags(br) {
  if (br.n === 0) return ['low-data'];
  const flags = [];
  if (br.lost.burst / br.n >= 0.2) flags.push('burst-risk');
  if ((br.lost.pocket + br.lost.out + br.lost.xtreme) / br.n >= 0.3) flags.push('ko-risk');
  if (br.n < 10) flags.push('low-data');
  return flags;
}

// ---- Rating-based distributions (fill untested pairings, steady thin ones) ----

// Pseudo-battles of the rating prediction added to a tested pairing / used for an untested one.
export const K_TESTED = 2;
export const K_UNTESTED = 2;
// Predicted means are clamped to ±TILT_CLAMP so a tilt stays a real distribution.
export const TILT_CLAMP = 2.5;
const SMOOTH = 0.02;
const SPIN_ONLY = [0, 0, 0.5, 0, 0.5, 0, 0];

// a's normalised outcome shape over all its battles (a's side); null with no decisive result.
export function pooledShape(battles, a) {
  const scores = pooledScores(battles, a);
  if (!scores.some((s) => s !== 0)) return null;
  const c = outcomeCounts(scores);
  return c.map((x) => x / scores.length);
}

// Exponential tilt: p_k ∝ shape_k·exp(θ·o_k), θ chosen by bisection so the mean equals target.
export function tilt(shape, target) {
  const t = Math.max(-TILT_CLAMP, Math.min(TILT_CLAMP, target));
  const base = shape.map((x) => x + SMOOTH);
  const at = (th) => {
    const w = base.map((x, k) => x * Math.exp(th * OUTCOMES[k]));
    const s = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / s);
  };
  const mean = (p) => p.reduce((s, x, k) => s + x * OUTCOMES[k], 0);
  let lo = -20, hi = 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mean(at(mid)) < t) lo = mid; else hi = mid;
  }
  return at((lo + hi) / 2);
}

const rOf = (ratings, id) => ratings.get(id)?.r ?? 0;

// Predicted outcome probabilities for a vs b (a's side): both combos' finish habits, tilted to
// the rating difference.
export function predictedDistribution(battles, ratings, a, b) {
  const sa = pooledShape(battles, a);
  const sbRaw = pooledShape(battles, b);
  const sb = sbRaw ? sbRaw.slice().reverse() : null;
  const shape = sa && sb ? sa.map((x, k) => (x + sb[k]) / 2) : (sa ?? sb ?? SPIN_ONLY);
  return tilt(shape, rOf(ratings, a) - rOf(ratings, b));
}

// Simulator cell { counts, n, estimated }: observed counts plus K_TESTED predicted
// pseudo-battles, or K_UNTESTED predicted pseudo-battles when the pairing is untested.
export function ratedDistribution(battles, ratings, a, b) {
  if (a === b) return { ...pairingDistribution(battles, a, a), estimated: false };
  const pred = predictedDistribution(battles, ratings, a, b);
  const obs = pairingDistribution(battles, a, b);
  if (!obs) return { counts: pred.map((x) => x * K_UNTESTED), n: K_UNTESTED, estimated: true };
  return { counts: obs.counts.map((c, k) => c + K_TESTED * pred[k]), n: obs.n + K_TESTED, estimated: false };
}
