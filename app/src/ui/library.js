// Parts tab: tiles per group, owned toggle, detail sheet with photos, add/merge/rename.
// DOM is built with textContent only (names can be user-entered).
import { PART_KINDS, PART_TYPES, searchParts, slug, sortParts, typeLabel } from '../catalog.js';
import { resizeImage } from '../photos.js';
import { h, openSheet, searchBox, listButton, comboThumbs, statBars } from './pickers.js';
import { partsToFind } from '../ideas.js';
import { fitRatings } from '../ratings.js';
import { gradesFor } from '../grades.js';
import { toast } from './log.js';

const GROUPS = [
  { id: 'blade', label: 'Blades', kinds: ['blade'] },
  { id: 'ratchet', label: 'Ratchets', kinds: ['ratchet'] },
  { id: 'bit', label: 'Bits', kinds: ['bit'] },
  { id: 'cx', label: 'CX pieces', kinds: ['lock_chip', 'main_blade', 'over_blade', 'metal_blade', 'assist_blade'] },
];
const KIND_LABEL = {
  blade: 'Blade', ratchet: 'Ratchet', bit: 'Bit', lock_chip: 'Lock chip', main_blade: 'Main blade',
  over_blade: 'Over blade', metal_blade: 'Metal blade', assist_blade: 'Assist blade',
};
// Kinds that never carry a type (so no type tag, filter or picker).
const UNTYPED = new Set(['ratchet', 'lock_chip']);
const CONF_LABEL = { high: 'high', medium: 'medium (combo shot)', low: 'low confidence' };

// Session memory (not persisted).
let groupId = 'blade';
let query = '';
let ownedOnly = false;
let typeFilter = 'all';
let byTier = false;
let lookFor = false;

let tileUrls = [];
const revoke = (urls) => { for (const u of urls.splice(0)) URL.revokeObjectURL(u); };

const text = (tag, cls, s) => { const e = h(tag, cls ? { class: cls } : {}); e.textContent = s; return e; };
const typeTag = (type) => { const l = typeLabel(type); return l ? text('span', `type type-${type}`, l) : null; };
function typeSelect(current) {
  const sel = h('select', { class: 'field', 'aria-label': 'Type' });
  for (const t of ['', ...PART_TYPES]) {
    const o = h('option', { value: t });
    o.textContent = t ? typeLabel(t) : 'Not sure';
    if ((current ?? '') === t) o.selected = true;
    sel.append(o);
  }
  return sel;
}
const btn = (label, onClick, cls = '') => {
  const b = h('button', { type: 'button', class: cls });
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
};

function photosOf(state, partId) {
  return state.photos.filter((p) => p.partId === partId).sort((a, b) => a.ts - b.ts);
}
function coverPhoto(state, part) {
  const mine = photosOf(state, part.id);
  return mine.find((p) => p.id === part.coverPhotoId) ?? mine[0] ?? null;
}

function refImg(part, cls) {
  const img = h('img', { class: cls, alt: part.displayName, loading: 'lazy', referrerpolicy: 'no-referrer', src: part.imageUrl });
  img.addEventListener('error', () => img.replaceWith(text('div', `${cls} none`, 'no reference photo')));
  return img;
}

async function keepScroll(ctx, el) {
  const top = el.scrollTop;
  await ctx.refresh();
  el.scrollTop = top;
}

function subtitle(p) {
  const bits = [];
  if (p.kind !== 'blade' && p.kind !== 'ratchet' && p.kind !== 'bit') bits.push(KIND_LABEL[p.kind]);
  const alts = (p.altNames ?? []).filter((a) => !/[^\x00-\x7F]/.test(a)).map((a) => a.replace(/\s*\(.*?\)\s*$/, '').trim());
  if (alts.length) bits.push(alts.slice(0, 2).join(' / '));
  if (p.builtInRatchet) bits.push('built-in ratchet');
  if (p.ratchetIntegrated) bits.push('ratchet + bit in one');
  if (p.source === 'user') bits.push('your part');
  return bits.join(' · ');
}

export const tab = {
  id: 'library',
  label: 'Parts',
  render(ctx, el) {
    revoke(tileUrls);
    const state = ctx.store.state();
    const group = GROUPS.find((g) => g.id === groupId);

    const seg = h('div', { class: 'seg', role: 'tablist' });
    for (const g of GROUPS) {
      const b = btn(g.label, () => { groupId = g.id; ctx.refresh(); });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(g.id === groupId));
      seg.append(b);
    }

    const grid = h('div', { class: 'tiles' });
    const count = h('p', { class: 'muted' });

    function fill() {
      revoke(tileUrls);
      grid.replaceChildren();
      const base = ctx.parts.filter((p) => !p.hidden && group.kinds.includes(p.kind));
      let hits = searchParts(base, query);
      if (!query.trim()) hits = sortParts(hits, group.kinds);
      if (ownedOnly) hits = hits.filter((p) => p.owned);
      if (typeFilter !== 'all') hits = hits.filter((p) => p.type === typeFilter);
      if (byTier) { const g = gradesFor(ctx.parts); hits = [...hits].sort((a, b) => gradeRank(g.get(b.id)) - gradeRank(g.get(a.id)) || (b.meta?.cuts ?? 0) - (a.meta?.cuts ?? 0)); }
      const owned = base.filter((p) => p.owned).length;
      count.textContent = `${hits.length} shown · ${owned} of ${base.length} owned`;
      for (const p of hits) grid.append(tile(p));
      if (!hits.length) grid.append(h('p', { class: 'muted' }, ownedOnly ? 'No owned parts match.' : 'Nothing matches.'));
    }

    function tile(p) {
      const cover = coverPhoto(state, p);
      let img;
      if (cover) {
        const u = URL.createObjectURL(cover.blob);
        tileUrls.push(u);
        img = h('img', { class: 'tile-img', alt: '', src: u });
      } else if (p.imageUrl) {
        img = refImg(p, 'tile-img');
      } else {
        img = text('div', 'tile-img none', 'no reference photo');
      }
      const t = h('div', { class: `tile${p.owned ? ' owned' : ''}`, role: 'button', tabindex: '0', 'aria-pressed': String(p.owned) });
      const name = text('div', 'n', p.displayName);
      const sub = subtitle(p);
      const conf = !cover && p.imageUrl && p.imageConfidence ? text('span', 'conf', CONF_LABEL[p.imageConfidence] ?? p.imageConfidence) : null;
      const s = h('div', { class: 's' }, sub ? `${sub} ` : '', conf);
      t.append(img, name);
      const tag = typeTag(p.type);
      if (tag) t.append(tag);
      t.append(s);
      if (p.owned) t.append(text('span', 'badge', p.multiple ? '✓ Owned · multiple' : '✓ Owned'));
      const g = gradesFor(ctx.parts).get(p.id);
      if (g) t.append(gradeBadge(g));
      const info = h('button', { type: 'button', class: 'info', 'aria-label': `Details for ${p.displayName}` });
      info.textContent = 'ⓘ';
      info.addEventListener('click', (e) => { e.stopPropagation(); openDetail(ctx, p.id); });
      t.append(info);
      const toggle = async () => {
        await ctx.store.setOverride(p.id, { owned: !p.owned });
        toast(`${p.displayName}: ${p.owned ? 'not owned' : 'owned'}`);
        await keepScroll(ctx, el);
      };
      t.addEventListener('click', toggle);
      t.addEventListener('keydown', (e) => { if (e.target !== t) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      return t;
    }

    const search = searchBox((v) => { query = v; fill(); }, 'Search all names');
    search.value = query;
    const ownedSw = h('button', { type: 'button', class: `switch${ownedOnly ? ' on' : ''}`, role: 'switch', 'aria-checked': String(ownedOnly) },
      h('span', { class: 'knob' }), 'Owned only');
    ownedSw.addEventListener('click', () => { ownedOnly = !ownedOnly; ctx.refresh(); });
    const addBtn = btn('Add part', () => openAddPart(ctx), 'primary');
    const tierSw = h('button', { type: 'button', class: `switch${byTier ? ' on' : ''}`, role: 'switch', 'aria-checked': String(byTier) },
      h('span', { class: 'knob' }), 'Sort by tier');
    tierSw.addEventListener('click', () => { byTier = !byTier; ctx.refresh(); });
    const lookSw = h('button', { type: 'button', class: `switch${lookFor ? ' on' : ''}`, role: 'switch', 'aria-checked': String(lookFor) },
      h('span', { class: 'knob' }), 'Parts to look for');
    lookSw.addEventListener('click', () => { lookFor = !lookFor; ctx.refresh(); });
    if (lookFor) {
      el.append(h('div', { class: 'lib-bar' }, lookSw), wantList(ctx, state, el));
      return;
    }
    const bar = h('div', { class: 'lib-bar' }, ownedSw, tierSw, lookSw, addBtn);

    const typed = group.kinds.some((k) => !UNTYPED.has(k));
    if (!typed) typeFilter = 'all';
    const types = h('div', { class: 'chips type-filter', role: 'group', 'aria-label': 'Filter by type' });
    for (const t of ['all', ...PART_TYPES]) {
      const b = btn(t === 'all' ? 'All types' : typeLabel(t), () => { typeFilter = t; ctx.refresh(); },
        `chip${t === 'all' ? '' : ` type-${t}`}`);
      b.setAttribute('aria-pressed', String(typeFilter === t));
      types.append(b);
    }

    el.append(seg, search, bar);
    if (typed) el.append(types);
    el.append(count, grid);
    fill();
  },
};

// ---------- parts to look for ----------

// Unowned parts that would most improve your combos (see partsToFind), with what each would make.
function wantList(ctx, state, el) {
  const box = h('div', { class: 'want' });
  const list = partsToFind(state, ctx.parts, { reference: ctx.reference, ratings: fitRatings(state.battles) });
  box.append(text('p', 'muted', 'Parts you don\'t have yet that would make your best combos better, going by WBO results and packaging stats. Worth looking for at the next event or store trip.'));
  if (!list.length) {
    box.append(text('p', 'muted', state.combos.length ? 'Nothing stands out: your parts already cover the best options we know of.' : 'Add some combos first, then this shows parts that would make them better.'));
    return box;
  }
  const section = (title, items) => {
    if (!items.length) return;
    box.append(text('h3', '', title));
    for (const x of items) {
      const p = x.part;
      const img = p.imageUrl ? refImg(p, 'want-img') : text('div', 'want-img none', 'no photo');
      const head = h('div', { class: 'want-head' }, text('strong', '', p.displayName));
      const g = gradesFor(ctx.parts).get(p.id);
      if (g) head.append(gradeBadge(g));
      const info = btn('Details', () => openDetail(ctx, p.id));
      const got = btn('I got it', async () => {
        await ctx.store.setOverride(p.id, { owned: true });
        toast(`${p.displayName}: owned`);
        await keepScroll(ctx, el);
      }, 'primary');
      box.append(h('div', { class: 'want-card' }, img, h('div', { class: 'want-body' },
        head, text('p', 'kid', x.reason), comboThumbs(x.combo, ctx.partsById), h('div', { class: 'want-acts' }, info, got))));
    }
  };
  section('Ratchets and bits', list.filter((x) => x.part.kind !== 'blade'));
  section('Blades', list.filter((x) => x.part.kind === 'blade'));
  return box;
}

// ---------- reference: packaging stats and WBO results ----------

const TIER_ORDER = { X: 5, S: 4, A: 3, B: 2, C: 1, D: 0, '?': -0.5 };
// Real WBO tiers sort just ahead of guesses of the same grade.
const gradeRank = (g) => (g ? (TIER_ORDER[g.grade] ?? -1) + (g.basis === 'wbo' ? 0.1 : 0) : -1);
const BASIS_TEXT = { parts: 'Graded from its parts', guess: 'A guess', new: 'Too new to grade', none: 'Not enough to go on' };
// Solid badge = WBO tier; striped badge = graded from its parts, or a guess.
function gradeBadge(g) {
  const b = text('span', `tier tier-${g.grade === '?' ? 'q' : g.grade}${g.basis === 'wbo' ? '' : ' guess'}`, g.grade);
  b.title = g.basis === 'wbo' ? 'WBO tier' : BASIS_TEXT[g.basis];
  return b;
}
function guessBox(g) {
  const box = h('section', { class: 'wbo' });
  box.append(text('h3', '', 'Grade'));
  box.append(h('div', { class: 'wbo-head' }, (() => { const b = gradeBadge(g); b.classList.add('big'); return b; })(),
    h('div', {}, text('p', '', BASIS_TEXT[g.basis]), text('p', 'muted', g.why))));
  box.append(text('p', 'muted', 'Striped badges are grades without WBO results of their own: worked out from the CX parts, or guessed from parts with similar packaging stats.'));
  return box;
}
// Top of each kind's packaging scale (just above the highest value printed for that kind).
const STAT_SCALE = { blade: 100, main_blade: 50, over_blade: 10, metal_blade: 25, assist_blade: 40, ratchet: 20, bit: 80, lock_chip: 50 };
// Segmented bars like the ones on the box, with the number at the end.
function partStatBars(part) {
  const box = statBars(part.stats, { title: 'Packaging stats', scale: STAT_SCALE[part.kind] ?? 100 });
  if (part.stats.height != null && part.kind === 'ratchet') box.append(text('p', 'muted', `Height ${part.stats.height}`));
  return box;
}

function wboBox(part, reference) {
  const m = part.meta;
  const box = h('section', { class: 'wbo' });
  box.append(text('h3', '', 'At WBO events'));
  const kindName = { blade: 'blades', main_blade: 'blades', ratchet: 'ratchets', bit: 'bits', lock_chip: 'lock chips', over_blade: 'over blades', assist_blade: 'assist blades' }[part.kind] ?? 'parts';
  box.append(h('div', { class: 'wbo-head' },
    text('span', `tier big tier-${m.tier === '?' ? 'q' : m.tier}`, m.tier),
    h('div', {},
      text('p', '', `#${m.rank} of ${m.of} ${kindName}`),
      text('p', 'muted', m.tier === '?' ? 'Fewer than 60 top-3 finishes, so no tier yet.' : `${Math.round(m.firstRate * 100)}% of its ${m.cuts.toLocaleString('en-US')} top-3 finishes were 1st place.`))));
  if (m.bestCombo) box.append(text('p', '', `Most successful combo: ${m.bestCombo}`));
  box.append(text('p', 'muted', `From beywatch.gg (all-time, worldwide${reference?.asOf ? `, as of ${reference.asOf}` : ''}). Stats from the Beyblade wiki.`));
  return box;
}

// ---------- detail sheet ----------

function openDetail(ctx, partId) {
  const sheet = openSheet('');
  let urls = [];
  let error = '';
  let editing = false;
  let confirmDel = null;
  let closed = false;
  const close = () => { closed = true; revoke(urls); sheet.done(null); };

  async function act(fn) {
    error = '';
    try { await fn(); } catch (e) { error = e.message; }
    await ctx.refresh();
    if (!closed) draw();
  }

  function draw() {
    revoke(urls);
    const part = ctx.partsById.get(partId);
    if (!part) { close(); return; }
    const state = ctx.store.state();
    const mine = photosOf(state, partId);
    const cover = coverPhoto(state, part);
    sheet.head.replaceChildren(btn('Close', close), sheet.heading);
    sheet.setTitle(part.displayName);
    const body = sheet.body;
    body.replaceChildren();
    if (error) body.append(h('p', { class: 'error', role: 'alert' }, error));

    const meta = [KIND_LABEL[part.kind], part.line, typeLabel(part.type)].filter(Boolean).join(' · ');
    body.append(text('p', 'muted', meta));
    if (part.name !== part.displayName) body.append(text('p', 'muted', `Catalog name: ${part.name}`));
    const alts = (part.altNames ?? []).join(', ');
    if (alts) body.append(text('p', 'muted', `Also known as: ${alts}`));
    if (part.stats) body.append(partStatBars(part));
    if (part.meta) body.append(wboBox(part, ctx.reference));
    const grade = gradesFor(ctx.parts).get(part.id);
    if (grade && grade.basis !== 'wbo') body.append(guessBox(grade));

    // How many you own: only matters for testing, since two combos sharing a part can battle
    // each other only if you have more than one of it. Decks still can't repeat a part.
    if (part.owned) {
      const cb = h('input', { type: 'checkbox', checked: !!part.multiple });
      cb.addEventListener('change', () => act(async () => {
        await ctx.store.setOverride(partId, { multiple: cb.checked });
        toast(`${part.displayName}: ${cb.checked ? 'you have multiple' : 'you have one'}`);
      }));
      body.append(h('label', { class: 'check' }, cb, 'Have multiple'),
        text('p', 'muted', 'Lets Next suggest two combos that both use this part against each other.'));
    }

    // photos
    const refBox = h('figure', { class: 'ph' });
    if (part.imageUrl) {
      refBox.append(refImg(part, 'ph-img'), text('figcaption', 'muted', `Reference photo (${CONF_LABEL[part.imageConfidence] ?? part.imageConfidence ?? 'unrated'})`));
    } else {
      refBox.append(text('div', 'ph-img none', 'no reference photo'));
    }
    const photoRow = h('div', { class: 'photos' }, refBox);
    for (const ph of mine) {
      const u = URL.createObjectURL(ph.blob);
      urls.push(u);
      const isCover = cover?.id === ph.id;
      const fig = h('figure', { class: 'ph' }, h('img', { class: 'ph-img', alt: 'Your photo', src: u }));
      const row = h('div', { class: 'ph-actions' });
      if (isCover) row.append(text('span', 'conf', 'Tile photo'));
      else row.append(btn('Set as cover', () => act(() => ctx.store.setOverride(partId, { coverPhotoId: ph.id }))));
      if (confirmDel === ph.id) {
        row.append(btn('Confirm delete', () => { confirmDel = null; act(() => ctx.store.removePhoto(ph.id)); }, 'danger'),
          btn('Keep', () => { confirmDel = null; draw(); }));
      } else row.append(btn('Delete', () => { confirmDel = ph.id; draw(); }, 'danger'));
      fig.append(row);
      photoRow.append(fig);
    }
    body.append(photoRow);

    const addPhoto = btn('Add photo', () => {
      const input = h('input', { type: 'file', accept: 'image/*', hidden: true, id: 'photo-input' });
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        await act(async () => {
          const { blob, w, h: hh } = await resizeImage(file);
          await ctx.store.addPhoto(partId, blob, w, hh);
        });
      });
      document.getElementById('photo-input')?.remove();
      document.body.append(input);
      input.click();
    }, 'primary');
    body.append(addPhoto);

    // rename
    body.append(text('h3', '', 'Name'));
    const nameIn = h('input', { type: 'text', class: 'field', value: part.displayName, autocomplete: 'off', 'aria-label': 'Preferred name' });
    const save = btn('Save name', () => act(async () => {
      const v = nameIn.value.trim();
      await ctx.store.setOverride(partId, { preferredName: v === part.name ? '' : v });
      toast(v && v !== part.name ? 'Renamed' : 'Name reset');
    }));
    const reset = btn('Reset', () => act(() => ctx.store.setOverride(partId, { preferredName: '' })));
    body.append(nameIn, h('div', { class: 'row-btns' }, save, reset),
      text('p', 'muted', 'Empty or the catalog name clears your custom name.'));

    if (part.source === 'user') userControls(body, part);
  }

  function userControls(body, part) {
    body.append(text('h3', '', 'Your part'));
    if (editing) {
      const nm = h('input', { type: 'text', class: 'field', value: part.name, 'aria-label': 'Name' });
      const al = h('input', { type: 'text', class: 'field', value: (part.altNames ?? []).join(', '), 'aria-label': 'Alt names, comma separated' });
      const flag = part.kind === 'blade' ? ['builtInRatchet', 'Built-in ratchet'] : part.kind === 'bit' ? ['ratchetIntegrated', 'Ratchet-integrated (ratchet + bit in one)'] : null;
      const cb = flag ? h('input', { type: 'checkbox', checked: !!part[flag[0]] }) : null;
      const ty = UNTYPED.has(part.kind) ? null : typeSelect(part.type);
      body.append(text('label', 'lbl', 'Name'), nm, text('label', 'lbl', 'Alt names (comma separated)'), al);
      if (ty) body.append(text('label', 'lbl', 'Type'), ty);
      if (cb) body.append(h('label', { class: 'check' }, cb, flag[1]));
      body.append(h('div', { class: 'row-btns' },
        btn('Save', () => act(async () => {
          const name = nm.value.trim();
          if (!name) throw new Error('A part needs a name.');
          const patch = { name, altNames: splitNames(al.value) };
          if (ty) patch.type = ty.value || null;
          if (flag) patch[flag[0]] = cb.checked;
          await ctx.store.updateUserPart(part.id, patch);
          editing = false;
        }), 'primary'),
        btn('Cancel', () => { editing = false; draw(); })));
    } else {
      body.append(h('div', { class: 'row-btns' },
        btn('Edit', () => { editing = true; draw(); }),
        btn('Merge into…', async () => {
          const merged = await openMergePicker(ctx, part);
          if (merged) close();
        })));
    }
  }

  draw();
  return sheet.promise;
}

const splitNames = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

function openMergePicker(ctx, from) {
  const sheet = openSheet(`Merge ${from.displayName} into…`);
  sheet.head.append(btn('Cancel', () => sheet.done(false)), sheet.heading);
  const msg = h('p', { class: 'error', role: 'alert' });
  const list = h('div', {});
  const known = new Set(ctx.catalogParts.map((p) => p.id));
  let pending = null;
  const fill = (q) => {
    list.replaceChildren();
    if (pending) {
      const p = ctx.partsById.get(pending);
      list.append(text('p', '', `Merge ${from.displayName} into ${p.displayName}? This can't be undone.`),
        h('div', { class: 'row-btns' },
          btn(`Confirm merge into ${p.displayName}`, async () => {
            try {
              await ctx.store.mergePart(from.id, p.id, { knownPartIds: known, partsById: ctx.partsById });
            } catch (e) { pending = null; msg.textContent = e.message; fill(q); return; }
            await ctx.refresh();
            toast(`Merged into ${p.displayName}`);
            sheet.done(true);
          }, 'danger'),
          btn('Back', () => { pending = null; fill(q); })));
      return;
    }
    const cands = searchParts(ctx.parts.filter((p) => !p.hidden && p.id !== from.id), q, from.kind).slice(0, 60);
    for (const p of cands) {
      list.append(listButton(p.displayName, () => { msg.textContent = ''; pending = p.id; fill(q); }, p.line ?? ''));
    }
    if (!cands.length) list.append(h('p', { class: 'muted' }, 'Nothing matches.'));
  };
  sheet.body.append(text('p', 'muted', `Every combo, battle and photo using ${from.displayName} moves to the part you pick, and this part is removed.`),
    msg, searchBox(fill, `Search ${KIND_LABEL[from.kind].toLowerCase()}s`), list);
  fill('');
  return sheet.promise;
}

// ---------- add part ----------

function openAddPart(ctx) {
  const sheet = openSheet('Add part');
  sheet.head.append(btn('Cancel', () => sheet.done(null)), sheet.heading);
  const err = h('p', { class: 'error', role: 'alert' });
  const kindSel = h('select', { class: 'field', 'aria-label': 'Kind' });
  for (const k of PART_KINDS) { const o = h('option', { value: k }); o.textContent = KIND_LABEL[k]; kindSel.append(o); }
  const nm = h('input', { type: 'text', class: 'field', autocomplete: 'off', 'aria-label': 'Name' });
  const al = h('input', { type: 'text', class: 'field', autocomplete: 'off', 'aria-label': 'Alt names, comma separated' });
  const cbBuilt = h('input', { type: 'checkbox' });
  const cbInt = h('input', { type: 'checkbox' });
  const lblBuilt = h('label', { class: 'check' }, cbBuilt, 'Has a built-in ratchet');
  const lblInt = h('label', { class: 'check' }, cbInt, 'Ratchet-integrated (ratchet + bit in one)');
  const tySel = typeSelect(null);
  const lblType = text('label', 'lbl', 'Type');
  const sync = () => {
    lblBuilt.hidden = kindSel.value !== 'blade'; lblInt.hidden = kindSel.value !== 'bit';
    lblType.hidden = tySel.hidden = UNTYPED.has(kindSel.value);
  };
  kindSel.addEventListener('change', sync);
  sync();
  const add = btn('Add part', async () => {
    err.textContent = '';
    const kind = kindSel.value;
    const name = nm.value.trim();
    if (!name) { err.textContent = 'Enter a name.'; return; }
    if (!slug(name)) { err.textContent = 'The name needs at least one letter or number.'; return; }
    const id = `${kind}:${slug(name)}`;
    if (ctx.partsById.has(id)) {
      err.textContent = `${ctx.partsById.get(id).displayName} already exists as a ${KIND_LABEL[kind].toLowerCase()}. Use a different name, or find the existing part.`;
      return;
    }
    const part = {
      id, kind, name, altNames: splitNames(al.value), line: null,
      type: UNTYPED.has(kind) ? null : (tySel.value || null), source: 'user',
      builtInRatchet: kind === 'blade' && cbBuilt.checked, ratchetIntegrated: kind === 'bit' && cbInt.checked,
      cxPreset: null, imageUrl: null, imageConfidence: null,
    };
    try {
      await ctx.store.addUserPart(part);
      await ctx.store.setOverride(id, { owned: true });
    } catch (e) { err.textContent = e.message; return; }
    const g = GROUPS.find((x) => x.kinds.includes(kind));
    groupId = g.id; query = ''; ownedOnly = false; typeFilter = 'all';
    await ctx.refresh();
    toast(`Added ${name}`);
    sheet.done(id);
  }, 'primary');
  sheet.body.append(err,
    text('label', 'lbl', 'Kind'), kindSel, text('label', 'lbl', 'Name'), nm,
    text('label', 'lbl', 'Alt names (comma separated)'), al, lblType, tySel, lblBuilt, lblInt, add);
  return sheet.promise;
}
