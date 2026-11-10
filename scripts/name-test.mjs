// node scripts/name-test.mjs
//
// A player's name comes from their token, and they can set that to anything,
// so the arena cleans it before anyone else sees it. Renaming is a feature;
// disguising a name, or taking the arena's own voice, is not.
import { cleanName } from "../src/jwt.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

console.log("\nwhat a player chose stands");
ok("an ordinary name", cleanName("Ana_B", "ana_b") === "Ana_B");
ok("a renamed one with a space", cleanName("Night Owl", "ana_b") === "Night Owl");
ok("kept to twenty-four characters", cleanName("x".repeat(40), "f").length === 24);

console.log("\nwhat hides or turns text around is taken out");
ok("a right-to-left override", cleanName("ana‮gnp.exe", "f") === "anagnp.exe");
ok("zero-width joiners", cleanName("A​n‍a", "f") === "Ana");
ok("controls and a line break", cleanName("Ana\nBo\u0007", "f") === "AnaBo");
ok("runs of spaces close up", cleanName("  Ana    Bo  ", "f") === "Ana Bo");

console.log("\nthe arena's own voices are refused");
ok("Admin", cleanName("Admin", "ana_b") === "ana_b");
ok("however it is spaced or numbered", cleanName("A d m i n 2", "ana_b") === "ana_b");
ok("moderator, any case", cleanName("MODERATOR", "ana_b") === "ana_b");
ok("a name that only contains it is fine", cleanName("Admiral", "ana_b") === "Admiral");

console.log("\nnothing usable falls back to the sign-up name");
ok("empty", cleanName("", "ana_b") === "ana_b");
ok("only hidden characters", cleanName("​​‮", "ana_b") === "ana_b");
ok("one letter", cleanName("A", "ana_b") === "ana_b");
ok("missing", cleanName(undefined, "Student") === "Student");

console.log(bad ? `\n${bad} name check(s) FAILED` : "\nall name checks passed");
process.exit(bad ? 1 : 0);
