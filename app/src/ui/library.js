// Parts tab: tiles per group, owned toggle, detail sheet with photos, add/merge/rename.
// DOM is built with textContent only (names can be user-entered).
import { PART_KINDS, searchParts, slug } from '../catalog.js';
import { resizeImage } from '../photos.js';
import { h, openSheet, searchBox, listButton } from './pickers.js';
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
const CONF_LABEL = { high: 'high', medium: 'medium (combo shot)', low: 'low confidence' };

// Session memory (not persisted).
let groupId = 'blade';
let query = '';
let ownedOnly = false;

let tileUrls = [];
const revoke = (urls) => { for (const u of urls.splice(0)) URL.revokeObjectURL(u); };

const text = (tag, cls, s) => { const e = h(tag, cls ? { class: cls } : {}); e.textContent = s; return e; };
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
      if (!query.trim()) hits = hits.sort((a, b) => group.kinds.indexOf(a.kind) - group.kinds.indexOf(b.kind));
      if (ownedOnly) hits = hits.filter((p) => p.owned);
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
      t.append(img, name, s);
      if (p.owned) t.append(text('span', 'badge', '✓ Owned'));
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
    const bar = h('div', { class: 'lib-bar' }, ownedSw, addBtn);

    el.append(seg, search, bar, count, grid);
    fill();
  },
};

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

    const meta = [KIND_LABEL[part.kind], part.line, part.type].filter(Boolean).join(' · ');
    body.append(text('p', 'muted', meta));
    if (part.name !== part.displayName) body.append(text('p', 'muted', `Catalog name: ${part.name}`));
    const alts = (part.altNames ?? []).join(', ');
    if (alts) body.append(text('p', 'muted', `Also known as: ${alts}`));

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
      body.append(text('label', 'lbl', 'Name'), nm, text('label', 'lbl', 'Alt names (comma separated)'), al);
      if (cb) body.append(h('label', { class: 'check' }, cb, flag[1]));
      body.append(h('div', { class: 'row-btns' },
        btn('Save', () => act(async () => {
          const name = nm.value.trim();
          if (!name) throw new Error('A part needs a name.');
          const patch = { name, altNames: splitNames(al.value) };
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
  const sync = () => { lblBuilt.hidden = kindSel.value !== 'blade'; lblInt.hidden = kindSel.value !== 'bit'; };
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
      id, kind, name, altNames: splitNames(al.value), line: null, type: null, source: 'user',
      builtInRatchet: kind === 'blade' && cbBuilt.checked, ratchetIntegrated: kind === 'bit' && cbInt.checked,
      cxPreset: null, imageUrl: null, imageConfidence: null,
    };
    try {
      await ctx.store.addUserPart(part);
      await ctx.store.setOverride(id, { owned: true });
    } catch (e) { err.textContent = e.message; return; }
    const g = GROUPS.find((x) => x.kinds.includes(kind));
    groupId = g.id; query = ''; ownedOnly = false;
    await ctx.refresh();
    toast(`Added ${name}`);
    sheet.done(id);
  }, 'primary');
  sheet.body.append(err,
    text('label', 'lbl', 'Kind'), kindSel, text('label', 'lbl', 'Name'), nm,
    text('label', 'lbl', 'Alt names (comma separated)'), al, lblBuilt, lblInt, add);
  return sheet.promise;
}
