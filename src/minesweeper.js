import { ARSENALS } from "./arsenals.js";
// Minesweeper rules, with no I/O so they can be tested directly. The board
// lives on the server: a client is told only what it has uncovered, because a
// layout sitting in the page is a layout anyone can read.

export const LEVELS = [
  { id: "beginner",     name: "Beginner",     rows: 9,  cols: 9,  mines: 10, blurb: "Nine by nine, ten mines." },
  { id: "intermediate", name: "Intermediate", rows: 16, cols: 16, mines: 40, blurb: "Sixteen square, forty mines." },
  { id: "expert",       name: "Expert",       rows: 16, cols: 30, mines: 99, blurb: "Wide board, ninety-nine mines." },
];

export const levelById = (id) => LEVELS.find((l) => l.id === id) || LEVELS[0];

export const key = (r, c) => `${r},${c}`;

function neighbours(r, c, rows, cols) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) out.push([rr, cc]);
    }
  }
  return out;
}

/** Neighbour counts for every safe square, given where the mines are. */
function countsFor(mineSet, rows, cols) {
  const counts = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (mineSet.has(key(r, c))) continue;
      counts[key(r, c)] = neighbours(r, c, rows, cols)
        .filter(([rr, cc]) => mineSet.has(key(rr, cc))).length;
    }
  }
  return counts;
}

// ── the arsenal ───────────────────────────────────────────────────────
export const MINE_ARSENAL = ARSENALS.minesweeper;
export const CLEAR_SPAN = 5;                       // the Clear Map area
export const SHIELD_MS = 10_000;                   // invincibility, per token
export const BUSTER_LEVELS = ["intermediate", "expert"];

/**
 * The board as one player sees it once some mines have been busted: those
 * squares are safe ground, the numbers around them drop, and there is that
 * much more to clear. The shared board is never changed.
 */
export function bustBoard(board, busted) {
  if (!busted?.length) return board;
  const mineSet = new Set(board.mineList.filter((m) => !busted.includes(m)));
  return {
    ...board,
    mineList: [...mineSet],
    counts: countsFor(mineSet, board.rows, board.cols),
    safeTotal: board.rows * board.cols - mineSet.size,
  };
}

/** A square block centred on a cell, clipped to the board. */
export function areaCells(cell, span, rows, cols) {
  const [r, c] = String(cell).split(",").map(Number);
  if (!Number.isInteger(r) || !Number.isInteger(c)) return [];
  const off = Math.floor(span / 2);
  const out = [];
  for (let i = -off; i <= off; i++) for (let j = -off; j <= off; j++) {
    const rr = r + i, cc = c + j;
    if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) out.push(key(rr, cc));
  }
  return out;
}

export const GLOVES_DIGS = 3;      // mines the gloves defuse
export const DRONE_PICKS = 3;      // squares the drone opens
export const FLAG_PICKS = 3;       // mines the frontier flags mark
export const DEMO_PICKS = 3;       // mines the charge destroys
export const RECON_SPAN = 3;       // the recon patrol's area
export const WATCH_MS = 30_000;    // what a stopwatch takes off the clock
export const HAZARD_LIFT = 0.15;   // what hazard pay adds to a lost sweep
export const NEXT_LEVEL = { beginner: "intermediate", intermediate: "expert", expert: "expert" };

/** Every square of the board, in reading order. */
export function allCells(board) {
  const out = [];
  for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) out.push(key(r, c));
  return out;
}

/** The squares that touch this one. */
export const around = (board, cell) => {
  const [r, c] = String(cell).split(",").map(Number);
  return neighbours(r, c, board.rows, board.cols).map(([rr, cc]) => key(rr, cc));
};

/** Mines in an area, for the detector and the radar. */
export const minesIn = (board, cells) => cells.filter((x) => isMine(board, x)).length;

/** One row or one column, named as "r3" or "c7". */
export function lineCells(board, name) {
  const m = /^([rc])([0-9]+)$/.exec(String(name || ""));
  if (!m) return [];
  const n = Number(m[2]);
  const out = [];
  if (m[1] === "r") { if (n < 0 || n >= board.rows) return []; for (let c = 0; c < board.cols; c++) out.push(key(n, c)); }
  else { if (n < 0 || n >= board.cols) return []; for (let r = 0; r < board.rows; r++) out.push(key(r, n)); }
  return out;
}

/** The four quarters, with how many mines sit in each. */
export function quadrants(board) {
  const midR = Math.ceil(board.rows / 2), midC = Math.ceil(board.cols / 2);
  const box = (r0, r1, c0, c1) => {
    let n = 0;
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (isMine(board, key(r, c))) n++;
    return n;
  };
  return [
    { name: "top left", mines: box(0, midR, 0, midC) },
    { name: "top right", mines: box(0, midR, midC, board.cols) },
    { name: "bottom left", mines: box(midR, board.rows, 0, midC) },
    { name: "bottom right", mines: box(midR, board.rows, midC, board.cols) },
  ];
}

/**
 * The mines that touch ground a player has already opened — what a sapper
 * could work out with time, handed over at once.
 */
export function frontierMines(board, revealed) {
  const open = Object.keys(revealed).filter((k) => revealed[k] >= 0);
  const out = new Set();
  for (const cell of open) for (const n of around(board, cell)) {
    if (isMine(board, n) && revealed[n] === undefined) out.add(n);
  }
  return [...out];
}

/** Safe unopened squares, nearest the ground already opened first. */
export function safeSquares(board, revealed, flags = []) {
  const open = new Set(Object.keys(revealed).filter((k) => revealed[k] >= 0));
  const touching = new Set();
  for (const cell of open) for (const n of around(board, cell)) touching.add(n);
  const free = allCells(board).filter((x) => revealed[x] === undefined && !isMine(board, x) && !flags.includes(x));
  return free.sort((a, b) => (touching.has(b) ? 1 : 0) - (touching.has(a) ? 1 : 0));
}

/** The mines nearest a square, for a demolition charge. */
export function nearestMines(board, cell, howMany) {
  const [r, c] = String(cell).split(",").map(Number);
  return board.mineList
    .map((m) => { const [mr, mc] = m.split(",").map(Number); return { m, d: Math.max(Math.abs(mr - r), Math.abs(mc - c)) }; })
    .sort((a, b) => a.d - b.d)
    .slice(0, howMany)
    .map((x) => x.m);
}

/**
 * A chord: the squares around an open number whose flags already match it.
 * Returns the unflagged neighbours to open, or an empty list if the number
 * is not satisfied — the classic rule, and the same risk.
 */
export function chordCells(board, revealed, flags, cell) {
  const n = revealed[cell];
  if (!(n > 0)) return [];
  const near = around(board, cell);
  const flagged = near.filter((x) => flags.includes(x)).length;
  if (flagged !== n) return [];
  return near.filter((x) => !flags.includes(x) && revealed[x] === undefined);
}

/** The biggest patch of empty ground on the board, for a better opening. */
export function bestOpening(board) {
  const zeros = Object.keys(board.counts).filter((k) => board.counts[k] === 0);
  let best = null, bestSize = -1;
  const seen = new Set();
  for (const z of zeros) {
    if (seen.has(z)) continue;
    const stack = [z];
    const group = [];
    while (stack.length) {
      const at = stack.pop();
      if (seen.has(at)) continue;
      seen.add(at);
      group.push(at);
      if (board.counts[at] !== 0) continue;
      for (const nb of around(board, at)) if (!seen.has(nb) && board.counts[nb] !== undefined) stack.push(nb);
    }
    if (group.length > bestSize) { bestSize = group.length; best = z; }
  }
  return best || board.start;
}

/**
 * A board everyone in the round shares.
 *
 * Classic Minesweeper places mines after the first click so nobody loses on
 * move one. In a race that can't work — the layout has to be identical for
 * everyone before anyone clicks. Instead the board is built with a guaranteed
 * empty opening, and that opening is uncovered for every player at the start.
 */
export function makeBoard(levelId) {
  const level = levelById(levelId);
  const { rows, cols, mines } = level;

  for (let attempt = 0; attempt < 200; attempt++) {
    const mineSet = new Set();
    while (mineSet.size < mines) {
      mineSet.add(key(Math.floor(Math.random() * rows), Math.floor(Math.random() * cols)));
    }

    const counts = countsFor(mineSet, rows, cols);

    // An opening worth having: a cell with no mines touching it, so the
    // flood-fill gives everyone a real start rather than a single square.
    const openings = Object.keys(counts).filter((k) => counts[k] === 0);
    if (!openings.length) continue;
    const start = openings[Math.floor(Math.random() * openings.length)];

    return {
      level: level.id, rows, cols, mines,
      mineList: [...mineSet],
      counts,
      start,
      safeTotal: rows * cols - mines,
    };
  }
  return null;
}

export const isMine = (board, cell) => board.mineList.includes(cell);

/**
 * Uncovers a cell for one player, spreading through empty ground.
 * @returns {{cells: Object, hitMine: boolean, won: boolean}}
 *          cells maps each newly uncovered square to its neighbour count.
 */
export function reveal(board, revealed, cell) {
  const out = {};
  if (revealed[cell] !== undefined) return { cells: out, hitMine: false, won: false };

  if (isMine(board, cell)) return { cells: { [cell]: -1 }, hitMine: true, won: false };

  const stack = [cell];
  while (stack.length) {
    const at = stack.pop();
    if (out[at] !== undefined || revealed[at] !== undefined) continue;
    const n = board.counts[at];
    if (n === undefined) continue;
    out[at] = n;
    if (n !== 0) continue;
    const [r, c] = at.split(",").map(Number);
    for (const [rr, cc] of neighbours(r, c, board.rows, board.cols)) {
      const next = key(rr, cc);
      if (out[next] === undefined && revealed[next] === undefined && !isMine(board, next)) stack.push(next);
    }
  }

  const total = Object.values(revealed).filter((v) => v >= 0).length + Object.keys(out).length;
  return { cells: out, hitMine: false, won: total >= board.safeTotal };
}

/** The opening every player starts from. */
export function openingFor(board) {
  return reveal(board, {}, board.start).cells;
}

export function progressOf(board, revealed) {
  const safe = Object.keys(revealed).filter((k) => revealed[k] >= 0).length;
  return Math.min(1, safe / board.safeTotal);
}

export const ROUND_CAP_MS = 10 * 60_000;

/**
 * 0-100. Clearing the board pays most; a board part-cleared before hitting a
 * mine still pays something, so a bad break never costs a player everything.
 */
export function mineScore({ won, progress = 0, elapsedMs = 0, cap = ROUND_CAP_MS, level = "beginner" }) {
  const weight = { beginner: 1, intermediate: 1.15, expert: 1.3 }[level] || 1;
  if (!won) return Math.max(0, Math.min(55, Math.round(50 * progress * weight)));
  const speed = Math.max(0, 1 - elapsedMs / cap);
  return Math.max(1, Math.min(100, Math.round((55 + 45 * speed) * weight)));
}
