// Combo model, validation, labels and deck legality. Runs in Node and the browser.

const CX_FIELDS = ['lockChip', 'mainBlade', 'overBlade', 'metalBlade', 'assistBlade'];

const lookup = (partsById, id) => (partsById instanceof Map ? partsById.get(id) : partsById?.[id]);
const nameOf = (partsById, id) => {
  const p = lookup(partsById, id);
  return p ? (p.displayName || p.name) : id;
};

const CX_KIND_WORDS = {
  lock_chip: 'lock chip', main_blade: 'main blade', over_blade: 'over blade', metal_blade: 'metal blade', assist_blade: 'assist blade',
};

// A part's full name for clash text: CX components carry their kind ("lock chip Pegasus"),
// since "Pegasus" alone is ambiguous; ratchets, bits and single blades keep their plain names.
export function partRefName(partsById, id) {
  const kind = lookup(partsById, id)?.kind;
  const n = nameOf(partsById, id);
  return CX_KIND_WORDS[kind] ? `${CX_KIND_WORDS[kind]} ${n}` : n;
}

function cxBladeParts(blade) {
  return [blade.lockChip, blade.mainBlade, blade.overBlade, blade.metalBlade, blade.assistBlade];
}

export function comboId(combo) {
  const b = combo.blade;
  const tail = `${combo.ratchet ?? '-'}|${combo.bit}`;
  if (b.type === 'cx') {
    const body = b.mainBlade ?? `${b.overBlade}+${b.metalBlade}`;
    return `cx:${b.lockChip}+${body}+${b.assistBlade}|${tail}`;
  }
  return `single:${b.bladeId}|${tail}`;
}

export function comboParts(combo) {
  const b = combo.blade;
  const blade = b.type === 'cx' ? cxBladeParts(b) : [b.bladeId];
  return [...blade, combo.ratchet, combo.bit].filter(Boolean);
}

export function validateCombo(combo, partsById) {
  const b = combo?.blade;
  if (!b) return 'Combo has no blade';
  if (!combo.bit) return 'Combo needs a bit';
  const bit = lookup(partsById, combo.bit);
  if (!bit) return 'Unknown bit';
  let builtIn = false;
  if (b.type === 'cx') {
    if (!b.lockChip) return 'CX build needs a lock chip';
    if (!b.assistBlade) return 'CX build needs an assist blade';
    if (!b.mainBlade && !(b.overBlade && b.metalBlade)) return 'CX build needs a main blade, or an over blade and a metal blade';
    for (const f of CX_FIELDS) if (b[f] && !lookup(partsById, b[f])) return `Unknown part ${b[f]}`;
  } else if (b.type === 'single') {
    const blade = lookup(partsById, b.bladeId);
    if (!blade) return 'Unknown blade';
    builtIn = !!blade.builtInRatchet;
  } else {
    return 'Unknown blade type';
  }
  const noRatchet = builtIn || !!bit.ratchetIntegrated;
  if (noRatchet && combo.ratchet != null) {
    return builtIn ? 'This blade has a built-in ratchet, so no ratchet can be chosen' : 'This bit has an integrated ratchet, so no ratchet can be chosen';
  }
  if (!noRatchet) {
    if (combo.ratchet == null) return 'Combo needs a ratchet';
    if (!lookup(partsById, combo.ratchet)) return 'Unknown ratchet';
  }
  return null;
}

function presetMatch(blade, partsById) {
  if (partsById instanceof Map) {
    for (const p of partsById.values()) if (matches(p, blade)) return p;
    return null;
  }
  for (const p of Object.values(partsById ?? {})) if (matches(p, blade)) return p;
  return null;
}

function matches(p, blade) {
  const c = p.cxPreset;
  if (p.kind !== 'blade' || !c) return false;
  return CX_FIELDS.every((f) => (c[f] ?? null) === (blade[f] ?? null));
}

export function comboLabel(combo, partsById) {
  const b = combo.blade;
  let bladeText;
  if (b.type === 'cx') {
    const preset = presetMatch(b, partsById);
    if (preset) bladeText = preset.displayName || preset.name;
    else {
      const body = b.mainBlade
        ? nameOf(partsById, b.mainBlade)
        : `${nameOf(partsById, b.overBlade)} ${nameOf(partsById, b.metalBlade)}`;
      bladeText = `${nameOf(partsById, b.lockChip)} ${body} [${nameOf(partsById, b.assistBlade)}]`;
    }
  } else {
    bladeText = nameOf(partsById, b.bladeId);
  }
  const bits = [bladeText];
  if (combo.ratchet) bits.push(nameOf(partsById, combo.ratchet));
  bits.push(nameOf(partsById, combo.bit));
  return bits.join(' ');
}

export function deckClashes(combos) {
  const byPart = new Map();
  for (const c of combos) {
    const id = comboId(c);
    for (const p of new Set(comboParts(c))) {
      if (!byPart.has(p)) byPart.set(p, []);
      byPart.get(p).push(id);
    }
  }
  const out = [];
  for (const [partId, comboIds] of byPart) if (comboIds.length > 1) out.push({ partId, comboIds });
  return out;
}

export function isLegalDeck(combos) {
  return deckClashes(combos).length === 0;
}
