import { ImportError } from '../store.js';
import { buildSeed } from '../seed.js';

const today = () => new Date().toISOString().slice(0, 10);

// Saves a JSON backup. On iPad the share sheet (Save to Files) is the reliable route, so it is
// used whenever it accepts files; otherwise fall back to an anchor download.
// Returns 'shared', 'cancelled' (the user closed the share sheet) or 'downloaded'.
export async function saveJson(json, name, {
  nav = globalThis.navigator, doc = globalThis.document, urlApi = globalThis.URL, later = globalThis.setTimeout,
} = {}) {
  const file = new File([json], name, { type: 'application/json' });
  if (nav?.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      throw e;
    }
  }
  const url = urlApi.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  doc.body.append(a);
  a.click();
  a.remove();
  later(() => urlApi.revokeObjectURL(url), 10000);
  return 'downloaded';
}

const failed = (ctx, title, e) => ctx.showDialog({ title, body: `${e?.message ?? e}`, actions: [{ label: 'OK', kind: 'primary' }] });

function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.hidden = true;
    document.body.append(input);
    const done = (v) => { input.remove(); resolve(v); };
    input.addEventListener('change', () => done(input.files[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

export async function openSettings(ctx) {
  for (;;) {
    const choice = await ctx.showDialog({
      title: 'Settings',
      body: 'Every change is saved on this iPad as you go. Export a backup now and then.',
      actions: [
        { label: 'Export data' },
        { label: 'Export with photos' },
        { label: 'Import data…' },
        { label: 'Reset to preloaded data', kind: 'danger' },
        { label: 'Close', kind: 'primary' },
      ],
    });
    if (choice === 'Export data' || choice === 'Export with photos') {
      try {
        const data = await ctx.store.exportData({ withPhotos: choice === 'Export with photos' });
        await saveJson(JSON.stringify(data), `bey-lab-${today()}.json`);
      } catch (e) {
        await failed(ctx, 'Export failed', e);
      }
    } else if (choice === 'Import data…') {
      if (await importFlow(ctx)) return;
    } else if (choice === 'Reset to preloaded data') {
      if (await resetFlow(ctx)) return;
    } else {
      return;
    }
  }
}

async function importFlow(ctx) {
  const file = await pickFile();
  if (!file) return false;
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    await ctx.showDialog({ title: 'Import failed', body: "That file isn't valid JSON. Nothing was changed.", actions: [{ label: 'OK', kind: 'primary' }] });
    return false;
  }
  const n = (k) => (Array.isArray(obj?.[k]) ? obj[k].length : 0);
  const ok = await ctx.showDialog({
    title: 'Import data',
    body: `Replace current data with ${n('battles')} battles, ${n('combos')} combos?`,
    actions: [{ label: 'Cancel' }, { label: 'Replace', kind: 'danger' }],
  });
  if (ok !== 'Replace') return false;
  try {
    await ctx.store.importData(obj);
  } catch (e) {
    const msg = e instanceof ImportError ? e.message : `Import failed: ${e.message}`;
    await ctx.showDialog({ title: 'Import failed', body: `${msg} Nothing was changed.`, actions: [{ label: 'OK', kind: 'primary' }] });
    return false;
  }
  await ctx.refresh();
  return true;
}

async function resetFlow(ctx) {
  const first = await ctx.showDialog({
    title: 'Reset to preloaded data?',
    body: 'This deletes all your battles, combos, field changes, renamed and added parts, and all your photos, and puts the preloaded set back.',
    actions: [{ label: 'Cancel' }, { label: 'Continue', kind: 'danger' }],
  });
  if (first !== 'Continue') return false;
  const second = await ctx.showDialog({
    title: 'Really reset?',
    body: 'Anything you logged since will be gone. Export first if unsure. This cannot be undone.',
    actions: [{ label: 'Cancel' }, { label: 'Yes, erase and reset', kind: 'danger' }],
  });
  if (second !== 'Yes, erase and reset') return false;
  // Use importData with an explicit empty photos list so nothing is preserved.
  try {
    await ctx.store.importData({ app: 'bey-lab', version: 1, ...buildSeed(ctx.catalogParts), photos: [] });
  } catch (e) {
    await failed(ctx, 'Reset failed', `${e?.message ?? e} Nothing was changed.`);
    return false;
  }
  await ctx.refresh();
  return true;
}
