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
