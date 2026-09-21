// node scripts/mines-arsenal-smoke.mjs
//
// The Minesweeper arsenal through the room: the per-round limits, a reveal,
// a buster on a mine and on clean ground, Clear Map with and without a mine
// under it, invincibility defusing a dig, and the spend on the results.
import { MineField } from "../src/mine-lobby.js";
import { isMine, bustBoard, areaCells, MINE_ARSENAL } from "../src/minesweeper.js";

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

async function room(level, uids) {
  const state = makeState();
  const field = new MineField(state, { FIREBASE_PROJECT_ID: "test" });
  await state._init;
  const socks = {};
  for (const uid of uids) {
    const ws = new FakeSocket(uid, uid.toUpperCase());
    socks[uid] = ws;
    state.acceptWebSocket(ws);
    await field.onJoin(uid, uid.toUpperCase(), "MINE", ws);
  }
  const say = (uid, obj) => field.webSocketMessage(socks[uid], JSON.stringify(obj));
  await say(uids[0], { type: "MINE_SOLO", on: uids.length === 1 });
  await say(uids[0], { type: "MINE_LEVEL", level });
  return { field, socks, say };
}
const arm = (p, armed) => { p.ars = { armed, used: {}, busted: [], invincibleUntil: 0, digs: 0 }; };
const safeCell = (board, revealed, avoid = []) => {
  for (let r = 0; r < board.rows; r++) for (let c = 0; c < board.cols; c++) {
    const k = `${r},${c}`;
    if (!isMine(board, k) && revealed[k] === undefined && !avoid.includes(k)) return k;
  }
};

console.log("\nthe rules");
{
  const { field, socks, say } = await room("beginner", ["a"]);
  await say("a", { type: "ARM_TOKEN", key: "ms_reveal" });
  ok("nothing held means nothing armed", /hold no more/.test(socks.a.last("MINE_TOKENS").error));
  await say("a", { type: "ARM_TOKEN", key: "ms_buster" });
  ok("the buster is refused on Beginner", /Intermediate and Expert/.test(socks.a.last("MINE_TOKENS").error));
  const p = field.g.players.a;
  arm(p, { ms_reveal: 2 });
  await say("a", { type: "ARM_TOKEN", key: "ms_reveal" });
  ok("two reveals is the limit", /limit/.test(socks.a.last("MINE_TOKENS").error));
  await say("a", { type: "MINE_START" });
  ok("under way", field.g.phase === "ACTIVE");
  await say("a", { type: "MINE_ARSENAL", action: "reveal" });
  const shown = Object.entries(p.revealed).filter(([, v]) => v === -3).map(([k]) => k);
  ok("a reveal shows two mines, marked apart from dug ground", shown.length === 2 && shown.every((m) => isMine(field.board, m)));
  ok("the shown mines reach the client as -3", Object.values(socks.a.last("MINE_DUG").cells).every((v) => v === -3));
  await say("a", { type: "MINE_DIG", cell: shown[0] });
  ok("a shown mine cannot be dug", p.revealed[shown[0]] === -3 && !p.done);
  ok("shown mines do not count as progress", socks.a.last("MINE_STATE").game.players[0].progress < 100);
  await say("a", { type: "MINE_ARSENAL", action: "reveal" });
  await say("a", { type: "MINE_ARSENAL", action: "reveal" });
  ok("the third reveal is refused", /No Mine Reveal armed/.test(socks.a.last("MINE_ERROR").message));
}

console.log("\nthe buster");
{
  const { field, socks, say } = await room("intermediate", ["a"]);
  const p = field.g.players.a;
  arm(p, { ms_buster: 2 });
  await say("a", { type: "MINE_START" });
  const mine = field.board.mineList.find((m) => p.revealed[m] === undefined);
  await say("a", { type: "MINE_ARSENAL", action: "buster", cell: mine });
  ok("a mine under the buster is gone for this player", p.ars.busted.includes(mine) && !p.done);
  ok("the square opens with a number and is a crater", typeof p.revealed[mine] === "number" && p.revealed[mine] >= 0 && socks.a.last("MINE_DUG").craters[0] === mine);
  const mine2 = field.board.mineList.find((m) => m !== mine && p.revealed[m] === undefined);
  const before = field.board.counts;
  ok("the shared board is untouched", isMine(field.board, mine) && field.board.counts === before);
  const own = field.boardOf(p);
  ok("the player's board has one mine fewer and one more square to clear", own.mineList.length === field.board.mineList.length - 1 && own.safeTotal === field.board.safeTotal + 1);
  const clean = safeCell(own, p.revealed);
  await say("a", { type: "MINE_ARSENAL", action: "buster", cell: clean });
  ok("a buster on clean ground opens it and is spent all the same", p.revealed[clean] !== undefined && p.ars.used.ms_buster === 2 && !socks.a.last("MINE_DUG").craters.length);
  await say("a", { type: "MINE_DIG", cell: mine2 });
  ok("a real mine still ends the sweep", p.done && !p.won);
}

console.log("\nclear map");
{
  const { field, socks, say } = await room("beginner", ["a"]);
  const p = field.g.players.a;
  arm(p, { ms_clear: 1 });
  await say("a", { type: "MINE_START" });
  // A centre whose 5x5 holds no mine, if the board has one; otherwise skip.
  let centre = null;
  for (let r = 0; r < 9 && !centre; r++) for (let c = 0; c < 9 && !centre; c++) {
    const k = `${r},${c}`;
    if (!areaCells(k, 5, 9, 9).some((x) => isMine(field.board, x))) centre = k;
  }
  if (centre) {
    await say("a", { type: "MINE_ARSENAL", action: "clear", cell: centre });
    ok("a clean 5x5 opens without a bang", !p.done && areaCells(centre, 5, 9, 9).every((x) => p.revealed[x] >= 0) && p.ars.used.ms_clear === 1);
  } else {
    await say("a", { type: "MINE_ARSENAL", action: "clear", cell: "4,4" });
    ok("a 5x5 with a mine in it ends the sweep", p.done && !p.won && socks.a.last("MINE_BOOM"));
  }
  await say("a", { type: "MINE_ARSENAL", action: "clear", cell: "0,0" });
  ok("one clear is the limit", /No Clear Map armed/.test(socks.a.last("MINE_ERROR").message));
}
{
  const { field, socks, say } = await room("beginner", ["a"]);
  const p = field.g.players.a;
  arm(p, { ms_clear: 1 });
  await say("a", { type: "MINE_START" });
  await say("a", { type: "MINE_DIG", cell: safeCell(field.board, p.revealed) });
  await say("a", { type: "MINE_ARSENAL", action: "clear", cell: "4,4" });
  ok("clear map is refused once you have dug", /before you have dug/.test(socks.a.last("MINE_ERROR").message) && p.ars.used.ms_clear === undefined);
}
{
  const { field, socks, say } = await room("beginner", ["a"]);
  const p = field.g.players.a;
  arm(p, { ms_clear: 1, ms_shield: 1 });
  await say("a", { type: "MINE_START" });
  const mine = field.board.mineList[0];
  await say("a", { type: "MINE_ARSENAL", action: "shield" });
  ok("invincibility starts a ten-second window", p.ars.invincibleUntil > Date.now() && socks.a.last("MINE_SHIELD"));
  await say("a", { type: "MINE_ARSENAL", action: "clear", cell: mine });
  ok("a clear map over mines while invincible defuses them instead", !p.done && p.ars.busted.includes(mine) && socks.a.last("MINE_DUG").craters.includes(mine));
}

console.log("\ninvincibility on a dig, and the spend");
{
  const { field, socks, say } = await room("beginner", ["a"]);
  const p = field.g.players.a;
  arm(p, { ms_shield: 2, ms_reveal: 1 });
  await say("a", { type: "MINE_START" });
  const mine = field.board.mineList.find((m) => p.revealed[m] === undefined);
  await say("a", { type: "MINE_ARSENAL", action: "shield" });
  await say("a", { type: "MINE_DIG", cell: mine });
  ok("digging a mine while invincible defuses it and opens the ground", !p.done && p.ars.busted.includes(mine) && typeof p.revealed[mine] === "number");
  p.ars.invincibleUntil = 0;
  const mine2 = field.board.mineList.find((m) => m !== mine && p.revealed[m] === undefined);
  await say("a", { type: "MINE_DIG", cell: mine2 });
  ok("once it lapses a mine is a mine", p.done && !p.won);
  const over = socks.a.last("MINE_OVER");
  const row = over.results.find((r) => r.uid === "a");
  ok("the results spend the one shield used and nothing else", row.spent.ms_shield === 1 && Object.keys(row.spent).length === 1);
  ok("the second shield and the reveal stay armed for the next round", p.ars.armed.ms_shield === 1 && p.ars.armed.ms_reveal === 1);
}

console.log("\nthe registry");
ok("the four tokens carry their limits", MINE_ARSENAL.ms_reveal.max === 2 && MINE_ARSENAL.ms_buster.max === 5 && MINE_ARSENAL.ms_clear.max === 1 && MINE_ARSENAL.ms_shield.max === 2);
ok("bustBoard with nothing busted is the same board", (() => { const b = { mineList: ["0,0"], rows: 2, cols: 2, counts: {}, safeTotal: 3 }; return bustBoard(b, []) === b; })());

console.log(bad ? `\n${bad} failing\n` : "\nall mines arsenal checks passed\n");
process.exit(bad ? 1 : 0);
