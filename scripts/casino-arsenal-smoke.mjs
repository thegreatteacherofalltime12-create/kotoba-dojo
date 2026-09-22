// node scripts/casino-arsenal-smoke.mjs
//
// The casino arsenal on the floor: the limits, the door, the blackjack
// table's safeties, the track's odds, the arcade's perks and the ceiling.
import { CasinoFloor } from "../src/casino-floor.js";
import { HORSES, placings, oddsFor } from "../src/casino-core.js";
import { ARSENALS } from "../src/arsenals.js";

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

/** A floor with one player, money on the table, and tokens armed. */
async function floorWith(armed, { table = 500, tokens = 2 } = {}) {
  const state = makeState();
  const floor = new CasinoFloor(state, { FIREBASE_PROJECT_ID: "test" });
  await state._init;
  const ws = new FakeSocket("p1", "Ana");
  state.acceptWebSocket(ws);
  await floor.onJoin("p1", "Ana", ws);
  const p = floor.f.players.p1;
  p.table = table;
  p.tokens = tokens;
  p.ars = { ...floor.freshArs(), armed };
  const say = (o) => floor.webSocketMessage(ws, JSON.stringify(o));
  return { floor, ws, say, p };
}

console.log("\narming");
{
  const { floor, ws, say, p } = await floorWith({});
  await say({ type: "ARM_TOKEN", key: "cs_nope" });
  ok("an unknown token is refused", /No such token/.test(ws.last("FLOOR_TOKENS").error));
  await say({ type: "ARM_TOKEN", key: "cs_chips" });
  ok("nothing held means nothing armed", /hold no more/.test(ws.last("FLOOR_TOKENS").error));
  p.ars.armed.cs_cap = 1;
  await say({ type: "ARM_TOKEN", key: "cs_cap" });
  ok("one cap-raise is the limit", /limit for one session/.test(ws.last("FLOOR_TOKENS").error));
  await say({ type: "DISARM_TOKEN", key: "cs_cap" });
  ok("an unused token can be put back", !p.ars.armed.cs_cap);
  ok("eighteen tokens, each with a price and a limit", Object.keys(ARSENALS.casino).length === 18
    && Object.values(ARSENALS.casino).every((t) => t.price > 0 && t.max > 0));
  ok("not one of them hands out cash", Object.keys(ARSENALS.casino).every((k) => k !== "cs_cash"));
}

console.log("\nthe door and the chips");
{
  const { floor, ws, say, p } = await floorWith({ cs_chips: 2, cs_comp: 1 }, { tokens: 0 });
  await say({ type: "FLOOR_ARSENAL", action: "chips" });
  ok("a chip run is five table tokens", p.tokens === 5);
  p.tokens = 0;
  ok("without one the door is shut", floor.noToken({ send: () => {} }, p) === true);
  await say({ type: "FLOOR_ARSENAL", action: "comp" });
  ok("a comp pass opens it", floor.noToken({ send: () => {} }, p) === false && p.ars.comp === true);
  await say({ type: "FLOOR_ARSENAL", action: "comp" });
  ok("and only once", /already open|No Comp Pass armed/.test(ws.last("FLOOR_ERROR").message));
}

console.log("\nthe blackjack table");
{
  const { floor, ws, say, p } = await floorWith({ cs_peek: 2, cs_redeal: 3, cs_tip: 4, cs_count: 3, cs_shoe: 3 });
  await say({ type: "FLOOR_ARSENAL", action: "peek" });
  ok("a peek needs a hand in play", /from a seat/.test(ws.last("FLOOR_ERROR").message));
  await say({ type: "SEAT_TAKE", bet: 50 });
  await say({ type: "SEAT_DEAL" });
  const t = floor.f.table;
  ok("the hand is live", t.phase === "ACTING" && t.seats.p1.cards.length === 2);
  await say({ type: "FLOOR_ARSENAL", action: "peek" });
  ok("the peek names the dealer's hole card", /hole card is/.test(ws.last("FLOOR_NOTE").text));
  const before = t.seats.p1.cards.map((c) => c.rank + c.suit).join();
  await say({ type: "FLOOR_ARSENAL", action: "redeal" });
  ok("a second deal is two fresh cards", t.seats.p1.cards.length === 2 && t.seats.p1.cards.map((c) => c.rank + c.suit).join() !== before);
  const one = t.seats.p1.cards[0].rank + t.seats.p1.cards[0].suit;
  await say({ type: "FLOOR_ARSENAL", action: "tip", index: 0 });
  ok("a tip swaps one card", (t.seats.p1.cards[0].rank + t.seats.p1.cards[0].suit) !== one && t.seats.p1.cards.length === 2);
  await say({ type: "FLOOR_ARSENAL", action: "count" });
  ok("the counter reads the shoe", /tens and \d+ aces left/.test(ws.last("FLOOR_NOTE").text));
  await say({ type: "FLOOR_ARSENAL", action: "shoe" });
  ok("a fresh shoe waits for the hand to end", /Not mid-hand/.test(ws.last("FLOOR_ERROR").message));
}
{
  // A losing hand, with the safeties on.
  const { floor, ws, say, p } = await floorWith({ cs_safe: 4, cs_insure: 2 });
  await say({ type: "FLOOR_ARSENAL", action: "safe" });
  await say({ type: "FLOOR_ARSENAL", action: "insure" });
  await say({ type: "SEAT_TAKE", bet: 50 });
  await say({ type: "SEAT_DEAL" });
  const t = floor.f.table;
  // Rig the hand: the player busts, the dealer stands.
  t.seats.p1.cards = [{ rank: "10", suit: "♠" }, { rank: "9", suit: "♥" }];
  t.dealer = [{ rank: "10", suit: "♣" }, { rank: "K", suit: "♦" }];
  const tokensBefore = p.tokens;
  const tableBefore = p.table;
  await say({ type: "SEAT_STAND" });
  ok("the hand is lost", t.seats.p1.result === "lose");
  ok("the safety held the table token", p.tokens === tokensBefore && p.ars.safe === 0);
  ok("and the policy handed the stake back", p.table === tableBefore + 50 && p.ars.insure === 0);
}
{
  // A push, turned into a win.
  const { floor, ws, say, p } = await floorWith({ cs_tie: 3 });
  await say({ type: "FLOOR_ARSENAL", action: "tie" });
  await say({ type: "SEAT_TAKE", bet: 40 });
  await say({ type: "SEAT_DEAL" });
  const t = floor.f.table;
  t.seats.p1.cards = [{ rank: "10", suit: "♠" }, { rank: "8", suit: "♥" }];
  t.dealer = [{ rank: "10", suit: "♣" }, { rank: "8", suit: "♦" }];
  const tableBefore = p.table;
  await say({ type: "SEAT_STAND" });
  ok("a push pays as a win", t.seats.p1.result === "win" && p.table === tableBefore + 80 && p.ars.tie === 0);
}

console.log("\nthe track");
{
  const { floor, ws, say, p } = await floorWith({ cs_scratch: 3, cs_furlong: 2, cs_double: 2, cs_photo: 3 });
  await say({ type: "FLOOR_ARSENAL", action: "scratch" });
  ok("nothing to scratch yet", /nothing on this race/.test(ws.last("FLOOR_ERROR").message));
  await say({ type: "FLOOR_BET", betType: "win", picks: [HORSES[0].id], stake: 100 });
  ok("the bet is on", floor.f.bets.length === 1 && p.table === 400);
  await say({ type: "FLOOR_ARSENAL", action: "scratch" });
  ok("scratching takes it back with the stake", floor.f.bets.length === 0 && p.table === 500);
  const at = floor.f.race.at[HORSES[1].id];
  await say({ type: "FLOOR_ARSENAL", action: "furlong", horse: HORSES[1].id });
  ok("an extra furlong is a step up the track", floor.f.race.at[HORSES[1].id] === at + 1);
  await say({ type: "FLOOR_ARSENAL", action: "furlong", horse: "nag" });
  ok("a horse that isn't running is refused", /Pick a horse/.test(ws.last("FLOOR_ERROR").message));
  // A winning bet, doubled. The finishing order is the race's own, so the
  // bet is placed on whoever is actually out in front.
  const order = placings(floor.f.race);
  await say({ type: "FLOOR_BET", betType: "win", picks: [order[0]], stake: 100 });
  await say({ type: "FLOOR_ARSENAL", action: "double" });
  const plain = Math.round(100 + 100 * oddsFor("win"));
  const tableBefore = p.table;
  await floor.payOut();
  ok("the doubler pays twice", p.table - tableBefore === plain * 2 && p.ars.double === 0);
  ok("and the log says so", floor.f.log.some((l) => /doubled/.test(l.text)));
}
{
  const { floor, ws, say, p } = await floorWith({ cs_photo: 3 });
  await say({ type: "FLOOR_ARSENAL", action: "photo" });
  const order = placings(floor.f.race);
  await say({ type: "FLOOR_BET", betType: "place", picks: [order[2]], stake: 50 });
  const tableBefore = p.table;
  await floor.payOut();
  ok("a third place pays as a second", p.table > tableBefore && p.ars.photo === 0);
  ok("the log calls it a photo finish", floor.f.log.some((l) => /photo finish/.test(l.text)));
}

console.log("\nthe arcade and the ceiling");
{
  const { floor, say, p } = await floorWith({ cs_flash: 2, cs_credit: 2, cs_cap: 1 });
  await say({ type: "FLOOR_ARSENAL", action: "flash" });
  await say({ type: "FLOOR_ARSENAL", action: "credit" });
  ok("three puzzles of double cash, one of full marks", p.ars.flash === 3 && p.ars.credit === 1);
  let perks = floor.arcadePerks("p1");
  ok("the first puzzle takes both", perks.cash === 2 && perks.fullMmr === true);
  perks = floor.arcadePerks("p1");
  ok("the second still doubles the cash", perks.cash === 2 && perks.fullMmr === false);
  floor.arcadePerks("p1");
  perks = floor.arcadePerks("p1");
  ok("and then the arcade pays its plain rate", perks.cash === 1 && perks.fullMmr === false);
  await say({ type: "FLOOR_ARSENAL", action: "cap" });
  ok("the ceiling is up", p.ars.cap === true);
  // The day's tally, right under the old ceiling.
  const day = new Date().toISOString().slice(0, 10);
  floor.f.mmrDaily = { p1: { day, given: 100, checked: true } };
  const award = await floor.reward("p1", p);
  ok("a win that the old ceiling would have refused pays", award > 0);
  floor.f.mmrDaily = { p1: { day, given: 150, checked: true } };
  ok("and the new one still holds", (await floor.reward("p1", p)) === 0);
}

console.log(bad ? `\n${bad} failing\n` : "\nall casino arsenal checks passed\n");
process.exit(bad ? 1 : 0);
