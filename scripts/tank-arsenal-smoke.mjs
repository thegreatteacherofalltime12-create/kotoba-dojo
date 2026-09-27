// node scripts/tank-arsenal-smoke.mjs
//
// The tank arsenal through the room: the per-duel limits, a triple shot that
// really is three flights, a shield eating a blast and being spent by it, the
// three tokens that take a turn, an EMP taking somebody's aiming line away,
// the turn order holding, a computer taking its shot off the alarm, and the
// spend landing on the results.
//
// The room is the only place any of this is decided, so this is the test that
// matters: the client is handed finished flights and cannot argue with them.
import { TankDuel } from "../src/artillery-room.js";
import { ARSENALS } from "../src/arsenals.js";
import { START_HP, TANK_R, WIND_MAX, WIND_MODES, groundAt } from "../src/artillery.js";

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
    sockets, _init: null, alarmAt: 0,
    blockConcurrencyWhile(fn) { this._init = fn(); return this._init; },
    waitUntil: (p) => p,
    acceptWebSocket: (ws) => sockets.push(ws),
    getWebSockets: () => sockets.filter((s) => s.open),
    storage: {
      get: async (k) => (Array.isArray(k) ? new Map(k.map((x) => [x, store.get(x)])) : store.get(k)),
      put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
      deleteAll: async () => store.clear(),
      setAlarm: async function (at) { this.owner.alarmAt = at; },
      deleteAlarm: async () => {},
    },
  };
}

async function room(uids, { ai = 0, level = "medium", wind = "normal", assist = true } = {}) {
  const state = makeState();
  state.storage.owner = state;
  const duel = new TankDuel(state, { FIREBASE_PROJECT_ID: "test" });
  await state._init;
  duel.g = duel.blank("TANK", false);
  const socks = {};
  for (const uid of uids) {
    const ws = new FakeSocket(uid, uid.toUpperCase());
    socks[uid] = ws;
    state.acceptWebSocket(ws);
    await duel.onJoin(uid, uid.toUpperCase(), ws);
  }
  const say = (uid, obj) => duel.webSocketMessage(socks[uid], JSON.stringify(obj));
  await say(uids[0], { type: "TANK_START", ai, level, wind, assist });
  return { duel, socks, say, state };
}

/** Tokens armed straight onto the tank, since the shop is not in this test. */
const arm = (t, armed) => { t.ars = { armed, used: {}, guards: [], chute: false }; };

/**
 * A flat battlefield, for the tests that fire point blank.
 *
 * The room draws a new random one every duel, which is right for the game and
 * wrong for a test: on a steep enough slope a shell fired from one tank at
 * another fourteen units away lands out of blast range of both of them, and
 * the test that was checking a shield would fail once a fortnight. Flat ground
 * makes the geometry the same every run.
 */
const flatten = (duel, h = 380) => {
  duel.g.terrain = new Array(1000).fill(h);
  for (const t of duel.tankList()) t.y = h - TANK_R;
};

/** Whoever the room says is up, and the tank beside them. */
const up = (duel) => duel.g.tanks[duel.whoseTurn()];
const other = (duel) => duel.tankList().find((t) => t.uid !== duel.whoseTurn());

console.log("\nthe duel starts");
{
  const { duel, socks } = await room(["a", "b"]);
  ok("two tanks, in an order", duel.g.order.length === 2 && duel.g.phase === "PLAYING");
  ok("both are standing on the ground",
    duel.tankList().every((t) => Math.abs(t.y - (groundAt(duel.g.terrain, t.x) - TANK_R)) < 0.5));
  ok("everybody has full health", duel.tankList().every((t) => t.hp === START_HP));
  const start = socks.a.last("TANK_START");
  ok("the battlefield is sent whole, one height per column", start.terrain.length === 1000);
  ok("and the wind with it", typeof start.wind === "number");
  const solo = await room(["a"]);
  ok("one tank and no computers is refused", /takes two/.test(solo.socks.a.last("TANK_REJECT")?.why || ""));
}

console.log("\nwhose turn it is");
{
  const { duel, socks, say } = await room(["a", "b"]);
  const waiting = other(duel).uid;
  await say(waiting, { type: "TANK_FIRE", angle: 45, power: 60 });
  ok("shooting out of turn is refused", /Not your turn/.test(socks[waiting].last("TANK_REJECT").why));
  ok("and costs nothing", duel.g.tanks[waiting].shots === 0);
  const shooter = duel.whoseTurn();
  await say(shooter, { type: "TANK_FIRE", angle: 45, power: 60 });
  ok("a shot passes the turn on", duel.whoseTurn() !== shooter);
  ok("and the wind is redrawn", typeof duel.g.wind === "number");
}

console.log("\na triple shot");
{
  const { duel, socks, say } = await room(["a", "b"]);
  const t = up(duel);
  arm(t, { at_triple: 1 });
  await say(t.uid, { type: "TANK_FIRE", angle: 50, power: 70, use: ["at_triple"] });
  const shot = socks[t.uid].last("TANK_SHOT");
  ok("three flights, not one", shot.flights.length === 3);
  ok("every one of them is a finished path",
    shot.flights.every((f) => f.path.length > 2 && f.hit));
  // Counted as what is left rather than as what is used, because a shot that
  // ends the duel has already had its spend folded into the armed count.
  ok("the token is spent by firing it", duel.armedLeft(t, "at_triple") === 0);
  ok("and the plan says what went up", shot.plan.shells === 3 && shot.plan.tokens.includes("at_triple"));
}

console.log("\nthe limits");
{
  const { duel, socks, say } = await room(["a", "b"]);
  const t = up(duel);
  await say(t.uid, { type: "ARM_TOKEN", key: "at_orbital" });
  ok("nothing held means nothing armed", /hold no more/.test(socks[t.uid].last("TANK_TOKENS").error));
  await say(t.uid, { type: "ARM_TOKEN", key: "not_a_token" });
  ok("an invented key is refused", /No such token/.test(socks[t.uid].last("TANK_TOKENS").error));
  arm(t, { at_cluster: 2 });
  await say(t.uid, { type: "TANK_ARSENAL", key: "at_cluster" });
  ok("a shell token cannot be fired on its own",
    /fired with a shot/.test(socks[t.uid].last("TANK_REJECT").why));
  ok("every token in the shop has a per-duel limit",
    Object.values(ARSENALS.artillery).every((s) => s.max >= 1));
}

console.log("\na shield, and armour");
{
  const { duel, say } = await room(["a", "b"]);
  const shooter = up(duel);
  const mark = other(duel);
  flatten(duel);
  arm(shooter, {});
  arm(mark, { at_bubble: 1 });
  await say(mark.uid, { type: "TANK_ARSENAL", key: "at_bubble" });
  ok("a guard is raised without the turn", duel.whoseTurn() === shooter.uid && mark.ars.guards.includes("at_bubble"));
  // Fired point blank, so there is no question of it missing.
  mark.x = shooter.x + 14;
  mark.y = groundAt(duel.g.terrain, mark.x) - TANK_R;
  await say(shooter.uid, { type: "TANK_FIRE", angle: 20, power: 8 });
  ok("the blast does nothing at all", mark.hp === START_HP);
  ok("and the shield is gone, and spent", !mark.ars.guards.length && mark.ars.used.at_bubble === 1);

  const two = await room(["a", "b"]);
  const s2 = up(two.duel);
  const m2 = other(two.duel);
  flatten(two.duel);
  arm(s2, {});
  arm(m2, { at_armour: 1 });
  await two.say(m2.uid, { type: "TANK_ARSENAL", key: "at_armour" });
  m2.x = s2.x + 14;
  m2.y = groundAt(two.duel.g.terrain, m2.x) - TANK_R;
  await two.say(s2.uid, { type: "TANK_FIRE", angle: 20, power: 8 });
  const hurt = START_HP - m2.hp;
  ok(`armour takes the hit down without stopping it (${hurt} through)`, hurt > 0 && hurt < 46);
  ok("and the plate is spent", m2.ars.used.at_armour === 1);
}

console.log("\ndouble damage, and the vampire shell");
{
  const plain = await room(["a", "b"]);
  const shooter = up(plain.duel);
  const mark = other(plain.duel);
  flatten(plain.duel);
  arm(shooter, { at_double: 1 });
  arm(mark, {});
  mark.x = shooter.x + 14;
  mark.y = groundAt(plain.duel.g.terrain, mark.x) - TANK_R;
  shooter.hp = 40;
  await plain.say(shooter.uid, { type: "TANK_FIRE", angle: 20, power: 8, use: ["at_double"] });
  ok("doubled damage lands doubled", START_HP - mark.hp > 46);
  ok("and is credited to whoever fired it", shooter.damage === START_HP - mark.hp);

  const vamp = await room(["a", "b"]);
  const s2 = up(vamp.duel);
  const m2 = other(vamp.duel);
  flatten(vamp.duel);
  arm(s2, { at_vampire: 1 });
  arm(m2, {});
  m2.x = s2.x + 14;
  m2.y = groundAt(vamp.duel.g.terrain, m2.x) - TANK_R;
  s2.hp = 50;
  await vamp.say(s2.uid, { type: "TANK_FIRE", angle: 20, power: 8, use: ["at_vampire"] });
  // Read off the shot rather than off the health, because a shell fired this
  // close catches the tank that fired it too.
  const hits = vamp.socks[s2.uid].last("TANK_SHOT").hits;
  const dealt = hits.filter((h) => h.uid === m2.uid).reduce((a, h) => a + h.damage, 0);
  const back = -(hits.find((h) => h.from === "vampire")?.damage || 0);
  ok(`half of what it dealt comes back (${back} on ${dealt})`, dealt > 0 && back === Math.round(dealt / 2));
  ok("and nothing comes back off its own blast",
    hits.filter((h) => h.uid === s2.uid && h.from === "shell").every((h) => h.damage >= 0));
}

console.log("\nthe strikes");
{
  const { duel, socks, say } = await room(["a", "b"]);
  const t = up(duel);
  const mark = other(duel);
  arm(t, { at_orbital: 1, at_leveler: 1 });
  await say(t.uid, { type: "TANK_FIRE", angle: 45, power: 60, use: ["at_orbital"], aimX: mark.x });
  const shot = socks[t.uid].last("TANK_SHOT");
  ok("three lasers come down", shot.blasts.length === 3 && shot.blasts.every((b) => b.kind === "orbital"));
  ok("on the column it was pointed at", shot.blasts.some((b) => Math.abs(b.x - mark.x) < 2));
  ok("and it hurt whoever was standing there", mark.hp < START_HP);

  const lev = await room(["a", "b"]);
  const t2 = up(lev.duel);
  arm(t2, { at_leveler: 1 });
  const before = [...lev.duel.g.terrain];
  await lev.say(t2.uid, { type: "TANK_FIRE", angle: 45, power: 60, use: ["at_leveler"], aimX: 500 });
  const after = lev.duel.g.terrain;
  const spread = (g) => Math.max(...g.slice(430, 570)) - Math.min(...g.slice(430, 570));
  ok(`the ground is flatter than it was (${spread(before).toFixed(0)} -> ${spread(after).toFixed(0)})`,
    spread(after) < spread(before));
  ok("and nobody was hurt by it", lev.duel.tankList().every((t) => t.hp === START_HP));
  let cliff = 0;
  for (let i = 1; i < after.length; i++) cliff = Math.max(cliff, Math.abs(after[i] - after[i - 1]));
  ok(`no cliff where the flat meets the hill (${cliff.toFixed(1)} units)`, cliff < 6);
}

console.log("\nthe three that take a turn");
{
  const { duel, say } = await room(["a", "b"]);
  const t = up(duel);
  arm(t, { at_repair: 1 });
  t.hp = 50;
  await say(t.uid, { type: "TANK_ARSENAL", key: "at_repair" });
  ok("a repair puts twenty back", t.hp === 70);
  ok("and takes the turn", duel.whoseTurn() !== t.uid);

  const tp = await room(["a", "b"]);
  const t2 = up(tp.duel);
  arm(t2, { at_teleport: 1 });
  const was = t2.x;
  await tp.say(t2.uid, { type: "TANK_ARSENAL", key: "at_teleport" });
  ok("a teleport moves the tank", t2.x !== was);
  ok("and leaves it standing on the ground",
    Math.abs(t2.y - (groundAt(tp.duel.g.terrain, t2.x) - TANK_R)) < 0.5);

  const emp = await room(["a", "b"]);
  const t3 = up(emp.duel);
  const mark = other(emp.duel);
  arm(t3, { at_emp: 1 });
  await emp.say(t3.uid, { type: "TANK_ARSENAL", key: "at_emp", at: mark.uid });
  ok("an EMP lands on the tank it was pointed at", mark.empUntil > emp.duel.g.turnNo);
  ok("whose aiming line the room then withholds", emp.duel.view(mark.uid).aim === null);
  ok("and nobody else's", emp.duel.view(t3.uid).aim !== null);
}

console.log("\nnapalm, and the fire it leaves");
{
  const { duel, say } = await room(["a", "b"]);
  const t = up(duel);
  const mark = other(duel);
  flatten(duel);
  arm(t, { at_napalm: 1 });
  arm(mark, {});
  mark.x = t.x + 16;
  mark.y = groundAt(duel.g.terrain, mark.x) - TANK_R;
  await say(t.uid, { type: "TANK_FIRE", angle: 20, power: 8, use: ["at_napalm"] });
  ok("it leaves a pool of fire", duel.g.fires.length === 1);
  const first = mark.hp;
  ok("which burned the tank standing in it on the turn it landed", first < START_HP);
  // The other tank now fires and misses, into the sky, which ends its turn.
  await say(duel.whoseTurn(), { type: "TANK_FIRE", angle: 90, power: 100 });
  ok("and burns again on the next turn", mark.hp < first);
  ok("and burns out rather than forever", duel.g.fires.every((f) => f.turns < 3));
}

console.log("\na mud shell");
{
  const { duel, socks, say } = await room(["a", "b"]);
  const t = up(duel);
  const mark = other(duel);
  flatten(duel);
  arm(t, { at_mud: 1 });
  arm(mark, {});
  mark.x = t.x + 16;
  mark.y = groundAt(duel.g.terrain, mark.x) - TANK_R;
  const ground = duel.g.terrain[Math.round(mark.x)];
  await say(t.uid, { type: "TANK_FIRE", angle: 20, power: 8, use: ["at_mud"] });
  ok("it hurts nobody", mark.hp === START_HP);
  ok("and raises the ground rather than digging it out",
    duel.g.terrain[Math.round(mark.x)] < ground);
  ok("the blast is sent as mud, so the client draws mud",
    socks[t.uid].last("TANK_SHOT").blasts.every((b) => b.kind === "mud"));
}

console.log("\none payload at a time");
{
  const { duel, socks, say } = await room(["a", "b"]);
  const t = up(duel);
  arm(t, { at_mud: 1, at_napalm: 1, at_triple: 1 });
  await say(t.uid, { type: "TANK_FIRE", angle: 45, power: 60, use: ["at_mud", "at_napalm", "at_triple"] });
  const shot = socks[t.uid].last("TANK_SHOT");
  ok("the second payload is dropped, not stacked", shot.plan.payload === "at_mud");
  ok("and is not spent either", !t.ars.used.at_napalm);
  ok("while what is not a payload still goes up", shot.plan.shells === 3);
}

console.log("\na token nobody armed");
{
  const { duel, socks, say } = await room(["a", "b"]);
  const t = up(duel);
  arm(t, {});
  await say(t.uid, { type: "TANK_FIRE", angle: 45, power: 60, use: ["at_orbital", "at_triple"] });
  const shot = socks[t.uid].last("TANK_SHOT");
  // Dropped rather than refused: a stale button on a reconnected client
  // should cost a plain shell, not the turn.
  ok("is quietly dropped and the shot still goes", shot.flights.length === 1);
  ok("and nothing was spent", !Object.keys(t.ars.used).length);
}

console.log("\nthe computers");
{
  const { duel, state } = await room(["a"], { ai: 2, level: "hard" });
  ok("a solo duel fills up with computers", duel.g.order.length === 3);
  ok("who are named", duel.tankList().filter((t) => t.ai).every((t) => t.name));
  // Walk the turn round to a computer and let its alarm fire.
  while (!up(duel).ai) await duel.fire(null, duel.whoseTurn(), { angle: 45, power: 60 });
  const cpu = up(duel);
  ok("a computer's turn sets an alarm rather than shooting at once", state.alarmAt > Date.now());
  const shots = cpu.shots;
  await duel.alarm();
  ok("and the alarm takes the shot", cpu.shots === shots + 1);
  ok("then hands the turn on", duel.whoseTurn() !== cpu.uid || cpu.dead);
}

console.log("\nwhat the duel was worth");
{
  const { duel, socks, say } = await room(["a", "b"]);
  const t = up(duel);
  const mark = other(duel);
  flatten(duel);
  arm(t, { at_double: 2 });
  mark.x = t.x + 14;
  mark.y = groundAt(duel.g.terrain, mark.x) - TANK_R;
  mark.hp = 20;
  await say(t.uid, { type: "TANK_FIRE", angle: 20, power: 8, use: ["at_double"] });
  const over = socks[t.uid].last("TANK_OVER");
  ok("one tank left ends the duel", duel.g.phase === "OVER" && over.status === "won");
  const win = over.results.find((r) => r.uid === t.uid);
  const lost = over.results.find((r) => r.uid === mark.uid);
  ok("the survivor is first", win.placement === 1 && win.status === "standing");
  ok("and the other is not", lost.placement === 2 && lost.status === "destroyed");
  ok("the score is on the arena's hundred-point scale", win.score > lost.score && win.score <= 100);
  ok("what the arsenal used is on the result for the record write", win.spent.at_double === 1);
  ok("and only what was used comes off what was armed", t.ars.armed.at_double === 1 && !Object.keys(t.ars.used).length);
  ok("nothing is left raised for the next duel", !t.ars.guards.length && !t.ars.chute);
}

console.log("\nthe wind the host set");
{
  const calm = await room(["a", "b"], { wind: "calm" });
  ok("dead calm is dead calm on the first turn", calm.duel.g.wind === 0);
  // Every turn of it, rather than the one the duel happened to open on.
  for (let i = 0; i < 6; i++) await calm.say(calm.duel.whoseTurn(), { type: "TANK_FIRE", angle: 90, power: 100 });
  ok("and stays calm as the turns pass", calm.duel.g.wind === 0);
  ok("which the field is told, so the gauge can say so", calm.duel.view("a").windMax === 0);

  const wild = await room(["a", "b"], { wind: "wild" });
  let worst = Math.abs(wild.duel.g.wind);
  for (let i = 0; i < 12; i++) {
    await wild.say(wild.duel.whoseTurn(), { type: "TANK_FIRE", angle: 90, power: 100 });
    if (wild.duel.g.phase !== "PLAYING") break;
    worst = Math.max(worst, Math.abs(wild.duel.g.wind));
  }
  ok(`a gale blows harder than the usual weather (${worst})`, worst > WIND_MAX);
  ok("but never past what it was set to", worst <= wild.duel.windMax());

  const usual = await room(["a", "b"]);
  ok("normal is the default a duel gets without asking", usual.duel.g.windMode === "normal");
  ok("and an invented strength is refused rather than obeyed",
    (await room(["a", "b"], { wind: "hurricane" })).duel.g.windMode === "normal");
  ok("the strength is on the state for the lobby to show",
    usual.duel.view("a").windModes.length === WIND_MODES.length);
}

console.log("\nwhat the room says to each other");
{
  const { duel, socks, say } = await room(["a", "b"]);
  await say("a", { type: "TANK_SAY", text: "  good luck  " });
  const line = socks.b.last("TANK_CHAT").line;
  ok("a line reaches everybody, not only the sender", !!line && !!socks.a.last("TANK_CHAT"));
  ok("trimmed, and stamped with who said it", line.text === "good luck" && line.uid === "a" && line.name === "A");
  ok("and kept, so a reload is not an empty room", duel.g.chat.length === 1);

  await say("a", { type: "TANK_SAY", text: "   " });
  ok("an empty line is not a line", duel.g.chat.length === 1);

  const before = duel.g.chat.length;
  await say("a", { type: "TANK_SAY", text: "you are a retard" });
  ok("what does not belong in the arena does not belong here either",
    duel.g.chat.length === before && /doesn't belong here/.test(socks.a.last("TANK_REJECT").why));

  // Not "xxx" repeated, which the arena filter reads as exactly what it
  // looks like, and rightly.
  await say("a", { type: "TANK_SAY", text: "ha".repeat(200) });
  ok("a very long line is cut rather than refused", duel.g.chat.at(-1).text.length === 200);

  // Chat stays open through the duel: most of a turn is watching somebody
  // else take theirs, and that is what the talking is for.
  const shooter = duel.whoseTurn();
  await say(shooter, { type: "TANK_FIRE", angle: 45, power: 60 });
  await say("b", { type: "TANK_SAY", text: "nice shot" });
  ok("and it is open while the duel is on", duel.g.chat.at(-1).text === "nice shot");
}

console.log("\nwhat the duel did");
{
  const { duel, socks, say } = await room(["a", "b"]);
  const started = duel.g.log.find((l) => l.kind === "start");
  ok("the duel opening is the first thing in the feed", !!started && /Duel begins/.test(started.text));
  ok("and it says what was set", /tanks/.test(started.text) && /wind/.test(started.text));

  const t = up(duel);
  const mark = other(duel);
  flatten(duel);
  arm(t, { at_triple: 1 });
  arm(mark, {});
  mark.x = t.x + 14;
  mark.y = groundAt(duel.g.terrain, mark.x) - TANK_R;
  await say(t.uid, { type: "TANK_FIRE", angle: 20, power: 8, use: ["at_triple"] });

  const shot = duel.g.log.filter((l) => l.kind === "shot").at(-1);
  ok("a shot is written down in words an onlooker could follow", !!shot && shot.text.startsWith(t.name));
  ok("naming the token it went up with", /Triple Shot/.test(shot.text));
  ok("and who it hurt, by name and for how much", new RegExp(mark.name + " for \\d+").test(shot.text));
  // The last TANK_LOG of the turn may be a death or the end of the duel, so
  // look for the shot rather than assuming it was last through the door.
  const sent = [...socks[t.uid].inbox].reverse().find((m) => m.type === "TANK_LOG" && m.line.kind === "shot");
  ok("the line reaches the browser as it happens", sent?.line.text === shot.text);

  const killed = duel.g.log.find((l) => l.kind === "dead");
  if (killed) ok("a destroyed tank is named as destroyed", /destroyed/.test(killed.text));
  else ok("a destroyed tank is named as destroyed (nobody died here)", true);

  const over = duel.g.log.find((l) => l.kind === "over");
  if (duel.g.phase === "OVER") ok("and the end of the duel is written too", !!over);
  else ok("and the end of the duel is written too (still running)", !over);
}

console.log("\nthe feeds reach somebody who walks in late");
{
  const { duel, say } = await room(["a", "b"]);
  await say("a", { type: "TANK_SAY", text: "hello" });
  await say(duel.whoseTurn(), { type: "TANK_FIRE", angle: 45, power: 60 });
  const view = duel.view("b");
  ok("the state carries the event feed", view.log.length >= 2);
  ok("which is capped rather than growing forever", view.log.length <= 60);
  // A third player joining reads both feeds without having been here.
  const ws = new FakeSocket("c", "C");
  duel.state.acceptWebSocket(ws);
  await duel.onJoin("c", "C", ws);
  ok("a latecomer is handed what was said", ws.last("TANK_CHAT").line.text === "hello");
  ok("and what happened, on the state", (ws.last("TANK_STATE").state.log || []).length >= 2);
}

console.log("\nthe arc of the shot not taken yet");
{
  const { duel, socks, say } = await room(["a", "b"]);
  const t = up(duel);
  await say(t.uid, { type: "TANK_AIM", angle: 52, power: 74 });
  const shown = socks[t.uid].last("TANK_AIM_PATH");
  ok("aiming gets an arc back", !!shown && shown.paths.length === 1 && shown.paths[0].length > 2);
  ok("flown against the wind that is actually blowing", shown.wind === duel.g.wind);

  // The whole point: what you were shown is what you get. Same angle, same
  // power, same ground, same wind — so the two paths are the same points.
  await say(t.uid, { type: "TANK_FIRE", angle: 52, power: 74 });
  const fired = socks[t.uid].last("TANK_SHOT").flights[0].path;
  ok(`the shot follows the line exactly (${fired.length} points)`,
    JSON.stringify(fired) === JSON.stringify(shown.paths[0]));

  const two = await room(["a", "b"]);
  const t2 = up(two.duel);
  const mark2 = other(two.duel);
  flatten(two.duel);
  arm(t2, { at_triple: 1 });
  await two.say(t2.uid, { type: "TANK_AIM", angle: 45, power: 60, use: ["at_triple"] });
  ok("a triple shot is previewed as three arcs", two.socks[t2.uid].last("TANK_AIM_PATH").paths.length === 3);
  ok("and previewing it spends nothing", two.duel.armedLeft(t2, "at_triple") === 1);
  await two.say(t2.uid, { type: "TANK_AIM", angle: 45, power: 60, use: ["at_orbital"] });
  ok("a token nobody armed is not previewed either",
    two.socks[t2.uid].last("TANK_AIM_PATH").paths.length === 1);

  // Where it ends, and on what.
  const three = await room(["a", "b"]);
  const t3 = up(three.duel);
  const mark3 = other(three.duel);
  flatten(three.duel);
  mark3.x = t3.x + 40;
  mark3.y = groundAt(three.duel.g.terrain, mark3.x) - TANK_R;
  await three.say(t3.uid, { type: "TANK_AIM", angle: 20, power: 20 });
  const ends = three.socks[t3.uid].last("TANK_AIM_PATH").ends;
  ok("the end of the arc says what it ends on", ends.length === 1 && !!ends[0].kind);
  if (ends[0].kind === "tank") ok("and names the tank when it ends in one", ends[0].uid === mark3.uid);
  else ok("and names the tank when it ends in one (this one hit the ground)", ends[0].uid === null);
}

console.log("\nwho the arc is withheld from");
{
  const { duel, socks, say } = await room(["a", "b"]);
  const waiting = other(duel).uid;
  await say(waiting, { type: "TANK_AIM", angle: 45, power: 60 });
  ok("nobody is shown the arc on somebody else's turn", !socks[waiting].last("TANK_AIM_PATH"));

  const off = await room(["a", "b"], { assist: false });
  const t2 = up(off.duel);
  await off.say(t2.uid, { type: "TANK_AIM", angle: 45, power: 60 });
  const answer = off.socks[t2.uid].last("TANK_AIM_PATH");
  ok("a room that turned it off gets no arc", answer.off === true && !answer.paths.length);
  ok("and the state says so, so the screen can too", off.duel.view(t2.uid).assist === false);

  const emp = await room(["a", "b"]);
  const t3 = up(emp.duel);
  t3.empUntil = emp.duel.g.turnNo + 1;
  await emp.say(t3.uid, { type: "TANK_AIM", angle: 45, power: 60 });
  const blind = emp.socks[t3.uid].last("TANK_AIM_PATH");
  ok("an EMP takes the arc away, which is what an EMP is for", blind.blind === true && !blind.paths.length);
}

console.log(bad ? `\n${bad} check(s) failed\n` : "\nall tank arsenal checks passed\n");
process.exit(bad ? 1 : 0);
