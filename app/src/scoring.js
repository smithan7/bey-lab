export const OUTCOMES = [-3, -2, -1, 0, 1, 2, 3];
export const FINISH_POINTS = { spin: 1, burst: 2, pocket: 2, xtreme: 3 };

// Signed points from comboId's side; 0 for a draw.
export function battleScore(battle, comboId) {
  if (battle.winner === 'draw') return 0;
  const winnerId = battle.winner === 'left' ? battle.left : battle.right;
  return winnerId === comboId ? battle.points : -battle.points;
}

export function outcomeCounts(scores) {
  const c = new Array(OUTCOMES.length).fill(0);
  for (const s of scores) {
    const i = OUTCOMES.indexOf(s);
    if (i >= 0) c[i]++;
  }
  return c;
}
