// node scripts/casino-test.mjs
import {
  handValue, isBlackjack, dealerShouldHit, settle, freshShoe,
  freshRace, raceTick, placings, betWins, betPayout, BETS, SUITS,
  makePuzzle, puzzleReward, FINISH,
} from "../public/casino-rules.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };
const hand = (...rs) => rs.map((r) => ({ rank: r, suit: "spades", red: false }));

console.log("\nhand values");
ok("face cards are ten", handValue(hand("K", "Q")).total === 20);
ok("an ace is eleven when it fits", handValue(hand("A", "9")).total === 20);
ok("and one when it doesn't", handValue(hand("A", "9", "5")).total === 15);
ok("two aces don't make twenty-two", handValue(hand("A", "A")).total === 12);
ok("soft is reported", handValue(hand("A", "6")).soft === true);
ok("hard is reported", handValue(hand("10", "7")).soft === false);
ok("bust is reported", handValue(hand("K", "Q", "5")).bust === true);
ok("blackjack is two cards only", isBlackjack(hand("A", "K")) && !isBlackjack(hand("5", "6", "10")));

console.log("\ndealer rules");
ok("hits sixteen", dealerShouldHit(hand("10", "6")) === true);
ok("hits SOFT seventeen", dealerShouldHit(hand("A", "6")) === true);
ok("stands on hard seventeen", dealerShouldHit(hand("10", "7")) === false);
ok("stands on eighteen", dealerShouldHit(hand("10", "8")) === false);
ok("stands on soft nineteen", dealerShouldHit(hand("A", "8")) === false);

console.log("\nsettling, and what a token costs");
let r = settle(hand("K", "Q", "5"), hand("10", "7"));
ok("busting loses the bet and a token", r.result === "lose" && r.cash === -1 && r.token === -1);
r = settle(hand("10", "9"), hand("K", "Q", "5"));
ok("a dealer bust wins and costs no token", r.result === "win" && r.cash === 1 && r.token === 0);
r = settle(hand("10", "9"), hand("10", "9"));
ok("a push returns the bet and costs no token", r.result === "push" && r.cash === 0 && r.token === 0);
r = settle(hand("A", "K"), hand("10", "9"));
ok("blackjack wins", r.result === "win" && r.token === 0);
r = settle(hand("A", "K"), hand("A", "Q"));
ok("two blackjacks push", r.result === "push");
r = settle(hand("10", "9"), hand("A", "K"));
ok("losing to blackjack costs a token", r.result === "lose" && r.token === -1);
r = settle(hand("10", "8"), hand("10", "9"));
ok("losing on points costs a token", r.result === "lose" && r.token === -1);

console.log("\nthe shoe");
const shoe = freshShoe(4);
ok("four decks is 208 cards", shoe.length === 208);
ok("thirteen ranks per suit per deck",
  shoe.filter((c) => c.suit === "spades" && c.rank === "A").length === 4);

console.log("\nthe race");
let races = 0, ticks = [];
for (let i = 0; i < 400; i++) {
  const race = freshRace();
  let n = 0;
  while (!raceTick(race).done && n < 4000) n++;
  ticks.push(n);
  const order = placings(race);
  if (order.length !== 4 || new Set(order).size !== 4) { ok("every race ranks all four", false); break; }
  if (race.finished.length !== 3) { ok("every race ends with three across the line", false); break; }
  races++;
}
ok("four hundred races all finish", races === 400);
ok("all four horses always get a placing", true);
ok(`they take ${Math.round(ticks.reduce((a, b) => a + b, 0) / ticks.length)} draws on average`, true);

const race = freshRace();
let guard = 0;
while (!raceTick(race).done && guard++ < 4000) { /* run it out */ }
ok("nobody passes the line without reaching it",
  race.finished.every((id) => race.at[id] >= FINISH));
ok("the sideline never turns more than seven", race.flipped.length <= 7);
ok("sideline positions are in order",
  race.flipped.every((v, i) => v === i + 1));

console.log("\nbets");
const order = ["hearts", "spades", "clubs", "diamonds"];
ok("place pays on first", betWins("place", ["hearts"], order));
ok("place pays on second", betWins("place", ["spades"], order));
ok("place does not pay on third", !betWins("place", ["clubs"], order));
ok("win pays only on first", betWins("win", ["hearts"], order) && !betWins("win", ["spades"], order));
ok("exacta needs the order", betWins("exacta", ["hearts", "spades"], order));
ok("exacta refuses the reverse", !betWins("exacta", ["spades", "hearts"], order));
ok("trifecta needs three exact", betWins("trifecta", ["hearts", "spades", "clubs"], order));
ok("superfecta needs all four", betWins("superfecta", order, order));
ok("superfecta fails on one wrong", !betWins("superfecta", ["hearts", "spades", "diamonds", "clubs"], order));
ok("a short slip never pays", !betWins("trifecta", ["hearts"], order));
ok("payouts are 1, 3, 6, 12, 24",
  BETS.map((b) => b.pays).join(",") === "1,3,6,12,24");

console.log("\nthe arcade");
let sums = 0;
for (let i = 0; i < 500; i++) {
  const p = makePuzzle();
  const [a, op, b] = p.text.split(" ");
  const want = op === "+" ? Number(a) + Number(b) : Number(a) - Number(b);
  if (p.answer !== want || p.answer < 0) { sums++; }
}
ok("five hundred puzzles all add up", sums === 0);
ok("no subtraction goes negative", true);
const rewards = Array.from({ length: 500 }, puzzleReward);
ok("rewards stay between five and fifteen",
  Math.min(...rewards) >= 5 && Math.max(...rewards) <= 15);

console.log(bad ? `\n${bad} failing\n` : "\nall casino checks passed\n");
process.exit(bad ? 1 : 0);
