// node scripts/mines-smoke.mjs
import { MineField } from "../src/mine-lobby.js";
import { isMine, key } from "../src/minesweeper.js";

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

const env = { FIREBASE_PROJECT_ID: "test" };
const state = makeState();
const field = new MineField(state, env);
await state._init;

const socks = {};
for (const [uid, nm] of [["m1", "Ada"], ["m2", "Ben"], ["m3", "Cy"]]) {
  const ws = new FakeSocket(uid, nm);
  socks[uid] = ws;
  state.acceptWebSocket(ws);
  await field.onJoin(uid, nm, "MINE", ws);
}
const say = (uid, obj) => field.webSocketMessage(socks[uid], JSON.stringify(obj));

console.log("\njoining");
ok("first in hosts", socks.m1.last("MINE_WELCOME").isHost === true);
ok("levels are published", socks.m1.last("MINE_WELCOME").levels.length === 3);
ok("everyone is listed", socks.m1.last("MINE_STATE").game.players.length === 3);

console.log("\nhost controls");
await say("m2", { type: "MINE_LEVEL", level: "expert" });
ok("only the host picks the level", /Only the host/.test(socks.m2.last("MINE_ERROR").message));
await say("m1", { type: "MINE_LEVEL", level: "intermediate" });
ok("the host picks the level", field.g.level === "intermediate");
await say("m1", { type: "MINE_SOLO", on: true });
ok("solo can be switched on", field.g.solo === true);
await say("m1", { type: "MINE_SOLO", on: false });

console.log("\nstarting");
await say("m1", { type: "MINE_START" });
const start = socks.m3.last("MINE_START");
ok("the round starts", field.g.phase === "ACTIVE");
ok("the board shape is sent", start.shape.rows === 16 && start.shape.cols === 16);
ok("an opening is given", Object.keys(start.opening).length > 1);
ok("mine positions are NOT sent", !JSON.stringify(start).includes("mineList"));
ok("everyone gets the identical opening",
  JSON.stringify(socks.m1.last("MINE_START").opening) === JSON.stringify(start.opening));

const st = socks.m1.last("MINE_STATE").game;
ok("nobody's squares leak to anyone else", !JSON.stringify(st.players).includes("revealed"));
ok("progress is public", st.players.every((p) => typeof p.progress === "number"));

console.log("\ndigging");
const board = field.board;
const safe = Object.keys(board.counts).filter((c) => field.g.players.m1.revealed[c] === undefined);
await say("m1", { type: "MINE_DIG", cell: safe[0] });
ok("a safe square uncovers", Object.keys(socks.m1.last("MINE_DUG").cells).length > 0);
ok("only the digger is told what they found", socks.m2.last("MINE_DUG") === undefined);

await say("m1", { type: "MINE_DIG", cell: "99,99" });
ok("an off-board square is refused", /isn't on the board/.test(socks.m1.last("MINE_ERROR").message));

await say("m2", { type: "MINE_FLAG", cell: safe[1] });
ok("flagging works", socks.m2.last("MINE_FLAGGED").on === true);
await say("m2", { type: "MINE_FLAG", cell: safe[1] });
ok("flagging again clears it", socks.m2.last("MINE_FLAGGED").on === false);

console.log("\nhitting a mine");
await say("m2", { type: "MINE_DIG", cell: board.mineList[0] });
ok("the digger is told they're out", !!socks.m2.last("MINE_BOOM"));
ok("mines are revealed only once they're out", socks.m2.last("MINE_BOOM").mines.length === board.mines);
ok("everyone hears about it", socks.m3.last("MINE_OUT").uid === "m2");
ok("a partial board still scores", socks.m2.last("MINE_BOOM").score >= 0);
ok("they can't keep digging", (await say("m2", { type: "MINE_DIG", cell: safe[2] })) === undefined
  && field.g.players.m2.done === true);

console.log("\nclearing the board");
for (const cell of Object.keys(board.counts)) {
  field.buckets.clear(); // a real player can't click a whole board in one tick
  if (field.g.players.m1.revealed[cell] === undefined) await say("m1", { type: "MINE_DIG", cell });
  if (field.g.players.m1.done) break;
}
ok("clearing every safe square wins", field.g.players.m1.won === true);
ok("the clear is broadcast", socks.m3.last("MINE_CLEARED").uid === "m1");

console.log("\nfinishing");
await field.finish();
const over = socks.m1.last("MINE_OVER");
ok("results arrive", !!over);
ok("everyone who played is placed", over.results.length === 3);
ok("the one who cleared it comes first", over.results[0].uid === "m1");
ok("MMR was awarded", over.results.every((r) => r.gain >= 0));
ok("nobody lost MMR", over.results.every((r) => r.mmrAfter >= r.mmrBefore));
ok("three sweepers scored as a rumble", over.mode === "rumble");
ok("the layout is revealed at the end", over.mines.length === board.mines);

console.log(bad ? `\n${bad} failing\n` : "\nall minefield checks passed\n");
process.exit(bad ? 1 : 0);
