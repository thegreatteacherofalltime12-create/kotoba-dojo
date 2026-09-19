// node scripts/puzzle-test.mjs
import { makePuzzle, scoreSolve, cashReward, MAX_AWARD, LIMIT_MS, FAST_MS } from "../src/puzzle.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

console.log("\npuzzles");
let wrong = 0;
const grades = {};
const seen = new Set();
for (let i = 0; i < 1000; i++) {
  const p = makePuzzle();
  const [a, op, b] = p.text.split(" ");
  if (p.grade === 2) seen.add(op);
  const want = op === "+" ? Number(a) + Number(b) : op === "×" ? Number(a) * Number(b) : Number(a) - Number(b);
  if (p.answer !== want || p.answer < 0 || p.answer > 100) wrong++;
  grades[p.grade] = (grades[p.grade] || 0) + 1;
}
ok("a thousand puzzles all add up, none past a hundred", wrong === 0);
ok("first and second grade both turn up, roughly half each", grades[1] > 350 && grades[2] > 350);
ok("second grade has sums, differences and tables", ["+", "−", "×"].every((o) => seen.has(o)));

console.log("\nwhat a solve is worth");
ok("instant solve pays the cap", scoreSolve(0).award === MAX_AWARD);
ok("five seconds still pays the cap", scoreSolve(5000).award === MAX_AWARD);
ok("six seconds still pays the cap", scoreSolve(6000).award === MAX_AWARD);
ok("nine seconds no longer does", scoreSolve(9000).award < MAX_AWARD);
ok("the bonus is flagged under seven", scoreSolve(6999).fast === true);
ok("and not at seven", scoreSolve(7_000).fast === false);
ok("seven is the window", FAST_MS === 7_000);
ok("ten seconds pays two thirds", scoreSolve(10_000).award === 33);
ok("fifteen pays half", scoreSolve(15_000).award === 25);
ok("twenty pays a third", scoreSolve(20_000).award === 17);
ok("twenty-nine pays almost nothing", scoreSolve(29_000).award === 2);
ok("thirty pays nothing", scoreSolve(LIMIT_MS).award === 0);
ok("beyond thirty pays nothing", scoreSolve(60_000).award === 0);
ok("nothing is ever negative", scoreSolve(999_999).award === 0);
ok("nothing ever exceeds the cap",
  Array.from({ length: 400 }, (_, i) => scoreSolve(i * 100).award).every((a) => a <= MAX_AWARD));
ok("expiry is reported", scoreSolve(LIMIT_MS).expired === true && scoreSolve(1000).expired === false);

console.log("\nthe curve falls the whole way");
let last = Infinity, monotonic = true;
for (let t = FAST_MS; t <= LIMIT_MS; t += 500) {
  const a = scoreSolve(t).award;
  if (a > last) { monotonic = false; break; }
  last = a;
}
ok("after the bonus window it only ever falls", monotonic);

console.log("\ncasino cash");
const cash = Array.from({ length: 500 }, cashReward);
ok("cash stays between five and fifteen", Math.min(...cash) >= 5 && Math.max(...cash) <= 15);

console.log(bad ? `\n${bad} failing\n` : "\nall puzzle checks passed\n");
process.exit(bad ? 1 : 0);
