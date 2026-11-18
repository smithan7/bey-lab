// EV ratings: one number per combo such that E[score of A vs B] ≈ r[A] − r[B].
// Fitted from all battles at once by ridge least squares, so battle order doesn't matter and
// a combo needs data to move away from 0. Pure; runs in Node and the browser.
import { battleScore } from './scoring.js';

// Ridge strength: acts like LAMBDA even battles per combo.
export const LAMBDA = 3;
// Floor on the residual variance, so a tiny sample can't look certain.
export const SIGMA2_FLOOR = 1.0;

// In-place Cholesky of a symmetric positive-definite matrix (array of Float64Array rows); lower L.
function cholesky(A) {
  const m = A.length;
  for (let j = 0; j < m; j++) {
    let d = A[j][j];
    for (let k = 0; k < j; k++) d -= A[j][k] * A[j][k];
    const ljj = Math.sqrt(d);
    A[j][j] = ljj;
    for (let i = j + 1; i < m; i++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= A[i][k] * A[j][k];
      A[i][j] = s / ljj;
    }
  }
  return A;
}

function solveChol(L, b) {
  const m = L.length;
  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Float64Array(m);
  for (let i = m - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < m; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/**
 * battles → Map<comboId, { r, se, lo, hi, n, opponents }>. r is centred (mean 0 over rated
 * combos); lo/hi = r ∓ 1.96·se. Mirror battles are ignored. Combos with no battles are absent.
 */
export function fitRatings(battles, { lambda = LAMBDA } = {}) {
  const rows = (battles ?? []).filter((b) => b.left !== b.right);
  const ids = [];
  const idx = new Map();
  const opp = new Map();
  for (const b of rows) {
    for (const id of [b.left, b.right]) if (!idx.has(id)) { idx.set(id, ids.length); ids.push(id); opp.set(id, new Set()); }
    opp.get(b.left).add(b.right);
    opp.get(b.right).add(b.left);
  }
  const m = ids.length;
  const out = new Map();
  if (!m) return out;

  const A = Array.from({ length: m }, () => new Float64Array(m));
  const rhs = new Float64Array(m);
  const n = new Array(m).fill(0);
  for (let i = 0; i < m; i++) A[i][i] = lambda;
  for (const b of rows) {
    const i = idx.get(b.left), j = idx.get(b.right);
    const s = battleScore(b, b.left);
    A[i][i] += 1; A[j][j] += 1; A[i][j] -= 1; A[j][i] -= 1;
    rhs[i] += s; rhs[j] -= s;
    n[i]++; n[j]++;
  }
  const L = cholesky(A);
  const r = solveChol(L, rhs);

  let rss = 0;
  for (const b of rows) {
    const e = battleScore(b, b.left) - (r[idx.get(b.left)] - r[idx.get(b.right)]);
    rss += e * e;
  }
  const sigma2 = Math.max(SIGMA2_FLOOR, rss / Math.max(1, rows.length - m));
  const mean = r.reduce((a, x) => a + x, 0) / m;

  const unit = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    unit.fill(0); unit[i] = 1;
    const col = solveChol(L, unit);
    const se = Math.sqrt(sigma2 * col[i]);
    const ri = r[i] - mean;
    out.set(ids[i], { r: ri, se, lo: ri - 1.96 * se, hi: ri + 1.96 * se, n: n[i], opponents: opp.get(ids[i]).size });
  }
  return out;
}

// Rated combos as rows, highest rating first.
export function ratingsLeaderboard(state, ratings = fitRatings(state.battles)) {
  return [...ratings.entries()].map(([comboId, v]) => ({ comboId, ...v })).sort((a, b) => b.r - a.r);
}
