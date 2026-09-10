// node scripts/casino-core-test.mjs
import {
  SUITS, FINISH, HURDLES, BETS, betById, freshRace, raceTick, placings, betWins,
  handValue, isBlackjack, dealerShouldHit, settle, shuffled, MAX_SEATS, HORSES,
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
  if (placings(race).length !== HORSES.length || new Set(placings(race)).size !== HORSES.length) { ranAll = false; break; }
  if (race.hurdles.length > HURDLES) { hurdlesOk = false; break; }
  if (!race.hurdles.every((h) => !!h.suit && !!h.rank)) { suitShown = false; break; }
}
ok("four hundred races all rank the whole field", ranAll);
ok("the hurdle row never exceeds five", hurdlesOk);
ok("every turned hurdle records which suit it hit", suitShown);

console.log("\nthe slips");
const order = ["king", "queen", "jack", "ten", "nine", "eight", "seven"];
const race = {
  at: { king: 7, queen: 4, jack: 3, ten: 3, nine: 3, eight: 3, seven: 0 },
  leadMargin: 3,
};
ok("place pays on first or second", betWins("place", ["king"], order, race) && betWins("place", ["queen"], order, race));
ok("place refuses third", !betWins("place", ["jack"], order, race));
ok("win pays only on first", betWins("win", ["king"], order, race));
ok("exacta needs the order", betWins("exacta", ["king", "queen"], order, race));
ok("exacta refuses the reverse", !betWins("exacta", ["queen", "king"], order, race));
ok("trifecta needs three", betWins("trifecta", ["king", "queen", "jack"], order, race));
ok("superfecta needs all four", betWins("superfecta", order.slice(0, 4), order, race));

console.log("\nlong and short");
ok("long pays on a three-step win", betWins("long", ["king"], order, race));
ok("long refuses a narrow win",
  !betWins("long", ["king"], order, { ...race, leadMargin: 1 }));
ok("long refuses a horse that didn't win", !betWins("long", ["queen"], order, race));
ok("short pays on a three-step collapse", betWins("short", ["seven"], order, race));
ok("short refuses a close last",
  !betWins("short", ["seven"], order, { ...race, at: { ...race.at, eight: 2 } }));
ok("short refuses a horse that wasn't last", !betWins("short", ["eight"], order, race));
ok("the side bets are priced apart", betById("long").pays === 100 && betById("short").pays === 50);
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

console.log(bad ? `\n${bad} failing\n` : "\nall casino core checks passed\n");
process.exit(bad ? 1 : 0);
