// The computer opponent. Pure functions over what the AI has itself observed,
// so it cannot see the board it is shooting at — it only remembers where it
// fired and what came back. That constraint is the whole point: an AI with
// access to the fleet would be unbeatable and no fun.

export const DIFFICULTIES = [
  { id: "easy",   name: "Easy",   blurb: "Fires blind. Never checks its work." },
  { id: "medium", name: "Medium", blurb: "Hunts at random, then finishes what it starts." },
  { id: "hard",   name: "Hard",   blurb: "Searches efficiently and reads the line of a ship." },
];

export const freshMemory = () => ({ shots: [], hits: [], active: [] });

const key = (r, c) => `${r},${c}`;
const parse = (cell) => cell.split(",").map(Number);
const inside = (r, c, size) => r >= 0 && c >= 0 && r < size && c < size;

function neighbours(cell, size) {
  const [r, c] = parse(cell);
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .filter(([rr, cc]) => inside(rr, cc, size))
    .map(([rr, cc]) => key(rr, cc));
}

/**
 * Once two hits line up, the rest of that ship is along the same axis. Hard
 * uses this; medium doesn't, which is most of the difference between them.
 */
function alongTheLine(active, size, fired) {
  for (const a of active) {
    for (const b of active) {
      if (a === b) continue;
      const [ar, ac] = parse(a);
      const [br, bc] = parse(b);
      const sameRow = ar === br && Math.abs(ac - bc) === 1;
      const sameCol = ac === bc && Math.abs(ar - br) === 1;
      if (!sameRow && !sameCol) continue;

      const rows = active.filter((c) => parse(c)[0] === ar).map((c) => parse(c)[1]);
      const cols = active.filter((c) => parse(c)[1] === ac).map((c) => parse(c)[0]);
      const ends = sameRow
        ? [key(ar, Math.min(...rows) - 1), key(ar, Math.max(...rows) + 1)]
        : [key(Math.min(...cols) - 1, ac), key(Math.max(...cols) + 1, ac)];

      for (const cell of ends) {
        const [rr, cc] = parse(cell);
        if (inside(rr, cc, size) && !fired.has(cell)) return cell;
      }
    }
  }
  return null;
}

/** The orthogonally connected group of hits containing `start`. */
function connectedRun(start, cells) {
  const pool = new Set(cells);
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const [r, c] = parse(stack.pop());
    for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const next = key(rr, cc);
      if (pool.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return seen;
}

function pickOne(memory, size, difficulty) {
  const fired = new Set(memory.shots);
  const all = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const cell = key(r, c);
    if (!fired.has(cell)) all.push(cell);
  }
  if (!all.length) return null;

  const random = () => all[Math.floor(Math.random() * all.length)];
  if (difficulty === "easy") return random();

  // Something is wounded: finish it before looking elsewhere.
  if (memory.active.length) {
    if (difficulty === "hard") {
      const line = alongTheLine(memory.active, size, fired);
      if (line) return line;
    }
    const around = memory.active
      .flatMap((cell) => neighbours(cell, size))
      .filter((cell) => !fired.has(cell));
    if (around.length) return around[Math.floor(Math.random() * around.length)];
  }

  if (difficulty === "hard") {
    // The smallest ship is two long, so every ship must touch a square where
    // (row + col) is even. Searching only those halves the work.
    const parity = all.filter((cell) => {
      const [r, c] = parse(cell);
      return (r + c) % 2 === 0;
    });
    if (parity.length) return parity[Math.floor(Math.random() * parity.length)];
  }

  return random();
}

/** Two shots, chosen one after the other so the pair never repeats itself. */
export function chooseShots(memory, size, difficulty, count = 2) {
  const out = [];
  const scratch = { ...memory, shots: [...memory.shots] };
  for (let i = 0; i < count; i++) {
    const cell = pickOne(scratch, size, difficulty);
    if (!cell) break;
    out.push(cell);
    scratch.shots.push(cell);
  }
  return out;
}

/**
 * Fold one shot's outcome back into memory.
 * @param {"hit"|"miss"|"sunk"|"repeat"} result
 */
export function remember(memory, cell, result) {
  if (result === "repeat") return memory;
  memory.shots.push(cell);
  if (result === "hit") {
    memory.hits.push(cell);
    memory.active.push(cell);
  }
  if (result === "sunk") {
    memory.hits.push(cell);
    // Only the ship that just went down is finished. Drop the run of hits
    // connected to this square and keep any others — with several ships
    // wounded at once, clearing everything throws away good information.
    const gone = connectedRun(cell, [...memory.active, cell]);
    memory.active = memory.active.filter((c) => !gone.has(c));
  }
  return memory;
}
