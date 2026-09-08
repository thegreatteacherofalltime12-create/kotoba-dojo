// Every rule the casino floor runs on. No I/O, so it can be tested directly,
// and it lives on the server because the floor is now shared: one race, one
// bet board, one dealer, many people watching the same thing happen.

// Still the four suits, for the cards the blackjack table deals. The race no
// longer runs on suits; it has its own field, below.
export const SUITS = [
  { id: "hearts", name: "Hearts", pip: "\u2665", red: true },
  { id: "diamonds", name: "Diamonds", pip: "\u2666", red: true },
  { id: "clubs", name: "Clubs", pip: "\u2663", red: false },
  { id: "spades", name: "Spades", pip: "\u2660", red: false },
];
export const suitById = (id) => SUITS.find((s) => s.id === id);

export const START_TABLE = 100;   // what a new arrival is staked
export const MAX_SEATS = 20;      // per live table

/* ── the deck ────────────────────────────────────────────────────────── */

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function shuffled(decks = 1) {
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const s of SUITS) for (const r of RANKS) cards.push({ rank: r, suit: s.id, red: s.red });
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/* ── the race ────────────────────────────────────────────────────────── */

/**
 * Seven runners, one for each spade from the king down to the seven. The pips
 * are drawn red rather than black — the track's own colours, not the deck's.
 */
export const HORSES = [
  { id: "king", rank: "K", name: "King of Spades" },
  { id: "queen", rank: "Q", name: "Queen of Spades" },
  { id: "jack", rank: "J", name: "Jack of Spades" },
  { id: "ten", rank: "10", name: "Ten of Spades" },
  { id: "nine", rank: "9", name: "Nine of Spades" },
  { id: "eight", rank: "8", name: "Eight of Spades" },
  { id: "seven", rank: "7", name: "Seven of Spades" },
].map((h) => ({ ...h, pip: "\u2660", red: true }));

export const horseById = (id) => HORSES.find((h) => h.id === id);

export const FINISH = 7;      // steps to the line
export const HURDLES = 5;     // knock-backs along the track
export const TICK_MS = 1500;

/* ── the favourite of the day ────────────────────────────────────────── */

const DAY_MS = 86_400_000;

/**
 * A shuffle you can work out rather than remember.
 *
 * The favourite has to be the same for everyone, and has to keep rotating
 * whether or not anybody is on the floor — so nothing schedules it and nothing
 * stores it. It is derived from the date, which means any machine asking on any
 * day gets the same answer, including after the object has slept for a week.
 */
function seededOrder(n, seed) {
  const idx = [...Array(n).keys()];
  let x = ((seed * 2654435761) % 2147483647) || 1;
  const rnd = () => { x = (x * 48271) % 2147483647; return x / 2147483647; };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/**
 * Which runner carries the ribbon today.
 *
 * The seven days of a cycle use one shuffled order, so every horse is
 * favourite exactly once before any of them is favourite twice.
 */
export function favouriteFor(now = Date.now()) {
  const day = Math.floor(now / DAY_MS);
  const cycle = Math.floor(day / HORSES.length);
  const slot = day % HORSES.length;
  return HORSES[seededOrder(HORSES.length, cycle + 1)[slot]].id;
}

/** When today's favourite gives way to tomorrow's. */
export const favouriteEndsAt = (now = Date.now()) =>
  (Math.floor(now / DAY_MS) + 1) * DAY_MS;

/**
 * How often the favourite is the one that moves.
 *
 * Tuned by simulation rather than guessed: with the hurdles knocking runners
 * back, this is the share of ticks that lands it at roughly four wins in five.
 */
export const FAVOURITE_STEP = 0.297;

/**
 * What a slip pays.
 *
 * A horse that wins four races in five cannot pay what an outsider pays, and
 * an outsider that wins one race in thirty cannot pay what it did when there
 * were four runners and no favourite. Every price here was measured by
 * simulating the race a hundred thousand times and taking roughly a tenth off
 * the fair price as the house's cut.
 *
 * Two prices are generous by choice rather than by measurement. 1st-or-2nd on
 * the field and Short both pay well over the odds, because the house losing
 * money on them is deliberate. The favourite is still priced short to place —
 * paying a 93% chance at those odds would leave nothing else on the board
 * worth betting.
 *
 * The long shots are capped rather than paid true. An exacta between two
 * outsiders is a 1-in-440 chance and would fairly pay near four hundred to
 * one; a single lucky slip at that price would empty the floor. The cap is a
 * house decision, not a calculation.
 */
const PRICES = {
  //            favourite on the slip | field only
  place:      { fav: 0.05, field: 4 },
  win:        { fav: 0.22, field: 20 },
  exacta:     { fav: 5,    field: 150 },
  trifecta:   { fav: 28,   field: 400 },
  superfecta: { fav: 110,  field: 1000 },
  long:       { fav: 1,    field: 100 },
  short:      { fav: 50,   field: 50 },
};

export function oddsFor(betType, picks, favourite) {
  const row = PRICES[betType];
  if (!row) return 0;
  return (picks || []).includes(favourite) ? row.fav : row.field;
}

export const BETS = [
  { id: "place", name: "1st or 2nd", pays: 3.5, picks: 1, blurb: "Your horse finishes in the top two." },
  { id: "win", name: "First Place", pays: 20, picks: 1, blurb: "Your horse wins outright." },
  { id: "exacta", name: "1st, 2nd - Exact Order", pays: 150, picks: 2, blurb: "Both, in the order you name them." },
  { id: "trifecta", name: "Top 3 - Exact", pays: 400, picks: 3, blurb: "The first three, in order." },
  { id: "superfecta", name: "Top 4 - Exact", pays: 1000, picks: 4, blurb: "The first four, in order." },
  // Borrowed from the market: one bets on a horse running away with it, the
  // other on it collapsing. Both need a margin, which is why they pay 50.
  { id: "long", name: "Long", pays: 50, picks: 1, side: true,
    blurb: "Wins by three clear steps over the runner-up." },
  { id: "short", name: "Short", pays: 50, picks: 1, side: true,
    blurb: "Finishes last, three clear steps behind the one in front." },
];
// The board carries both prices, so the client can show what a slip is worth
// before the money goes down.
for (const b of BETS) {
  b.pays = PRICES[b.id].field;
  b.favPays = PRICES[b.id].fav;
}

export const betById = (id) => BETS.find((b) => b.id === id);

export function freshRace(now = Date.now()) {
  return {
    at: Object.fromEntries(HORSES.map((h) => [h.id, 0])),
    hurdles: [],          // { at, horse } — which runner it knocked back
    finished: [],
    leadMargin: 0,        // the winner's lead as it crossed
    favourite: favouriteFor(now),
    last: null,
  };
}

/**
 * One turn. A runner moves, and once the whole field is past a hurdle that
 * hurdle turns over and knocks somebody back a step.
 */
export function raceTick(race, rng = Math.random) {
  if (race.finished.length >= 4) return { done: true };

  const running = HORSES.map((h) => h.id).filter((id) => !race.finished.includes(id));
  const fav = race.favourite;
  let moved;
  if (running.includes(fav) && rng() < FAVOURITE_STEP) moved = fav;
  else {
    const rest = running.filter((id) => id !== fav);
    const pool = rest.length ? rest : running;
    moved = pool[Math.floor(rng() * pool.length)];
  }

  race.at[moved] += 1;
  race.last = moved;
  const out = { done: false, moved };

  if (race.at[moved] >= FINISH) {
    // How far back the field was as the leader crossed. Everyone who finishes
    // stops on the line, so comparing final positions always reads zero —
    // which is why the Long bet could never come in. This is the real margin.
    if (!race.finished.length) {
      const chasing = HORSES.map((h) => h.id).filter((id) => id !== moved);
      race.leadMargin = FINISH - Math.max(...chasing.map((id) => race.at[id]));
    }
    race.finished.push(moved);
    out.crossed = moved;
  }

  const behind = Math.min(...HORSES.map((h) => race.at[h.id]));
  const next = race.hurdles.length + 1;
  if (next <= HURDLES && behind > next) {
    const pool = HORSES.map((h) => h.id).filter((id) => !race.finished.includes(id) && race.at[id] > 0);
    if (pool.length) {
      const hit = pool[Math.floor(rng() * pool.length)];
      race.hurdles.push({ at: next, horse: hit, rank: horseById(hit).rank });
      race.at[hit] -= 1;
      out.hurdle = race.hurdles[race.hurdles.length - 1];
    }
  }

  if (race.finished.length >= 4) out.done = true;
  return out;
}

/** Final placings: those that crossed, then the rest by distance covered. */
export function placings(race) {
  const rest = HORSES.map((h) => h.id)
    .filter((id) => !race.finished.includes(id))
    .sort((a, b) => race.at[b] - race.at[a]);
  return [...race.finished, ...rest];
}

/**
 * Does a slip come in?
 * @param {object} race  the finished race, for the margins the side bets need
 */
export function betWins(type, picks, order, race) {
  const bet = betById(type);
  if (!bet || picks.length !== bet.picks) return false;

  if (type === "place") return order.slice(0, 2).includes(picks[0]);
  if (type === "win") return order[0] === picks[0];

  if (type === "long") {
    if (order[0] !== picks[0]) return false;
    return (race.leadMargin || 0) >= 3;
  }
  if (type === "short") {
    const last = order[order.length - 1];
    if (last !== picks[0]) return false;
    return (race.at[order[order.length - 2]] - race.at[last]) >= 3;
  }

  return picks.every((p, i) => order[i] === p);
}

/* ── blackjack ───────────────────────────────────────────────────────── */

export function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c.rank === "A") { aces++; total += 11; }
    else if (["K", "Q", "J", "10"].includes(c.rank)) total += 10;
    else total += Number(c.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0, bust: total > 21 };
}

export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

/** The dealer draws while under seventeen, and on a soft seventeen. */
export function dealerShouldHit(cards) {
  const { total, soft } = handValue(cards);
  return total < 17 || (total === 17 && soft);
}

/**
 * Settles one seat. Losing costs the bet and a token; winning pays even money
 * and costs no token; a push returns the bet and costs no token.
 */
export function settle(player, dealer) {
  const p = handValue(player), d = handValue(dealer);
  if (p.bust) return { result: "lose", token: -1, why: "bust" };
  if (d.bust) return { result: "win", token: 0, why: "dealer bust" };

  const pbj = isBlackjack(player), dbj = isBlackjack(dealer);
  if (pbj && dbj) return { result: "push", token: 0, why: "both blackjack" };
  if (pbj) return { result: "win", token: 0, why: "blackjack" };
  if (dbj) return { result: "lose", token: -1, why: "dealer blackjack" };

  if (p.total > d.total) return { result: "win", token: 0, why: `${p.total} beats ${d.total}` };
  if (p.total < d.total) return { result: "lose", token: -1, why: `${d.total} beats ${p.total}` };
  return { result: "push", token: 0, why: `both ${p.total}` };
}
