// Catalog normalization, merging and search. Runs in Node and the browser.

export const PART_KINDS = ['blade', 'ratchet', 'bit', 'lock_chip', 'main_blade', 'over_blade', 'metal_blade', 'assist_blade'];

const CX_KEYS = ['lock_chips', 'main_blades', 'over_blades', 'metal_blades', 'assist_blades'];

export function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const partId = (kind, name) => kind + ':' + slug(name);

function stripParens(s) {
  return s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
}

function component(kind, value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v || v.toLowerCase() === 'unknown') return null;
  return partId(kind, stripParens(v));
}

function makePart(kind, e, extra = {}) {
  return {
    id: partId(kind, e.name),
    kind,
    name: e.name,
    altNames: Array.isArray(e.alt_names) ? [...e.alt_names] : [],
    line: e.line ?? null,
    type: e.type ?? null,
    source: 'catalog',
    builtInRatchet: e.built_in_ratchet === true,
    ratchetIntegrated: e.ratchet_integrated === true,
    cxPreset: null,
    imageUrl: e.image_url ?? null,
    imageConfidence: e.image_confidence ?? null,
    ...extra,
  };
}

function cxPreset(c) {
  if (!c) return null;
  const lockChip = component('lock_chip', c.lock_chip);
  const assistBlade = component('assist_blade', c.assist_blade);
  if (!lockChip || !assistBlade) return null;
  const mainBlade = component('main_blade', c.main_blade);
  const overBlade = component('over_blade', c.over_blade);
  const metalBlade = component('metal_blade', c.metal_blade);
  if (!mainBlade && !(overBlade && metalBlade)) return null;
  return { lockChip, mainBlade, overBlade, metalBlade, assistBlade };
}

export function normalizeCatalog(json) {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (seen.has(p.id)) {
      normalizeCatalog.collisions.push(p.id);
      return;
    }
    seen.add(p.id);
    out.push(p);
  };
  normalizeCatalog.collisions = [];
  for (const b of json.blades ?? []) add(makePart('blade', b, { cxPreset: cxPreset(b.components) }));
  for (const r of json.ratchets ?? []) add(makePart('ratchet', r));
  for (const b of json.bits ?? []) add(makePart('bit', b));
  const cx = json.cx_parts ?? {};
  for (const key of CX_KEYS) {
    const kind = key.slice(0, -1);
    for (const e of cx[key] ?? []) {
      const p = makePart(kind, e);
      if (e.hasbro_name && e.hasbro_name !== e.name) p.altNames.push(e.hasbro_name);
      add(p);
    }
  }
  return out;
}
normalizeCatalog.collisions = [];

export function mergeParts(catalogParts, userParts, overrides = {}) {
  const byId = new Map();
  for (const p of catalogParts) byId.set(p.id, p);
  for (const p of userParts ?? []) byId.set(p.id, p);
  return [...byId.values()].map((p) => {
    const o = overrides?.[p.id] ?? {};
    return {
      ...p,
      displayName: o.preferredName || p.name,
      owned: !!o.owned,
      coverPhotoId: o.coverPhotoId ?? null,
      hidden: !!o.hidden,
    };
  });
}

export function searchParts(parts, query, kind) {
  const q = String(query ?? '').trim().toLowerCase();
  const scored = [];
  for (const p of parts) {
    if (kind && p.kind !== kind) continue;
    const dn = (p.displayName ?? p.name).toLowerCase();
    const names = [dn, p.name.toLowerCase(), ...(p.altNames ?? []).map((a) => a.toLowerCase())];
    if (!q) { scored.push([3, p]); continue; }
    let rank;
    if (dn === q) rank = 0;
    else if (names.some((n) => n === q)) rank = 1;
    else if (names.some((n) => n.startsWith(q))) rank = 2;
    else if (names.some((n) => n.includes(q))) rank = 3;
    else continue;
    scored.push([rank, p]);
  }
  return scored.map((s, i) => [...s, i]).sort((a, b) => a[0] - b[0] || a[2] - b[2]).map((s) => s[1]);
}

// Beyblade X types. Catalog entries marked 'unknown' (or ratchets/lock chips, which have none) get no label.
export const PART_TYPES = ['attack', 'defense', 'stamina', 'balance'];

export function typeLabel(type) {
  return PART_TYPES.includes(type) ? type[0].toUpperCase() + type.slice(1) : null;
}

const nameCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

// Copy of parts sorted by position of their kind in `kinds`, then display name A→Z.
export function sortParts(parts, kinds = PART_KINDS) {
  return [...parts].sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind)
    || nameCollator.compare(a.displayName ?? a.name, b.displayName ?? b.name));
}
