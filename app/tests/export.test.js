import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveJson } from '../src/ui/settings.js';

const fakeDoc = () => {
  const clicks = [];
  return {
    clicks,
    body: { append() {} },
    createElement: () => ({ click() { clicks.push(this.download); }, remove() {} }),
  };
};
const urlApi = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };

test('saveJson shares a JSON file when the share sheet can take files', async () => {
  let shared;
  const nav = { canShare: ({ files }) => files.length === 1, share: async (d) => { shared = d; } };
  const doc = fakeDoc();
  assert.equal(await saveJson('{"a":1}', 'bey-lab.json', { nav, doc, urlApi }), 'shared');
  assert.equal(shared.files[0].name, 'bey-lab.json');
  assert.equal(shared.files[0].type, 'application/json');
  assert.equal(await shared.files[0].text(), '{"a":1}');
  assert.deepEqual(doc.clicks, []);
});

test('saveJson treats AbortError as a cancel', async () => {
  const nav = { canShare: () => true, share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } };
  assert.equal(await saveJson('{}', 'b.json', { nav, doc: fakeDoc(), urlApi }), 'cancelled');
});

test('saveJson rethrows other share failures', async () => {
  const nav = { canShare: () => true, share: async () => { throw new Error('denied'); } };
  await assert.rejects(saveJson('{}', 'b.json', { nav, doc: fakeDoc(), urlApi }), /denied/);
});

test('saveJson falls back to an anchor download', async () => {
  for (const nav of [{}, { canShare: () => false, share: async () => assert.fail('no share') }]) {
    const doc = fakeDoc();
    assert.equal(await saveJson('{}', 'b.json', { nav, doc, urlApi }), 'downloaded');
    assert.deepEqual(doc.clicks, ['b.json']);
  }
});
