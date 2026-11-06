import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const catalogPath = fileURLToPath(new URL('../data/parts-catalog.json', import.meta.url));

test('parts catalog parses with expected counts', () => {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.equal(catalog.blades.length, 159);
  assert.equal(catalog.ratchets.length, 38);
  assert.equal(catalog.bits.length, 55);
});
