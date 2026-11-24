// A grade (X, S, A, B, C, D or ?) for every part. Parts with WBO results keep their tier. CX blades
// are graded from their parts (main/metal/over blade counted double, plus the assist blade).
// Everything else gets a guess from the 3 tiered parts of the same kind (same type when there
// are 3+) with the closest packaging stats, capped at C for BX and collab parts (out a long time
// with no results) and at B for newer ones; BX guesses also drop one grade. Pure.
export const GRADES = ['D', 'C', 'B', 'A', 'S', 'X'];
const num = (t) => GRADES.indexOf(t);
const STAT_KEYS = { bit: ['attack', 'defense', 'stamina', 'dash', 'burst'] };
const keysFor = (kind) => STAT_KEYS[kind] ?? ['attack', 'defense', 'stamina'];
// Components before the CX blades built from them.
const ORDER = ['lock_chip', 'main_blade', 'assist_blade', 'over_blade', 'metal_blade', 'ratchet', 'bit', 'blade'];

function guess(p, parts) {
  const keys = keysFor(p.kind);
  const has = (q) => q.stats && keys.every((k) => q.stats[k] != null);
  if (!has(p)) return null;
  let pool = parts.filter((q) => q.kind === p.kind && q.meta && num(q.meta.tier) >= 0 && has(q));
  const same = pool.filter((q) => q.type === p.type);
  if (same.length >= 3) pool = same;
  if (pool.length < 2) return null;
  const dist = (q) => Math.sqrt(keys.reduce((s, k) => s + (q.stats[k] - p.stats[k]) ** 2, 0));
  const nn = pool.map((q) => ({ q, d: dist(q) })).sort((a, b) => a.d - b.d).slice(0, 3);
  const w = nn.map((x) => 1 / (1 + x.d));
  const score = nn.reduce((s, x, i) => s + w[i] * num(x.q.meta.tier), 0) / w.reduce((a, b) => a + b, 0);
  return { score, like: nn.map((x) => x.q.name) };
}

/** parts → Map<id, { grade, basis: 'wbo'|'parts'|'guess'|'new'|'none', why }> */
export function gradeParts(parts) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const out = new Map();
  const sorted = [...parts].sort((a, b) => (ORDER.indexOf(a.kind) + 1 || 99) - (ORDER.indexOf(b.kind) + 1 || 99));
  for (const p of sorted) {
    let g;
    if (p.meta && num(p.meta.tier) >= 0) {
      g = { grade: p.meta.tier, basis: 'wbo', why: 'Tournament tier from WBO results.' };
    } else if (p.cxPreset) {
      const c = p.cxPreset;
      const core = byId.get(c.mainBlade ?? c.metalBlade ?? c.overBlade);
      const assist = byId.get(c.assistBlade);
      const gOf = (q) => { const x = q && out.get(q.id); return x && x.grade !== '?' ? x : null; };
      if (gOf(core)) {
        const n = gOf(assist) ? Math.round((2 * num(gOf(core).grade) + num(gOf(assist).grade)) / 3) : num(gOf(core).grade);
        const guessed = gOf(core).basis === 'guess' || gOf(assist)?.basis === 'guess';
        const tag = (q) => `${q.name} (${gOf(q) ? `${gOf(q).grade}${gOf(q).basis === 'guess' ? ', a guess' : ''}` : 'no grade'})`;
        g = { grade: GRADES[n], basis: guessed ? 'guess' : 'parts', why: `From its parts: ${tag(core)}${assist ? `, ${tag(assist)}` : ''}.` };
      } else g = { grade: '?', basis: 'new', why: 'A new CX blade: its parts have no results yet.' };
    } else {
      const e = guess(p, parts);
      if (!e) g = { grade: '?', basis: 'none', why: 'No tournament results and no packaging stats to compare.' };
      else {
        const old = p.line === 'BX' || p.line === 'collab';
        const raw = Math.round(e.score) - (p.line === 'BX' ? 1 : 0);
        const why = p.line === 'collab' ? 'Collab blade (WBO may not allow these), so it has no results.'
          : p.line === 'BX' ? 'Out a long time with no top-3 finishes.' : 'No top-3 finishes yet.';
        g = { grade: GRADES[Math.max(0, Math.min(old ? num('C') : num('B'), raw))], basis: 'guess', why: `${why} Guess from similar stats: ${e.like.join(', ')}.` };
      }
    }
    out.set(p.id, g);
  }
  return out;
}

// Cached per parts array (ctx.parts is rebuilt on every change).
const cache = new WeakMap();
export function gradesFor(parts) {
  if (!cache.has(parts)) cache.set(parts, gradeParts(parts));
  return cache.get(parts);
}
