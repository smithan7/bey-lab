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
