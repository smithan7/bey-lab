import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, dirichlet, shuffle, gamma } from '../src/rng.js';
import { battleScore, outcomeCounts, OUTCOMES, FINISH_POINTS } from '../src/scoring.js';
import { wilson, tCrit95, matchupStats } from '../src/stats.js';

const A = {
  rhWr: [-1,2,-1,0,-1,-1,-1,-1,-1,3],   rhCd: [-3,1,1,1,-2,1,-3,-1,1,-2],
  rhPb: [3,1,1,-1,0,-2,-1,2,-1,-1],    poWr: [-1,-1,-2,-2,-1,2,-1,-2,-2,3],
  poCd: [-1,-2,-3,-2,2,-2,-3,-1,1,1],  rgPb: [-3,-3,2,-1,-3,-1,-1,-2,1,-3],
};
const ref = { rhWr:[2,1,7,-0.20,0.70], rhCd:[5,0,5,-0.60,0.86], rhPb:[4,1,5,0.10,0.44],
              poWr:[2,0,8,-0.70,0.89], poCd:[3,0,7,-1.00,0.96], rgPb:[2,0,8,-1.40,0.99] };

test('rng reproducible and in [0,1)', () => {
  const a = makeRng(1), b = makeRng(1);
  for (let i = 0; i < 50; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

test('dirichlet sums to 1; gamma positive; shuffle copies', () => {
  const rng = makeRng(3);
  const p = dirichlet(rng, [0.5, 1, 2, 0.1]);
  assert.ok(Math.abs(p.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  assert.ok(gamma(rng, 0.3) > 0);
  const arr = [1, 2, 3, 4, 5];
  const s = shuffle(rng, arr);
  assert.deepEqual(arr, [1, 2, 3, 4, 5]);
  assert.deepEqual([...s].sort(), arr);
});

test('constants', () => {
  assert.deepEqual(OUTCOMES, [-3,-2,-1,0,1,2,3]);
  assert.deepEqual(FINISH_POINTS, { spin: 1, burst: 2, pocket: 2, xtreme: 3 });
});

test('battleScore', () => {
  const b = { left: 'a', right: 'b', winner: 'right', finish: 'xtreme', points: 3 };
  assert.equal(battleScore(b, 'a'), -3);
  assert.equal(battleScore(b, 'b'), 3);
  const d = { left: 'a', right: 'b', winner: 'draw', finish: null, points: 0 };
  assert.equal(battleScore(d, 'a'), 0);
  assert.equal(battleScore(d, 'b'), 0);
});

test('outcomeCounts, wilson, tCrit95', () => {
  assert.deepEqual(outcomeCounts([-3, 0, 0, 3, 1]), [1, 0, 0, 2, 1, 0, 1]);
  assert.deepEqual(wilson(0, 0), [0, 1]);
  assert.equal(tCrit95(9), 2.262);
  assert.equal(tCrit95(1), 12.706);
  assert.equal(tCrit95(30), 2.042);
  assert.equal(tCrit95(45), 2.0);
  assert.equal(tCrit95(100), 1.96);
});

for (const [name, [w, d, l, ev, pNeg]] of Object.entries(ref)) {
  test(`matchupStats ${name}`, () => {
    const s = matchupStats(A[name], { rng: makeRng(42) });
    assert.equal(s.n, 10);
    assert.equal(s.wins, w); assert.equal(s.draws, d); assert.equal(s.losses, l);
    assert.ok(Math.abs(s.ev - ev) < 1e-9);
    assert.ok(Math.abs(s.pEvNeg - pNeg) < 0.02, `pEvNeg ${s.pEvNeg}`);
  });
}

test('matchupStats rhWr extras', () => {
  const s = matchupStats(A.rhWr, { rng: makeRng(42) });
  assert.ok(Math.abs(s.pWinCI[0] - 0.057) < 0.002 && Math.abs(s.pWinCI[1] - 0.510) < 0.002);
  assert.equal(s.eWin, 2.5);
  assert.equal(s.eLoss, 1.0);
  assert.ok(Math.abs(s.evCI[0] + 1.256) < 0.01 && Math.abs(s.evCI[1] - 0.856) < 0.01);
  assert.ok(Math.abs(s.race[5] - 0.35) < 0.03, `race5 ${s.race[5]}`);
  assert.ok(s.race[7] < s.race[5]);
});

test('matchupStats degenerate', () => {
  const s = matchupStats([], { rng: makeRng(1) });
  assert.equal(s.n, 0);
  assert.equal(s.eWin, 0); assert.equal(s.eLoss, 0);
  assert.ok(!Number.isNaN(s.ev));
  assert.ok(s.evCI.every(x => !Number.isNaN(x)));
  const one = matchupStats([2], { rng: makeRng(1) });
  assert.ok(one.evCI.every(x => !Number.isNaN(x)));
});
