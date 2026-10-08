// One place where a room tells the directory it exists.
//
// Codes come from a single pool, so a code alone doesn't say which game it
// belongs to. Every room type registers through here; miss it and that game's
// codes become unjoinable, which is the bug this replaced.
//
// Adding a game means calling announceRoom from its Durable Object and adding
// one line to ROOMS in public/app.js. Nothing else.
//
// The contract has one rule that matters more than the rest: a room is only
// ever announced as the game it is. A missing or unknown game id is refused and
// reported, and never replaced with a guess. A guess is how a Battleship code
// once opened a crossword, and a wrong guess looks exactly like a right one.

import { reportRuntimeIssue } from "./observability.js";

export const GAME_IDS = ["crossword", "battleship", "minesweeper", "casino", "links", "prix", "buzzer", "artillery", "match3"];

/**
 * True only for a game this build knows. Anything else (undefined, a typo, a
 * number, or a name like "constructor" that merely exists on every object) is not.
 */
export const isGameId = (id) => typeof id === "string" && GAME_IDS.includes(id);

/**
 * How a game's room is reached over a socket: the path segment the browser
 * uses, the game it belongs to, and the Durable Object binding that holds it.
 *
 * Word-Cross is reached on its own route (/api/dojo/CODE/ws) and the casino is
 * solo against the house, so neither is here. Every other game is, and the
 * Worker builds its route from this table. It used to pick the namespace with
 * a chain of conditions that ended in Battleship, so a game added to the route
 * and not to the chain would have been quietly handed to Battleship.
 */
export const ROOM_ROUTES = {
  battle: { game: "battleship", binding: "BATTLE" },
  mines: { game: "minesweeper", binding: "MINES" },
  links: { game: "links", binding: "LINKS" },
  prix: { game: "prix", binding: "PRIX" },
  buzzer: { game: "buzzer", binding: "BUZZER" },
  tanks: { game: "artillery", binding: "TANKS" },
  match3: { game: "match3", binding: "MATCH3" },
};
export const ROOM_SEGMENTS = Object.keys(ROOM_ROUTES);

/**
 * The Durable Object namespace for a route segment, or the reason there is
 * not one. There is no default: a segment this table does not list is not a
 * game, and a listed one whose binding is missing is a deployment fault that
 * is said out loud rather than served by some other game's room.
 */
export function resolveRoomRoute(segment, env) {
  if (typeof segment !== "string" || !Object.hasOwn(ROOM_ROUTES, segment)) {
    return { ok: false, status: 404, error: "No such game.", detail: `No room route named "${String(segment).slice(0, 40)}".` };
  }
  const { game, binding } = ROOM_ROUTES[segment];
  const ns = env?.[binding];
  if (!ns || typeof ns.idFromName !== "function" || typeof ns.get !== "function") {
    return {
      ok: false, status: 501,
      error: "That game's rooms aren't available right now.",
      detail: `The ${binding} binding for ${game} is not set up on this Worker.`,
    };
  }
  return { ok: true, game, binding, ns };
}

/**
 * What a room says about itself, checked. Returns { ok: true, row } with the
 * row the directory stores, or { ok: false, error } saying what was wrong.
 * Nothing is repaired: a room that did not say which game it is, or named
 * one this build has never heard of, is refused.
 */
export function normalizeRoomAnnouncement(room) {
  const code = String(room?.code ?? "").trim();
  if (!code) return { ok: false, error: "A room announced itself without a code." };

  if (room?.game === undefined || room?.game === null || room?.game === "") {
    return { ok: false, code, error: `Room ${code} announced itself without saying which game it is.` };
  }
  if (!isGameId(room.game)) {
    return { ok: false, code, error: `Room ${code} announced an unknown game "${String(room.game).slice(0, 40)}".` };
  }

  return {
    ok: true,
    row: {
      code,
      game: room.game,
      sensei: room.host || "Someone",
      players: Math.max(0, Number(room.players) || 0),
      phase: room.phase || "LOBBY",
      puzzle: room.label || null,
      roundNo: Number(room.round || 0),
    },
  };
}

/**
 * @param {object} env    the Worker environment, for the DIRECTORY binding
 * @param {object} state  the Durable Object state, for waitUntil
 * @param {object} room
 * @param {string} room.game     one of GAME_IDS. Required: there is no default.
 * @param {string} room.code
 * @param {string} room.host     display name of whoever runs it
 * @param {number} room.players  how many are connected; 0 removes the row
 * @param {string} room.phase
 * @param {string} [room.label]  what's being played, shown on the board
 * @param {number} [room.round]
 * @returns {boolean} whether the announcement was sent. False is never silent:
 *   a refused one is reported, and one with no directory to tell is a test.
 */
export function announceRoom(env, state, room) {
  const checked = normalizeRoomAnnouncement(room);
  if (!checked.ok) {
    reportRuntimeIssue("room-contract", `${checked.error} It was not announced.`, {
      code: room?.code ?? null,
      game: room?.game ?? null,
    }, "error");
    return false;
  }
  if (!env?.DIRECTORY) return false;

  const { row } = checked;
  const call = env.DIRECTORY
    .get(env.DIRECTORY.idFromName("global"))
    .fetch("https://directory/announce", { method: "POST", body: JSON.stringify(row) })
    .then(async (res) => {
      // The directory refuses what breaks the contract (an unknown game, or a code
      // another live room has). That is reported here, where the room is known.
      if (res && res.ok === false) {
        const why = await Promise.resolve(res.text?.()).catch(() => "");
        reportRuntimeIssue("room-contract", `The directory refused room ${row.code} (${row.game}), status ${res.status}`, {
          code: row.code, game: row.game, status: res.status, why: String(why || "").slice(0, 200),
        }, "error");
      }
    })
    // Never block play on the directory: a lost announcement costs discovery,
    // not the game in progress. It is still said, not swallowed.
    .catch((err) => {
      reportRuntimeIssue("room-contract", `The directory could not be reached for room ${row.code}`, {
        code: row.code, game: row.game, message: err?.message || String(err),
      });
    });

  state?.waitUntil?.(call);
  return true;
}
