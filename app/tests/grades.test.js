import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog, withReference } from '../src/catalog.js';
import { gradeParts, gradesFor, GRADES } from '../src/grades.js';

const ref = JSON.parse(readFileSync(new URL('../data/reference.json', import.meta.url), 'utf8'));
const parts = withReference(normalizeCatalog(JSON.parse(readFileSync(new URL('../data/parts-catalog.json', import.meta.url), 'utf8'))), ref);
const grades = gradeParts(parts);
const byName = (kind, name) => grades.get(parts.find((p) => p.kind === kind && p.name === name).id);

test('every part gets a grade', () => {
  for (const p of parts) {
    const g = grades.get(p.id);
    assert.ok(g, p.id);
    assert.ok([...GRADES, '?'].includes(g.grade), `${p.id}: ${g.grade}`);
    assert.ok(g.why.length > 10);
  }
});

test('WBO tiers are kept as they are', () => {
  for (const p of parts.filter((x) => x.meta && x.meta.tier !== '?')) {
    assert.equal(grades.get(p.id).grade, p.meta.tier);
    assert.equal(grades.get(p.id).basis, 'wbo');
  }
});

test('guesses are capped: C for BX and collab, B for newer', () => {
  for (const p of parts) {
    const g = grades.get(p.id);
    if (g.basis !== 'guess' || p.cxPreset) continue;
    const cap = p.line === 'BX' || p.line === 'collab' ? 'C' : 'B';
    assert.ok(GRADES.indexOf(g.grade) <= GRADES.indexOf(cap), `${p.name} ${p.line} ${g.grade}`);
  }
});

test('CX blades are graded from their parts', () => {
  const g = byName('blade', 'Pegasus Blast');
  assert.match(g.why, /^From its parts: Blast \(X\)/);
  assert.ok(['X', 'S'].includes(g.grade));
});

test('a part with no stats and no results is "?"', () => {
  const g = gradeParts([{ id: 'blade:mystery', kind: 'blade', name: 'Mystery', line: 'UX' }]).get('blade:mystery');
  assert.equal(g.grade, '?');
});

test('gradesFor caches per parts array', () => {
  assert.equal(gradesFor(parts), gradesFor(parts));
});
