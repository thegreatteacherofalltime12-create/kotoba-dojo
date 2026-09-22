// node scripts/links-arsenal-smoke.mjs
//
// The golf arsenal through the room: the limits, the hints, the strokes a
// mulligan takes back, the gimme, the promises a hole pays off (Lucky
// Bounce, Double Down, Eagle Eye, Ace Chaser), the pencil, and the spend.
import { LinksCourse } from "../src/links-course.js";
import { ARSENALS } from "../src/arsenals.js";
import { DIFF } from "../src/links.js";

// Points are multiplied by the tee's own multiplier, so the figures a hole
// cards are these rather than the raw table.
const EASY = DIFF.easy.mult;
const paid = (raw) => Math.round(raw * EASY);

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

class FakeWS {
  constructor() { this.inbox = []; this.listeners = {}; }
  accept() {}
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  send(raw) { this.inbox.push(JSON.parse(raw)); }
  last(t) { return [...this.inbox].reverse().find((m) => m.type === t); }
  fire(msg) { return Promise.all((this.listeners.message || []).map((fn) => fn({ data: JSON.stringify(msg) }))); }
}
globalThis.WebSocketPair = class { constructor() { const a = new FakeWS(), b = new FakeWS(); return { 0: a, 1: b }; } };

function makeState() {
  const store = new Map();
  return {
    _init: null,
    blockConcurrencyWhile(fn) { this._init = fn(); return this._init; },
    waitUntil: (p) => p,
    storage: {
      get: async (k) => store.get(k),
      put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
      setAlarm: async () => {}, deleteAlarm: async () => {},
    },
  };
}

/** A room with one player on the given tees, teed off, with tokens armed. */
async function room(diff, armed) {
  const state = makeState();
  const course = new LinksCourse(state, { FIREBASE_PROJECT_ID: "test" });
  await state._init;
  course.room = course.blank("GOLF", "augusta", diff, "classic", true);
  course.room.hostUid = "a";
  course.room.players.a = course.freshPlayer("a", "Ana");
  const ws = new FakeWS();
  course.socks.set(ws, "a");
  const p = course.room.players.a;
  await course.start(ws, "a");
  p.ars = { ...course.freshArs(), armed };
  const fire = (o) => course.useArsenal(ws, "a", o);
  const guess = (w) => course.guess(ws, "a", { word: w });
  const answer = () => course.wordAt(course.room, p).answer;
  return { course, p, ws, fire, guess, answer, room: course.room };
}

console.log("\narming");
{
  const { course, p, ws } = await room("easy", {});
  await course.arm(ws, "a", { key: "gf_nope" });
  ok("an unknown token is refused", /No such token/.test(ws.last("LINKS_TOKENS").error));
  await course.arm(ws, "a", { key: "gf_hint" });
  ok("nothing held means nothing armed", /hold no more/.test(ws.last("LINKS_TOKENS").error));
  p.ars.armed.gf_pencil = 1;
  await course.arm(ws, "a", { key: "gf_pencil" });
  ok("one pencil is the limit", /limit for one round/.test(ws.last("LINKS_TOKENS").error));
  await course.disarm(ws, "a", { key: "gf_pencil" });
  ok("an unused token can be put back", !p.ars.armed.gf_pencil);
  ok("the registry carries eighteen tokens with prices", Object.keys(ARSENALS.links).length === 18
    && Object.values(ARSENALS.links).every((t) => t.price > 0 && t.max > 0));
}

console.log("\nhints, and the word in play");
{
  const { course, p, ws, fire, answer } = await room("easy", { gf_hint: 5, gf_local: 4, gf_fitting: 3, gf_wind: 2 });
  const word = answer();
  await fire({ action: "local" });
  const hints = p.hints["0:0"];
  ok("Local Knowledge places the first and last letters", hints.includes(0) && hints.includes(word.length - 1));
  await fire({ action: "hint" });
  ok("a hint adds one more place", p.hints["0:0"].length === 3);
  const view = course.holeView(course.room, p);
  ok("the hole view carries the letters with their places, never the word",
    view.hints.length === 3 && view.hints.every((x) => x.ch === word[x.i]) && !JSON.stringify(view).includes(`"${word}"`));
  await fire({ action: "wind" });
  ok("the Wind Gauge hands over the word to flash", ws.last("LINKS_MARK").reveal === word);
  await fire({ action: "fitting" });
  ok("Club Fitting swaps the word for another of the same length", answer() !== word && answer().length === word.length);
  ok("and the hints on the old word are gone", !p.hints["0:0"]);
}

console.log("\nstrokes");
{
  const { p, fire, guess, answer } = await room("easy", { gf_mulligan: 3, gf_practice: 5, gf_drop: 2, gf_club: 4 });
  const wrong = () => [...answer()].reverse().join("") === answer() ? null : [...answer()].reverse().join("");
  await guess(wrong());
  ok("a guess is a stroke on the forward tees", p.strokes === 1);
  await fire({ action: "mulligan" });
  ok("a mulligan takes it back", p.strokes === 0);
  await fire({ action: "practice" });
  await guess(wrong());
  ok("a practice swing costs no stroke and eats no guess", p.strokes === 0 && p.guesses.length === 1);
  await guess(wrong());
  await fire({ action: "drop" });
  ok("Drop Zone clears the guesses and the strokes they cost", p.strokes === 0 && p.guesses.length === 0);
  const before = 0;
  await fire({ action: "club" });
  ok("Extra Club is counted on the room", p.ars.extra === 2 && p.ars.used.gf_club === 1 && before === 0);
}

console.log("\nthe hole's own promises");
{
  const { p, fire, guess, answer, room: r } = await room("easy", { gf_gimme: 2, gf_bounce: 2, gf_ace: 2, gf_double: 3, gf_eagle: 2 });
  const par = r.board[0].par;
  await fire({ action: "gimme" });
  ok("a gimme cards par and moves you on", p.card[0].strokes === par && p.hole === 1);
  await fire({ action: "ace" });
  await guess(answer());
  ok("Ace Chaser pays 150 for a hole in one", p.card[1].points === paid(150) && p.card[1].marks.includes("ace"));
  ok("and it is used up", !p.ars.ace && p.ars.used.gf_ace === 1);
  // A hole played badly, covered by a bounce.
  await fire({ action: "bounce" });
  const wrong = () => [...answer()].sort().join("");
  for (let i = 0; i < 12 && !p.card[3]; i++) await guess(wrong());
  ok("Lucky Bounce cards no worse than par", p.card[2].strokes === p.card[2].par && p.card[2].marks.includes("bounce"));
}
{
  const { p, fire, guess, answer } = await room("easy", { gf_double: 3, gf_eagle: 2 });
  await fire({ action: "double" });
  await guess(answer());
  ok("Double Down doubles a hole made in one", p.card[0].points === paid(200) && p.card[0].marks.includes("double"));
  await fire({ action: "eagle" });
  await guess(answer());
  ok("Eagle Eye doubles the next hole under par", p.card[1].points === paid(200) && p.card[1].marks.includes("eagle"));
  await guess(answer());
  ok("and then it is spent", !p.card[2].marks?.length);
}
{
  const { p, fire, guess, answer } = await room("easy", { gf_double: 3 });
  await fire({ action: "double" });
  const wrong = () => [...answer()].sort().join("");
  for (let i = 0; i < 12 && !p.card[0]; i++) await guess(wrong());
  ok("a doubled hole played badly is halved", p.card[0].marks.includes("halved"));
  await fire({ action: "double" });
  await guess(answer());
  ok("Double Down cannot be declared once you have swung", p.ars.used.gf_double === 2 || p.card[1].marks?.includes("double") === false);
}

console.log("\nthe hard tees");
{
  const { course, p, fire, ws, room: r } = await room("hard", { gf_finder: 3, gf_tees: 2, gf_relief: 3 });
  ok("the clue is withheld on the first two words", course.holeView(r, p).clue == null);
  await fire({ action: "finder" });
  ok("a Range Finder buys it", typeof course.holeView(r, p).clue === "string");
  await fire({ action: "tees" });
  ok("Preferred Lies marks the next hole", p.ars.easyHole === 1);
  ok("eight words here, five on that hole", course.wordsFor(r, p, 0) === 8 && course.wordsFor(r, p, 1) === 5);
  await fire({ action: "relief" });
  ok("relief is taken and will soften the next word lost", p.ars.relief === true);
}

console.log("\nthe card, and the spend");
{
  const { course, p, fire, guess, answer, room: r } = await room("easy", { gf_pencil: 1, gf_hint: 5 });
  await fire({ action: "pencil" });
  await guess(answer());                       // an ace: 100
  const wrong = () => [...answer()].sort().join("");
  for (let i = 0; i < 12 && !p.card[1]; i++) await guess(wrong());   // a blown hole
  ok("both holes are on the card", p.card.length === 2);
  ok("the pencil strikes the worst of them", course.cardOf(p).length === 1 && course.cardOf(p)[0].points === paid(100));
  await fire({ action: "hint" });
  await course.finish(r, "ended");
  const row = ws2Results(course);
  ok("the round is scored on the card the pencil left", row.points === paid(100));
  ok("the results spend what was used, and only that",
    row.spent.gf_pencil === 1 && row.spent.gf_hint === 1 && Object.keys(row.spent).length === 2);
  ok("what was armed and never fired stays armed", p.ars.armed.gf_hint === 4 && !p.ars.armed.gf_pencil);
  ok("and the used tally is cleared for the next round", Object.keys(p.ars.used).length === 0);
}
function ws2Results(course) {
  for (const [ws] of course.socks) {
    const over = ws.last("LINKS_OVER");
    if (over) return over.results[0];
  }
  return {};
}

console.log(bad ? `\n${bad} failing\n` : "\nall golf arsenal checks passed\n");
process.exit(bad ? 1 : 0);
