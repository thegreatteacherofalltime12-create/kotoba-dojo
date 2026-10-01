/**
 * Match-3 Attack Arena — the parts that are arithmetic rather than room.
 *
 * Everything here is pure, so the whole of the rules can be tested without a
 * Durable Object, and so the room and the browser can never disagree about what
 * a swap did: the room runs the rules, and the browser is handed the finished
 * cascade to draw.
 *
 * The board is a stack. Tiles sit on the floor of a six-wide, ten-deep well and
 * a fresh row pushes up from underneath on a timer that gets faster. Clearing
 * tiles builds charge; charge does nothing until its owner solves a word, and
 * then it leaves as rubble on the other player's well. A stack that has nowhere
 * left to rise loses.
 */
import { rngFrom } from "./artillery.js";

export const GAME_NAME = "Match-3 Attack Arena";

export const COLS = 6;
export const ROWS = 10;
export const COLORS = 5;
export const RUBBLE = 9;
export const START_ROWS = 5;

/** The longest a match lasts, and how the stack rises under it. */
export const MATCH_MS = 5 * 60_000;
export const RISE_START_MS = 6_500;
export const RISE_FLOOR_MS = 2_400;
export const RISE_EASE = 0.965;

/** Most rubble that lands on a well at once, and how long it can be put off. */
export const MAX_LAND = 8;
export const LAND_MS = 6_000;
/** Most a single launch can send, and the charge a well can hold. */
export const MAX_LAUNCH = 14;
export const MAX_CHARGE = 30;

export const key = (r, c) => `${r},${c}`;
export const inside = (r, c) => r >= 0 && c >= 0 && r < ROWS && c < COLS;
const isColor = (v) => v !== null && v !== undefined && v >= 0 && v < COLORS;

const empty = () => Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
export const copy = (board) => board.map((row) => row.slice());

/** What a cascade step is worth: a bigger match, and a deeper chain, both pay. */
export function attackFor(cleared, chain) {
  return Math.max(0, cleared - 2) + 2 * Math.max(0, chain - 1);
}

/** A new colour for a cell that would not make three in a row with its neighbours. */
function colourFor(board, r, c, rnd) {
  const bad = new Set();
  const same = (a, b) => isColor(a) && a === b;
  // Two to the left, two above: the only ways this cell can complete a run
  // while the board is being filled left to right, bottom to top.
  if (c >= 2 && same(board[r][c - 1], board[r][c - 2])) bad.add(board[r][c - 1]);
  if (r + 2 < ROWS && same(board[r + 1][c], board[r + 2][c])) bad.add(board[r + 1][c]);
  const ok = [];
  for (let v = 0; v < COLORS; v++) if (!bad.has(v)) ok.push(v);
  return ok[Math.floor(rnd() * ok.length)];
}

/** A starting well: a few rows of tiles on the floor, with no match already made. */
export function makeBoard(rnd = Math.random) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const b = empty();
    for (let r = ROWS - START_ROWS; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) b[r][c] = colourFor(b, r, c, rnd);
    }
    if (findMatches(b).size === 0 && hasMove(b)) return b;
  }
  throw new Error("could not make a playable board");
}

/** Every cell that is part of a run of three or more, as "r,c" keys. */
export function findMatches(board) {
  const out = new Set();
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const v = board[r][c];
      let end = c;
      while (end + 1 < COLS && isColor(v) && board[r][end + 1] === v) end++;
      if (isColor(v) && end - c >= 2) for (let k = c; k <= end; k++) out.add(key(r, k));
      c = end + 1;
    }
  }
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS) {
      const v = board[r][c];
      let end = r;
      while (end + 1 < ROWS && isColor(v) && board[end + 1][c] === v) end++;
      if (isColor(v) && end - r >= 2) for (let k = r; k <= end; k++) out.add(key(k, c));
      r = end + 1;
    }
  }
  return out;
}

/** Everything falls to the floor of its column. */
export function applyGravity(board) {
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const v = board[r][c];
      if (v === null) continue;
      if (r !== write) { board[write][c] = v; board[r][c] = null; }
      write--;
    }
  }
}

/**
 * Clear whatever is matched, and keep clearing what falls into place.
 *
 * Rubble beside a cleared tile goes with it — that is the only way it ever
 * leaves. Each step carries a picture of the well as it was left, because the
 * browser is meant to draw what happened and never to work it out.
 */
export function resolve(board) {
  const steps = [];
  let charge = 0;
  let cleared = 0;
  let chain = 0;
  for (;;) {
    const hit = findMatches(board);
    if (!hit.size) break;
    chain += 1;
    const cells = [...hit].map((k) => k.split(",").map(Number));
    const rubble = [];
    for (const [r, c] of cells) {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (inside(rr, cc) && board[rr][cc] === RUBBLE && !rubble.some(([a, b]) => a === rr && b === cc)) rubble.push([rr, cc]);
      }
    }
    for (const [r, c] of cells) board[r][c] = null;
    for (const [r, c] of rubble) board[r][c] = null;
    applyGravity(board);
    const worth = attackFor(cells.length, chain);
    charge += worth;
    cleared += cells.length;
    steps.push({ chain, cells, rubble, worth, after: copy(board) });
  }
  return { steps, charge, cleared, chain };
}

/**
 * Swap two neighbouring tiles. Only a swap that makes a match is allowed — a
 * move that does nothing is not a move — and rubble cannot be picked up.
 */
export function swap(board, a, b) {
  const [ar, ac] = a, [br, bc] = b;
  if (![ar, ac, br, bc].every(Number.isInteger)) return { ok: false, why: "That is not a square." };
  if (!inside(ar, ac) || !inside(br, bc)) return { ok: false, why: "That is not on the board." };
  if (Math.abs(ar - br) + Math.abs(ac - bc) !== 1) return { ok: false, why: "Swap with a neighbour." };
  if (!isColor(board[ar][ac]) || !isColor(board[br][bc])) return { ok: false, why: "Nothing to swap there." };
  if (board[ar][ac] === board[br][bc]) return { ok: false, why: "Those two are the same." };

  const t = board[ar][ac];
  board[ar][ac] = board[br][bc];
  board[br][bc] = t;
  if (!findMatches(board).size) {
    board[br][bc] = board[ar][ac];
    board[ar][ac] = t;
    return { ok: false, why: "That makes no match." };
  }
  return { ok: true, ...resolve(board) };
}

/** Every swap that would make a match, as [[r,c],[r,c]]. */
export function moves(board) {
  const out = [];
  const test = (a, b) => {
    const [ar, ac] = a, [br, bc] = b;
    if (!isColor(board[ar][ac]) || !isColor(board[br][bc]) || board[ar][ac] === board[br][bc]) return;
    const t = board[ar][ac];
    board[ar][ac] = board[br][bc]; board[br][bc] = t;
    if (findMatches(board).size) out.push([a, b]);
    board[br][bc] = board[ar][ac]; board[ar][ac] = t;
  };
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (c + 1 < COLS) test([r, c], [r, c + 1]);
    if (r + 1 < ROWS) test([r, c], [r + 1, c]);
  }
  return out;
}

export const hasMove = (board) => moves(board).length > 0;

/**
 * No move left would be a soft-lock, so the coloured tiles are shaken up in
 * place until there is one. Rubble stays where it fell.
 */
export function reshuffle(board, rnd = Math.random) {
  const spots = [];
  const tiles = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (isColor(board[r][c])) { spots.push([r, c]); tiles.push(board[r][c]); }
  }
  if (spots.length < 4) return false;
  for (let attempt = 0; attempt < 200; attempt++) {
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }
    spots.forEach(([r, c], i) => { board[r][c] = tiles[i]; });
    if (!findMatches(board).size && hasMove(board)) return true;
  }
  return false;
}

/** The highest occupied row, as a height: how much of the well is used. */
export function height(board) {
  for (let r = 0; r < ROWS; r++) if (board[r].some((v) => v !== null)) return ROWS - r;
  return 0;
}

/**
 * Push a fresh row up from underneath. If the top row is already occupied the
 * stack has nowhere to go and that is the end of it.
 */
export function rise(board, rnd = Math.random) {
  if (board[0].some((v) => v !== null)) return { over: true };
  for (let r = 0; r < ROWS - 1; r++) board[r] = board[r + 1];
  board[ROWS - 1] = new Array(COLS).fill(null);
  for (let c = 0; c < COLS; c++) board[ROWS - 1][c] = colourFor(board, ROWS - 1, c, rnd);
  return { over: false };
}

/**
 * Drop rubble onto the stack, a column at a time starting somewhere at random,
 * so it spreads rather than building a tower. Rubble with no room to land is
 * an overflow, and the well it was aimed at is finished.
 */
export function dropRubble(board, n, rnd = Math.random) {
  const placed = [];
  let col = Math.floor(rnd() * COLS);
  for (let i = 0; i < n; i++) {
    let landed = false;
    for (let tries = 0; tries < COLS && !landed; tries++) {
      const c = (col + tries) % COLS;
      let top = ROWS;
      for (let r = 0; r < ROWS; r++) if (board[r][c] !== null) { top = r; break; }
      if (top - 1 >= 0) { board[top - 1][c] = RUBBLE; placed.push([top - 1, c]); landed = true; col = c + 1; }
    }
    if (!landed) return { over: true, placed };
  }
  return { over: false, placed };
}

// ── words ────────────────────────────────────────────────────────────

/** What a launch carries: the charge, and a little more for a longer word. */
export function launchSize(charge, wordLen) {
  if (!(charge > 0)) return 0;
  return Math.min(MAX_LAUNCH, Math.round(charge) + Math.max(0, (Number(wordLen) || 0) - 3));
}

/**
 * Playing alone is for learning the words as much as the tiles, and nobody is
 * waiting on you, so a solo match runs slower all round: the stack rises, and
 * rubble takes to land, this many times as long.
 */
export const SOLO_PACE = 2;

/** The rise interval after one more rise, which never drops below the floor. */
export const nextRiseMs = (ms, pace = 1) => Math.max(Math.round(RISE_FLOOR_MS * pace), Math.round(ms * RISE_EASE));

// ── survival ─────────────────────────────────────────────────────────

/**
 * Playing alone, the other side of the table is the game itself. It sends
 * rubble on a schedule that speeds up and grows, and the only thing that
 * cancels it is the thing that cancels it against a person: building charge
 * and solving a word. Nobody on the other side, the same loop.
 */
export const PRESSURE_START_MS = 20_000;
export const PRESSURE_FLOOR_MS = 9_000;
export const PRESSURE_EASE = 0.96;
export const nextPressureMs = (ms) => Math.max(PRESSURE_FLOOR_MS, Math.round(ms * PRESSURE_EASE));

/** How much rubble one wave carries: two to four to begin with, and more each minute. */
export function pressureSize(elapsedMs, rnd = Math.random) {
  return 2 + Math.floor(Math.max(0, elapsedMs) / 60_000) + Math.floor(rnd() * 3);
}

/**
 * A survival run on the arena's hundred-point scale. How long you lasted
 * carries most of it; charge you launched, words you solved and your best chain
 * carry the rest, and lasting the whole five minutes is worth a little more.
 */
export function survivalScore({ seconds, sent, solved, maxChain, survived }) {
  const time = Math.min(60, ((Number(seconds) || 0) / (MATCH_MS / 1000)) * 60);
  const power = Math.min(15, (sent || 0) / 2);
  const words = Math.min(10, solved || 0);
  const chains = Math.min(10, Math.max(0, (maxChain || 0) - 1) * 3);
  return Math.max(0, Math.min(100, Math.round(time + power + words + chains + (survived ? 5 : 0))));
}

// ── the computer ─────────────────────────────────────────────────────

export const AI_LEVELS = [
  { id: "easy", name: "Easy", moveMs: 4_600, solveMs: 17_000, sees: 1 },
  { id: "medium", name: "Medium", moveMs: 3_200, solveMs: 12_000, sees: 2 },
  { id: "hard", name: "Hard", moveMs: 2_200, solveMs: 8_000, sees: 3 },
];
export const aiLevelById = (id) => AI_LEVELS.find((l) => l.id === id) || AI_LEVELS[0];
export const AI_NAMES = ["Rustbucket", "Vulture", "Hammerhead"];

/**
 * A computer's move. Easy takes any move; the others weigh them by the charge
 * the whole cascade would pay and take the best, with the lower level
 * sometimes settling for a worse one — which is what a person does too.
 */
export function aiMove(board, level, rnd = Math.random) {
  const all = moves(board);
  if (!all.length) return null;
  const l = aiLevelById(level);
  if (l.id === "easy") return all[Math.floor(rnd() * all.length)];
  const scored = all.map(([a, b]) => {
    const trial = copy(board);
    const out = swap(trial, a, b);
    return { move: [a, b], worth: out.ok ? out.charge * 3 + out.cleared : 0 };
  }).sort((x, y) => y.worth - x.worth);
  const pool = scored.slice(0, Math.max(1, l.sees === 2 ? 3 : 1));
  return pool[Math.floor(rnd() * pool.length)].move;
}

// ── scoring ──────────────────────────────────────────────────────────

/**
 * A finished match on the arena's hundred-point scale: where you finished
 * carries most of it, and how well you played carries the rest.
 */
export function matchScore({ placement, field, sent, solved, maxChain, survived }) {
  const place = field > 1 ? 80 - 50 * ((placement - 1) / (field - 1)) : 70;
  const power = Math.min(12, (sent || 0) / 3);
  const words = Math.min(5, (solved || 0) * 0.7);
  const chains = Math.min(3, Math.max(0, (maxChain || 0) - 1));
  const got = place * (survived ? 1 : 0.85) + power + words + chains;
  return Math.max(0, Math.min(100, Math.round(got)));
}

/** Last well standing; if time ran out, whoever hit harder, then the lower stack. */
export function standings(players, byTime = false) {
  return [...players].sort((a, b) =>
    (a.over ? 1 : 0) - (b.over ? 1 : 0) ||
    (byTime ? (b.sent - a.sent) || (a.h - b.h) : 0) ||
    (b.overAt || 0) - (a.overAt || 0) ||
    String(a.name).localeCompare(String(b.name)));
}

export { rngFrom };
