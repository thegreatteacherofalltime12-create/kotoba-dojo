// node scripts/battle-smoke.mjs
import { BattleRoyale } from "../src/battle-lobby.js";
import { randomFleet, SIZE, targetOptions } from "../src/battleship.js";

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
      get: async (k) => store.get(k),
      put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
      deleteAll: async () => store.clear(),
      setAlarm: async () => {}, deleteAlarm: async () => {},
    },
  };
}

const env = { FIREBASE_PROJECT_ID: "test" };
const state = makeState();
const game = new BattleRoyale(state, env);
await state._init;

const NAMES = ["Ana", "Bo", "Cho", "Dev", "Eli"];
const socks = {};
for (let i = 0; i < NAMES.length; i++) {
  const uid = `u${i}`;
  const ws = new FakeSocket(uid, NAMES[i]);
  socks[uid] = ws;
  state.acceptWebSocket(ws);
  await game.onJoin(uid, NAMES[i], "SEA", ws);
}
const say = (uid, obj) => game.webSocketMessage(socks[uid], JSON.stringify(obj));

console.log("\njoining");
ok("first in is host", socks.u0.last("BATTLE_WELCOME").isHost === true);
ok("others are not", socks.u1.last("BATTLE_WELCOME").isHost === false);
ok("everyone is on the roster", socks.u0.last("BATTLE_STATE").game.players.length === 5);
ok("board size is published", socks.u0.last("BATTLE_WELCOME").size === SIZE);

console.log("\nchoosing a chart");
await say("u0", { type: "BATTLE_MAP", mapId: "hard" });
let chart = socks.u1.last("BATTLE_STATE").game;
ok("the new size reaches every client in the state", chart.size === 20 && chart.mapId === "hard");
ok("and so does its fleet", Array.isArray(chart.fleet) && chart.fleet.length > 5);
ok("and its shots a turn", chart.shots === 5);
await say("u0", { type: "BATTLE_MAP", mapId: "easy" });

console.log("\nplacing");
await say("u1", { type: "BATTLE_START" });
ok("only the host can start", /Only the host/.test(socks.u1.last("BATTLE_ERROR").message));

await say("u0", { type: "BATTLE_PLACE", placements: [{ id: "carrier", row: 0, col: 0, dir: "across" }] });
ok("an incomplete fleet is refused", /Place all/.test(socks.u0.last("BATTLE_ERROR").message));

for (const uid of Object.keys(socks)) await say(uid, { type: "BATTLE_RANDOM" });
ok("random placement readies everyone",
  socks.u0.last("BATTLE_STATE").game.players.every((p) => p.ready));
ok("you can see your own fleet", socks.u0.last("BATTLE_STATE").yourFleet.length === 5);

const spy = socks.u1.last("BATTLE_STATE");
ok("you cannot see anyone else's ships",
  !JSON.stringify(spy.game.players).includes('"cells"'));

console.log("\nstarting");
await say("u0", { type: "BATTLE_START" });
let st = socks.u0.last("BATTLE_STATE").game;
ok("battle is active", st.phase === "ACTIVE");
ok("somebody has the turn", !!st.turnUid);
ok("a turn clock is running", st.turnEndsAt > Date.now());

const turn = () => game.g.turnUid;
const other = (uid) => Object.values(game.g.players).find((p) => p.alive && p.uid !== uid).uid;

console.log("\nfiring");
await say(other(turn()), { type: "BATTLE_FIRE", target: turn(), cells: ["0,0", "0,1"] });
ok("you cannot fire out of turn", /Not your turn/.test(socks[other(turn())].last("BATTLE_ERROR").message));

let shooter = turn();
await say(shooter, { type: "BATTLE_FIRE", target: other(shooter), cells: ["0,0"] });
ok("one shot is refused", /2 different squares/.test(socks[shooter].last("BATTLE_ERROR").message));

await say(shooter, { type: "BATTLE_FIRE", target: other(shooter), cells: ["0,0", "0,0"] });
ok("the same square twice is refused", /2 different squares/.test(socks[shooter].last("BATTLE_ERROR").message));

await say(shooter, { type: "BATTLE_FIRE", target: shooter, cells: ["0,0", "0,1"] });
ok("you cannot fire at yourself", /live opponent/.test(socks[shooter].last("BATTLE_ERROR").message));

const victim = other(shooter);
await say(shooter, { type: "BATTLE_FIRE", target: victim, cells: ["0,0", "0,1"] });
const feed = socks.u2.last("BATTLE_FEED");
ok("the shot is reported to everyone", /fired 2 shots/.test(feed.entry.text));
ok("the report counts hits and misses", /\d+ Hit, \d+ Miss/.test(feed.entry.text));
ok("the turn passed on", turn() !== shooter);

console.log("\ntarget cooldown, live");
// Walk the shooter back around to the same victim without the required gap.
const meState = () => socks[shooter].last("BATTLE_STATE");

// Every shot needs fresh squares and a legal target, or the turn never moves.
let nextCell = 0;
const freshCells = (target) => {
  const out = [];
  while (out.length < 2 && nextCell < SIZE * SIZE) {
    const cell = `${Math.floor(nextCell / SIZE)},${nextCell % SIZE}`;
    nextCell++;
    if (!game.g.players[target].board.incoming.includes(cell)) out.push(cell);
  }
  return out;
};

let spins = 0;
while (turn() !== shooter && spins++ < 20) {
  const t = turn();
  const legal = targetOptions(t, game.g.players, game.g.players[t].history).find((o) => o.allowed);
  await say(t, { type: "BATTLE_FIRE", target: legal.uid, cells: freshCells(legal.uid) });
}
ok("the turn came back around", turn() === shooter);
await say(shooter, { type: "BATTLE_FIRE", target: victim, cells: ["1,0", "1,1"] });
ok("returning to the same target too soon is refused",
  /more before returning/.test(socks[shooter].last("BATTLE_ERROR").message));

const offered = meState().targets;
ok("the target list marks who is blocked", offered.some((t) => !t.allowed));
ok("blocked targets carry a reason", offered.filter((t) => !t.allowed).every((t) => !!t.reason));
ok("other targets remain open", offered.some((t) => t.allowed));

console.log("\nchat");
await say("u2", { type: "BATTLE_SAY", text: "watch the north edge" });
ok("chat reaches everyone", socks.u4.last("BATTLE_CHAT").text === "watch the north edge");
ok("chat is attributed", socks.u4.last("BATTLE_CHAT").name === "Cho");

console.log("\nelimination and finish");
// Sink everyone but one, straight through the model.
const alive = () => Object.values(game.g.players).filter((p) => p.alive);
let guard = 0;
while (alive().length > 1 && guard++ < 40) {
  const t = turn();
  const victims = alive().filter((p) => p.uid !== t);
  const mark = victims[0];
  for (const ship of mark.board.ships) {
    for (const cell of ship.cells) {
      if (!mark.board.incoming.includes(cell)) { mark.board.incoming.push(cell); ship.hits.push(cell); }
    }
    ship.sunk = true;
  }
  mark.alive = false;
  game.g.eliminated.push(mark.uid);
  if (alive().length <= 1) { await game.finish(); break; }
  await game.nextTurn();
}

const over = socks.u0.last("BATTLE_OVER");
ok("the battle ended", !!over);
ok("everyone is placed", over.results.length === 5);
ok("the survivor is first", over.results[0].status === "won");
ok("MMR was awarded", over.results.every((r) => typeof r.gain === "number" && r.gain >= 0));
ok("nobody lost MMR", over.results.every((r) => r.mmrAfter >= r.mmrBefore));
ok("five captains scored as a rumble", over.mode === "rumble");
ok("phase is over", game.g.phase === "OVER");


console.log("\nsolo against the AI");
const soloState = makeState();
const solo = new BattleRoyale(soloState, env);
await soloState._init;
const one = new FakeSocket("h1", "Hana");
soloState.acceptWebSocket(one);
await solo.onJoin("h1", "Hana", "SOLO", one);
const soloSay = (obj) => solo.webSocketMessage(one, JSON.stringify(obj));

await soloSay({ type: "BATTLE_START" });
ok("one captain alone cannot start", /at least 2/.test(one.last("BATTLE_ERROR").message));

await soloSay({ type: "BATTLE_SOLO", on: true, level: "hard" });
ok("solo mode is recorded", solo.g.solo === true);
ok("difficulty is recorded", solo.g.aiLevel === "hard");
ok("difficulties are published", one.last("BATTLE_STATE").game.difficulties.length === 3);

await soloSay({ type: "BATTLE_RANDOM" });
await soloSay({ type: "BATTLE_START" });
ok("solo starts with an AI opponent", solo.g.phase === "ACTIVE");
ok("the AI has a fleet", solo.g.players.ai.board.ships.length === 5);
ok("the AI is named for its level", /Hard/.test(solo.g.players.ai.name));
ok("the AI never sees your ships",
  !JSON.stringify(one.last("BATTLE_STATE").game.players.find((p) => p.uid === "ai")).includes("cells"));

// Play it out: the human fires legally each turn, the AI answers by itself.
let cellNo = 0;
const nextFree = (target) => {
  const out = [];
  while (out.length < 2 && cellNo < SIZE * SIZE) {
    const cell = `${Math.floor(cellNo / SIZE)},${cellNo % SIZE}`;
    cellNo++;
    if (!solo.g.players[target].board.incoming.includes(cell)) out.push(cell);
  }
  return out;
};
let turns = 0;
while (solo.g.phase === "ACTIVE" && turns++ < 120) {
  if (solo.g.turnUid !== "h1") break;
  await soloSay({ type: "BATTLE_FIRE", target: "ai", cells: nextFree("ai") });
}
ok("the game reached a conclusion", solo.g.phase === "OVER");
const soloOver = one.last("BATTLE_OVER");
ok("both captains are placed", soloOver.results.length === 2);
ok("the AI took its own turns", solo.g.players.ai.memory.shots.length > 0);
ok("the AI's shots were all distinct",
  new Set(solo.g.players.ai.memory.shots).size === solo.g.players.ai.memory.shots.length);
ok("a human result is present", soloOver.results.some((r) => r.uid === "h1"));


console.log("\nanonymous play");
const anonState = makeState();
const anonGame = new BattleRoyale(anonState, env);
await anonState._init;
const cap = {};
for (const [uid, nm] of [["a1", "Alfie"], ["a2", "Bex"], ["a3", "Caro"], ["a4", "Dara"]]) {
  const ws = new FakeSocket(uid, nm);
  cap[uid] = ws;
  anonState.acceptWebSocket(ws);
  await anonGame.onJoin(uid, nm, "HIDE", ws);
}
const anonSay = (uid, obj) => anonGame.webSocketMessage(cap[uid], JSON.stringify(obj));

await anonSay("a2", { type: "BATTLE_ANON", on: true });
ok("only the host can hide names", /Only the host/.test(cap.a2.last("BATTLE_ERROR").message));

await anonSay("a1", { type: "BATTLE_ANON", on: true });
ok("the host can hide names", anonGame.g.anon === true);

for (const uid of Object.keys(cap)) await anonSay(uid, { type: "BATTLE_RANDOM" });
await anonSay("a1", { type: "BATTLE_START" });

const seen = cap.a3.last("BATTLE_STATE").game;
ok("real names are gone from the roster",
  !seen.players.some((p) => ["Alfie", "Bex", "Caro", "Dara"].includes(p.name)));
ok("everyone has an alias", seen.players.every((p) => /^Captain \d+$/.test(p.name)));
ok("aliases are unique", new Set(seen.players.map((p) => p.name)).size === seen.players.length);
ok("the state says it is anonymous", seen.anon === true);

const shooter2 = anonGame.g.turnUid;
const victim2 = Object.values(anonGame.g.players).find((p) => p.alive && p.uid !== shooter2).uid;
await anonSay(shooter2, { type: "BATTLE_FIRE", target: victim2, cells: ["0,0", "9,9"] });
ok("the shot feed uses aliases too",
  /Captain \d+ fired/.test(cap.a4.last("BATTLE_FEED").entry.text) &&
  !/Alfie|Bex|Caro|Dara/.test(cap.a4.last("BATTLE_FEED").entry.text));

await anonSay("a4", { type: "BATTLE_SAY", text: "who is that" });
ok("chat is anonymous while playing", /^Captain \d+$/.test(cap.a1.last("BATTLE_CHAT").name));

anonGame.g.phase = "OVER";
ok("names come back once it's over", anonGame.nameOf(anonGame.g.players.a1) === "Alfie");


console.log("\nending a match early");
const endState = makeState();
const endGame = new BattleRoyale(endState, env);
await endState._init;
const cs = {};
for (const [uid, nm] of [["e1", "Ada"], ["e2", "Bo"], ["e3", "Cy"]]) {
  const ws = new FakeSocket(uid, nm);
  cs[uid] = ws;
  endState.acceptWebSocket(ws);
  await endGame.onJoin(uid, nm, "STOP", ws);
}
const esay = (uid, obj) => endGame.webSocketMessage(cs[uid], JSON.stringify(obj));

await esay("e1", { type: "BATTLE_END" });
ok("cannot end a match that hasn't started", /No battle is running/.test(cs.e1.last("BATTLE_ERROR").message));

for (const uid of Object.keys(cs)) await esay(uid, { type: "BATTLE_RANDOM" });
await esay("e1", { type: "BATTLE_START" });

await esay("e2", { type: "BATTLE_END" });
ok("only the host can end it", /Only the host/.test(cs.e2.last("BATTLE_ERROR").message));

// Give one captain some damage so the ranking has something to sort on.
endGame.g.players.e3.sunk = 2;
endGame.g.players.e3.hits = 9;
endGame.g.players.e2.hits = 3;

await esay("e1", { type: "BATTLE_END" });
const ended = cs.e1.last("BATTLE_OVER");
ok("the host can end it", endGame.g.phase === "OVER");
ok("everyone still gets a result", ended.results.length === 3);
ok("the most damage ranks first", ended.results[0].uid === "e3");
ok("MMR is awarded anyway", ended.results.every((r) => typeof r.gain === "number" && r.gain >= 0));
ok("nobody loses MMR by stopping early", ended.results.every((r) => r.mmrAfter >= r.mmrBefore));


console.log("\njoining a battle already under way");
const lateState = makeState();
const lateGame = new BattleRoyale(lateState, env);
await lateState._init;
const lc = {};
const seat = async (uid, nm) => {
  const ws = new FakeSocket(uid, nm);
  lc[uid] = ws; lateState.acceptWebSocket(ws);
  await lateGame.onJoin(uid, nm, "LATE", ws);
  return ws;
};
const lsay = (uid, o) => lateGame.webSocketMessage(lc[uid], JSON.stringify(o));

for (const [u, n] of [["l1", "Ana"], ["l2", "Bo"], ["l3", "Cy"]]) await seat(u, n);
for (const u of ["l1", "l2", "l3"]) await lsay(u, { type: "BATTLE_RANDOM" });
await lsay("l1", { type: "BATTLE_START" });
ok("the battle is running", lateGame.g.phase === "ACTIVE");

await seat("l4", "Dev");
ok("a latecomer is admitted", !!lateGame.g.players.l4 && lateGame.g.players.l4.alive === true);
ok("they are told to lay a fleet", !!lc.l4.last("BATTLE_LATE"));
ok("with ten seconds to do it",
  lc.l4.last("BATTLE_LATE").placeBy - lc.l4.last("BATTLE_LATE").serverNow === 10_000);
ok("they have no fleet yet", lateGame.g.players.l4.board === null);
ok("they are in the turn order", lateGame.g.order.includes("l4"));

const beforeShot = lateGame.g.turnUid;
await lsay(beforeShot, { type: "BATTLE_FIRE", target: "l4", cells: ["0,0", "0,1"] });
ok("nobody can fire at a captain still placing",
  /still laying their fleet/.test(lc[beforeShot].last("BATTLE_ERROR").message));

await lsay("l4", { type: "BATTLE_PLACE", placements: randomFleet() });
ok("a latecomer may lay their own fleet", lateGame.g.players.l4.board.ships.length === 5);
ok("and the clock on them stops", lateGame.g.players.l4.placingUntil === null);

console.log("\nleaving one too late");
await seat("l5", "Eli");
lateGame.g.players.l5.placingUntil = Date.now() - 1;
await lateGame.alarm();
ok("a fleet is laid for whoever ran out of time", lateGame.g.players.l5.board.ships.length === 5);

console.log("\nthe door closes at the end");
// Sink everyone down to two captains on two ships each.
const standing = () => Object.values(lateGame.g.players).filter((p) => p.alive);
for (const p of standing().slice(2)) { p.alive = false; }
for (const p of standing()) { p.board.ships.slice(0, 3).forEach((s) => { s.sunk = true; }); }
await seat("l6", "Fay");
ok("the last two are left alone", !lateGame.g.players.l6);
ok("and the newcomer is told why", /down to the last two/.test(lc.l6.last("BATTLE_ERROR").message));

console.log("\nan empty room");
for (const ws of Object.values(lc)) ws.open = false;
await lateGame.alarm();
ok("a battle with nobody in it does not end", lateGame.g !== null && lateGame.g.phase === "ACTIVE");
ok("and every fleet is still there",
  Object.values(lateGame.g.players).filter((p) => p.board).length >= 4);


console.log("\nthe result holds before it closes");
{
  const holdState = makeState();
  const hold = new BattleRoyale(holdState, env);
  await holdState._init;
  const hs = {};
  for (const [u, n] of [["h1", "Ana"], ["h2", "Bo"]]) {
    const ws = new FakeSocket(u, n);
    hs[u] = ws; holdState.acceptWebSocket(ws);
    await hold.onJoin(u, n, "HOLD", ws);
    await hold.webSocketMessage(ws, JSON.stringify({ type: "BATTLE_RANDOM" }));
  }
  await hold.webSocketMessage(hs.h1, JSON.stringify({ type: "BATTLE_START" }));

  // Sink one outright.
  const victim = hold.g.players.h2;
  for (const ship of victim.board.ships) {
    for (const cell of ship.cells) { victim.board.incoming.push(cell); ship.hits.push(cell); }
    ship.sunk = true;
  }
  victim.alive = false;
  hold.g.eliminated.push("h2");
  await hold.finish();

  const over = hs.h1.last("BATTLE_OVER");
  ok("a winner is announced", !!over && over.results[0].status === "won");
  ok("points are awarded at that moment", over.results.every((r) => typeof r.gain === "number"));
  ok("nobody's MMR went backwards", over.results.every((r) => r.mmrAfter >= r.mmrBefore));
  ok("the result is held, not closed", hold.g.closesAt > Date.now());
  ok("five seconds of it", Math.round((hold.g.closesAt - Date.now()) / 1000) === 5);

  ok("closing early does nothing", (await hold.alarm(), hold.g.closesAt !== null));

  hold.g.closesAt = Date.now() - 1;
  await hold.alarm();
  ok("after the wait it officially ends", !!hs.h1.last("BATTLE_CLOSED"));
  ok("and the table is still there to read", hold.g !== null && hold.g.phase === "OVER");
}

console.log("\nnobody left in the room");
{
  const goneState = makeState();
  const gone = new BattleRoyale(goneState, env);
  await goneState._init;
  const gws = {};
  for (const [u, n] of [["g1", "Ana"], ["g2", "Bo"]]) {
    const ws = new FakeSocket(u, n);
    gws[u] = ws; goneState.acceptWebSocket(ws);
    await gone.onJoin(u, n, "GONE", ws);
    await gone.webSocketMessage(ws, JSON.stringify({ type: "BATTLE_RANDOM" }));
  }
  await gone.webSocketMessage(gws.g1, JSON.stringify({ type: "BATTLE_START" }));
  for (const ws of Object.values(gws)) ws.open = false;
  await gone.onGone(gws.g1);
  await gone.alarm();
  ok("everyone leaving does not end the battle", gone.g !== null && gone.g.phase === "ACTIVE");
  ok("the fleets survive it", Object.values(gone.g.players).every((p) => p.board));
}


console.log("\nthe room outlives everyone");
const roomState = makeState();
const room = new BattleRoyale(roomState, env);
await roomState._init;
const rs = {};
for (const [uid, nm] of [["r1", "Ana"], ["r2", "Bo"], ["r3", "Cy"]]) {
  const ws = new FakeSocket(uid, nm);
  rs[uid] = ws;
  roomState.acceptWebSocket(ws);
  await room.onJoin(uid, nm, "STAY", ws);
}
const rsay = (uid, o) => room.webSocketMessage(rs[uid], JSON.stringify(o));
for (const u of Object.keys(rs)) await rsay(u, { type: "BATTLE_RANDOM" });
await rsay("r1", { type: "BATTLE_START" });
ok("the battle is running", room.g.phase === "ACTIVE");
ok("the first in is host", room.g.hostUid === "r1");

// The host closes their tab.
rs.r1.open = false;
await room.onGone(rs.r1);
ok("the battle does not end when the host leaves", room.g.phase === "ACTIVE");
ok("the room passes to the next player", room.g.hostUid === "r2");
ok("and it says so in the feed", /running the match now/.test(room.g.feed[0].text));

await rsay("r2", { type: "BATTLE_END" });
ok("the new host can close it", room.g.phase === "OVER");

console.log("\nan empty room keeps its battle");
const emptyState = makeState();
const empty = new BattleRoyale(emptyState, env);
await emptyState._init;
const es = {};
for (const [uid, nm] of [["e1", "Ana"], ["e2", "Bo"]]) {
  const ws = new FakeSocket(uid, nm);
  es[uid] = ws;
  emptyState.acceptWebSocket(ws);
  await empty.onJoin(uid, nm, "EMPTY", ws);
}
for (const u of Object.keys(es)) await empty.webSocketMessage(es[u], JSON.stringify({ type: "BATTLE_RANDOM" }));
await empty.webSocketMessage(es.e1, JSON.stringify({ type: "BATTLE_START" }));

es.e1.open = false; es.e2.open = false;
await empty.onGone(es.e1);
await empty.onGone(es.e2);
ok("nobody left, and the battle still stands", empty.g.phase === "ACTIVE");
await empty.alarm();
ok("the alarm leaves it alone", empty.g && empty.g.phase === "ACTIVE");

// Somebody comes back to a hostless room.
es.e2.open = true;
await empty.onJoin("e2", "Bo", "EMPTY", es.e2);
ok("the returning player takes the room", empty.g.hostUid === "e2");
await empty.webSocketMessage(es.e2, JSON.stringify({ type: "BATTLE_END" }));
ok("and can end it", empty.g.phase === "OVER");

console.log(bad ? `\n${bad} failing\n` : "\nall battle table checks passed\n");
process.exit(bad ? 1 : 0);
