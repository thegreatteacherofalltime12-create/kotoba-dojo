// Check a batch of written clues against the rules, before they go near the
// bank.
//
//   node scripts/buzzer-bank-check.mjs path/to/clues.json
//
// Reading fifty clues by eye and deciding whether the decoys are any good is
// a job nobody does twice. Most of what goes wrong is mechanical — a decoy
// repeated, a question mark, a column whose difficulty does not climb — so
// the mechanical part is checked here and the human attention is left for
// the part that needs it, which is whether the answers are actually true.
import fs from "node:fs";
import { AVATARS } from "../src/buzzer.js";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/buzzer-bank-check.mjs <clues.json>"); process.exit(2); }

const scopes = JSON.parse(fs.readFileSync(new URL("../buzzer-scopes.json", import.meta.url), "utf8"));
const byName = new Map(scopes.map((s) => [s.name, s]));
const byId = new Map(scopes.map((s) => [s.id, s]));

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const cats = Array.isArray(raw) ? raw : raw.categories || [];

let bad = 0, warn = 0;
const fail = (where, why) => { console.log(`  FAIL  ${where}: ${why}`); bad++; };
const soft = (where, why) => { console.log(`  warn  ${where}: ${why}`); warn++; };

console.log(`\nchecking ${cats.length} categories from ${file}\n`);

for (const c of cats) {
  const at = c.name || c.id || "(unnamed)";
  const spec = byName.get(c.name) || byId.get(c.id);
  if (!spec) { fail(at, "not one of the 104 — check the name against buzzer-scopes.json"); continue; }
  if (c.id && spec.id !== c.id) soft(at, `id is "${c.id}", the scopes file says "${spec.id}"`);
  if (!c.scope) soft(at, "no scope; copy it from buzzer-scopes.json");

  const clues = [...(c.clues || [])].sort((a, b) => (a.row || 0) - (b.row || 0));
  if (clues.length !== 5) { fail(at, `${clues.length} clues, wants 5`); continue; }
  if (clues.map((q) => q.row).join() !== "1,2,3,4,5") fail(at, "rows are not 1 to 5 exactly once");

  const answers = clues.map((q) => String(q.a || "").trim().toLowerCase());
  if (new Set(answers).size !== 5) fail(at, "an answer repeats inside the column");

  clues.forEach((q, i) => {
    const w = `${at} row ${q.row ?? i + 1}`;
    const question = String(q.q || "");
    const answer = String(q.a || "").trim();
    const wrong = (q.wrong || []).map((x) => String(x).trim());

    if (!question) return fail(w, "no clue text");
    if (!answer) return fail(w, "no answer");
    // The show writes clues as statements. A question mark is the single
    // clearest sign somebody wrote a quiz question instead.
    if (/\?\s*$/.test(question)) fail(w, "ends in a question mark — write it as a statement");
    if (question.length > 150) fail(w, `${question.length} characters, cap is 150`);
    if (wrong.length !== 3) fail(w, `${wrong.length} wrong options, wants exactly 3`);
    if (new Set(wrong.map((x) => x.toLowerCase())).size !== wrong.length) fail(w, "a decoy is repeated");
    if (wrong.some((x) => x.toLowerCase() === answer.toLowerCase())) fail(w, "a decoy is the answer");
    if (wrong.some((x) => !x)) fail(w, "an empty decoy");

    // A decoy that is far longer or shorter than the answer is a tell: you
    // can pick the odd one out without knowing anything at all.
    const lens = [answer, ...wrong].map((x) => x.length);
    if (Math.max(...lens) > Math.min(...lens) * 3 && Math.max(...lens) > 12) {
      soft(w, "one option is much longer than the others — a guessable shape");
    }
    // The answer sitting inside its own clue gives it away — except in the
    // three categories where that is the entire joke. Stupid Answers is
    // nothing but answers hiding in plain sight, and Odd One Out has to print
    // the list it is asking you to pick from.
    const SAYS_ITS_ANSWER = new Set(["stupidanswers", "oddoneout", "commonbonds"]);
    if (!SAYS_ITS_ANSWER.has(spec.id) && answer.length > 3 &&
        question.toLowerCase().includes(answer.toLowerCase())) {
      fail(w, "the clue contains its own answer");
    }
    if (spec.section === "arena" && !q.source) soft(w, "an arena clue with no source line");

    // No clue may give away another in the same column.
    clues.forEach((other, j) => {
      if (i === j) return;
      const a2 = String(other.a || "").trim();
      if (a2.length > 4 && question.toLowerCase().includes(a2.toLowerCase())) {
        fail(w, `gives away row ${other.row}'s answer`);
      }
    });
  });

  // Difficulty should climb. There is no way to measure that mechanically,
  // but a flat column usually shows up as five clues of near-identical
  // length, so it is worth a nudge rather than a failure.
  const spread = clues.map((q) => String(q.q).length);
  if (Math.max(...spread) - Math.min(...spread) < 12) {
    soft(at, "every clue is about the same length — check the difficulty really climbs");
  }
}

const seen = cats.map((c) => c.name);
const dupes = seen.filter((n, i) => seen.indexOf(n) !== i);
if (dupes.length) fail("the batch", `a category appears twice: ${[...new Set(dupes)].join(", ")}`);

console.log(`\n${bad} failing, ${warn} to look at\n`);
if (!bad && !warn) console.log(`all clear — ${cats.length * 5} clues\n`);
process.exit(bad ? 1 : 0);
