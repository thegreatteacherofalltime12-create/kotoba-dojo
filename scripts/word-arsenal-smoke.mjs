// node scripts/word-arsenal-smoke.mjs
//
// The Word-Cross arsenal through the dojo: the limits, the letters a token
// shows, the entries it solves, what the promises do to the score, and the
// spend at the end of the round.
import { DojoLobby } from "../src/lobby.js";
import { STARTER_PUZZLES, STARTER_INDEX } from "../src/starter-puzzles.js";
import { ARSENALS } from "../src/arsenals.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

class FakeSocket {
  constructor(uid, name) { this.attach = { uid, name }; this.inbox = []; this.open = true; }
  serializeAttachment(v) { this.attach = v; }
  deserializeAttachment() { return this.attach; }
  send(raw) { this.inbox.push(JSON.parse(raw)); }
  last(t) { return [...this.inbox].reverse().find((m) => m.type === t); }
  all(t) { return this.inbox.filter((m) => m.type === t); }
}
function makeState() {
  const store = new Map();
  const sockets = [];
  return {
    sockets, _init: null,
    blockConcurrencyWhile(fn) { this._init = fn(); return this._init; },
    waitUntil: (p) => p,
    acceptWebSocket: (ws) => sockets.push(ws),
    getWebSockets: () => sockets.filter((s) => s.open),
    storage: {
      get: async (k) => (Array.isArray(k) ? new Map(k.map((x) => [x, store.get(x)])) : store.get(k)),
      put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
      deleteAll: async () => store.clear(),
      setAlarm: async () => {}, deleteAlarm: async () => {},
    },
  };
}

const FIRST = STARTER_INDEX[0].id;
const bank = structuredClone(STARTER_PUZZLES[FIRST]);

/** A dojo with one solver, a bank scroll chosen, the round running. */
async function dojo(armed) {
  const state = makeState();
  const env = { FIREBASE_PROJECT_ID: "test", PUZZLES: { get: async (k) => (k === `puzzle:${FIRST}` ? bank : null) } };
  const lobby = new DojoLobby(state, env);
  await state._init;
  const ws = new FakeSocket("u-a", "Aiko");
  state.acceptWebSocket(ws);
  await lobby.onJoin("u-a", "Aiko", "TEST", ws);
  const say = (obj) => lobby.webSocketMessage(ws, JSON.stringify(obj));
  await say({ type: "SET_GAME_MODE", mode: "solo" });
  await say({ type: "SET_PUZZLE", source: "bank", id: FIRST });
  await say({ type: "START_ROUND" });
  const p = lobby.lobby.players["u-a"];
  p.ars = { ...lobby.freshArs(), armed };
  return { lobby, ws, say, p };
}
const entryOf = (lobby, n = 0) => lobby.clientPuzzle.entries[n];

console.log("\narming");
{
  const { lobby, ws, say, p } = await dojo({});
  await say({ type: "ARM_TOKEN", key: "wc_nope" });
  ok("an unknown token is refused", /No such token/.test(ws.last("TOKENS").error));
  await say({ type: "ARM_TOKEN", key: "wc_letter" });
  ok("nothing held means nothing armed", /hold no more/.test(ws.last("TOKENS").error));
  p.ars.armed.wc_cascade = 1;
  await say({ type: "ARM_TOKEN", key: "wc_cascade" });
  ok("one cascade is the limit", /limit for one round/.test(ws.last("TOKENS").error));
  await say({ type: "DISARM_TOKEN", key: "wc_cascade" });
  ok("an unused token can be put back", !p.ars.armed.wc_cascade);
  ok("eighteen tokens, each with a price and a limit", Object.keys(ARSENALS.crossword).length === 18
    && Object.values(ARSENALS.crossword).every((t) => t.price > 0 && t.max > 0));
}

console.log("\nsight");
{
  const { lobby, ws, say, p } = await dojo({ wc_letter: 8, wc_shape: 5, wc_anagram: 4, wc_spell: 4, wc_eye: 3, wc_theme: 2, wc_firsts: 2 });
  const e = entryOf(lobby);
  const answer = lobby.answers[e.id];
  await say({ type: "USE_TOKEN", action: "letter", entryId: e.id });
  const shown = p.ars.letters[e.id];
  ok("a free letter is a real letter in its real place", Object.entries(shown).every(([i, ch]) => answer[Number(i)] === ch));
  await say({ type: "USE_TOKEN", action: "shape" , entryId: e.id });
  ok("word shape gives the first and last", p.ars.letters[e.id][0] === answer[0] && p.ars.letters[e.id][answer.length - 1] === answer[answer.length - 1]);
  await say({ type: "USE_TOKEN", action: "anagram", entryId: e.id });
  const jumble = ws.last("ARSENAL_ANAGRAM");
  ok("the anagram is the same letters", jumble.entryId === e.id && [...jumble.letters].sort().join("") === [...answer].sort().join(""));
  await say({ type: "USE_TOKEN", action: "spell", entryId: e.id, guess: answer });
  ok("spellcheck marks a right answer right through", ws.last("ARSENAL_SPELL").marks.every((m) => m === "right"));
  await say({ type: "USE_TOKEN", action: "spell", entryId: e.id, guess: "" });
  ok("an empty guess is refused", /Type a guess first/.test(ws.last("ERROR").message));
  await say({ type: "USE_TOKEN", action: "eye" });
  ok("the sensei's eye names an entry that crosses others", /crosses \d+ other/.test(ws.last("ARSENAL_NOTE").text)
    && !!lobby.clientPuzzle.entries.find((x) => x.id === ws.last("ARSENAL_POINT").entryId));
  await say({ type: "USE_TOKEN", action: "theme" });
  ok("the theme reading names the scroll", ws.last("ARSENAL_NOTE").text.includes(lobby.clientPuzzle.title));
  await say({ type: "USE_TOKEN", action: "firsts" });
  const firsts = lobby.clientPuzzle.entries.every((x) => p.ars.letters[x.id]?.[0] === lobby.answers[x.id][0]);
  ok("first letters covers every entry left", firsts);
  ok("nothing here solved anything", p.solved.length === 0);
}

console.log("\nauto-solve");
{
  const { lobby, ws, say, p } = await dojo({ wc_gift: 4, wc_short: 3, wc_word: 3, wc_last: 2 });
  const total = lobby.terms().words;
  await say({ type: "USE_TOKEN", action: "gift" });
  ok("a random gift solves one", p.solved.length === 1 && ws.last("CHECK_RESULT").gift === "gift");
  const shortest = [...lobby.unsolved(p)].sort((x, y) => x.len - y.len)[0];
  await say({ type: "USE_TOKEN", action: "short" });
  ok("the shortest straw takes the shortest", p.solved.includes(shortest.id) && p.solved.length === 2);
  const pick = lobby.unsolved(p)[0];
  await say({ type: "USE_TOKEN", action: "word", entryId: pick.id });
  ok("a free word takes the one you point at", p.solved.includes(pick.id));
  await say({ type: "USE_TOKEN", action: "last" });
  ok("last word waits until one is left", /waits until one entry is left/.test(ws.last("ERROR").message));
  // Solve down to one by hand, then the last word closes it.
  for (const x of [...lobby.unsolved(p)].slice(0, total - p.solved.length - 1)) {
    await say({ type: "CHECK_ENTRY", entryId: x.id, guess: lobby.answers[x.id] });
  }
  ok("one entry stands", lobby.unsolved(p).length === 1);
  await say({ type: "USE_TOKEN", action: "last" });
  ok("the last word finishes the grid", p.solved.length === total && p.status === "finished");
  ok("and the round is scored", p.score > 0 && typeof p.finishedAt === "number");
}
{
  const { lobby, ws, say, p } = await dojo({ wc_cascade: 1 });
  // Everything but two entries solved by hand, so the cascade has somewhere
  // to run: its crossings complete what is left.
  const entries = lobby.clientPuzzle.entries;
  for (const x of entries.slice(0, entries.length - 2)) {
    await say({ type: "CHECK_ENTRY", entryId: x.id, guess: lobby.answers[x.id] });
  }
  const before = p.solved.length;
  await say({ type: "USE_TOKEN", action: "cascade", entryId: lobby.unsolved(p)[0].id });
  ok("the cascade takes the entry it is pointed at, and what follows", p.solved.length > before);
  ok("one cascade is spent", p.ars.used.wc_cascade === 1);
}

console.log("\npoints and time");
{
  const { lobby, ws, say, p } = await dojo({ wc_head: 3, wc_double: 2, wc_perfect: 1, wc_salvage: 2, wc_fast: 2, wc_quiet: 3 });
  await say({ type: "USE_TOKEN", action: "head" });
  await say({ type: "USE_TOKEN", action: "head" });
  ok("two head starts are a minute and a half", p.ars.head === 90000);
  await say({ type: "USE_TOKEN", action: "fast" });
  await say({ type: "USE_TOKEN", action: "quiet" });
  ok("fast hands and a quiet grid are flags on the round", p.ars.fast === true && p.ars.quiet === true);
  const usedFast = p.ars.used.wc_fast;
  await say({ type: "USE_TOKEN", action: "fast" });
  ok("neither can be used twice", /already free/.test(ws.last("ERROR").message) && p.ars.used.wc_fast === usedFast);
  await say({ type: "USE_TOKEN", action: "salvage" });
  ok("salvage counts two more words", p.ars.salvage === 2);
  // A part-solved round, ended early: salvage lifts what it is worth.
  p.solved = [lobby.clientPuzzle.entries[0].id];
  lobby.lobby.roundStartedAt = Date.now() - 60_000;
  const plain = lobby.scoreOf(1, 60_000, false);
  const lifted = lobby.scoreFor(p, false);
  ok("an unfinished round scores as if two more were solved", lifted > plain);
  await say({ type: "USE_TOKEN", action: "perfect" });
  await say({ type: "USE_TOKEN", action: "double" });
  p.finishedAt = 14 * 60_000;          // a slow finish, worth almost nothing
  const slow = lobby.scoreOf(lobby.terms().words, 14 * 60_000, true);
  const withInk = lobby.scoreFor(p, true);
  ok("perfect ink floors a finished round at 75, and double ink lifts it", slow < 10 && withInk >= Math.round(75 * 1.25));
}

console.log("\nthe spend");
{
  const { lobby, ws, say, p } = await dojo({ wc_letter: 8, wc_gift: 4 });
  const e = entryOf(lobby);
  await say({ type: "USE_TOKEN", action: "letter", entryId: e.id });
  await say({ type: "USE_TOKEN", action: "gift" });
  await say({ type: "END_MATCH" });
  const over = ws.last("ROUND_END");
  const row = over.results.find((r) => r.uid === "u-a");
  ok("the round is over", lobby.lobby.phase === "RESULTS" && !!row);
  ok("the results spend what was used, and only that", row.spent.wc_letter === 1 && row.spent.wc_gift === 1 && Object.keys(row.spent).length === 2);
  ok("what was armed and never used stays armed", p.ars.armed.wc_letter === 7 && p.ars.armed.wc_gift === 3);
  ok("and the used tally is cleared", Object.keys(p.ars.used).length === 0);
}

console.log(bad ? `\n${bad} failing\n` : "\nall word-cross arsenal checks passed\n");
process.exit(bad ? 1 : 0);
