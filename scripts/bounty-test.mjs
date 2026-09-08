// node scripts/bounty-test.mjs
import {
  perHour, isEligible, resolve, shouldRotate, unlockedFor, newlyUnlocked,
  CLAIM_BONUS, DEFEND_BONUS, ROTATE_AFTER_MS, KILL_TIERS, SLAYER_TIERS,
} from "../src/bounty.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };
const MIN = 60_000, HOUR = 3_600_000;

console.log("\npoints per hour");
ok("a hundred in an hour is a hundred", perHour(100, HOUR) === 100);
ok("a hundred in half an hour is two hundred", perHour(100, HOUR / 2) === 200);
ok("eighty in fifteen minutes is 320", perHour(80, 15 * MIN) === 320);
ok("the same score over longer rates lower", perHour(80, 2 * HOUR) < perHour(80, HOUR));
ok("a novelty round can't post a silly rate", perHour(50, 1000) === perHour(50, MIN));
ok("no score rates nothing", perHour(0, HOUR) === 0);

console.log("\neligibility");
ok("a rumble counts", isEligible({ mode: "rumble", field: 4 }));
ok("a 1v1 counts", isEligible({ mode: "match", field: 2 }));
ok("PUTV counts", isEligible({ mode: "putv", field: 3 }));
ok("solo never counts", !isEligible({ mode: "solo", field: 1 }));
ok("a one-player match never counts", !isEligible({ mode: "match", field: 1 }));

const match = (results, extra = {}) => ({
  mode: "rumble", field: results.length, durationMs: HOUR, results, ...extra,
});
const row = (uid, score, placement) => ({ uid, name: uid.toUpperCase(), score, placement });

console.log("\nnobody holds it");
let r = resolve(null, match([row("a", 90, 1), row("b", 50, 2)]));
ok("the winner takes an unheld bounty", r.claim.uid === "a");
ok("and it pays the claim bonus", r.claim.bonus === CLAIM_BONUS);
ok("with nobody to take it from", r.claim.from === null);

console.log("\nthe holder is in the match");
const holder = { uid: "h", name: "H", perHour: 200, setAt: Date.now() };
r = resolve(holder, match([row("h", 95, 1), row("a", 90, 2)]));
ok("winning defends it", r.defend?.uid === "h" && !r.claim);
ok("defending pays the defend bonus", r.defend.bonus === DEFEND_BONUS);

r = resolve(holder, match([row("a", 60, 1), row("h", 55, 2)]));
ok("losing first place loses it", r.claim?.uid === "a");
ok("even on a lower rate than they set", r.claim.rate < holder.perHour);
ok("and it comes off the holder", r.claim.from === "h");

r = resolve(holder, match([row("a", 60, 2), row("h", 55, 3), row("c", 80, 1)]));
ok("the winner takes it, not the runner-up", r.claim.uid === "c");

console.log("\nthe holder is elsewhere");
r = resolve(holder, match([row("a", 250, 1), row("b", 90, 2)]));
ok("out-earning the mark claims it", r.claim?.uid === "a" && r.claim.rate === 250);
r = resolve(holder, match([row("a", 150, 1), row("b", 90, 2)]));
ok("scoring under the mark claims nothing", r.claim === null);
r = resolve(holder, match([row("a", 150, 2), row("b", 300, 1)]));
ok("the best rate takes it, not the winner", r.claim.uid === "b");
r = resolve(holder, match([row("a", 100, 1), row("b", 90, 2)]));
ok("failing to beat the mark claims nothing", r.claim === null);
r = resolve(holder, match([row("a", 200, 1)], { field: 2, results: [row("a", 200, 1), row("b", 10, 2)] }));
ok("matching the mark exactly is not beating it", r.claim === null);

console.log("\nsolo is inert");
r = resolve(holder, { mode: "solo", field: 1, durationMs: HOUR, results: [row("a", 999, 1)] });
ok("a huge solo score changes nothing", !r.eligible && !r.claim && !r.defend);

console.log("\nrotation");
ok("an empty seat rotates", shouldRotate(null));
ok("a fresh bounty holds", !shouldRotate({ setAt: Date.now() }));
ok("one held 47 hours still holds", !shouldRotate({ setAt: Date.now() - 47 * 3600_000 }));
ok("one held 49 hours rotates", shouldRotate({ setAt: Date.now() - 49 * 3600_000 }));
ok("the window is 48 hours", ROTATE_AFTER_MS === 48 * 3600_000);

console.log("\nachievements");
ok("no kills unlocks nothing", unlockedFor(0).kill === null && unlockedFor(0).slayers.length === 0);
ok("one kill is silver", unlockedFor(1).kill.tier === "silver");
ok("two is gold", unlockedFor(2).kill.tier === "gold");
ok("three is diamond", unlockedFor(3).kill.tier === "diamond");
ok("four is platinum", unlockedFor(4).kill.tier === "platinum");
ok("nine is still platinum", unlockedFor(9).kill.tier === "platinum");
ok("five unlocks the Slayer", unlockedFor(5).slayers.map((s) => s.id).join() === "slayer");
ok("ten adds the Executioner", unlockedFor(10).slayers.length === 2);
ok("fifteen adds the Warlord", unlockedFor(15).slayers.length === 3);
ok("milestones stack, so a Warlord holds all three",
  unlockedFor(20).slayers.map((s) => s.id).join() === "slayer,executioner,warlord");

console.log("\nwhat a single kill just unlocked");
ok("the first kill announces silver", newlyUnlocked(0, 1).map((u) => u.id).join() === "kill-1");
ok("the fifth announces the Slayer too",
  newlyUnlocked(4, 5).map((u) => u.id).join() === "slayer");
ok("the tenth announces the Executioner",
  newlyUnlocked(9, 10).map((u) => u.id).join() === "executioner");
ok("a kill between milestones announces nothing", newlyUnlocked(6, 7).length === 0);
ok("kill tiers are the four asked for", KILL_TIERS.length === 4);
ok("slayer tiers are the three asked for", SLAYER_TIERS.length === 3);

console.log(bad ? `\n${bad} failing\n` : "\nall bounty checks passed\n");
process.exit(bad ? 1 : 0);
