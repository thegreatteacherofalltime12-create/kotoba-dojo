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

export const LAP_M = 800;

/**
 * A circuit says how hard it runs whichever engine was chosen, how many
 * item boxes a lap carries, and how long a lap is. Item boxes are counted
 * here but nothing fires yet — that is the next slice.
 */
export const CIRCUITS = [
  { id: "reef", name: "Neon Reef", sub: "Wide, bright, forgiving", ico: "\u{1F41A}", hard: "easiest", boxes: 3, lapM: 800 },
  { id: "cinder", name: "Cinder Rally", sub: "The one to learn on", ico: "\u{1F5FB}", hard: "middle", boxes: 4, lapM: 800 },
  { id: "canyon", name: "The Glass Canyon", sub: "One long straight", ico: "\u{1F3DC}️", hard: "middle", boxes: 2, lapM: 800 },
  { id: "orbital", name: "Orbital Ring", sub: "Short laps, constant contact", ico: "\u{1FA90}", hard: "middle", boxes: 4, lapM: 500 },
  { id: "bramble", name: "Bramble Hollow", sub: "Items everywhere", ico: "\u{1F33F}", hard: "middle", boxes: 8, lapM: 800 },
  { id: "midnight", name: "Midnight Circuit", sub: "The hard one", ico: "\u{1F311}", hard: "hardest", boxes: 3, lapM: 800 },
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

/**
 * A race cannot run for ever. Five minutes a lap is generous on purpose: the
 * cap is there to stop a room running all night, not to pace anybody, and a
 * Rookie driver or a racer having a hard time of it should still see a flag.
 */
export const capFor = (circuit, length) => lapsFor(circuit, length) * 300_000;

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
export const FLOOR_BOOST = 50;   // metres for one that took longer than the allowance
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

// ── item boxes ───────────────────────────────────────────────────────
//
// Boxes sit at fixed marks on the track. Cross one and you get an item, and
// you hold one at a time: no hoarding, no stacking, and every box is a
// decision rather than a collection.

export const SLIPSTREAM_M = 120;   // straight into your distance
export const COMET_M = 60;         // off whoever is directly ahead
export const SLICK_M = 80;         // off whoever drives over it
export const NITRO_FULL = true;    // a nitro word pays a full boost
export const FOG_MS = 5_000;       // the clue, hidden from everyone ahead
export const SCRAMBLE_FOG_MS = 6_000;
export const FLARE_MS = 8_000;     // how long a flare holds everyone ahead
export const FLARE_CUT = 0.4;      // and how much of each answer it takes
export const FLARE_FROM = 4;       // nobody in the top three gets to fire one

export const ITEMS = [
  { id: "slipstream", name: "Slipstream", ico: "\u{1F4A8}", aim: "self",
    blurb: `Straight to ${SLIPSTREAM_M} metres of distance.` },
  { id: "nitro", name: "Nitro Word", ico: "\u26A1", aim: "self",
    blurb: "Your word solves itself, at a full boost." },
  { id: "deflector", name: "Deflector", ico: "\u{1F6E1}\uFE0F", aim: "self",
    blurb: "Eats the next item aimed at you." },
  { id: "slick", name: "Oil Slick", ico: "\u{1FAB6}", aim: "drop",
    blurb: `Dropped behind you. The next kart across it loses ${SLICK_M} metres.` },
  { id: "comet", name: "Comet", ico: "\u2604\uFE0F", aim: "ahead",
    blurb: `The racer directly ahead loses their word and ${COMET_M} metres.` },
  { id: "scrambler", name: "Scrambler", ico: "\u{1F300}", aim: "ahead",
    blurb: "Reshuffles the letters of the racer ahead and hides their clue." },
  { id: "fog", name: "Fog Bank", ico: "\u{1F32B}\uFE0F", aim: "field",
    blurb: "Hides the clue from everyone ahead of you." },
  { id: "flare", name: "Solar Flare", ico: "\u{1F31E}", aim: "field",
    blurb: "Everyone ahead answers for less for eight seconds. From 4th or worse." },
];
export const itemById = (id) => ITEMS.find((i) => i.id === id) || null;

/** Where the boxes sit: evenly along every lap, never on the start line. */
export function boxMarks(circuit, length) {
  const c = circuitById(circuit);
  const laps = lapsFor(circuit, length);
  const out = [];
  for (let lap = 0; lap < laps; lap++) {
    for (let i = 0; i < c.boxes; i++) {
      out.push(Math.round(lap * c.lapM + (c.lapM * (i + 0.5)) / c.boxes));
    }
  }
  return out;
}

/** Every box crossed by moving from one distance to another. */
export function boxesBetween(from, to, marks) {
  return marks.filter((m) => m > from && m <= to);
}

/**
 * What the box holds, weighted by where you are running.
 *
 * This is the part that makes kart racing work: the leader gets things to
 * defend with, the back of the field gets the artillery. Nothing here is
 * anybody's property — it is the oldest idea in the genre.
 */
export function itemWeights(place, field) {
  // Alone on the track there is nobody to aim at, so every box is your own.
  if (field < 2) return { slipstream: 3, nitro: 2 };

  const back = Math.max(2, Math.ceil(field * (2 / 3)));
  if (place === 1) return { slick: 4, deflector: 4, slipstream: 1, fog: 1 };
  if (place >= back) {
    const w = { slipstream: 3, nitro: 3, comet: 2, scrambler: 1 };
    if (place >= FLARE_FROM && field >= FLARE_FROM) w.flare = 3;
    return w;
  }
  return { comet: 3, scrambler: 3, fog: 2, slipstream: 2, deflector: 1 };
}

/** One item, rolled against those weights. */
export function rollItem(place, field, rnd = Math.random) {
  const w = itemWeights(place, field);
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let n = rnd() * total;
  for (const [id, weight] of Object.entries(w)) {
    n -= weight;
    if (n <= 0) return id;
  }
  return Object.keys(w)[0];
}

/** What an answer is worth while a flare is overhead. */
export const flared = (metres) => Math.round(metres * (1 - FLARE_CUT));

// ── computer drivers ─────────────────────────────────────────────────
//
// A driver has one number that matters: how long it takes over a word. It
// does not read a clue or unscramble anything — it answers on a timer, and
// the timer is drawn fresh each time so it does not run like a metronome.
//
// The pace is what a person of that standard would manage, judged against a
// standard fifteen-second allowance: Rookie mostly takes the floor, Pro is
// quick enough to be worth beating.

export const AI_PACE = {
  easy: { name: "Rookie", low: 14_000, high: 20_000 },
  medium: { name: "Club", low: 7_500, high: 14_000 },
  hard: { name: "Pro", low: 3_800, high: 8_000 },
};
export const AI_LEVELS = Object.entries(AI_PACE).map(([id, p]) => ({
  id, name: p.name,
  blurb: `About ${Math.round((p.low + p.high) / 2000)} seconds a word.`,
}));
export const AI_MAX = 5;
export const AI_NAMES = ["Bolt", "Dart", "Scout", "Rook", "Vega"];

/** How long this driver takes over its next word. */
export function aiPace(level, rnd = Math.random) {
  const p = AI_PACE[level] || AI_PACE.medium;
  return Math.round(p.low + rnd() * (p.high - p.low));
}

/** The allowance a driver is judged against, so it scores like a person. */
export const AI_ALLOWANCE = 15_000;

/**
 * What a driver does with the item in its hands.
 *
 * Self items go straight away — there is no cleverness in holding a
 * slipstream. A weapon needs somebody in front, and the better the driver
 * the more likely it is to hold one back for the last lap, where it hurts.
 */
export function aiShouldFire({ item, hasTargetAhead, lap, laps, level }, rnd = Math.random) {
  if (!item) return false;
  if (item === "slipstream" || item === "nitro" || item === "deflector" || item === "slick") return true;
  if (!hasTargetAhead) return false;
  if (item === "flare") return true;   // the room refuses it above fourth anyway
  const lastLap = lap >= laps;
  if (lastLap) return true;
  // Patience, by standard: a Pro sits on a comet, a Rookie throws it.
  const hold = { easy: 0.1, medium: 0.35, hard: 0.6 }[level] ?? 0.3;
  return rnd() > hold;
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
