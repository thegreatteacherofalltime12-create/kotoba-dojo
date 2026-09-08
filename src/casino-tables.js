// The three head-to-head tables: Texas Hold'em against the dealer, Face-Up Pai
// Gow Poker, and Criss Cross Poker.
//
// Pure rules, no I/O, so every one of them can be checked directly. They live
// on the server for the same reason the rest do: they pay out real table money.

import { rankFive, compare, value, deck } from "./casino-games.js";

/* ── picking the best five ───────────────────────────────────────────── */

const FIVES = [];
for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++)
  for (let c = b + 1; c < 7; c++) for (let d = c + 1; d < 7; d++)
    for (let e = d + 1; e < 7; e++) FIVES.push([a, b, c, d, e]);

/** The strongest five-card hand inside a larger holding. */
export function bestOfSeven(cards) {
  let best = null, bestCards = null;
  const idx = cards.length === 7
    ? FIVES
    : combinations(cards.length, 5);
  for (const combo of idx) {
    const five = combo.map((i) => cards[i]);
    const r = rankFive(five);
    if (!best || compare(r, best) > 0) { best = r; bestCards = five; }
  }
  return { ...best, cards: bestCards };
}

function combinations(n, k) {
  const out = [], cur = [];
  (function walk(start) {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i < n; i++) { cur.push(i); walk(i + 1); cur.pop(); }
  })(0);
  return out;
}

/** A royal is the top straight flush; the paytables price it separately. */
export const isRoyal = (hand) => hand.rank === 8 && hand.tie[0] === 14;

/* ── Texas Hold'em, against the dealer ───────────────────────────────── */

export const HOLDEM_BUYIN = 5;
export const BET_STEP = 5;

/**
 * Settles a finished hand. Every wager the player made — the buy-in and each
 * street bet — is paid at even money, so a bet on the flop is worth exactly
 * what a bet on the river is.
 */
export function holdemSettle(hole, dealerHole, board, wagers) {
  const mine = bestOfSeven([...hole, ...board]);
  const theirs = bestOfSeven([...dealerHole, ...board]);
  const verdict = compare(mine, theirs);
  const staked = wagers.reduce((a, b) => a + b, 0);
  return {
    mine, theirs, verdict,
    outcome: verdict > 0 ? "win" : verdict < 0 ? "loss" : "push",
    // A win returns the stake and the same again; a push just returns it.
    returned: verdict > 0 ? staked * 2 : verdict === 0 ? staked : 0,
    staked,
  };
}

/* ── Face-Up Pai Gow Poker ───────────────────────────────────────────── */

export const JOKER = { rank: "JOKER", suit: "joker", joker: true };

/** Fifty-two and the joker. */
export function pyGowDeck() {
  return [...deck(1), { ...JOKER }].sort(() => Math.random() - 0.5);
}

/**
 * The joker completes a straight, a flush or a royal, and is an ace the rest
 * of the time. Rather than special-case the evaluator, every substitution is
 * tried and only the ones the rule allows are kept.
 */
export function rankFiveWithJoker(five) {
  const at = five.findIndex((c) => c.joker);
  if (at === -1) return rankFive(five);

  const aceOnly = [...five];
  aceOnly[at] = { rank: "A", suit: "spades", red: false };
  let best = rankFive(aceOnly);

  for (const card of deck(1)) {
    const trial = [...five];
    trial[at] = card;
    const r = rankFive(trial);
    // Only a straight, a flush or a straight flush may use the joker as
    // anything other than an ace.
    if (r.rank !== 4 && r.rank !== 5 && r.rank !== 8) continue;
    if (compare(r, best) > 0) best = r;
  }
  return best;
}

/** Two-card hands are only ever a pair or two high cards. */
export function rankTwo(cards) {
  const vals = cards.map((c) => (c.joker ? 14 : value(c))).sort((a, b) => b - a);
  const pair = vals[0] === vals[1];
  return { rank: pair ? 1 : 0, tie: vals, name: pair ? "pair" : "high card" };
}

function bestFiveOfSeven(seven) {
  let best = null, kept = null;
  for (const combo of FIVES) {
    const five = combo.map((i) => seven[i]);
    const r = rankFiveWithJoker(five);
    if (!best || compare(r, best) > 0) { best = r; kept = combo; }
  }
  return { hand: best, combo: kept };
}

/**
 * The house way, kept deliberately simple and stated as such: of every legal
 * split, take the one with the strongest two-card hand, breaking ties on the
 * five. It is not a casino's full chart, but it is consistent and it is the
 * same rule the dealer and the House Way button both follow.
 */
export function houseWay(seven) {
  let pick = null;
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      const low = [seven[i], seven[j]];
      const high = seven.filter((_, k) => k !== i && k !== j);
      const lowRank = rankTwo(low);
      const highRank = rankFiveWithJoker(high);
      // The five-card hand must outrank the two-card hand, always.
      if (compare(highRank, { rank: lowRank.rank, tie: lowRank.tie }) <= 0) continue;
      const better = !pick
        || compare(lowRank, pick.lowRank) > 0
        || (compare(lowRank, pick.lowRank) === 0 && compare(highRank, pick.highRank) > 0);
      if (better) pick = { low: [i, j], lowRank, highRank, highCards: high, lowCards: low };
    }
  }
  return pick;
}

/** The dealer is forced to play ace-high when their best split is nothing. */
export const playsAceHigh = (split) =>
  split.highRank.rank === 0 && split.highRank.tie[0] === 14 && split.lowRank.rank === 0;

export const ACE_HIGH_BONUS = [
  { id: "both", name: "Dealer & Player Ace-High", pays: 25 },
  { id: "joker", name: "Dealer Ace-High with Joker", pays: 10 },
  { id: "plain", name: "Dealer Ace-High, no Joker", pays: 7 },
];

export const FORTUNE = [
  { id: "sf7", name: "7-card straight flush", pays: 5000 },
  { id: "sf7j", name: "7-card straight flush with joker", pays: 1000 },
  { id: "fiveaces", name: "Five aces", pays: 400 },
  { id: "royal", name: "Royal flush", pays: 150 },
  { id: "sf", name: "Straight flush", pays: 50 },
  { id: "quads", name: "Four of a kind", pays: 25 },
  { id: "boat", name: "Full house", pays: 5 },
  { id: "flush", name: "Flush", pays: 4 },
  { id: "trips", name: "Three of a kind", pays: 3 },
  { id: "straight", name: "Straight", pays: 2 },
];

/** What the fortune side bet makes of a seven-card holding. */
export function fortuneAward(seven) {
  const aces = seven.filter((c) => c.rank === "A").length;
  const joker = seven.some((c) => c.joker);
  if (aces === 4 && joker) return FORTUNE.find((f) => f.id === "fiveaces");

  const all = rankFive(seven.slice(0, 5));   // placeholder, replaced below
  const sevenStraightFlush = isSevenStraightFlush(seven);
  if (sevenStraightFlush) return FORTUNE.find((f) => f.id === (joker ? "sf7j" : "sf7"));

  const { hand } = bestFiveOfSeven(seven);
  if (isRoyal(hand)) return FORTUNE.find((f) => f.id === "royal");
  const byRank = { 8: "sf", 7: "quads", 6: "boat", 5: "flush", 4: "straight", 3: "trips" };
  const id = byRank[hand.rank];
  void all;
  return id ? FORTUNE.find((f) => f.id === id) : null;
}

function isSevenStraightFlush(seven) {
  const jokers = seven.filter((c) => c.joker).length;
  const real = seven.filter((c) => !c.joker);
  const suits = new Set(real.map((c) => c.suit));
  if (suits.size !== 1) return false;
  const vals = [...new Set(real.map(value))].sort((a, b) => a - b);
  if (vals.length + jokers < 7) return false;
  // One run of seven, with the joker allowed to plug a single gap.
  for (let start = 0; start <= vals.length - 1; start++) {
    let gaps = 0, span = 1;
    for (let i = start + 1; i < vals.length; i++) {
      const step = vals[i] - vals[i - 1];
      if (step === 1) span++;
      else if (step === 2 && gaps < jokers) { gaps++; span += 2; }
      else break;
    }
    if (span >= 7) return true;
  }
  return false;
}

/** Head to head on both hands. Copies go to the dealer. */
export function paiGowSettle(playerSplit, dealerSplit) {
  if (playsAceHigh(dealerSplit)) return { outcome: "push", why: "the dealer played ace-high" };
  const high = compare(playerSplit.highRank, dealerSplit.highRank);
  const low = compare(playerSplit.lowRank, dealerSplit.lowRank);
  // A copy is a tie, and a tie belongs to the house.
  const wonHigh = high > 0, wonLow = low > 0;
  if (wonHigh && wonLow) return { outcome: "win", why: "both hands" };
  if (!wonHigh && !wonLow) return { outcome: "loss", why: "the dealer took both" };
  return { outcome: "push", why: "one hand each" };
}

/* ── Criss Cross Poker ───────────────────────────────────────────────── */

// Across pays on the horizontal arm, Down on the vertical. The middle card
// belongs to both, which is what makes it a cross rather than two hands.
export const CROSS_PAYS = [
  { id: "royal", name: "Royal flush", pays: 500 },
  { id: "sf", name: "Straight flush", pays: 100 },
  { id: "quads", name: "Four of a kind", pays: 40 },
  { id: "boat", name: "Full house", pays: 12 },
  { id: "flush", name: "Flush", pays: 8 },
  { id: "straight", name: "Straight", pays: 5 },
  { id: "trips", name: "Three of a kind", pays: 3 },
  { id: "twopair", name: "Two pair", pays: 2 },
  { id: "jacks", name: "Jacks or better", pays: 1 },
];

export const BONUS_PAYS = [
  { id: "royal", name: "Royal flush", pays: 250 },
  { id: "sf", name: "Straight flush", pays: 100 },
  { id: "quads", name: "Four of a kind", pays: 40 },
  { id: "boat", name: "Full house", pays: 15 },
  { id: "flush", name: "Flush", pays: 10 },
  { id: "straight", name: "Straight", pays: 6 },
  { id: "trips", name: "Three of a kind", pays: 4 },
  { id: "twopair", name: "Two pair", pays: 3 },
  { id: "sixes", name: "Sixes or better", pays: 1 },
];

/**
 * Where a five-card hand lands on a cross paytable.
 * @param {number} floorRank the lowest pair that pays — 11 for jacks, 6 for sixes
 */
export function crossRow(hand, table, floorRank) {
  if (isRoyal(hand)) return table.find((r) => r.id === "royal");
  const byRank = { 8: "sf", 7: "quads", 6: "boat", 5: "flush", 4: "straight", 3: "trips", 2: "twopair" };
  const id = byRank[hand.rank];
  if (id) return table.find((r) => r.id === id);
  if (hand.rank === 1 && hand.tie[0] >= floorRank) return table[table.length - 1];
  return null;
}

/** A pair from sixes to tens is the push band on the antes and line bets. */
export const isPushBand = (hand) => hand.rank === 1 && hand.tie[0] >= 6 && hand.tie[0] <= 10;

/**
 * Settles one arm of the cross.
 * @returns {{paid:number, row:object|null, push:boolean}} paid is what comes
 *   back for a stake of one, so 0 is a loss and 1 is a push.
 */
export function crossLine(hand, ante, bet) {
  const row = crossRow(hand, CROSS_PAYS, 11);
  if (row) return { paid: ante * 2 + bet + bet * row.pays, row, push: false };
  if (isPushBand(hand)) return { paid: ante + bet, row: null, push: true };
  return { paid: 0, row: null, push: false };
}

/* ── the dealer's temperament ────────────────────────────────────────── */

/**
 * How good the dealer's hand actually is, 0 to 1.
 *
 * Rank carries most of it, with the top card breaking ties inside a rank so
 * ace-high is worth more than seven-high.
 */
export function strengthOf(hole, board) {
  const cards = [...hole, ...board];
  const hand = cards.length >= 5 ? bestOfSeven(cards) : rankFive([...cards, ...cards].slice(0, 5));
  const base = hand.rank / 8;
  const kicker = ((hand.tie?.[0] || 2) - 2) / 12;
  return Math.min(1, base * 0.86 + kicker * 0.14);
}

/**
 * Easy, Medium and Hard describe how the dealer *bets*, not what it is dealt.
 * Its cards are always dealt at random from a fair deck.
 *
 * - bluff:  how often it bets a hand it knows is losing
 * - value:  the strength at which it starts betting honestly
 * - fold:   the strength below which it gives up to your bet
 * - raise:  how often a good hand comes back over the top of you
 */
export const AI_LEVELS = [
  { id: "easy", name: "Easy", bluff: 0.05, value: 0.58, fold: 0.38, raise: 0.10, learns: 0 },
  { id: "medium", name: "Medium", bluff: 0.16, value: 0.44, fold: 0.26, raise: 0.25, learns: 0.5 },
  { id: "hard", name: "Hard", bluff: 0.32, value: 0.34, fold: 0.15, raise: 0.42, learns: 1 },
];

export const levelById = (id) => AI_LEVELS.find((l) => l.id === id) || AI_LEVELS[1];

/**
 * What the dealer does, having seen what you just did.
 *
 * The learned part is one number: how often you bet rather than check. Bet at
 * everything and the dealer stops believing you — it folds less and comes back
 * over the top more. Check at everything and it starts betting into you with
 * nothing, because you have shown you will not punish it. Easy barely adjusts,
 * Hard adjusts fully.
 *
 * @param {number} strength   0-1, the dealer's own hand
 * @param {number} facing     what the player just bet, 0 if they checked
 * @param {object} memory     { hands, bets } from this player's history
 * @param {function} rng      injectable for tests
 */
export function dealerAct(strength, facing, level, memory, rng = Math.random) {
  const L = levelById(level);
  const hands = Math.max(1, memory?.hands || 0);
  // Roughly how often the player bets a street, 0 to 1.
  const pushy = Math.min(1, (memory?.bets || 0) / (hands * 3));
  const tilt = (pushy - 0.4) * L.learns;      // positive when the player is aggressive

  const bluffing = rng() < Math.max(0, L.bluff + tilt * 0.25);

  if (facing > 0) {
    // Facing a bet: give up, call, or come back over the top.
    const foldBelow = Math.max(0, L.fold - tilt * 0.18);
    if (strength < foldBelow && !bluffing) return { move: "fold" };
    if (strength > 0.72 && rng() < L.raise + tilt * 0.2)
      return { move: "raise", amount: facing * 2 };
    if (strength < foldBelow) return { move: "call", bluffing: true };
    return { move: "call" };
  }

  // Checked to: bet for value, bet as a bluff, or check behind.
  if (strength >= L.value) return { move: "bet", amount: 0, why: "value" };
  if (bluffing) return { move: "bet", amount: 0, why: "bluff" };
  return { move: "check" };
}
