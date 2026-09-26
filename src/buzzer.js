/**
 * The Buzzer — the arithmetic of a quiz board, with no room around it.
 *
 * Everything here is a pure function so it can be tested without standing a
 * Durable Object up: what a cell is worth, how long a clue takes to read
 * aloud, what a buzz was really worth once the clocks are reconciled, and
 * what a finished board is worth on a hundred-point scale.
 *
 * The buzzer is the only genuinely new piece of engineering in the arena.
 * Every other game here is turn-based or everyone-at-once; this is the first
 * where two people want the same thing at the same instant and one of them
 * has to lose. See `judgeBuzz` for how that is settled, and why it is settled
 * on the browser's clock rather than on whose packet arrived first.
 */

// The working name. Changing this line changes it everywhere the room says
// it: the lobby, the feed, the directory and the results.
export const GAME_NAME = "The Buzzer";

export const COLS = 6;   // categories across
export const ROWS = 5;   // clues down
export const BASE_VALUE = 200;

/**
 * Two rounds, the second worth double. The show's names are its own; these
 * are ours, and they are the only place a round is titled.
 */
export const ROUNDS = [
  { no: 1, name: "The Board", mult: 1 },
  { no: 2, name: "The Double Board", mult: 2 },
];

/** Everyone sits down with this, and it is a stake rather than a gift. */
export const START_MONEY = 2000;

/** Row 0 is $200 and row 4 is $1,000, doubled in the second round. */
export function valueAt(row, round = 1) {
  const r = Math.max(0, Math.min(ROWS - 1, Number(row) || 0));
  return BASE_VALUE * (r + 1) * (Number(round) === 2 ? 2 : 1);
}

/** The biggest thing on a board, which is what a Daily Double may be worth. */
export function topValue(round = 1) { return valueAt(ROWS - 1, round); }

// ── the clock ────────────────────────────────────────────────────────

/**
 * How long the clue sits there before the buzzers open.
 *
 * On television this is exactly as long as it takes the host to read it, and
 * that is most of why buzzing well is a skill: the clue you have already
 * finished reading is the one you win. So it scales with length rather than
 * being a flat pause — about a hundred and seventy words a minute, which is
 * an unhurried reading voice.
 */
export const READ_PER_CHAR_MS = 62;
export const READ_MIN_MS = 2_200;
export const READ_MAX_MS = 9_000;

export function readingMs(text) {
  const n = String(text || "").length;
  return Math.max(READ_MIN_MS, Math.min(READ_MAX_MS, Math.round(n * READ_PER_CHAR_MS)));
}

/** Ten seconds to choose, and the clock stops the moment you do. */
export const ANSWER_MS = 10_000;

/** Nobody buzzed. The answer is shown, then the cell closes. */
export const NOBODY_MS = 12_000;
export const REVEAL_MS = 2_600;

/**
 * Buzzes that arrive inside this window of the first one are judged
 * together rather than in arrival order.
 *
 * This is the whole point. A clock-stamped buzz is useless if the room hands
 * the clue to the first packet through the door — the player on fibre still
 * wins every close call. So the first buzz opens a short window, everything
 * inside it is collected, and the lowest reaction time takes the clue. A
 * third of a second is long enough to cover the difference between a good
 * connection and a bad one, and short enough that nobody feels it.
 */
export const BUZZ_WINDOW_MS = 350;

/**
 * Buzz before the buzzers open and you are shut out for a quarter of a
 * second — which is exactly long enough to lose the clue to somebody who
 * waited. It is the real rule, it punishes mashing, and it is the reason
 * reading time is worth watching rather than sitting through.
 */
export const EARLY_LOCKOUT_MS = 250;

/**
 * The floor on a reaction time.
 *
 * A human eye-to-thumb reaction is about two hundred milliseconds and never
 * under a hundred and twenty. A script that fires the moment the buzzers open
 * would otherwise report zero and win every clue in the game, so no reaction
 * is ever recorded as quicker than this. It does not stop a script — nothing
 * in a browser can — but it puts one level with the best human in the room
 * instead of ahead of every human ever born, and ties at the floor fall back
 * to arrival order.
 */
export const MIN_REACTION_MS = 150;

/**
 * How far out of step a browser's clock may be before the room stops
 * believing it. Beyond this the buzz is judged on arrival instead.
 */
export const MAX_DRIFT_MS = 4_000;

/**
 * The most latency a buzz is ever forgiven.
 *
 * Every millisecond of credit given for a slow connection is a millisecond a
 * modified client can claim for nothing, because there is no way to verify
 * from the outside when a button was really pressed. So the credit is capped:
 * a reaction may not be reported as quicker than what the room saw with its
 * own eyes, less half a second.
 *
 * That costs an honest player nothing — home latency is tens of milliseconds
 * and even bad hotel wifi is well inside it — while bounding what a lie is
 * worth to half a second rather than to everything.
 *
 * It does not make cheating impossible, and it is worth being plain about
 * that rather than claiming otherwise: a client on a fast connection that
 * always claims a perfect buzz will always be judged at MIN_REACTION_MS. What
 * actually punishes that is the game rather than the clock — a wrong answer
 * costs exactly what a right one pays, so buzzing at everything on a
 * one-in-four guess loses money about as fast as it is possible to lose it.
 */
export const MAX_CREDIT_MS = 500;

/**
 * What a buzz was actually worth.
 *
 * `stamp` is when the browser says the button went down, already converted
 * to the room's clock by the skew the two of them measured. `arrivedAt` is
 * when the message actually reached the room, and `openAt` is when the
 * buzzers opened.
 *
 * Two guards, and they do different jobs.
 *
 * The clamp catches a stamp that could not have happened — later than the
 * moment the message arrived, or older than the room is willing to believe.
 * That is a drifted clock or a broken client, and it is judged on arrival.
 *
 * The credit cap catches the lie the clamp misses, which is the one a real
 * cheat would actually tell: not an absurd timestamp, but "I buzzed the
 * instant the lights came on". That sits comfortably inside any drift window,
 * so no clamp will ever see it. What stops it is refusing to report a
 * reaction quicker than the room observed, less MAX_CREDIT_MS — so a lie is
 * worth half a second at most instead of the whole gap.
 */
export function judgeBuzz({ stamp, arrivedAt, openAt }) {
  const now = Number(arrivedAt) || 0;
  const open = Number(openAt) || 0;
  const said = Number(stamp);

  // No usable stamp, or one that could not have happened: judge on arrival.
  const usable = Number.isFinite(said) && said <= now + 250 && said >= now - MAX_DRIFT_MS;
  const at = usable ? Math.min(said, now) : now;

  if (at < open) {
    return {
      ok: false, early: true,
      reaction: null,
      lockedUntil: open + EARLY_LOCKOUT_MS,
      why: "Too early. The buzzers weren't open.",
    };
  }

  // What the room saw for itself, and what the browser claims. The floor is
  // the first less the credit, so latency is forgiven and lying is not.
  const observed = now - open;
  const floor = Math.max(MIN_REACTION_MS, observed - MAX_CREDIT_MS);
  return {
    ok: true, early: false,
    reaction: Math.max(floor, Math.round(at - open)),
    lockedUntil: 0,
    why: null,
  };
}

/**
 * Which of the buzzes collected in the window takes the clue.
 *
 * Lowest reaction wins. A tie — which in practice means two people both
 * pinned to the floor above — falls back to whichever message got here
 * first, because at that point there is nothing else to separate them.
 */
export function winningBuzz(buzzes) {
  const live = (buzzes || []).filter((b) => b && b.ok);
  if (!live.length) return null;
  return [...live].sort((a, b) =>
    a.reaction - b.reaction ||
    a.arrivedAt - b.arrivedAt ||
    String(a.uid).localeCompare(String(b.uid))
  )[0];
}

// ── the board ────────────────────────────────────────────────────────

/**
 * A deterministic shuffle, so a room built from a seed is the same board for
 * everybody in it and the same board again if the object has to be rebuilt.
 */
export function shuffle(list, rnd) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** mulberry32 — small, fast, and the same everywhere. */
export function rngFrom(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The four options a player is shown, with the right one somewhere among
 * them. Three wrong ones come from the clue's own decoy pool — the same
 * family as the answer — so nobody wins on register or on an option that is
 * obviously from another subject.
 */
export function optionsFor(clue, pool, rnd) {
  const answer = String(clue.a);
  const seen = new Set([answer.toLowerCase()]);
  const wrong = [];
  for (const w of shuffle([...(clue.wrong || []), ...(pool || [])], rnd)) {
    const t = String(w || "").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    wrong.push(t);
    if (wrong.length === 3) break;
  }
  return shuffle([answer, ...wrong], rnd);
}

// ── what the board was worth ─────────────────────────────────────────

/**
 * A finished board on the arena's hundred-point scale, the same shape as the
 * race's raceScore: where you came carries most of it, and how well you knew
 * the answers carries the rest.
 *
 * Placement stops at eighty for the same reason it does on the track — if
 * winning alone filled the score, a player who buzzed at everything and knew
 * a third of it would score the same as one who knew what they were doing.
 */
export function boardScore({ placement, field, right, wrong, finished = true }) {
  const place = field > 1
    ? 80 - 50 * ((placement - 1) / (field - 1))
    : 70;
  const asked = (right || 0) + (wrong || 0);
  // Answer nothing all night and the accuracy half is nothing. It is not a
  // penalty; there is simply nothing there to be accurate about.
  const accuracy = asked ? 20 * (right / asked) : 0;
  const got = (place * (finished ? 1 : 0.6)) + accuracy;
  return Math.max(0, Math.min(100, Math.round(got)));
}

/**
 * The order of a table: money first, then whoever got to it with fewer wrong
 * answers, then by name so a tie is at least stable.
 */
export function standings(players) {
  return [...players].sort((a, b) =>
    (b.money || 0) - (a.money || 0) ||
    (a.wrong || 0) - (b.wrong || 0) ||
    (b.right || 0) - (a.right || 0) ||
    String(a.name).localeCompare(String(b.name)));
}

/**
 * What reaches the wallet. The two thousand floats: it is a stake you play
 * with, not a gift you keep, so a flat night banks nothing and a bad one
 * banks nothing rather than costing you. Every dollar that gets out of here
 * was won at the board.
 */
export function bankable(money) {
  return Math.max(0, Math.round((Number(money) || 0) - START_MONEY));
}

// ── the computer players ─────────────────────────────────────────────

/**
 * Two dials describe a computer player completely: how often it knows the
 * answer at all, and how fast it gets to the buzzer when it does. That is
 * enough, because those are the only two things a person at a buzzer is
 * doing either.
 *
 * `buzz` is a reaction time in milliseconds, measured from the moment the
 * buzzers open — the same number a person's thumb produces — so a computer
 * and a person are judged by exactly the same rule with no special case
 * anywhere in the room. A Pro's quickest is around a third of a second,
 * which a sharp human beats often enough for it to be worth trying.
 */
export const AI_LEVELS = [
  { id: "rookie", name: "Rookie", knows: 0.32, gamble: 0.10, buzz: [900, 2600], think: [1200, 3000] },
  { id: "club", name: "Club", knows: 0.58, gamble: 0.16, buzz: [520, 1500], think: [900, 2400] },
  { id: "pro", name: "Pro", knows: 0.80, gamble: 0.22, buzz: [320, 950], think: [600, 1800] },
];

export const AI_MAX = 5;
export const AI_NAMES = ["Marla", "Otto", "Priya", "Sable", "Wexler"];

export function aiLevelById(id) {
  return AI_LEVELS.find((l) => l.id === id) || AI_LEVELS[1];
}

const spread = (range, rnd) => Math.round(range[0] + rnd() * (range[1] - range[0]));

/**
 * What one computer player does with a clue it has just seen.
 *
 * A player who knows it buzzes quickly. A player who does not still buzzes
 * sometimes — that is the gamble, and it is what makes them feel like people
 * rather than a lookup table — but slower, because it took them longer to
 * decide to. Either way the four options are in front of them afterwards,
 * so a gambler is not lost: it is one chance in four, at the price a wrong
 * answer always costs.
 */
export function aiIntent(level, rnd) {
  const l = aiLevelById(level);
  const knows = rnd() < l.knows;
  if (!knows && rnd() > l.gamble) return { buzz: false, knows: false, reaction: null, thinkMs: 0 };
  const reaction = Math.max(MIN_REACTION_MS, spread(l.buzz, rnd) + (knows ? 0 : 400));
  return { buzz: true, knows, reaction, thinkMs: spread(l.think, rnd) };
}

// ── avatars ──────────────────────────────────────────────────────────

/**
 * Ten to choose from, free, picked before the lights go up.
 *
 * This is deliberately not the profile avatar. A family sharing one screen
 * should be able to tell each other apart at a glance without anybody
 * editing their account, and somebody who has spent a fortnight earning a
 * frame should not have to wear it to a quiz.
 */
export const AVATARS = [
  { id: "thinker", name: "The Thinker", ico: "\u{1F914}" },
  { id: "scholar", name: "The Scholar", ico: "\u{1F393}" },
  { id: "oracle", name: "The Oracle", ico: "\u{1F52E}" },
  { id: "speedster", name: "The Speedster", ico: "⚡" },
  { id: "strategist", name: "The Strategist", ico: "♟️" },
  { id: "mastermind", name: "The Mastermind", ico: "\u{1F9E0}" },
  { id: "challenger", name: "The Challenger", ico: "\u{1F94A}" },
  { id: "champion", name: "The Champion", ico: "\u{1F3C6}" },
  { id: "wildcard", name: "The Wildcard", ico: "\u{1F0CF}" },
  { id: "maven", name: "The Maven", ico: "\u{1F989}" },
];

export function avatarById(id) {
  return AVATARS.find((a) => a.id === id) || null;
}

/** The first avatar nobody has taken, for a computer or a late arrival. */
export function freeAvatar(taken) {
  const used = new Set(taken || []);
  return (AVATARS.find((a) => !used.has(a.id)) || AVATARS[0]).id;
}

// ── the set pieces ───────────────────────────────────────────────────

/**
 * How many Daily Doubles are hidden on a board. One in the first round and
 * two in the second, which is the real rule.
 */
export function dailyDoubleCount(round) {
  return Number(round) === 2 ? 2 : 1;
}

/**
 * What a Daily Double may be wagered.
 *
 * The larger of your own money and the top value on the board, so a player
 * who is behind — or under water — can still swing at it. That is the whole
 * function of the rule: it is the one thing on the board that lets somebody
 * out of a hole in a single clue.
 *
 * Deep Pockets doubles the ceiling, which is the only thing in the arsenal
 * that changes an amount of money rather than an amount of information.
 */
export function wagerLimit(money, round, deepPockets = false) {
  const floor = Math.max(Number(money) || 0, topValue(round));
  return deepPockets ? floor * 2 : floor;
}

/**
 * Final is the one clue you may not lose more on than you brought, and the
 * one a player at or below zero sits out — the real rule, and the only door
 * that closing zero actually shuts.
 */
export function finalLimit(money) {
  return Math.max(0, Number(money) || 0);
}

export function playsFinal(p) {
  return !p?.watching && (p?.money || 0) > 0;
}

/**
 * Answers are revealed lowest score first, exactly as the show does it. It
 * puts the person who can still win last, so the game is decided on the final
 * card rather than three cards ago.
 */
export function finalOrder(players) {
  return [...players].sort((a, b) =>
    (a.money || 0) - (b.money || 0) ||
    String(a.name).localeCompare(String(b.name)));
}

/** A seeded pick of where the Daily Doubles hide, so a rebuilt room agrees. */
export function plantDoubles(round, seed) {
  const rnd = rngFrom(seed);
  const cells = [];
  for (let col = 0; col < COLS; col++) {
    // The top row almost never hides one on television, and it is the row
    // people click first, so keeping it clear stops the set piece landing
    // before anybody has settled in.
    for (let row = 1; row < ROWS; row++) cells.push({ col, row });
  }
  return shuffle(cells, rnd).slice(0, dailyDoubleCount(round));
}
