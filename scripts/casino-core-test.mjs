// node scripts/casino-core-test.mjs
import {
  SUITS, FINISH, HURDLES, BETS, betById, freshRace, raceTick, placings, betWins,
  handValue, isBlackjack, dealerShouldHit, settle, shuffled, MAX_SEATS,
} from "../src/casino-core.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };
const hand = (...rs) => rs.map((r) => ({ rank: r, suit: "spades", red: false }));

console.log("\nthe track");
ok("five hurdles, not seven", HURDLES === 5);
ok("seven steps to the line", FINISH === 7);

let ranAll = true, hurdlesOk = true, suitShown = true;
for (let i = 0; i < 400; i++) {
  const race = freshRace();
  let n = 0;
  while (!raceTick(race).done && n < 4000) n++;
  if (placings(race).length !== 4 || new Set(placings(race)).size !== 4) { ranAll = false; break; }
  if (race.hurdles.length > HURDLES) { hurdlesOk = false; break; }
  if (!race.hurdles.every((h) => !!h.suit && !!h.rank)) { suitShown = false; break; }
}
ok("four hundred races all rank the field", ranAll);
ok("the hurdle row never exceeds five", hurdlesOk);
ok("every turned hurdle records which suit it hit", suitShown);

console.log("\nthe slips");
const order = ["hearts", "spades", "clubs", "diamonds"];
const race = { at: { hearts: 7, spades: 4, clubs: 3, diamonds: 0 } };
ok("place pays on first or second", betWins("place", ["hearts"], order, race) && betWins("place", ["spades"], order, race));
ok("place refuses third", !betWins("place", ["clubs"], order, race));
ok("win pays only on first", betWins("win", ["hearts"], order, race));
ok("exacta needs the order", betWins("exacta", ["hearts", "spades"], order, race));
ok("exacta refuses the reverse", !betWins("exacta", ["spades", "hearts"], order, race));
ok("trifecta needs three", betWins("trifecta", ["hearts", "spades", "clubs"], order, race));
ok("superfecta needs all four", betWins("superfecta", order, order, race));

console.log("\nlong and short");
ok("long pays on a three-step win", betWins("long", ["hearts"], order, race));
ok("long refuses a narrow win",
  !betWins("long", ["hearts"], order, { at: { hearts: 7, spades: 6, clubs: 3, diamonds: 0 } }));
ok("long refuses a horse that didn't win", !betWins("long", ["spades"], order, race));
ok("short pays on a three-step collapse", betWins("short", ["diamonds"], order, race));
ok("short refuses a close last",
  !betWins("short", ["diamonds"], order, { at: { hearts: 7, spades: 4, clubs: 3, diamonds: 2 } }));
ok("short refuses a horse that wasn't last", !betWins("short", ["clubs"], order, race));
ok("both side bets pay fifty", betById("long").pays === 50 && betById("short").pays === 50);
ok("side bets are flagged as such", betById("long").side && betById("short").side);
ok("seven bet types in all", BETS.length === 7);

console.log("\nthe dealer");
ok("face cards are ten", handValue(hand("K", "Q")).total === 20);
ok("an ace fits when it can", handValue(hand("A", "9")).total === 20);
ok("and shrinks when it can't", handValue(hand("A", "9", "5")).total === 15);
ok("hits soft seventeen", dealerShouldHit(hand("A", "6")));
ok("stands on hard seventeen", !dealerShouldHit(hand("10", "7")));
ok("blackjack is two cards", isBlackjack(hand("A", "K")) && !isBlackjack(hand("5", "6", "10")));

console.log("\nsettling");
ok("bust loses a token", settle(hand("K", "Q", "5"), hand("10", "7")).token === -1);
ok("a win costs no token", settle(hand("10", "9"), hand("10", "8")).token === 0);
ok("a push costs no token", settle(hand("10", "9"), hand("10", "9")).result === "push");
ok("losing to blackjack costs a token", settle(hand("10", "9"), hand("A", "K")).token === -1);

console.log("\nthe shoe");
ok("one deck is 52", shuffled(1).length === 52);
ok("four decks is 208", shuffled(4).length === 208);
ok("a table seats twenty", MAX_SEATS === 20);


console.log("\nmove to earn");
{
  const { moveReward, STEPS_PER_REWARD, CASH_PER_REWARD, TOKENS_PER_REWARD, FAST_MULTIPLIER } =
    await import("../src/casino-core.js");

  ok("a hundred steps pays ten and two",
    moveReward(100).cash === 10 && moveReward(100).tokens === 2);
  ok("ninety-nine pays nothing yet", moveReward(99).cash === 0);
  ok("but the ninety-nine are kept", moveReward(99).remainder === 99);
  ok("two hundred pays double", moveReward(200).cash === 20 && moveReward(200).tokens === 4);
  ok("carried steps count toward the next hundred",
    moveReward(50, 0, 60).cash === CASH_PER_REWARD);
  ok("a quick pace is worth more",
    moveReward(0, 100).effective === 120 && moveReward(0, 100).cash === 10);
  ok("mixed cadence adds up",
    moveReward(50, 50).effective === 110);
  ok("the multiplier is 1.2", FAST_MULTIPLIER === 1.2);
  ok("the threshold is a hundred steps", STEPS_PER_REWARD === 100);
  ok("nothing is ever negative",
    moveReward(-500, -500, -500).cash === 0 && moveReward(-5).remainder === 0);
  ok("the remainder never reaches a whole reward",
    Array.from({ length: 300 }, (_, i) => moveReward(i).remainder).every((r) => r < 100));
  ok("a long walk pays proportionally",
    moveReward(1000).cash === 100 && moveReward(1000).tokens === 20);
}
console.log(bad ? `\n${bad} failing\n` : "\nall casino core checks passed\n");
process.exit(bad ? 1 : 0);
