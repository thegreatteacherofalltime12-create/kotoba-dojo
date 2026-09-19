// node scripts/moderation-test.mjs
//
// What may be said. The free filter, the reading of the model's verdict,
// and the whole thing with the model absent (a bare env) and stubbed.
import { screen, normalize, verdictFromGuard, moderate, STRIKES_TO_BAR } from "../src/moderation.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

console.log("\nthe filter");
ok("ordinary talk passes", screen("gg, good game everyone").ok && screen("anyone up for battleship?").ok);
ok("a link is refused", !screen("look at this https://example.com/pic").ok && !screen("see example.com").ok && !screen("cat.jpg").ok);
ok("sexual vocabulary is refused", !screen("send nudes").ok && !screen("watch p0rn with me").ok);
ok("hateful vocabulary is refused", !screen("kys loser").ok);
ok("leet-speak and stretching do not slip past", !screen("s3nd nud3s").ok && !screen("p0rnnnnn").ok);
ok("a word inside another word is not a hit", screen("I live in Scunthorpe and play at dusk").ok && screen("the assassin's creed").ok);
ok("normalising reads through the tricks", normalize("S3xy!!!") === "sexy" && normalize("3 wins today") === "wins today");
ok("a number on its own is left alone", screen("3 wins today, 0 losses").ok);
ok("the reason is named", screen("send nudes").reason === "sexual content" && /links/.test(screen("http://x.y").reason));
ok("three strikes", STRIKES_TO_BAR === 3);

console.log("\nthe model's verdict");
ok("safe is safe", verdictFromGuard({ response: "safe" }).ok && verdictFromGuard("safe").ok);
ok("unsafe with a category the arena polices is refused", !verdictFromGuard({ response: "unsafe\nS12" }).ok && verdictFromGuard({ response: "unsafe\nS12" }).reason === "sexual content");
ok("hate and threats too", !verdictFromGuard("unsafe\nS10").ok && !verdictFromGuard("unsafe\nS1").ok);
ok("a category the arena does not police passes", verdictFromGuard("unsafe\nS6").ok && verdictFromGuard("unsafe\nS13").ok);
ok("nothing at all passes", verdictFromGuard(null).ok && verdictFromGuard({}).ok);

console.log("\nboth layers");
const q = console.error; console.error = () => {};
ok("with no model bound the filter alone decides", (await moderate({}, "hello there")).ok && !(await moderate({}, "send nudes")).ok);
const stub = (response) => ({ AI: { run: async () => ({ response }) } });
ok("the model can refuse what the filter let through", !(await moderate(stub("unsafe\nS10"), "you people are subhuman")).ok);
ok("and pass what it should", (await moderate(stub("safe"), "nice shot")).ok);
const slow = { AI: { run: () => new Promise(() => {}) } };
const t0 = Date.now();
const late = await moderate(slow, "hello");
ok("a model that never answers does not silence the arena", late.ok && late.layer === "filter" && Date.now() - t0 < 5000);
const broken = { AI: { run: async () => { throw new Error("boom"); } } };
ok("nor does one that errors", (await moderate(broken, "hello")).ok);
ok("the filter is asked first, so the model never sees a link", !(await moderate(stub("safe"), "http://a.b")).ok);
console.error = q;

console.log(bad ? `\n${bad} failing` : "\nall moderation checks passed");
process.exit(bad ? 1 : 0);
