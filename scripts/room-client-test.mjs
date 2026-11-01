// node scripts/room-client-test.mjs
//
// The browser's half of the room contract. This runs the real openRoom,
// joinByCode and roomInUrl out of public/app.js (the slice from the opener
// table to the Join button) against stand-ins for the screens, so what is
// checked is the shipped code and not a copy of it.
//
// The rule: a code, a board row or a saved link that names a game this version
// cannot open is said so, and nothing is opened. It is never opened as the
// crossword, or as anything else.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { GAME_IDS } from "../src/rooms.js";
import { GAME_MODES } from "../public/arena.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

const start = app.indexOf("const ROOMS = {");
const end = app.indexOf('$("btn-join").onclick');
if (start < 0 || end < start) {
  console.log("  FAIL  could not find the room section of public/app.js (const ROOMS = { ... $(\"btn-join\").onclick)");
  process.exit(1);
}
const slice = app.slice(start, end);

/** A fresh page: every screen is a stand-in that writes down that it was opened. */
function page({ hash = "", fetchBody = undefined, fetchThrows = false } = {}) {
  const opened = [], said = [], warned = [];
  const location = { hash, pathname: "/", search: "", href: "" };
  const open = (game) => (...a) => opened.push({ game, args: a });
  const ctx = vm.createContext({
    show: (screen) => opened.push({ game: "show:" + screen }),
    say: (node, message) => said.push({ node, message }),
    loadDojos: () => {},
    enterDojo: open("crossword"), enterBattle: open("battleship"), enterMines: open("minesweeper"),
    enterPrix: open("prix"), enterBuzzer: open("buzzer"), enterTanks: open("artillery"), enterMatch3: open("match3"),
    enterCasino: open("casino"), leaveCasino: () => {},
    location,
    history: { replaceState: (_s, _t, url) => { location.hash = String(url).startsWith("#") ? String(url) : ""; } },
    console: { warn: (...a) => warned.push(a.join(" ")), error: () => {}, log: () => {} },
    fetch: async () => { if (fetchThrows) throw new Error("offline"); return { json: async () => fetchBody }; },
    auth: { currentUser: { getIdToken: async () => "t" } },
    encodeURIComponent, Object, Set, RegExp, String, Array,
  });
  vm.runInContext(slice, ctx);
  const get = (name) => vm.runInContext(name, ctx);
  return { ctx, opened, said, warned, location, get };
}
/** Only the games that were opened: the "show:" lines are the screens changing. */
const games = (p) => p.opened.filter((o) => !o.game.startsWith("show:"));

console.log("\nthe opener table");
{
  const p = page();
  const keys = Object.keys(p.get("ROOMS"));
  ok("it opens exactly the games the server lists, and no others",
    keys.length === GAME_IDS.length && GAME_IDS.every((g) => keys.includes(g)));
  ok("every game the menu offers has an opener", GAME_MODES.filter((m) => m.available).every((m) => keys.includes(m.game)));
  ok("and every game that can be reopened from a link has one", [...p.get("REJOINABLE")].every((g) => keys.includes(g)));
}

console.log("\nopening a room");
{
  const results = GAME_IDS.map((g) => {
    const p = page();
    p.get("openRoom")(g, "ABC12");
    return { g, p };
  });
  ok("each game opens its own screen, once", results.every(({ g, p }) => g === "links" ? p.location.href.includes("links.html#ABC12") : games(p).length === 1 && games(p)[0].game === g));
  ok("handing over the code it was given", results.filter(({ g }) => !["links", "casino"].includes(g)).every(({ p }) => games(p)[0].args[0] === "ABC12"));
  ok("and saying nothing is wrong", results.every(({ p }) => p.said.length === 0));
  const mine = page();
  mine.get("openRoom")("match3", "ABC12");
  ok("a room that can be reopened is remembered in the address", mine.location.hash === "#match3:ABC12");
  const links = page();
  links.get("openRoom")("links", "QRS45", true);
  ok("golf still goes to its own page with a new round", links.location.href === "/links.html#new:QRS45");
}

console.log("\na game this version does not know");
{
  const names = ["mystery-game", "battleshp", "Crossword", "", undefined, null, "constructor", "toString", "__proto__", "hasOwnProperty"];
  const runs = names.map((n) => {
    const p = page();
    let threw = null;
    try { p.get("openRoom")(n, "ABC12"); } catch (e) { threw = String(e.message || e); }
    return { n, p, threw };
  });
  ok("none of them throws", runs.every(({ threw }) => threw === null));
  ok("none of them opens a game", runs.every(({ p }) => p.opened.length === 0));
  ok("including the ones every object happens to have", runs.filter(({ n }) => ["constructor", "toString", "__proto__", "hasOwnProperty"].includes(n)).every(({ p }) => p.opened.length === 0));
  ok("each is said to the player, on the rooms board", runs.every(({ p }) => p.said.length === 1 && p.said[0].node === "rooms-error" && /doesn't know/.test(p.said[0].message)));
  ok("and names what it was", runs[0].p.said[0].message.includes("(mystery-game)"));
  ok("and none is remembered as a place to come back to", runs.every(({ p }) => p.location.hash === ""));
}

console.log("\njoining by code");
{
  const run = async (body, o = {}) => { const p = page({ fetchBody: body, ...o }); await p.get("joinByCode")("ABC12"); return p; };

  let p = await run({ game: "match3", room: { code: "ABC12" } });
  ok("a code that belongs to a game opens that game", games(p).length === 1 && games(p)[0].game === "match3" && p.said.length === 0);
  p = await run({ game: "battleship", room: {} });
  ok("a battle code opens a battle, not a crossword", games(p).length === 1 && games(p)[0].game === "battleship");

  p = await run({ game: null, room: null });
  ok("a code nobody has says so, and opens nothing", games(p).length === 0 && /No room with that code/.test(p.said[0].message));
  p = await run({});
  ok("an answer that names no game is the same, not a crossword", games(p).length === 0 && /No room with that code/.test(p.said[0].message));
  p = await run({ game: null, room: null, unknownGame: "mystery-game", error: "That room is a game this version doesn't know (mystery-game)." });
  ok("a room of a game this version cannot place says exactly that", games(p).length === 0 && /doesn't know \(mystery-game\)\. Update the app\./.test(p.said[0].message));
  p = await run({ game: "mystery-game", room: {} });
  ok("an answer naming an unknown game is refused and opens nothing", games(p).length === 0 && /doesn't know \(mystery-game\)/.test(p.said[0].message));
  p = await run({ game: "constructor", room: {} });
  ok("so is one naming a thing every object has", games(p).length === 0 && p.said.length === 1);
  p = await run(undefined, { fetchThrows: true });
  ok("an arena that cannot be reached says so and opens nothing", games(p).length === 0 && /Couldn't reach the arena/.test(p.said[0].message));
}

console.log("\ncoming back to a room after a refresh");
{
  let p = page({ hash: "#match3:abc12" });
  const back = p.get("roomInUrl")();
  ok("a saved room is read back as its game and code, as before", back?.game === "match3" && back?.code === "ABC12");
  ok("and is left in the address", p.location.hash === "#match3:abc12" && p.warned.length === 0);
  ok("every game that can be reopened comes back as itself",
    [...page().get("REJOINABLE")].every((g) => page({ hash: `#${g}:ABC12` }).get("roomInUrl")()?.game === g));

  p = page({ hash: "#mystery:ABC12" });
  ok("a link to a game that does not exist reopens nothing", p.get("roomInUrl")() === null);
  ok("and is said in the console and dropped from the address", p.warned.length === 1 && /mystery/.test(p.warned[0]) && p.location.hash === "");
  p = page({ hash: "#constructor:ABC12" });
  ok("a name every object has is no different", p.get("roomInUrl")() === null && p.warned.length === 1 && p.location.hash === "");
  p = page({ hash: "#links:ABC12" });
  ok("a game that is not reopened from a link says so rather than guessing", p.get("roomInUrl")() === null && p.warned.length === 1);
  p = page({ hash: "" });
  ok("no link at all is just no link", p.get("roomInUrl")() === null && p.warned.length === 0);
  p = page({ hash: "#scrolls" });
  ok("a hash that is not a room link is left alone", p.get("roomInUrl")() === null && p.warned.length === 0 && p.location.hash === "#scrolls");
}

console.log("\nthe menu and the board");
{
  ok("every mode that can be started names its game, and it is one this version opens",
    GAME_MODES.filter((m) => m.available).every((m) => typeof m.game === "string" && GAME_IDS.includes(m.game)));
  ok("Create a match does not turn a nameless mode into a crossword",
    !/data-game="\$\{m\.game \|\| "crossword"\}"/.test(app) && !/dataset\.game \|\| "crossword"/.test(app));
  ok("and refuses one, out loud", /That mode doesn't say which game it is/.test(app));
  ok("the rooms board does not file a row with no game as a crossword", !/d\.game \|\| "crossword"/.test(app));
  ok("it shows a row it cannot open as unknown, with the door shut", /isRoomGame\(d\.game\)/.test(app) && /"Unknown game"/.test(app) && /join\.disabled = true/.test(app));
  ok("and the browser code does not lean on Object.hasOwn, which older phones lack", !/Object\.hasOwn\(/.test(app));
  ok("and it no longer labels an unknown game Word Cross", !/\|\| "Word Cross"/.test(app));
}

console.log(bad ? `\n${bad} failing\n` : "\nall room client checks passed\n");
process.exit(bad ? 1 : 0);
