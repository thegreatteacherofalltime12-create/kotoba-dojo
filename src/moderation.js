// What may be said in the arena.
//
// Two layers, cheapest first. A word-and-link filter runs in the Worker on
// every line and costs nothing: sexual and hateful vocabulary, and any link,
// since a link is the only way a picture could reach a chat that renders
// text. What passes that goes to a small purpose-built moderation model on
// Workers AI (Llama Guard) that classifies a line into categories rather
// than chatting about it — a chat line is a few dozen tokens, so a day of
// arena talk sits inside the free allowance. Either layer refusing a line
// means it is never posted, and the sender takes a strike.
//
// The filter is deliberately a short list of the unambiguous, not a
// dictionary: the model catches the rest, and a word list long enough to
// catch everything catches "Scunthorpe" too.

const SEXUAL = [
  "porn", "porno", "pornhub", "xxx", "nude", "nudes", "naked", "sex", "sexy", "sexting", "blowjob", "handjob",
  "dick", "cock", "penis", "vagina", "pussy", "boobs", "tits", "titties", "cum", "cumming", "jerk off",
  "onlyfans", "hentai", "milf", "dildo", "orgasm", "horny", "fuck me", "send pics", "send nudes",
];
const HATE = [
  "nigger", "nigga", "faggot", "fag", "retard", "retarded", "kike", "spic", "chink", "tranny", "dyke",
  "kill yourself", "kys",
];
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|xyz|ru|ly|to|me|tv|co|cc|jpg|jpeg|png|gif|webp|mp4)\b)/i;

// Letters people swap in to slip past a list.
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };
export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    // A digit or symbol swapped for a letter, but only inside a word: "s3nd"
    // is "send", while "3 wins" is three wins.
    .replace(/(?<=[a-z])[013457@$]|[013457@$](?=[a-z])/g, (c) => LEET[c] || c)
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Every letter may be stretched ("fuuuck", "pornnn") and still be the word.
const hasPhrase = (norm, phrase) =>
  new RegExp(`(^|\\s)${[...phrase].map((c) => (c === " " ? "\\s+" : c + "+")).join("")}(\\s|$)`).test(norm);

/**
 * The free layer. Returns { ok: true } or { ok: false, reason }.
 */
export function screen(text) {
  const raw = String(text || "");
  if (LINK.test(raw)) return { ok: false, reason: "links are not allowed in the chat" };
  const norm = normalize(raw);
  if (SEXUAL.some((w) => hasPhrase(norm, w))) return { ok: false, reason: "sexual content" };
  if (HATE.some((w) => hasPhrase(norm, w))) return { ok: false, reason: "hateful or abusive language" };
  return { ok: true };
}

// Llama Guard 3 answers "safe" or "unsafe" with a category code. These are
// the ones the arena removes people for; the rest (specialised advice,
// elections, IP) are not what a games chat is for policing.
const GUARD = {
  S1: "threats of violence", S3: "sexual content", S4: "sexual content involving minors",
  S10: "hateful or abusive language", S11: "encouraging self-harm", S12: "sexual content",
};

/** Turns the model's reply into a verdict. Exported so it can be tested. */
export function verdictFromGuard(reply) {
  const text = String(reply?.response ?? reply ?? "").trim().toLowerCase();
  if (!text.startsWith("unsafe")) return { ok: true };
  const codes = text.match(/s\d{1,2}/g) || [];
  const hit = codes.map((c) => c.toUpperCase()).find((c) => GUARD[c]);
  return hit ? { ok: false, reason: GUARD[hit] } : { ok: true };
}

/**
 * Both layers. The model is asked only when the filter passed and the
 * binding exists; if it cannot answer in time, the line goes through on the
 * filter's say-so — a slow model must not silence the whole arena.
 */
export async function moderate(env, text) {
  const first = screen(text);
  if (!first.ok) return { ...first, layer: "filter" };
  if (!env?.AI || !String(text || "").trim()) return { ok: true, layer: "filter" };
  try {
    const reply = await Promise.race([
      env.AI.run("@cf/meta/llama-guard-3-8b", { messages: [{ role: "user", content: String(text).slice(0, 300) }] }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("guard timed out")), 2500)),
    ]);
    return { ...verdictFromGuard(reply), layer: "guard" };
  } catch (err) {
    console.error(`[moderation] ${err.message}`);
    return { ok: true, layer: "filter" };
  }
}

export const STRIKES_TO_BAR = 3;
