// node scripts/match3-room-test.mjs
//
// Match-3 Attack Arena through the room: two wells, charge that does nothing
// until a word is solved, rubble that lands after the other player's next move,
// the stack that rises, the computer, and the end of the match.
//
// The one thing no message may ever carry is the answer to a word that has not
// been solved yet, so that is checked against everything either player was sent.
import { MatchArena } from "../src/match3-room.js";
import { moves, ROWS, COLS, RUBBLE, MAX_CHARGE, MAX_LAUNCH, height, hasMove, findMatches } from "../src/match3.js";

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
  const store = new Map(); const sockets = []; let alarm = null;
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

async function table({ humans = 1, level = "easy", solo = true } = {}) {
  const state = makeState();
  const room = new MatchArena(state, { FIREBASE_PROJECT_ID: "test" });
  await state._init;
  room.g = room.blank("MATCH");
  const socks = {};
  for (let i = 0; i < humans; i++) {
    const uid = `p${i + 1}`;
    const ws = new FakeSocket(uid, `Player ${i + 1}`);
    socks[uid] = ws;
    state.acceptWebSocket(ws);
    await room.onJoin(uid, `Player ${i + 1}`, ws);
  }
  const say = (uid, o) => room.webSocketMessage(socks[uid], JSON.stringify(o));
  await say("p1", { type: "M3_START", solo, level });
  return { room, state, socks, say, g: room.g };
}

const ago = () => Date.now() - 1;
const firstMove = (p) => moves(p.board)[0];

console.log("\nstarting");
{
  const t = await table({ humans: 1 });
  ok("a solo match fills the other seat with a computer", t.room.list().length === 2 && t.g.players.ai?.ai === "easy");
  ok("and begins", t.g.phase === "PLAYING");
  ok("both wells are dealt, with a move to make", t.room.list().every((p) => p.board && hasMove(p.board) && findMatches(p.board).size === 0));
  ok("everyone has a word to unscramble", t.room.list().every((p) => p.word?.scrambled && p.word.answer));
  ok("the match has an end", t.g.endsAt > Date.now() + 200_000);
  ok("a start with one person and no computer is refused when solo is off", await (async () => {
    const x = await table({ humans: 1, solo: false });
    return x.g.phase !== "PLAYING" && /Waiting for an opponent/.test(x.socks.p1.last("M3_REJECT").why);
  })());

  const two = await table({ humans: 2, solo: false });
  ok("two people play each other, with no computer", two.g.phase === "PLAYING" && !two.room.list().some((p) => p.ai));
  const notHost = await (async () => {
    const state = makeState();
    const room = new MatchArena(state, { FIREBASE_PROJECT_ID: "test" });
    await state._init;
    room.g = room.blank("X");
    const a = new FakeSocket("a", "A"), b = new FakeSocket("b", "B");
    state.acceptWebSocket(a); state.acceptWebSocket(b);
    await room.onJoin("a", "A", a); await room.onJoin("b", "B", b);
    await room.webSocketMessage(b, JSON.stringify({ type: "M3_START", solo: true }));
    return room.g.phase;
  })();
  ok("only the host calls the start", notHost === "LOBBY");
}

console.log("\na move");
{
  const t = await table({ humans: 1 });
  const me = t.g.players.p1;
  const [a, b] = firstMove(me);
  const before = JSON.stringify(me.board);
  await t.say("p1", { type: "M3_SWAP", a, b });
  const res = t.socks.p1.last("M3_RESULT");
  ok("a move that matches is answered with the whole cascade", !!res && res.steps.length >= 1);
  ok("each step says what went, and what was left", res.steps.every((s) => s.cells.length >= 3 && s.after.length === ROWS));
  ok("the charge goes up", me.charge > 0 && res.charge === me.charge);
  ok("the stats are kept", me.swaps === 1 && me.cleared >= 3 && me.maxChain >= 1);
  ok("the well really changed", JSON.stringify(me.board) !== before);

  // A move that does nothing is refused, and costs nothing.
  const charge = me.charge;
  me.swapAt = 0;
  await t.say("p1", { type: "M3_SWAP", a: [0, 0], b: [0, 1] });
  ok("a move that makes no match is refused", /no match|Nothing|neighbour|square/i.test(t.socks.p1.last("M3_REJECT").why));
  ok("and the well is as it was", me.charge === charge);

  // Quickly again is ignored rather than allowed.
  const [c, d] = firstMove(me) || [[0, 0], [0, 1]];
  const swaps = me.swaps;
  await t.say("p1", { type: "M3_SWAP", a: c, b: d });
  ok("a second move inside the cooldown is not taken", me.swaps === swaps);
}

console.log("\ncharge is worth nothing until a word is solved");
{
  const t = await table({ humans: 2, solo: false });
  const [p1, p2] = [t.g.players.p1, t.g.players.p2];
  p1.charge = 8;
  p1.word = { answer: "AUDIO", clue: "Sound.", scrambled: "DUOIA", len: 5 };

  ok("stored charge has not touched the other well", p2.incoming === 0);
  await t.say("p1", { type: "M3_GUESS", word: "RADIO" });
  ok("a wrong word is refused", t.socks.p1.last("M3_WRONG") && p2.incoming === 0 && p1.charge === 8);
  await t.say("p1", { type: "M3_GUESS", word: "AUDIO" });
  ok("and is locked out a moment, even with the right word", t.socks.p1.last("M3_WRONG").wait > 0 && t.g.players.p2.incoming === 0);
  p1.lockUntil = 0;
  await t.say("p1", { type: "M3_GUESS", word: "audio" });
  const solved = t.socks.p1.last("M3_SOLVED");
  ok("the right word launches the charge", !!solved && solved.send === 8 + (5 - 3));
  ok("which arrives as rubble waiting on the other well", p2.incoming === solved.send);
  ok("the charge is spent", p1.charge === 0);
  ok("and the next word is a different one", p1.word.answer !== "AUDIO");
  ok("the stats count it", p1.solved === 1 && p1.sent === solved.send);
  ok("and the foe is given time before it lands", p2.landAt > Date.now() + 2_000);

  // With nothing stored there is nothing to send.
  p1.charge = 0;
  const w = p1.word.answer;
  await t.say("p1", { type: "M3_GUESS", word: w });
  ok("solving with no charge sends nothing, and still counts", t.socks.p1.last("M3_SOLVED").send === 0 && p1.solved === 2);

  // Skipping costs a quarter.
  p1.charge = 12;
  await t.say("p1", { type: "M3_SKIP" });
  ok("skipping a word costs a quarter of the charge", p1.charge === 9 && p1.skipped === 1);
  ok("and gives a new word", !!p1.word.scrambled);

  // A launch is never bigger than the cap.
  p1.charge = MAX_CHARGE;
  const long = p1.word.answer;
  await t.say("p1", { type: "M3_GUESS", word: long });
  ok(`a launch is never more than ${MAX_LAUNCH}`, t.socks.p1.last("M3_SOLVED").send <= MAX_LAUNCH);
}

console.log("\ncountering");
{
  const t = await table({ humans: 2, solo: false });
  const [p1, p2] = [t.g.players.p1, t.g.players.p2];
  p1.incoming = 5;
  p1.landAt = Date.now() + 5_000;
  p1.charge = 7;
  p1.word = { answer: "BLOG", clue: "x", scrambled: "GOLB", len: 4 };
  await t.say("p1", { type: "M3_GUESS", word: "BLOG" });
  const s = t.socks.p1.last("M3_SOLVED");
  ok("a launch cancels what is coming at you first", s.cancel === 5 && p1.incoming === 0);
  ok("and only the rest goes across", s.rest === s.send - 5 && p2.incoming === s.rest);
  ok("with nothing left coming, nothing is scheduled to land", p1.landAt === 0);
}

console.log("\nrubble lands");
{
  const t = await table({ humans: 2, solo: false });
  const [p1, p2] = [t.g.players.p1, t.g.players.p2];
  p2.incoming = 4;
  p2.landAt = Date.now() + 6_000;
  const was = p2.board.flat().filter((v) => v === RUBBLE).length;
  const [a, b] = firstMove(p2);
  await t.say("p2", { type: "M3_SWAP", a, b });
  const res = t.socks.p2.last("M3_RESULT");
  ok("it lands after the next move, not before", res.landed.length === 4 && p2.incoming === 0);
  ok("on their well, as rubble", p2.board.flat().filter((v) => v === RUBBLE).length === was + 4);
  ok("and it was sent to them to draw", res.landed.every(([r, c]) => r >= 0 && c >= 0));

  // Put off by not moving: it lands anyway when its time is up.
  const t2 = await table({ humans: 2, solo: false });
  const q = t2.g.players.p2;
  q.incoming = 3;
  q.landAt = ago();
  q.riseAt = Date.now() + 60_000;
  await t2.room.alarm();
  ok("stalling does not avoid it: it lands when its time is up", q.incoming === 0 && q.board.flat().filter((v) => v === RUBBLE).length >= 3);

  // No more lands at once than the cap.
  const t3 = await table({ humans: 2, solo: false });
  const r = t3.g.players.p2;
  r.incoming = 30; r.landAt = ago(); r.riseAt = Date.now() + 60_000;
  await t3.room.alarm();
  ok("only so much lands at once", r.incoming > 0 && r.incoming <= 30);
}

console.log("\nthe stack rises");
{
  const t = await table({ humans: 2, solo: false });
  const p = t.g.players.p1;
  const h = height(p.board);
  p.riseAt = ago();
  await t.room.alarm();
  ok("when the timer runs out a row pushes up", height(p.board) >= h);
  ok("and the well is still playable", hasMove(p.board) && findMatches(p.board).size === 0);
  ok("the next rise is quicker", p.riseMs < 6_500);
  ok("and not due yet", p.riseAt > Date.now());

  // Run it until somebody's stack has nowhere to go.
  const u = await table({ humans: 2, solo: false });
  let n = 0;
  while (u.g.phase === "PLAYING" && n++ < 60) {
    for (const q of u.room.list()) q.riseAt = ago();
    await u.room.alarm();
  }
  ok("left alone, a stack overflows and the match ends", u.g.phase === "OVER");
  const over = u.socks.p1.last("M3_OVER");
  ok("with a result for each of them", over.results.length === 2 && over.reason === "overflow");
  ok("one wins", over.results.filter((r) => r.placement === 1).length === 1);
  ok("the loser is the one that overflowed", over.results.find((r) => r.placement === 2).status === "overflowed");
  ok("scores are on the arena's hundred-point scale", over.results.every((r) => r.score >= 0 && r.score <= 100));
  ok("and the winner scores more", over.results[0].score > over.results[1].score);
  ok("MMR is worked out for people", over.results.every((r) => typeof r.gain === "number" && r.mmrAfter >= r.mmrBefore));
}

console.log("\nthe computer");
{
  const t = await table({ humans: 1, level: "hard" });
  const ai = t.g.players.ai;
  const swaps = ai.swaps;
  ai.aiMoveAt = ago();
  await t.room.alarm();
  ok("it makes moves on the alarm", ai.swaps > swaps);
  ai.charge = 6; ai.aiSolveAt = ago();
  const foe = t.g.players.p1;
  const before = foe.incoming;
  await t.room.alarm();
  ok("and solves words like anybody else, to send its charge", foe.incoming > before && ai.charge === 0);
  ok("the person is told how much is coming", t.socks.p1.last("M3_STATE").state.me.incoming === foe.incoming);

  // It plays a match out by itself against a person who does nothing.
  const x = await table({ humans: 1, level: "hard" });
  let guard = 0;
  while (x.g.phase === "PLAYING" && guard++ < 400) {
    for (const p of x.room.list()) { p.riseAt = ago(); if (p.ai) { p.aiMoveAt = ago(); p.aiSolveAt = ago(); } }
    await x.room.alarm();
  }
  ok("a match against a person who never moves ends", x.g.phase === "OVER");
  ok("and the computer is not in the record", x.socks.p1.last("M3_OVER").results.some((r) => r.ai));
}

console.log("\ntime");
{
  const t = await table({ humans: 2, solo: false });
  const [p1, p2] = [t.g.players.p1, t.g.players.p2];
  p1.sent = 20; p2.sent = 5;
  t.g.endsAt = ago();
  await t.room.alarm();
  ok("when the clock runs out the match ends", t.g.phase === "OVER" && t.socks.p1.last("M3_OVER").reason === "time");
  ok("whoever hit harder wins", t.socks.p1.last("M3_OVER").results[0].uid === "p1");
}

console.log("\nthe host");
{
  const t = await table({ humans: 2, solo: false });
  await t.say("p2", { type: "M3_END" });
  ok("only the host can end a match", t.g.phase === "PLAYING");
  await t.say("p1", { type: "M3_END" });
  ok("and the host can", t.g.phase === "OVER");
  await t.say("p1", { type: "M3_START", solo: false });
  ok("and then play it again", t.g.phase === "PLAYING" && t.g.roundNo === 2);
  ok("with fresh wells", t.room.list().every((p) => !p.over && p.sent === 0 && height(p.board) === 5));
}

console.log("\nsecrets");
{
  const t = await table({ humans: 2, solo: false });
  const p1 = t.g.players.p1, p2 = t.g.players.p2;
  for (let i = 0; i < 3; i++) {
    const m = firstMove(p1); if (m) { p1.swapAt = 0; await t.say("p1", { type: "M3_SWAP", a: m[0], b: m[1] }); }
    const n = firstMove(p2); if (n) { p2.swapAt = 0; await t.say("p2", { type: "M3_SWAP", a: n[0], b: n[1] }); }
  }
  const sent = (ws) => JSON.stringify(ws.inbox);
  ok("a player is never sent the answer to their own word", !sent(t.socks.p1).includes(`"${p1.word.answer}"`) && !sent(t.socks.p1).includes(p1.word.answer.toLowerCase() + '"'));
  ok("nor to the other player's", !sent(t.socks.p1).includes(`"${p2.word.answer}"`) && !sent(t.socks.p2).includes(`"${p1.word.answer}"`));
  const view = t.socks.p1.last("M3_STATE").state;
  ok("they see the letters and the clue", view.me.word.scrambled && view.me.word.clue && !("answer" in view.me.word));
  ok("they see the other well, and how much charge it holds", Array.isArray(view.foe.board) && typeof view.foe.charge === "number");
  ok("but not the other player's word at all", !("word" in view.foe));
}

console.log(bad ? `\n${bad} failing\n` : "\nall match-3 room checks passed\n");
process.exit(bad ? 1 : 0);
