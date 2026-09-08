// One place where a room tells the directory it exists.
//
// Codes come from a single pool, so a code alone doesn't say which game it
// belongs to. Every room type registers through here; miss it and that game's
// codes become unjoinable, which is the bug this replaced.
//
// Adding a game means calling announceRoom from its Durable Object and adding
// one line to ROOMS in public/app.js. Nothing else.

export const GAME_IDS = ["crossword", "battleship", "minesweeper", "casino"];

/**
 * @param {object} env    the Worker environment, for the DIRECTORY binding
 * @param {object} state  the Durable Object state, for waitUntil
 * @param {object} room
 * @param {string} room.game     one of GAME_IDS
 * @param {string} room.code
 * @param {string} room.host     display name of whoever runs it
 * @param {number} room.players  how many are connected; 0 removes the row
 * @param {string} room.phase
 * @param {string} [room.label]  what's being played, shown on the board
 * @param {number} [room.round]
 */
export function announceRoom(env, state, room) {
  if (!env?.DIRECTORY || !room?.code || !room?.game) return;

  const body = JSON.stringify({
    code: room.code,
    game: room.game,
    sensei: room.host || "Someone",
    players: Math.max(0, room.players || 0),
    phase: room.phase || "LOBBY",
    puzzle: room.label || null,
    roundNo: room.round || 0,
  });

  const call = env.DIRECTORY
    .get(env.DIRECTORY.idFromName("global"))
    .fetch("https://directory/announce", { method: "POST", body })
    .catch(() => {});

  // Never block play on the directory: a lost announcement costs discovery,
  // not the game in progress.
  state?.waitUntil?.(call);
}
