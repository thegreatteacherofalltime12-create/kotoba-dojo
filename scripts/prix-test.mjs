// node scripts/prix-test.mjs
//
// The race: the distance rule that lets every level share a track, the words
// the engine deals, the vote that picks the circuit, and the chat that shuts
// when the lights go out.
import {
  CIRCUITS, LENGTHS, CLASSES, circuitById, lengthById, classById,
  lapsFor, metresFor, capFor, allowanceMs, deckFor, shuffled, scramble,
  distanceFor, raceScore, standings, nearMiss, FULL_BOOST, FLOOR_BOOST, SPIN_COST,
  ITEMS, boxMarks, boxesBetween, itemWeights, rollItem, flared,
  SLIPSTREAM_M, COMET_M, SLICK_M, FLARE_CUT,
} from "../src/prix.js";
import { GrandPrix } from "../src/grand-prix.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

console.log("\nthe track");
ok("six circuits, each with a lap and a class", CIRCUITS.length === 6
  && CIRCUITS.every((c) => c.lapM > 0 && ["easiest", "middle", "hardest"].includes(c.hard)));
ok("three lengths", LENGTHS.length === 3 && LENGTHS.map((l) => l.laps).join() === "2,3,5");
ok("a grand prix is three laps of a thousand", metresFor("cinder", "gp") === 3000);
ok("the short-lap circuit adds two", lapsFor("orbital", "gp") === 5 && metresFor("orbital", "gp") === 3000);
ok("an unknown id falls back rather than throwing",
  circuitById("nope").id === "cinder" && lengthById("nope").id === "gp");
ok("a race cannot run for ever", capFor("cinder", "gp") === 3 * 240_000);

console.log("\nthe distance rule");
const A = 15_000;
ok("inside a third of the allowance is a full boost", distanceFor(0, A) === FULL_BOOST && distanceFor(5_000, A) === FULL_BOOST);
ok("past the allowance is the floor", distanceFor(A, A) === FLOOR_BOOST && distanceFor(A * 3, A) === FLOOR_BOOST);
ok("between the two it falls evenly", distanceFor(10_000, A) === 70);
ok("it never pays more than full or less than the floor", [0, 1, 4999, 5001, 14999, 99999]
  .every((t) => { const d = distanceFor(t, A); return d >= FLOOR_BOOST && d <= FULL_BOOST; }));
// The point of the whole design: quick at your level beats slow at a harder one.
{
  const junior = allowanceMs("WORD", classById("junior"));
  const pro = allowanceMs("SPLINT".slice(0, 6), classById("pro"));
  ok("a junior and a pro being equally quick move equally far",
    distanceFor(junior / 4, junior) === distanceFor(pro / 4, pro));
  ok("and a pro dawdling moves less than a junior hurrying",
    distanceFor(pro * 0.9, pro) < distanceFor(junior / 4, junior));
}

console.log("\nthe words engine");
for (const c of CLASSES) {
  const deck = deckFor(c);
  ok(`${c.id} has a deck, and every word fits its class`,
    deck.length > 40 && deck.every((w) => c.lens.includes(w.word.length) && w.clue.length > 3));
}
ok("an allowance sits between twelve and twenty seconds", CLASSES.every((c) =>
  deckFor(c).every((w) => { const a = allowanceMs(w.word, c); return a >= 12_000 && a <= 20_000; })));
{
  let same = 0;
  for (let i = 0; i < 200; i++) if (scramble("PLANET") === "PLANET") same++;
  ok("a scramble is never the answer", same === 0);
  ok("and it is the same letters", [...scramble("PLANET")].sort().join("") === [..."PLANET"].sort().join(""));
}
{
  const list = [1, 2, 3, 4, 5, 6, 7, 8];
  ok("a shuffle keeps everything", shuffled(list).sort((a, b) => a - b).join() === list.join());
  ok("and does not touch the original", list.join() === "1,2,3,4,5,6,7,8");
}

console.log("\nscoring");
ok("a solo run lives on pace", raceScore({ placement: 1, field: 1, avgRatio: 0, spins: 0, finished: true }) === 90);
ok("winning a field of four pays the most", raceScore({ placement: 1, field: 4, avgRatio: 0.5, spins: 0, finished: true })
  > raceScore({ placement: 4, field: 4, avgRatio: 0.5, spins: 0, finished: true }));
ok("spins cost", raceScore({ placement: 1, field: 2, avgRatio: 0.5, spins: 5, finished: true })
  < raceScore({ placement: 1, field: 2, avgRatio: 0.5, spins: 0, finished: true }));
ok("not finishing costs more than any of it", raceScore({ placement: 1, field: 2, avgRatio: 0, spins: 0, finished: false })
  < raceScore({ placement: 1, field: 2, avgRatio: 0, spins: 0, finished: true }));
ok("nothing escapes the hundred", raceScore({ placement: 1, field: 8, avgRatio: 0, spins: 0, finished: true }) <= 100);
ok("the grid is ordered by distance, then by who got there first",
  standings([{ name: "a", at: 10 }, { name: "b", at: 30 }, { name: "c", at: 30, finishedAt: 5 }])
    .map((p) => p.name).join() === "c,b,a");

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

/** A room with the named racers joined, the first of them hosting. */
async function roomOf(...who) {
  const state = makeState();
  const room = new GrandPrix(state, { FIREBASE_PROJECT_ID: "test" });
  await state._init;
  const seats = {};
  for (const [uid, name] of who) {
    const ws = new FakeSocket(uid, name);
    state.acceptWebSocket(ws);
    await room.onJoin(uid, name, "RACE1", ws);
    seats[uid] = ws;
  }
  const say = (uid, o) => room.webSocketMessage(seats[uid], JSON.stringify(o));
  return { room, seats, say, state };
}

console.log("\nthe grid votes");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"], ["c", "Cy"]);
  ok("a default track until anybody votes", room.g.circuit === "cinder");
  await say("a", { type: "PRIX_VOTE", circuit: "reef" });
  ok("one vote decides it", room.g.circuit === "reef");
  await say("b", { type: "PRIX_VOTE", circuit: "midnight" });
  ok("a tie leaves the track where it stands", room.g.circuit === "reef");
  await say("c", { type: "PRIX_VOTE", circuit: "midnight" });
  ok("the most votes wins", room.g.circuit === "midnight");
  await say("c", { type: "PRIX_VOTE", circuit: "midnight" });
  ok("voting twice takes the vote back", !room.g.votes.c);
  ok("and a tie leaves the track where the vote had already put it", room.g.circuit === "midnight");
  await say("a", { type: "PRIX_VOTE", circuit: "nowhere" });
  ok("a circuit that does not exist is refused", /No such circuit/.test(seats.a.last("PRIX_ERROR").message));
  ok("the tally is public, the ballots are not",
    seats.a.last("PRIX_STATE").game.votes.reef === 1);
  // Nobody has to be the host for any of this.
  ok("the vote is nobody's job in particular", room.g.hostUid === "a" && room.g.votes.b === "midnight");
}
{
  const { room, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_VOTE", circuit: "canyon" });
  ok("a lone racer votes for their own track", room.g.circuit === "canyon");
}

console.log("\nthe paddock");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  await say("a", { type: "PRIX_SAY", text: "good luck" });
  ok("a line reaches the room", seats.b.last("PRIX_CHAT")?.text === "good luck");
  ok("and is kept for whoever arrives next", room.g.chat.length === 1);
  room.g.phase = "RACING";
  await say("a", { type: "PRIX_SAY", text: "still talking" });
  ok("the chat shuts when the lights go out", /shut while the race/.test(seats.a.last("PRIX_ERROR").message));
  ok("and nothing was added", room.g.chat.length === 1);
  ok("the state says so too", room.publicState().chatOpen === false);
}

console.log("\na race");
{
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_CLASS", klass: "junior" });
  await say("a", { type: "PRIX_LENGTH", length: "sprint" });
  await say("a", { type: "PRIX_START" });
  ok("the lights go out", room.g.phase === "RACING");
  const first = seats.a.last("PRIX_ITEM");
  ok("an item arrives, with letters and an allowance", first.scrambled.length === first.len && first.allowanceMs > 0);
  ok("and never the answer", !("answer" in first) && !JSON.stringify(first).includes(room.g.players.a.item.answer));
  ok("junior is told the first letter", first.hint === room.g.players.a.item.answer[0]);

  await say("a", { type: "PRIX_GUESS", guess: "definitelynot" });
  ok("a wrong answer spins you", seats.a.last("PRIX_RESULT").ok === false && room.g.players.a.spins === 1);
  ok("it costs metres but never below zero", room.g.players.a.at === 0);
  ok("and the letters move", seats.a.last("PRIX_ITEM").scrambled.length === first.len);

  const answer = room.g.players.a.item.answer;
  room.g.players.a.item.dealtAt = Date.now();     // answered at once
  await say("a", { type: "PRIX_GUESS", guess: answer.toLowerCase() });
  const res = seats.a.last("PRIX_RESULT");
  ok("the right answer, in any case, is a full boost", res.ok === true && res.delta === FULL_BOOST);
  ok("the room says which word it was", res.word === answer);
  ok("and deals another", room.g.players.a.item.answer !== undefined);

  // The room holds a guess budget, so a script cannot hammer it. Which is
  // what this loop is, so it spends the budget first and then refills it.
  for (let i = 0; i < 30; i++) await say("a", { type: "PRIX_GUESS", guess: "NOPE" });
  ok("a racer who guesses like a script is slowed down", /Slow down/.test(seats.a.last("PRIX_ERROR").message));
  room.g.players.a.spins = 1;
  room.g.players.a.at = 0;

  // Drive it to the flag, refilling the budget the way a real minute would.
  for (let i = 0; i < 40 && room.g.phase === "RACING"; i++) {
    const p = room.g.players.a;
    if (!p.item) break;
    room.buckets.clear();
    p.item.dealtAt = Date.now();
    await say("a", { type: "PRIX_GUESS", guess: p.item.answer });
  }
  ok("the flag falls when the distance is done", room.g.phase === "RESULTS");
  const over = seats.a.last("PRIX_OVER");
  ok("one result, finished", over.results.length === 1 && over.results[0].status === "finished");
  ok("with a score, a placement and MMR", over.results[0].score > 0 && over.results[0].placement === 1
    && typeof over.results[0].gain === "number");
  ok("the spin is on the card", over.results[0].spins === 1);
}

console.log("\nwhat a race refuses");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  await say("b", { type: "PRIX_START" });
  ok("only the host starts it", /Only the host/.test(seats.b.last("PRIX_ERROR").message));
  await say("a", { type: "PRIX_GUESS", guess: "ANY" });
  ok("no guessing before the lights", /No race is running/.test(seats.a.last("PRIX_ERROR").message));
  await say("a", { type: "PRIX_START" });
  await say("a", { type: "PRIX_SKIP" });
  ok("no skipping while the allowance stands", /allowance/.test(seats.a.last("PRIX_ERROR").message));
  room.g.players.a.item.dealtAt = Date.now() - 60_000;
  const had = room.g.players.a.item.answer;
  await say("a", { type: "PRIX_SKIP" });
  ok("once it is gone, a skip moves on for nothing",
    room.g.players.a.item.answer !== had && room.g.players.a.at === 0);
  await say("a", { type: "PRIX_CLASS", klass: "pro" });
  ok("a level cannot be changed mid-race", /Not once the lights/.test(seats.a.last("PRIX_ERROR").message));
  await say("a", { type: "PRIX_VOTE", circuit: "reef" });
  ok("and neither can the track", /The track is set/.test(seats.a.last("PRIX_ERROR").message));
}


console.log("\nitem boxes");
ok("eight items, each with a name and a blurb", ITEMS.length === 8
  && ITEMS.every((i) => i.name && i.blurb.length > 10 && ["self", "ahead", "field", "drop"].includes(i.aim)));
{
  const marks = boxMarks("cinder", "gp");
  ok("four boxes a lap, three laps", marks.length === 12);
  ok("none of them on the start line", marks.every((m) => m > 0));
  ok("they climb", marks.every((m, i) => i === 0 || m > marks[i - 1]));
  ok("bramble hollow is thick with them", boxMarks("bramble", "gp").length === 24);
  ok("crossing is counted by what you passed",
    boxesBetween(0, 200, marks).join() === "125" && boxesBetween(0, 0, marks).length === 0);
  ok("a big jump can take two at once", boxesBetween(0, 400, marks).length === 2);
}
{
  const leader = itemWeights(1, 6);
  const back = itemWeights(6, 6);
  ok("the leader gets things to defend with", leader.slick > 0 && leader.deflector > 0 && !leader.comet);
  ok("the back of the field gets the artillery", back.nitro > 0 && back.flare > 0);
  ok("and the leader never gets a flare", !leader.flare && !itemWeights(2, 6).flare);
  ok("a small field has no flare in it at all", !itemWeights(3, 3).flare);
  ok("alone on the track every box is your own",
    Object.keys(itemWeights(1, 1)).every((k) => ["slipstream", "nitro"].includes(k)));
}
{
  // The roll is weighted, not random: a thousand rolls should only ever
  // return things the band actually carries.
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(rollItem(1, 6));
  ok("a leader rolls only a leader's items",
    [...seen].every((id) => Object.keys(itemWeights(1, 6)).includes(id)) && seen.size > 1);
  const solo = new Set();
  for (let i = 0; i < 400; i++) solo.add(rollItem(1, 1));
  ok("and a lone racer never rolls a weapon", [...solo].every((id) => ["slipstream", "nitro"].includes(id)));
}
ok("a flare takes its cut", flared(100) === Math.round(100 * (1 - FLARE_CUT)));

console.log("\nfiring them");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  await say("a", { type: "PRIX_START" });
  const A = room.g.players.a, B = room.g.players.b;

  await say("a", { type: "PRIX_USE" });
  ok("empty hands fire nothing", /Nothing in your hands/.test(seats.a.last("PRIX_ERROR").message));

  A.holding = "slipstream";
  await say("a", { type: "PRIX_USE" });
  ok("a slipstream is distance", A.at === SLIPSTREAM_M && !A.holding);
  ok("and the room is told", seats.b.last("PRIX_FIRED").item === "slipstream");

  // Ana is ahead now, so Bo's comet has somebody to aim at.
  B.holding = "comet";
  const was = A.at;
  await say("b", { type: "PRIX_USE" });
  ok("a comet takes metres off the racer ahead", A.at === Math.max(0, was - COMET_M));
  ok("and gives them a new word", seats.a.last("PRIX_HIT").item === "comet");

  A.at = 500; B.at = 100;
  A.holding = "slick";
  await say("a", { type: "PRIX_USE" });
  ok("a slick lies behind whoever dropped it", room.g.slicks.length === 1 && room.g.slicks[0].at === 495);
  // Bo needs to be within one answer of it, or the slick is just scenery.
  B.at = 490;
  B.item.dealtAt = Date.now();
  const bWas = B.at;
  await say("b", { type: "PRIX_GUESS", guess: B.item.answer });
  ok("and the next kart over it loses ground",
    B.at === Math.max(0, bWas + FULL_BOOST - SLICK_M) && room.g.slicks.length === 0);

  // A deflector eats the next thing aimed at you, once.
  A.at = 900; B.at = 100;
  A.holding = "deflector";
  await say("a", { type: "PRIX_USE" });
  ok("a deflector goes up", A.deflector === true);
  B.holding = "comet";
  const kept = A.at;
  await say("b", { type: "PRIX_USE" });
  ok("and eats the comet", A.at === kept && A.deflector === false);
  ok("the target is told it was deflected", seats.a.last("PRIX_HIT").deflected === true);

  // Fog and flare sweep everyone in front.
  B.holding = "fog";
  await say("b", { type: "PRIX_USE" });
  ok("fog hides the clue from everyone ahead", A.fogUntil > Date.now());
  ok("and a fogged racer is not sent one", room.itemView(A).clue === null);
  B.holding = "flare";
  await say("b", { type: "PRIX_USE" });
  ok("a flare needs fourth or worse", /fourth or worse/.test(seats.b.last("PRIX_ERROR").message) && B.holding === "flare");

  // Slowed, an answer pays less.
  A.slowUntil = Date.now() + 8_000;
  A.at = 0; A.item.dealtAt = Date.now();
  await say("a", { type: "PRIX_GUESS", guess: A.item.answer });
  ok("an answer under a flare pays less", A.at === flared(FULL_BOOST));
  ok("and the racer is told why", seats.a.last("PRIX_RESULT").slowed === true);
}
{
  // Boxes are picked up by driving over them, one at a time.
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_START" });
  const A = room.g.players.a;
  ok("the track has its boxes laid", room.g.marks.length > 0);
  A.at = room.g.marks[0] - 10;
  A.item.dealtAt = Date.now();
  await say("a", { type: "PRIX_GUESS", guess: A.item.answer });
  ok("driving over one puts an item in your hands", !!A.holding && A.boxes === 1);
  const held = A.holding;
  A.at = room.g.marks[1] - 10;
  A.item.dealtAt = Date.now();
  await say("a", { type: "PRIX_GUESS", guess: A.item.answer });
  ok("holding one means the next box goes by", A.holding === held && A.boxes === 1);
}

console.log(bad ? `\n${bad} failing\n` : "\nall grand prix checks passed\n");
process.exit(bad ? 1 : 0);
