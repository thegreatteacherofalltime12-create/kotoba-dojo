// node scripts/boost-test.mjs
//
// The Apply Token tab's server half. Without a service account nothing can
// be read, so every player "holds" nothing — which is exactly the refusals
// worth checking. The tab's client half is exercised by opening a game.
import { tokensReply, heldTokens } from "../src/boost.js";
import { TOKEN_ITEMS, TOKEN_PRICE, tokenItem } from "../public/boost.js";
import { TOKEN_GAMES, TOKEN_PRICE as SERVER_PRICE } from "../src/firestore.js";

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

console.log(bad ? `\n${bad} failing\n` : "\nall boost checks passed\n");
process.exit(bad ? 1 : 0);
