// node scripts/ai-test.mjs
import { chooseShots, remember, freshMemory, DIFFICULTIES } from "../src/ai.js";
import { SIZE, validateFleet, randomFleet, fireAt, fleetSunk } from "../src/battleship.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

/** Play one AI against one random fleet; return how many shots it needed. */
function solve(difficulty) {
  const board = { ships: validateFleet(randomFleet()).ships, incoming: [] };
  const mem = freshMemory();
  let shots = 0;
  while (!fleetSunk(board) && shots < SIZE * SIZE) {
    for (const cell of chooseShots(mem, SIZE, difficulty, 2)) {
      const res = fireAt(board, cell);
      remember(mem, cell, res.result);
      shots++;
      if (fleetSunk(board)) break;
    }
  }
  return shots;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const runs = 300;

console.log("\nbasic behaviour");
let mem = freshMemory();
let picked = chooseShots(mem, SIZE, "hard", 2);
ok("two shots come back", picked.length === 2);
ok("the two differ", picked[0] !== picked[1]);

mem = freshMemory();
for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
  if (!(r === 4 && c === 4)) remember(mem, `${r},${c}`, "miss");
}
ok("it never fires at the same square twice",
  chooseShots(mem, SIZE, "hard", 2)[0] === "4,4");

mem = freshMemory();
remember(mem, "5,5", "hit");
const follow = chooseShots(mem, SIZE, "medium", 1)[0];
ok("after a hit it works outward from it",
  ["4,5", "6,5", "5,4", "5,6"].includes(follow));

mem = freshMemory();
remember(mem, "5,5", "hit");
remember(mem, "5,6", "hit");
const line = chooseShots(mem, SIZE, "hard", 1)[0];
ok("two in a row makes it read the line", ["5,4", "5,7"].includes(line));

mem = freshMemory();
remember(mem, "5,5", "hit");
remember(mem, "5,6", "sunk");
ok("a sinking clears that ship's trail", mem.active.length === 0);

mem = freshMemory();
remember(mem, "1,1", "hit");   // a second ship, wounded elsewhere
remember(mem, "5,5", "hit");
remember(mem, "5,6", "sunk");
ok("a sinking leaves other wounded ships on the list",
  mem.active.length === 1 && mem.active[0] === "1,1");

console.log(`\nstrength over ${runs} games each (fewer shots is stronger)`);
const scores = {};
for (const d of DIFFICULTIES) {
  const runsOut = Array.from({ length: runs }, () => solve(d.id));
  scores[d.id] = mean(runsOut);
  console.log(`  ${d.name.padEnd(7)} average ${scores[d.id].toFixed(1)} shots to clear the board`);
}
ok("medium beats easy", scores.medium < scores.easy);
ok("hard beats medium", scores.hard < scores.medium);
ok("easy is genuinely poor (over 70 shots)", scores.easy > 70);
ok("hard is strong but not perfect (17 shots is the floor)", scores.hard > 17 && scores.hard < 62);

console.log(bad ? `\n${bad} failing\n` : "\nall AI checks passed\n");
process.exit(bad ? 1 : 0);
