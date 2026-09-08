// node scripts/puzzle-test.mjs
import { makePuzzle, scoreSolve, cashReward, MAX_AWARD, LIMIT_MS, FAST_MS } from "../src/puzzle.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

console.log("\npuzzles");
let wrong = 0;
for (let i = 0; i < 1000; i++) {
  const p = makePuzzle();
  const [a, op, b] = p.text.split(" ");
  const want = op === "+" ? Number(a) + Number(b) : Number(a) - Number(b);
  if (p.answer !== want || p.answer < 0) wrong++;
}
ok("a thousand puzzles all add up", wrong === 0);

console.log("\nwhat a solve is worth");
ok("instant solve pays the cap", scoreSolve(0).award === MAX_AWARD);
ok("five seconds still pays the cap", scoreSolve(5000).award === MAX_AWARD);
ok("nine seconds still pays the cap", scoreSolve(9000).award === MAX_AWARD);
ok("the bonus is flagged under ten", scoreSolve(9999).fast === true);
ok("and not at ten", scoreSolve(10_000).fast === false);
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
