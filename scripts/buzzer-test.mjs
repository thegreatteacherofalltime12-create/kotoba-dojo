// The Buzzer, checked without a browser or a Worker.
//
// Most of this is about one thing: that the quickest reaction takes the clue,
// and that a client which lies about its reaction cannot do better than the
// arrival order would have given it anyway. That is the whole of the security
// on a contested buzzer, so it is worth attacking rather than demonstrating.
import {
  judgeBuzz, winningBuzz, valueAt, readingMs, boardScore, bankable,
  optionsFor, rngFrom, aiIntent, MIN_REACTION_MS, EARLY_LOCKOUT_MS, MAX_CREDIT_MS,
  BOARD_SIZES, sizeById, topValue, wagerLimit, plantDoubles,
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
  await say("a", { type: "BZ_PICK", col: 1, row: 0 });   // row 0 never hides a Daily Double
  room.g.cell.openAt = Date.now() - 600;

  await say("a", { type: "BZ_BUZZ", at: room.g.cell.openAt + 400 });
  room.g.cell.deadline = Date.now() - 1;
  await room.tick();
  ok("the clue is taken", room.g.cell.holder === "a");

  // Sitting on it costs the same as getting it wrong; otherwise a player who
  // does not know simply never answers and the board never moves.
  room.g.cell.deadline = Date.now() - 1;
  await room.tick();
  ok("ten seconds with no answer costs the value", room.g.players.a.money === 2000 - 200);
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
  await say("a", { type: "BZ_PICK", col: 2, row: 0 });   // likewise
  room.g.cell.openAt = Date.now() - 500;
  await say("a", { type: "BZ_BUZZ", at: room.g.cell.openAt + 300 });
  ok("a player in the red can still buzz", room.g.cell.buzzes.length === 1);
  room.g.cell.deadline = Date.now() - 1;
  await room.tick();
  await say("a", { type: "BZ_ANSWER", choice: room.g.cell.a });
  ok("and can still win it back", room.g.players.a.money === -400);
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

console.log("\nthe set pieces");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  await boardOf(room, say, "a");
  ok("one Daily Double is hidden on the first board", room.g.doubles.length === 1);
  ok("and never on the top row, where everybody clicks first", room.g.doubles.every((d) => d.row > 0));

  const seen = seats.b.last("BZ_STATE").game;
  ok("where they are never leaves the room", seen.doubles === undefined);
  ok("and neither does the seed they were drawn from", seen.seed === undefined);

  const dd = room.g.doubles[0];
  room.g.turnUid = "a";
  await say("a", { type: "BZ_PICK", col: dd.col, row: dd.row });
  ok("finding one opens a wager rather than a clue", room.g.cell.stage === "WAGER" && room.g.cell.dd === true);
  ok("and it belongs to whoever found it", room.g.cell.holder === "a");
  ok("nobody else is dealt its options", !seats.b.last("BZ_OPTIONS"));

  await say("a", { type: "BZ_WAGER", amount: 999999 });
  ok("a wager is clamped to the ceiling", room.g.cell.wager === 2000);
  ok("and the clue is handed straight over, with no buzzing", room.g.cell.stage === "ANSWERING");
  ok("its options reach the one player it belongs to", seats.a.last("BZ_OPTIONS").dd === true);

  await say("a", { type: "BZ_ANSWER", choice: room.g.cell.a });
  ok("a Daily Double pays what was wagered, not what the cell said", room.g.players.a.money === 4000);
}

console.log("\nthe second board");
{
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  await boardOf(room, say, "a");
  const first = room.g.cats.map((c) => c.id).join();
  for (let col = 0; col < 6; col++) for (let row = 0; row < 5; row++) room.g.spent[col][row] = true;
  room.g.cell = { stage: "REVEAL", deadline: Date.now() - 1, col: 0, row: 0, a: "x", wrongUids: [], buzzes: [], aiBuzz: {} };
  await room.tick();
  ok("a finished board brings the second one up", room.g.round === 2);
  ok("with six categories nobody has played here", room.g.cats.map((c) => c.id).join() !== first);
  ok("two Daily Doubles this time", room.g.doubles.length === 2);
  ok("and every value doubled", seats.a.last("BZ_STATE").game.values.join() === "400,800,1200,1600,2000");
}

console.log("\nfinal");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"], ["c", "Cy"]);
  await boardOf(room, say, "a");
  room.g.round = 2;
  room.g.players.a.money = 4000;
  room.g.players.b.money = 1200;
  room.g.players.c.money = -300;
  await room.startFinal();
  ok("final opens on the category and a secret wager", room.g.phase === "FINAL" && room.g.final.stage === "WAGER");
  ok("a player at or below zero sits it out", !room.g.final.playing.includes("c"));
  await say("c", { type: "BZ_FINAL_WAGER", amount: 100 });
  ok("and is told so plainly", /below zero/.test(seats.c.last("BZ_ERROR").message));

  ok("the clue does not travel with the category", seats.a.last("BZ_STATE").game.final.q === null);
  await say("a", { type: "BZ_FINAL_WAGER", amount: 99999 });
  ok("a wager cannot exceed what you brought", room.g.final.wagers.a === 4000);
  ok("nobody sees what anybody wagered", seats.b.last("BZ_STATE").game.final.reveal === null);
  ok("only who has committed", seats.b.last("BZ_STATE").game.final.in.includes("a"));

  await say("b", { type: "BZ_FINAL_WAGER", amount: 1200 });
  ok("once everybody is in, the clue arrives", room.g.final.stage === "CLUE");
  ok("with the same four options for all of them", seats.a.last("BZ_STATE").game.final.options.length === 4);

  const answer = room.g.final.a;
  await say("a", { type: "BZ_FINAL_ANSWER", choice: answer });
  await say("b", { type: "BZ_FINAL_ANSWER", choice: room.g.final.options.find((o) => o !== answer) });
  ok("the reveal follows the last answer", room.g.final.stage === "REVEAL");
  const rev = room.g.final.reveal;
  ok("lowest score first, so whoever can still win goes last", rev[0].uid === "b" && rev[1].uid === "a");
  ok("a right answer adds the wager", room.g.players.a.money === 8000);
  ok("a wrong one takes it off", room.g.players.b.money === 0);
  ok("and the answer is public now it is settled", seats.c.last("BZ_STATE").game.final.answer === answer);
}

console.log("\nthe arsenal");
{
  const { room, say } = await roomOf(["a", "Ana"]);
  const p = room.g.players.a;
  p.ars.armed = { bz_house: 1, bz_long: 1, bz_second: 2, bz_polish: 1, bz_pockets: 1 };
  await boardOf(room, say, "a");
  ok("House Money seats you on $2,500", p.money === 2500);
  ok("Long Look buys five more seconds", p.answerMs === 15000);
  ok("two Second Looks cover two wrong answers", p.freeWrong === 2);
  ok("Deep Pockets doubles the Daily Double ceiling", p.deepPockets === true);
  ok("and only what took hold is recorded as spent",
    Object.keys(p.ars.used).sort().join() === "bz_house,bz_long,bz_pockets,bz_polish,bz_second");

  room.g.turnUid = "a";
  let free = null;
  for (let col = 0; col < 6 && !free; col++)
    for (let row = 0; row < 5 && !free; row++)
      if (!room.g.doubles.some((d) => d.col === col && d.row === row)) free = { col, row };
  await say("a", { type: "BZ_PICK", col: free.col, row: free.row });
  room.g.cell.openAt = Date.now() - 500;
  await say("a", { type: "BZ_BUZZ", at: room.g.cell.openAt + 300 });
  room.g.cell.deadline = Date.now() - 1;
  await room.tick();
  const before = p.money;
  await say("a", { type: "BZ_ANSWER", choice: room.g.cell.options.find((o) => o !== room.g.cell.a) });
  ok("a Second Look makes the first wrong answer cost nothing", p.money === before && p.freeWrong === 1);
}

console.log("\navatars");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  await say("a", { type: "BZ_AVATAR", id: "oracle" });
  ok("you take one before the lights go up", room.g.players.a.avatar === "oracle");
  await say("b", { type: "BZ_AVATAR", id: "oracle" });
  ok("and two people cannot wear the same one", /already/.test(seats.b.last("BZ_ERROR").message));
  await say("a", { type: "BZ_SOLO", on: true });
  await boardOf(room, say, "a");
  const worn = Object.values(room.g.players).map((p) => p.avatar);
  ok("everybody ends up wearing something", worn.every(Boolean));
  ok("and no two the same", new Set(worn).size === worn.length);
}

console.log("\nthe computers take their turn");
{
  const { room, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "BZ_SOLO", on: true });
  await say("a", { type: "BZ_AI", count: 3, level: "rookie" });
  await boardOf(room, say, "a");

  // Hand the pick to a computer, the way answering right does.
  room.g.turnUid = "ai0";
  room.schedulePick();
  ok("a computer with the pick is put on a clock", room.g.pickAt > Date.now());
  ok("and a person with the pick is not", (() => {
    room.g.turnUid = "a"; room.schedulePick(); return room.g.pickAt === null;
  })());

  room.g.turnUid = "ai0";
  room.schedulePick();
  room.g.pickAt = Date.now() - 1;
  await room.tick();
  ok("and when the clock runs out it chooses a cell", !!room.g.cell);
  ok("the cell it chose belongs to it", room.g.cell.holder === "ai0" || room.g.turnUid === "ai0");
  ok("and the board knows that cell is gone", room.g.spent[room.g.cell.col][room.g.cell.row] === true);
}

console.log("\na board that nobody is watching");
{
  // The whole point: a computer answering right used to hand itself the pick
  // and then nothing happened, ever, for anybody.
  const { room, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "BZ_SOLO", on: true });
  await say("a", { type: "BZ_AI", count: 3, level: "pro" });
  await boardOf(room, say, "a");
  room.g.turnUid = "ai1";
  room.schedulePick();

  let turns = 0;
  let guard = 0;
  while (room.g.phase === "PLAYING" && guard++ < 400) {
    if (!room.g.cell) {
      if (!room.g.pickAt) break;               // nobody is due to pick: stuck
      room.g.pickAt = Date.now() - 1;
      turns++;
    } else {
      room.g.cell.deadline = Date.now() - 1;
      if (room.g.cell.openAt) room.g.cell.openAt = Date.now() - 6_000;
      if (room.g.cell.aiAnswerAt) room.g.cell.aiAnswerAt = Date.now() - 1;
    }
    await room.tick();
  }
  ok(`the computers clear a whole board between them (${turns} picks)`, turns >= 30);
  ok("and the round moves on rather than stopping", room.g.round === 2 || room.g.phase !== "PLAYING");
  // Either something is happening, or the board is waiting on a person —
  // which is the one kind of waiting that is allowed to last.
  const waiting = room.g.players[room.g.turnUid];
  ok("nobody is left holding a pick nobody can take",
    room.g.phase !== "PLAYING" || !!room.g.cell || !!room.g.pickAt || (waiting && !waiting.ai));
}

console.log("\nwhen the person with the pick walks out");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  await boardOf(room, say, "a");
  room.g.turnUid = "b";
  seats.b.open = false;
  await room.onGone(seats.b);
  ok("the pick goes to somebody who is still here", room.g.turnUid === "a");
  ok("and the board is still running", room.g.phase === "PLAYING");
}

console.log("\nhow quick the computers are");
{
  // What a person races is the quickest of the table, not one of them.
  const r = rngFrom(4242);
  const fastest = (lvl, n) => {
    let sum = 0;
    for (let t = 0; t < 2000; t++) {
      let best = Infinity;
      for (let i = 0; i < n; i++) { const it = aiIntent(lvl, r, n); if (it.buzz && it.reaction < best) best = it.reaction; }
      sum += best === Infinity ? 6000 : best;
    }
    return sum / 2000;
  };
  const rookie3 = fastest("rookie", 3), pro3 = fastest("pro", 3);
  ok(`a Rookie table leaves a person time to think (${Math.round(rookie3)}ms)`, rookie3 > 2_500);
  ok(`a Pro table does not (${Math.round(pro3)}ms)`, pro3 < 2_000);
  ok("and Pro is quicker than Rookie either way", pro3 < rookie3);
  // Adding opponents must not quietly raise the difficulty.
  const one = fastest("club", 1), five = fastest("club", 5);
  ok(`five of them are no quicker than one (${Math.round(one)}ms vs ${Math.round(five)}ms)`,
    five > one * 0.6);
}

console.log("\nbuzzing before the room has noticed");
{
  // The room only wakes when something happens. A person whose reading clock
  // has run out must be able to buzz anyway, because the browser opens the
  // buzzers on its own clock and nothing will have told the room yet.
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  await boardOf(room, say, "a");
  await say("a", { type: "BZ_PICK", col: 0, row: 0 });
  ok("the clue goes up as a reading", room.g.cell.stage === "READING");

  // The reading ends. Nobody has touched the room, so it still says READING.
  room.g.cell.openAt = Date.now() - 700;
  ok("and the room has not noticed on its own", room.g.cell.stage === "READING");

  await say("b", { type: "BZ_BUZZ", at: room.g.cell.openAt + 400 });
  ok("a buzz is taken all the same", room.g.cell.buzzes.length === 1);
  ok("and the room catches up as it does", room.g.cell.stage === "WINDOW");
  ok("no refusal was sent", !seats.b.last("BZ_ERROR"));

  // And one that really is early is still refused.
  const { room: r2, seats: s2, say: y2 } = await roomOf(["a", "Ana"]);
  await boardOf(r2, y2, "a");
  await y2("a", { type: "BZ_PICK", col: 0, row: 0 });
  await y2("a", { type: "BZ_BUZZ", at: Date.now() });
  ok("buzzing during a real reading is still refused", /weren.t open/.test(s2.a.last("BZ_ERROR").message));
}

console.log("\nclosing the app mid-game");
{
  const { room, seats, say, state } = await roomOf(["a", "Ana"]);
  await say("a", { type: "BZ_SOLO", on: true });
  await say("a", { type: "BZ_AI", count: 3, level: "pro" });
  await boardOf(room, say, "a");
  await say("a", { type: "BZ_PICK", col: 0, row: 0 });

  const before = {
    money: room.g.players.a.money,
    spent: room.g.spent.flat().filter(Boolean).length,
    q: room.g.cell.q,
    left: room.g.cell.deadline - Date.now(),
  };

  seats.a.open = false;
  await room.onGone(seats.a);
  ok("the room is held rather than dropped", !!room.g && !!room.g.pausedAt);
  ok("and it is still the match it was", room.g.phase === "PLAYING" && !!room.g.cell);
  ok("held for a day", Math.abs(state.alarmAt() - (room.g.pausedAt + 24 * 60 * 60_000)) < 50);

  // The alarm goes off while they are away — the computers must not play on.
  for (let i = 0; i < 6; i++) await room.alarm();
  ok("the computers do not play to an empty table",
    room.g.cell.q === before.q &&
    room.g.spent.flat().filter(Boolean).length === before.spent &&
    room.g.players.a.money === before.money);
  ok("nobody's money moved while they were gone", room.g.players.a.money === before.money);

  // Back an hour later. To stand an hour in the past without a clock to
  // wind, the whole of the state before the pause has to move with it —
  // moving only pausedAt asks the room to restore a moment that never was.
  const away = 60 * 60_000;
  room.g.pausedAt -= away;
  room.g.startedAt -= away;
  for (const k of ["shownAt", "openAt", "deadline"]) room.g.cell[k] -= away;
  const ws2 = new FakeSocket("a", "Ana");
  state.acceptWebSocket(ws2);
  await room.onJoin("a", "Ana", "QUIZ1", ws2);
  ok("coming back lets the clocks go again", !room.g.pausedAt);
  ok("the same clue is still on the board", room.g.cell.q === before.q);
  const now = room.g.cell.deadline - Date.now();
  ok(`and it has the time left it had (${Math.round(now / 1000)}s)`, Math.abs(now - before.left) < 2_000);
  ok("the board is where it was", room.g.spent.flat().filter(Boolean).length === before.spent);
  ok("and the clue has not silently expired", room.g.cell.deadline > Date.now());
}

console.log("\nand a day later");
{
  const { room, seats, say, state } = await roomOf(["a", "Ana"]);
  await boardOf(room, say, "a");
  seats.a.open = false;
  await room.onGone(seats.a);
  ok("held", !!room.g.pausedAt);

  // Not yet.
  room.g.pausedAt = Date.now() - 23 * 60 * 60_000;
  await room.alarm();
  ok("twenty-three hours later it is still there", !!room.g);

  // Now.
  room.g.pausedAt = Date.now() - 24 * 60 * 60_000 - 1_000;
  await room.alarm();
  ok("a day later it is let go", room.g === null);
}

console.log("\na lobby left open");
{
  const { room, seats, state } = await roomOf(["a", "Ana"]);
  ok("a room starts unheld", !room.g.pausedAt);
  seats.a.open = false;
  await room.onGone(seats.a);
  ok("an abandoned lobby is held too, not binned at half an hour", !!room.g.pausedAt);
  ok("for the same day", Math.abs(state.alarmAt() - (room.g.pausedAt + 24 * 60 * 60_000)) < 50);
}

function avg(xs) { return xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length); }

console.log("\nboard sizes");
{
  ok("three sizes: fifteen, twenty and thirty squares", BOARD_SIZES.map((b) => b.cols * b.rows).join() === "15,20,30");
  ok("easy and medium are five across", sizeById("easy").cols === 5 && sizeById("medium").cols === 5);
  ok("hard is the board as it always was, and the default", sizeById("hard").cols === 6 && sizeById("hard").rows === 5 && sizeById(undefined).id === "hard");
  ok("a smaller board tops out lower", topValue(1, 3) === 600 && topValue(2, 4) === 1600 && topValue(1) === 1000);
  ok("so a Daily Double is wagered against its own board's top", wagerLimit(0, 1, false, 3) === 600 && wagerLimit(0, 1) === 1000);
  ok("Daily Doubles land on the board, never in the top row",
    [3, 4, 5].every((rows) => [1, 2].every((round) => plantDoubles(round, 99 + rows, { cols: 5, rows })
      .every((d) => d.col >= 0 && d.col < 5 && d.row >= 1 && d.row < rows))));
  ok("the full board's Daily Doubles fall where they always did",
    JSON.stringify(plantDoubles(2, 4242)) === JSON.stringify(plantDoubles(2, 4242, sizeById("hard"))));

  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  ok("a new room is the full board", room.g.size === "hard" && seats.a.last("BZ_STATE").game.cols === 6);
  await say("b", { type: "BZ_SIZE", size: "easy" });
  ok("only the host sets the size", room.g.size === "hard" && /Only the host/.test(seats.b.last("BZ_ERROR").message));
  await say("a", { type: "BZ_CATS", ids: CATEGORIES.slice(0, 6).map((c) => c.id) });
  await say("a", { type: "BZ_SIZE", size: "easy" });
  ok("going down a size keeps as many categories as fit", room.g.size === "easy" && room.g.cats.length === 5);
  await say("a", { type: "BZ_SIZE", size: "huge" });
  ok("a size that does not exist is refused", room.g.size === "easy" && /No such board/.test(seats.a.last("BZ_ERROR").message));
  await say("a", { type: "BZ_CATS", ids: CATEGORIES.slice(0, 6).map((c) => c.id) });
  ok("six categories are too many for an easy board", /Pick exactly 5/.test(seats.a.last("BZ_ERROR").message));
  await say("a", { type: "BZ_RANDOM" });
  ok("and Surprise me deals five", room.g.cats.length === 5);

  await say("a", { type: "BZ_START" });
  ok("an easy board starts", room.g.phase === "PLAYING");
  const st = seats.a.last("BZ_STATE").game;
  ok("five across and three down: fifteen squares", room.g.spent.length === 5 && room.g.spent.every((c) => c.length === 3) && st.cols === 5 && st.rows === 3);
  ok("worth two, four and six hundred", st.values.join() === "200,400,600");
  ok("its Daily Double is on it", room.g.doubles.length === 1 && room.g.doubles.every((d) => d.col < 5 && d.row < 3));
  await say("a", { type: "BZ_PICK", col: 5, row: 0 });
  ok("a sixth column is not on it", /isn't a cell/.test(seats.a.last("BZ_ERROR").message));
  await say("a", { type: "BZ_PICK", col: 0, row: 3 });
  ok("and nor is a fourth row", /isn't a cell/.test(seats.a.last("BZ_ERROR").message));
  await say("a", { type: "BZ_SIZE", size: "hard" });
  ok("the size cannot change once the board is up", room.g.size === "easy");
  await say("a", { type: "BZ_PICK", col: 0, row: 0 });
  ok("the top row asks the column's easiest clue", room.g.cell?.q === categoryById(room.g.cats[0].id).clues[0].q);

  // The second board, and Final, on the same small board.
  for (let col = 0; col < 5; col++) for (let row = 0; row < 3; row++) room.g.spent[col][row] = true;
  room.g.cell = { stage: "REVEAL", deadline: Date.now() - 1, col: 0, row: 0, a: "x", wrongUids: [], buzzes: [], aiBuzz: {} };
  await room.tick();
  ok("fifteen squares played brings up the second board", room.g.round === 2);
  ok("the same size again, five by three", room.g.cats.length === 5 && room.g.spent.length === 5 && room.g.spent[0].length === 3);
  ok("doubled: four, eight and twelve hundred", seats.a.last("BZ_STATE").game.values.join() === "400,800,1200");
  ok("with its two Daily Doubles on the board", room.g.doubles.length === 2 && room.g.doubles.every((d) => d.col < 5 && d.row < 3));
  await room.startFinal();
  ok("Final asks the hardest clue an easy board would have", room.g.final.q === categoryById(room.g.final.catId).clues[2].q);
}
{
  // The computers play only what is on the board.
  const { room, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "BZ_SOLO", on: true });
  await say("a", { type: "BZ_SIZE", size: "medium" });
  await say("a", { type: "BZ_RANDOM" });
  await say("a", { type: "BZ_START" });
  ok("a medium board is five by four", room.g.spent.length === 5 && room.g.spent.every((c) => c.length === 4));
  ok("worth up to eight hundred", room.publicState().values.join() === "200,400,600,800");
  const bot = Object.values(room.g.players).find((x) => x.ai);
  const seen = new Set();
  for (let i = 0; i < 21; i++) {
    room.g.cell = null;
    room.g.turnUid = bot.uid;
    await room.aiPick();
    if (room.g.cell) seen.add(room.g.cell.col + ":" + room.g.cell.row);
  }
  ok("a computer picks every one of the twenty squares and nothing else",
    seen.size === 20 && [...seen].every((k) => { const [c, r] = k.split(":").map(Number); return c < 5 && r < 4; }));
}
{
  // A room saved before there were sizes is the full board.
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  delete room.g.size;
  await boardOf(room, say, "a");
  ok("a room from before sizes plays the full board", room.g.phase === "PLAYING" && room.g.spent.length === 6 && seats.a.last("BZ_STATE").game.values.length === 5);
}

console.log(bad ? `\n${bad} failing\n` : "\nall buzzer checks passed\n");
process.exit(bad ? 1 : 0);
