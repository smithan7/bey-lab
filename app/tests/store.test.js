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

test('import of a no-photos file keeps existing photos', async () => {
  const s = await createStore(new MemoryBackend());
  await s.addPhoto('blade:a', new Blob([new Uint8Array([9])], { type: 'image/png' }), 1, 1);
  const file = await s.exportData({ withPhotos: false });
  await s.importData(file);
  assert.equal(s.state().photos.length, 1);
});

test('concurrent calls stay consistent with the backend', async () => {
  const be = new MemoryBackend();
  const s = await createStore(be);
  const bad = s.addBattle(battle('0', 'a', 'a', 0));
  await Promise.all([s.addBattle(battle('1', 'a', 'b', 1)), s.addBattle(battle('2', 'a', 'b', 2)), bad.catch(() => {})]);
  assert.equal(s.state().battles.length, 2);
  assert.equal((await be.getAll('battles')).length, 2);
});

test('mergePart rejects when merged combos fought each other', async () => {
  const s = await createStore(new MemoryBackend());
  const a = single('blade:a', 'ratchet:3-60', 'bit:x');
  const b = single('blade:a', 'ratchet:3-60', 'bit:y');
  await s.upsertCombo(a); await s.upsertCombo(b);
  await s.addBattle(battle('1', a.id, b.id, 1));
  const before = s.state();
  await assert.rejects(s.mergePart('bit:x', 'bit:y'), { message: "These two combos battled each other, so they can't be the same part — merge cancelled." });
  assert.deepEqual(s.state(), before);
});

test('mergePart repoints photos and checks intoId', async () => {
  const s = await createStore(new MemoryBackend());
  await s.addUserPart({ id: 'user:p', kind: 'bit', name: 'P' });
  await s.addPhoto('user:p', new Blob([new Uint8Array([1])]), 1, 1);
  await assert.rejects(s.mergePart('user:p', 'bit:nope', { knownPartIds: new Set(['bit:ok']) }));
  const st = await s.mergePart('user:p', 'bit:ok', { knownPartIds: new Set(['bit:ok']) });
  assert.equal(st.photos[0].partId, 'bit:ok');
});

test('importData requires ids on records', async () => {
  const s = await createStore(new MemoryBackend());
  const good = await s.exportData();
  await assert.rejects(s.importData({ ...good, battles: [{ left: 'a', right: 'b', winner: 'left', points: 1 }] }), ImportError);
  await assert.rejects(s.importData({ ...good, field: [{ active: true }] }), ImportError);
});

test('mergePart carries ownership to the merged-into part', async () => {
  const s = await createStore(new MemoryBackend());
  await s.addUserPart({ id: 'user:b', kind: 'bit', name: 'B' });
  await s.setOverride('user:b', { owned: true });
  await s.setOverride('bit:ok', { preferredName: 'Okay' });
  const st = await s.mergePart('user:b', 'bit:ok');
  assert.deepEqual(st.overrides['bit:ok'], { preferredName: 'Okay', owned: true });
  // An unowned source leaves the target's ownership alone.
  await s.addUserPart({ id: 'user:c', kind: 'bit', name: 'C' });
  await s.setOverride('bit:z', { owned: false });
  const st2 = await s.mergePart('user:c', 'bit:z');
  assert.deepEqual(st2.overrides['bit:z'], { owned: false });
});

const partsMap = (list) => new Map(list.map((p) => [p.id, p]));
const P = partsMap([
  { id: 'blade:a', kind: 'blade' }, { id: 'ratchet:3-60', kind: 'ratchet' },
  { id: 'user:bit', kind: 'bit' }, { id: 'bit:flat', kind: 'bit' },
  { id: 'bit:integrated', kind: 'bit', ratchetIntegrated: true }, { id: 'user:rib', kind: 'bit', ratchetIntegrated: true },
]);

test('mergePart drops the ratchet when the bit becomes ratchet-integrated', async () => {
  const s = await createStore(new MemoryBackend());
  const a = single('blade:a', 'ratchet:3-60', 'user:bit');
  const o = single('blade:a', 'ratchet:3-60', 'bit:flat');
  await s.upsertCombo(a); await s.upsertCombo(o);
  await s.setFieldEntry({ comboId: a.id, active: true, core: false });
  await s.addBattle(battle('1', a.id, o.id, 1));
  const st = await s.mergePart('user:bit', 'bit:integrated', { partsById: P });
  const fixed = single('blade:a', null, 'bit:integrated');
  assert.ok(st.combos.some((c) => c.id === fixed.id && c.ratchet === null));
  assert.equal(st.battles[0].left, fixed.id);
  assert.equal(st.field[0].comboId, fixed.id);
});

test('mergePart rejects a merge that leaves a combo invalid', async () => {
  const s = await createStore(new MemoryBackend());
  const a = single('blade:a', null, 'user:rib');
  await s.upsertCombo(a);
  const before = s.state();
  await assert.rejects(s.mergePart('user:rib', 'bit:flat', { partsById: P }), /merge cancelled/);
  assert.deepEqual(s.state(), before);
});

test('importData checks battle winner and points', async () => {
  const s = await createStore(new MemoryBackend());
  const good = await s.exportData();
  const b = (winner, points) => ({ ...good, battles: [{ id: '1', left: 'a', right: 'b', winner, finish: 'spin', points }] });
  for (const [w, p] of [['left', 1], ['right', 3], ['left', 2], ['draw', 0]]) await s.importData(b(w, p));
  for (const [w, p] of [['lft', 1], ['left', 0], ['left', 4], ['left', 1.5], ['left', -1], ['draw', 1], ['right', '2']]) {
    await assert.rejects(s.importData(b(w, p)), ImportError, `${w} ${p}`);
  }
});

test('replaceCombo moves battles and field entry to the corrected combo', async () => {
  const s = await createStore(new MemoryBackend());
  const wrong = single('blade:red-hulk', 'ratchet:3-60', 'bit:low-rush');
  const opp = single('blade:wizard-rod', 'ratchet:2-60', 'bit:gear-ball');
  await s.upsertCombo(wrong); await s.upsertCombo(opp);
  await s.setFieldEntry({ comboId: wrong.id, active: true, core: true });
  await s.addBattle(battle('1', wrong.id, opp.id, 1));
  await s.addBattle(battle('2', opp.id, wrong.id, 2));
  const fixed = single('blade:red-hulk', 'ratchet:1-60', 'bit:low-rush');
  const st = await s.replaceCombo(wrong.id, fixed);
  assert.deepEqual(st.combos.map((c) => c.id).sort(), [fixed.id, opp.id].sort());
  assert.deepEqual(st.battles.map((b) => [b.left, b.right]), [[fixed.id, opp.id], [opp.id, fixed.id]]);
  assert.deepEqual(st.field, [{ comboId: fixed.id, active: true, core: true }]);
});

test('replaceCombo into an existing combo merges their battles and field flags', async () => {
  const s = await createStore(new MemoryBackend());
  const a = single('blade:a', 'ratchet:3-60', 'bit:flat');
  const b = single('blade:a', 'ratchet:1-60', 'bit:flat');
  const o = single('blade:o', 'ratchet:2-60', 'bit:ball');
  for (const c of [a, b, o]) await s.upsertCombo(c);
  await s.setFieldEntry({ comboId: a.id, active: true, core: false });
  await s.setFieldEntry({ comboId: b.id, active: false, core: false });
  await s.addBattle(battle('1', a.id, o.id, 1));
  await s.addBattle(battle('2', b.id, o.id, 2));
  const st = await s.replaceCombo(a.id, b);
  assert.equal(st.combos.length, 2);
  assert.equal(st.battles.filter((x) => x.left === b.id).length, 2);
  assert.deepEqual(st.field, [{ comboId: b.id, active: true, core: false }]);
});

test('replaceCombo refuses when the two combos battled each other, and leaves state alone', async () => {
  const s = await createStore(new MemoryBackend());
  const a = single('blade:a', 'ratchet:3-60', 'bit:flat');
  const b = single('blade:b', 'ratchet:3-60', 'bit:flat');
  await s.upsertCombo(a); await s.upsertCombo(b);
  await s.addBattle(battle('1', a.id, b.id, 1));
  const before = s.state();
  await assert.rejects(s.replaceCombo(a.id, b), /battled each other/);
  assert.deepEqual(s.state(), before);
});

test('replaceCombo with unchanged parts is a no-op; unknown combo throws', async () => {
  const s = await createStore(new MemoryBackend());
  const a = single('blade:a', 'ratchet:3-60', 'bit:flat');
  await s.upsertCombo(a);
  assert.deepEqual((await s.replaceCombo(a.id, { ...a })).combos, [a]);
  await assert.rejects(s.replaceCombo('single:nope', a), /Unknown combo/);
});

test('deleteCombo removes an untested combo and its field entry, but refuses one with battles', async () => {
  const s = await createStore(new MemoryBackend());
  const a = single('blade:a', 'ratchet:3-60', 'bit:flat');
  const b = single('blade:b', 'ratchet:3-60', 'bit:flat');
  const c = single('blade:c', 'ratchet:3-60', 'bit:flat');
  for (const x of [a, b, c]) await s.upsertCombo(x);
  await s.setFieldEntry({ comboId: c.id, active: true, core: false });
  await s.addBattle(battle('1', a.id, b.id, 1));
  await assert.rejects(s.deleteCombo(a.id), /has battles/);
  const st = await s.deleteCombo(c.id);
  assert.deepEqual(st.combos.map((x) => x.id), [a.id, b.id]);
  assert.deepEqual(st.field, []);
});
