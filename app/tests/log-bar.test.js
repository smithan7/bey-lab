import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intervalPositions } from '../src/ui/log.js';

test('left winning (positive EV) plots on the left half of the bar', () => {
  const p = intervalPositions(1.5, [0.5, 2.5]);
  assert.ok(p.dot < 50);
  assert.ok(Math.abs(p.dot - 25) < 1e-9);
  assert.ok(Math.abs(p.fillLeft - (0.5 / 6 * 100)) < 1e-9); // +2.5 edge
  assert.ok(p.fillLeft + p.fillWidth < 50); // whole interval left of zero
});

test('right winning (negative EV) plots on the right half', () => {
  const p = intervalPositions(-1, [-2, -0.5]);
  assert.ok(p.dot > 50);
  assert.ok(p.fillLeft > 50);
});

test('interval is clamped to the ±3 track', () => {
  const p = intervalPositions(0, [-5, 5]);
  assert.equal(p.fillLeft, 0);
  assert.equal(p.fillWidth, 100);
  assert.equal(p.dot, 50);
});

import { kidSummary } from '../src/ui/log.js';

const R = (o) => ({ n: 10, wins: 6, draws: 0, losses: 4, ev: 0.4, evCI: [-0.2, 1.0], pEvNeg: 0.12, ...o });

test('kidSummary: no battles, one battle', () => {
  assert.deepEqual(kidSummary(R({ n: 0, wins: 0, losses: 0, ev: null }), 'Shark', 'Wizard'),
    ["Shark and Wizard haven't battled yet. Tap who wins to start!"]);
  assert.match(kidSummary(R({ n: 1, wins: 1, losses: 0, ev: null }), 'Shark', 'Wizard')[0], /^Only 1 battle so far/);
});

test('kidSummary: says who should win and by how much, from either side', () => {
  const [head, wins] = kidSummary(R({ ev: 0.4, pEvNeg: 0.12 }), 'Shark Scale 1-60 Point', 'Wizard Rod 4-60 Hexa');
  assert.equal(head, 'Shark Scale 1-60 Point will probably beat Wizard Rod 4-60 Hexa, by about 0.4 points a battle.');
  assert.equal(wins, 'Shark Scale 1-60 Point has won 6 of 10 battles.');
  // Negative EV: the right combo is ahead.
  const [h2, w2] = kidSummary(R({ ev: -1.26, pEvNeg: 0.97, wins: 2, losses: 8 }), 'Shark', 'Wizard');
  assert.equal(h2, 'Wizard should beat Shark, by about 1.3 points a battle.');
  assert.equal(w2, 'Wizard has won 8 of 10 battles.');
});

test('kidSummary: close calls and draws', () => {
  const [head] = kidSummary(R({ ev: 0.04, pEvNeg: 0.45 }), 'Shark', 'Wizard');
  assert.equal(head, "It's a close one! Shark is just a tiny bit ahead so far. Keep battling to find out who's better.");
  const [, w] = kidSummary(R({ wins: 5, draws: 2, losses: 3, ev: 0.3, pEvNeg: 0.2 }), 'Shark', 'Wizard');
  assert.equal(w, 'Shark has won 5 of 10 battles (and 2 were draws).');
  const [h3] = kidSummary(R({ ev: 0.03, pEvNeg: 0.05 }), 'Shark', 'Wizard');
  assert.match(h3, /less than 0\.1 points a battle/);
});

test('kidSummary: set progress, including a finished set', () => {
  assert.equal(kidSummary(R({ n: 10, batchCount: 0 }), 'Shark', 'Wizard')[2], 'That finishes a set of 10! Do another set, or try a new matchup.');
  assert.equal(kidSummary(R({ n: 13, batchCount: 3 }), 'Shark', 'Wizard')[2], 'This set: 3 of 10 battles done.');
});
