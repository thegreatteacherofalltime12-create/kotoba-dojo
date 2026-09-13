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
export function validateFleet(placements, mapId = "easy") {
  const fleet = fleetFor(mapId);
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
export function randomFleet(mapId = "easy") {
  const fleet = fleetFor(mapId);
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
  board.incoming.push(cell);

  const ship = board.ships.find((s) => s.cells.includes(cell) && !s.sunk);
  if (!ship) return { result: "miss" };

  ship.hits.push(cell);
  if (ship.hits.length >= ship.len) {
    ship.sunk = true;
    return { result: "sunk", ship: ship.name };
  }
  return { result: "hit", ship: ship.name };
}

export const fleetSunk = (board) => board.ships.every((s) => s.sunk);

/** Points for the round, fed into the same MMR pipeline as a crossword. */
export function battleScore({ hits = 0, sunk = 0, placement = 1, field = 2, survived = false, mapId = "easy" }) {
  // The big boards take longer and land a smaller share of shots, so a hit
  // there is worth more than a hit on the small one — otherwise the long game
  // pays less per minute than the short one.
  const weight = { easy: 1, medium: 1.25, hard: 1.5 }[mapId] || 1;
  const base = (hits * 4 + sunk * 12) * weight;
  const standing = Math.round((Math.max(0, field - placement) / Math.max(1, field - 1)) * 30);
  return Math.max(0, Math.min(100, Math.round(base + standing + (survived ? 20 : 0))));
}
