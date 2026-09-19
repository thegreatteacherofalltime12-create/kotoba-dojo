// node scripts/commons-test.mjs
//
// The reading room: what every home screen polls, answered from memory.
// Built with a bare env, so there is no service account and every Firestore
// reader says null. The point of most of these checks is that Firestore is
// never asked anyway.
import { Commons } from "../src/commons.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

function makeState() {
  const store = new Map();
  let alarm = null;
  return {
    _init: null, alarmAt: () => alarm,
    blockConcurrencyWhile(fn) { this._init = fn(); return this._init; },
    storage: {
      get: async (k) => store.get(k),
      put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
      setAlarm: async (t) => { alarm = t; },
      deleteAlarm: async () => { alarm = null; },
    },
    _store: store,
  };
}

// Firestore must never be reached from a poll. The bare env means the token
// mint refuses before any request, but count anyway.
let fetches = 0;
globalThis.fetch = async () => { fetches++; return new Response("{}", { status: 500 }); };
// Every attempt to reach Firestore logs a [firestore] refusal here, so the
// count of those is the count of attempts.
let asked = 0;
const quiet = console.error;
console.error = (m) => { if (String(m).includes("[firestore]")) asked++; };

const env = { FIREBASE_PROJECT_ID: "test" };
const state = makeState();
const room = new Commons(state, env);
await state._init;

const get = async (p) => (await room.fetch(new Request(`https://commons${p}`))).json();
const post = (p, b) => room.fetch(new Request(`https://commons${p}`, { method: "POST", body: JSON.stringify(b) }));
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

console.log("\nchat");
for (let i = 0; i < 65; i++) {
  await post("/chat/append", { id: `c${i}`, at: iso((65 - i) * 1000), uid: `u${i % 3}`, name: `N${i % 3}`, text: `line ${i}` });
}
let chat = (await get("/chat")).chat;
ok("the last sixty lines are kept", chat.length === 60);
ok("oldest first", chat[0].text === "line 5" && chat[59].text === "line 64");
await post("/chat/append", { id: "c64", at: iso(1000), uid: "u1", name: "N1", text: "again" });
chat = (await get("/chat")).chat;
ok("the same line twice is one line", chat.length === 60 && chat[59].text === "line 64");
await post("/chat/append", { id: "late", at: iso(30 * 1000), uid: "u2", name: "N2", text: "late" });
chat = (await get("/chat")).chat;
ok("a line that arrives late is placed by its time", chat.findIndex((r) => r.id === "late") < 59);
ok("the line carries what the client draws", ["at", "uid", "name", "text"].every((k) => k in chat[0]));

console.log("\nchat limit");
let allowed = 0;
for (let i = 0; i < 15; i++) if ((await (await post("/chat/allow", { uid: "spam" })).json()).ok) allowed++;
ok("twelve lines a minute and no more", allowed === 12);
ok("another player is not held back by it", (await (await post("/chat/allow", { uid: "calm" })).json()).ok);

console.log("\nfeed");
await post("/feed/append", { id: "old", at: iso(25 * 3600_000), kind: "game", text: "yesterday", name: "A" });
for (let i = 0; i < 90; i++) {
  await post("/feed/append", { id: `f${i}`, at: iso((90 - i) * 60_000), kind: "game", text: `t${i}`, name: "B", detail: "" });
}
const feed = (await get("/feed")).feed;
ok("a day-old row is not served", !feed.some((r) => r.id === "old"));
ok("eighty rows at most", feed.length === 80);
ok("newest first", feed[0].id === "f89" && feed[79].id === "f10");
ok("the row carries what the client draws", ["at", "kind", "text", "name", "detail"].every((k) => k in feed[0]));

console.log("\nrankings");
const rows = [];
for (let i = 0; i < 30; i++) rows.push({ uid: `p${i}`, name: `P${i}`, totalPoints: 1000 - i * 20, roundsPlayed: i, bestScore: 50 + i });
rows.push({ uid: "o1", name: "O1", totalPoints: 10, roundsPlayed: 3, bestScore: 9, prestige: 2, insignia: "First Lieutenant" });
rows.push({ uid: "o2", name: "O2", totalPoints: 5, roundsPlayed: 3, bestScore: 9, prestige: 1, insignia: "Second Lieutenant" });
rows.push({ uid: "o3", name: "O3", totalPoints: 900, roundsPlayed: 3, bestScore: 9, prestige: 1, insignia: "Second Lieutenant" });
await post("/board/upsert", { rows });
let standings = (await get("/rankings")).standings;
ok("twenty-four rows at most", standings.length === 24);
ok("officers first, by prestige then MMR", standings.slice(0, 3).map((r) => r.uid).join() === "o1,o3,o2");
ok("then everyone else by MMR", standings[3].uid === "p0" && standings[23].uid === "p20");
ok("exactly the fields the client reads",
  standings.every((r) => Object.keys(r).sort().join() === "best,branch,cos,feats,mmr,name,prestige,retired,rounds,spent,uid"));

// The client's old merge, ported, on the same board: the room must agree.
function clientMerge(board) {
  const all = board.map((v) => ({
    uid: v.uid, name: v.name || "Unknown", mmr: v.totalPoints || 0,
    best: v.bestScore || 0, rounds: v.roundsPlayed || 0, prestige: v.prestige || 0, branch: 0, retired: 0, spent: 0, cos: null, feats: null,
  }));
  const officers = all.filter((r) => r.prestige > 0).sort((a, b) => b.prestige - a.prestige).slice(0, 60);
  const byMmr = [...all].sort((a, b) => b.mmr - a.mmr).slice(0, 24);
  const seen = new Map();
  for (const r of [...officers, ...byMmr]) seen.set(r.uid, r);
  return [...seen.values()]
    .sort((a, b) => (b.prestige - a.prestige) || (b.mmr - a.mmr) || a.name.localeCompare(b.name))
    .slice(0, 24);
}
const big = [];
for (let i = 0; i < 120; i++) {
  big.push({
    uid: `b${i}`, name: `B${String(i).padStart(3, "0")}`, totalPoints: (i * 7919) % 3000,
    roundsPlayed: i, bestScore: i, prestige: i % 17 === 0 ? (i % 5) + 1 : 0,
  });
}
const state2 = makeState(); const room2 = new Commons(state2, env); await state2._init;
await room2.fetch(new Request("https://commons/board/upsert", { method: "POST", body: JSON.stringify({ rows: big }) }));
const got = (await (await room2.fetch(new Request("https://commons/rankings"))).json()).standings;
ok("the room orders a big board exactly as the client did", JSON.stringify(got) === JSON.stringify(clientMerge(big)));

await post("/board/upsert", { rows: [{ uid: "o1", name: "O1", totalPoints: 40, roundsPlayed: 4, bestScore: 30 }] });
standings = (await get("/rankings")).standings;
const o1 = standings.find((r) => r.uid === "o1");
ok("a match result never demotes an officer", o1.prestige === 2 && o1.mmr === 40 && o1.best === 30);
ok("an officer's insignia survives too", room.board.o1.insignia === "First Lieutenant");
await post("/board/upsert", { rows: [{ uid: "o1", feats: { won_crossword: 3, played_any: 9 } }] });
await post("/board/upsert", { rows: [{ uid: "o1", feats: { banks: 1 } }] });
ok("feats arrive a few at a time and add up on the row",
  room.board.o1.feats.won_crossword === 3 && room.board.o1.feats.banks === 1 && room.board.o1.feats.played_any === 9);

const top = (await get("/top?limit=10")).top;
ok("the bounty office gets the top ten by MMR", top.length === 10 && top[0].uid === "p0");
ok("in the shape it reads", Object.keys(top[0]).sort().join() === "bestScore,lastRate,name,uid");

console.log("\nthe record books");
await post("/board/upsert", { rows: [
  { uid: "p0", feats: { hits_battleship: 40, sunk_battleship: 9, eliminated_battleship: 3, best_links_augusta: -3 } },
  { uid: "p1", feats: { hits_battleship: 55, sunk_battleship: 4, best_links_augusta: 1, best_links_pebble: -1 } },
  { uid: "p2", feats: { hits_battleship: 12, eliminated_battleship: 5, best_links_augusta: -3 } },
  { uid: "p3", feats: { hits_battleship: 70 } }, { uid: "p4", feats: { hits_battleship: 60 } },
  { uid: "p5", feats: { hits_battleship: 50 } }, { uid: "p6", feats: { hits_battleship: 45 } },
] });
const books = await get("/records");
ok("five most hits, highest first", books.battleship.hits.map((r) => r.value).join() === "70,60,55,50,45");
ok("most eliminated", books.battleship.eliminated.map((r) => r.uid).join() === "p2,p0");
ok("a course record runs lowest to par first, ties by name", books.golf.augusta.map((r) => `${r.uid}:${r.value}`).join() === "p0:-3,p2:-3,p1:1");
ok("every course with a round gets a book", Object.keys(books.golf).sort().join() === "augusta,pebble");
ok("the hall of fame is cut from the standings", books.hallOfFame.rows.length === 10 && books.hallOfFame.rows[0].uid === "o1");
ok("and says when the next cut is", books.hallOfFame.next - books.hallOfFame.at === 91 * 24 * 3600_000);
await post("/board/upsert", { rows: [{ uid: "zz", name: "ZZ", totalPoints: 99999, roundsPlayed: 1, bestScore: 1, prestige: 9 }] });
ok("the hall does not move between cuts", (await get("/records")).hallOfFame.rows[0].uid === "o1");
room.hof.at -= 92 * 24 * 3600_000;
ok("and moves when one is due", (await get("/records")).hallOfFame.rows[0].uid === "zz");
delete room.board.zz;

console.log("\npruning");
const many = [];
for (let i = 0; i < 260; i++) many.push({ uid: `m${i}`, name: `M${i}`, totalPoints: i, roundsPlayed: 1, bestScore: 1, prestige: i % 50 === 0 ? 1 : 0 });
await post("/board/upsert", { rows: many });
const kept = Object.values(room.board);
ok("the board is capped", kept.length <= 200);
ok("every officer is kept", many.filter((r) => r.prestige).every((r) => room.board[r.uid]));
ok("the top of the board is kept", room.board.m259 && room.board.m200);

console.log("\nwallets");
for (let i = 0; i < 15; i++) await post("/wallets/upsert", { uid: `w${i}`, name: `W${i}`, wallet: i * 100, mine: i * 100 + 7 });
const wallets = (await get("/wallets/top")).wallets;
ok("ten wallets, largest first", wallets.length === 10 && wallets[0].uid === "w14" && wallets[9].uid === "w5");
ok("in the shape the board draws", Object.keys(wallets[0]).sort().join() === "name,uid,wallet");
let before = asked;
ok("your own figure comes from the copy", (await get("/wallet?uid=w3")).wallet === 307);
ok("without asking Firestore", asked === before);
room.mine.w3.at -= 2 * 3600_000;
before = asked;
ok("a stale figure is asked for live, and the old one stands in when that fails",
  (await get("/wallet?uid=w3")).wallet === 307 && asked === before + 1);
await post("/wallets/upsert", { uid: "w3", name: "W3", wallet: 1, mine: 1 });
ok("a withdrawal moves both figures", (await get("/wallet?uid=w3")).wallet === 1 && room.wallets.w3.wallet === 1);
await post("/wallets/upsert", { uid: "w3", name: "W3", wallet: 5000, mine: 5000 });
ok("and the board shows the move", (await get("/wallets/top")).wallets[0].uid === "w3");
ok("without the room's own bookkeeping", !("touchedAt" in (await get("/wallets/top")).wallets[0]));
await post("/dirty", {});
ok("a writer that lost count clears every player's own figure", Object.keys(room.mine).length === 0);

console.log("\nordering");
const st4 = makeState(); const r4 = new Commons(st4, env); await st4._init;
r4.appendChat({ id: "a", at: "2026-09-15T13:57:23.500Z", uid: "u", name: "U", text: "half" });
r4.appendChat({ id: "b", at: "2026-09-15T13:57:23Z", uid: "u", name: "U", text: "whole" });
r4.appendChat({ id: "c", at: "2026-09-15T13:57:23.000500Z", uid: "u", name: "U", text: "micro" });
ok("a whole-second stamp from the record sorts before the half-second one",
  r4.chat.map((r) => r.id).join() === "b,c,a");
r4.appendChat({ id: "d", uid: "u", name: "U", text: "no time" });
ok("a row with no time is not kept", r4.chat.length === 3);

console.log("\nreading the record while writers are busy");
// The queries were started at T; a match and a chat line land after T and
// before the results are folded in. They must survive the fold.
const st5 = makeState(); const r5 = new Commons(st5, env); await st5._init;
const T = Date.now() - 1000;
r5.upsertBoard([{ uid: "p1", name: "P1", totalPoints: 900, roundsPlayed: 9, bestScore: 90 }]);   // touched after T
r5.upsertWallet({ uid: "w1", name: "W1", wallet: 700, mine: 700 });
r5.board.p2 = { uid: "p2", name: "P2", totalPoints: 1, touchedAt: T - 5000 };                   // touched before T
r5.appendChat({ id: "new", at: iso(0), uid: "u", name: "U", text: "just now" });
const whole = r5.absorb({
  chat: [{ id: "old", at: iso(90_000), uid: "u", name: "U", text: "earlier" }],
  feed: [],
  officers: [],
  top: [{ uid: "p1", name: "P1", totalPoints: 800, roundsPlayed: 8, bestScore: 80, prestige: 0 },
         { uid: "p2", name: "P2", totalPoints: 500, roundsPlayed: 5, bestScore: 50, prestige: 0 }],
  wallets: [{ uid: "w1", name: "W1", wallet: 600 }, { uid: "w2", name: "W2", wallet: 100 }],
}, T);
ok("every slice was read", whole === true);
ok("a total the writer just reported outlives an older reading", r5.board.p1.totalPoints === 900);
ok("a row not touched since takes the reading", r5.board.p2.totalPoints === 500);
ok("a wallet that just moved keeps its figure", r5.wallets.w1.wallet === 700);
ok("a wallet the reading knew about is added", r5.wallets.w2.wallet === 100);
ok("the chat is merged, not replaced", r5.chat.map((r) => r.id).join() === "old,new");
ok("a refused slice leaves the copy alone and says so",
  r5.absorb({ chat: null, feed: [], officers: [], top: [], wallets: [] }, Date.now()) === false && r5.chat.length === 2);

console.log("\nthe record");
ok("nothing so far asked Firestore", fetches === 0);
const meta = state._store.get("meta");
ok("the failed hydration is retried in a minute, not sooner",
  meta.nextHydrateAt > Date.now() && meta.nextHydrateAt <= Date.now() + 60_000);
ok("and the copy survived it", (await get("/chat")).chat.length === 60);
await post("/dirty", {});
ok("a writer that lost count sets an alarm to reconcile soon",
  state.alarmAt() && state.alarmAt() - Date.now() <= 5_000);

const state3 = makeState(); const room3 = new Commons(state3, env); await state3._init;
ok("a cold room answers with nothing rather than an error",
  (await (await room3.fetch(new Request("https://commons/rankings"))).json()).standings.length === 0);
ok("an unknown door is refused", (await room.fetch(new Request("https://commons/nope"))).status === 404);

console.error = quiet;
console.log(bad ? `\n${bad} failing` : "\nall commons checks passed");
process.exit(bad ? 1 : 0);
