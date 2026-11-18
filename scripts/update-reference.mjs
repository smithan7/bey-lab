// Builds app/data/reference.json: packaging stats per part (Beyblade fandom wiki) and WBO
// tournament results per part and top combos (beywatch.gg, default all-time worldwide view).
// Run by hand when the user asks to refresh the meta:  node scripts/update-reference.mjs
// Polite: batched wiki API calls, one beywatch page at a time, a short pause between requests.
import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeCatalog, slug } from '../app/src/catalog.js';

const UA = 'bey-lab-reference/1.0 (personal deck-testing app)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = new URL('..', import.meta.url);
const raw = JSON.parse(readFileSync(new URL('app/data/parts-catalog.json', root), 'utf8'));
const parts = normalizeCatalog(raw);

async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res;
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`fetch failed: ${url}`);
}

// ---- wiki stats ----
// Catalog entries carry their wiki page (image_page). Map page title → part id.
const titleToId = new Map();
const entries = [
  ...raw.blades.map((e) => ['blade', e]), ...raw.ratchets.map((e) => ['ratchet', e]), ...raw.bits.map((e) => ['bit', e]),
  ...Object.entries(raw.cx_parts ?? {}).flatMap(([k, list]) => (Array.isArray(list) ? list.map((e) => [k.slice(0, -1), e]) : [])),
];
for (const [kind, e] of entries) {
  const m = /\/wiki\/(.+)$/.exec(e.image_page ?? '');
  if (m) titleToId.set(decodeURIComponent(m[1]).replace(/_/g, ' '), `${kind}:${slug(e.name)}`);
}

const STAT_FIELDS = { AttackStat: 'attack', DefenseStat: 'defense', StaminaStat: 'stamina', DashStat: 'dash', BurstResistanceStat: 'burst', HeightStat: 'height' };
function parseStats(wikitext) {
  const out = {};
  for (const [field, key] of Object.entries(STAT_FIELDS)) {
    const m = new RegExp(`\\|\\s*${field}\\s*=\\s*([0-9]+)`).exec(wikitext);
    if (m) out[key] = Number(m[1]);
  }
  return Object.keys(out).length ? out : null;
}

const stats = {};
const titles = [...titleToId.keys()];
for (let i = 0; i < titles.length; i += 50) {
  const batch = titles.slice(i, i + 50);
  const url = `https://beyblade.fandom.com/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(batch.join('|'))}`;
  const data = await (await get(url)).json();
  const redirect = new Map((data.query?.redirects ?? []).map((r) => [r.to, r.from]));
  const normal = new Map((data.query?.normalized ?? []).map((r) => [r.to, r.from]));
  for (const page of data.query?.pages ?? []) {
    const text = page.revisions?.[0]?.slots?.main?.content;
    if (!text) continue;
    const t = redirect.get(page.title) ?? page.title;
    const id = titleToId.get(normal.get(t) ?? t) ?? titleToId.get(t);
    const s = id && parseStats(text);
    if (s) stats[id] = s;
  }
  await sleep(500);
}

// ---- beywatch.gg ----
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '|').replace(/\|\s*\|+/g, '|').replace(/\s+/g, ' ');
// Table rows, walked by rank (1, 2, 3, …): name, optional "(alt name)", "N% 1st", "N cuts", tier,
// and for blades the best combo. The three page layouts differ in spacing but share this order.
function rows(html) {
  const tok = text(html).split('|').map((x) => x.trim()).filter(Boolean);
  const start = tok.findIndex((x) => x.startsWith('Rank'));
  const out = [];
  let want = 1;
  for (let i = Math.max(0, start); i < tok.length - 3; i++) {
    if (tok[i] !== String(want)) continue;
    const name = tok[i + 1];
    let j = i + 2;
    while (j < tok.length && !/% 1st/.test(tok[j]) && j < i + 8) j++;
    const fr = /([\d.]+)% 1st/.exec(tok[j] ?? '');
    if (!fr) continue;
    const cutsTok = /cuts/.test(tok[j]) ? tok[j] : tok[j + 1];
    const cm = /([\d,]+) cuts/.exec(cutsTok ?? '');
    let k = j + 1;
    while (k < tok.length && !/^[XSABC?]$/.test(tok[k]) && k < j + 25) k++;
    if (!cm || !/^[XSABC?]$/.test(tok[k] ?? '')) continue;
    // Best combo (blade table): first later token that looks like "<name> <ratchet><bit>" or ends a combo.
    let best = null;
    for (let q = k + 1; q < Math.min(tok.length, k + 14); q++) {
      if (tok[q] === String(want + 1)) break;
      if (/[A-Za-z]/.test(tok[q]) && !/%|^\+$|^\(/.test(tok[q]) && tok[q] !== name) { best = tok[q]; break; }
    }
    out.push({ rank: want, name: name.replace(/\s*\([^)]*\)\s*$/, ''), firstRate: Number((Number(fr[1]) / 100).toFixed(3)), cuts: Number(cm[1].replace(/,/g, '')), tier: tok[k], best });
    want++;
    i = k;
  }
  return out;
}

const byName = new Map();
for (const p of parts) {
  for (const n of [p.name, ...(p.altNames ?? [])]) {
    const key = `${p.kind}:${slug(n.replace(/\s*\([^)]*\)\s*/g, ' '))}`;
    if (!byName.has(key)) byName.set(key, p.id);
  }
}
const idFor = (kind, name) => byName.get(`${kind}:${slug(name.replace(/\s*\([^)]*\)\s*/g, ' '))}`) ?? null;

const PAGES = [['blade', ''], ['ratchet', 'ratchets'], ['bit', 'bits'], ['lock_chip', 'lock-chips'], ['over_blade', 'over-blades'], ['assist_blade', 'assist-blades']];
const meta = {};
const unmatched = [];
for (const [kind, page] of PAGES) {
  const list = rows(await (await get(page ? `https://beywatch.gg/parts/${page}` : 'https://beywatch.gg/')).text());
  for (const r of list) {
    // beywatch lists CX main blades (Blast, Delta…) in its blade table.
    const id = idFor(kind, r.name) ?? (kind === 'blade' ? idFor('main_blade', r.name) : null);
    if (id) meta[id] = { tier: r.tier, firstRate: r.firstRate, cuts: r.cuts, rank: r.rank, of: list.length, ...(kind === 'blade' && r.best ? { bestCombo: r.best } : {}) };
    else unmatched.push(`${kind}: ${r.name}`);
  }
  await sleep(1000);
}

// Top combos, e.g. "Shark Scale 7-60R (Scale Shark 7-60R)": blade, ratchet, bit abbreviation.
const bitByAbbrev = new Map(raw.bits.filter((b) => b.abbrev).map((b) => [b.abbrev, `bit:${slug(b.name)}`]));
const combos = [];
for (const r of rows(await (await get('https://beywatch.gg/combos')).text())) {
  const nm = r.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  // "Blade 1-60H", or "Blade K" for blades with a built-in ratchet.
  const m = /^(.+?) (\d+-\d+)([A-Za-z]+)$/.exec(nm) ?? /^(.+?) ()([A-Za-z]+)$/.exec(nm);
  const blade = m && idFor('blade', m[1]);
  const ratchet = m && (m[2] ? idFor('ratchet', m[2]) : null);
  const bit = m && bitByAbbrev.get(m[3]);
  const builtIn = blade && parts.find((p) => p.id === blade)?.builtInRatchet;
  if (blade && bit && (ratchet || (!m[2] && builtIn))) combos.push({ blade, ratchet, bit, name: r.name.replace(/\s*\([^)]*\)\s*$/, ''), tier: r.tier, firstRate: r.firstRate, cuts: r.cuts, rank: r.rank });
  else unmatched.push(`combo: ${r.name}`);
}

const out = {
  asOf: new Date().toISOString().slice(0, 10),
  sources: {
    stats: 'Packaging stats from the Beyblade fandom wiki (beyblade.fandom.com).',
    meta: 'Tournament results from beywatch.gg (all-time, worldwide; top-3 finishes from WBO winning combos, WBO Leagues and MetaBeys).',
  },
  stats, meta, combos,
};
writeFileSync(new URL('app/data/reference.json', root), JSON.stringify(out) + '\n');
console.log(`stats: ${Object.keys(stats).length} parts · meta: ${Object.keys(meta).length} parts · combos: ${combos.length}`);
if (unmatched.length) console.log(`unmatched (${unmatched.length}):\n  ${unmatched.slice(0, 40).join('\n  ')}`);
