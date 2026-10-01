// node scripts/battle-stall-test.mjs
//
// Battleship against the computers, and the ways it used to stop.
//
// The other battle tests call runAi() by hand, which is the one thing the real
// game never does: after a person fires the room calls it once, and after that
// the only things that can wake a computer are the room's alarm and the next
// thing somebody sends. Every stall here came from a way out of that loop that
// left the battle waiting on a computer with nothing to bring it back.
//
//   - a person's clock ran out while a computer was next: the room passed the
//     turn on and never let the computer play, then did it again to the
//     computer half a minute later
//   - the last person was knocked out: the loop played twelve turns and stopped
//   - a computer's picks were all squares somebody else had already fired at:
//     it threw them away, had nothing left, and gave up holding the turn
//
// And the rule that put five shots on one captain: no more than two.
import { BattleRoyale } from "../src/battle-lobby.js";

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

async function solo({ ais = 2, map = "medium", level = "medium" } = {}) {
  const state = makeState();
  const game = new BattleRoyale(state, { FIREBASE_PROJECT_ID: "test" });
  await state._init;
  const ws = new FakeSocket("h", "Human");
  state.acceptWebSocket(ws);
  await game.onJoin("h", "Human", "SEA", ws);
  const say = (o) => game.webSocketMessage(ws, JSON.stringify(o));
  await say({ type: "BATTLE_MAP", mapId: map });
  await say({ type: "BATTLE_SOLO", on: true, level, count: ais });
  await say({ type: "BATTLE_RANDOM" });
  await say({ type: "BATTLE_START" });
  return { game, ws, say, state, g: game.g };
}

const ago = () => Date.now() - 1;
const free = (game, p, n, skip = new Set()) => {
  const out = [];
  for (let r = 0; r < game.map.size && out.length < n; r++) for (let c = 0; c < game.map.size && out.length < n; c++) {
    const cell = `${r},${c}`;
    if (!p.board.incoming.includes(cell) && !skip.has(cell)) out.push(cell);
  }
  return out;
};

/** Play the computers until it is the person's turn, as the room does after a shot. */
async function untilHuman(t) {
  let guard = 0;
  while (t.g.phase === "ACTIVE" && t.g.turnUid !== "h" && guard++ < 20) await t.game.runAi();
}

console.log("\nno clock on a computer");
{
  const t = await solo({ ais: 2 });
  await untilHuman(t);
  ok("on a person's turn there is a clock", t.g.turnUid === "h" && typeof t.g.turnEndsAt === "number" && t.g.turnEndsAt > Date.now());
  ok("and the screen is told it", typeof t.ws.last("BATTLE_STATE").game.turnEndsAt === "number");

  // Put the turn on a computer and look at what it carries.
  const ai = Object.values(t.g.players).find((p) => p.ai && p.alive);
  t.g.turnUid = ai.uid;
  t.g.turnEndsAt = t.game.clockFor(ai.uid);
  ok("a computer's turn carries no clock at all", t.g.turnEndsAt === null);
  ok("so there is nothing to run out", t.game.clockFor("ai") === null && t.game.clockFor("ai3") === null);
  ok("while a person still gets their thirty seconds", t.game.clockFor("h") > Date.now() + 25_000);
}

console.log("\na person's clock runs out and a computer is next");
{
  let stranded = 0, advanced = 0;
  const runs = 20;
  for (let i = 0; i < runs; i++) {
    const t = await solo({ ais: 2 });
    await untilHuman(t);
    if (t.g.phase !== "ACTIVE") continue;
    const turnNo = t.g.turnNo;
    t.g.turnEndsAt = ago();
    await t.game.alarm();
    if (t.g.phase === "ACTIVE" && t.g.turnUid !== "h") stranded++;
    if (t.g.turnNo > turnNo + 1) advanced++;
  }
  ok(`the computers play on after the clock expires, every time (${runs - stranded} of ${runs})`, stranded === 0);
  ok("and it is the person's turn again, not a computer's", stranded === 0);
  ok(`having played their turns on the way round (${advanced} of ${runs})`, advanced === runs);

  // Nobody is ever told a computer ran out of time.
  const t = await solo({ ais: 2 });
  await untilHuman(t);
  t.g.turnEndsAt = ago();
  await t.game.alarm();
  ok("the feed never says a computer ran out of time", !t.g.feed.some((e) => /Sensei.*ran out of time/.test(e.text)));
  ok("it says it of the person, who did", t.g.feed.some((e) => /Human ran out of time/.test(e.text)));
}

console.log("\na battle already left waiting on a computer comes back");
{
  const t = await solo({ ais: 2 });
  await untilHuman(t);
  // How a stuck battle looks in storage: a computer's turn, a stale clock.
  const ai = Object.values(t.g.players).find((p) => p.ai && p.alive);
  t.g.turnUid = ai.uid;
  t.g.turnEndsAt = ago();
  const before = t.g.turnNo;
  await t.game.alarm();
  ok("the next alarm plays the computer and hands the turn back", t.g.turnNo > before && t.g.turnUid === "h");
}

console.log("\nthe last person is knocked out");
{
  let finished = 0, strandedAfter = 0;
  const runs = 8;
  for (let i = 0; i < runs; i++) {
    const t = await solo({ ais: 3, map: "medium" });
    await untilHuman(t);
    if (t.g.phase !== "ACTIVE") { finished++; continue; }
    const h = t.g.players.h;
    for (const s of h.board.ships) { s.hits = [...s.cells]; s.sunk = true; }
    h.alive = false;
    t.g.turnUid = t.g.order.find((u) => t.g.players[u].alive);
    await t.game.runAi();

    // One call must not play the whole thing at once — nobody is waiting on
    // it — and must leave the alarm set so the rest will happen.
    if (t.g.phase === "ACTIVE" && t.state.alarmAt() == null) strandedAfter++;
    let ticks = 0;
    while (t.g.phase === "ACTIVE" && ticks++ < 3000) {
      if (t.state.alarmAt() == null) break;
      if (t.g.aiDueAt) t.g.aiDueAt = ago();
      await t.game.alarm();
    }
    if (t.g.phase !== "ACTIVE") finished++;
  }
  ok(`the computers fight the battle through to a winner (${finished} of ${runs})`, finished === runs);
  ok("and an alarm is always left set while they do", strandedAfter === 0);

  const t = await solo({ ais: 3 });
  await untilHuman(t);
  const h = t.g.players.h;
  for (const s of h.board.ships) { s.hits = [...s.cells]; s.sunk = true; }
  h.alive = false;
  t.g.turnUid = t.g.order.find((u) => t.g.players[u].alive);
  t.g.aiDueAt = null;
  const before = t.g.turnNo;
  await t.game.runAi();
  ok("with nobody waiting they take it one turn at a time, not all at once", t.g.turnNo - before <= 1);
  ok("on a pace the watcher can follow", t.g.aiDueAt > Date.now());
  ok("and still with no clock on any of them", t.g.turnEndsAt === null);
  ok("the pace is on the room's alarm", t.state.alarmAt() >= t.g.aiDueAt - 5);
}

console.log("\na computer that has nothing new to shoot at");
{
  let stuck = 0, played = 0;
  const runs = 20;
  for (let i = 0; i < runs; i++) {
    const t = await solo({ ais: 1, map: "easy", level: "easy" });
    const h = t.g.players.h;
    // The person has already shot most of the computer's target's water, and the
    // computer has never fired there, so its own memory says it is all open.
    const keep = new Set(h.board.ships.flatMap((s) => s.cells).slice(0, 3));
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      const cell = `${r},${c}`;
      if (!keep.has(cell) && !h.board.incoming.includes(cell)) h.board.incoming.push(cell);
    }
    t.g.turnUid = "ai";
    const before = t.g.turnNo;
    const shotsBefore = t.g.players.ai.shots;
    await t.game.runAi();
    if (t.g.phase === "ACTIVE" && t.g.turnUid === "ai" && t.g.turnNo === before) stuck++;
    if (t.g.players.ai.shots > shotsBefore) played++;
  }
  ok(`the turn always moves on (${runs - stuck} of ${runs})`, stuck === 0);
  ok(`and it fires on the squares that are left (${played} of ${runs})`, played === runs);

  // It does not waste shots on squares anybody has already fired at.
  const t = await solo({ ais: 1, map: "easy", level: "easy" });
  const h = t.g.players.h;
  const before = new Set(h.board.incoming);
  for (let r = 0; r < 10; r++) for (let c = 0; c < 6; c++) {
    const cell = `${r},${c}`;
    if (!h.board.incoming.includes(cell)) h.board.incoming.push(cell);
  }
  const taken = new Set(h.board.incoming);
  t.g.turnUid = "ai";
  await t.game.runAi();
  const fresh = h.board.incoming.filter((c) => !taken.has(c));
  ok(`it fires its full shots, none of them on a square already shot (${fresh.length} new)`,
    fresh.length === t.game.map.shots && new Set(fresh).size === fresh.length);
}

console.log("\nthe computers do shoot each other");
{
  let onEachOther = 0, onHuman = 0;
  for (let i = 0; i < 12; i++) {
    const t = await solo({ ais: 2, map: "medium" });
    for (let turn = 0; turn < 10 && t.g.phase === "ACTIVE"; turn++) {
      if (t.g.turnUid === "h") {
        const foes = Object.values(t.g.players).filter((p) => p.uid !== "h" && p.alive);
        const volley = [];
        let need = t.game.shotsFor(t.g.players.h);
        for (const f of foes) {
          const take = Math.min(2, need);
          if (take > 0) { volley.push({ target: f.uid, cells: free(t.game, f, take) }); need -= take; }
        }
        await t.say({ type: "BATTLE_FIRE", volley });
      } else await t.game.runAi();
    }
    for (const e of t.g.feed) {
      const m = /^Sensei[^:]*? fired \d+ shots? at (.+?):/.exec(e.text);
      if (!m) continue;
      if (m[1].startsWith("Sensei")) onEachOther++; else onHuman++;
    }
  }
  ok(`a computer fires at the other computer (${onEachOther} salvos)`, onEachOther > 0);
  ok(`as well as at the person (${onHuman} salvos)`, onHuman > 0);
}

console.log("\nno more than two on one captain");
{
  const t = await solo({ ais: 4, map: "hard" });
  await untilHuman(t);
  const me = t.g.players.h;
  const shots = t.game.shotsFor(me);
  const cap = t.game.volleyCap(me);
  ok(`five shots across four rivals leaves a cap of ${cap}`, shots === 5 && cap >= 2 && cap * 4 >= 5);
  ok("and the room tells the board what it is", t.ws.last("BATTLE_STATE").yourCap === cap);

  const foes = Object.values(t.g.players).filter((p) => p.uid !== "h" && p.alive);
  const before = me.shots;
  await t.say({ type: "BATTLE_FIRE", volley: [{ target: foes[0].uid, cells: free(t.game, foes[0], shots) }] });
  ok("every shot on one captain is refused", me.shots === before);
  ok("with the reason", /No more than \d+ shots on one captain/.test(t.ws.last("BATTLE_ERROR").message));
  ok("and the turn is still theirs to take", t.g.turnUid === "h");

  const over = [
    { target: foes[0].uid, cells: free(t.game, foes[0], cap + 1) },
    { target: foes[1].uid, cells: free(t.game, foes[1], shots - cap - 1) },
  ];
  await t.say({ type: "BATTLE_FIRE", volley: over });
  ok("one more than the cap is refused too", me.shots === before);

  const fair = [];
  let need = shots;
  for (const f of foes) {
    const take = Math.min(cap, need);
    if (take > 0) { fair.push({ target: f.uid, cells: free(t.game, f, take) }); need -= take; }
  }
  await t.say({ type: "BATTLE_FIRE", volley: fair });
  ok(`spread within the cap it goes through (${fair.map((v) => v.cells.length).join("+")})`, me.shots === before + shots);
}

console.log("\nthe rotation always holds");
{
  // Five rivals, five shots, three closed off by the rotation. The two left
  // open take three and two between them; nobody is allowed back early.
  const t = await solo({ ais: 5, map: "hard" });
  await untilHuman(t);
  const me = t.g.players.h;
  const foes = Object.values(t.g.players).filter((p) => p.uid !== "h" && p.alive);
  me.history = foes.slice(0, 3).map((p) => p.uid);
  ok("the limit rises to three, because two rivals must take five", t.game.volleyCap(me) === 3);

  const before = me.shots;
  await t.say({ type: "BATTLE_FIRE", volley: [
    { target: foes[0].uid, cells: free(t.game, foes[0], 2) },
    { target: foes[3].uid, cells: free(t.game, foes[3], 2) },
    { target: foes[4].uid, cells: free(t.game, foes[4], 1) },
  ] });
  ok("firing on a captain the rotation has closed is refused", me.shots === before && /more before returning/.test(t.ws.last("BATTLE_ERROR").message));

  await t.say({ type: "BATTLE_FIRE", volley: [
    { target: foes[3].uid, cells: free(t.game, foes[3], 3) },
    { target: foes[4].uid, cells: free(t.game, foes[4], 2) },
  ] });
  ok("three and two on the two that are open goes through", me.shots === before + 5);
}

console.log("\nthe same captain every turn");
{
  const t = await solo({ ais: 2, map: "medium" });
  await untilHuman(t);
  const me = t.g.players.h;
  const [a, b] = Object.values(t.g.players).filter((p) => p.uid !== "h" && p.alive);
  me.history = [b.uid, a.uid];
  const before = me.shots;
  await t.say({ type: "BATTLE_FIRE", volley: [{ target: a.uid, cells: free(t.game, a, 2) }, { target: b.uid, cells: free(t.game, b, 2) }] });
  ok("with two rivals, going straight back to the one just fired on is refused", me.shots === before);
  await t.say({ type: "BATTLE_FIRE", volley: [{ target: b.uid, cells: free(t.game, b, 4) }] });
  ok("the other takes the lot, since nothing else is open", me.shots === before + 4);
}

console.log("\none rival left");
{
  const t = await solo({ ais: 1, map: "hard" });
  await untilHuman(t);
  const me = t.g.players.h;
  const foe = t.g.players.ai;
  ok("takes everything the chart gives", t.game.volleyCap(me) === t.game.shotsFor(me));
  const before = me.shots;
  await t.say({ type: "BATTLE_FIRE", volley: [{ target: foe.uid, cells: free(t.game, foe, t.game.shotsFor(me)) }] });
  ok("so all five on the one captain they have left is fine", me.shots === before + 5);
}

console.log("\nthe computers keep to the same ceiling");
{
  const t = await solo({ ais: 3, map: "hard", level: "hard" });
  for (let turn = 0; turn < 25 && t.g.phase === "ACTIVE"; turn++) {
    if (t.g.turnUid === "h") {
      const foes = Object.values(t.g.players).filter((p) => p.uid !== "h" && p.alive);
      const cap = t.game.volleyCap(t.g.players.h);
      const volley = [];
      let need = t.game.shotsFor(t.g.players.h);
      for (const f of foes) {
        const take = Math.min(cap, need);
        if (take > 0) { volley.push({ target: f.uid, cells: free(t.game, f, take) }); need -= take; }
      }
      await t.say({ type: "BATTLE_FIRE", volley });
    } else await t.game.runAi();
  }
  const salvos = t.g.feed.map((e) => /^Sensei[^:]*? fired (\d+) shots? at/.exec(e.text)).filter(Boolean).map((m) => Number(m[1]));
  ok(`across ${salvos.length} computer salvos none is more than the chart's five`, salvos.length > 0 && salvos.every((n) => n <= 5));
}

console.log(bad ? `\n${bad} failing\n` : "\nall battleship stall checks passed\n");
process.exit(bad ? 1 : 0);
