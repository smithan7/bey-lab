import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTheme, applyTheme } from '../src/theme.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const el = () => { const a = new Map(); return { setAttribute: (k, v) => a.set(k, v), removeAttribute: (k) => a.delete(k), get: (k) => a.get(k), a }; };

test('theme defaults to auto and remembers light/dark', () => {
  const s = mem(), root = el();
  assert.equal(loadTheme(s), 'auto');
  assert.equal(applyTheme('dark', { root, storage: s }), 'dark');
  assert.equal(root.get('data-theme'), 'dark');
  assert.equal(loadTheme(s), 'dark');
  applyTheme('light', { root, storage: s });
  assert.equal(root.get('data-theme'), 'light');
  applyTheme('auto', { root, storage: s });
  assert.equal(root.a.has('data-theme'), false);
  assert.equal(loadTheme(s), 'auto');
});

test('bad values and broken storage fall back to auto', () => {
  const s = mem(); s.setItem('bey-lab-theme', 'purple');
  assert.equal(loadTheme(s), 'auto');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(loadTheme(broken), 'auto');
  const root = el();
  assert.equal(applyTheme('dark', { root, storage: broken }), 'dark');
  assert.equal(root.get('data-theme'), 'dark');
});
