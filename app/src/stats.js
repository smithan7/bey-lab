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

function simulateRace(scores, N, sims, rng) {
  if (!scores.some(s => s !== 0)) return 0.5; // no decisive battles: undefined, non-NaN
  let wins = 0;
  for (let i = 0; i < sims; i++) {
    let me = 0, them = 0;
    while (me < N && them < N) {
      const s = scores[Math.floor(rng() * scores.length)];
      if (s > 0) me += s; else if (s < 0) them -= s;
    }
    if (me >= N) wins++;
  }
  return wins / sims;
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
  const race = n
    ? { 5: simulateRace(scores, 5, raceSims, rng), 7: simulateRace(scores, 7, raceSims, rng) }
    : { 5: 0.5, 7: 0.5 };
  return {
    n, wins, draws: nDraws, losses,
    pWin: n ? wins / n : 0, pWinCI: wilson(wins, n),
    pLose: n ? losses / n : 0, pLoseCI: wilson(losses, n),
    eWin: wins ? winS.reduce((a, b) => a + b, 0) / wins : 0,
    eLoss: losses ? -lossS.reduce((a, b) => a + b, 0) / losses : 0,
    ev, evCI, pEvNeg, race,
  };
}
