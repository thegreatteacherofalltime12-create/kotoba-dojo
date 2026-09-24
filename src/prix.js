/**
 * Multiverse Grand Prix — the track, and the words engine that drives it.
 *
 * The answers never leave this module, the way golf's don't: the browser is
 * told the scrambled letters and a clue, and the room checks the guess.
 *
 * Everything here is pure, so the race can be tested without a Durable
 * Object. The room in grand-prix.js does the sockets and the bookkeeping.
 */
import { DICT, isWord } from "./links.js";

// ── the track ────────────────────────────────────────────────────────

export const LAP_M = 1000;

/**
 * A circuit says how hard it runs whichever engine was chosen, how many
 * item boxes a lap carries, and how long a lap is. Item boxes are counted
 * here but nothing fires yet — that is the next slice.
 */
export const CIRCUITS = [
  { id: "reef", name: "Neon Reef", sub: "Wide, bright, forgiving", ico: "\u{1F41A}", hard: "easiest", boxes: 3, lapM: 1000 },
  { id: "cinder", name: "Cinder Rally", sub: "The one to learn on", ico: "\u{1F5FB}", hard: "middle", boxes: 4, lapM: 1000 },
  { id: "canyon", name: "The Glass Canyon", sub: "One long straight", ico: "\u{1F3DC}️", hard: "middle", boxes: 2, lapM: 1000 },
  { id: "orbital", name: "Orbital Ring", sub: "Short laps, constant contact", ico: "\u{1FA90}", hard: "middle", boxes: 4, lapM: 600 },
  { id: "bramble", name: "Bramble Hollow", sub: "Items everywhere", ico: "\u{1F33F}", hard: "middle", boxes: 8, lapM: 1000 },
  { id: "midnight", name: "Midnight Circuit", sub: "The hard one", ico: "\u{1F311}", hard: "hardest", boxes: 3, lapM: 1000 },
];
export const circuitById = (id) => CIRCUITS.find((c) => c.id === id) || CIRCUITS[1];

/** Orbital Ring runs short laps, so it adds two to whatever was picked. */
export const LENGTHS = [
  { id: "sprint", name: "Sprint", laps: 2, sub: "3 to 4 minutes" },
  { id: "gp", name: "Grand Prix", laps: 3, sub: "5 to 7 minutes" },
  { id: "endurance", name: "Endurance", laps: 5, sub: "9 to 12 minutes" },
];
export const lengthById = (id) => LENGTHS.find((l) => l.id === id) || LENGTHS[1];
export const lapsFor = (circuit, length) =>
  lengthById(length).laps + (circuitById(circuit).id === "orbital" ? 2 : 0);
export const metresFor = (circuit, length) => lapsFor(circuit, length) * circuitById(circuit).lapM;

/** A race cannot run for ever: four minutes a lap is far more than anyone needs. */
export const capFor = (circuit, length) => lapsFor(circuit, length) * 240_000;

// ── the words engine ─────────────────────────────────────────────────

/**
 * A class is how hard the engine runs. The circuit suggests one; a racer may
 * set their own, because a family racing together is the point. The allowance
 * is what the distance rule measures against, so a Junior being quick and a
 * Pro being quick move the same distance — see distanceFor.
 */
export const CLASSES = [
  { id: "junior", name: "Junior", lens: [4, 5], firstLetter: true, hideClueMs: 0, mult: 1, sub: "4 to 5 letters, first letter given" },
  { id: "standard", name: "Standard", lens: [5, 6], firstLetter: false, hideClueMs: 0, mult: 1.15, sub: "5 to 6 letters" },
  { id: "pro", name: "Pro", lens: [6], firstLetter: false, hideClueMs: 8_000, mult: 1.3, sub: "6 letters, no clue for 8 seconds" },
];
export const classById = (id) => CLASSES.find((c) => c.id === id) || CLASSES[1];
export const CLASS_FOR_CIRCUIT = { easiest: "junior", middle: "standard", hardest: "pro" };

/** How long an item ought to take, which is what the distance is scored against. */
export function allowanceMs(word, cls) {
  const base = { 4: 12_000, 5: 15_000, 6: 18_000 }[word.length] || 15_000;
  // A clue you cannot read yet is time you cannot use.
  return cls.hideClueMs ? Math.min(20_000, base + 2_000) : base;
}

/** Every word of the lengths a class uses, with its clue. Both dictionaries. */
export function deckFor(cls) {
  const out = [];
  for (const set of ["classic", "modern"]) {
    for (const n of cls.lens) {
      for (const [word, clue] of DICT[set][n] || []) out.push({ word, clue });
    }
  }
  return out;
}

/** Fisher-Yates, against a supplied random so a test can pin it. */
export function shuffled(list, rnd = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The letters, in an order that is not the answer. */
export function scramble(word, rnd = Math.random) {
  if (word.length < 2) return word;
  for (let tries = 0; tries < 12; tries++) {
    const s = shuffled([...word], rnd).join("");
    if (s !== word) return s;
  }
  return [...word].reverse().join("");
}

/**
 * A real word made of the same letters, but not the one dealt.
 *
 * GIRD and GRID are both words and both fit the tiles. Spinning a racer for
 * typing the other one would be unfair anywhere, and on the class that hides
 * the clue for eight seconds it would be unavoidable. So it costs nothing,
 * changes nothing, and says what happened.
 */
export function nearMiss(said, answer) {
  if (!said || said === answer || said.length !== answer.length) return false;
  if ([...said].sort().join("") !== [...answer].sort().join("")) return false;
  return isWord(said);
}

// ── the distance rule ────────────────────────────────────────────────

export const FULL_BOOST = 100;   // metres for an answer inside a third of its allowance
export const FLOOR_BOOST = 40;   // metres for one that took longer than the allowance
export const SPIN_COST = 15;     // metres lost to a wrong answer

/**
 * What an answer is worth. Measured against the item's own allowance, which
 * is the whole reason four engines and every school grade can share a track:
 * being quick at your own level is what moves the kart.
 */
export function distanceFor(elapsedMs, allowance) {
  const ratio = allowance > 0 ? elapsedMs / allowance : 1;
  if (ratio <= 1 / 3) return FULL_BOOST;
  if (ratio >= 1) return FLOOR_BOOST;
  // Even fall from full to floor across the rest of the allowance.
  const through = (ratio - 1 / 3) / (2 / 3);
  return Math.round(FULL_BOOST - (FULL_BOOST - FLOOR_BOOST) * through);
}

// ── scoring ──────────────────────────────────────────────────────────

/**
 * Where you finished is most of it, how quick you were is the rest, and
 * spins cost a little. Capped at 100 like every other game in the arena.
 *
 * A solo run has nobody to beat, so it takes a fixed 70 for the placement
 * part and lives or dies on pace.
 */
export function raceScore({ placement, field, avgRatio, spins, finished }) {
  // Placement stops at 80 rather than 100 on purpose: if winning alone
  // filled the score, pace and spins would vanish under the cap and a
  // sloppy winner would score the same as a clean one.
  const place = field > 1
    ? 80 - 50 * ((placement - 1) / (field - 1))
    : 70;
  const pace = 20 * (1 - Math.min(1, Math.max(0, avgRatio)));
  const spun = Math.min(15, (spins || 0) * 2);
  // A kart still on the track when the flag falls keeps what it earned, but
  // the placement half is scaled by how much of the race it actually did.
  const got = (place * (finished ? 1 : 0.6)) + pace - spun;
  return Math.max(0, Math.min(100, Math.round(got)));
}

/** The order of a grid: distance first, then who got there first. */
export function standings(players) {
  return [...players].sort((a, b) =>
    (b.at || 0) - (a.at || 0) ||
    (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) ||
    String(a.name).localeCompare(String(b.name)));
}
