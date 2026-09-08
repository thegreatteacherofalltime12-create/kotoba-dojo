// Greedy interlock with restarts. Runs in the browser while a sensei types
// their words, and in Node when seeding the puzzle bank.
//
// Ten words chosen freely will not always interlock. When they can't, this
// returns null along with the word that could not be placed, so the UI can
// say which one to swap.

const KEY = (r, c) => `${r},${c}`;

function canPlace(cells, word, row, col, dir) {
  const dr = dir === "down" ? 1 : 0;
  const dc = dir === "across" ? 1 : 0;
  let crossings = 0;

  // The cell immediately before and after must be empty, or we'd silently
  // extend an existing word.
  const before = cells.get(KEY(row - dr, col - dc));
  const after = cells.get(KEY(row + dr * word.length, col + dc * word.length));
  if (before || after) return null;

  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const cell = cells.get(KEY(r, c));

    if (cell) {
      if (cell.letter !== word[i]) return null;
      // Two words may only share a cell by crossing, never by overlapping.
      if (dir === "across" && cell.across) return null;
      if (dir === "down" && cell.down) return null;
      crossings++;
    } else {
      // An empty cell must not sit alongside another word, or the two read
      // together as one nonsense entry.
      const sideA = cells.get(KEY(r + dc, c + dr));
      const sideB = cells.get(KEY(r - dc, c - dr));
      if (sideA || sideB) return null;
    }
  }
  return crossings;
}

function commit(cells, placement) {
  const { answer, row, col, dir } = placement;
  const dr = dir === "down" ? 1 : 0;
  const dc = dir === "across" ? 1 : 0;
  for (let i = 0; i < answer.length; i++) {
    const k = KEY(row + dr * i, col + dc * i);
    const cell = cells.get(k) || { letter: answer[i], across: false, down: false };
    cell.letter = answer[i];
    if (dir === "across") cell.across = true;
    else cell.down = true;
    cells.set(k, cell);
  }
}

function bounds(placements) {
  let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
  for (const p of placements) {
    const endR = p.row + (p.dir === "down" ? p.answer.length - 1 : 0);
    const endC = p.col + (p.dir === "across" ? p.answer.length - 1 : 0);
    minR = Math.min(minR, p.row);
    minC = Math.min(minC, p.col);
    maxR = Math.max(maxR, endR);
    maxC = Math.max(maxC, endC);
  }
  return { minR, minC, rows: maxR - minR + 1, cols: maxC - minC + 1 };
}

function attempt(order) {
  const cells = new Map();
  const placed = [];

  const first = order[0];
  placed.push({ ...first, row: 0, col: 0, dir: "across" });
  commit(cells, placed[0]);

  for (let i = 1; i < order.length; i++) {
    const word = order[i];
    let best = null;

    for (const anchor of placed) {
      const dir = anchor.dir === "across" ? "down" : "across";
      for (let a = 0; a < anchor.answer.length; a++) {
        for (let w = 0; w < word.answer.length; w++) {
          if (anchor.answer[a] !== word.answer[w]) continue;

          const anchorR = anchor.row + (anchor.dir === "down" ? a : 0);
          const anchorC = anchor.col + (anchor.dir === "across" ? a : 0);
          const row = dir === "down" ? anchorR - w : anchorR;
          const col = dir === "across" ? anchorC - w : anchorC;

          const crossings = canPlace(cells, word.answer, row, col, dir);
          if (crossings === null || crossings === 0) continue;

          const trial = [...placed, { ...word, row, col, dir }];
          const b = bounds(trial);
          // Prefer more interlock, then a tighter, squarer grid.
          const score =
            crossings * 12 - (b.rows + b.cols) - Math.abs(b.rows - b.cols) * 2;
          if (!best || score > best.score) best = { row, col, dir, score };
        }
      }
    }

    if (!best) return { ok: false, stuck: word.answer };
    const placement = { ...word, row: best.row, col: best.col, dir: best.dir };
    placed.push(placement);
    commit(cells, placement);
  }

  return { ok: true, placed };
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Assigns standard crossword numbering and shifts the grid to the origin. */
export function normalize(placed) {
  const b = bounds(placed);
  const shifted = placed.map((p) => ({
    ...p,
    row: p.row - b.minR,
    col: p.col - b.minC,
  }));

  const starts = [...shifted].sort((a, z) => a.row - z.row || a.col - z.col);
  const numbers = new Map();
  let n = 0;
  for (const p of starts) {
    const k = KEY(p.row, p.col);
    if (!numbers.has(k)) numbers.set(k, ++n);
  }

  const entries = shifted
    .map((p) => ({
      id: `${numbers.get(KEY(p.row, p.col))}-${p.dir}`,
      num: numbers.get(KEY(p.row, p.col)),
      dir: p.dir,
      row: p.row,
      col: p.col,
      len: p.answer.length,
      clue: p.clue,
      answer: p.answer,
    }))
    .sort((a, z) => a.num - z.num || (a.dir === "across" ? -1 : 1));

  return { rows: b.rows, cols: b.cols, entries };
}

/**
 * @param {{answer: string, clue: string}[]} words
 * @returns {{ok: true, grid: object} | {ok: false, stuck: string}}
 */
export function buildLayout(words, tries = 400) {
  const list = words.map((w) => ({
    answer: String(w.answer).toUpperCase().replace(/[^A-Z]/g, ""),
    clue: String(w.clue || "").trim(),
  }));

  const byLength = [...list].sort((a, z) => z.answer.length - a.answer.length);
  let lastStuck = null;

  for (let t = 0; t < tries; t++) {
    const order = t === 0 ? byLength : shuffled(list);
    const res = attempt(order);
    if (res.ok) return { ok: true, grid: normalize(res.placed) };
    lastStuck = res.stuck;
  }
  return { ok: false, stuck: lastStuck };
}
