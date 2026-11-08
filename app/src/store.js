// Persistent store: state, backends (memory / IndexedDB), export/import. Runs in Node and the browser.
// IndexedDB is only touched when IdbBackend.open() is called.
import { comboId, validateCombo } from './combo.js';

export const STORES = ['userParts', 'overrides', 'combos', 'battles', 'field', 'photos', 'meta'];
const KEY_PATH = { field: 'comboId', overrides: 'partId' };
const keyPathOf = (name) => KEY_PATH[name] ?? 'id';
const META_KEY = 'meta';

export class StorageUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageUnavailableError';
    if (cause) this.cause = cause;
  }
}

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

const clone = (v) => structuredClone(v);

export class MemoryBackend {
  constructor() {
    this.stores = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  }
  async open() {}
  async getAll(name) {
    return [...this.stores[name].values()].map(clone);
  }
  async put(name, rec) {
    this.stores[name].set(rec[keyPathOf(name)], clone(rec));
  }
  async del(name, key) {
    this.stores[name].delete(key);
  }
  async replaceAll(snapshot) {
    const next = Object.fromEntries(STORES.map((s) => [s, new Map()]));
    for (const name of STORES) {
      for (const rec of snapshot[name] ?? []) next[name].set(rec[keyPathOf(name)], clone(rec));
    }
    this.stores = next;
  }
}

export class IdbBackend {
  constructor(name = 'bey-lab', version = 1) {
    this.name = name;
    this.version = version;
    this.db = null;
  }
  open() {
    return new Promise((resolve, reject) => {
      const req = globalThis.indexedDB.open(this.name, this.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: keyPathOf(s) });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }
  #tx(names, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(names, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
      try {
        result = fn(tx);
      } catch (e) {
        try { tx.abort(); } catch { /* already finished */ }
        reject(e);
      }
    });
  }
  async getAll(name) {
    const req = await this.#tx([name], 'readonly', (tx) => tx.objectStore(name).getAll());
    return req.result;
  }
  async put(name, rec) {
    await this.#tx([name], 'readwrite', (tx) => void tx.objectStore(name).put(rec));
  }
  async del(name, key) {
    await this.#tx([name], 'readwrite', (tx) => void tx.objectStore(name).delete(key));
  }
  async replaceAll(snapshot) {
    await this.#tx(STORES, 'readwrite', (tx) => {
      for (const name of STORES) {
        const os = tx.objectStore(name);
        os.clear();
        for (const rec of snapshot[name] ?? []) os.put(rec);
      }
    });
  }
}

// ---- helpers -------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function overridesFromRecords(recs) {
  const out = {};
  for (const { partId, ...patch } of recs) out[partId] = patch;
  return out;
}
const overrideRecords = (overrides) => Object.entries(overrides).map(([partId, patch]) => ({ ...patch, partId }));

function stateFromRecords(r) {
  const meta = r.meta.find((m) => m.id === META_KEY);
  const { id: _id, ...metaRest } = meta ?? {};
  return {
    userParts: r.userParts,
    overrides: overridesFromRecords(r.overrides),
    combos: r.combos,
    battles: r.battles,
    field: r.field,
    photos: r.photos,
    meta: { seeded: false, ...metaRest },
  };
}

function snapshotOf(state) {
  return {
    userParts: state.userParts,
    overrides: overrideRecords(state.overrides),
    combos: state.combos,
    battles: state.battles,
    field: state.field,
    photos: state.photos,
    meta: [{ id: META_KEY, ...state.meta }],
  };
}

const blobToDataUrl = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
};

function dataUrlToBlob(url) {
  const m = /^data:([^;,]*)(?:;[^;,]*)*;base64,([A-Za-z0-9+/=]*)$/.exec(url ?? '');
  if (!m) throw new ImportError('A photo in this file is not a valid data URL.');
  let bin;
  try {
    bin = atob(m[2]);
  } catch {
    throw new ImportError('A photo in this file could not be decoded.');
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

function validateImport(obj) {
  if (!isObj(obj)) throw new ImportError('This is not a Bey Lab file.');
  if (obj.app !== 'bey-lab') throw new ImportError('This is not a Bey Lab file.');
  if (obj.version !== 1) throw new ImportError(`Unsupported Bey Lab file version: ${obj.version}.`);
  for (const k of ['userParts', 'combos', 'battles', 'field']) {
    if (!Array.isArray(obj[k])) throw new ImportError(`The file is missing "${k}" or it is not a list.`);
  }
  if (!isObj(obj.overrides)) throw new ImportError('The file is missing "overrides" or it is not an object.');
  if (obj.photos !== undefined && !Array.isArray(obj.photos)) throw new ImportError('"photos" is not a list.');
  for (const p of obj.userParts) if (!isObj(p) || !p.id) throw new ImportError('A user part is missing its id.');
  for (const c of obj.combos) if (!isObj(c) || !c.id || !c.blade || !c.bit) throw new ImportError('A combo is malformed.');
  for (const b of obj.battles) {
    if (!isObj(b) || !b.id || !b.left || !b.right || !b.winner || typeof b.points !== 'number') {
      throw new ImportError('A battle record is malformed (needs left, right, winner and points).');
    }
    if (!['left', 'right', 'draw'].includes(b.winner)) throw new ImportError(`A battle has an unknown winner "${b.winner}" (must be left, right or draw).`);
    if (!Number.isInteger(b.points) || b.points < 0 || b.points > 3) throw new ImportError('A battle has points outside 0 to 3.');
    if ((b.winner === 'draw') !== (b.points === 0)) throw new ImportError('A battle has the wrong points: draws score 0, wins score 1 to 3.');
  }
  for (const k of Object.keys(obj.overrides)) if (!k) throw new ImportError('An override is missing its part id.');
  for (const f of obj.field) if (!isObj(f) || !f.comboId) throw new ImportError('A field entry is missing its combo id.');
  for (const [k, v] of Object.entries(obj.overrides)) if (!isObj(v)) throw new ImportError(`Override for ${k} is malformed.`);
  for (const p of obj.photos ?? []) {
    if (!isObj(p) || !p.id || !p.partId || typeof p.dataUrl !== 'string') throw new ImportError('A photo record is malformed.');
  }
}

const SELF_BATTLE = "A combo can't battle itself — pick two different combos.";

// ---- store ---------------------------------------------------------------

export async function createStore(backend) {
  try {
    await backend.open();
  } catch (e) {
    throw new StorageUnavailableError("Storage isn't available on this device or browser.", e);
  }
  const recs = {};
  try {
    for (const name of STORES) recs[name] = await backend.getAll(name);
  } catch (e) {
    throw new StorageUnavailableError('Saved data could not be read.', e);
  }
  let current = stateFromRecords(recs);
  const snap = () => clone(current);

  // Persist with `write(next)`, and only adopt `next` once persistence succeeded.
  async function commit(next, write) {
    await write(next);
    current = next;
    return snap();
  }
  const replace = (next) => commit(next, (n) => backend.replaceAll(snapshotOf(n)));

  const store = {
    state: snap,

    async addBattle(b) {
      if (b.left === b.right) throw new Error(SELF_BATTLE);
      const next = { ...current, battles: [...current.battles, clone(b)] };
      return commit(next, () => backend.put('battles', b));
    },

    async undoLastBattle() {
      if (!current.battles.length) return snap();
      let idx = 0;
      current.battles.forEach((b, i) => {
        if ((b.ts ?? 0) >= (current.battles[idx].ts ?? 0)) idx = i;
      });
      const victim = current.battles[idx];
      const next = { ...current, battles: current.battles.filter((_, i) => i !== idx) };
      return commit(next, () => backend.del('battles', victim.id));
    },

    async upsertCombo(c) {
      const combos = current.combos.some((x) => x.id === c.id)
        ? current.combos.map((x) => (x.id === c.id ? clone(c) : x))
        : [...current.combos, clone(c)];
      return commit({ ...current, combos }, () => backend.put('combos', c));
    },

    async setOverride(partId, patch) {
      const merged = { ...current.overrides[partId], ...patch };
      const next = { ...current, overrides: { ...current.overrides, [partId]: clone(merged) } };
      return commit(next, () => backend.put('overrides', { ...merged, partId }));
    },

    async addUserPart(p) {
      const next = { ...current, userParts: [...current.userParts, clone(p)] };
      return commit(next, () => backend.put('userParts', p));
    },

    async updateUserPart(id, patch) {
      const old = current.userParts.find((p) => p.id === id);
      if (!old) throw new Error(`Unknown user part ${id}`);
      const updated = { ...old, ...patch, id };
      const next = { ...current, userParts: current.userParts.map((p) => (p.id === id ? updated : p)) };
      return commit(next, () => backend.put('userParts', updated));
    },

    // Correct a combo's parts. Its battles and field entry move to the new combo id; if that combo
    // already exists, the two are merged (battles combined, field flags OR-ed).
    async replaceCombo(oldId, combo) {
      if (!current.combos.some((c) => c.id === oldId)) throw new Error(`Unknown combo ${oldId}`);
      const newId = combo.id;
      if (newId === oldId) return snap();
      if (current.battles.some((b) => (b.left === oldId && b.right === newId) || (b.left === newId && b.right === oldId))) {
        throw new Error('These two combos battled each other, so one can’t become the other. Make a variant instead.');
      }
      const exists = current.combos.some((c) => c.id === newId);
      const combos = exists
        ? current.combos.filter((c) => c.id !== oldId)
        : current.combos.map((c) => (c.id === oldId ? clone(combo) : c));
      const remap = (id) => (id === oldId ? newId : id);
      const battles = current.battles.map((b) => (b.left === oldId || b.right === oldId
        ? { ...b, left: remap(b.left), right: remap(b.right) } : b));
      const field = new Map();
      for (const f of current.field) {
        const id = remap(f.comboId);
        const prev = field.get(id);
        field.set(id, prev
          ? { ...prev, active: prev.active || f.active, core: prev.core || f.core }
          : { ...f, comboId: id });
      }
      return replace({ ...current, combos, battles, field: [...field.values()] });
    },

    // Only untested combos can be deleted, so battle data is never lost.
    async deleteCombo(id) {
      if (current.battles.some((b) => b.left === id || b.right === id)) {
        throw new Error('This combo has battles, so it can’t be deleted.');
      }
      return replace({
        ...current,
        combos: current.combos.filter((c) => c.id !== id),
        field: current.field.filter((f) => f.comboId !== id),
      });
    },

    // partsById (optional): the parts before the merge; when given, every repointed combo is
    // re-validated. A ratchet next to a now ratchet-integrated bit is dropped; any other
    // invalid combo cancels the merge. Ownership of fromId carries over to intoId.
    async mergePart(fromId, intoId, { knownPartIds, partsById } = {}) {
      if (fromId === intoId) return snap();
      if (knownPartIds && !knownPartIds.has(intoId) && !current.userParts.some((p) => p.id === intoId)) {
        throw new Error('The part to merge into is not a known part.');
      }
      const sw = (v) => (v === fromId ? intoId : v);
      const idMap = new Map();
      const combos = new Map();
      for (const c of current.combos) {
        const n = clone(c);
        if (n.blade.type === 'cx') {
          for (const f of ['lockChip', 'mainBlade', 'overBlade', 'metalBlade', 'assistBlade']) {
            if (n.blade[f] != null) n.blade[f] = sw(n.blade[f]);
          }
        } else {
          n.blade.bladeId = sw(n.blade.bladeId);
        }
        n.ratchet = n.ratchet == null ? n.ratchet : sw(n.ratchet);
        n.bit = sw(n.bit);
        if (partsById) {
          if (n.ratchet != null && partsById.get(n.bit)?.ratchetIntegrated) n.ratchet = null;
          const err = validateCombo(n, partsById);
          if (err) throw new Error(`After the merge a combo would be invalid (${err}) — merge cancelled.`);
        }
        n.id = comboId(n);
        idMap.set(c.id, n.id);
        if (!combos.has(n.id)) combos.set(n.id, n);
      }
      const remap = (id) => idMap.get(id) ?? id;
      const battles = current.battles.map((b) => ({ ...b, left: remap(b.left), right: remap(b.right) }));
      if (battles.some((b) => b.left === b.right)) {
        throw new Error("These two combos battled each other, so they can't be the same part — merge cancelled.");
      }
      const field = new Map();
      for (const f of current.field) {
        const id = remap(f.comboId);
        const prev = field.get(id);
        field.set(id, prev
          ? { ...prev, active: prev.active || f.active, core: prev.core || f.core }
          : { ...f, comboId: id });
      }
      const { [fromId]: dropped, ...overrides } = current.overrides;
      if (dropped?.owned) overrides[intoId] = { ...overrides[intoId], owned: true };
      return replace({
        ...current,
        userParts: current.userParts.filter((p) => p.id !== fromId),
        overrides,
        combos: [...combos.values()],
        battles,
        field: [...field.values()],
        photos: current.photos.map((ph) => (ph.partId === fromId ? { ...ph, partId: intoId } : ph)),
      });
    },

    async addPhoto(partId, blob, w, h) {
      const rec = { id: `photo:${partId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, partId, blob, w, h, ts: Date.now() };
      const next = { ...current, photos: [...current.photos, rec] };
      return commit(next, () => backend.put('photos', rec));
    },

    async removePhoto(id) {
      const next = { ...current, photos: current.photos.filter((p) => p.id !== id) };
      return commit(next, () => backend.del('photos', id));
    },

    async setFieldEntry(entry) {
      const field = current.field.some((f) => f.comboId === entry.comboId)
        ? current.field.map((f) => (f.comboId === entry.comboId ? clone(entry) : f))
        : [...current.field, clone(entry)];
      return commit({ ...current, field }, () => backend.put('field', entry));
    },

    async setMeta(patch) {
      const meta = { ...current.meta, ...patch };
      return commit({ ...current, meta }, () => backend.put('meta', { id: META_KEY, ...meta }));
    },

    // Seed may carry userParts, overrides, combos, battles, field. Everything else is cleared.
    async applySeed(seed) {
      return replace({
        userParts: clone(seed.userParts ?? []),
        overrides: clone(seed.overrides ?? {}),
        combos: clone(seed.combos ?? []),
        battles: clone(seed.battles ?? []),
        field: clone(seed.field ?? []),
        photos: current.photos,
        meta: { ...current.meta, seeded: true },
      });
    },

    // Photo rule: withPhotos:true includes "photos" (each blob as a base64 data URL);
    // withPhotos:false omits the key entirely.
    async exportData({ withPhotos = false } = {}) {
      const out = {
        app: 'bey-lab',
        version: 1,
        exportedAt: new Date().toISOString(),
        userParts: clone(current.userParts),
        overrides: clone(current.overrides),
        combos: clone(current.combos),
        battles: clone(current.battles),
        field: clone(current.field),
      };
      if (withPhotos) {
        out.photos = [];
        for (const { blob, ...rest } of current.photos) out.photos.push({ ...rest, dataUrl: await blobToDataUrl(blob) });
      }
      return out;
    },

    // Photo rule: a file with "photos" replaces local photos with them; a file without
    // the key keeps local photos (dropping any attached to a user part the file lacks). meta (e.g. seeded) is kept.
    async importData(obj) {
      validateImport(obj);
      const knownParts = (id) => obj.userParts.some((p) => p.id === id) || !String(id).startsWith('user:');
      const photos = obj.photos === undefined
        ? current.photos.filter((ph) => knownParts(ph.partId))
        : obj.photos.map(({ dataUrl, ...rest }) => ({ ...rest, blob: dataUrlToBlob(dataUrl) }));
      return replace({
        userParts: clone(obj.userParts),
        overrides: clone(obj.overrides),
        combos: clone(obj.combos),
        battles: clone(obj.battles),
        field: clone(obj.field),
        photos,
        meta: current.meta,
      });
    },
  };
  // Serialize every method so read -> build -> write -> adopt never interleaves.
  let tail = Promise.resolve();
  const queued = { state: store.state };
  for (const [name, fn] of Object.entries(store)) {
    if (name === 'state') continue;
    queued[name] = (...args) => {
      const run = tail.then(() => fn(...args));
      tail = run.catch(() => {});
      return run;
    };
  }
  return queued;
}
