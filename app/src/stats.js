import { makeRng, dirichlet } from './rng.js';
import { OUTCOMES, outcomeCounts } from './scoring.js';

export function wilson(k, n) {
  if (n === 0) return [0, 1];
  const z = 1.96, p = k / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];

export function tCrit95(df) {
  if (df < 1) return T95[0];
  if (df <= 30) return T95[Math.floor(df) - 1];
  return df <= 60 ? 2.0 : 1.96;
}

// Exact P(we reach N first) for one outcome distribution p over OUTCOMES. Draws (0) only
// delay the race, so it is solved on the decisive outcomes, conditioned on a decisive battle.
// Returns null when p has no decisive mass.
export function raceWinProb(p, N) {
  const dec = [];
  let mass = 0;
  for (let k = 0; k < OUTCOMES.length; k++) if (OUTCOMES[k] !== 0 && p[k] > 0) { dec.push([OUTCOMES[k], p[k]]); mass += p[k]; }
  if (!(mass > 0)) return null;
  // f[me][them], filled from the end of the race backwards.
  const f = Array.from({ length: N }, () => new Float64Array(N));
  for (let me = N - 1; me >= 0; me--) {
    for (let them = N - 1; them >= 0; them--) {
      let v = 0;
      for (const [s, q] of dec) {
        if (s > 0) v += q * (me + s >= N ? 1 : f[me + s][them]);
        else if (them - s < N) v += q * f[me][them - s];
      }
      f[me][them] = v / mass;
    }
  }
  return f[0][0];
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];

// Race to 5 and 7 with posterior uncertainty: each of `sims` Dirichlet draws (counts + 1/7)
// gives an outcome distribution whose race-win probability is solved exactly; we report the
// mean and the 2.5/97.5 percentiles. Unknown (null) with fewer than 2 battles or none decisive.
function raceStats(scores, sims, rng) {
  const unknown = { 5: null, 7: null };
  if (scores.length < 2 || !scores.some(s => s !== 0) || sims < 1) return unknown;
  const alphas = outcomeCounts(scores).map(c => c + 1 / 7);
  const res = { 5: [], 7: [] };
  for (let i = 0; i < sims; i++) {
    const p = dirichlet(rng, alphas);
    for (const N of [5, 7]) { const w = raceWinProb(p, N); if (w != null) res[N].push(w); }
  }
  const out = {};
  for (const N of [5, 7]) {
    const v = res[N].sort((a, b) => a - b);
    out[N] = v.length ? { p: v.reduce((a, b) => a + b, 0) / v.length, lo: quantile(v, 0.025), hi: quantile(v, 0.975) } : null;
  }
  return out;
}

export function matchupStats(scores, { rng, draws = 20000, raceSims = 20000 } = {}) {
  rng = rng || makeRng(Date.now());
  const n = scores.length;
  const winS = scores.filter(s => s > 0), lossS = scores.filter(s => s < 0);
  const wins = winS.length, losses = lossS.length, nDraws = n - wins - losses;
  const sum = scores.reduce((a, b) => a + b, 0);
  const ev = n ? sum / n : 0;
  let evCI = [ev, ev];
  if (n >= 2) {
    const sd = Math.sqrt(scores.reduce((a, s) => a + (s - ev) ** 2, 0) / (n - 1));
    const h = tCrit95(n - 1) * sd / Math.sqrt(n);
    evCI = [ev - h, ev + h];
  }
  let pEvNeg = 0.5;
  {
    const alphas = outcomeCounts(scores).map(c => c + 1 / 7);
    let neg = 0;
    for (let i = 0; i < draws; i++) {
      const p = dirichlet(rng, alphas);
      let e = 0;
      for (let k = 0; k < p.length; k++) e += OUTCOMES[k] * p[k];
      if (e < 0) neg++;
    }
    pEvNeg = draws ? neg / draws : 0.5;
  }
  // raceSims: total posterior draws for the races; each draw is solved for both targets.
  const race = raceStats(scores, raceSims, rng);
  return {
    n, wins, draws: nDraws, losses,
    pWin: n ? wins / n : 0, pWinCI: wilson(wins, n),
    pLose: n ? losses / n : 0, pLoseCI: wilson(losses, n),
    eWin: wins ? winS.reduce((a, b) => a + b, 0) / wins : 0,
    eLoss: losses ? -lossS.reduce((a, b) => a + b, 0) / losses : 0,
    ev, evCI, pEvNeg, race,
  };
}
