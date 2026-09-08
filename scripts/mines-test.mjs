// node scripts/mines-test.mjs
import {
  LEVELS, levelById, makeBoard, reveal, openingFor, progressOf,
  mineScore, isMine, key,
} from "../src/minesweeper.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

console.log("\nboard generation");
for (const level of LEVELS) {
  const b = makeBoard(level.id);
  const named = `${level.name}:`;
  ok(`${named} builds`, !!b);
  ok(`${named} has the right mine count`, b.mineList.length === level.mines);
  ok(`${named} mines are all distinct`, new Set(b.mineList).size === level.mines);
  ok(`${named} safe count adds up`, b.safeTotal === level.rows * level.cols - level.mines);
  ok(`${named} every mine is on the board`, b.mineList.every((m) => {
    const [r, c] = m.split(",").map(Number);
    return r >= 0 && c >= 0 && r < level.rows && c < level.cols;
  }));
  ok(`${named} the opening is empty ground`, b.counts[b.start] === 0);
  ok(`${named} the opening is not a mine`, !isMine(b, b.start));
}

console.log("\nneighbour counts");
const b = makeBoard("intermediate");
let countsRight = true;
for (const cell of Object.keys(b.counts)) {
  const [r, c] = cell.split(",").map(Number);
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    if (isMine(b, key(r + dr, c + dc))) n++;
  }
  if (n !== b.counts[cell]) { countsRight = false; break; }
}
ok("every square counts its own neighbours correctly", countsRight);
ok("mines carry no count", b.mineList.every((m) => b.counts[m] === undefined));

console.log("\nrevealing");
const open = openingFor(b);
ok("the opening uncovers more than one square", Object.keys(open).length > 1);
ok("the opening never contains a mine", Object.keys(open).every((c) => !isMine(b, c)));
ok("everyone gets the same opening",
  JSON.stringify(Object.keys(openingFor(b)).sort()) === JSON.stringify(Object.keys(open).sort()));

const mine = b.mineList[0];
const boom = reveal(b, {}, mine);
ok("stepping on a mine is reported", boom.hitMine === true);
ok("a mine reveals only itself", Object.keys(boom.cells).length === 1);

const revealed = { ...open };
const again = reveal(b, revealed, b.start);
ok("re-clicking a known square does nothing", Object.keys(again.cells).length === 0);

console.log("\nwinning");
const small = makeBoard("beginner");
const all = {};
for (let r = 0; r < small.rows; r++) {
  for (let c = 0; c < small.cols; c++) {
    const cell = key(r, c);
    if (isMine(small, cell)) continue;
    const res = reveal(small, all, cell);
    Object.assign(all, res.cells);
    if (res.won) break;
  }
}
ok("clearing every safe square wins", Object.keys(all).length === small.safeTotal);
ok("progress reaches one", progressOf(small, all) === 1);

console.log("\nscoring");
ok("a fast clear beats a slow one",
  mineScore({ won: true, elapsedMs: 30_000, level: "beginner" }) >
  mineScore({ won: true, elapsedMs: 500_000, level: "beginner" }));
ok("any clear beats any failure",
  mineScore({ won: true, elapsedMs: 599_000, level: "beginner" }) >
  mineScore({ won: false, progress: 0.99, level: "beginner" }));
ok("a part-cleared board still pays", mineScore({ won: false, progress: 0.5 }) > 0);
ok("touching nothing pays nothing", mineScore({ won: false, progress: 0 }) === 0);
ok("harder boards pay more",
  mineScore({ won: true, elapsedMs: 60_000, level: "expert" }) >
  mineScore({ won: true, elapsedMs: 60_000, level: "beginner" }));
ok("scores stay within 0-100",
  mineScore({ won: true, elapsedMs: 0, level: "expert" }) <= 100 &&
  mineScore({ won: false, progress: 1, level: "expert" }) <= 55);

console.log(bad ? `\n${bad} failing\n` : "\nall minesweeper checks passed\n");
process.exit(bad ? 1 : 0);
