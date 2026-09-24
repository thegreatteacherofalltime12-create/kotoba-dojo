import { ARSENALS } from "./arsenals.js";
// Every rule of Battleship Royale, with no I/O, so the awkward parts — the
// target cooldown especially — can be tested directly.

/**
 * Three theatres.
 *
 * The shot count rises with the board on purpose. A 20x20 holds four times
 * the water of a 10x10 but only about twice the steel, so at two shots a turn
 * it would take four times as long to clear and feel dead for most of it.
 * Five shots there keeps a turn worth roughly what a turn is worth on the
 * small board.
 */
export const MAPS = {
  easy:   { id: "easy",   name: "Skirmish", size: 10, shots: 2 },
  medium: { id: "medium", name: "Fleet Action", size: 15, shots: 4 },
  hard:   { id: "hard",   name: "Open Ocean", size: 20, shots: 5 },
};

const ROMAN = ["", " I", " II", " III", " IV"];

/** Several of one class need telling apart in the hit feed. */
function fleetOf(counts) {
  const out = [];
  for (const [type, spec] of Object.entries(HULLS)) {
    const n = counts[type] || 0;
    for (let i = 1; i <= n; i++) {
      out.push({
        id: n > 1 ? `${type}${i}` : type,
        name: n > 1 ? `${spec.name}${ROMAN[i]}` : spec.name,
        len: spec.len,
      });
    }
  }
  return out;
}

const HULLS = {
  carrier:    { name: "Carrier",    len: 5 },
  battleship: { name: "Battleship", len: 4 },
  cruiser:    { name: "Cruiser",    len: 3 },
  submarine:  { name: "Submarine",  len: 3 },
  destroyer:  { name: "Destroyer",  len: 2 },
};

export const FLEETS = {
  easy:   fleetOf({ carrier: 1, battleship: 1, cruiser: 1, submarine: 1, destroyer: 1 }),
  medium: fleetOf({ carrier: 2, battleship: 1, cruiser: 1, submarine: 1, destroyer: 2 }),
  hard:   fleetOf({ carrier: 3, battleship: 1, cruiser: 1, submarine: 1, destroyer: 3 }),
};

export const mapOf = (id) => MAPS[id] || MAPS.easy;
export const fleetFor = (id) => FLEETS[id] || FLEETS.easy;

// ── the arsenal ───────────────────────────────────────────────────────
//
// Tokens bought with casino money and armed for one battle. A captain may
// arm ARM_CAP of them in a match, and no more than NUKE_MAX nukes. Only what
// is used is spent. Every rule here is pure; the room applies them.
export const ARSENAL = ARSENALS.battleship;
export const ARSENAL_KEYS = Object.keys(ARSENAL);
export const ARM_CAP = 6;
export const NUKE_MAX = 2;
export const EXTRA_HULLS = 3;
export const SONAR_SPAN = 3;      // the sonar's window
export const DEPTH_ARMS = 5;      // the depth charge's cross
export const SMOKE_TURNS = 1;     // rounds of turns a smoke screen holds
export const STRIKE_SPAN = 6;     // an air strike, and the shield that stops one
export const NUKE_RADIUS = { easy: 0, medium: 1, hard: 3 };   // 0 = sinks the ship it hits
export const extraShotsFor = (mapId) => ({ easy: 2, medium: 4, hard: 6 })[mapId] || 2;

/**
 * The squares a blast covers. An odd span (a nuke) centres on the square and
 * is clipped by the edge; an even span (an air strike, a shield) anchors at
 * the square and slides inward so the whole area is always on the board.
 */
export function blastArea(cell, span, size) {
  const [r, c] = String(cell).split(",").map(Number);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return [];
  const odd = span % 2 === 1;
  const clamp = (v) => Math.max(0, Math.min(size - span, v));
  const r0 = odd ? r - Math.floor(span / 2) : clamp(r);
  const c0 = odd ? c - Math.floor(span / 2) : clamp(c);
  const out = [];
  for (let i = 0; i < span; i++) for (let j = 0; j < span; j++) {
    const rr = r0 + i, cc = c0 + j;
    if (rr >= 0 && cc >= 0 && rr < size && cc < size) out.push(key(rr, cc));
  }
  return out;
}

/** The extra hulls a captain chose, as fleet entries. Any hull, repeats allowed, up to EXTRA_HULLS. */
export function extraHulls(picks) {
  const list = (Array.isArray(picks) ? picks : []).map(String).filter((t) => HULLS[t]).slice(0, EXTRA_HULLS);
  return list.map((type, i) => ({ id: `x_${type}${i + 1}`, name: `Extra ${HULLS[type].name}`, len: HULLS[type].len, extra: true }));
}
export const HULL_TYPES = Object.keys(HULLS);

// The old names still work, so nothing that hasn't been told about maps breaks.
export const SIZE = MAPS.easy.size;
export const FLEET = FLEETS.easy;
export const SHOTS_PER_TURN = MAPS.easy.shots;

// You must fire at this many other people before coming back to someone.
export const COOLDOWN_TARGETS = 3;

export const key = (r, c) => `${r},${c}`;

export function cellsFor(row, col, dir, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    out.push(dir === "down" ? key(row + i, col) : key(row, col + i));
  }
  return out;
}

/**
 * Checks a whole fleet placement. Returns the normalised ships or an error —
 * the client draws the board, but the server decides whether it's legal.
 */
export function validateFleet(placements, mapId = "easy", extra = []) {
  const fleet = fleetFor(mapId).concat(extra);
  const size = mapOf(mapId).size;
  if (!Array.isArray(placements) || placements.length !== fleet.length)
    return { ok: false, error: `Place all ${fleet.length} ships.` };

  const taken = new Set();
  const ships = [];

  for (const spec of fleet) {
    const p = placements.find((x) => x?.id === spec.id);
    if (!p) return { ok: false, error: `${spec.name} hasn't been placed.` };

    const dir = p.dir === "down" ? "down" : "across";
    const row = Number(p.row);
    const col = Number(p.col);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0)
      return { ok: false, error: `${spec.name} is off the board.` };

    const endR = row + (dir === "down" ? spec.len - 1 : 0);
    const endC = col + (dir === "across" ? spec.len - 1 : 0);
    if (endR >= size || endC >= size)
      return { ok: false, error: `${spec.name} hangs off the edge.` };

    const cells = cellsFor(row, col, dir, spec.len);
    for (const cell of cells) {
      if (taken.has(cell)) return { ok: false, error: `${spec.name} overlaps another ship.` };
      taken.add(cell);
    }

    ships.push({ id: spec.id, name: spec.name, len: spec.len, row, col, dir, cells, hits: [] });
  }

  return { ok: true, ships };
}

/** A fleet placed at random, for the auto-place button and for absent players. */
export function randomFleet(mapId = "easy", extra = []) {
  const fleet = fleetFor(mapId).concat(extra);
  const size = mapOf(mapId).size;
  for (let attempt = 0; attempt < 500; attempt++) {
    const taken = new Set();
    const placements = [];
    let stuck = false;

    for (const spec of fleet) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const dir = Math.random() < 0.5 ? "across" : "down";
        const row = Math.floor(Math.random() * (dir === "down" ? size - spec.len + 1 : size));
        const col = Math.floor(Math.random() * (dir === "across" ? size - spec.len + 1 : size));
        const cells = cellsFor(row, col, dir, spec.len);
        if (cells.some((c) => taken.has(c))) continue;
        cells.forEach((c) => taken.add(c));
        placements.push({ id: spec.id, row, col, dir });
        placed = true;
      }
      if (!placed) { stuck = true; break; }
    }
    if (!stuck) return placements;
  }
  return null;
}

/**
 * May `shooter` fire at `target` right now?
 *
 * The rule: after firing at someone, you must fire at COOLDOWN_TARGETS other
 * distinct players before returning to them. It stops two players locking
 * onto each other and ignoring the rest of the table. With a small field
 * there aren't enough others to rotate through, so it lifts.
 *
 * @param {string[]} history  this shooter's past targets, oldest first
 * @param {number}   aliveOpponents  how many others are still in
 */
export function canTarget(history, target, aliveOpponents) {
  if (aliveOpponents <= COOLDOWN_TARGETS) return { ok: true };

  const last = history.lastIndexOf(target);
  if (last === -1) return { ok: true };

  const since = new Set(history.slice(last + 1).filter((u) => u !== target));
  if (since.size >= COOLDOWN_TARGETS) return { ok: true };

  return {
    ok: false,
    error: `Fire at ${COOLDOWN_TARGETS - since.size} more before returning to this one.`,
    remaining: COOLDOWN_TARGETS - since.size,
  };
}

/** Who this shooter is allowed to hit, with a reason attached to those they can't. */
export function targetOptions(shooterUid, players, history) {
  const alive = Object.values(players).filter((p) => p.alive && p.uid !== shooterUid);
  return alive.map((p) => {
    const verdict = canTarget(history, p.uid, alive.length);
    return { uid: p.uid, name: p.name, allowed: verdict.ok, reason: verdict.error || null };
  });
}

/**
 * Applies one shot to a fleet. Mutates the ship's hit list.
 * @returns {{result: "hit"|"miss"|"sunk"|"repeat", ship?: string}}
 */
export function fireAt(board, cell) {
  if (board.incoming.includes(cell)) return { result: "repeat" };

  const found = board.ships.find((s) => s.cells.includes(cell) && !s.sunk);
  // Armour turns the first shell aside before the square is even marked:
  // the water there reads as untouched, and she can be hit there again.
  if (found && found.armour > 0) { found.armour -= 1; return { result: "armour", ship: found.name }; }

  board.incoming.push(cell);
  const ship = found;
  if (!ship) return { result: "miss" };

  ship.hits.push(cell);
  if (ship.hits.length >= ship.len) {
    ship.sunk = true;
    return { result: "sunk", ship: ship.name };
  }
  return { result: "hit", ship: ship.name };
}

export const fleetSunk = (board) => board.ships.every((s) => s.sunk);

/** Is there a ship still afloat on this square? */
export const shipAt = (board, cell) => board.ships.some((s) => !s.sunk && s.cells.includes(cell));

/** The cross a depth charge falls in: the square, and the four beside it. */
export function crossCells(cell, size) {
  const [r, c] = String(cell).split(",").map(Number);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return [];
  return [[r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .filter(([rr, cc]) => rr >= 0 && cc >= 0 && rr < size && cc < size)
    .map(([rr, cc]) => key(rr, cc));
}

/** One row or one column, named as "r3" or "c7". */
export function lineOf(name, size) {
  const m = /^([rc])([0-9]+)$/.exec(String(name || ""));
  if (!m) return [];
  const n = Number(m[2]);
  if (n < 0 || n >= size) return [];
  const out = [];
  for (let i = 0; i < size; i++) out.push(m[1] === "r" ? key(n, i) : key(i, n));
  return out;
}

/** Ship squares in an area — what the sonar and the radar report. */
export const shipSquares = (board, cells) => cells.filter((x) => shipAt(board, x)).length;

/**
 * A berth for one ship that clears the rest of the fleet. Previously missed
 * water is fair game: that a captain fired there once is exactly what makes
 * moving worth doing.
 */
export function newBerth(board, ship, size) {
  const taken = new Set(board.ships.filter((s) => s.id !== ship.id).flatMap((s) => s.cells));
  for (let tries = 0; tries < 400; tries++) {
    const dir = Math.random() < 0.5 ? "across" : "down";
    const row = Math.floor(Math.random() * (dir === "down" ? size - ship.len + 1 : size));
    const col = Math.floor(Math.random() * (dir === "across" ? size - ship.len + 1 : size));
    const cells = cellsFor(row, col, dir, ship.len);
    if (cells.some((x) => taken.has(x))) continue;
    // Her own water is free, but slipping away to exactly where she already
    // lies is not slipping away: it would spend the token for nothing.
    if (cells.join() === (ship.cells || []).join()) continue;
    return { row, col, dir, cells };
  }
  return null;
}

/**
 * How much a captain's aim is worth.
 *
 * A smooth curve on accuracy — hits over shots fired. Half your shots landing
 * is par and changes nothing; every point above it pays, up to three
 * quarters more for a near-perfect round, and spraying the water costs up
 * to a quarter. No shots fired is par too: nothing to judge.
 */
export const ACCURACY_PAR = 0.5;
export function accuracyBonus(hits, shots) {
  if (!(shots > 0)) return 1;
  const accuracy = Math.max(0, Math.min(1, hits / shots));
  return Math.max(0.75, Math.min(1.75, 1 + (accuracy - ACCURACY_PAR) * 1.5));
}

/** Points for the round, fed into the same MMR pipeline as a crossword. */
export function battleScore({ hits = 0, sunk = 0, shots = 0, blast = 0, placement = 1, field = 2, survived = false, mapId = "easy" }) {
  // The big boards take longer and land a smaller share of shots, so a hit
  // there is worth more than a hit on the small one — otherwise the long game
  // pays less per minute than the short one. Hits from a blast count, but
  // they say nothing about aim, so they stay out of the accuracy.
  const weight = { easy: 1, medium: 1.25, hard: 1.5 }[mapId] || 1;
  const base = (hits * 4 + sunk * 12) * weight * accuracyBonus(Math.max(0, hits - blast), shots);
  const standing = Math.round((Math.max(0, field - placement) / Math.max(1, field - 1)) * 30);
  return Math.max(0, Math.min(100, Math.round(base + standing + (survived ? 20 : 0))));
}

/**
 * A turn's fire, spread over one or more opponents.
 *
 * A volley is [{ target, cells }]. The same target named twice is folded
 * together; every target must take at least one shot and the shots must add
 * up to the chart's count exactly. All-in on one captain is allowed. Returns
 * the clean volley or an error to send back.
 */
export function normalizeVolley(raw, shots) {
  const list = Array.isArray(raw) ? raw : [];
  const byTarget = new Map();
  for (const part of list) {
    const target = String(part?.target || "");
    if (!target) continue;
    const have = byTarget.get(target) || [];
    for (const c of part?.cells || []) if (!have.includes(String(c))) have.push(String(c));
    byTarget.set(target, have);
  }
  const volley = [...byTarget].map(([target, cells]) => ({ target, cells })).filter((v) => v.cells.length);
  const total = volley.reduce((n, v) => n + v.cells.length, 0);
  if (!volley.length) return { ok: false, error: "Pick a live opponent." };
  if (total !== shots) return { ok: false, error: `Choose ${shots} different squares in all.` };
  return { ok: true, volley };
}

/**
 * Where the computer puts its shots this turn.
 *
 * It obeys the same rotation as everyone else. Hard captains split their
 * fire across two allowed targets when they can — pressure on two boards at
 * once; Easy and Medium concentrate on one. Targets are drawn at random
 * from those the rotation allows.
 */
export function aiTargets(history, foes, shots, difficulty) {
  const options = targetOptionsFrom(history, foes);
  const allowed = options.filter((o) => o.allowed).map((o) => o.uid);
  const pool = allowed.length ? allowed : options.map((o) => o.uid);
  if (!pool.length) return [];
  const pick = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const first = pick();
  if (difficulty !== "hard" || shots < 2 || !pool.length) return [{ target: first, count: shots }];
  const second = pick();
  const half = Math.ceil(shots / 2);
  return [{ target: first, count: half }, { target: second, count: shots - half }];
}

function targetOptionsFrom(history, foes) {
  return foes.map((p) => ({ uid: p.uid, allowed: canTarget(history, p.uid, foes.length).ok }));
}
