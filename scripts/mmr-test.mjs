// node scripts/mmr-test.mjs
import {
  beltFor, challengeBonus, seedBonus, sessionGain, fieldMmrFor, canPrestige,
  BLACK_BELT, COMPLETION_BONUS, PRESTIGE_COST, boosted, BOOST_MULT,
  MULTIPLIERS, multFor, boostedBy, isMultiplier,
} from "../src/mmr.js";

let bad = 0;
const ok = (label, cond) => {
  console.log(`${cond ? "  pass" : "  FAIL"}  ${label}`);
  if (!cond) bad++;
};

console.log("\nbelt thresholds");
for (const [mmr, want] of [
  [0, "Unranked"], [1, "White"], [199, "White"], [200, "Yellow"], [399, "Yellow"],
  [400, "Orange"], [599, "Orange"], [600, "Green"], [874, "Green"], [875, "Blue"],
  [1199, "Blue"], [1200, "Purple"], [1524, "Purple"], [1525, "Brown"],
  [2599, "Brown"], [2600, "Black"], [99999, "Black"],
]) ok(`${mmr} is ${want}`, beltFor(mmr).name === want);
ok("black belt sits at 2600", BLACK_BELT === 2600);

console.log("\nchallenge bonus");
ok("no bonus against a weaker field", challengeBonus(1200, 400) === 0);
ok("no bonus against an equal field", challengeBonus(800, 800) === 0);
ok("small bonus just above you", challengeBonus(800, 900) === 2);
ok("half the span pays about half", challengeBonus(400, 800) === 8);
ok("full span pays the cap", challengeBonus(0, 800) === 15);
ok("beyond the span still caps at 15", challengeBonus(0, 5000) === 15);
ok("never negative", challengeBonus(2600, 0) === 0);

console.log("\nseed bonus");
ok("seeded top has nothing to beat", seedBonus(1, 1) === 0);
ok("finishing below your seed pays nothing", seedBonus(3, 5) === 0);
ok("matching your seed pays nothing", seedBonus(4, 4) === 0);
ok("last seed winning takes the cap", seedBonus(8, 1) === 10);
ok("climbing part way pays part", seedBonus(5, 3) === 5);
ok("missing numbers are safe", seedBonus(null, 2) === 0);

console.log("\nsession gain");
let g = sessionGain({ score: 72, completed: true, playerMmr: 400, fieldMmr: 800 });
ok("base is the match score", g.base === 72);
ok("challenge bonus applied", g.challenge === 8);
ok("completion bonus applied", g.completion === COMPLETION_BONUS);
ok("total adds up", g.total === 72 + 8 + 15);

g = sessionGain({ score: 0, completed: false, playerMmr: 2000, fieldMmr: 100 });
ok("a bad round never costs MMR", g.total === 0);

g = sessionGain({ score: -50, completed: false });
ok("a negative score cannot drag MMR down", g.total === 0);

g = sessionGain({ score: 40, completed: true, mode: "rumble", seed: 6, placement: 1 });
ok("rumble pays flat completion", g.completion === 15);
ok("rumble pays for beating the seed", g.seed === 10);
ok("rumble skips the challenge bonus", g.challenge === 0);
ok("rumble total adds up", g.total === 40 + 15 + 10);

g = sessionGain({ score: 55, completed: false, playerMmr: 0, fieldMmr: 800 });
ok("unfinished still earns the challenge bonus", g.challenge === 15);
ok("unfinished earns no completion bonus", g.completion === 0);

console.log("\nfield strength");
ok("field excludes the player",
  fieldMmrFor("a", { a: 3000, b: 200, c: 400 }) === 300);
ok("a solo player faces no field", fieldMmrFor("a", { a: 900 }) === 0);

console.log("\nprestige");
ok("not eligible one short of the cost", canPrestige(PRESTIGE_COST - 1) === false);
ok("eligible at exactly the cost", canPrestige(PRESTIGE_COST) === true);
ok("eligible above the cost", canPrestige(PRESTIGE_COST + 6000) === true);
ok("black belt alone is not enough", canPrestige(BLACK_BELT) === false);

console.log("\nboost tokens");
ok("half again, rounded", boosted(100) === 150 && boosted(95) === 143 && boosted(0) === 0);
ok("the multiplier is one and a half", BOOST_MULT === 1.5);

console.log("\nthe multipliers above it");
{
  // The shop's promise, written down: five tiers, these multipliers, these
  // prices. If somebody re-prices one, this is the line that argues.
  const want = [[2, 5000], [3, 8000], [4, 12000], [5, 15000], [6, 20000]];
  ok("five tiers, from double to six times", MULTIPLIERS.length === 5);
  ok("each one multiplies and costs what the shop says",
    MULTIPLIERS.every((m, i) => m.mult === want[i][0] && m.price === want[i][1]));
  ok("keyed so a token can be told from a game", MULTIPLIERS.every((m) => m.key === `mx${m.mult}`));
  // Never cheaper per multiple as the tier climbs, or the big one would be
  // the only one anybody bought. The 4x and the 5x are level at $3,000 a
  // multiple, so the 5x is bought for the size of the single hit rather than
  // for value — which is a pricing choice, not an accident of arithmetic.
  const each = MULTIPLIERS.map((m) => m.price / m.mult);
  ok(`the big tiers are never better value (${each.map((n) => Math.round(n)).join(", ")} a multiple)`,
    each.every((n, i) => i === 0 || n >= each[i - 1]));

  ok("a tier multiplies by its tier", boostedBy(100, "mx2") === 200 && boostedBy(100, "mx6") === 600);
  ok("and rounds like the boost does", boostedBy(95, "mx3") === 285 && boostedBy(0, "mx4") === 0);
  ok("a game's own token is still the boost", boostedBy(100, "crossword") === 150 && multFor("prix") === BOOST_MULT);
  ok("and so is anything unrecognised, so a round never pays less for a token",
    boostedBy(100, "nonsense") === 150 && boostedBy(100, null) === 150);
  ok("a multiplier knows itself, and a game is not one",
    isMultiplier("mx5") && !isMultiplier("crossword") && !isMultiplier("bs_nuke"));
}

console.log(bad ? `\n${bad} failing\n` : "\nall MMR checks passed\n");
process.exit(bad ? 1 : 0);
