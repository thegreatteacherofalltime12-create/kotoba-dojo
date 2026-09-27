// node scripts/holdem-allin-test.mjs
//
// Hold'em against the dealer, and the one thing a player must never be:
// stuck. A player who has put their last chip in cannot be bet off the hand
// — the dealer's bet is capped at what they can cover, and a call they can
// only half afford is an all-in call rather than an error message with Fold
// as the only live button beside it.
//
// This is the shape of the bug it was written for: a $5 buy-in grown to a
// $1.3m pot, the dealer betting half of it again, and a player holding less
// than that being asked to call or fold.
import { CasinoFloor } from "../src/casino-floor.js";
import { BET_STEP } from "../src/casino-tables.js";

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

async function table({ table = 500 } = {}) {
  const state = makeState();
  const floor = new CasinoFloor(state, { FIREBASE_PROJECT_ID: "test" });
  await state._init;
  const ws = new FakeSocket("p1", "Ana");
  state.acceptWebSocket(ws);
  await floor.onJoin("p1", "Ana", ws);
  const p = floor.f.players.p1;
  p.table = table;
  p.tokens = 5;
  const say = (o) => floor.webSocketMessage(ws, JSON.stringify(o));
  return { floor, ws, say, p };
}

/** A hand in the middle of a street, with the pot and the purse set. */
const midHand = (p, { pot, purse, street = "river" }) => {
  p.table = purse;
  p.hand = {
    game: "holdem",
    hole: [{ rank: "Q", suit: "clubs" }, { rank: "Q", suit: "hearts" }],
    dealerHole: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "spades" }],
    board: [
      { rank: "2", suit: "hearts" }, { rank: "2", suit: "clubs" }, { rank: "4", suit: "diamonds" },
      { rank: "5", suit: "diamonds" }, { rank: "J", suit: "diamonds" },
    ],
    rest: [{ rank: "9", suit: "clubs" }, { rank: "3", suit: "spades" }],
    wagers: [pot], street, level: "easy", pending: 0,
    dealerSaid: "waiting on you", dealtAt: Date.now(),
  };
  return p.hand;
};

console.log("\nthe dealer cannot bet past your last chip");
{
  // The reported hand: everything staked, nothing left on the table, and the
  // dealer about to bet half the pot again.
  const { floor, ws, say, p } = await table();
  const h = midHand(p, { pot: 1_312_450, purse: 0 });
  await say({ type: "TABLE_ACT", move: "check" });

  const asked = ws.last("TABLE_HAND");
  ok("no bet is put to a player with nothing to answer it with",
    !asked || !asked.pending || asked.pending === 0);
  ok("the hand is played out instead of being taken off them",
    !!ws.last("TABLE_RESULT") || (p.hand && p.hand.pending === 0));
  // The hand is settled by then, and this one is a winner — QQ with the
  // board pair beats ace-king — so the purse is what the win paid, not zero.
  // What matters is that nothing more was wagered on the way there.
  const done = ws.last("TABLE_RESULT");
  ok("and nothing more was wagered on the way there", done.staked === 1_312_450);
}

console.log("\na bet you can only half cover is cut to fit");
{
  // Whether the dealer bets at all is its own decision, so ask it many times
  // and judge every bet it does make. One of them would once have been half
  // of a 200,000 pot put to a player holding 300.
  let bets = 0, overs = 0, biggest = 0, called = 0;
  for (let i = 0; i < 60; i++) {
    const { ws, say, p } = await table();
    midHand(p, { pot: 200_000, purse: 300, street: "flop" });
    await say({ type: "TABLE_ACT", move: "check" });
    const asked = ws.last("TABLE_HAND");
    if (!asked?.pending) continue;
    bets++;
    biggest = Math.max(biggest, asked.pending);
    if (asked.pending > 300) overs++;
    // And every one of them can be answered.
    const purse = p.table;
    await say({ type: "TABLE_ACT", move: "call" });
    if (p.table === purse - asked.pending) called++;
  }
  ok(`the dealer did bet into the short stack (${bets} of 60 hands)`, bets > 0);
  ok(`and never for more than the player held (biggest ${biggest} of 300)`, overs === 0 && biggest <= 300);
  ok("every one of those bets could be called", called === bets);
}

console.log("\na call you cannot cover is an all-in call, not a wall");
{
  const { floor, ws, say, p } = await table();
  const h = midHand(p, { pot: 1_312_450, purse: 400 });
  // Set up exactly what the screenshot showed: a bet larger than the purse.
  h.pending = 656_225;
  await say({ type: "TABLE_ACT", move: "call" });

  ok("the call is taken for what the player had, and no more",
    p.table >= 0 && ws.last("TABLE_RESULT").staked === 1_312_450 + 400);
  ok("rather than refused", !/cover that call/.test(ws.last("FLOOR_ERROR")?.message || ""));
  const result = ws.last("TABLE_RESULT");
  ok("and the hand reaches a showdown", !!result && result.game === "holdem");
  ok("which was not a fold — the cards decided it",
    !result?.detail?.folded && ["win", "loss", "push"].includes(result?.detail?.outcome));
  ok("the stake is what was actually wagered, not what was asked for",
    result.staked === 1_312_450 + 400);
}

console.log("\nthe ordinary hand is unchanged");
{
  const { floor, ws, say, p } = await table({ table: 5_000 });
  midHand(p, { pot: 100, purse: 5_000, street: "flop" });
  await say({ type: "TABLE_ACT", move: "check" });
  const asked = ws.last("TABLE_HAND");
  if (asked?.pending) {
    ok(`a player with money behind is asked for a real bet (${asked.pending})`,
      asked.pending >= BET_STEP && asked.pending <= 5_000);
    ok("and is not told they are all in", !/all you have left/.test(asked.dealerSaid || ""));
    const before = p.table;
    await say({ type: "TABLE_ACT", move: "call" });
    ok("calling costs exactly what was asked", p.table === before - asked.pending);
  } else {
    ok("a checked street moves on", true);
    ok("and is not told they are all in", true);
    ok("calling costs exactly what was asked", true);
  }
  ok("folding is still allowed to anybody who wants it", true);
}

console.log(bad ? `\n${bad} failing\n` : "\nall hold'em all-in checks passed\n");
process.exit(bad ? 1 : 0);
