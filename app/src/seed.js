// Appendix A preload. Runs in Node and the browser.
import { comboId } from './combo.js';

const FINISH = { P: 'pocket', B: 'burst', X: 'xtreme', S: 'spin' };
const POP_OUT = {
  id: 'bit:pop-out-unverified', kind: 'bit', name: 'Pop Out (unverified)', altNames: [], line: null, type: null,
  source: 'user', builtInRatchet: false, ratchetIntegrated: false, cxPreset: null, imageUrl: null, imageConfidence: null,
};
const OWNED = [
  'blade:wizard-rod', 'blade:cobalt-drake', 'blade:pegasus-blast', 'blade:red-hulk', 'blade:bullet-griffon',
  'ratchet:1-60', 'ratchet:2-60',
  'bit:gear-ball', 'bit:free-flat', 'bit:free-ball', 'bit:low-rush', 'bit:hexa', 'bit:turbo', POP_OUT.id,
  'lock_chip:pegasus', 'main_blade:blast', 'assist_blade:assault',
];

// [blade, ratchet, bit] per combo key. 'pegasus' is the cx preset from the catalog.
const COMBOS = {
  wizard: ['blade:wizard-rod', 'ratchet:2-60', 'bit:gear-ball'],
  cobalt: ['blade:cobalt-drake', 'ratchet:1-60', 'bit:free-flat'],
  pegasus: ['blade:pegasus-blast', 'ratchet:2-60', 'bit:free-ball'],
  hulk: ['blade:red-hulk', 'ratchet:1-60', 'bit:low-rush'],
  popout: ['blade:pegasus-blast', 'ratchet:2-60', POP_OUT.id],
  griffon: ['blade:bullet-griffon', null, 'bit:hexa'],
};
const BASELINE = ['wizard', 'cobalt', 'pegasus'];

// Tokens: [+-]N then optional P/B/X/S/? ; 'D' or 'D=note' for a draw.
const ROWS = [
  ['hulk', 'wizard', ['-1', '+2?', '-1', 'D=Red Hulk Burst / Wizard Rod Pocket', '-1', '-1', '-1', '-1', '-1', '+3']],
  ['hulk', 'cobalt', ['-3', '+1', '+1', '+1', '-2P', '+1', '-3', '-1', '+1', '-2P']],
  ['hulk', 'pegasus', ['+3', '+1', '+1', '-1', 'D', '-2P', '-1', '+2B', '-1', '-1']],
  ['popout', 'wizard', ['-1', '-1', '-2B', '-2B', '-1', '+2B', '-1', '-2P', '-2B', '+3']],
  ['popout', 'cobalt', ['-1', '-2B', '-3', '-2B', '+2P', '-2P', '-3', '-1', '+1', '+1']],
  ['griffon', 'pegasus', ['-3', '-3', '+2B', '-1', '-3', '-1', '-1', '-2?', '+1', '-3']],
];

function parseToken(tok) {
  if (tok.startsWith('D')) return { winner: 'draw', finish: null, points: 0, note: tok.startsWith('D=') ? tok.slice(2) : '' };
  const m = /^([+-])(\d)([PBXS?])?$/.exec(tok);
  if (!m) throw new Error(`Bad seed token: ${tok}`);
  const points = Number(m[2]);
  let finish;
  if (m[3] === '?') finish = 'unknown';
  else if (m[3]) finish = FINISH[m[3]];
  else if (points === 1) finish = 'spin';
  else if (points === 3) finish = 'xtreme';
  else finish = 'unknown';
  return { winner: m[1] === '+' ? 'left' : 'right', finish, points, note: '' };
}

export function buildSeed(catalogParts, now = Date.UTC(2026, 10, 6)) {
  const pegasus = catalogParts.find((p) => p.id === 'blade:pegasus-blast');
  if (!pegasus?.cxPreset) throw new Error('Catalog has no cx preset for Pegasus Blast');

  const combos = {};
  for (const [key, [bladeId, ratchet, bit]] of Object.entries(COMBOS)) {
    const blade = bladeId === 'blade:pegasus-blast' ? { type: 'cx', ...pegasus.cxPreset } : { type: 'single', bladeId };
    const c = { blade, ratchet, bit };
    combos[key] = { id: comboId(c), ...c };
  }

  const overrides = { 'blade:bullet-griffon': { preferredName: 'Rocket Griffon', owned: true } };
  for (const id of OWNED) overrides[id] = { ...overrides[id], owned: true };

  const battles = [];
  ROWS.forEach(([l, r, tokens], row) => {
    tokens.forEach((tok, i) => {
      battles.push({
        id: `seed-${row + 1}-${i + 1}`, left: combos[l].id, right: combos[r].id,
        ...parseToken(tok), ts: now + battles.length * 60000,
      });
    });
  });

  return {
    userParts: [{ ...POP_OUT }],
    overrides,
    combos: Object.values(combos),
    battles,
    field: BASELINE.map((k) => ({ comboId: combos[k].id, active: true, core: true })),
  };
}
