// Every rule the card room runs on.
//
// No I/O and no state, so each of these can be checked directly, and all of it
// lives on the server because these games pay out real table money. A browser
// that could decide whether its own bet won could decide it always did.
//
// Each game exposes the bets it offers and a resolve() that takes the stakes
// and returns what happened plus what is owed. Nothing here touches a player.

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = [
  { id: "hearts", pip: "\u2665", red: true },
  { id: "diamonds", pip: "\u2666", red: true },
  { id: "clubs", pip: "\u2663", red: false },
  { id: "spades", pip: "\u2660", red: false },
];

export function deck(count = 1) {
  const out = [];
  for (let d = 0; d < count; d++)
    for (const s of SUITS) for (const r of RANKS) out.push({ rank: r, suit: s.id, red: s.red });
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 2..14, aces high. */
export const value = (card) => RANKS.indexOf(card.rank) + 2;

/* ── poker hands ─────────────────────────────────────────────────────── */

export const HAND_NAMES = [
  "high card", "pair", "two pair", "three of a kind", "straight",
  "flush", "full house", "four of a kind", "straight flush",
];

/**
 * Ranks a five-card hand.
 * @returns {{rank:number, tie:number[], name:string}} higher rank always wins;
 *   `tie` breaks ties from most to least significant.
 */
export function rankFive(cards) {
  const vals = cards.map(value).sort((a, b) => b - a);
  const bySuit = {};
  for (const c of cards) bySuit[c.suit] = (bySuit[c.suit] || 0) + 1;
  const flush = Object.values(bySuit).some((n) => n === 5);

  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  // Sort by how many, then by rank, so the tiebreak reads naturally.
  const groups = Object.entries(counts)
    .map(([v, n]) => ({ v: Number(v), n }))
    .sort((a, b) => b.n - a.n || b.v - a.v);

  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    // The wheel: A-2-3-4-5, where the ace plays low and the five is the top.
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5;
  }

  const tie = groups.flatMap((g) => Array(g.n).fill(g.v));
  if (straightHigh && flush) return { rank: 8, tie: [straightHigh], name: "straight flush" };
  if (groups[0].n === 4) return { rank: 7, tie, name: "four of a kind" };
  if (groups[0].n === 3 && groups[1]?.n === 2) return { rank: 6, tie, name: "full house" };
  if (flush) return { rank: 5, tie: vals, name: "flush" };
  if (straightHigh) return { rank: 4, tie: [straightHigh], name: "straight" };
  if (groups[0].n === 3) return { rank: 3, tie, name: "three of a kind" };
  if (groups[0].n === 2 && groups[1]?.n === 2) return { rank: 2, tie, name: "two pair" };
  if (groups[0].n === 2) return { rank: 1, tie, name: "pair" };
  return { rank: 0, tie: vals, name: "high card" };
}

/**
 * Ranks a three-card hand. Three-card poker reorders the middle of the chart:
 * a straight is harder to make than a flush with only three cards, so it beats
 * one. Ranks are kept on their own scale to avoid any confusion with rankFive.
 */
export function rankThree(cards) {
  const vals = cards.map(value).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const uniq = [...new Set(vals)];
  const straight = uniq.length === 3 &&
    (vals[0] - vals[2] === 2 || (vals[0] === 14 && vals[1] === 3 && vals[2] === 2));
  const high = (vals[0] === 14 && vals[1] === 3 && vals[2] === 2) ? 3 : vals[0];

  if (uniq.length === 1) return { rank: 5, tie: vals, name: "three of a kind" };
  if (straight && flush) return { rank: 6, tie: [high], name: "straight flush" };
  if (straight) return { rank: 4, tie: [high], name: "straight" };
  if (flush) return { rank: 3, tie: vals, name: "flush" };
  if (uniq.length === 2) {
    const pair = vals.find((v) => vals.filter((x) => x === v).length === 2);
    return { rank: 1, tie: [pair, vals.find((v) => v !== pair)], name: "pair" };
  }
  return { rank: 0, tie: vals, name: "high card" };
}

/** 1 if a beats b, -1 if b beats a, 0 for a genuine tie. */
export function compare(a, b) {
  if (a.rank !== b.rank) return a.rank > b.rank ? 1 : -1;
  for (let i = 0; i < Math.max(a.tie.length, b.tie.length); i++) {
    const x = a.tie[i] ?? 0, y = b.tie[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/* ── American roulette ───────────────────────────────────────────────── */

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
// 0 and 00 are the house's edge; 00 is held as 37 and shown as "00".
export const ROULETTE_POCKETS = 38;

export const ROULETTE_BETS = [
  { id: "straight", name: "Single number", pays: 35, pick: "number" },
  { id: "red", name: "Red", pays: 1 },
  { id: "black", name: "Black", pays: 1 },
  { id: "odd", name: "Odd", pays: 1 },
  { id: "even", name: "Even", pays: 1 },
  { id: "low", name: "1 to 18", pays: 1 },
  { id: "high", name: "19 to 36", pays: 1 },
  { id: "dozen1", name: "1st dozen (1-12)", pays: 2 },
  { id: "dozen2", name: "2nd dozen (13-24)", pays: 2 },
  { id: "dozen3", name: "3rd dozen (25-36)", pays: 2 },
  { id: "col1", name: "Column 1", pays: 2 },
  { id: "col2", name: "Column 2", pays: 2 },
  { id: "col3", name: "Column 3", pays: 2 },
];

export const pocketName = (n) => (n === 37 ? "00" : String(n));

export function rouletteWins(bet, pick, n) {
  if (n === 0 || n === 37) return bet === "straight" && Number(pick) === n;
  switch (bet) {
    case "straight": return Number(pick) === n;
    case "red": return RED.has(n);
    case "black": return !RED.has(n);
    case "odd": return n % 2 === 1;
    case "even": return n % 2 === 0;
    case "low": return n >= 1 && n <= 18;
    case "high": return n >= 19 && n <= 36;
    case "dozen1": return n <= 12;
    case "dozen2": return n >= 13 && n <= 24;
    case "dozen3": return n >= 25;
    case "col1": return n % 3 === 1;
    case "col2": return n % 3 === 2;
    case "col3": return n % 3 === 0;
    default: return false;
  }
}

/* ── the big six wheel ───────────────────────────────────────────────── */

// 54 sections, in the standard distribution.
export const BIGSIX = [
  { id: "1", name: "1", pays: 1, sections: 23 },
  { id: "2", name: "2", pays: 2, sections: 15 },
  { id: "5", name: "5", pays: 5, sections: 8 },
  { id: "10", name: "10", pays: 10, sections: 4 },
  { id: "20", name: "20", pays: 20, sections: 2 },
  { id: "star", name: "\u2605", pays: 40, sections: 1 },
  { id: "diamond", name: "\u25C6", pays: 45, sections: 1 },
];

export function spinBigSix() {
  const wheel = BIGSIX.flatMap((s) => Array(s.sections).fill(s.id));
  return wheel[Math.floor(Math.random() * wheel.length)];
}

/* ── baccarat ────────────────────────────────────────────────────────── */

/** Aces one, tens and faces nothing, and only the last digit counts. */
export const baccaratValue = (cards) =>
  cards.reduce((t, c) => t + (c.rank === "A" ? 1 : ["10", "J", "Q", "K"].includes(c.rank) ? 0 : Number(c.rank)), 0) % 10;

/**
 * Deals a coup by the book: two each, then the player's draw, then the
 * banker's, which depends on what the player drew.
 */
export function baccaratCoup(shoe) {
  const player = [shoe.pop(), shoe.pop()];
  const banker = [shoe.pop(), shoe.pop()];

  const natural = baccaratValue(player) >= 8 || baccaratValue(banker) >= 8;
  if (!natural) {
    let third = null;
    if (baccaratValue(player) <= 5) { third = shoe.pop(); player.push(third); }

    const b = baccaratValue(banker);
    let draws;
    if (third === null) draws = b <= 5;                       // player stood
    else {
      const t = value(third) === 14 ? 1 : Math.min(value(third), 10) % 10;
      if (b <= 2) draws = true;
      else if (b === 3) draws = t !== 8;
      else if (b === 4) draws = t >= 2 && t <= 7;
      else if (b === 5) draws = t >= 4 && t <= 7;
      else if (b === 6) draws = t === 6 || t === 7;
      else draws = false;
    }
    if (draws) banker.push(shoe.pop());
  }

  const p = baccaratValue(player), bk = baccaratValue(banker);
  const playerPair = player[0].rank === player[1].rank;
  const bankerPair = banker[0].rank === banker[1].rank;
  return {
    player, banker, playerTotal: p, bankerTotal: bk,
    outcome: p > bk ? "player" : bk > p ? "banker" : "tie",
    playerPair, bankerPair,
    // Both hands paired on the same rank is a twin pair, which is the rarest
    // thing on the board and priced accordingly.
    twinPair: playerPair && bankerPair && player[0].rank === banker[0].rank,
    bankerCards: banker.length,
    lucky7: p === 7 ? player.length : 0,
  };
}

/**
 * Every bet on the baccarat board and what it returns, expressed as odds to
 * one. "9 for 1" on the felt means eight to one plus your stake back, which is
 * how these are written.
 */
export const BACCARAT_BOARD = [
  { id: "player", name: "Player", odds: "1 to 1", tone: "blue" },
  { id: "banker", name: "Banker", odds: "1 to 1 \u00b7 -5%", tone: "red" },
  { id: "tie", name: "Tie", odds: "9 for 1", tone: "green" },
  { id: "pairs", name: "Pairs", odds: "12 for 1", tone: "violet" },
  { id: "tiger", name: "Tiger", odds: "12 / 20 to 1", tone: "amber", side: true },
  { id: "smalltiger", name: "Small Tiger", odds: "22 to 1", tone: "amber", side: true },
  { id: "bigtiger", name: "Big Tiger", odds: "50 to 1", tone: "violet", side: true },
  { id: "tigerpair", name: "Tiger Pair", odds: "4 / 20 / 100 to 1", tone: "rose", side: true },
  { id: "lucky7", name: "Lucky 7", odds: "6 / 15 to 1", tone: "gold", side: true },
];

/**
 * Settles a whole board at once.
 *
 * @param {object} coup   the dealt hands
 * @param {object} bets   { betId: amount }
 * @returns {{returns: object, total: number}} what comes back per bet, stake
 *   included, so a push returns exactly what went on.
 */
export function baccaratSettle(coup, bets) {
  const out = {};
  const tigerBanker = coup.outcome === "banker" && coup.bankerTotal === 6;

  for (const [id, amount] of Object.entries(bets)) {
    const bet = Math.max(0, Math.round(Number(amount) || 0));
    if (!bet) continue;
    let back = 0;

    switch (id) {
      case "player":
        back = coup.outcome === "player" ? bet * 2 : coup.outcome === "tie" ? bet : 0;
        break;
      case "banker":
        // The commission comes off the winnings, not the stake.
        back = coup.outcome === "banker" ? bet + Math.floor(bet * 0.95)
          : coup.outcome === "tie" ? bet : 0;
        break;
      case "tie":
        back = coup.outcome === "tie" ? bet + bet * 8 : 0;
        break;
      case "pairs":
        back = (coup.playerPair || coup.bankerPair) ? bet + bet * 11 : 0;
        break;
      case "tiger":
        back = tigerBanker ? bet + bet * (coup.bankerCards === 2 ? 12 : 20) : 0;
        break;
      case "smalltiger":
        back = tigerBanker && coup.bankerCards === 2 ? bet + bet * 22 : 0;
        break;
      case "bigtiger":
        back = tigerBanker && coup.bankerCards === 3 ? bet + bet * 50 : 0;
        break;
      case "tigerpair": {
        const odds = coup.twinPair ? 100
          : (coup.playerPair && coup.bankerPair) ? 20
          : (coup.playerPair || coup.bankerPair) ? 4 : 0;
        back = odds ? bet + bet * odds : 0;
        break;
      }
      case "lucky7":
        back = coup.lucky7 ? bet + bet * (coup.lucky7 === 2 ? 6 : 15) : 0;
        break;
      default:
        back = 0;
    }
    out[id] = back;
  }
  return { returns: out, total: Object.values(out).reduce((a, b) => a + b, 0) };
}

export const BACCARAT_BETS = [
  { id: "player", name: "Player", pays: 1 },
  { id: "banker", name: "Banker (5% commission)", pays: 1 },
  { id: "tie", name: "Tie", pays: 8 },
  { id: "ppair", name: "Player pair", pays: 11 },
  { id: "bpair", name: "Banker pair", pays: 11 },
  { id: "lucky7", name: "Lucky 7 (Player totals 7)", pays: 5 },
];

/* ── three-card poker ────────────────────────────────────────────────── */

export const PAIR_PLUS = [
  { rank: 6, name: "straight flush", pays: 40 },
  { rank: 5, name: "three of a kind", pays: 30 },
  { rank: 4, name: "straight", pays: 6 },
  { rank: 3, name: "flush", pays: 3 },
  { rank: 1, name: "pair", pays: 1 },
];

export const ANTE_BONUS = [
  { rank: 6, name: "straight flush", pays: 5 },
  { rank: 5, name: "three of a kind", pays: 4 },
  { rank: 4, name: "straight", pays: 1 },
];

/** The dealer needs queen-high to play. */
export const dealerQualifies = (hand) =>
  hand.rank > 0 || hand.tie[0] >= 12;

/* ── five-card draw ──────────────────────────────────────────────────── */

// Paid against the paytable rather than head-to-head, so one player's luck
// never depends on how many others happen to be sitting down.
export const DRAW_PAYS = [
  { rank: 8, name: "straight flush", pays: 50 },
  { rank: 7, name: "four of a kind", pays: 25 },
  { rank: 6, name: "full house", pays: 9 },
  { rank: 5, name: "flush", pays: 6 },
  { rank: 4, name: "straight", pays: 4 },
  { rank: 3, name: "three of a kind", pays: 3 },
  { rank: 2, name: "two pair", pays: 2 },
  { rank: 1, name: "pair", pays: 1, minimum: 11 },   // jacks or better
];

export function drawPayout(hand) {
  for (const row of DRAW_PAYS) {
    if (hand.rank !== row.rank) continue;
    if (row.minimum && hand.tie[0] < row.minimum) return null;
    return row;
  }
  return null;
}

/* ── hi-lo ───────────────────────────────────────────────────────────── */

/** Both calls have to come in, which is what makes even money fair. */
export function hiLoResult(base, next, higher, eightUp) {
  const a = value(base), b = value(next);
  if (a === b) return { push: true, won: false, why: "the same rank" };
  const gotDirection = higher ? b > a : b < a;
  const gotBand = eightUp ? b >= 8 : b < 8;
  return {
    push: false,
    won: gotDirection && gotBand,
    gotDirection, gotBand,
    why: gotDirection && gotBand ? "both calls" : gotDirection ? "only the direction" : gotBand ? "only the band" : "neither call",
  };
}
