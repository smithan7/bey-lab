import test from 'node:test';
import assert from 'node:assert/strict';
import { pairingScores, pooledScores, pairingDistribution, finishBreakdown, comboFlags } from '../src/matchups.js';

// Tokens are scored from the left combo's side: '-2B', '+1', '-3', '+2P'.
function mk(left, right, row, start = 0) {
  return row.split(',').map((tok, i) => {
    const m = /^([+-])(\d)([BP]?)$/.exec(tok.trim());
    const pts = Number(m[2]);
    const finish = m[3] === 'B' ? 'burst' : m[3] === 'P' ? 'pocket'
      : pts === 1 ? 'spin' : pts === 3 ? 'xtreme' : 'unknown';
    return { id: `${left}-${right}-${start + i}`, left, right,
      winner: m[1] === '+' ? 'left' : 'right', finish, points: pts, note: '', ts: 0 };
  });
}

const POP = 'popout', WIZ = 'wizard', COB = 'cobalt', GRIF = 'griffon', BALL = 'freeball';
const popBattles = [
  ...mk(POP, WIZ, '-1,-1,-2B,-2B,-1,+2B,-1,-2P,-2B,+3'),
  ...mk(POP, COB, '-1,-2B,-3,-2B,+2P,-2P,-3,-1,+1,+1'),
];
const grifBattles = mk(GRIF, BALL, '-3,-3,+2B,-1,-3,-1,-1,-2,+1,-3');

test('pairingScores is antisymmetric across orientations', () => {
  const b = [...mk('x', 'y', '+1,-2B'), ...mk('y', 'x', '+3,-1', 2)];
  const xy = pairingScores(b, 'x', 'y');
  assert.equal(xy.length, 4);
  assert.deepEqual(pairingScores(b, 'y', 'x'), xy.map(s => -s));
});

test('pooledScores covers all battles of a combo', () => {
  assert.equal(pooledScores(popBattles, POP).length, 20);
  assert.equal(pooledScores(popBattles, WIZ).length, 10);
});

test('mirror distribution is symmetric with EV 0', () => {
  const d = pairingDistribution(popBattles, POP, POP);
  const ev = d.counts.reduce((s, c, i) => s + c * (i - 3), 0);
  assert.ok(Math.abs(ev) < 1e-9);
  assert.deepEqual(d.counts, [...d.counts].reverse());
  assert.equal(d.n, 20);
});

test('mirror with no data falls back to spin-only 50/50', () => {
  assert.deepEqual(pairingDistribution([], 'z', 'z'), { counts: [0, 0, 0.5, 0, 0.5, 0, 0], n: 1 });
});

test('pairing with no data is null; with data has counts', () => {
  assert.equal(pairingDistribution(popBattles, POP, GRIF), null);
  const d = pairingDistribution(popBattles, POP, WIZ);
  assert.equal(d.n, 10);
  assert.equal(d.counts.reduce((a, b) => a + b, 0), 10);
});

test('Pegasus Blast Pop Out pooled has burst-risk', () => {
  const br = finishBreakdown(popBattles, POP);
  assert.equal(br.n, 20);
  assert.equal(br.lost.burst, 5);
  assert.ok(comboFlags(br).includes('burst-risk'));
  assert.ok(!comboFlags(br).includes('low-data'));
  assert.equal(finishBreakdown(popBattles, POP, WIZ).n, 10);
});

test('Rocket Griffon Hexa has ko-risk', () => {
  const br = finishBreakdown(grifBattles, GRIF, BALL);
  assert.equal(br.lost.xtreme, 4);
  assert.ok(comboFlags(br).includes('ko-risk'));
});

test('draws only increment draws; no data is low-data only', () => {
  const b = [{ id: '1', left: 'a', right: 'b', winner: 'draw', finish: null, points: 0, note: '', ts: 0 }];
  const br = finishBreakdown(b, 'a');
  assert.equal(br.draws, 1);
  assert.equal(br.n, 1);
  assert.deepEqual(comboFlags(finishBreakdown([], 'a')), ['low-data']);
});

// ---- Rating-based distributions ----
import { pooledShape, tilt, predictedDistribution, ratedDistribution, K_TESTED, K_UNTESTED, TILT_CLAMP } from '../src/matchups.js';
import { fitRatings } from '../src/ratings.js';
import { OUTCOMES } from '../src/scoring.js';

const meanOf = (p) => p.reduce((s, x, k) => s + x * OUTCOMES[k], 0) / p.reduce((a, b) => a + b, 0);

test('rated constants', () => {
  assert.deepEqual([K_TESTED, K_UNTESTED, TILT_CLAMP], [2, 2, 2.5]);
});

test('tilt hits the target mean, clamped to ±2.5', () => {
  const shape = [0.05, 0.1, 0.2, 0.1, 0.3, 0.15, 0.1];
  for (const t of [-2, 0, 1.3]) assert.ok(Math.abs(meanOf(tilt(shape, t)) - t) < 1e-6, String(t));
  assert.ok(Math.abs(meanOf(tilt(shape, 3)) - 2.5) < 1e-6);
  assert.ok(Math.abs(tilt(shape, 0.4).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('pooledShape is null without decisive results', () => {
  assert.equal(pooledShape([{ left: 'a', right: 'b', winner: 'draw', points: 0 }], 'a'), null);
  const s = pooledShape(mk('a', 'b', '+1,+1,-2B'), 'a');
  assert.ok(Math.abs(s.reduce((x, y) => x + y, 0) - 1) < 1e-9);
});

test('predicted shape carries finish habits', () => {
  // b1 loses by burst (+2 for us), b2 loses by spin (+1 for us); same rating gap by construction.
  const battles = [...mk('x', 'b1', '+2B,+2B,-2B,+2B'), ...mk('x', 'b2', '+1,+1,-1,+1'), ...mk('a', 'o', '+1,-1')];
  const ratings = new Map([['a', { r: 0.5 }], ['b1', { r: 0 }], ['b2', { r: 0 }], ['o', { r: 0 }], ['x', { r: 0 }]]);
  const p1 = predictedDistribution(battles, ratings, 'a', 'b1');
  const p2 = predictedDistribution(battles, ratings, 'a', 'b2');
  assert.ok(Math.abs(meanOf(p1) - 0.5) < 1e-6 && Math.abs(meanOf(p2) - 0.5) < 1e-6);
  const plus2 = OUTCOMES.indexOf(2);
  assert.ok(p1[plus2] > p2[plus2]);
});

test('no decisive results falls back to spin-only, finite', () => {
  const battles = [{ left: 'a', right: 'b', winner: 'draw', points: 0 }];
  const ratings = new Map([['a', { r: 0.3 }], ['b', { r: -0.3 }]]);
  const p = predictedDistribution(battles, ratings, 'a', 'b');
  assert.ok(p.every(Number.isFinite));
  assert.ok(Math.abs(meanOf(p) - 0.6) < 1e-6);
});

test('tested pairing adds K_TESTED pseudo-battles; real data dominates when plentiful', () => {
  const battles = [...mk('a', 'b', Array(25).fill('+2').join(',')), ...mk('a', 'b', Array(25).fill('-1').join(','))];
  const ratings = fitRatings(battles);
  const d = ratedDistribution(battles, ratings, 'a', 'b');
  assert.equal(d.n, 52);
  assert.equal(d.estimated, false);
  assert.ok(Math.abs(meanOf(d.counts) - 0.5) < 0.1);
});

test('untested pairing is estimated from ratings', () => {
  const battles = [...mk('a', 'c', '+2,+2,+1,+3'), ...mk('b', 'c', '-1,-1,+1,-2B')];
  const ratings = fitRatings(battles);
  const d = ratedDistribution(battles, ratings, 'a', 'b');
  assert.equal(d.n, K_UNTESTED);
  assert.equal(d.estimated, true);
  assert.ok(Math.abs(meanOf(d.counts) - (ratings.get('a').r - ratings.get('b').r)) < 1e-6);
});

test('mirror is not estimated', () => {
  const battles = mk('a', 'b', '+1,-2B');
  const d = ratedDistribution(battles, fitRatings(battles), 'a', 'a');
  assert.equal(d.estimated, false);
  assert.ok(Math.abs(meanOf(d.counts)) < 1e-9);
});
