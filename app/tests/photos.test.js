import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downscaleDimensions } from '../src/photos.js';

test('downscaleDimensions caps the long edge at 1280', () => {
  assert.deepEqual(downscaleDimensions(4032, 3024), { w: 1280, h: 960 });
  assert.deepEqual(downscaleDimensions(3024, 4032), { w: 960, h: 1280 });
  assert.deepEqual(downscaleDimensions(800, 600), { w: 800, h: 600 });
  assert.deepEqual(downscaleDimensions(1280, 1000), { w: 1280, h: 1000 });
});
