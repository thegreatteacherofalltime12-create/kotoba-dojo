// The Buzzer, checked without a browser or a Worker.
//
// Most of this is about one thing: that the quickest reaction takes the clue,
// and that a client which lies about its reaction cannot do better than the
// arrival order would have given it anyway. That is the whole of the security
// on a contested buzzer, so it is worth attacking rather than demonstrating.
import {
  judgeBuzz, winningBuzz, valueAt, readingMs, boardScore, bankable,
  optionsFor, rngFrom, aiIntent, MIN_REACTION_MS, EARLY_LOCKOUT_MS, MAX_CREDIT_MS,
} from "../src/buzzer.js";
import { CATEGORIES, categoryById, poolFor } from "../src/buzzer-bank.js";
import { BuzzerRoom } from "../src/buzzer-room.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

// ── the room ─────────────────────────────────────────────────────────

class FakeSocket {
  constructor(uid, name) { this.attach = { uid, name }; this.inbox = []; this.open = true; }
  serializeAttachment(v) { this.attach = v; }
  deserializeAttachment() { return this.attach; }
  send(raw) { this.inbox.push(JSON.parse(raw)); }
  last(t) { return [...this.inbox].reverse().find((m) => m.type === t); }
  all(t) { return this.inbox.filter((m) => m.type === t); }
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
      get: async (k) => (Array.isArray(k) ? new Map(k.map((x) => [x, store.get(x)])) : store.get(k)),
      put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
      deleteAll: async () => store.clear(),
      setAlarm: async (t) => { alarm = t; }, deleteAlarm: async () => { alarm = null; },
    },
  };
}

/** A board with the named players seated, the first of them hosting. */
async function roomOf(...who) {
  const state = makeState();
  const room = new BuzzerRoom(state, { FIREBASE_PROJECT_ID: "test" });
  await state._init;
  const seats = {};
  for (const [uid, name] of who) {
    const ws = new FakeSocket(uid, name);
    state.acceptWebSocket(ws);
    await room.onJoin(uid, name, "QUIZ1", ws);
    seats[uid] = ws;
  }
  const say = (uid, o) => room.webSocketMessage(seats[uid], JSON.stringify(o));
  return { room, seats, say, state };
}

/** Six categories and the lights on, without going through the lobby by hand. */
async function boardOf(room, say, host) {
  await say(host, { type: "BZ_CATS", ids: CATEGORIES.slice(0, 6).map((c) => c.id) });
  await say(host, { type: "BZ_START" });
}

// ── the arithmetic ───────────────────────────────────────────────────

console.log("\nthe board");
{
  ok("a row is worth two hundred more than the one above it",
    [0, 1, 2, 3, 4].map((r) => valueAt(r, 1)).join() === "200,400,600,800,1000");
  ok("and the second round doubles every one of them",
    [0, 4].map((r) => valueAt(r, 2)).join() === "400,2000");
  ok("a long clue takes longer to read than a short one",
    readingMs("a".repeat(120)) > readingMs("short"));
  ok("but never so long that the table falls asleep", readingMs("a".repeat(5000)) <= 9_000);
  ok("the two thousand floats, so a flat board banks nothing",
    bankable(2000) === 0 && bankable(1800) === 0 && bankable(3400) === 1400);
}

console.log("\nthe clue bank");
{
  ok("every category carries five clues", CATEGORIES.every((c) => c.clues.length === 5));
  ok("no answer repeats inside a column",
    CATEGORIES.every((c) => new Set(c.clues.map((q) => q.a.toLowerCase())).size === 5));
  ok("no clue lists its own answer as a wrong option",
    CATEGORIES.every((c) => c.clues.every((q) => !q.wrong.some((w) => w.toLowerCase() === q.a.toLowerCase()))));
  const cat = categoryById("battleship");
  const four = optionsFor(cat.clues[0], poolFor(cat), rngFrom(3));
  ok("four options are dealt, the right one among them",
    four.length === 4 && four.includes(cat.clues[0].a) && new Set(four).size === 4);
  ok("and the decoys come out of the same column",
    four.filter((o) => o !== cat.clues[0].a).every((o) => poolFor(cat).includes(o)));
}

// ── the buzzer ───────────────────────────────────────────────────────

console.log("\nthe buzzer, judged on its own");
{
  const open = 100_000;
  ok("an honest reaction is reported as itself",
    judgeBuzz({ stamp: open + 300, arrivedAt: open + 380, openAt: open }).reaction === 300);
  const early = judgeBuzz({ stamp: open - 50, arrivedAt: open + 20, openAt: open });
  ok("buzzing before the buzzers open takes the clue from nobody",
    early.ok === false && early.early === true);
  ok("and shuts that player out for a quarter of a second",
    early.lockedUntil === open + EARLY_LOCKOUT_MS);
  ok("nobody reacts quicker than a human can",
    judgeBuzz({ stamp: open + 1, arrivedAt: open + 40, openAt: open }).reaction === MIN_REACTION_MS);

  ok("an absurd stamp is thrown away and the buzz judged on arrival",
    judgeBuzz({ stamp: 0, arrivedAt: open + 400, openAt: open }).reaction === 400);
  ok("and a stamp from the future gets the same treatment",
    judgeBuzz({ stamp: open + 99_999, arrivedAt: open + 400, openAt: open }).reaction === 400);

  // The lie a real cheat would tell: not an absurd timestamp, but "I buzzed
  // the instant the lights came on". No clamp will ever catch that, because
  // it is perfectly plausible. The credit cap is what bounds it.
  const honest = judgeBuzz({ stamp: open + 900, arrivedAt: open + 1_300, openAt: open }).reaction;
  const liar = judgeBuzz({ stamp: open, arrivedAt: open + 1_300, openAt: open }).reaction;
  ok("claiming a perfect buzz is worth half a second and no more",
    liar === 1_300 - MAX_CREDIT_MS);
  ok("so a slow line cannot pretend to be a quick mind", liar > MIN_REACTION_MS);
  ok("while an honest buzz on that same slow line keeps its own number",
    honest === 900);
  ok("latency inside the cap costs an honest player nothing at all",
    judgeBuzz({ stamp: open + 300, arrivedAt: open + 380, openAt: open }).reaction === 300);

  // This is the entire reason the design is not arrival-order.
  const slowLine = { uid: "hotel", reaction: 260, arrivedAt: 900, ok: true };
  const fastLine = { uid: "fibre", reaction: 540, arrivedAt: 610, ok: true };
  ok("a quick mind on a bad line beats a slow one on a good line",
    winningBuzz([fastLine, slowLine]).uid === "hotel");
  ok("a tie at the human floor falls back to who got here first",
    winningBuzz([
      { uid: "b", reaction: MIN_REACTION_MS, arrivedAt: 700, ok: true },
      { uid: "a", reaction: MIN_REACTION_MS, arrivedAt: 650, ok: true },
    ]).uid === "a");
}

// ── the room, end to end ─────────────────────────────────────────────

console.log("\na board");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  ok("the first through the door runs it", room.g.hostUid === "a");
  ok("and the room takes the code it was handed, not one it made up", room.g.code === "QUIZ1");
  ok("everyone sits down on two thousand", room.g.players.a.money === 2000);

  await say("b", { type: "BZ_START" });
  ok("only the host starts it", /Only the host/.test(seats.b.last("BZ_ERROR").message));

  await say("a", { type: "BZ_START" });
  ok("and not before there are categories", /Pick 6 categories/.test(seats.a.last("BZ_ERROR").message));

  await boardOf(room, say, "a");
  ok("the lights go up", room.g.phase === "PLAYING");
  ok("six categories are on the board", room.g.cats.length === 6);

  // The fill bug: one shared row across six columns.
  room.g.spent[0][2] = true;
  ok("spending a cell spends that cell and no other",
    room.g.spent[1][2] === false && room.g.spent[5][2] === false);
  room.g.spent[0][2] = false;

  await say("b", { type: "BZ_PICK", col: 0, row: 0 });
  ok("you cannot pick out of turn", /not your pick/.test(seats.b.last("BZ_ERROR").message));

  await say("a", { type: "BZ_PICK", col: 0, row: 0 });
  const c = room.g.cell;
  ok("the clue goes up", !!c && c.stage === "READING" && c.value === 200);
  ok("and the buzzers are shut while it is read", c.openAt > Date.now());

  const shown = seats.b.last("BZ_STATE").game.cell;
  ok("the clue itself is public", shown.q === c.q);
  ok("the answer is not", shown.answer === null);
  ok("and neither are the four options", shown.options === undefined);

  await say("b", { type: "BZ_BUZZ", at: Date.now() });
  ok("buzzing into the reading is refused",
    /weren't open/.test(seats.b.last("BZ_ERROR").message));
  ok("and locks that player out past the opening", room.g.cell.locked.b >= c.openAt);

  // Let the reading finish. The buzzers opened just under a second ago, which
  // is what makes the two stamps below things that could actually have
  // happened rather than claims about the future.
  room.g.cell.openAt = Date.now() - 950;
  room.g.cell.locked = {};

  const openAt = room.g.cell.openAt;
  // Bo is on a good line and slow off the mark. Ana is on a bad one and quick.
  await say("b", { type: "BZ_BUZZ", at: openAt + 900 });
  await say("a", { type: "BZ_BUZZ", at: openAt + 300 });
  ok("a buzz opens a window rather than taking the clue",
    room.g.cell.stage === "WINDOW" && room.g.cell.holder === null);
  ok("both buzzes are in it", room.g.cell.buzzes.length === 2);

  room.g.cell.deadline = Date.now() - 1;
  await room.tick();
  ok("and the quicker reaction takes it, not the earlier message",
    room.g.cell.holder === "a");
  ok("a slow line is forgiven, but only up to the cap",
    room.g.players.a.bestReaction > 300 && room.g.players.a.bestReaction < room.g.players.b.bestReaction);

  const mine = seats.a.last("BZ_OPTIONS");
  ok("the four options go to the player holding the clue", mine?.options?.length === 4);
  ok("and to nobody else", !seats.b.last("BZ_OPTIONS"));
  ok("the others are told who has it, and no more",
    seats.b.last("BZ_STATE").game.cell.holder === "a" &&
    seats.b.last("BZ_STATE").game.cell.options === undefined);

  // A wrong answer.
  const wrong = mine.options.find((o) => o !== room.g.cell.a);
  await say("a", { type: "BZ_ANSWER", choice: wrong });
  ok("a wrong answer costs what a right one pays", room.g.players.a.money === 1800);
  ok("and hands the clue back to the room", room.g.cell.stage === "OPEN" && room.g.cell.holder === null);
  ok("but not back to the player who just had it", room.g.cell.wrongUids.includes("a"));

  await say("a", { type: "BZ_BUZZ", at: Date.now() });
  ok("who is told so plainly", /had your go/.test(seats.a.last("BZ_ERROR").message));

  const answer = room.g.cell.a;
    room.g.cell.openAt = Date.now() - 600;
  await say("b", { type: "BZ_BUZZ", at: room.g.cell.openAt + 400 });
  room.g.cell.deadline = Date.now() - 1;
  await room.tick();
  ok("the reopened clue goes to whoever is left", room.g.cell.holder === "b");

  await say("b", { type: "BZ_ANSWER", choice: answer });
  ok("a right answer pays", room.g.players.b.money === 2200);
  ok("the answer is shown once the cell is settled", room.g.cell.stage === "REVEAL");
  ok("and whoever answered last picks next", room.g.turnUid === "b");

  room.g.cell.deadline = Date.now() - 1;
  await room.tick();
  ok("then the cell closes", room.g.cell === null);
}

console.log("\nten seconds, and nobody at all");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  await boardOf(room, say, "a");
  await say("a", { type: "BZ_PICK", col: 1, row: 1 });
  room.g.cell.openAt = Date.now() - 600;

  await say("a", { type: "BZ_BUZZ", at: room.g.cell.openAt + 400 });
  room.g.cell.deadline = Date.now() - 1;
  await room.tick();
  ok("the clue is taken", room.g.cell.holder === "a");

  // Sitting on it costs the same as getting it wrong; otherwise a player who
  // does not know simply never answers and the board never moves.
  room.g.cell.deadline = Date.now() - 1;
  await room.tick();
  ok("ten seconds with no answer costs the value", room.g.players.a.money === 2000 - 400);
  ok("and the clue goes back up", room.g.cell.stage === "OPEN");

  room.g.cell.deadline = Date.now() - 1;
  await room.tick();
  ok("nobody buzzing shows the answer", room.g.cell.stage === "REVEAL");
  ok("which is public now the cell is spent",
    seats.b.last("BZ_STATE").game.cell.answer === room.g.cell.a);
  ok("and nobody paid for it", room.g.players.b.money === 2000);
}

console.log("\nbelow zero");
{
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  await boardOf(room, say, "a");
  room.g.players.a.money = -600;
  await say("a", { type: "BZ_PICK", col: 2, row: 4 });
  room.g.cell.openAt = Date.now() - 500;
  await say("a", { type: "BZ_BUZZ", at: room.g.cell.openAt + 300 });
  ok("a player in the red can still buzz", room.g.cell.buzzes.length === 1);
  room.g.cell.deadline = Date.now() - 1;
  await room.tick();
  await say("a", { type: "BZ_ANSWER", choice: room.g.cell.a });
  ok("and can still win it back", room.g.players.a.money === 400);
}

console.log("\nthe computer players");
{
  const { room, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "BZ_SOLO", on: true });
  await say("a", { type: "BZ_AI", count: 3, level: "pro" });
  await boardOf(room, say, "a");
  const bots = Object.values(room.g.players).filter((p) => p.ai);
  ok("three of them take a podium", bots.length === 3);
  ok("named so you know what you are up against", bots.every((p) => /\(Pro\)$/.test(p.name)));

  await say("a", { type: "BZ_PICK", col: 0, row: 0 });
  ok("each decides what it will do before the buzzers open",
    Object.keys(room.g.cell.aiBuzz).length > 0);
  ok("and its decision is a reaction time like anybody else's",
    Object.values(room.g.cell.aiBuzz).every((r) => r >= MIN_REACTION_MS));

  // Run the clue out. A Pro should get to the buzzer on its own.
  room.g.cell.openAt = Date.now() - 3_000;
  await room.tick();
  ok("one of them reaches the buzzer without being asked",
    room.g.cell.stage === "WINDOW" || room.g.cell.holder !== null);

  let guard = 0;
  while (room.g.cell && guard++ < 12) {
    room.g.cell.deadline = Date.now() - 1;
    if (room.g.cell.aiAnswerAt) room.g.cell.aiAnswerAt = Date.now() - 1;
    await room.tick();
  }
  ok("and the clue settles itself without a person touching it", room.g.cell === null);
  const moved = Object.values(room.g.players).some((p) => p.money !== 2000);
  ok("with somebody's money moved by it", moved);
}

console.log("\nwhat a board was worth");
{
  ok("winning a table of four scores well", boardScore({ placement: 1, field: 4, right: 9, wrong: 2 }) > 90);
  ok("last place with a bad night scores badly", boardScore({ placement: 4, field: 4, right: 1, wrong: 6 }) < 40);
  ok("a clean winner beats a sloppy one",
    boardScore({ placement: 1, field: 4, right: 10, wrong: 0 }) >
    boardScore({ placement: 1, field: 4, right: 5, wrong: 5 }));
  ok("answering nothing all night is not accuracy",
    boardScore({ placement: 2, field: 2, right: 0, wrong: 0 }) === 30);
  ok("and nothing ever gets past a hundred",
    boardScore({ placement: 1, field: 9, right: 60, wrong: 0 }) <= 100);

  const r = rngFrom(11);
  const pro = Array.from({ length: 200 }, () => aiIntent("pro", r));
  const rookie = Array.from({ length: 200 }, () => aiIntent("rookie", r));
  ok("a Pro knows more of the board than a Rookie",
    pro.filter((i) => i.knows).length > rookie.filter((i) => i.knows).length);
  ok("and gets to the buzzer quicker when it does",
    avg(pro.filter((i) => i.buzz).map((i) => i.reaction)) <
    avg(rookie.filter((i) => i.buzz).map((i) => i.reaction)));
}

console.log("\nthe end of it");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  await boardOf(room, say, "a");
  room.g.players.a.money = 3400; room.g.players.a.right = 8; room.g.players.a.wrong = 1;
  room.g.players.b.money = 1500; room.g.players.b.right = 3; room.g.players.b.wrong = 4;
  await room.finish();

  const over = seats.a.last("BZ_OVER");
  ok("the board is scored", room.g.phase === "RESULTS" && over.results.length === 2);
  ok("the winner is on top", over.results[0].uid === "a");
  ok("everybody carries a hundred-point score",
    over.results.every((r) => r.score >= 0 && r.score <= 100));
  ok("MMR is set from it and never left to fall back on the raw score",
    over.results.every((r) => typeof r.gain === "number"));
  ok("what banks is what was won above the stake", over.results[0].banked === 1400);
  ok("and a losing board banks nothing rather than costing anybody",
    over.results[1].banked === 0);
  ok("two at the board is a match rather than a rumble", over.mode === "match");
}

console.log("\nleaving");
{
  const { room, seats } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  seats.a.open = false;
  await room.onGone(seats.a);
  ok("the host's job goes to whoever has been here longest", room.g.hostUid === "b");
  ok("and the room is still standing", room.g.phase === "LOBBY");
}

function avg(xs) { return xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length); }

console.log(bad ? `\n${bad} failing\n` : "\nall buzzer checks passed\n");
process.exit(bad ? 1 : 0);
