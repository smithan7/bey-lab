import { ImportError } from '../store.js';
import { buildSeed } from '../seed.js';

const today = () => new Date().toISOString().slice(0, 10);

function download(obj) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bey-lab-${today()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => resolve(input.files[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
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
      download(await ctx.store.exportData({ withPhotos: choice === 'Export with photos' }));
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
    body: 'This replaces all your battles, combos, parts and photo choices with the preloaded set.',
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
  await ctx.store.importData({ app: 'bey-lab', version: 1, ...buildSeed(ctx.catalogParts), photos: [] });
  await ctx.refresh();
  return true;
}
