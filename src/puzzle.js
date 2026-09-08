// The maths arcade, scored by the server.
//
// These puzzles pay MMR, which means the browser cannot be trusted with them:
// a client that marks its own work can award itself the maximum on a loop.
// So the Worker issues the puzzle, keeps the answer, and times the solve from
// its own clock. The client never sees the answer and never reports a time.

export const MAX_AWARD = 50;
export const LIMIT_MS = 30_000;   // after this a solve is worth nothing
export const FAST_MS = 10_000;    // under this earns the bonus
export const FAST_MULTIPLIER = 1.5;

/** A first-grade sum. Subtraction never goes below zero. */
export function makePuzzle() {
  const add = Math.random() < 0.6;
  if (add) {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    return { text: `${a} + ${b}`, answer: a + b };
  }
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 1 + Math.floor(Math.random() * a);
  return { text: `${a} \u2212 ${b}`, answer: a - b };
}

/**
 * What a correct solve is worth.
 *
 * The award decays evenly across thirty seconds, from the full fifty down to
 * nothing. Solving inside ten seconds multiplies it by one and a half, which
 * in practice means any quick solve reaches the cap — the bonus exists to
 * make speed worth having, not to break the ceiling.
 *
 * @param {number} elapsedMs  measured by the server, not reported by anyone
 */
export function scoreSolve(elapsedMs) {
  const t = Math.max(0, Number(elapsedMs) || 0);
  const remaining = Math.max(0, (LIMIT_MS - t) / LIMIT_MS);
  const base = MAX_AWARD * remaining;
  const fast = t < FAST_MS;
  const award = Math.min(MAX_AWARD, Math.round(base * (fast ? FAST_MULTIPLIER : 1)));
  return { award: Math.max(0, award), fast, base: Math.round(base), expired: t >= LIMIT_MS };
}

/** Cash and tokens are the casino's own economy and pay no MMR. */
export const cashReward = () => 5 + Math.floor(Math.random() * 11);
