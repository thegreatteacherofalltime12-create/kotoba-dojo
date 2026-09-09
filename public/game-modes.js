// The Casino rule sheet.
//
// One copy, read in two places: the Game Modes tab of the rule book, and the
// overlay behind the Casino Game Rules button on the floor. Keeping it here
// means the two can never drift apart.

export function casinoRulesHtml() {
  return `
    <div class="rule-sec">
      <h3><span aria-hidden="true">&#127920;</span> Casino</h3>
      <p>A shared casino floor where your maths is your bankroll. Everyone takes a
      one-off <b>$100</b> stake when they arrive, and after that the only way to get
      more is to earn it at the arcade. One wallet covers every table on the floor,
      and it follows you between them.</p>
      <p>Casino money is its own economy. It pays no MMR and never touches the
      belt ladder &mdash; the arcade is the only thing on the floor that does.</p>
    </div>

    <div class="rule-sec">
      <h3><span aria-hidden="true">&#128176;</span> Money, and where it comes from</h3>
      <p><b>Earn Money</b> on the floor bar opens the arcade. Each correct sum pays
      <b>$5 to $15</b> in cash, <b>1 token</b>, and up to <b>50 MMR</b> &mdash; the MMR
      falls away evenly across thirty seconds, and solving inside ten seconds
      multiplies it by one and a half.</p>
      <p><b>Tokens</b> are what buy you a seat. Every table costs <b>1 token</b> to play
      &mdash; blackjack, roulette, baccarat, hi-lo, five-card, three-card, Hold'em, Pai Gow,
      Criss Cross and the Big Six Wheel alike. Win or push and you keep it; only a loss
      spends it. You walk in with one and earn more at the arcade, a token a sum.
      The <b>&#127943; horse race</b> is the one thing on the floor that needs none, so
      being out of tokens is never the end of the night.</p>
      <p>Money is <i>on the table</i> until you bank it. <b>Officially end match</b>
      banks everything to your wallet and leaves; walking out any other way leaves
      it on the table for when you come back. Tokens are counted and displayed but
      no table charges one to play.</p>
    </div>

    <div class="rule-sec">
      <h3><span aria-hidden="true">&#127922;</span> The tables</h3>
      <ul class="rule-list">
        <li><b>&#127183; Blackjack</b> &mdash; one shared 20-seat table, everyone against
          the same dealer. Take a seat for a set bet, then Deal. Hit or stand; the dealer
          draws under 17 and on soft 17. Wins and blackjacks both pay even money, a push
          returns your bet, and a loss costs one token. No splits or doubles.</li>
        <li><b>&#127905; American Roulette</b> &mdash; 38 pockets, 0 and 00 included. Single
          number 35:1; red, black, odd, even, 1-18 and 19-36 all 1:1; dozens and columns
          2:1. Zero and double-zero beat every outside bet.</li>
        <li><b>&#126980; Baccarat</b> &mdash; an eight-deck shoe dealt by the book, including
          the third-card rules below. Player 1:1. Banker 1:1 less 5% commission. Tie 8:1,
          and Player and Banker push on a tie. Player pair and Banker pair 11:1. Lucky 7
          pays 6:1 when the Player hand makes seven on two cards and 15:1 on three.</li>
        <li><b>&#127922; Hi-Lo</b> &mdash; a card is turned, and you make two calls about the
          next one: higher or lower, and 8-or-higher or under 8. Both have to come in, and
          both right pays 1:1. Equal ranks push.</li>
        <li><b>&#127924; Five-Card Draw</b> &mdash; ante, take five, throw back what you don't
          want, draw, and get paid against the paytable rather than a dealer: jacks or
          better 1:1, two pair 2:1, trips 3:1, straight 4:1, flush 6:1, full house 9:1,
          quads 25:1, straight flush 50:1.</li>
        <li><b>3&#65039;&#8419; Three-Card Poker</b> &mdash; ante, look at three cards, then play
          or fold. Playing costs the ante again. The dealer needs queen-high to qualify;
          if they don't, the ante pays 1:1 and the play bet pushes. Beat a qualifying
          dealer and both pay 1:1. A straight beats a flush on three cards. The ante bonus
          pays whether you win or lose &mdash; straight 1:1, trips 4:1, straight flush 5:1.
          Pair Plus is optional and settles on your hand alone: pair 1:1, flush 3:1,
          straight 6:1, trips 30:1, straight flush 40:1.</li>
        <li><b>&#127905; The Big Six Wheel</b> &mdash; 54 sections. Pick a symbol and spin:
          1 pays 1:1 (23 sections), 2 pays 2:1 (15), 5 pays 5:1 (8), 10 pays 10:1 (4),
          20 pays 20:1 (2), &#9733; pays 40:1 (1), &#9670; pays 45:1 (1).</li>
        <li><b>&#127943; Horse Race</b> &mdash; a continuous shared race on the Horse Race tab,
          four suits over seven steps with five hurdles that knock a suit back. Seven bet
          types: 1st or 2nd 1:1, first place 3:1, exacta 6:1, trifecta 12:1, superfecta
          24:1, and Long and Short at 50:1 for a win or a last place by three clear steps.
          You can also copy another player's slip off the board.</li>
      </ul>
        <li><b>&#127183; Texas Hold'em (vs dealer)</b> &mdash; a $5 buy-in, then check or
          bet on the flop, the turn and the river, in $5 steps up to what you hold. No
          blinds and no folding. Best five from your two and the five on the board; every
          wager you made pays 1:1 against the dealer and an exact tie pushes the lot.
          The dealer now plays back: after each of your actions it checks, bets, raises
          or folds, and when it bets you can call or fold.
          <br><b>Easy, Medium, Hard</b> sits beside the word Dealer and changes only how it
          bets &mdash; every card comes off a fair deck at every level. <b>Easy</b> almost
          never bluffs, waits for a real hand before betting, and gives up quickly.
          <b>Medium</b> bluffs about one time in six. <b>Hard</b> bluffs roughly a third of
          the time, comes back over the top far more often, and folds only to the strongest
          pressure.
          <br>It also learns one thing: how often you bet rather than check. Bet at
          everything and it stops believing you &mdash; folding less and raising more. Check
          at everything and it starts betting into you with nothing, because you have shown
          you won't punish it. Easy barely adjusts; Hard adjusts fully.</li>
        <li><b>&#126980; Face-Up Pai Gow Poker</b> &mdash; 53 cards with one joker. Seven
          each, the dealer's face up. Split yours into a five-card high and a two-card low,
          the five having to outrank the two, and beat the dealer on both to win at 1:1.
          One hand each is a push and copies go to the dealer. Commission-free, but a
          dealer forced to play ace-high pushes you automatically. The joker completes a
          straight, a flush or a royal and is an ace otherwise. House Way sets your hand
          for you, taking the strongest legal two-card hand.
          <br>Ace-High Bonus, when the dealer plays ace-high: both ace-high 25:1, dealer
          ace-high with the joker 10:1, without it 7:1.
          <br>Fortune Bonus on your seven: seven-card straight flush 5000:1, the same with
          the joker 1000:1, five aces 400:1, royal 150:1, straight flush 50:1, quads 25:1,
          full house 5:1, flush 4:1, trips 3:1, straight 2:1.</li>
        <li><b>&#10010; Criss Cross Poker</b> &mdash; two equal antes, two cards of your own,
          and five community cards in a cross. Bet Across, then Down, then the Middle, each
          one to three times the ante, or fold that line. Across is your two plus the
          horizontal arm, Down is your two plus the vertical, and the middle card belongs to
          both. The Middle bet rides on whichever arm finished stronger. Antes and lines pay
          from jacks up and push on a pair of sixes through tens.
          <br>Paytable: royal 500:1, straight flush 100:1, quads 40:1, full house 12:1,
          flush 8:1, straight 5:1, trips 3:1, two pair 2:1, jacks or better 1:1.
          <br>The optional 5 Card Bonus pays on the cross alone: royal 250:1, straight flush
          100:1, quads 40:1, full house 15:1, flush 10:1, straight 6:1, trips 4:1, two pair
          3:1, sixes or better 1:1.</li>
    </div>

    <div class="rule-sec">
      <h3><span aria-hidden="true">&#126980;</span> Baccarat &mdash; counting the hands</h3>
      <p>The hand closest to nine wins. Aces count one, tens and face cards count nothing,
      and a total above nine keeps only its last digit (10 = 0 &middot; 17 = 7 &middot;
      20 = 0 &middot; 23 = 3).</p>
      <p>Two cards go to each side, and a third may be called for either by the chart
      below. Eight or nine on the first two cards is a natural and ends it there.</p>
    </div>

    <div class="rule-sec">
      <h3><span aria-hidden="true">&#126980;</span> Baccarat &mdash; third card rules</h3>
      <p><b>Player</b> &mdash; draws on 0-1-2-3-4-5, stands on 6-7.</p>
      <p><b>Banker</b>, when the Player drew, goes by the card the Player took:</p>
      <ul class="rule-list">
        <li>Banker 0-1-2 &mdash; always draws</li>
        <li>Banker 3 &mdash; draws on everything but an 8</li>
        <li>Banker 4 &mdash; draws on 2-3-4-5-6-7</li>
        <li>Banker 5 &mdash; draws on 4-5-6-7</li>
        <li>Banker 6 &mdash; draws on 6-7</li>
        <li>Banker 7 &mdash; stands</li>
      </ul>
      <p>If the Player stood on 6 or 7, the Banker draws on 0-5 and stands on 6-7.</p>
    </div>`;
}

/**
 * The table games, in the order they appear across the top of the floor.
 * Blackjack leads because it is the one that is built; the rest follow
 * alphabetically. `ready` is what separates a table you can sit at from a
 * name on a door.
 */
export const TABLE_GAMES = [
  { id: "blackjack", pip: "\u{1F0CF}", name: "Blackjack", ready: true, min: 1 },
  { id: "roulette", pip: "\u{1F3A1}", name: "American Roulette", ready: true, min: 1 },
  { id: "baccarat", pip: "\u{1F004}", name: "Baccarat", ready: true, min: 1 },
  { id: "crisscross", pip: "\u271A", name: "Criss Cross Poker", ready: true, min: 1 },
  { id: "paigow", pip: "\u{1F004}", name: "Face-Up Pai Gow Poker", ready: true, min: 1 },
  { id: "fivecard", pip: "\u{1F3B4}", name: "Five-Card Draw", ready: true, min: 1 },
  { id: "hilo", pip: "\u{1F3B2}", name: "Hi-Lo", ready: true, min: 1 },
  { id: "holdem", pip: "\u{1F0CF}", name: "Texas Hold'em", ready: true, min: 5 },
  { id: "bigsix", pip: "\u{1F3A1}", name: "The Big Six Wheel", ready: true, min: 1 },
  { id: "threecard", pip: "3\uFE0F\u20E3", name: "Three-Card Poker", ready: true, min: 1 },
];


/* ── what the client draws for each table ───────────────────────────────
 *
 * Names and odds only. Every one of these is checked again on the server
 * before a penny moves, so this list can never decide a payout — it just
 * describes the buttons.
 */

export const ROULETTE_UI = [
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

export const BIGSIX_UI = [
  { id: "1", name: "1", pays: 1, sections: 23 },
  { id: "2", name: "2", pays: 2, sections: 15 },
  { id: "5", name: "5", pays: 5, sections: 8 },
  { id: "10", name: "10", pays: 10, sections: 4 },
  { id: "20", name: "20", pays: 20, sections: 2 },
  { id: "star", name: "\u2605 Star", pays: 40, sections: 1 },
  { id: "diamond", name: "\u25C6 Diamond", pays: 45, sections: 1 },
];

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
 * The order the symbols sit in around the Big Six wheel.
 *
 * Fifty-four segments in the standard distribution — twenty-three ones, then
 * fifteen twos, eight fives, four tens, two twenties, a star and a diamond.
 * The ones take every other segment so no two of anything else touch, which is
 * how a real wheel is laid out and why the rare symbols are easy to pick out
 * as it slows down.
 */
export const BIGSIX_WHEEL = (() => {
  const rest = [
    ...Array(15).fill("2"), ...Array(8).fill("5"), ...Array(4).fill("10"),
    ...Array(2).fill("20"), "star", "diamond",
  ];
  // Spread the rest evenly rather than in blocks, deterministically so every
  // player sees the same wheel.
  const spread = [];
  const step = 7;
  for (let i = 0, at = 0; i < rest.length; i++) {
    while (spread[at % rest.length] !== undefined) at++;
    spread[at % rest.length] = rest[i];
    at += step;
  }
  const out = [];
  let r = 0;
  for (let i = 0; i < 54; i++) {
    if (i % 2 === 0 && out.filter((x) => x === "1").length < 23) out.push("1");
    else out.push(spread[r++ % spread.length]);
  }
  return out;
})();

export const BIGSIX_TONE = {
  "1": "#2563EB", "2": "#16A34A", "5": "#EA580C",
  "10": "#7C3AED", "20": "#DC2626", star: "#F8FAFC", diamond: "#F4CE5A",
};
