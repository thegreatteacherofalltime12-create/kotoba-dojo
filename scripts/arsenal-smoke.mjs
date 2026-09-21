// node scripts/arsenal-smoke.mjs
//
// The Battleship arsenal, driven through the room. There is no shop here, so
// tokens are armed straight onto the players; what is tested is every rule
// that follows — the caps, the blasts, the shield, the torpedo, the spend.
import { BattleRoyale } from "../src/battle-lobby.js";
import { blastArea, extraHulls, validateFleet, randomFleet, battleScore, ARM_CAP, NUKE_MAX } from "../src/battleship.js";

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

console.log("\nthe rules");
ok("a 3x3 nuke centres on its square", blastArea("5,5", 3, 10).join(" ") === "4,4 4,5 4,6 5,4 5,5 5,6 6,4 6,5 6,6");
ok("a 7x7 nuke at the corner is clipped", blastArea("0,0", 7, 20).length === 16);
ok("a 6x6 strike always lands whole, sliding in from the edge", blastArea("9,9", 6, 10).length === 36 && blastArea("9,9", 6, 10)[0] === "4,4");
ok("three extra hulls of any type", extraHulls(["carrier", "carrier", "destroyer"]).map((h) => h.len).join() === "5,5,2");
ok("a fourth hull is dropped and junk ignored", extraHulls(["cruiser", "x", "cruiser", "cruiser", "cruiser"]).length === 3);
const extra = extraHulls(["cruiser", "submarine", "destroyer"]);
ok("a random fleet carries the extras", randomFleet("easy", extra).length === 8);
ok("and validates with them", validateFleet(randomFleet("easy", extra), "easy", extra).ok === true);
ok("but not without", validateFleet(randomFleet("easy", extra), "easy").ok === false);
ok("blast hits score but do not sharpen the aim",
  battleScore({ hits: 4, sunk: 1, shots: 4, blast: 3, field: 2, placement: 2 }) < battleScore({ hits: 4, sunk: 1, shots: 4, field: 2, placement: 2 }));

console.log("\narming");
const env = { FIREBASE_PROJECT_ID: "test" };
const state = makeState();
const game = new BattleRoyale(state, env);
await state._init;
const socks = {};
for (const [uid, name] of [["u0", "Ana"], ["u1", "Bo"]]) {
  const ws = new FakeSocket(uid, name);
  socks[uid] = ws;
  state.acceptWebSocket(ws);
  await game.onJoin(uid, name, "ARS", ws);
}
const say = (uid, obj) => game.webSocketMessage(socks[uid], JSON.stringify(obj));

await say("u0", { type: "ARM_TOKEN", key: "bs_nuke" });
ok("nothing held means nothing armed", /hold no more/.test(socks.u0.last("TOKENS").error));
await say("u0", { type: "ARM_TOKEN", key: "bs_laser" });
ok("an unknown token is refused", /No such token/.test(socks.u0.last("TOKENS").error));

// Straight onto the players, as the shop would have allowed.
const ana = game.g.players.u0, bo = game.g.players.u1;
ana.ars = { armed: { bs_nuke: 2, bs_shots: 2, bs_strike: 1 }, used: {}, hulls: [], shield: null, extraTurn: null, intel: {}, blast: 0 };
bo.ars = { armed: { bs_shield: 1, bs_torpedo: 1, bs_reveal: 1, bs_ships: 1 }, used: {}, hulls: ["carrier", "cruiser", "destroyer"], shield: null, extraTurn: null, intel: {}, blast: 0 };
await say("u0", { type: "TOKENS" });
let view = socks.u0.last("TOKENS").arsenal;
ok("the tab sees what is armed", view.armed.bs_nuke === 2 && view.cap === ARM_CAP && view.nukeMax === NUKE_MAX && view.on === true);
await say("u1", { type: "DISARM_TOKEN", key: "bs_reveal" });
ok("an unused token can be put back", !game.g.players.u1.ars.armed.bs_reveal);
bo.ars.armed.bs_reveal = 1;

await say("u1", { type: "BATTLE_RANDOM" });
ok("Bo's random fleet carries the three extra hulls", game.g.players.u1.board.ships.length === 8);
ok("and his own fleet spec says so", socks.u1.last("BATTLE_STATE").yourFleetSpec.length === 8);
await say("u0", { type: "BATTLE_RANDOM" });
ok("Ana's does not", game.g.players.u0.board.ships.length === 5);

console.log("\nfiring");
await say("u0", { type: "BATTLE_START" });
ok("under way", game.g.phase === "ACTIVE" && game.g.turnNo === 1);
// The draw for first go is random; the test wants Ana first.
game.g.order = ["u0", "u1"]; game.g.turnUid = "u0";

// Whoever is up: Ana nukes, Bo shields then torpedoes.
async function anaTurn() {
  await say("u0", { type: "BATTLE_ARSENAL", action: "extra" });
  ok("extra shots called: four this turn on Skirmish", socks.u0.last("BATTLE_STATE").yourShots === 4);
  await say("u0", { type: "BATTLE_ARSENAL", action: "extra" });
  ok("only once a turn", /already called/.test(socks.u0.last("BATTLE_ERROR").message));
  const ship = game.g.players.u1.board.ships[0];
  await say("u0", { type: "BATTLE_ARSENAL", action: "nuke", target: "u1", cell: ship.cells[0] });
  ok("a Skirmish nuke on a ship sinks the whole thing", ship.sunk === true && ship.hits.length === ship.len);
  ok("the nuke is used, the turn is gone", game.g.players.u0.ars.used.bs_nuke === 1 && game.g.turnUid === "u1");
  ok("the blast is counted apart from aimed hits", game.g.players.u0.ars.blast === ship.len && game.g.players.u0.hits === ship.len);
}
async function boTurn() {
  await say("u1", { type: "BATTLE_ARSENAL", action: "shield", cell: "0,0" });
  const sh = game.g.players.u1.ars.shield;
  ok("the shield covers 36 squares from the corner", sh && sh.cells.length === 36 && !sh.spent);
  ok("nobody else sees it", socks.u0.last("BATTLE_STATE").game.players.find((p) => p.uid === "u1").shieldShown.length === 0);
  await say("u1", { type: "BATTLE_ARSENAL", action: "reveal", target: "u0" });
  ok("a reveal on an undefended captain says so", /no Air Strike Defence/.test(socks.u1.last("BATTLE_NOTE").text));
  const free = (() => { for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) { const k = `${r},${c}`; if (!game.g.players.u0.board.incoming.includes(k)) return k; } })();
  const shotsBefore = game.g.players.u1.shots || 0;
  await say("u1", { type: "BATTLE_ARSENAL", action: "torpedo", target: "u0", cell: free });
  ok("a torpedo is one extra shot and the turn goes on", (game.g.players.u1.shots || 0) === shotsBefore + 1 && game.g.turnUid === "u1");
  await say("u1", { type: "BATTLE_ARSENAL", action: "torpedo", target: "u0", cell: free });
  ok("one torpedo armed, one torpedo fired", /No Submarine Torpedo armed/.test(socks.u1.last("BATTLE_ERROR").message));
  // Bo's volley ends his turn.
  const cells = [];
  for (let r = 9; r >= 0 && cells.length < 2; r--) for (let c = 9; c >= 0 && cells.length < 2; c--) { const k = `${r},${c}`; if (!game.g.players.u0.board.incoming.includes(k)) cells.push(k); }
  await say("u1", { type: "BATTLE_FIRE", volley: [{ target: "u0", cells }] });
  ok("the volley ends the turn", game.g.turnUid === "u0");
}
await anaTurn();
await boTurn();

// Ana's air strike into Bo's shield.
await say("u0", { type: "BATTLE_ARSENAL", action: "strike", target: "u1", cell: "0,0" });
const shield = game.g.players.u1.ars.shield;
ok("the strike lands inside the shield and is absorbed", shield.spent === true);
ok("the room tells everyone about the absorbed squares", /absorbed 36 squares/.test(game.g.feed[0].text));
ok("the spent shield is now public", socks.u0.last("BATTLE_STATE").game.players.find((p) => p.uid === "u1").shieldShown.length === 36);
ok("the strike took the turn", game.g.turnUid === "u1");

console.log("\nthe spend");
await say("u0", { type: "BATTLE_END" });
const over = socks.u0.last("BATTLE_OVER");
ok("the battle is over", game.g.phase === "OVER" && over);
const anaRow = over.results.find((r) => r.uid === "u0");
const boRow = over.results.find((r) => r.uid === "u1");
ok("Ana's row spends what she fired: a nuke, the extra shots, the strike",
  anaRow.spent.bs_nuke === 1 && anaRow.spent.bs_shots === 1 && anaRow.spent.bs_strike === 1);
ok("her second nuke, never fired, is not spent", !("bs_nuke" in anaRow.spent) || anaRow.spent.bs_nuke === 1);
ok("Bo's row spends the shield, the reveal and the torpedo", boRow.spent.bs_shield === 1 && boRow.spent.bs_reveal === 1 && boRow.spent.bs_torpedo === 1);
ok("accuracy leaves the blast out", anaRow.accuracy <= 100);

console.log(bad ? `\n${bad} failing\n` : "\nall arsenal checks passed\n");
process.exit(bad ? 1 : 0);
