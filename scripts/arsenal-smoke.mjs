// node scripts/arsenal-smoke.mjs
//
// The Battleship arsenal, driven through the room. There is no shop here, so
// tokens are armed straight onto the players; what is tested is every rule
// that follows — the caps, the blasts, the shield, the torpedo, the spend.
import { BattleRoyale } from "../src/battle-lobby.js";
import { blastArea, extraHulls, validateFleet, randomFleet, battleScore, fireAt, ARSENAL, ARM_CAP, NUKE_MAX } from "../src/battleship.js";

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

/** Two captains on the small chart, fleets down, Ana to fire. */
async function duel(armed) {
  const state = makeState();
  const game = new BattleRoyale(state, { FIREBASE_PROJECT_ID: "test" });
  await state._init;
  const socks = {};
  for (const [uid, name] of [["u0", "Ana"], ["u1", "Bo"]]) {
    const ws = new FakeSocket(uid, name);
    socks[uid] = ws;
    state.acceptWebSocket(ws);
    await game.onJoin(uid, name, "DUEL", ws);
  }
  const say = (uid, obj) => game.webSocketMessage(socks[uid], JSON.stringify(obj));
  await say("u0", { type: "BATTLE_RANDOM" });
  await say("u1", { type: "BATTLE_RANDOM" });
  await say("u0", { type: "BATTLE_START" });
  game.g.order = ["u0", "u1"]; game.g.turnUid = "u0";
  game.g.players.u0.ars = { ...game.freshArs(), armed: armed.a || {} };
  game.g.players.u1.ars = { ...game.freshArs(), armed: armed.b || {} };
  return { game, socks, say };
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

console.log("\nthe scouts");
{
  const { game, socks, say } = await duel({ a: { bs_sonar: 4, bs_radar: 3, bs_spotter: 3, bs_scope: 3 }, b: {} });
  const ana = game.g.players.u0;
  await say("u0", { type: "BATTLE_ARSENAL", action: "scope", target: "u1" });
  ok("the periscope names what is still afloat", /Periscope on .*Carrier \(5\)/.test(socks.u0.last("BATTLE_NOTE").text));
  await say("u0", { type: "BATTLE_ARSENAL", action: "sonar", target: "u1", cell: "5,5" });
  ok("the sonar reports a window of nine", /Sonar Ping .* \d+ ship square.* in those 9\./.test(socks.u0.last("BATTLE_NOTE").text));
  await say("u0", { type: "BATTLE_ARSENAL", action: "radar", target: "u1", line: "r3" });
  ok("the radar reads a row", /Row 4: \d+ ship square/.test(socks.u0.last("BATTLE_NOTE").text));
  await say("u0", { type: "BATTLE_ARSENAL", action: "radar", target: "u1", line: "z9" });
  ok("a line that is not one is refused", /row or a column/.test(socks.u0.last("BATTLE_ERROR").message));
  await say("u0", { type: "BATTLE_ARSENAL", action: "spotter", target: "u1" });
  const found = ana.ars.intel.u1 || [];
  ok("the spotter pinpoints a real ship square", found.length === 1
    && game.g.players.u1.board.ships.some((sh) => sh.cells.includes(found[0])));
  ok("none of the four took the turn", game.g.turnUid === "u0");
  ok("and all four are spent", ana.ars.used.bs_scope === 1 && ana.ars.used.bs_sonar === 1 && ana.ars.used.bs_radar === 1 && ana.ars.used.bs_spotter === 1);
}

console.log("\nfirepower");
{
  const { game, socks, say } = await duel({ a: { bs_depth: 3, bs_priority: 3 }, b: {} });
  const ana = game.g.players.u0;
  await say("u0", { type: "BATTLE_ARSENAL", action: "priority" });
  ok("a priority target lifts the rotation for this turn", ana.ars.priority === game.g.turnNo);
  await say("u0", { type: "BATTLE_ARSENAL", action: "depth", target: "u1", cell: "5,5" });
  ok("a depth charge falls in a cross of five", /depth charge .*over 5 squares/.test(game.g.feed[0].text));
  ok("and it takes the turn", game.g.turnUid === "u1");
  ok("its hits are blast hits, kept out of the aim", (ana.ars.blast || 0) === ana.hits);
}

console.log("\ndamage control");
{
  const { game, socks, say } = await duel({ a: {}, b: { bs_point: 3, bs_armour: 2, bs_repair: 2, bs_evade: 2 } });
  const ana = game.g.players.u0, bo = game.g.players.u1;
  await say("u1", { type: "BATTLE_ARSENAL", action: "point" });
  ok("point defence is ready", bo.ars.point === 1);
  const ship = bo.board.ships[0];
  await say("u0", { type: "BATTLE_FIRE", volley: [{ target: "u1", cells: [ship.cells[0], ship.cells[1]] }] });
  ok("the first shot that would hit is turned aside", ship.hits.length === 1);
  ok("the defence is spent, and the log says so", bo.ars.point === 0 && /turned aside/.test(game.g.feed[0].text));
  ok("the square still counts as fired on", bo.board.incoming.includes(ship.cells[0]));
  await say("u1", { type: "BATTLE_ARSENAL", action: "repair" });
  ok("the repair crew patches the hit and opens the square again", ship.hits.length === 0 && !bo.board.incoming.includes(ship.cells[1]));
}
{
  const { game, say } = await duel({ a: {}, b: { bs_armour: 2, bs_evade: 2 } });
  const bo = game.g.players.u1;
  await say("u1", { type: "BATTLE_ARSENAL", action: "armour" });
  const armoured = bo.board.ships.find((sh) => sh.armour);
  ok("a hull is reinforced", !!armoured && armoured.armour === 1);
  // The first shell bounces and the square stays open, so she needs one
  // more shot than her length.
  let shots = 0;
  for (const c of armoured.cells) { fireAt(bo.board, c); shots++; }
  ok("the first shell bounces off, leaving the water unmarked",
    !armoured.sunk && armoured.hits.length === armoured.len - 1 && !bo.board.incoming.includes(armoured.cells[0]));
  fireAt(bo.board, armoured.cells[0]);
  shots++;
  ok("one more shot than her length puts her down", armoured.sunk === true && shots === armoured.len + 1);
  const mover = bo.board.ships.find((sh) => !sh.sunk && !sh.hits.length && !sh.armour);
  const before = mover.cells.join();
  await say("u1", { type: "BATTLE_ARSENAL", action: "evade" });
  const after = bo.board.ships.find((sh) => sh.id === mover.id);
  ok("an unhit ship slips to a new berth", after.cells.join() !== before && after.cells.length === after.len);
  ok("and she does not sit on another ship",
    !after.cells.some((c) => bo.board.ships.some((sh) => sh.id !== after.id && sh.cells.includes(c))));
}
console.log("\nthe smoke screen");
{
  const { game, socks, say } = await duel({ a: {}, b: { bs_smoke: 1 } });
  const bo = game.g.players.u1;
  await say("u1", { type: "BATTLE_ARSENAL", action: "smoke" });
  ok("the smoke is up", bo.ars.smokeUntil > game.g.turnNo);
  const ship = bo.board.ships[0];
  await say("u0", { type: "BATTLE_FIRE", volley: [{ target: "u1", cells: [ship.cells[0], ship.cells[1]] }] });
  ok("the hits land all the same", ship.hits.length === 2);
  ok("but the shooter is told they missed", /0 Hit, 2 Miss/.test(game.g.feed.find((f) => /fired 2 shots/.test(f.text)).text));
  const seen = socks.u0.last("BATTLE_STATE").game.players.find((x) => x.uid === "u1");
  ok("and their board shows nothing", !seen.struck.includes(ship.cells[0]) && seen.incoming.includes(ship.cells[0]));
  // Round the table until it lifts.
  for (let i = 0; i < 6 && bo.ars.hidden.length; i++) await game.nextTurn();
  ok("when it clears the truth comes out", bo.ars.hidden.length === 0);
  const now = socks.u0.last("BATTLE_STATE").game.players.find((x) => x.uid === "u1");
  ok("the hits appear on the shooter board", now.struck.includes(ship.cells[0]) && now.struck.includes(ship.cells[1]));
}

console.log("\nthe cap");
{
  const { game, socks, say } = await duel({ a: {}, b: {} });
  const ana = game.g.players.u0;
  ana.ars.armed = { bs_sonar: 6 };
  await say("u0", { type: "ARM_TOKEN", key: "bs_scope" });
  ok("six armed is the limit for a battle", /6 tokens is the limit/.test(socks.u0.last("TOKENS").error));
  ana.ars.armed = { bs_nuke: 2 };
  await say("u0", { type: "ARM_TOKEN", key: "bs_nuke" });
  ok("and two nukes", /2 nukes is the limit/.test(socks.u0.last("TOKENS").error));
  ok("every token carries a price and a limit", Object.keys(ARSENAL).length === 18
    && Object.values(ARSENAL).every((t) => t.price > 0));
}

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
