// Module worker: runs lineup ranking off the main thread. State may arrive without photos.
import { rankLineups } from './lineup.js';
import { makeRng } from './rng.js';

self.onmessage = (e) => {
  const msg = e.data ?? {};
  if (msg.type !== 'rank') return;
  try {
    const result = rankLineups(msg.state, msg.parts, { rng: makeRng(msg.seed ?? Date.now()) });
    self.postMessage({ type: 'ranked', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message ?? err) });
  }
};
