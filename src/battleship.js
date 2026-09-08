// Every rule of Battleship Royale, with no I/O, so the awkward parts — the
// target cooldown especially — can be tested directly.

export const SIZE = 10;

export const FLEET = [
  { id: "carrier",    name: "Carrier",    len: 5 },
  { id: "battleship", name: "Battleship", len: 4 },
  { id: "cruiser",    name: "Cruiser",    len: 3 },
  { id: "submarine",  name: "Submarine",  len: 3 },
  { id: "destroyer",  name: "Destroyer",  len: 2 },
];

export const SHOTS_PER_TURN = 2;

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
export function validateFleet(placements) {
  if (!Array.isArray(placements) || placements.length !== FLEET.length)
    return { ok: false, error: `Place all ${FLEET.length} ships.` };

  const taken = new Set();
  const ships = [];

  for (const spec of FLEET) {
    const p = placements.find((x) => x?.id === spec.id);
    if (!p) return { ok: false, error: `${spec.name} hasn't been placed.` };

    const dir = p.dir === "down" ? "down" : "across";
    const row = Number(p.row);
    const col = Number(p.col);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0)
      return { ok: false, error: `${spec.name} is off the board.` };

    const endR = row + (dir === "down" ? spec.len - 1 : 0);
    const endC = col + (dir === "across" ? spec.len - 1 : 0);
    if (endR >= SIZE || endC >= SIZE)
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
export function randomFleet() {
  for (let attempt = 0; attempt < 500; attempt++) {
    const taken = new Set();
    const placements = [];
    let stuck = false;

    for (const spec of FLEET) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const dir = Math.random() < 0.5 ? "across" : "down";
        const row = Math.floor(Math.random() * (dir === "down" ? SIZE - spec.len + 1 : SIZE));
        const col = Math.floor(Math.random() * (dir === "across" ? SIZE - spec.len + 1 : SIZE));
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
export function battleScore({ hits = 0, sunk = 0, placement = 1, field = 2, survived = false }) {
  const base = hits * 4 + sunk * 12;
  const standing = Math.round((Math.max(0, field - placement) / Math.max(1, field - 1)) * 30);
  return Math.max(0, Math.min(100, base + standing + (survived ? 20 : 0)));
}
