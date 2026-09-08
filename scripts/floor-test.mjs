// node scripts/floor-test.mjs
import { CasinoFloor } from "../src/casino-floor.js";
import { MAX_SEATS, START_TABLE } from "../src/casino-core.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

class FakeSocket {
  constructor(uid, name) { this.attach = { uid, name }; this.inbox = []; this.open = true; }
  serializeAttachment(v) { this.attach = v; }
  deserializeAttachment() { return this.attach; }
  send(raw) { this.inbox.push(JSON.parse(raw)); }
  last(t) { return [...this.inbox].reverse().find((m) => m.type === t); }
}

function makeState() {
  const store = new Map(); const sockets = [];
  let alarm = null;
  return {
    sockets, _init: null, alarmAt: () => alarm,
    blockConcurrencyWhile(fn) { this._init = fn(); return this._init; },
    waitUntil: (p) => p,
    acceptWebSocket: (ws) => sockets.push(ws),
    getWebSockets: () => sockets.filter((s) => s.open),
    storage: {
      get: async (k) => store.get(k),
      put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
      deleteAll: async () => store.clear(),
      setAlarm: async (t) => { alarm = t; }, deleteAlarm: async () => { alarm = null; },
    },
  };
}

const env = { FIREBASE_PROJECT_ID: "test" };   // no service account: banking will refuse
const state = makeState();
const floor = new CasinoFloor(state, env);
await state._init;

const socks = {};
for (const [uid, nm] of [["p1", "Ana"], ["p2", "Bo"], ["p3", "Cy"]]) {
  const ws = new FakeSocket(uid, nm);
  socks[uid] = ws;
  state.acceptWebSocket(ws);
  await floor.onJoin(uid, nm, ws);
}
const say = (uid, o) => floor.webSocketMessage(socks[uid], JSON.stringify(o));

console.log("\nan open lobby");
ok("anyone may walk in", Object.keys(floor.f.players).length === 3);
ok("nobody arrives with money", floor.f.players.p1.table === 0);
await say("p1", { type: "FLOOR_STAKE" });
ok("a stake can be taken once", floor.f.players.p1.table === START_TABLE);
await say("p1", { type: "FLOOR_STAKE" });
ok("but only once", /already taken/.test(socks.p1.last("FLOOR_ERROR").message));
for (const u of ["p2", "p3"]) await say(u, { type: "FLOOR_STAKE" });

console.log("\nthe bet board");
await say("p1", { type: "FLOOR_START" });
ok("no race without a bet", /Place a bet/.test(socks.p1.last("FLOOR_ERROR").message));

await say("p1", { type: "FLOOR_BET", betType: "win", picks: ["hearts"], stake: 20 });
ok("a bet is taken", floor.f.bets.length === 1);
ok("the stake leaves the table", floor.f.players.p1.table === START_TABLE - 20);
ok("the pool grows", floor.f.pool === 20);
ok("everyone can see the slip", socks.p2.last("FLOOR_STATE").floor.bets.length === 1);

await say("p2", { type: "FLOOR_COPY", betId: floor.f.bets[0].id, stake: 10 });
ok("another player can copy it", floor.f.bets.length === 2 && floor.f.bets[1].uid === "p2");
ok("the copy keeps the same picks", floor.f.bets[1].type === "win" && floor.f.bets[1].picks[0] === "hearts");
ok("but pays for it themselves", floor.f.players.p2.table === START_TABLE - 10);

await say("p3", { type: "FLOOR_BET", betType: "long", picks: ["spades"], stake: 5 });
ok("side bets are accepted", floor.f.bets[2].type === "long");
await say("p3", { type: "FLOOR_BET", betType: "win", picks: ["a", "b"], stake: 5 });
ok("a malformed slip is refused", /needs 1 horse/.test(socks.p3.last("FLOOR_ERROR").message));
await say("p3", { type: "FLOOR_BET", betType: "win", picks: ["clubs"], stake: 99999 });
ok("you cannot bet what you don't have", /more than you have/.test(socks.p3.last("FLOOR_ERROR").message));

console.log("\nthe race");
await say("p1", { type: "FLOOR_START" });
ok("the race starts", floor.f.phase === "RUNNING");
await say("p2", { type: "FLOOR_BET", betType: "win", picks: ["clubs"], stake: 5 });
ok("betting closes once it's away", /under way/.test(socks.p2.last("FLOOR_ERROR").message));

let ticks = 0;
while (floor.f.phase === "RUNNING" && ticks++ < 400) await floor.runTick();
ok("the race reaches an end", floor.f.phase === "PAID");
ok("the hurdle row never exceeded five", floor.f.race.hurdles.length <= 5);
ok("each turned hurdle names its suit", floor.f.race.hurdles.every((h) => !!h.suit));
const result = socks.p1.last("FLOOR_RESULT");
ok("a result goes out", !!result && result.order.length === 4);
ok("nobody's table went negative", Object.values(floor.f.players).every((p) => p.table >= 0));

await floor.newRace();
ok("the board reopens", floor.f.phase === "BETTING" && floor.f.bets.length === 0);
ok("the pool resets", floor.f.pool === 0);

console.log("\nthe live table");
await say("p1", { type: "SEAT_TAKE", bet: 10 });
const heldBeforeSeat = floor.f.players.p2.table;
await say("p2", { type: "SEAT_TAKE", bet: 25 });
ok("two seats taken", Object.keys(floor.f.table.seats).length === 2);
ok("the stake leaves the table", floor.f.players.p2.table === heldBeforeSeat - 25);
await say("p2", { type: "SEAT_LEAVE" });
ok("standing up returns the bet", floor.f.players.p2.table === heldBeforeSeat);
await say("p2", { type: "SEAT_TAKE", bet: 25 });

await say("p1", { type: "SEAT_DEAL" });
ok("cards go out", floor.f.table.phase === "ACTING");
ok("every seat has two", Object.values(floor.f.table.seats).every((s) => s.cards.length === 2));
ok("the dealer has two", floor.f.table.dealer.length === 2);
const seen = socks.p3.last("FLOOR_STATE").floor.table.dealer;
ok("the hole card is hidden from the room", seen[1]?.hidden === true);

for (const u of ["p1", "p2"]) await say(u, { type: "SEAT_STAND" });
ok("the hand settles once all stand", floor.f.table.phase === "SETTLED");
ok("every seat has a verdict", Object.values(floor.f.table.seats).every((s) => !!s.result));
await floor.clearTable();
ok("the table reopens", floor.f.table.phase === "OPEN" && !Object.keys(floor.f.table.seats).length);

console.log("\nseating limit");
for (let i = 0; i < MAX_SEATS + 3; i++) {
  const uid = `x${i}`;
  floor.f.players[uid] = { uid, name: `X${i}`, table: 50, tokens: 0, staked: true };
  const ws = new FakeSocket(uid, `X${i}`);
  socks[uid] = ws; state.acceptWebSocket(ws);
  await say(uid, { type: "SEAT_TAKE", bet: 5 });
}
ok(`the table stops at ${MAX_SEATS}`, Object.keys(floor.f.table.seats).length === MAX_SEATS);
ok("the twenty-first is told why", /full at 20/.test(socks[`x${MAX_SEATS + 2}`].last("FLOOR_ERROR").message));

console.log("\nbanking");
await say("p3", { type: "FLOOR_BANK" });
ok("without a wallet to write to, nothing moves",
  floor.f.players.p3.table > 0 && /Couldn't reach your wallet/.test(socks.p3.last("FLOOR_ERROR").message));


console.log("\nmove to earn");
const before = floor.f.players.p1.table;
const beforeTokens = floor.f.players.p1.tokens;
await say("p1", { type: "FLOOR_MOVE", steps: 250, fastSteps: 0 });
ok("a walk pays into the table", floor.f.players.p1.table === before + 20);
ok("and pays tokens", floor.f.players.p1.tokens === beforeTokens + 4);
ok("the leftover fifty are kept", floor.f.players.p1.stepCarry === 50);
ok("the walker is told what they earned", socks.p1.last("FLOOR_WALKED").cash === 20);

await say("p1", { type: "FLOOR_MOVE", steps: 50, fastSteps: 0 });
ok("carried steps complete the next hundred", floor.f.players.p1.table === before + 30);

const fastBefore = floor.f.players.p2.table;
await say("p2", { type: "FLOOR_MOVE", steps: 0, fastSteps: 100 });
ok("a quick pace pays the bonus rate", floor.f.players.p2.table === fastBefore + 10);
ok("and banks the extra twenty toward the next", floor.f.players.p2.stepCarry === 20);

await say("p3", { type: "FLOOR_MOVE", steps: 0, fastSteps: 0 });
ok("a walk of nothing changes nothing", (floor.f.players.p3.stepCarry || 0) === 0);
ok("no MMR is ever involved", !JSON.stringify(socks.p1.last("FLOOR_WALKED")).includes("mmr"));

console.log(bad ? `\n${bad} failing\n` : "\nall floor checks passed\n");
process.exit(bad ? 1 : 0);
