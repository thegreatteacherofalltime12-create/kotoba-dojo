// The maths arcade, scored by the server.
//
// These puzzles pay MMR, which means the browser cannot be trusted with them:
// a client that marks its own work can award itself the maximum on a loop.
// So the Worker issues the puzzle, keeps the answer, and times the solve from
// its own clock. The client never sees the answer and never reports a time.

export const MAX_AWARD = 50;
export const LIMIT_MS = 30_000;   // after this a solve is worth nothing
export const FAST_MS = 7_000;     // under this earns the bonus
export const FAST_MULTIPLIER = 1.5;

/**
 * A first- or second-grade sum, half and half. First grade stays within
 * ten; second grade adds and takes away within a hundred and multiplies
 * the small tables. Subtraction never goes below zero.
 */
export function makePuzzle() {
  const r = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  if (Math.random() < 0.5) {
    if (Math.random() < 0.6) {
      const a = r(1, 9), b = r(1, 9);
      return { text: `${a} + ${b}`, answer: a + b, grade: 1 };
    }
    const a = r(2, 9), b = r(1, a);
    return { text: `${a} \u2212 ${b}`, answer: a - b, grade: 1 };
  }
  const kind = Math.random();
  if (kind < 0.4) {
    const a = r(10, 89), b = r(2, 99 - a);
    return { text: `${a} + ${b}`, answer: a + b, grade: 2 };
  }
  if (kind < 0.75) {
    const a = r(11, 99), b = r(2, a - 1);
    return { text: `${a} \u2212 ${b}`, answer: a - b, grade: 2 };
  }
  const a = r(2, 5), b = r(2, 9);
  return { text: `${a} \u00d7 ${b}`, answer: a * b, grade: 2 };
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
