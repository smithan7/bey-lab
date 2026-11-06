import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineupKey } from '../src/ui/lineup.js';

const base = () => ({
  state: {
    battles: [{ id: 'b1', left: 'a', right: 'b', winner: 'left', finish: 'spin', points: 1 },
      { id: 'b2', left: 'a', right: 'c', winner: 'right', finish: 'burst', points: 2 }],
    field: [{ comboId: 'a', active: true, core: false }],
    combos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  },
  parts: [{ id: 'p1', owned: true, name: 'One' }, { id: 'p2', owned: false, name: 'Two' }],
});

test('lineupKey is stable for identical input', () => {
  const x = base(); const y = base();
  assert.equal(lineupKey(x.state, x.parts), lineupKey(y.state, y.parts));
});

test('lineupKey changes with ownership, battle finish at same count, and field', () => {
  const k0 = lineupKey(base().state, base().parts);
  const own = base(); own.parts[1].owned = true;
  assert.notEqual(lineupKey(own.state, own.parts), k0);
  const fin = base(); fin.state.battles[1].finish = 'pocket';
  assert.notEqual(lineupKey(fin.state, fin.parts), k0);
  const fld = base(); fld.state.field[0].core = true;
  assert.notEqual(lineupKey(fld.state, fld.parts), k0);
});

test('lineupKey ignores display names', () => {
  const k0 = lineupKey(base().state, base().parts);
  const n = base(); n.parts[0].displayName = 'Renamed';
  assert.equal(lineupKey(n.state, n.parts), k0);
});
