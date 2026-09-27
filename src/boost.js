// Applying a boost token inside a room.
//
// A token bought in the shop does nothing on its own: the player opens the
// game's "Apply Token" tab and applies it to the match they are in. The room
// remembers who applied in a small map it clears when the round is scored,
// and the round's own record write spends the token. Both messages here read
// one board document, which is the only Firestore traffic the tab causes.
import { readBoosts } from "./firestore.js";
import { isMultiplier, multFor } from "./mmr.js";

/** The tokens a player holds, by game — never throws. */
export async function heldTokens(env, uid) {
  try { return (await readBoosts(env, [uid]))[uid] || {}; }
  catch { return {}; }
}

/**
 * The reply to a TOKENS request or an APPLY_TOKEN attempt.
 *
 * `applied` is the room's map of who has applied for the current round, and
 * what they applied: the game's own boost token is stored as the game, a
 * multiplier as its own key. It was a boolean before multipliers existed, and
 * every room that reads it still only asks whether it is truthy.
 *
 * `key` is what the player picked. Left out, it means the game's 1.5x boost,
 * which is what every room asked for before there was anything else to ask
 * for. One token to a round either way: a multiplier goes on instead of the
 * boost, never as well as it.
 */
export async function tokensReply(env, uid, game, { applied, over, apply, key }) {
  const tokens = await heldTokens(env, uid);
  const want = key && isMultiplier(key) ? key : game;
  const has = (tokens[want] || 0) > 0;
  let error = null;
  let changed = false;
  if (apply && !applied[uid]) {
    if (over) error = "The round is over. Apply it to the next one.";
    else if (key && !isMultiplier(key) && key !== game) error = "No such token.";
    else if (!has) {
      error = want === game
        ? "You hold no token for this game. The Token shop in your profile sells them."
        : `You hold no ${multFor(want)}\u00d7 multiplier. The Token shop in your profile sells them.`;
    } else { applied[uid] = want; changed = true; }
  }
  const put = applied[uid] || null;
  return {
    game, tokens,
    applied: !!put,
    // What is on this round, and what it is worth, for the tab to draw.
    appliedKey: put,
    mult: put ? multFor(put) : null,
    error, changed,
  };
}
