// node scripts/boost-test.mjs
//
// The Apply Token tab's server half. Without a service account nothing can
// be read, so every player "holds" nothing — which is exactly the refusals
// worth checking. The tab's client half is exercised by opening a game.
import { tokensReply, heldTokens } from "../src/boost.js";
import { TOKEN_ITEMS, TOKEN_PRICE, tokenItem } from "../public/boost.js";
import { TOKEN_GAMES, TOKEN_PRICE as SERVER_PRICE, priceOf } from "../src/firestore.js";
import { MULTIPLIERS } from "../src/mmr.js";
import { MULTIPLIER_ITEMS } from "../public/boost.js";

let bad = 0;
const ok = (label, cond) => {
  console.log(`${cond ? "  pass" : "  FAIL"}  ${label}`);
  if (!cond) bad++;
};

console.log("\nthe list the shop and the tab share");
ok("one token for every game the server sells", TOKEN_ITEMS.map((t) => t.game).join() === TOKEN_GAMES.join());
ok("the price on both sides agrees", TOKEN_PRICE === SERVER_PRICE);
ok("an unknown game falls back rather than crashing the tab", tokenItem("nope").game === "crossword");

console.log("\nasking what is held");
const env = {};
ok("no account reads as nothing held, never a throw", JSON.stringify(await heldTokens(env, "u1")) === "{}");
let r = await tokensReply(env, "u1", "crossword", { applied: {}, over: false, apply: false });
ok("a look is not an apply", r.applied === false && r.error === null && r.changed === false);
ok("the reply names the game", r.game === "crossword" && typeof r.tokens === "object");

console.log("\napplying");
const applied = {};
r = await tokensReply(env, "u1", "crossword", { applied, over: false, apply: true });
ok("holding none is refused, pointing at the shop", r.error?.includes("Token shop") && r.applied === false && !applied.u1);
ok("nothing to persist after a refusal", r.changed === false);
r = await tokensReply(env, "u1", "battleship", { applied: {}, over: true, apply: true });
ok("a finished room refuses first", r.error?.includes("over"));
const already = { u1: true };
r = await tokensReply(env, "u1", "links", { applied: already, over: true, apply: true });
ok("already applied stays applied, even once the round is over", r.applied === true && r.error === null && r.changed === false);
r = await tokensReply(env, "u2", "links", { applied: already, over: false, apply: false });
ok("one player's apply is not another's", r.applied === false);

console.log("\nthe multipliers");
{
  ok("the shop and the tab sell the same five",
    MULTIPLIER_ITEMS.map((m) => m.key).join() === MULTIPLIERS.map((m) => m.key).join());
  ok("at the same prices on both sides",
    MULTIPLIER_ITEMS.every((m, i) => m.price === MULTIPLIERS[i].price && m.mult === MULTIPLIERS[i].mult));
  ok("and the server will sell them", MULTIPLIERS.every((m) => priceOf(m.key) === m.price));

  // Nothing is held here — no service account — so these are the refusals.
  const seat = {};
  let m = await tokensReply(env, "u1", "prix", { applied: seat, over: false, apply: true, key: "mx3" });
  ok("holding none is refused, and says which one", /3\u00d7 multiplier/.test(m.error) && !seat.u1);
  m = await tokensReply(env, "u1", "prix", { applied: {}, over: false, apply: true, key: "mx9" });
  ok("an invented tier is not a tier", m.error === "No such token.");
  m = await tokensReply(env, "u1", "prix", { applied: {}, over: false, apply: true, key: "bs_nuke" });
  ok("nor is an arsenal token", m.error === "No such token.");

  // What a room that already has one applied reads back.
  const done = { u1: "mx4" };
  m = await tokensReply(env, "u1", "buzzer", { applied: done, over: false, apply: false });
  ok("a round carries what was applied to it", m.applied === true && m.appliedKey === "mx4" && m.mult === 4);
  m = await tokensReply(env, "u1", "buzzer", { applied: done, over: false, apply: true, key: "mx6" });
  ok("and will not take a second one on top", m.appliedKey === "mx4" && m.mult === 4 && m.changed === false);

  const boost = { u2: "buzzer" };
  m = await tokensReply(env, "u2", "buzzer", { applied: boost, over: false, apply: false });
  ok("a game's own boost reads back as a boost", m.applied === true && m.appliedKey === "buzzer" && m.mult === 1.5);
}

console.log(bad ? `\n${bad} failing\n` : "\nall boost checks passed\n");
process.exit(bad ? 1 : 0);
