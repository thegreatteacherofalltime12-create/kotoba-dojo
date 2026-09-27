// Every rule that decides what a session is worth. Kept in one module with no
// I/O so it can be tested directly and so the Durable Object and the Worker
// can never drift apart on the arithmetic.

export const BLACK_BELT = 2600;

export const BELTS = [
  { at: BLACK_BELT, name: "Black",  hex: "#111111" },
  { at: 1525,       name: "Brown",  hex: "#a52a2a" },
  { at: 1200,       name: "Purple", hex: "#b10dc9" },
  { at: 875,        name: "Blue",   hex: "#0074d9" },
  { at: 600,        name: "Green",  hex: "#2ecc40" },
  { at: 400,        name: "Orange", hex: "#ff851b" },
  { at: 200,        name: "Yellow", hex: "#ffdc00" },
  { at: 1,          name: "White",  hex: "#ffffff" },
  { at: 0,          name: "Unranked", hex: "#4c5468" },
];

/** Shared across every mode — a belt means the same thing wherever it's worn. */
export function beltFor(mmr) {
  return BELTS.find((b) => (mmr ?? 0) >= b.at) || BELTS[BELTS.length - 1];
}

export const COMPLETION_BONUS = 15;
export const MAX_CHALLENGE_BONUS = 15;
export const MAX_SEED_BONUS = 10;

// A player 800 MMR below the field earns the full bonus; the scale is linear
// between. Being the stronger player earns nothing extra, which is the point.
const CHALLENGE_SPAN = 800;

/**
 * 0–15, by how far above you the field sits.
 * @param {number} playerMmr
 * @param {number} fieldMmr  average MMR of everyone else in the round
 */
export function challengeBonus(playerMmr = 0, fieldMmr = 0) {
  const gap = (fieldMmr || 0) - (playerMmr || 0);
  if (gap <= 0) return 0;
  return Math.min(MAX_CHALLENGE_BONUS, Math.round((gap / CHALLENGE_SPAN) * MAX_CHALLENGE_BONUS));
}

/**
 * 0–10, by how many places you finished above where you were seeded.
 * Seeded first has nothing to beat, so it always returns 0.
 */
export function seedBonus(seed, placement) {
  if (!Number.isFinite(seed) || !Number.isFinite(placement)) return 0;
  if (seed <= 1 || placement >= seed) return 0;
  const climbed = seed - placement;
  return Math.min(MAX_SEED_BONUS, Math.round((climbed / (seed - 1)) * MAX_SEED_BONUS));
}

/**
 * What one session is worth. Never negative: the floor is a hard 0, so a bad
 * round costs a player nothing but time.
 *
 * @param {object} p
 * @param {number}  p.score      the match score, which is the base gain
 * @param {boolean} p.completed  finished the full session
 * @param {number}  p.playerMmr  MMR entering the round
 * @param {number}  p.fieldMmr   average MMR of the opposition
 * @param {"match"|"rumble"} p.mode
 * @param {number}  [p.seed]      seeding position, rumble only
 * @param {number}  [p.placement] finishing position, rumble only
 */
export function sessionGain({
  score = 0,
  completed = false,
  playerMmr = 0,
  fieldMmr = 0,
  mode = "match",
  seed = null,
  placement = null,
} = {}) {
  const base = Math.max(0, Math.round(Number(score) || 0));

  // Rumble pays for placing rather than for the matchup, so the challenge
  // bonus doesn't apply there — the seed bonus is its equivalent.
  const challenge = mode === "rumble" ? 0 : challengeBonus(playerMmr, fieldMmr);
  const seedPart = mode === "rumble" ? seedBonus(seed, placement) : 0;
  const completion = completed ? COMPLETION_BONUS : 0;

  const total = Math.max(0, base + challenge + completion + seedPart);
  return { total, base, challenge, completion, seed: seedPart, mode };
}

/** Average MMR of everyone in the round except this player. */
export function fieldMmrFor(uid, ratings) {
  const others = Object.entries(ratings).filter(([id]) => id !== uid).map(([, v]) => v || 0);
  if (!others.length) return 0;
  return Math.round(others.reduce((a, b) => a + b, 0) / others.length);
}

/**
 * Prestige is bought, not reached: it costs a flat 3,000 MMR every time, and
 * takes only that 3,000 rather than everything you hold. The price never rises
 * with how many you already have, so the tenth costs exactly what the first
 * did.
 */
export const PRESTIGE_COST = 3000;

// A boost token, bought with casino money, makes the next ranked round of
// its game pay half again. Consumed by the round that uses it.
export const BOOST_MULT = 1.5;
export const boosted = (total) => Math.round((total || 0) * BOOST_MULT);

/**
 * The multipliers above the boost, and what they cost.
 *
 * The 1.5x boosts are one per game: a Word-Cross boost does nothing in a
 * race. These are not — one multiplier works in whatever you are playing,
 * because five tiers across eight games would be forty things to sell and
 * nobody would find the one they wanted.
 *
 * The prices climb faster than the multiplier does, and deliberately: a 6x
 * costs four times a 2x for three times the pay, so the cheap one is the
 * sensible buy and the dear one is a decision. They are spent by the round
 * that uses them, exactly as a boost is, and only ever one to a round —
 * applying a multiplier is applying it instead of the boost, not as well.
 */
export const MULTIPLIERS = [
  { key: "mx2", mult: 2, price: 5_000, name: "2\u00d7 MMR" },
  { key: "mx3", mult: 3, price: 8_000, name: "3\u00d7 MMR" },
  { key: "mx4", mult: 4, price: 12_000, name: "4\u00d7 MMR" },
  { key: "mx5", mult: 5, price: 15_000, name: "5\u00d7 MMR" },
  { key: "mx6", mult: 6, price: 20_000, name: "6\u00d7 MMR" },
];

export const isMultiplier = (key) => MULTIPLIERS.some((m) => m.key === key);

/** What a given token multiplies by: a tier, or the plain boost. */
export function multFor(key) {
  return MULTIPLIERS.find((m) => m.key === key)?.mult ?? BOOST_MULT;
}

/**
 * A round's MMR, once whatever was applied to it is taken in.
 *
 * `key` is what the player applied — a game's own boost token, whose key is
 * the game, or one of the multipliers. Anything unrecognised is the boost, so
 * a round can never pay less for having had a token on it.
 */
export const boostedBy = (total, key) => Math.round((total || 0) * multFor(key));

export function canPrestige(mmr) {
  return (mmr ?? 0) >= PRESTIGE_COST;
}

/**
 * The Space Force officer ladder, climbed one rank per prestige.
 *
 * The pips follow the real insignia rather than being decoration: a gold then
 * a silver bar for the lieutenants, doubled for a captain, oak leaves for the
 * majors, the eagle for a colonel, and one star per general grade.
 */
export const PRESTIGE_RANKS = [
  { name: "Second Lieutenant", pip: "\u{1F7E1}" },
  { name: "First Lieutenant", pip: "\u26AA" },
  { name: "Captain", pip: "\u26AA\u26AA" },
  { name: "Major", pip: "\u{1F341}" },
  { name: "Lieutenant Colonel", pip: "\u{1F33F}" },
  { name: "Colonel", pip: "\u{1F985}" },
  { name: "Brigadier General", pip: "\u2B50" },
  { name: "Major General", pip: "\u2B50\u2B50" },
  { name: "Lieutenant General", pip: "\u2B50\u2B50\u2B50" },
  { name: "General", pip: "\u2B50\u2B50\u2B50\u2B50" },
];

/**
 * The insignia for a given number of prestiges. The top of the ladder is the
 * top: past ten, further prestiges still cost and still count, but the rank
 * stays General because there is nothing above it.
 *
 * @param {number} count how many prestiges the player has taken, 1-based
 */
// The branches beyond the Space Force live in public/ranks.js; this list is
// the Space Force officer ladder as it always was, kept for the tests and
// the diagnostic.
export function prestigeRank(count) {
  const n = Math.max(1, Math.round(count || 1));
  return PRESTIGE_RANKS[Math.min(n, PRESTIGE_RANKS.length) - 1];
}

/** Pip and name together, which is what gets stored and shown. */
export function prestigeInsignia(count) {
  const r = prestigeRank(count);
  return `${r.pip} ${r.name}`;
}
