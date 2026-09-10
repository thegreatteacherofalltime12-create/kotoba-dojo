// The sensei's browser lays the grid out, but the socket message carrying it
// is still client input. A hand-rolled message could ship a grid that breaks
// every other player's renderer, so the Durable Object re-derives the grid
// from the placements and checks it independently.

export const WORD_COUNT = 10;      // what a hand-written scroll must have
const MIN_LEN = 3;
const MAX_LEN = 13;                // JEFFERSONCITY is thirteen
const MAX_DIM = 32;                // a fifty-word grid needs about thirty
const MAX_ENTRIES = 60;
const MAX_CLUE = 140;

// Minimal; swap in a real list if your dojos are ever public rather than
// invite-only.
const BLOCKED = [
  "cunt", "fag", "faggot", "kike", "nigger", "nigga", "retard", "spic", "tranny",
];

function hasBlocked(text) {
  const t = String(text).toLowerCase();
  return BLOCKED.some((w) => new RegExp(`\\b${w}`, "i").test(t));
}

const KEY = (r, c) => `${r},${c}`;

export function validatePuzzle(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "No puzzle supplied." };

  const title = String(input.title || "Untitled scroll").trim().slice(0, 60);
  if (hasBlocked(title)) return { ok: false, error: "That title can't be used." };

  const raw = Array.isArray(input.entries) ? input.entries : [];

  // A scroll from the archive may declare its own length; one written by a
  // player still has to be exactly ten, because the forge only builds ten.
  const fromArchive = input.theme === "america" || input.untimed === true;
  if (!fromArchive && raw.length !== WORD_COUNT)
    return { ok: false, error: `A scroll needs exactly ${WORD_COUNT} words. This one has ${raw.length}.` };
  if (fromArchive && (raw.length < WORD_COUNT || raw.length > MAX_ENTRIES))
    return { ok: false, error: `A scroll needs ${WORD_COUNT}–${MAX_ENTRIES} words. This one has ${raw.length}.` };

  const entries = [];
  const seen = new Set();

  for (const e of raw) {
    const answer = String(e?.answer || "").toUpperCase().replace(/[^A-Z]/g, "");
    const clue = String(e?.clue || "").trim();

    if (answer.length < MIN_LEN || answer.length > MAX_LEN)
      return { ok: false, error: `"${answer || "(blank)"}" must be ${MIN_LEN}–${MAX_LEN} letters.` };
    if (seen.has(answer)) return { ok: false, error: `"${answer}" appears twice.` };
    seen.add(answer);

    if (!clue) return { ok: false, error: `"${answer}" has no clue.` };
    if (clue.length > MAX_CLUE) return { ok: false, error: `The clue for "${answer}" is too long.` };
    if (hasBlocked(clue) || hasBlocked(answer))
      return { ok: false, error: `"${answer}" or its clue can't be used.` };

    const dir = e?.dir === "down" ? "down" : e?.dir === "across" ? "across" : null;
    if (!dir) return { ok: false, error: `"${answer}" has no direction.` };

    const row = Number(e?.row);
    const col = Number(e?.col);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0)
      return { ok: false, error: `"${answer}" sits outside the grid.` };

    const endR = row + (dir === "down" ? answer.length - 1 : 0);
    const endC = col + (dir === "across" ? answer.length - 1 : 0);
    if (endR >= MAX_DIM || endC >= MAX_DIM)
      return { ok: false, error: "The grid is larger than a dojo board allows." };

    entries.push({ answer, clue, dir, row, col });
  }

  // Rebuild the grid and check every shared cell is a genuine crossing.
  const cells = new Map();
  const crossings = entries.map(() => 0);

  for (let i = 0; i < entries.length; i++) {
    const { answer, row, col, dir } = entries[i];
    const dr = dir === "down" ? 1 : 0;
    const dc = dir === "across" ? 1 : 0;

    if (cells.get(KEY(row - dr, col - dc)) || cells.get(KEY(row + dr * answer.length, col + dc * answer.length)))
      return { ok: false, error: `"${answer}" runs straight into another word.` };

    for (let k = 0; k < answer.length; k++) {
      const r = row + dr * k;
      const c = col + dc * k;
      const cell = cells.get(KEY(r, c));

      if (cell) {
        if (cell.letter !== answer[k])
          return { ok: false, error: `"${answer}" clashes with "${cell.owner}" at one of its letters.` };
        if ((dir === "across" && cell.across) || (dir === "down" && cell.down))
          return { ok: false, error: `"${answer}" overlaps "${cell.owner}" instead of crossing it.` };
        crossings[i]++;
        crossings[cell.index]++;
        cells.set(KEY(r, c), {
          ...cell,
          across: cell.across || dir === "across",
          down: cell.down || dir === "down",
        });
      } else {
        const sideA = cells.get(KEY(r + dc, c + dr));
        const sideB = cells.get(KEY(r - dc, c - dr));
        if (sideA || sideB)
          return { ok: false, error: `"${answer}" runs alongside another word without crossing it.` };
        cells.set(KEY(r, c), {
          letter: answer[k],
          across: dir === "across",
          down: dir === "down",
          owner: answer,
          index: i,
        });
      }
    }
  }

  const orphan = crossings.findIndex((n) => n === 0);
  if (orphan !== -1)
    return { ok: false, error: `"${entries[orphan].answer}" doesn't cross any other word.` };

  // Every entry must be reachable from every other, or the grid is two
  // separate puzzles sharing a page.
  const adjacency = entries.map(() => new Set());
  for (const cell of cells.values()) void cell;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (sharesCell(entries[i], entries[j])) {
        adjacency[i].add(j);
        adjacency[j].add(i);
      }
    }
  }
  const seenNodes = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const n = stack.pop();
    for (const m of adjacency[n]) if (!seenNodes.has(m)) { seenNodes.add(m); stack.push(m); }
  }
  if (seenNodes.size !== entries.length)
    return { ok: false, error: "The grid breaks into disconnected pieces." };

  // Standard numbering, in reading order.
  const order = entries
    .map((e, i) => ({ ...e, i }))
    .sort((a, z) => a.row - z.row || a.col - z.col);
  const numbers = new Map();
  let n = 0;
  for (const e of order) {
    const k = KEY(e.row, e.col);
    if (!numbers.has(k)) numbers.set(k, ++n);
  }

  let rows = 0, cols = 0;
  const final = entries.map((e) => {
    const endR = e.row + (e.dir === "down" ? e.answer.length - 1 : 0);
    const endC = e.col + (e.dir === "across" ? e.answer.length - 1 : 0);
    rows = Math.max(rows, endR + 1);
    cols = Math.max(cols, endC + 1);
    const num = numbers.get(KEY(e.row, e.col));
    return {
      id: `${num}-${e.dir}`,
      num,
      dir: e.dir,
      row: e.row,
      col: e.col,
      len: e.answer.length,
      clue: e.clue,
      answer: e.answer,
    };
  }).sort((a, z) => a.num - z.num || (a.dir === "across" ? -1 : 1));

  const ids = new Set(final.map((e) => e.id));
  if (ids.size !== final.length)
    return { ok: false, error: "Two entries resolved to the same slot." };

  // Scrolls that score by progress rather than by the clock carry their own
  // terms. Anything the archive doesn't set is simply absent, and the round
  // falls back to the timed path.
  const terms = {};
  if (input.untimed === true) terms.untimed = true;
  if (Number.isFinite(input.perWord)) terms.perWord = Math.max(0, Math.round(input.perWord));
  if (Number.isFinite(input.finishBonus)) terms.finishBonus = Math.max(0, Math.round(input.finishBonus));
  if (Number.isFinite(input.bonusWithinMs)) terms.bonusWithinMs = Math.max(0, Math.round(input.bonusWithinMs));

  return { ok: true, puzzle: { title, rows, cols, entries: final, ...terms } };
}

function sharesCell(a, b) {
  const cellsOf = (e) => {
    const out = [];
    for (let k = 0; k < e.answer.length; k++)
      out.push(KEY(e.row + (e.dir === "down" ? k : 0), e.col + (e.dir === "across" ? k : 0)));
    return out;
  };
  const setA = new Set(cellsOf(a));
  return cellsOf(b).some((k) => setA.has(k));
}

/** What players are allowed to see: geometry and clues, never the letters. */
export function stripAnswers(puzzle) {
  return {
    title: puzzle.title,
    rows: puzzle.rows,
    cols: puzzle.cols,
    entries: puzzle.entries.map(({ answer, ...rest }) => rest),
  };
}

export function answerKey(puzzle) {
  const key = {};
  for (const e of puzzle.entries) key[e.id] = e.answer;
  return key;
}
