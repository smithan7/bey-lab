import { IdbBackend, MemoryBackend, createStore } from '../store.js';
import { normalizeCatalog, mergeParts } from '../catalog.js';
import { buildSeed } from '../seed.js';
import { openSettings } from './settings.js';
import { tab as log } from './log.js';
import { tab as combos } from './combos.js';
import { tab as lineup } from './lineup.js';
import { tab as next } from './next.js';
import { tab as library } from './library.js';

const TABS = [log, combos, lineup, next, library];
const $ = (id) => document.getElementById(id);

function showDialog({ title, body, actions }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const box = document.createElement('div');
    box.className = 'dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const h = document.createElement('h2');
    h.textContent = title ?? '';
    const b = document.createElement('div');
    b.className = 'body';
    if (body instanceof Node) b.append(body);
    else b.textContent = body ?? '';
    const bar = document.createElement('div');
    bar.className = 'actions';
    for (const a of actions ?? [{ label: 'OK', kind: 'primary' }]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = a.label;
      if (a.kind) btn.classList.add(a.kind);
      btn.addEventListener('click', async () => {
        overlay.remove();
        try { await a.onClick?.(); } finally { resolve(a.label); }
      });
      bar.append(btn);
    }
    box.append(h, b, bar);
    overlay.append(box);
    $('dialog-host').append(overlay);
    bar.querySelector('button.primary, button:last-child')?.focus();
  });
}

async function boot() {
  const res = await fetch('data/parts-catalog.json');
  if (!res.ok) throw new Error(`Could not load the parts catalog (HTTP ${res.status}).`);
  const catalogParts = normalizeCatalog(await res.json());

  let store;
  try {
    store = await createStore(new IdbBackend());
  } catch (e) {
    console.warn('Storage unavailable, using memory:', e);
    $('banner').hidden = false;
    store = await createStore(new MemoryBackend());
  }
  if (!store.state().meta.seeded) await store.applySeed(buildSeed(catalogParts));
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }

  const ctx = { store, catalogParts, parts: [], partsById: new Map(), combosById: new Map(), showDialog };
  let current = TABS[0].id;
  let params;

  function render() {
    for (const btn of $('tabs').children) btn.setAttribute('aria-selected', String(btn.dataset.tab === current));
    const el = $('view');
    el.replaceChildren();
    TABS.find((t) => t.id === current).render(ctx, el, params);
  }
  function recompute() {
    const s = store.state();
    ctx.parts = mergeParts(catalogParts, s.userParts, s.overrides);
    ctx.partsById = new Map(ctx.parts.map((p) => [p.id, p]));
    ctx.combosById = new Map(s.combos.map((c) => [c.id, c]));
  }
  ctx.refresh = async () => { recompute(); render(); };
  ctx.goTo = (id, p) => { current = id; params = p; render(); };

  for (const t of TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.tab = t.id;
    btn.setAttribute('role', 'tab');
    btn.textContent = t.label;
    btn.addEventListener('click', () => ctx.goTo(t.id));
    $('tabs').append(btn);
  }
  $('settings-btn').addEventListener('click', () => openSettings(ctx));

  recompute();
  render();
  if (new URLSearchParams(location.search).has('debug')) window.beyLab = ctx;

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('SW registration failed:', e); }
  }
}

boot().catch((e) => {
  console.error(e);
  const el = $('view');
  el.textContent = `Bey Lab failed to start: ${e.message}`;
  el.classList.add('error');
});
