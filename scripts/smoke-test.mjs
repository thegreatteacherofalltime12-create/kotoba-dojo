// Exercises the Durable Object against a stubbed Workers runtime.
//   node scripts/smoke-test.mjs
import { DojoLobby } from "../src/lobby.js";
import { STARTER_PUZZLES, STARTER_INDEX } from "../src/starter-puzzles.js";

// Puzzle ids move whenever the archive is regenerated, so take the first two
// the bundle actually contains rather than naming them.
const [FIRST, SECOND] = STARTER_INDEX.map((p) => p.id);

let failures = 0;
const ok = (label, cond) => {
  console.log(`${cond ? "  pass" : "  FAIL"}  ${label}`);
  if (!cond) failures++;
};

class FakeSocket {
  constructor(uid, name) { this.attach = { uid, name }; this.inbox = []; this.open = true; }
  serializeAttachment(v) { this.attach = v; }
  deserializeAttachment() { return this.attach; }
  send(raw) { this.inbox.push(JSON.parse(raw)); }
  last(type) { return [...this.inbox].reverse().find((m) => m.type === type); }
  all(type) { return this.inbox.filter((m) => m.type === type); }
}

function makeState() {
  const store = new Map();
  const sockets = [];
  const st = {
    sockets,
    alarmAt: null,
    _init: null,
    blockConcurrencyWhile(fn) { this._init = fn(); return this._init; },
    waitUntil: (p) => p,
    acceptWebSocket: (ws) => sockets.push(ws),
    getWebSockets: () => sockets.filter((s) => s.open),
    storage: {
      get: async (k) => (Array.isArray(k) ? new Map(k.map((x) => [x, store.get(x)])) : store.get(k)),
      put: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, structuredClone(v)); },
      deleteAll: async () => store.clear(),
      setAlarm: async function (t) { this._at = t; },
      deleteAlarm: async function () { this._at = null; },
    },
  };
  return st;
}

const bank = structuredClone(STARTER_PUZZLES[FIRST]);
const env = {
  FIREBASE_PROJECT_ID: "test",
  PUZZLES: { get: async (key) => (key === `puzzle:${FIRST}` ? bank : null) },
};

const msg = (ws, obj) => lobby.webSocketMessage(ws, JSON.stringify(obj));

const state = makeState();
const lobby = new DojoLobby(state, env);
await state._init; // the real runtime blocks here before any request lands

const sensei = new FakeSocket("u-sensei", "Sensei");
const a = new FakeSocket("u-a", "Aiko");
const b = new FakeSocket("u-b", "Bo");

console.log("\njoining");
state.acceptWebSocket(sensei);
await lobby.onJoin("u-sensei", "Sensei", "TEST", sensei);
state.acceptWebSocket(a);
await lobby.onJoin("u-a", "Aiko", "TEST", a);
ok("first joiner becomes sensei", sensei.last("WELCOME").isSensei === true);
ok("second joiner does not", a.last("WELCOME").isSensei === false);
ok("roster has two", a.last("LOBBY_STATE").lobby.members.length === 2);

console.log("\npermissions");
await msg(a, { type: "START_ROUND" });
ok("student cannot start", /Only the sensei/.test(a.last("ERROR").message));
await msg(sensei, { type: "START_ROUND" });
ok("cannot start with no scroll", /Choose a scroll/.test(sensei.last("ERROR").message));

console.log("\nchoosing a scroll");
await msg(sensei, { type: "SET_PUZZLE", source: "bank", id: FIRST });
ok("scroll accepted", !!sensei.last("PUZZLE_ACCEPTED"));
await msg(sensei, { type: "SET_PUZZLE", source: "bank", id: "no-such-id" });
ok("missing scroll rejected", /missing from the archive/.test(sensei.last("ERROR").message));

console.log("\nstarting");
await msg(sensei, { type: "START_ROUND" });
const start = a.last("ROUND_START");
ok("round broadcast", !!start);
ok("puzzle has ten entries", start.puzzle.entries.length === 10);
ok("no answers on the wire", !JSON.stringify(start.puzzle).match(/"answer"/));
ok("bank puzzle: sensei plays", start && !!lobby.lobby.players["u-sensei"]);

console.log("\nsolving");
const key = Object.fromEntries(bank.entries.map((e) => [`${e.num}-${e.dir}`, e.answer]));
await msg(a, { type: "CHECK_ENTRY", entryId: Object.keys(key)[0], guess: "WRONGWORD" });
ok("wrong guess rejected", a.last("CHECK_RESULT").correct === false);
await msg(a, { type: "CHECK_ENTRY", entryId: Object.keys(key)[0], guess: Object.values(key)[0].toLowerCase() });
ok("case-insensitive accept", a.last("CHECK_RESULT").correct === true);
await msg(a, { type: "CHECK_ENTRY", entryId: "999-across", guess: "X" });
ok("unknown entry rejected", /No such entry/.test(a.last("ERROR").message));

for (const [id, answer] of Object.entries(key)) await msg(a, { type: "CHECK_ENTRY", entryId: id, guess: answer });
const fin = sensei.last("PLAYER_FINISHED");
ok("finish broadcast to everyone", !!fin && fin.uid === "u-a");
ok("score in range", fin.score >= 1 && fin.score <= 100);
ok("fast solve scores 100", fin.score === 100);

console.log("\nlate joiner");
state.acceptWebSocket(b);
await lobby.onJoin("u-b", "Bo", "TEST", b);
ok("late joiner spectates", lobby.lobby.members["u-b"].role === "spectator");
ok("late joiner gets no grid", !b.last("ROUND_START") && !b.last("ROUND_RESUME"));
await msg(b, { type: "CHECK_ENTRY", entryId: Object.keys(key)[0], guess: Object.values(key)[0] });
ok("spectator cannot score", !b.last("CHECK_RESULT"));

console.log("\nreconnect mid-round");
const a2 = new FakeSocket("u-a", "Aiko");
a.open = false;
await lobby.onGone(a);
state.acceptWebSocket(a2);
await lobby.onJoin("u-a", "Aiko", "TEST", a2);
ok("finished player is not resumed", !a2.last("ROUND_RESUME"));

const c = new FakeSocket("u-c", "Cho");
state.acceptWebSocket(c);
await lobby.onJoin("u-c", "Cho", "TEST", c);
lobby.lobby.members["u-c"].role = "player";
lobby.lobby.players["u-c"] = { uid: "u-c", solved: [Object.keys(key)[0]], finishedAt: null, score: 0, status: "playing" };
await lobby.persist();
const c2 = new FakeSocket("u-c", "Cho");
c.open = false;
await lobby.onGone(c);
state.acceptWebSocket(c2);
await lobby.onJoin("u-c", "Cho", "TEST", c2);
const res = c2.last("ROUND_RESUME");
ok("mid-round player is resumed", !!res);
ok("solved entries restored", res.solved.length === 1);
ok("earned letters returned", res.solvedLetters[Object.keys(key)[0]] === Object.values(key)[0]);

console.log("\nround end by clock");
lobby.lobby.roundEndsAt = Date.now() - 1;
await lobby.alarm();
const end = sensei.last("ROUND_END");
ok("round ended", !!end);
ok("everyone ranked", end.results.length >= 2);
ok("winner first", end.results[0].uid === "u-a");
ok("unfinished scores zero", end.results.some((r) => r.status === "dnf" && r.score === 0));
ok("answers revealed at the end", !!end.puzzle.entries[0].answer);
ok("phase is results", lobby.lobby.phase === "RESULTS");

console.log("\nrematch");
await msg(sensei, { type: "SET_PUZZLE", source: "bank", id: FIRST });
ok("lobby reopens for the next round", lobby.lobby.phase === "LOBBY");
ok("roster survives", Object.keys(lobby.lobby.members).length === 4);
await msg(sensei, { type: "START_ROUND" });
ok("previous spectator now plays", lobby.lobby.members["u-b"].role === "player");
ok("round counter advanced", lobby.lobby.roundNo === 2);

console.log("\nsensei leaves");
sensei.open = false;
await lobby.onGone(sensei);
ok("leadership passes on", lobby.lobby.senseiUid !== "u-sensei");
ok("heir is the longest-standing member", lobby.lobby.senseiUid === "u-a");

console.log("\nrate limiting");
let blocked = 0;
for (let i = 0; i < 60; i++) {
  await msg(a2, { type: "CHECK_ENTRY", entryId: Object.keys(key)[0], guess: "AAAAAA" });
  if (/Slow down/.test(a2.last("ERROR")?.message || "")) blocked++;
}
ok("brute force is throttled", blocked > 20 && blocked < 60);


console.log("\nhost-authored scroll");
lobby.lobby.roundEndsAt = Date.now() - 1;
await lobby.alarm(); // close out the round in progress
const custom = structuredClone(STARTER_PUZZLES[SECOND]);
const asSubmitted = {
  title: "Sensei's own",
  entries: custom.entries.map((e) => ({ answer: e.answer, clue: e.clue, row: e.row, col: e.col, dir: e.dir })),
};
const lead = lobby.socketFor(lobby.lobby.senseiUid);
await msg(lead, { type: "SET_PUZZLE", source: "custom", puzzle: asSubmitted });
ok("valid custom scroll accepted", !!lead.last("PUZZLE_ACCEPTED"));

const broken = structuredClone(asSubmitted);
broken.entries[0].answer = "QQQQQQ";
await msg(lead, { type: "SET_PUZZLE", source: "custom", puzzle: broken });
ok("tampered grid rejected", /clashes|doesn't cross|runs/.test(lead.last("ERROR").message));

const short = structuredClone(asSubmitted);
short.entries.pop();
await msg(lead, { type: "SET_PUZZLE", source: "custom", puzzle: short });
ok("nine-word scroll rejected", /exactly 10 words/.test(lead.last("ERROR").message));

await msg(lead, { type: "START_ROUND" });
ok("author referees their own scroll", lobby.lobby.members[lobby.lobby.senseiUid].role === "referee");
ok("author is not scored", !lobby.lobby.players[lobby.lobby.senseiUid]);
ok("others still play", Object.keys(lobby.lobby.players).length >= 1);
const startedCustom = b.last("ROUND_START");
ok("custom grid ships without answers", !JSON.stringify(startedCustom.puzzle).match(/"answer"/));


console.log("\nlisting and privacy");
const announced = [];
const dirEnv = {
  idFromName: () => "global",
  get: () => ({ fetch: (url, init) => { announced.push({ url: String(url), body: JSON.parse(init.body) }); return Promise.resolve(new Response("{}")); } }),
};
lobby.env = { ...env, DIRECTORY: dirEnv };
const lead2 = lobby.socketFor(lobby.lobby.senseiUid);

lobby.announce();
ok("a listed dojo announces itself", announced.at(-1).url.includes("/announce"));
ok("it announces under its own game", announced.at(-1).body.game === "crossword");
ok("announcement carries the head count", announced.at(-1).body.players > 0);
ok("no answers in the announcement", !JSON.stringify(announced.at(-1).body).match(/answer/i));

await msg(lead2, { type: "SET_VISIBILITY", listed: false });
// Zero players is how the directory is told to drop a row; it prunes on that.
ok("unlisting withdraws the row", announced.at(-1).body.players === 0);
ok("state records it", lobby.lobby.listed === false);
ok("still reachable by code", lobby.lobbyState().code === "TEST");

const before = announced.length;
const student = lobby.socketFor("u-b");
await msg(student, { type: "SET_VISIBILITY", listed: true });
ok("a student cannot relist it", lobby.lobby.listed === false && announced.length === before);

await msg(lead2, { type: "SET_VISIBILITY", listed: true });
ok("the sensei can relist it", announced.at(-1).body.players > 0);


console.log("\nsolo training");
const soloState = makeState();
const soloLobby = new DojoLobby(soloState, { ...env, DIRECTORY: dirEnv });
await soloState._init;
const alone = new FakeSocket("u-solo", "Solo");
soloState.acceptWebSocket(alone);
await soloLobby.onJoin("u-solo", "Solo", "SOLO", alone);

const soloMsg = (obj) => soloLobby.webSocketMessage(alone, JSON.stringify(obj));
await soloMsg({ type: "SET_PUZZLE", source: "bank", id: FIRST });
await soloMsg({ type: "START_ROUND" });
ok("a match lobby refuses to start alone", /at least one more/.test(alone.last("ERROR").message));

await soloMsg({ type: "SET_GAME_MODE", mode: "solo" });
ok("solo mode recorded", soloLobby.lobby.gameMode === "solo");
ok("solo training never lists publicly", soloLobby.lobby.listed === false);

await soloMsg({ type: "START_ROUND" });
const soloStart = alone.last("ROUND_START");
ok("solo round starts with one player", !!soloStart);
ok("solo gets the same ten-word grid", soloStart.puzzle.entries.length === 10);
ok("solo answers stay server-side", !JSON.stringify(soloStart.puzzle).match(/"answer"/));

const soloKey = Object.fromEntries(bank.entries.map((e) => [`${e.num}-${e.dir}`, e.answer]));
for (const [id, answer] of Object.entries(soloKey)) await soloMsg({ type: "CHECK_ENTRY", entryId: id, guess: answer });
const soloEnd = alone.last("ROUND_END");
ok("solo round ends and scores", !!soloEnd && soloEnd.results[0].score > 0);
ok("solo earns the completion bonus", soloEnd.results[0].breakdown.completion === 15);
ok("solo faces no field, so no challenge bonus", soloEnd.results[0].breakdown.challenge === 0);
ok("solo is scored as a match, not a rumble", soloEnd.mode === "match");

console.log(failures ? `\n${failures} failing checks\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
