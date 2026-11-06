// 3on3 match simulator. Pure; runs in Node and browsers.
import { dirichlet } from './rng.js';
import { OUTCOMES } from './scoring.js';

const PRIOR = 1 / 7;

function shuffle3(rng, a) {
  // in-place Fisher-Yates on a small array
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
}

function sample(p, rng) {
  const u = rng();
  let c = 0;
  for (let k = 0; k < 6; k++) { c += p[k]; if (u < c) return OUTCOMES[k]; }
  return OUTCOMES[6];
}

// probs[i][j]: number[7] outcome probabilities, our combo i vs their combo j.
// Returns true if we reach `target` first.
export function playMatch(probs, target, rng, lead = null) {
  const ours = [0, 1, 2];
  const theirs = [0, 1, 2];
  const rest = lead == null ? null : [0, 1, 2].filter(i => i !== lead);
  let us = 0, them = 0;
  for (;;) {
    if (lead == null) shuffle3(rng, ours);
    else { shuffle3(rng, rest); ours[0] = lead; ours[1] = rest[0]; ours[2] = rest[1]; }
    shuffle3(rng, theirs);
    for (let s = 0; s < 3; s++) {
      const x = sample(probs[ours[s]][theirs[s]], rng);
      if (x > 0) us += x; else them -= x;
      if (us >= target) return true;
      if (them >= target) return false;
    }
  }
}

export function matchWinPoint(countsMatrix, target, { rng, matches = 1000, lead = null }) {
  const probs = countsMatrix.map(row => row.map(({ counts, n }) =>
    counts.map(c => (c + PRIOR) / (n + 1))));
  let wins = 0;
  for (let m = 0; m < matches; m++) if (playMatch(probs, target, rng, lead)) wins++;
  return wins / matches;
}

export function matchWinPosterior(countsMatrix, target, { rng, outer = 200, inner = 50, lead = null }) {
  const fracs = [];
  for (let o = 0; o < outer; o++) {
    const probs = countsMatrix.map(row => row.map(({ counts }) =>
      dirichlet(rng, counts.map(c => c + PRIOR))));
    let wins = 0;
    for (let m = 0; m < inner; m++) if (playMatch(probs, target, rng, lead)) wins++;
    fracs.push(wins / inner);
  }
  const sorted = fracs.slice().sort((a, b) => a - b);
  const rank = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
  return { p: fracs.reduce((a, b) => a + b, 0) / fracs.length, lo: rank(0.025), hi: rank(0.975) };
}
