// Every rule the casino runs on, with no I/O so it can be tested directly.
//
// One deliberate decision underlies all of it: the casino is a side economy
// and pays no MMR. Cash and tokens are earned and spent here and nowhere
// else. That keeps it honest without a server refereeing every hand — there
// is nothing to gain by cheating, because nothing here touches the ladder.

export const SUITS = [
  { id: "hearts", name: "Hearts", pip: "\u2665", red: true },
  { id: "diamonds", name: "Diamonds", pip: "\u2666", red: true },
  { id: "clubs", name: "Clubs", pip: "\u2663", red: false },
  { id: "spades", name: "Spades", pip: "\u2660", red: false },
];

export const START_CASH = 100;
export const START_TOKENS = 0;
export const UNLOCK_CASH = 50;
export const UNLOCK_TOKENS = 2;

/* ── the math arcade ─────────────────────────────────────────────────── */

export const PUZZLE_COOLDOWN_MS = 10_000;

/** A first-grade sum. Subtraction never goes below zero. */
export function makePuzzle() {
  const add = Math.random() < 0.6;
  if (add) {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    return { text: `${a} + ${b}`, answer: a + b };
  }
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 1 + Math.floor(Math.random() * a);
  return { text: `${a} \u2212 ${b}`, answer: a - b };
}

export const puzzleReward = () => 5 + Math.floor(Math.random() * 11); // $5–15

/* ── blackjack ───────────────────────────────────────────────────────── */

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function freshShoe(decks = 4) {
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

/**
 * A hand's value, and whether an ace is still counting as eleven.
 * Soft matters because the dealer must hit soft seventeen.
 */
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

/** Dealer draws while under seventeen, and on a soft seventeen. */
export function dealerShouldHit(cards) {
  const { total, soft } = handValue(cards);
  return total < 17 || (total === 17 && soft);
}

/**
 * Settles a hand.
 * Losing costs the bet and one token; winning pays even money and costs no
 * token; a push returns the bet and costs no token.
 */
export function settle(player, dealer) {
  const p = handValue(player), d = handValue(dealer);
  if (p.bust) return { result: "lose", cash: -1, token: -1, why: "You went bust." };
  if (d.bust) return { result: "win", cash: 1, token: 0, why: "Dealer went bust." };

  const pbj = isBlackjack(player), dbj = isBlackjack(dealer);
  if (pbj && dbj) return { result: "push", cash: 0, token: 0, why: "Both blackjack." };
  if (pbj) return { result: "win", cash: 1, token: 0, why: "Blackjack." };
  if (dbj) return { result: "lose", cash: -1, token: -1, why: "Dealer had blackjack." };

  if (p.total > d.total) return { result: "win", cash: 1, token: 0, why: `${p.total} beats ${d.total}.` };
  if (p.total < d.total) return { result: "lose", cash: -1, token: -1, why: `${d.total} beats ${p.total}.` };
  return { result: "push", cash: 0, token: 0, why: `Both ${p.total}.` };
}

/* ── the horse race ──────────────────────────────────────────────────── */

export const FINISH = 8;        // steps to the line
export const SIDELINE = 7;      // face-down cards along the track
export const TICK_MS = 1500;

export const BETS = [
  { id: "place", name: "1st or 2nd place", pays: 1, picks: 1, blurb: "Your horse finishes in the top two." },
  { id: "win", name: "First place", pays: 3, picks: 1, blurb: "Your horse wins outright." },
  { id: "exacta", name: "1st and 2nd, exact order", pays: 6, picks: 2, blurb: "Both, in the order you name them." },
  { id: "trifecta", name: "Top three, exact", pays: 12, picks: 3, blurb: "The first three, in order." },
  { id: "superfecta", name: "1st through 4th, exact", pays: 24, picks: 4, blurb: "The whole field, in order." },
];

export function freshRace() {
  return {
    at: Object.fromEntries(SUITS.map((s) => [s.id, 0])),
    flipped: [],                 // sideline positions already turned over
    finished: [],                // suit ids, in the order they crossed
    deck: freshShoe(1).filter((c) => c.rank !== "A"),
    log: [],
  };
}

/**
 * One turn of the race. A card is drawn and its suit advances; once every
 * horse has passed a sideline position, that card turns over and knocks its
 * own suit back a step.
 *
 * @returns {{done: boolean, drew?: object, flip?: object, crossed?: string}}
 */
export function raceTick(race) {
  if (race.finished.length >= 3) return { done: true };
  if (!race.deck.length) race.deck = freshShoe(1).filter((c) => c.rank !== "A");

  const card = race.deck.pop();
  const out = { done: false, drew: card };

  if (!race.finished.includes(card.suit)) {
    race.at[card.suit] += 1;
    if (race.at[card.suit] >= FINISH) {
      race.finished.push(card.suit);
      out.crossed = card.suit;
    }
  }

  // The sideline only turns when the whole field is past it.
  const behind = Math.min(...SUITS.map((s) => race.at[s.id]));
  const next = race.flipped.length + 1;
  if (next <= SIDELINE && behind > next) {
    const flip = race.deck.pop() || { rank: "2", suit: SUITS[0].id, red: true };
    race.flipped.push(next);
    if (!race.finished.includes(flip.suit) && race.at[flip.suit] > 0) race.at[flip.suit] -= 1;
    out.flip = { at: next, card: flip };
  }

  if (race.finished.length >= 3) out.done = true;
  return out;
}

/** Final placings: those that crossed, then the rest by distance covered. */
export function placings(race) {
  const rest = SUITS.map((s) => s.id)
    .filter((id) => !race.finished.includes(id))
    .sort((a, b) => race.at[b] - race.at[a]);
  return [...race.finished, ...rest];
}

/**
 * Does a bet come in?
 * @param {string} type   one of BETS
 * @param {string[]} picks  suit ids, in the order the player named them
 */
export function betWins(type, picks, order) {
  const bet = BETS.find((b) => b.id === type);
  if (!bet || picks.length !== bet.picks) return false;
  if (type === "place") return order.slice(0, 2).includes(picks[0]);
  if (type === "win") return order[0] === picks[0];
  return picks.every((p, i) => order[i] === p);
}

export const betPayout = (type) => BETS.find((b) => b.id === type)?.pays || 0;
