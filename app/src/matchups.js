import { battleScore, outcomeCounts } from './scoring.js';

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

const emptyFinishes = () => ({ spin: 0, burst: 0, pocket: 0, xtreme: 0, unknown: 0 });

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
  if ((br.lost.pocket + br.lost.xtreme) / br.n >= 0.3) flags.push('ko-risk');
  if (br.n < 10) flags.push('low-data');
  return flags;
}
