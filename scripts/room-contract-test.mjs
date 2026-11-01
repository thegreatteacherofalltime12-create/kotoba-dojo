// node scripts/room-contract-test.mjs
//
// The room contract: a room is only ever announced, found and opened as the game
// it is. A missing or unknown game id is refused and reported, never replaced
// with a guess. Everything here is a way a room could end up in some other
// game's door, plus proof that the valid path is exactly what it was.
import { readFileSync } from "node:fs";
import { DojoDirectory } from "../src/directory.js";
import {
  GAME_IDS, ROOM_ROUTES, ROOM_SEGMENTS, isGameId, normalizeRoomAnnouncement, announceRoom, resolveRoomRoute,
} from "../src/rooms.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

/** Runs fn with console.warn and console.error captured, and puts them back. */
async function loud(fn) {
  const got = { error: [], warn: [] };
  const [e, w] = [console.error, console.warn];
  console.error = (...a) => got.error.push(a);
  console.warn = (...a) => got.warn.push(a);
  try { await fn(); } finally { console.error = e; console.warn = w; }
  return got;
}

/** A real directory, reached through a fake binding the way a room reaches it. */
async function directory() {
  const store = new Map();
  const st = {
    _init: null,
    blockConcurrencyWhile(f) { this._init = f(); return this._init; },
    storage: { get: async (k) => store.get(k), put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); } },
  };
  const dir = new DojoDirectory(st);
  await st._init;
  const calls = [];
  const env = {
    DIRECTORY: {
      idFromName: (n) => n,
      get: () => ({ fetch: (url, init) => { calls.push({ url, init }); return dir.fetch(new Request(url, init)); } }),
    },
  };
  const post = (p, b) => dir.fetch(new Request("https://x" + p, { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) }));
  const find = async (code) => (await dir.fetch(new Request("https://x/find?code=" + code))).json();
  const list = async () => (await (await dir.fetch(new Request("https://x/list"))).json()).dojos;
  return { dir, env, calls, post, find, list };
}
const tell = async (env, room) => {
  let pending;
  const sent = announceRoom(env, { waitUntil: (p) => { pending = p; } }, room);
  await pending;
  return sent;
};
const room = (game, code, extra = {}) => ({ game, code, host: "Sensei", players: 2, phase: "LOBBY", label: "A room", round: 1, ...extra });

console.log("\nwhat counts as a game");
{
  ok("every game this build lists is one", GAME_IDS.every(isGameId));
  ok("a missing id, an empty one, a typo and the wrong case are not",
    [undefined, null, "", "battleshp", "Crossword", " crossword", "match-3"].every((g) => !isGameId(g)));
  ok("nor is a name every object has", ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"].every((g) => !isGameId(g)));
  ok("nor anything that is not a string", [5, true, {}, [], ["crossword"], () => "crossword"].every((g) => !isGameId(g)));
}

console.log("\na room's announcement, checked");
{
  const full = normalizeRoomAnnouncement({ code: "AB123", game: "match3", host: "Sensei", players: 3, phase: "ACTIVE", label: "A puzzle", round: 4 });
  ok("a valid one keeps its game and says so", full.ok === true && full.row.game === "match3");
  ok("and is stored exactly as it always was",
    JSON.stringify(full.row) === JSON.stringify({ code: "AB123", game: "match3", sensei: "Sensei", players: 3, phase: "ACTIVE", puzzle: "A puzzle", roundNo: 4 }));
  const bare = normalizeRoomAnnouncement({ code: "AB123", game: "links" });
  ok("the same defaults as before for what it left out",
    bare.ok && bare.row.sensei === "Someone" && bare.row.players === 0 && bare.row.phase === "LOBBY" && bare.row.puzzle === null && bare.row.roundNo === 0);
  ok("a player count that is odd is clamped, not refused",
    [-2, "-2", NaN, "x", undefined].every((p) => normalizeRoomAnnouncement({ code: "A", game: "prix", players: p }).row.players === 0));
  ok("every game announces as itself", GAME_IDS.every((g) => normalizeRoomAnnouncement({ code: "ZZZ", game: g }).row?.game === g));

  const noGame = normalizeRoomAnnouncement({ code: "AB123", host: "Sensei" });
  ok("a room that does not say its game is refused", noGame.ok === false && /without saying which game/.test(noGame.error));
  ok("and is not turned into a crossword", noGame.row === undefined);
  const mystery = normalizeRoomAnnouncement({ code: "AB123", game: "mystery-game" });
  ok("an unknown game is refused, and named", mystery.ok === false && /unknown game "mystery-game"/.test(mystery.error) && mystery.row === undefined);
  ok("so is a name that every object has", normalizeRoomAnnouncement({ code: "AB123", game: "constructor" }).ok === false);
  ok("a room with no code, or only spaces for one, is refused", [undefined, "", "   ", null].every((c) => normalizeRoomAnnouncement({ code: c, game: "prix" }).ok === false));
}

console.log("\nannouncing it");
{
  const seen = [];
  const env = { DIRECTORY: { idFromName: (n) => n, get: () => ({ fetch: async (url, init) => { seen.push({ url, init }); return { ok: true }; } }) } };

  let sent;
  let logs = await loud(async () => { sent = await tell(env, room("battleship", "AB456", { players: 2 })); });
  const body = JSON.parse(seen[0]?.init.body || "{}");
  ok("a valid room is sent once, to the directory, and says it was", sent === true && seen.length === 1 && seen[0].url === "https://directory/announce");
  ok("as the game it is, with its fields intact", body.game === "battleship" && body.code === "AB456" && body.players === 2 && body.sensei === "Sensei" && body.roundNo === 1);
  ok("and says nothing about it", logs.error.length === 0 && logs.warn.length === 0);

  seen.length = 0;
  logs = await loud(async () => { sent = await tell(env, { code: "AB456", host: "Sensei", players: 2 }); });
  ok("a room with no game is not sent", sent === false && seen.length === 0);
  ok("it is reported as an error, with the code", logs.error.length === 1 && /room-contract/.test(logs.error[0][0]) && /AB456/.test(logs.error[0][0]));

  logs = await loud(async () => { sent = await tell(env, room("mystery-game", "AB456")); });
  ok("an unknown game is not sent either", sent === false && seen.length === 0);
  ok("and is reported with the name it gave", logs.error.length === 1 && /mystery-game/.test(logs.error[0][0]) && logs.error[0][1].game === "mystery-game");

  logs = await loud(async () => { sent = await tell(env, room("battleship", "")); });
  ok("a room with no code is no longer ignored in silence", sent === false && seen.length === 0 && logs.error.length === 1);

  logs = await loud(async () => { sent = await tell({}, room("battleship", "AB456")); });
  ok("with no directory to tell, a valid room is quietly not announced", sent === false && logs.error.length === 0 && logs.warn.length === 0);
  logs = await loud(async () => { sent = await tell({}, room("mystery-game", "AB456")); });
  ok("but a bad one is still reported there, so a test env cannot hide it", sent === false && logs.error.length === 1);

  // The directory refusing, and the directory being down.
  const refusing = { DIRECTORY: { idFromName: (n) => n, get: () => ({ fetch: async () => ({ ok: false, status: 409, text: async () => "Code AB456 belongs to a live battleship room" }) }) } };
  logs = await loud(async () => { sent = await tell(refusing, room("buzzer", "AB456")); });
  ok("a refusal by the directory is reported as an error, with its reason",
    sent === true && logs.error.length === 1 && logs.error[0][1].status === 409 && /live battleship room/.test(logs.error[0][1].why));
  const down = { DIRECTORY: { idFromName: (n) => n, get: () => ({ fetch: async () => { throw new Error("network down"); } }) } };
  let threw = false;
  logs = await loud(async () => { try { await tell(down, room("buzzer", "AB456")); } catch { threw = true; } });
  ok("a directory that cannot be reached never breaks the room", threw === false);
  ok("and is reported, not swallowed", logs.warn.length === 1 && /network down/.test(logs.warn[0][1].message));
}

console.log("\nthe directory");
{
  const { post, find, list, env, calls } = await directory();

  ok("every game is filed under its own name", await (async () => {
    for (const g of GAME_IDS) await tell(env, room(g, "C-" + g));
    for (const g of GAME_IDS) if ((await find("C-" + g)).game !== g) return false;
    return true;
  })());
  ok("and nothing under another's", (await list()).every((r) => r.code === "C-" + r.game));

  const noGame = await post("/announce", { code: "NOGAME", sensei: "X", players: 1, phase: "LOBBY" });
  ok("an announcement with no game is refused, with a reason", noGame.status === 400 && /without a game/.test((await noGame.json()).error));
  ok("and is not stored as a crossword", (await find("NOGAME")).game === null);
  const typo = await post("/announce", { code: "TYPO", game: "battleshp", players: 1 });
  ok("a game this build has never heard of is refused", typo.status === 400 && /unknown game "battleshp"/.test((await typo.json()).error));
  ok("and not stored", (await find("TYPO")).game === null);
  ok("a name every object has is refused", (await post("/announce", { code: "PROTO", game: "constructor", players: 1 })).status === 400);
  ok("so is an announcement with no code", (await post("/announce", { game: "prix", players: 1 })).status === 400);
  ok("and one that is not JSON", (await post("/announce", "<<not json>>")).status === 400);

  // One code, one live room.
  await tell(env, room("battleship", "SHARED", { players: 3 }));
  const clash = await post("/announce", { code: "SHARED", game: "buzzer", players: 1, sensei: "Other" });
  ok("another game cannot take a live room's code", clash.status === 409 && /belongs to a live battleship room/.test((await clash.json()).error));
  const held = await find("SHARED");
  ok("the room that has it keeps it, and is still found as its own game", held.game === "battleship" && held.room.players === 3 && held.room.sensei === "Sensei");
  const wipe = await post("/announce", { code: "SHARED", game: "buzzer", players: 0 });
  ok("nor can another game empty it off the board", wipe.status === 409 && (await find("SHARED")).game === "battleship");
  await tell(env, room("battleship", "SHARED", { players: 5 }));
  const same = await find("SHARED");
  ok("the room itself still updates it", same.room.players === 5 && same.room.openedAt === held.room.openedAt);
  await tell(env, room("battleship", "SHARED", { players: 0 }));
  ok("and still empties it", (await find("SHARED")).game === null);

  // A room that has gone quiet no longer holds its code.
  await tell(env, room("battleship", "OLDCODE", { players: 2 }));
  const dir2 = (await directory());
  await tell(dir2.env, room("battleship", "OLDCODE", { players: 2 }));
  dir2.dir.dojos.OLDCODE.updatedAt = Date.now() - 200_000;
  const reuse = await dir2.post("/announce", { code: "OLDCODE", game: "buzzer", players: 1, sensei: "New" });
  ok("a room that has gone quiet no longer holds its code", reuse.status === 200 && (await dir2.find("OLDCODE")).game === "buzzer");

  // Rows the directory cannot place are said to be that, not guessed at.
  const odd = await directory();
  odd.dir.dojos.MYSTERY = { code: "MYSTERY", game: "mystery-game", sensei: "X", players: 2, phase: "LOBBY", puzzle: null, roundNo: 0, openedAt: Date.now(), updatedAt: Date.now() };
  odd.dir.dojos.LEGACY = { code: "LEGACY", sensei: "X", players: 2, phase: "LOBBY", puzzle: null, roundNo: 0, openedAt: Date.now(), updatedAt: Date.now() };
  const m = await odd.find("MYSTERY");
  ok("a stored room of an unknown game is reported as one, with its name", m.game === null && m.room === null && m.unknownGame === "mystery-game" && /doesn't know/.test(m.error));
  const l = await odd.find("LEGACY");
  ok("so is one that never said, and it is not a crossword", l.game === null && l.room === null && l.unknownGame === null && /doesn't know/.test(l.error));
  ok("a code nobody has is still just nothing", (await odd.find("NOPE")).game === null && (await odd.find("NOPE")).error === undefined);
  ok("the directory was reached for each of those through the real route", calls.length > GAME_IDS.length);
}

console.log("\nthe route to a room");
{
  const env = Object.fromEntries(Object.values(ROOM_ROUTES).map((r) => [r.binding, { idFromName: (n) => n, get: () => ({}), tag: r.binding }]));
  ok("every segment reaches its own game's namespace",
    ROOM_SEGMENTS.every((s) => { const r = resolveRoomRoute(s, env); return r.ok && r.ns === env[ROOM_ROUTES[s].binding] && r.game === ROOM_ROUTES[s].game; }));
  ok("the pairs the browser uses are the pairs it always did",
    JSON.stringify(Object.fromEntries(ROOM_SEGMENTS.map((s) => [s, ROOM_ROUTES[s].binding]))) ===
    JSON.stringify({ battle: "BATTLE", mines: "MINES", links: "LINKS", prix: "PRIX", buzzer: "BUZZER", tanks: "TANKS", match3: "MATCH3" }));
  ok("and the games they open are the ones named in the menu",
    JSON.stringify(ROOM_SEGMENTS.map((s) => ROOM_ROUTES[s].game)) === JSON.stringify(["battleship", "minesweeper", "links", "prix", "buzzer", "artillery", "match3"]));

  for (const s of ["nope", "", undefined, null, 5, "Battle", "battle/", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
    const r = resolveRoomRoute(s, env);
    if (r.ok || r.status !== 404 || r.ns) { ok(`"${String(s)}" is not a game route`, false); break; }
  }
  ok("a segment that is not a game is a 404 and never a namespace", ["nope", "constructor", "__proto__", undefined].every((s) => { const r = resolveRoomRoute(s, env); return !r.ok && r.status === 404 && !r.ns; }));

  const missing = resolveRoomRoute("match3", { ...env, MATCH3: undefined });
  ok("a game whose binding is missing is refused out loud, not handed to another",
    !missing.ok && missing.status === 501 && !missing.ns && /MATCH3 binding for match3/.test(missing.detail));
  ok("and what the player is told leaves out the plumbing", !/MATCH3|binding/.test(missing.error));
  ok("a binding that is not a namespace is the same fault", [{}, { get: () => ({}) }, "MATCH3", 0].every((b) => resolveRoomRoute("match3", { ...env, MATCH3: b }).status === 501));
  ok("one missing binding does not touch the others", resolveRoomRoute("battle", { ...env, MATCH3: undefined }).ok);
  ok("there is no environment at all, and that is a fault too", resolveRoomRoute("battle", undefined).status === 501);

  // The table, the registry and the deployment agree.
  const roomed = GAME_IDS.filter((g) => g !== "crossword" && g !== "casino");
  ok("every game with rooms has exactly one route", roomed.every((g) => Object.values(ROOM_ROUTES).filter((r) => r.game === g).length === 1));
  ok("and every route is a game this build lists", Object.values(ROOM_ROUTES).every((r) => isGameId(r.game)));
  ok("word-cross has its own route, and the casino has no rooms", !Object.values(ROOM_ROUTES).some((r) => r.game === "crossword" || r.game === "casino"));
  const toml = read("wrangler.toml");
  ok("each binding a route names is declared in wrangler.toml", Object.values(ROOM_ROUTES).every((r) => new RegExp(`name\\s*=\\s*"${r.binding}"`).test(toml)));
}

console.log(bad ? `\n${bad} failing\n` : "\nall room contract checks passed\n");
process.exit(bad ? 1 : 0);
