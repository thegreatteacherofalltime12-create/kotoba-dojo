// Applying a boost token inside a room.
//
// A token bought in the shop does nothing on its own: the player opens the
// game's "Apply Token" tab and applies it to the match they are in. The room
// remembers who applied in a small map it clears when the round is scored,
// and the round's own record write spends the token. Both messages here read
// one board document, which is the only Firestore traffic the tab causes.
import { readBoosts } from "./firestore.js";

/** The tokens a player holds, by game — never throws. */
export async function heldTokens(env, uid) {
  try { return (await readBoosts(env, [uid]))[uid] || {}; }
  catch { return {}; }
}

/**
 * The reply to a TOKENS request or an APPLY_TOKEN attempt. `applied` is the
 * room's map of who has applied for the current round; `over` says whether
 * the round can still take a token. Returns the payload to send.
 */
export async function tokensReply(env, uid, game, { applied, over, apply }) {
  const tokens = await heldTokens(env, uid);
  const has = (tokens[game] || 0) > 0;
  let error = null;
  let changed = false;
  if (apply && !applied[uid]) {
    if (over) error = "The round is over. Apply it to the next one.";
    else if (!has) error = "You hold no token for this game. The Token shop in your profile sells them.";
    else { applied[uid] = true; changed = true; }
  }
  return { game, tokens, applied: !!applied[uid], error, changed };
}
