import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, MemoryBackend, ImportError, StorageUnavailableError } from '../src/store.js';
import { comboId } from '../src/combo.js';

const single = (bladeId, ratchet, bit) => {
  const c = { blade: { type: 'single', bladeId }, ratchet, bit };
  return { id: comboId(c), ...c };
};
const battle = (id, left, right, ts, winner = 'left') => ({ id, left, right, winner, finish: 'spin', points: 1, note: '', ts });

test('export → import round-trips exactly', async () => {
  const s = await createStore(new MemoryBackend());
  const a = single('blade:a', 'ratchet:3-60', 'bit:flat');
  const b = single('blade:b', 'ratchet:3-60', 'bit:ball');
  await s.upsertCombo(a);
  await s.upsertCombo(b);
  await s.addUserPart({ id: 'user:x', kind: 'bit', name: 'X' });
  await s.setOverride('blade:a', { displayName: 'Mine' });
  await s.setFieldEntry({ comboId: a.id, active: true, core: false });
  await s.addBattle(battle('1', a.id, b.id, 1));
  const before = s.state();
  const file = JSON.parse(JSON.stringify(await s.exportData({ withPhotos: false })));
  assert.equal('photos' in file, false);
  const s2 = await createStore(new MemoryBackend());
  await s2.importData(file);
  assert.deepEqual(s2.state(), before);
});

test('photos round-trip through data URLs', async () => {
  const s = await createStore(new MemoryBackend());
  await s.addPhoto('blade:a', new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/png' }), 4, 5);
  const file = JSON.parse(JSON.stringify(await s.exportData({ withPhotos: true })));
  assert.match(file.photos[0].dataUrl, /^data:image\/png;base64,/);
  const s2 = await createStore(new MemoryBackend());
  await s2.importData(file);
  const [p] = s2.state().photos;
  assert.equal(p.blob.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await p.blob.arrayBuffer())], [1, 2, 3, 250]);
  assert.equal(p.w, 4);
});

test('undoLastBattle removes the newest', async () => {
  const s = await createStore(new MemoryBackend());
  await s.addBattle(battle('1', 'a', 'b', 10));
  await s.addBattle(battle('2', 'a', 'b', 30));
  await s.addBattle(battle('3', 'a', 'b', 20));
  const st = await s.undoLastBattle();
  assert.deepEqual(st.battles.map((x) => x.id), ['1', '3']);
});

test('addBattle rejects identical combos', async () => {
  const s = await createStore(new MemoryBackend());
  await assert.rejects(s.addBattle(battle('1', 'a', 'a', 1)), { message: "A combo can't battle itself — pick two different combos." });
  assert.equal(s.state().battles.length, 0);
});

test('importData rejects bad file without changing state', async () => {
  const be = new MemoryBackend();
  const s = await createStore(be);
  await s.addBattle(battle('1', 'a', 'b', 1));
  const before = s.state();
  const good = await s.exportData({ withPhotos: false });
  for (const bad of [{}, null, { ...good, version: 99 }, { ...good, battles: 'nope' }, { ...good, overrides: [] },
    { ...good, battles: [{ id: 'x', left: 'a' }] }]) {
    await assert.rejects(s.importData(bad), ImportError);
  }
  assert.deepEqual(s.state(), before);
  assert.equal((await be.getAll('battles')).length, 1);
});

test('mergePart repoints combos and dedupes', async () => {
  const s = await createStore(new MemoryBackend());
  const a = single('blade:a', 'ratchet:3-60', 'bit:pop-out-unverified');
  const b = single('blade:a', 'ratchet:3-60', 'bit:free-ball');
  const c = single('blade:c', 'ratchet:3-60', 'bit:pop-out-unverified');
  for (const x of [a, b, c]) await s.upsertCombo(x);
  await s.addUserPart({ id: 'bit:pop-out-unverified', kind: 'bit', name: 'Pop' });
  await s.setOverride('bit:pop-out-unverified', { displayName: 'P' });
  await s.setFieldEntry({ comboId: a.id, active: true, core: false });
  await s.setFieldEntry({ comboId: b.id, active: false, core: true });
  await s.addBattle(battle('1', a.id, c.id, 1));
  await s.addBattle(battle('2', b.id, c.id, 2));
  const st = await s.mergePart('bit:pop-out-unverified', 'bit:free-ball');
  assert.equal(st.combos.length, 2);
  assert.ok(st.combos.some((x) => x.id === b.id));
  const c2 = single('blade:c', 'ratchet:3-60', 'bit:free-ball');
  assert.ok(st.combos.some((x) => x.id === c2.id));
  assert.equal(st.battles.length, 2);
  assert.deepEqual(st.battles.map((x) => x.left), [b.id, b.id]);
  assert.deepEqual(st.battles.map((x) => x.right), [c2.id, c2.id]);
  assert.deepEqual(st.field, [{ comboId: b.id, active: true, core: true }]);
  assert.equal(st.userParts.length, 0);
  assert.equal('bit:pop-out-unverified' in st.overrides, false);
});

test('writes persist to the backend (reload sees them)', async () => {
  const be = new MemoryBackend();
  const s = await createStore(be);
  await s.setMeta({ seeded: true });
  await s.setOverride('p', { displayName: 'Q' });
  await s.setOverride('p', { note: 'n' });
  const s2 = await createStore(be);
  assert.equal(s2.state().meta.seeded, true);
  assert.deepEqual(s2.state().overrides, { p: { displayName: 'Q', note: 'n' } });
});

test('applySeed writes seed and marks seeded', async () => {
  const s = await createStore(new MemoryBackend());
  const st = await s.applySeed({ combos: [single('blade:a', null, 'bit:x')] });
  assert.equal(st.meta.seeded, true);
  assert.equal(st.combos.length, 1);
});

test('createStore surfaces backend failure', async () => {
  const be = new MemoryBackend();
  be.open = async () => { throw new Error('denied'); };
  await assert.rejects(createStore(be), StorageUnavailableError);
});
