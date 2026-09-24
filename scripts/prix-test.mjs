// node scripts/prix-test.mjs
//
// The race: the distance rule that lets every level share a track, the words
// the engine deals, the vote that picks the circuit, and the chat that shuts
// when the lights go out.
import {
  CIRCUITS, LENGTHS, circuitById, lengthById,
  lapsFor, metresFor, capFor,
  distanceFor, raceScore, standings, FULL_BOOST, FLOOR_BOOST, SPIN_COST, paceScale,
  ITEMS, boxMarks, boxesBetween, itemWeights, rollItem, flared,
  SLIPSTREAM_M, COMET_M, SLICK_M, FLARE_CUT,
  AI_LEVELS, AI_MAX, AI_ALLOWANCE, aiPace, aiShouldFire, metresFor as raceMetres,
} from "../src/prix.js";
import {
  ENGINES, engineById, engineList, defaultLevel,
  wordDeck, scramble, shuffled, nearMiss, mathsProblem, triviaPool, THEMES, MEM_MAX,
  nominalAllowance,
} from "../src/prix-engines.js";
import { GrandPrix } from "../src/grand-prix.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

console.log("\nthe track");
ok("six circuits, each with a lap and a class", CIRCUITS.length === 6
  && CIRCUITS.every((c) => c.lapM > 0 && ["easiest", "middle", "hardest"].includes(c.hard)));
ok("three lengths", LENGTHS.length === 3 && LENGTHS.map((l) => l.laps).join() === "2,3,5");
ok("a grand prix is three laps of the circuit", metresFor("cinder", "gp") === 2400);
ok("the short-lap circuit adds two", lapsFor("orbital", "gp") === 5 && metresFor("orbital", "gp") === 2500);
ok("an unknown id falls back rather than throwing",
  circuitById("nope").id === "cinder" && lengthById("nope").id === "gp");
ok("a race cannot run for ever", capFor("cinder", "gp") === 3 * 300_000);

console.log("\nthe distance rule");
const A = 15_000;
ok("inside a third of the allowance is a full boost", distanceFor(0, A) === FULL_BOOST && distanceFor(5_000, A) === FULL_BOOST);
ok("past the allowance is the floor", distanceFor(A, A) === FLOOR_BOOST && distanceFor(A * 3, A) === FLOOR_BOOST);
ok("between the two it falls evenly", distanceFor(10_000, A) === 75);
ok("it never pays more than full or less than the floor", [0, 1, 4999, 5001, 14999, 99999]
  .every((t) => { const d = distanceFor(t, A); return d >= FLOOR_BOOST && d <= FULL_BOOST; }));
// The point of the whole design: quick at your level beats slow at a harder one.
{
  const words = engineById("words");
  const junior = words.deal("junior", { deck: [] }).allowance;
  const pro = words.deal("pro", { deck: [] }).allowance;
  ok("a junior and a pro being equally quick move equally far",
    distanceFor(junior / 4, junior) === distanceFor(pro / 4, pro));
  ok("and a pro dawdling moves less than a junior hurrying",
    distanceFor(pro * 0.9, pro) < distanceFor(junior / 4, junior));
  // The same holds across engines, which is what lets a family share a track.
  const maths = engineById("maths");
  const infant = maths.deal("g12", {}).allowance;
  const senior = maths.deal("g1112", {}).allowance;
  ok("a first grader and a twelfth grader, both quick, move equally far",
    distanceFor(infant / 4, infant) === distanceFor(senior / 4, senior));
}

console.log("\nthe words engine");
for (const c of engineById("words").levels) {
  const deck = wordDeck(c.id);
  ok(`${c.id} has a deck, and every word carries a clue`,
    deck.length > 40 && deck.every((w) => w.word.length >= 4 && w.clue.length > 3));
}
ok("an allowance sits between twelve and twenty seconds",
  engineById("words").levels.every((c) => {
    const p = { deck: [] };
    return [...Array(30)].every(() => { const a = engineById("words").deal(c.id, p).allowance; return a >= 12_000 && a <= 20_000; });
  }));
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
  const fullScale = room.scaleOf(room.g.players.a);
  await say("a", { type: "PRIX_GUESS", guess: answer.toLowerCase() });
  const res = seats.a.last("PRIX_RESULT");
  ok("the right answer, in any case, is a full boost", res.ok === true && res.delta === Math.round(FULL_BOOST * fullScale));
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
  ok("crossing the line starts the clock on the rest", !!room.g.flagAt && room.g.players.a.done);
  ok("and the room is told how long they have", seats.a.last("PRIX_FLAG").graceMs > 0);
  // The grace runs out; the alarm drops the flag on whoever is still out there.
  room.g.flagAt = Date.now() - 1;
  await room.alarm();
  ok("the flag falls when the grace is gone", room.g.phase === "RESULTS");

  const over = seats.a.last("PRIX_OVER");
  const mine = over.results.find((r) => r.uid === "a");
  ok("the human is first and finished", mine.placement === 1 && mine.status === "finished");
  ok("with a score and MMR", mine.score > 0 && typeof mine.gain === "number");
  ok("the spin is on the card", mine.spins === 1);
  ok("the computers are on the grid but not in the record",
    over.results.length === 4 && over.results.filter((r) => r.uid.startsWith("ai")).length === 3);
  ok("and the record keeps only the people", room.isAi("ai0") && !room.isAi("a"));
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
    boxesBetween(0, 200, marks).join() === "100" && boxesBetween(0, 0, marks).length === 0);
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
  const slipScale = room.scaleOf(A);
  await say("a", { type: "PRIX_USE" });
  // It is spent, though the distance may well have run over another box.
  ok("a slipstream is distance", A.at === Math.round(SLIPSTREAM_M * slipScale) && A.fired === 1);
  ok("and the room is told", seats.b.last("PRIX_FIRED").item === "slipstream");

  // Ana is ahead now, so Bo's comet has somebody to aim at.
  B.holding = "comet";
  const was = A.at;
  const cometScale = room.scaleOf(A);
  await say("b", { type: "PRIX_USE" });
  ok("a comet takes metres off the racer ahead", A.at === Math.max(0, was - Math.round(COMET_M * cometScale)));
  ok("and gives them a new word", seats.a.last("PRIX_HIT").item === "comet");

  A.at = 500; B.at = 100;
  A.holding = "slick";
  await say("a", { type: "PRIX_USE" });
  ok("a slick lies behind whoever dropped it", room.g.slicks.length === 1 && room.g.slicks[0].at === 495);
  // Bo needs to be within one answer of it, or the slick is just scenery.
  B.at = 490;
  B.item.dealtAt = Date.now();
  const bWas = B.at;
  const bScale = room.scaleOf(B);
  await say("b", { type: "PRIX_GUESS", guess: B.item.answer });
  ok("and the next kart over it loses ground",
    B.at === Math.max(0, bWas + Math.round(FULL_BOOST * bScale) - Math.round(SLICK_M * bScale)) && room.g.slicks.length === 0);

  // A deflector eats the next thing aimed at you, once.
  A.at = 900; B.at = 100;
  A.holding = "deflector";
  await say("a", { type: "PRIX_USE" });
  ok("a deflector goes up", A.deflector === 1);
  B.holding = "comet";
  const kept = A.at;
  await say("b", { type: "PRIX_USE" });
  ok("and eats the comet", A.at === kept && A.deflector === 0);
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
  const flareScale = room.scaleOf(A);
  await say("a", { type: "PRIX_GUESS", guess: A.item.answer });
  ok("an answer under a flare pays less", A.at === Math.round(flared(FULL_BOOST) * flareScale));
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


console.log("\ncomputer drivers");
ok("three standards, slowest to quickest", AI_LEVELS.map((l) => l.id).join() === "easy,medium,hard");
{
  const pace = (id) => { const p = [...Array(400)].map(() => aiPace(id)); return p.reduce((a, b) => a + b) / p.length; };
  const speed = (id) => {
    const p = [...Array(400)].map(() => aiPace(id));
    const d = p.map((t) => distanceFor(t, AI_ALLOWANCE));
    return (d.reduce((a, b) => a + b) / d.length) / (p.reduce((a, b) => a + b) / p.length);
  };
  ok("a Pro is quicker over a word than a Rookie", pace("hard") < pace("medium") && pace("medium") < pace("easy"));
  ok("and quicker down the road", speed("hard") > speed("medium") && speed("medium") > speed("easy"));
  // The point of a cap is to end a room, not to beat the slowest driver.
  const sprint = raceMetres("cinder", "sprint");
  ok("every standard can finish a sprint inside the cap",
    ["easy", "medium", "hard"].every((id) => (sprint / speed(id)) < capFor("cinder", "sprint")));
  ok("no two words take exactly the same time", new Set([...Array(50)].map(() => aiPace("medium"))).size > 20);
}
{
  const always = () => 0;    // never holds back
  ok("a self item goes straight away",
    aiShouldFire({ item: "slipstream", hasTargetAhead: false, lap: 1, laps: 3, level: "hard" }, always));
  ok("a weapon needs somebody in front",
    !aiShouldFire({ item: "comet", hasTargetAhead: false, lap: 1, laps: 3, level: "hard" }, always));
  ok("and goes on the last lap whatever the standard",
    aiShouldFire({ item: "comet", hasTargetAhead: true, lap: 3, laps: 3, level: "hard" }, () => 0));
  const patient = { item: "comet", hasTargetAhead: true, lap: 1, laps: 3 };
  ok("a Pro sits on one early where a Rookie throws it",
    !aiShouldFire({ ...patient, level: "hard" }, () => 0.2)
    && aiShouldFire({ ...patient, level: "easy" }, () => 0.2));
}

console.log("\nthe drivers on the track");
{
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_AI", count: 4, level: "hard" });
  ok("the host says how many and how good", room.g.aiCount === 4 && room.g.aiLevel === "hard");
  await say("a", { type: "PRIX_AI", count: 99 });
  ok("and cannot seat more than the grid holds", room.g.aiCount === AI_MAX);
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_START" });
  const drivers = Object.values(room.g.players).filter((p) => p.ai);
  ok("they line up when the lights go out", drivers.length === AI_MAX);
  ok("each with a name and a standard", drivers.every((d) => d.name.includes("Pro") && d.at === 0));
  ok("and a first word already due", drivers.every((d) => d.nextAt > Date.now()));
  ok("the room knows when to wake for them", room.nextDriverAt() > Date.now());

  // Wind every driver's clock forward and let the alarm drive them.
  for (const d of drivers) d.nextAt = Date.now() - 1;
  await room.driveDue();
  ok("a driver that is due takes a word", drivers.every((d) => d.solved >= 1 && d.at > 0));
  ok("and is not due again straight away", drivers.every((d) => d.nextAt > Date.now()));
  ok("the grid is pushed to whoever is watching", seats.a.last("PRIX_STATE").game.players.length === 6);
  ok("a driver is marked as one", seats.a.last("PRIX_STATE").game.players.some((p) => p.ai));

  // Fog costs a driver the time it costs a person.
  const one = drivers[0];
  one.fogUntil = Date.now() + 5_000;
  one.nextAt = Date.now() - 1;
  const had = one.solved;
  await room.driveDue();
  ok("a fogged driver waits it out", one.solved === had && one.nextAt > Date.now() + 4_000);
}
{
  // A driver takes the flag, and the grace period starts for everyone else.
  const { room, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_AI", count: 1, level: "hard" });
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_START" });
  const d = Object.values(room.g.players).find((p) => p.ai);
  d.at = raceMetres(room.g.circuit, room.g.length) - 10;
  d.nextAt = Date.now() - 1;
  await room.driveDue();
  ok("a driver can take the flag", d.done === true && !!room.g.flagAt);
  ok("and the race is still running for the rest", room.g.phase === "RACING");
  room.g.flagAt = Date.now() - 1;
  await room.alarm();
  ok("until the grace runs out", room.g.phase === "RESULTS");
}


console.log("\nfour engines, one shape");
ok("four of them, each with levels and a way of answering", ENGINES.length === 4
  && ENGINES.every((e) => e.levels.length >= 3 && ["type", "number", "tiles", "choice"].includes(e.kind)));
ok("what the browser is told about the engines carries no answers",
  !engineList().some((e) => "answer" in e || e.levels.some((l) => "answer" in l)));
ok("every engine starts a racer somewhere sensible",
  ENGINES.every((e) => e.levels.some((l) => l.id === defaultLevel(e.id))));
{
  // The one rule that has to hold everywhere: what a racer is shown must
  // never contain the answer.
  let leaked = null;
  for (const e of ENGINES) {
    for (const lv of e.levels) {
      for (let i = 0; i < 40; i++) {
        const racer = { deck: [], memLen: 5 };
        const item = e.deal(lv.id, racer);
        const face = e.face(item, e.hideFor(item, Date.now()));
        // Only what the racer can read: a sequence length of 1 is not a leak
        // of the answer 1, but a sum with its own answer written in it is.
        const shown = [face.text, face.clue, face.scrambled, face.hint, face.question].filter(Boolean).join(" ");
        if ("answer" in face) leaked = e.id + "/" + lv.id + ": the face carries the answer";
        // A word written inside its own clue would be a real leak. A digit
        // turning up in a sum is arithmetic.
        else if (e.kind === "type" && shown.includes(String(item.answer))) leaked = e.id + "/" + lv.id + ": " + shown;
      }
    }
  }
  ok("no engine shows a racer the answer", leaked === null);
  if (leaked) console.log("      " + leaked);
}
{
  let wrongAllowance = null;
  for (const e of ENGINES) {
    for (const lv of e.levels) {
      const item = e.deal(lv.id, { deck: [], memLen: 5 });
      if (!(item.allowance >= 5_000 && item.allowance <= 60_000)) wrongAllowance = e.id + "/" + lv.id + ":" + item.allowance;
    }
  }
  ok("every allowance is between five seconds and a minute", wrongAllowance === null);
}

console.log("\nthe maths engine");
{
  const maths = engineById("maths");
  ok("six bands, first grade to twelfth", maths.levels.length === 6
    && maths.levels[0].id === "g12" && maths.levels[5].id === "g1112");
  ok("a harder band pays more", maths.levels[5].mult > maths.levels[0].mult);
  let bad2 = null;
  for (const lv of maths.levels) {
    for (let i = 0; i < 200; i++) {
      const q = mathsProblem(lv.id);
      // Every answer is a whole number: nobody loses a race to a rounding
      // convention, and a number pad can type all of them.
      if (!Number.isFinite(q.answer)) bad2 = lv.id + " not a number";
      else if (!Number.isInteger(q.answer)) bad2 = lv.id + " not whole: " + q.answer;
      else if (!q.text || q.text.length < 3) bad2 = lv.id + " no question";
    }
  }
  ok("every problem has a question and a workable answer", bad2 === null);
  ok("an infant sum is small", [...Array(50)].every(() => Math.abs(mathsProblem("g12").answer) <= 20));
  ok("the answer is checked as a number, not as text",
    maths.check({ answer: "12" }, " 12 ") === "right"
    && maths.check({ answer: "12" }, "+12") === "right"
    && maths.check({ answer: "-5" }, "\u22125") === "right"
    && maths.check({ answer: "12" }, "13") === "wrong"
    && maths.check({ answer: "12" }, "") === "wrong");
  ok("and there is no near miss in arithmetic", maths.check({ answer: "12" }, "21") === "wrong");
}

console.log("\nthe memory engine");
{
  const mem = engineById("memory");
  const item = mem.deal("standard", { memLen: 0 });
  ok("a sequence of tiles, and the tiles to tap", item.seq.length === 4 && item.tiles === 6);
  ok("the allowance carries the watching as well as the tapping", item.allowance > item.seq.length * item.flashMs);
  ok("a longer sequence is given longer", mem.deal("standard", { memLen: 8 }).allowance > item.allowance);
  ok("it is answered by tapping them back", mem.check(item, item.seq.join(",")) === "right");
  ok("in order", mem.check(item, [...item.seq].reverse().join(",")) === (item.seq.join(",") === [...item.seq].reverse().join(",") ? "right" : "wrong"));
  ok("and never grows past what anyone can hold", mem.deal("long", { memLen: 99 }).seq.length === MEM_MAX);
}

console.log("\nthe trivia engine");
{
  const triv = engineById("trivia");
  ok("the themes the arena already carries", THEMES.length >= 20 && THEMES.every((t) => t.id && t.name));
  const item = triv.deal("easy", { deck: [] }, Math.random, "mixed");
  ok("a question and four answers", item.question.length > 3 && item.options.length === 4);
  ok("the right one is among them", Number(item.answer) >= 0 && Number(item.answer) < 4);
  ok("no two the same", new Set(item.options).size === 4);
  ok("it is answered by tapping one",
    triv.check(item, item.answer) === "right" && triv.check(item, String((Number(item.answer) + 1) % 4)) === "wrong");
  {
    const pool = triviaPool("easy", THEMES[0].id);
    ok("a theme narrows the pool", pool.length > 0 && pool.every((q) => q.theme === THEMES[0].id));
  }
  {
    // The wrong answers come from the same theme, so nobody wins on register.
    const one = triv.deal("easy", { deck: [] }, Math.random, THEMES[0].id);
    const pool = triviaPool("easy", THEMES[0].id).map((q) => q.answer);
    ok("and the wrong answers come from it too", one.options.every((o) => pool.includes(o)));
  }
}

console.log("\nswitching engines");
{
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  ok("a race runs on words until told otherwise", room.g.engine === "words");
  await say("b", { type: "PRIX_ENGINE", engine: "maths" });
  ok("only the host changes it", room.g.engine === "words");
  await say("a", { type: "PRIX_ENGINE", engine: "maths" });
  ok("the host changes it", room.g.engine === "maths");
  ok("and everybody's level moves to that engine's", Object.values(room.g.players).every((p) => p.klass === defaultLevel("maths")));
  await say("a", { type: "PRIX_CLASS", klass: "junior" });
  ok("a word class means nothing in a maths race", room.g.players.a.klass !== "junior");
  await say("a", { type: "PRIX_CLASS", klass: "g910" });
  ok("but a grade does", room.g.players.a.klass === "g910");
  await say("a", { type: "PRIX_START" });
  const item = seats.a.last("PRIX_ITEM");
  ok("the item that arrives is a sum", item.kind === "number" && !!item.text && !item.scrambled);
  ok("and it is answered as one", (await say("a", { type: "PRIX_GUESS", guess: room.g.players.a.item.answer })) === undefined
    && room.g.players.a.solved === 1);
}
{
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_ENGINE", engine: "memory" });
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_START" });
  const A = room.g.players.a;
  ok("a memory race deals tiles", seats.a.last("PRIX_ITEM").kind === "tiles");
  const seq = A.item.answer;
  await say("a", { type: "PRIX_GUESS", guess: seq });
  ok("tapping them back is right", A.solved === 1);
  ok("and the next one is longer", A.memLen === 5);
  await say("a", { type: "PRIX_GUESS", guess: "9,9,9" });
  ok("missing one shortens it again", A.memLen === 4 && A.spins === 1);
}
{
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_ENGINE", engine: "trivia" });
  await say("a", { type: "PRIX_THEME", theme: THEMES[0].id });
  ok("the host picks the theme", room.g.theme === THEMES[0].id);
  await say("a", { type: "PRIX_THEME", theme: "nonsense" });
  ok("and cannot pick one that is not there", room.g.theme === THEMES[0].id);
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_START" });
  const item = seats.a.last("PRIX_ITEM");
  ok("a trivia race deals a question and four answers", item.kind === "choice" && item.options.length === 4);
  ok("and never says which is right", !("answer" in item));
}


console.log("\nthe Grand Prix arsenal");
{
  const { ARSENALS } = await import("../src/arsenals.js");
  const kit = ARSENALS.prix;
  ok("eighteen tokens, each with a price and a limit", Object.keys(kit).length === 18
    && Object.values(kit).every((t) => t.price > 0 && t.max > 0 && t.name));
  // The claim is not about names — Slick Tyres are tyres. It is that money
  // buys you a better car and never a gun, so a racer who arms the lot can
  // do nothing whatever to anybody else.
  {
    const { room, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
    room.g.players.a.ars = { armed: Object.fromEntries(Object.keys(kit).map((k) => [k, 1])), used: {} };
    await say("a", { type: "PRIX_START" });
    const B = room.g.players.b;
    ok("not one of them touches another racer",
      B.at === 0 && !B.holding && !B.fogUntil && !B.slowUntil && !B.deflector && B.spins === 0);
  }
  ok("they are priced like the other arsenals",
    Object.values(kit).every((t) => t.price >= 300 && t.price <= 5_000));
}

/** A room with one racer, and a named token armed n times. */
async function fitted(armed) {
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_AI", count: 1, level: "easy" });
  room.g.players.a.ars = { armed: { ...armed }, used: {} };
  await say("a", { type: "PRIX_START" });
  return { room, seats, say, A: room.g.players.a };
}

{
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "ARM_TOKEN", key: "gp_nope" });
  ok("an unknown token is refused", /No such token/.test(seats.a.last("PRIX_TOKENS").error));
  await say("a", { type: "ARM_TOKEN", key: "gp_start" });
  ok("holding none means arming none", /hold no more/.test(seats.a.last("PRIX_TOKENS").error));
  room.g.players.a.ars = { armed: { gp_start: 3 }, used: {} };
  await say("a", { type: "ARM_TOKEN", key: "gp_start" });
  ok("three Start Boosts is the limit", /limit for one race/.test(seats.a.last("PRIX_TOKENS").error));
  await say("a", { type: "DISARM_TOKEN", key: "gp_start" });
  ok("an armed token can be put back", room.g.players.a.ars.armed.gp_start === 2);
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_START" });
  await say("a", { type: "ARM_TOKEN", key: "gp_start" });
  ok("and nothing is armed once the lights are out", /Not once the lights/.test(seats.a.last("PRIX_TOKENS").error));
}
{
  const { A } = await fitted({ gp_start: 2 });
  const startScale = paceScale(nominalAllowance("words", A.klass));
  ok("a Start Boost is metres off the line", A.at === Math.round(400 * startScale));
  ok("and it is spent by taking it", A.ars.used.gp_start === 2);
}
{
  const { A, say } = await fitted({ gp_tyres: 1 });
  const was = A.at;
  await say("a", { type: "PRIX_GUESS", guess: "definitely wrong" });
  ok("Slick Tyres soften a spin", A.at === Math.max(0, was - 5) && A.spins === 1);
}
{
  const { A, say, seats } = await fitted({ gp_spare: 1 });
  await say("a", { type: "PRIX_GUESS", guess: "definitely wrong" });
  ok("a Spare Word covers the first mistake of a lap", A.spins === 0 && A.at === 0);
  ok("and says so", seats.a.last("PRIX_RESULT").spare === true);
  await say("a", { type: "PRIX_GUESS", guess: "wrong again" });
  ok("but only the first", A.spins === 1);
}
{
  const { room, A, say } = await fitted({ gp_warmup: 1 });
  A.item.dealtAt = Date.now() - 60_000;      // slow enough for the floor
  const warmScale = room.scaleOf(A);
  await say("a", { type: "PRIX_GUESS", guess: A.item.answer });
  ok("a Warm-Up Lap pays full whatever the clock said", A.at === Math.round(FULL_BOOST * warmScale) && A.warmup === 2);
}
{
  const { room, A, say } = await fitted({ gp_tow: 1 });
  A.item.dealtAt = Date.now();
  const towScale = room.scaleOf(A);
  await say("a", { type: "PRIX_GUESS", guess: A.item.answer });
  ok("a Tow Rope adds to the answer", A.at === Math.round((FULL_BOOST + 20) * towScale) && A.tow === 4);
}
{
  const { room, A } = await fitted({ gp_fuel: 1 });
  // Deal the same racer an item with the fuel off, then on, from a deck
  // pinned to one word, so only the fuel differs.
  const deck = () => ["PLANET A world"];
  A.fuel = false; A.deck = deck(); const dry = room.deal(A).allowance;
  A.fuel = true;  A.deck = deck(); const wet = room.deal(A).allowance;
  ok("Long Fuel buys time on every item", wet === Math.round(dry * 1.2) && wet > dry);
}
{
  const { A } = await fitted({ gp_slip: 1, gp_nitro: 1, gp_twin: 1 });
  ok("two canisters and a Twin Box fill both hands",
    [A.holding, A.holding2].sort().join() === "nitro,slipstream");
}
{
  const { A } = await fitted({ gp_seal: 1 });
  ok("a Scrutineer's Seal is a Deflector at the lights", A.deflector === 1);
}
{
  const { room, A, say } = await fitted({ gp_guards: 1 });
  room.g.slicks = [{ at: 50, by: "someone" }];
  A.at = 0; A.item.dealtAt = Date.now();
  const guardScale = room.scaleOf(A);
  await say("a", { type: "PRIX_GUESS", guess: A.item.answer });
  ok("Mudguards shrug the oil off", A.at === Math.round(FULL_BOOST * guardScale) && room.g.slicks.length === 0);
}
{
  const { A, say, seats } = await fitted({ gp_spotter: 1 });
  ok("a Spotter carries three skips", A.skips === 3);
  const had = A.item.answer;
  await say("a", { type: "PRIX_SKIP" });
  ok("and does not wait for the allowance", A.item.answer !== had && A.skips === 2);
}
{
  const { A } = await fitted({ gp_polish: 1, gp_points: 1 });
  ok("Podium Polish and a Points Finish are fitted", A.polish === 8 && A.pointsFinish === true);
}
{
  // A race nobody finished still scores, because of the Points Finish.
  const { room, A } = await fitted({ gp_points: 1 });
  A.at = 10;
  await room.finish();
  const card = room.g.players.a;
  ok("a Points Finish is scored as a finish", card.score > 30);
}
{
  const { room, A, seats } = await fitted({ gp_start: 1 });
  await room.finish();
  const over = seats.a.last("PRIX_OVER");
  const mine = over.results.find((r) => r.uid === "a");
  ok("what was armed is on the card as spent", mine.spent.gp_start === 1);
  ok("and nothing stays armed for the next race", Object.keys(room.g.players.a.ars.armed).length === 0);
}


console.log("\nwhat the races taught");
{
  // A stated answer that is not the true one teaches a child the wrong
  // arithmetic and spins them for being right. This is the check that was
  // missing: not "is it whole" but "is it true".
  const { mathsProblem } = await import("../src/prix-engines.js");
  const truth = (text) => {
    let m;
    if ((m = /^(\d+)% of (\d+)$/.exec(text))) return (+m[2] * +m[1]) / 100;
    if ((m = /^(\d+)\/(\d+) of (\d+)$/.exec(text))) return (+m[3] / +m[2]) * +m[1];
    if ((m = /^([\d.]+) \u00d7 ([\d.]+)$/.exec(text))) return +m[1] * +m[2];
    if ((m = /^(\d+) \u00f7 (\d+)$/.exec(text))) return +m[1] / +m[2];
    if ((m = /^(\d+) \+ (\d+) \u00d7 (\d+)$/.exec(text))) return +m[1] + +m[2] * +m[3];
    if ((m = /^(\d+) \+ (\d+)$/.exec(text))) return +m[1] + +m[2];
    if ((m = /^(\d+) \u2212 (\d+)$/.exec(text))) return +m[1] - +m[2];
    if ((m = /^\u2212(\d+) \+ (\d+)$/.exec(text))) return +m[2] - +m[1];
    if ((m = /^(\d+)\^(\d+)$/.exec(text))) return Math.pow(+m[1], +m[2]);
    return null;
  };
  let lied = null, checked = 0, whole = null;
  for (const lv of ["g12", "g34", "g56", "g78", "g910", "g1112"]) {
    for (let i = 0; i < 3_000; i++) {
      const q = mathsProblem(lv);
      if (!Number.isInteger(q.answer)) whole ??= lv + ": " + q.text + " = " + q.answer;
      const t = truth(q.text);
      if (t === null) continue;
      checked += 1;
      if (t !== q.answer) lied ??= lv + ": " + q.text + " says " + q.answer + ", truth " + t;
    }
  }
  ok("every band's answer is a whole number" + (whole ? " — " + whole : ""), whole === null);
  ok(`every sum that can be read back is true (${checked} checked)` + (lied ? " \u2014 " + lied : ""), lied === null);
}
{
  // The Pro class promises the clue after eight seconds. Held for ever is
  // not the same promise.
  const words = (await import("../src/prix-engines.js")).ENGINES.find((e) => e.id === "words");
  const item = { answer: "PLANET", clue: "A world", scrambled: "TENALP", hideClueMs: 8_000 };
  ok("the clue is held at the deal", words.hideFor(item, Date.now()) > 7_000);
  ok("and given up once the hold is gone", words.hideFor(item, Date.now() - 9_000) === 0);
  ok("with the face following it", words.face(item, 0).clue === "A world"
    && words.face(item, 8_000).clue === null);
}
{
  // Watching the tiles is not answering them.
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_ENGINE", engine: "memory" });
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_START" });
  const A = room.g.players.a;
  const it = A.item;
  ok("a memory item says how much of it is the flashing", it.leadMs > 0 && it.leadMs < it.allowance);
  ok("the browser is told, so the bar agrees", seats.a.last("PRIX_ITEM").leadMs === it.leadMs);
  // Answer the moment the tiles finish: that is as fast as anybody can be,
  // and it has to pay a full boost.
  it.dealtAt = Date.now() - it.leadMs;
  const memScale = room.scaleOf(A);
  await say("a", { type: "PRIX_GUESS", guess: it.answer });
  ok("answering the instant the tiles stop pays a full boost", A.at === Math.round(FULL_BOOST * memScale));
}
{
  // The arsenal has to be drawable, or none of the eighteen exist.
  const { room } = await roomOf(["a", "Ana"]);
  const view = room.arsenalView(room.g.players.a);
  ok("the arsenal is switched on", view.on === true);
  ok("and carries the room's own limits", Object.keys(view.max || {}).length === 18);
}
{
  // The face, asked for again.
  const { room, seats, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_START" });
  const had = seats.a.all("PRIX_ITEM").length;
  await say("a", { type: "PRIX_PEEK" });
  ok("a peek sends the face again", seats.a.all("PRIX_ITEM").length === had + 1);
  ok("and does not deal a new one", seats.a.last("PRIX_ITEM").dealtAt === room.g.players.a.item.dealtAt);
}


console.log("\na level is not a speed");
{
  // The rule the whole game rests on: answering well pays a full boost at
  // any level, but a race is run in seconds. Unless an answer is worth what
  // it cost in time, the easiest level simply wins.
  const speeds = [];
  for (const [engine, level] of [
    ["maths", "g12"], ["maths", "g34"], ["maths", "g56"], ["maths", "g78"],
    ["maths", "g910"], ["maths", "g1112"], ["words", "junior"], ["words", "pro"],
    ["memory", "short"], ["memory", "long"], ["trivia", "easy"], ["trivia", "hard"],
  ]) {
    const a = nominalAllowance(engine, level);
    // Answering inside a third of your own clock is the best anyone can do.
    speeds.push((distanceFor(0, a) * paceScale(a)) / (a / 3000));
  }
  const spread = Math.max(...speeds) - Math.min(...speeds);
  ok(`twelve levels across four engines move at one speed (${speeds[0].toFixed(1)} m/s, spread ${spread.toFixed(4)})`, spread < 0.01);
}
{
  // The same thing in a room, with two people racing side by side.
  const { room, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  await say("a", { type: "PRIX_ENGINE", engine: "maths" });
  await say("a", { type: "PRIX_CLASS", klass: "g12" });
  await say("b", { type: "PRIX_CLASS", klass: "g1112" });
  await say("a", { type: "PRIX_START" });
  const A = room.g.players.a, B = room.g.players.b;
  ok("each racer keeps their own level", A.klass === "g12" && B.klass === "g1112");
  const sa = room.scaleOf(A), sb = room.scaleOf(B);
  const now = Date.now();
  A.item.dealtAt = now; B.item.dealtAt = now;
  await say("a", { type: "PRIX_GUESS", guess: A.item.answer });
  await say("b", { type: "PRIX_GUESS", guess: B.item.answer });
  ok("an infant sum carries an infant distance", A.at === Math.round(FULL_BOOST * sa));
  ok("an eleventh-grade one carries much further", B.at === Math.round(FULL_BOOST * sb));
  // Both answered as well as anyone can. Over a second of racing they must
  // have covered the same ground.
  const aSpeed = A.at / (sa * 5);
  const bSpeed = B.at / (sb * 5);
  ok(`and both move at the same speed (${aSpeed.toFixed(1)} vs ${bSpeed.toFixed(1)} m/s)`, Math.abs(aSpeed - bSpeed) < 0.6);
}
{
  // A long stride can clear several boxes at once. Those are not thrown
  // away, or a racer would collect fewer items for the clock they were on.
  const { room, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_START" });
  const A = room.g.players.a;
  A.holding = null; A.owed = 0;
  const marks = room.g.marks || [];
  const far = marks[2] + 1;
  room.advance(null, A, (far - A.at) / room.scaleOf(A));
  ok("a stride over three boxes takes one and banks the rest", !!A.holding && A.owed > 0);
  const banked = A.owed;
  A.holding = null;
  room.advance(null, A, 0);
  ok("and the next free hand collects one", !!A.holding && A.owed === banked - 1);
}
{
  // A computer driver is judged against the reference clock, so it converts
  // at one whatever the people around it are doing.
  const { room, say } = await roomOf(["a", "Ana"]);
  await say("a", { type: "PRIX_SOLO", on: true });
  await say("a", { type: "PRIX_AI", count: 1, level: "medium" });
  await say("a", { type: "PRIX_START" });
  const bot = Object.values(room.g.players).find((x) => x.ai);
  ok("a driver converts at the reference clock", room.scaleOf(bot) === 1);
}


console.log("\nspent only by working");
{
  // The limits have to be what a car can actually use, or the tab invites
  // a player to buy something that does nothing.
  const { ARSENALS } = await import("../src/arsenals.js");
  const kit = ARSENALS.prix;
  const stacks = ["gp_start", "gp_tow", "gp_slip", "gp_nitro", "gp_warmup",
    "gp_seal", "gp_spotter", "gp_spare", "gp_magnet", "gp_polish"];
  const wrong = Object.entries(kit)
    .filter(([k, t]) => !stacks.includes(k) && t.max !== 1)
    .map(([k]) => k);
  ok("a token that cannot stack has a limit of one" + (wrong.length ? " \u2014 " + wrong.join(", ") : ""), wrong.length === 0);
  ok("and the shop says the same", (await import("../public/boost.js")).PRIX_ARSENAL_ITEMS
    .every((t) => t.max === kit[t.key].max));
}
{
  // A second canister has nowhere to go without a Twin Box, so it is not
  // taken. This was costing 1,500 for nothing.
  const { A } = await fitted({ gp_slip: 1, gp_nitro: 1 });
  ok("one hand holds one canister", !!A.holding && !A.holding2);
  ok("and only the one that landed is spent",
    (A.ars.used.gp_slip || 0) + (A.ars.used.gp_nitro || 0) === 1);
}
{
  const { A } = await fitted({ gp_slip: 2 });
  ok("a second canister of the same kind is left alone too", A.ars.used.gp_slip === 1);
}
{
  const { A } = await fitted({ gp_slip: 1, gp_nitro: 1, gp_twin: 1 });
  ok("a Twin Box gives the second one a hand", !!A.holding && !!A.holding2);
  ok("and then both are spent", A.ars.used.gp_slip === 1 && A.ars.used.gp_nitro === 1);
}
{
  // Nothing armed beyond what a car can use is charged for.
  const { A } = await fitted({ gp_tyres: 4, gp_guards: 3, gp_radio: 4 });
  ok("a second of something that cannot stack is not taken",
    A.ars.used.gp_tyres === 1 && A.ars.used.gp_guards === 1 && A.ars.used.gp_radio === 1);
  ok("and the one that was taken still works", A.tyres === true && A.guards === true && A.radio === true);
}
{
  // The ones that do stack, stack.
  const { A } = await fitted({ gp_warmup: 2, gp_spotter: 2, gp_polish: 2, gp_magnet: 2 });
  ok("two Warm-Up Laps are six answers", A.warmup === 6);
  ok("two Spotters are six skips", A.skips === 6);
  ok("two Podium Polishes are sixteen points", A.polish === 16);
  ok("two Box Magnets are six boxes", A.magnet === 6);
  ok("and every one of them is spent", A.ars.used.gp_warmup === 2 && A.ars.used.gp_spotter === 2
    && A.ars.used.gp_polish === 2 && A.ars.used.gp_magnet === 2);
}
{
  const { room, A } = await fitted({ gp_seal: 2 });
  ok("two Seals are two shields", A.deflector === 2);
  room.land(A, "comet", { metres: 10 });
  room.land(A, "comet", { metres: 10 });
  ok("each eats one thing aimed at you", A.deflector === 0);
  ok("and the third gets through", room.land(A, "comet", { metres: 10 }) === true);
}
{
  const { A, say } = await fitted({ gp_spare: 2 });
  ok("two Spare Words cover two mistakes a lap", A.spares === 2);
  await say("a", { type: "PRIX_GUESS", guess: "definitely wrong" });
  await say("a", { type: "PRIX_GUESS", guess: "definitely wrong" });
  ok("neither costs a spin", A.spins === 0 && A.at === 0);
  await say("a", { type: "PRIX_GUESS", guess: "definitely wrong" });
  ok("the third does", A.spins === 1);
  // A new lap refills them.
  A.lap = 2;
  await say("a", { type: "PRIX_GUESS", guess: "definitely wrong" });
  ok("and the next lap brings them back", A.spins === 1);
}
{
  // What was not taken stays in the bag: the card must not claim it.
  const { room, seats } = await fitted({ gp_slip: 1, gp_nitro: 1, gp_tyres: 3 });
  await room.finish();
  const mine = seats.a.last("PRIX_OVER").results.find((r) => r.uid === "a");
  const total = Object.values(mine.spent || {}).reduce((n, v) => n + v, 0);
  ok(`the card charges for two of the five armed (${JSON.stringify(mine.spent)})`, total === 2);
}


console.log("\nthe magnet keeps what you carry, and a dead hand is not for ever");
{
  // Both hands full and a magnet: the box is saved, not swapped for what
  // is already in them.
  const { room, A } = await fitted({ gp_twin: 1, gp_magnet: 1 });
  A.holding = "deflector"; A.holding2 = "nitro"; A.owed = 0;
  const marks = room.g.marks || [];
  A.at = marks[0] - 1;
  room.advance(null, A, 2 / room.scaleOf(A));
  ok("nothing you are carrying is thrown away", A.holding === "deflector" && A.holding2 === "nitro");
  ok("a magnet charge saves the box instead", A.owed === 1 && A.magnet === 2);
  // Fire one, and the saved box arrives.
  A.holding = A.holding2; A.holding2 = null;
  room.advance(null, A, 0);
  ok("and it arrives as soon as there is a hand", !!A.holding2 && A.owed === 0);
}
{
  // Without a Twin Box a magnet is not a second hand.
  const { room, A } = await fitted({ gp_magnet: 1 });
  A.holding = "deflector"; A.holding2 = null; A.owed = 0;
  const marks = room.g.marks || [];
  A.at = marks[0] - 1;
  room.advance(null, A, 2 / room.scaleOf(A));
  ok("a magnet never invents a hand you did not buy", A.holding2 === null);
  ok("it saves the box for later instead", A.owed === 1 && A.holding === "deflector");
}
{
  // No magnet, hands full: the box goes by, exactly as before.
  const { room, A } = await fitted({});
  A.holding = "deflector"; A.holding2 = null; A.owed = 0; A.magnet = 0;
  const marks = room.g.marks || [];
  A.at = marks[0] - 1;
  room.advance(null, A, 2 / room.scaleOf(A));
  ok("without one, a box crossed with full hands is still gone", A.owed === 0 && A.holding === "deflector");
}
{
  // A charge is only spent when it saves something.
  const { room, A } = await fitted({ gp_magnet: 1 });
  A.holding = null; A.owed = 0;
  const marks = room.g.marks || [];
  A.at = marks[0] - 1;
  room.advance(null, A, 2 / room.scaleOf(A));
  ok("an empty hand takes the box without spending a charge", !!A.holding && A.magnet === 3);
}
{
  // The flare you climbed above.
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"], ["c", "Cy"], ["d", "Di"]);
  await say("a", { type: "PRIX_START" });
  const A = room.g.players.a;
  A.at = 900; room.g.players.b.at = 100; room.g.players.c.at = 50; room.g.players.d.at = 10;
  A.holding = "flare";
  await say("a", { type: "PRIX_USE" });
  ok("a flare will not fire from the front", /fourth or worse/.test(seats.a.last("PRIX_ERROR").message) && A.holding === "flare");
  ok("and the room says so in the state", room.publicState().players.find((x) => x.uid === "a").canFire === false);
  await say("a", { type: "PRIX_DROP" });
  ok("but it can be thrown away", A.holding === null);
  ok("and the racer is told what went", /thrown away/.test(seats.a.last("PRIX_USED").note));
  // With empty hands the next box is collected again, which is the whole
  // point: a dead item used to wave every box past for the rest of the race.
  A.owed = 0; A.at = (room.g.marks || [])[0] - 1;
  room.advance(null, A, 2 / room.scaleOf(A));
  ok("and boxes are collected once more", !!A.holding);
}
{
  // What you can fire, you keep: a discard is not a re-roll.
  const { room, seats, say } = await roomOf(["a", "Ana"], ["b", "Bo"]);
  await say("a", { type: "PRIX_START" });
  const A = room.g.players.a;
  A.holding = "slick";
  await say("a", { type: "PRIX_DROP" });
  ok("an item you could fire cannot be discarded", A.holding === "slick"
    && /you can fire/.test(seats.a.last("PRIX_ERROR").message));
  A.holding = null;
  await say("a", { type: "PRIX_DROP" });
  ok("and empty hands drop nothing", /Nothing in your hands/.test(seats.a.last("PRIX_ERROR").message));
}

console.log(bad ? `\n${bad} failing\n` : "\nall grand prix checks passed\n");
process.exit(bad ? 1 : 0);
