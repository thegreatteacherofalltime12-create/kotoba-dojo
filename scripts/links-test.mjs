// node scripts/links-test.mjs
//
// The tee. A round of golf must never begin on its own: the player who opened
// the room chooses the course and calls the start, and until they do, nothing
// is drawn and nobody is playing.
import { LinksCourse } from "../src/links-course.js";
import { COURSES, pointsFor } from "../src/links.js";
import { sessionGain } from "../src/mmr.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

class FakeSocket {
  constructor(uid) { this.uid = uid; this.inbox = []; }
  send(raw) { this.inbox.push(JSON.parse(raw)); }
  last(type) { return [...this.inbox].reverse().find((m) => m.type === type); }
}

const makeState = () => {
  const store = new Map();
  return {
    storage: {
      get: async (k) => (Array.isArray(k) ? new Map(k.map((x) => [x, store.get(x)])) : store.get(k)),
      put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, v); },
      deleteAlarm: async () => {}, setAlarm: async () => {},
    },
    blockConcurrencyWhile(f) { this._init = f(); return this._init; },
    waitUntil: () => {},
  };
};

// announceRoom and readRatings both reach for the network; neither is what is
// under test here, and both already fail soft.
const env = {};

async function room(courseId = "augusta") {
  const st = makeState();
  const g = new LinksCourse(st, env);
  // The constructor restores from storage asynchronously; setting the room
  // before that lands would simply be overwritten by it.
  await st._init;
  g.room = g.blank("GOLF", courseId, "medium", "classic");
  return g;
}

function seat(g, uid) {
  const ws = new FakeSocket(uid);
  g.socks.set(ws, uid);
  if (!g.room.players[uid]) g.room.players[uid] = g.freshPlayer(uid, uid.toUpperCase());
  if (!g.room.hostUid) g.room.hostUid = uid;
  return ws;
}

console.log("\nthe tee");
{
  const g = await room();
  const a = seat(g, "a"); seat(g, "b");
  ok("a fresh room is waiting, not playing", g.room.phase === "LOBBY");
  ok("no holes are drawn before the off", g.room.board === null);
  ok("the first player in holds the start", g.room.hostUid === "a");
  ok("and is told so", g.view("a").isHost === true);
  ok("the second player is not", g.view("b").isHost === false);
  await g.start(a, "a");
  ok("the host can tee off", g.room.phase === "PLAYING");
  ok("and the holes are drawn then", Array.isArray(g.room.board) && g.room.board.length === 18);
}

console.log("\nwho may call it");
{
  const g = await room();
  seat(g, "a"); const b = seat(g, "b");
  await g.start(b, "b");
  ok("a guest cannot start the round", g.room.phase === "LOBBY");
  ok("and is told why", /calls the start/.test(b.last("LINKS_REJECT")?.why || ""));
}

console.log("\na room whose host has gone");
{
  const g = await room();
  const a = seat(g, "a"); const b = seat(g, "b");
  g.socks.delete(a);                       // the host closed the tab
  ok("the room is not stuck", g.view("b").isHost === true);
  await g.start(b, "b");
  ok("whoever is left can tee off", g.room.phase === "PLAYING");
}

console.log("\nthe dice");
{
  const g = await room("random");
  ok("a random room remembers that it is random", g.room.randomCourse === true);
  ok("and still shows a real course while it waits",
    COURSES.some((c) => c.id === g.room.courseId));
  const a = seat(g, "a");
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    g.room.phase = "LOBBY";
    await g.start(a, "a");
    seen.add(g.room.courseId);
  }
  ok("and draws a new course each round", seen.size > 1);

  const fixed = await room("standrews");
  const f = seat(fixed, "a");
  ok("a chosen course is the one you get", fixed.room.courseId === "standrews");
  await fixed.start(f, "a");
  ok("and it does not wander between rounds", fixed.room.courseId === "standrews");
}

console.log("\nsolo and the open room");
{
  const g = await room();
  g.room.solo = true;
  const a = seat(g, "a");
  ok("a solo round is marked as one", g.view("a").solo === true);
  ok("and its owner still calls the start", g.view("a").isHost === true);
  await g.start(a, "a");
  ok("one player is enough to tee off", g.room.phase === "PLAYING");

  // Unlisted: announceRoom takes players:0 as "withdraw the row".
  let announced = null;
  g.announce = LinksCourse.prototype.announce.bind({
    ...g,
    env: {
      DIRECTORY: {
        idFromName: () => "x",
        get: () => ({ fetch: (_u, o) => { announced = JSON.parse(o.body); return Promise.resolve(); } }),
      },
    },
    state: { waitUntil: (p) => p },
    room: g.room,
  });
  g.announce();
  ok("a solo round is withdrawn from the room list", announced && announced.players === 0);
  ok("and is labelled as solo", /^Solo/.test(announced.puzzle || ""));

  const open = await room();
  open.room.solo = false;
  seat(open, "a"); seat(open, "b");
  let listed = null;
  open.announce = LinksCourse.prototype.announce.bind({
    ...open,
    env: {
      DIRECTORY: {
        idFromName: () => "x",
        get: () => ({ fetch: (_u, o) => { listed = JSON.parse(o.body); return Promise.resolve(); } }),
      },
    },
    state: { waitUntil: (p) => p },
    room: open.room,
  });
  open.announce();
  ok("an open room is listed with its players", listed && listed.players === 2);
  ok("and is not labelled solo", !/^Solo/.test(listed.puzzle || ""));
  // The refusal happens before any socket is made, so this needs no WebSocket
  // stub: a 403 back means the stranger never got into the room.
  const priv = await room();
  priv.room.solo = true;
  priv.room.hostUid = "owner";
  priv.room.players.owner = priv.freshPlayer("owner", "Owner");
  const knock = (uid) => priv.fetch(new Request("https://links/x", {
    headers: { Upgrade: "websocket", "X-Dojo-Uid": uid, "X-Dojo-Name": uid, "X-Dojo-Code": "GOLF" },
  }));
  ok("a stranger who knows the code is turned away", (await knock("stranger")).status === 403);
  ok("and no seat is kept for them", !priv.room.players.stranger);
}

console.log("\nthe card is not the ladder");
{
  const pars = [3, 4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 3, 5, 4, 3, 4, 4, 5];
  const g = await room();
  const card = (f) => pars.map((par) => ({ par, strokes: f(par), points: pointsFor(f(par), par) }));
  const scoreOf = (c) => g.scoreOf(g.room, { card: c, points: c.reduce((a, h) => a + h.points, 0) });

  ok("level par is a competent round, not a perfect one", scoreOf(card((p) => p)) === 50);
  ok("bogey golf scores below it", scoreOf(card((p) => p + 1)) < 50);
  ok("birdies score above it", scoreOf(card((p) => p - 1)) > 50);
  ok("nothing exceeds a hundred", scoreOf(card(() => 1)) === 100);
  ok("an empty card scores nothing", g.scoreOf(g.room, { card: [], points: 0 }) === 0);

  // The whole point of the normalising: golf must not out-pay every other game.
  const best = (score) => sessionGain({
    score, completed: true, playerMmr: 1000, fieldMmr: 3000, mode: "rumble", seed: 8, placement: 1,
  }).total;
  ok("a perfect round pays what a perfect round anywhere pays",
    best(scoreOf(card(() => 1))) === best(100));
  ok("and level par pays well under it", best(scoreOf(card((p) => p))) < best(100));
}

console.log(bad ? `\n${bad} failing\n` : "\nall golf checks passed\n");
process.exit(bad ? 1 : 0);
