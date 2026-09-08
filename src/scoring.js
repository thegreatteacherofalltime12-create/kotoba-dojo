// Round length and the scoring curve.
//
// A ten-word grid is not solvable in single-digit seconds, so a raw
// 100 - 99*(elapsed/300) curve wastes its whole top end. PERFECT_MS is the
// floor below which a solve is treated as flawless; tune it once you have
// real solve times from real players.

export const ROUND_MS = 900_000; // fifteen minutes
export const PERFECT_MS = 45_000; // anything at or under this scores 100

export function scoreFor(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs >= ROUND_MS) return 0;
  if (elapsedMs <= PERFECT_MS) return 100;
  const t = (elapsedMs - PERFECT_MS) / (ROUND_MS - PERFECT_MS);
  return Math.max(1, Math.round(100 - 99 * t));
}

export const BELTS = [
  { min: 95, name: "Black", hex: "#171b26" },
  { min: 85, name: "Brown", hex: "#6b4527" },
  { min: 72, name: "Purple", hex: "#5a4270" },
  { min: 58, name: "Blue", hex: "#2f5d80" },
  { min: 44, name: "Green", hex: "#4a7346" },
  { min: 28, name: "Orange", hex: "#b3651f" },
  { min: 12, name: "Yellow", hex: "#b99126" },
  { min: 1, name: "White", hex: "#ddd5c6" },
  { min: 0, name: "Unranked", hex: "#4c5468" },
];

export function beltFor(score) {
  return BELTS.find((b) => score >= b.min) || BELTS[BELTS.length - 1];
}
