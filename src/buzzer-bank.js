/**
 * The Buzzer — the clue bank.
 *
 * One hundred and four categories, five clues each, grouped into the sections
 * a board is chosen from. A clue carries its own three wrong options, and they
 * come from the same family as the answer on purpose: a column whose decoys
 * come from nowhere in particular is a column where the right answer is
 * obvious on sight, and four-options-from-the-same-family is the only thing
 * stopping a blind buzz from being a good bet.
 *
 * `clues[0]` is row one, the cheapest clue. Difficulty climbs down the column.
 *
 * `source` is kept on the arena categories deliberately. They are claims
 * about this codebase, and a claim about code should say which line it came
 * from — the alternative is a quiz that confidently teaches players something
 * the program stopped doing two releases ago.
 */

export const SECTIONS = [
  { id: "arena", name: "The arena" },
  { id: "staples", name: "The staples" },
  { id: "wordplay", name: "Wordplay" },
  { id: "geography", name: "Geography" },
  { id: "history", name: "History" },
  { id: "science", name: "Science and nature" },
  { id: "culture", name: "Culture" },
  { id: "everyday", name: "Everyday life" },
];

export const CATEGORIES = [
  {
    id: "garage", name: "THE KART GARAGE", section: "arena",
    scope: "Every answer is either a kart from the KARTS list in public/cosmetics.js or a count of karts in it.",
    clues: [
      { q: "The kart every fighter lines up in before they ever open the Race Kart tab",
        a: "Formula",
        wrong: ["Saloon", "Taxi", "Estate"],
        source: "public/cosmetics.js:452 (DEFAULT_KART = \"f1\"), with the Formula entry at :413" },
      { q: "Win a single Grand Prix and this kart, flag and all, opens up",
        a: "Chequered",
        wrong: ["Rocket", "Unicorn", "Snail"],
        source: "public/cosmetics.js:441 (need: won_prix 1)" },
      { q: "The number of karts in the garage that cannot be chosen, only won on the track",
        a: "Eight",
        wrong: ["Five", "Ten", "Thirty-three"],
        source: "public/cosmetics.js:441-450 — eight entries carry a `need`; the header comment at :409 still calls every kart free, and the code wins" },
      { q: "Twenty-five Grand Prix wins, and the rarest ride on the grid is yours",
        a: "Flying Saucer",
        wrong: ["Unicorn", "Tyrannosaur", "Rocket"],
        source: "public/cosmetics.js:445 (need: won_prix 25 — the largest count in the list)" },
      { q: "Twenty-five races finished with nobody else on the grid, and the slowest-sounding kart of all pays out",
        a: "Tortoise",
        wrong: ["Snail", "Racehorse", "Tyrannosaur"],
        source: "public/cosmetics.js:450 (solo_prix 25); solo only counts at field 1 with a finished status — public/cosmetics.js:277 and src/grand-prix.js:1250" },
    ],
  },
  {
    id: "lore", name: "DOJO LORE", section: "arena",
    scope: "Every answer is a fact about the arena as a whole — its belt ladder, its list of game modes, its prestige economy and its rank branches.",
    clues: [
      { q: "The belt worn from 2,600 MMR up, with nothing above it on the ladder",
        a: "Black",
        wrong: ["Brown", "Purple", "Green"],
        source: "public/app.js:43 and src/mmr.js:5,8" },
      { q: "The count of games you can actually start from Create Match today, casino floor included",
        a: "Six",
        wrong: ["Four", "Five", "Seven"],
        source: "public/arena.js:39-102 — six of the seven entries carry available: true" },
      { q: "The one tile on the Create Match grid that reads Coming soon, promising eight belts in a row",
        a: "Gauntlet",
        wrong: ["Casino", "Minesweeper", "Multiverse Golf"],
        source: "public/arena.js:95-101 (available: false) and public/app.js:2220" },
      { q: "What a promotion costs off the board, though lifetime MMR still counts it so no title is lost",
        a: "3,000 MMR",
        wrong: ["2,600 MMR", "1,525 MMR", "600 MMR"],
        source: "public/cosmetics.js:13-14 (PRESTIGE_COST and lifetime)" },
      { q: "Every fighter enlists here first, and it is the only branch on the ladder with no enlisted ranks at all",
        a: "Space Force",
        wrong: ["Army", "Navy", "Coast Guard"],
        source: "public/ranks.js:30 (enlisted: []) and :59, where anything unknown falls back to it" },
    ],
  },
  {
    id: "mines", name: "MIND THE MINES", section: "arena",
    scope: "Every answer is something the minesweeper room itself defines: its round clock, its three fields, or a token from its eighteen-piece arsenal.",
    clues: [
      { q: "The clock a sweeping round runs on before the field is called, however far along anyone is",
        a: "Ten minutes",
        wrong: ["Three minutes", "Five minutes", "Twenty minutes"],
        source: "src/minesweeper.js:275" },
      { q: "The token that opens a five-by-five block in one go, and only while you have dug nothing at all",
        a: "Clear Map",
        wrong: ["Lucky Opening", "Recon Patrol", "Spotter Drone"],
        source: "src/mine-lobby.js:604" },
      { q: "The only two fields Mine Buster is allowed on",
        a: "Intermediate and Expert",
        wrong: ["Beginner and Intermediate", "Beginner and Expert", "Expert only"],
        source: "src/minesweeper.js:45" },
      { q: "What a single Stopwatch takes off your clear time when the round is finally scored",
        a: "Thirty seconds",
        wrong: ["Ten seconds", "Sixty seconds", "Ninety seconds"],
        source: "src/minesweeper.js:81" },
      { q: "The one price in the whole mine arsenal that was never rounded off, the cost of Invincibility",
        a: "3,055",
        wrong: ["2,500", "3,200", "3,500"],
        source: "src/arsenals.js:112" },
    ],
  },
  {
    id: "wordcross", name: "WORD-CROSS", section: "arena",
    scope: "Every answer comes from the Word-Cross room's own rules: its round clock, the scrolls in its archive, and what its tokens do to a score.",
    clues: [
      { q: "The clock a Word-Cross round runs on, set by ROUND_MS",
        a: "Fifteen minutes",
        wrong: ["Five minutes", "Twenty minutes", "Thirty minutes"],
        source: "src/scoring.js:8" },
      { q: "The words a scroll written in the forge must carry, no more and no fewer",
        a: "Ten",
        wrong: ["Twenty-six", "Fifty", "Sixty"],
        source: "src/validate.js:6" },
      { q: "The largest scroll in the starter archive, fifty answers laid out thirty by thirty",
        a: "State Capitals",
        wrong: ["State Animals", "Before the City", "City SC Basics"],
        source: "src/starter-puzzles.js:3" },
      { q: "Finish the grid with Perfect Ink armed and the round cannot score below this",
        a: "75",
        wrong: ["50", "100", "200"],
        source: "src/lobby.js:643" },
      { q: "What one Double Ink really multiplies a score by, for all that its name promises",
        a: "1.25",
        wrong: ["2", "1.5", "1.15"],
        source: "src/lobby.js:644 — the name says double, the code raises 1.25 to the power of how many are used; code wins" },
    ],
  },
  {
    id: "golf", name: "MULTIVERSE GOLF", section: "arena",
    scope: "Every answer is a detail of Multiverse Golf exactly as the server plays it — one of its courses, its holes, its numbers or its rules.",
    clues: [
      { q: "A round here is the same set of holes for every player in the room, and this is how many of them there are",
        a: "18",
        wrong: ["9", "12", "36"],
        source: "src/links-course.js:55" },
      { q: "The course carrying \"The Home of Golf\" as its subtitle on the arena's card, out in Fife",
        a: "ST ANDREWS OLD",
        wrong: ["PEBBLE BEACH", "TPC SAWGRASS", "ROYAL MELBOURNE WEST"],
        source: "src/links.js:243" },
      { q: "Card par decides the word length, and a par three deals you a word of exactly this many letters",
        a: "Four",
        wrong: ["Three", "Five", "Six"],
        source: "src/links.js:208" },
      { q: "On the tee where one word plays the hole, half your letters landing in place sends the ball this far down a 400-yard hole",
        a: "200 yards",
        wrong: ["100 yards", "150 yards", "300 yards"],
        source: "public/hole.js:189" },
      { q: "The name the card hangs on the fourteenth hole at Kiawah Island Ocean",
        a: "Tidal Creek",
        wrong: ["The Marsh", "Ocean Reach", "Firethorn"],
        source: "src/links.js:261" },
    ],
  },
  {
    id: "floor", name: "THE CASINO FLOOR", section: "arena",
    scope: "Every answer is a fact about the shared casino floor as the server runs it — the stake, the blackjack table, and the other felt tables around it.",
    clues: [
      { q: "The floor stakes a new arrival this much table money, once and once only",
        a: "$100",
        wrong: ["$50", "$200", "$500"],
        source: "src/casino-core.js:15" },
      { q: "The blackjack dealer keeps drawing below this total, and draws again when it is holding a soft one",
        a: "17",
        wrong: ["16", "18", "21"],
        source: "src/casino-core.js:315" },
      { q: "What the blackjack shoe is rebuilt from whenever it drops under forty cards",
        a: "Six decks",
        wrong: ["One deck", "Two decks", "Eight decks"],
        source: "src/casino-floor.js:815" },
      { q: "At Face-Up Pai Gow, a dealer forced to play ace-high hands every seat this result, whatever the player holds",
        a: "A push",
        wrong: ["A win", "A loss", "A re-deal"],
        source: "src/casino-tables.js:206" },
      { q: "The diamond on the Big Six wheel outpays the star, returning this",
        a: "45 to 1",
        wrong: ["40 to 1", "20 to 1", "10 to 1"],
        source: "src/casino-games.js:165" },
    ],
  },
  {
    id: "battleship", name: "BATTLESHIP ROYALE", section: "arena",
    scope: "Every answer is a piece of Battleship Royale as the server actually enforces it: a hull class, a rotation count, an arsenal token, or a token's casino price.",
    clues: [
      { q: "The smallest hull in the fleet, at two cells",
        a: "Destroyer",
        wrong: ["Carrier", "Cruiser", "Submarine"],
        source: "src/battleship.js:43" },
      { q: "After firing at a captain, this many other captains must be fired at before you are allowed back to that one",
        a: "3",
        wrong: ["2", "4", "5"],
        source: "src/battleship.js:105" },
      { q: "An air strike never leaves the deck unless one of these is still afloat in your own fleet",
        a: "Carrier",
        wrong: ["Battleship", "Cruiser", "Submarine"],
        source: "src/battle-lobby.js:796" },
      { q: "The token that lifts the targeting rotation for a single turn, letting you come back to a captain early",
        a: "Priority Target",
        wrong: ["Spotter Plane", "Point Defence", "Periscope"],
        source: "src/battle-lobby.js:613" },
      { q: "The oddly unrounded casino price of the Submarine Torpedo, alone among the battleship tokens",
        a: "143",
        wrong: ["700", "900", "1,300"],
        source: "src/arsenals.js:55" },
    ],
  },
  {
    id: "prix", name: "THE MULTIVERSE GRAND PRIX", section: "arena",
    scope: "Every answer is a part of a Multiverse Grand Prix race: one of its engines, one of its item-box items, one of its circuits, or a number the track and its arsenal pay out.",
    clues: [
      { q: "The engine that flashes a row of tiles in order and asks you to tap them back",
        a: "Memory",
        wrong: ["Word Cross", "Maths", "Trivia"],
        source: "src/prix-engines.js:256" },
      { q: "The item that goes straight into your distance, worth 120 metres",
        a: "Slipstream",
        wrong: ["Nitro Word", "Comet", "Oil Slick"],
        source: "src/prix.js:124" },
      { q: "The leaders are refused a Solar Flare; you must be running in this place or worse to fire one",
        a: "4th",
        wrong: ["2nd", "3rd", "5th"],
        source: "src/prix.js:121" },
      { q: "The one circuit that runs short laps, and so quietly adds two laps to whatever length the host picked",
        a: "Orbital Ring",
        wrong: ["Neon Reef", "Cinder Rally", "Bramble Hollow"],
        source: "src/prix.js:40" },
      { q: "Each Podium Polish armed adds this many points straight onto your finishing score",
        a: "8",
        wrong: ["3", "5", "20"],
        source: "src/grand-prix.js:1047" },
    ],
  },
  {
    id: "horses", name: "AND THEY'RE OFF!", section: "arena",
    scope: "Every answer is a literal from the horse race in src/casino-core.js - a card suit, a bet on the board, or one of the race's own numbers.",
    clues: [
      { q: "Every runner in the seven-horse field wears this one suit, even though the track prints its pip in red",
        a: "Spades",
        wrong: ["Hearts", "Diamonds", "Clubs"],
        source: "src/casino-core.js:40-48 (HORSES, King down to Seven, all Spades; .map sets pip spades, red true)" },
      { q: "Knock-back cards dealt face down before the off, each turning only once the whole field is past it",
        a: "Five",
        wrong: ["Three", "Four", "Seven"],
        source: "src/casino-core.js:53 (HURDLES = 5) and 186-193 (dealTraps loops HURDLES times)" },
      { q: "The slip for a horse finishing in the top two, paying 4 on the board although the BETS line beside it still reads 3.5",
        a: "1st or 2nd",
        wrong: ["First Place", "Long", "Short"],
        source: "src/casino-core.js:159 declares pays 3.5, but PRICES at :145 and the loop at :172 overwrite it to 4 - the code pays 4, and casino-floor.js:737 pays via oddsFor" },
      { q: "The side bet on a winner three clear steps up, paying 100 after the PRICES loop rather than the 50 its own line declares",
        a: "Long",
        wrong: ["Short", "First Place", "Top 3 - Exact"],
        source: "src/casino-core.js:166-167 declares pays 50 (and the comment at :164-165 says both side bets pay 50), but PRICES at :151 and the loop at :172 overwrite it to 100 - the code pays 100" },
      { q: "The share of turns that go to the day's favourite, tuned by simulation rather than guessed",
        a: "0.252",
        wrong: ["0.143", "0.2", "0.5"],
        source: "src/casino-core.js:132 (FAVOURITE_STEP = 0.252), used at :226" },
    ],
  },
  {
    id: "tokens", name: "TOKENS & ARSENALS", section: "arena",
    scope: "Every answer is a shop literal from the arsenals - one of the six game arsenals, a token it sells, or one of the prices and counts in that list.",
    clues: [
      { q: "The price of the 1.5x MMR boost that opens every one of the six game arsenals in the shop",
        a: "200",
        wrong: ["300", "500", "1000"],
        source: "public/boost.js:11 (TOKEN_PRICE = 200), spent at :286 as the first item of every arsenal" },
      { q: "The dearest thing any arsenal sells, at 50,000 casino money, and no more than two a battle",
        a: "Nuke Missile",
        wrong: ["Clear Map", "Second Sweep", "Smoke Screen"],
        source: "src/arsenals.js:49 (bs_nuke, price 50_000, max 2); mirrored in public/boost.js:29" },
      { q: "Tokens in each of the six arsenals, the same count whether you shop Casino, Word-Cross or Minesweeper",
        a: "18",
        wrong: ["12", "15", "20"],
        source: "src/arsenals.js:9-26, 29-46, 49-66, 69-86, 89-106, 109-126 - eighteen entries per game, and ALL_TOKENS at :131 holds 108 keys" },
      { q: "The only arsenal holding tokens that name no per-match limit at all - six of its eighteen carry no max",
        a: "Battleship",
        wrong: ["Minesweeper", "Casino", "Multiverse Golf"],
        source: "src/arsenals.js:50-55 (bs_shots, bs_ships, bs_strike, bs_shield, bs_reveal, bs_torpedo have no max key); every other token in the file has one, and rooms fall back to 99 (src/casino-floor.js:236)" },
      { q: "The arsenal whose list insists nothing in it is a weapon, since the free items in the boxes are the weapons and money must never buy one",
        a: "Grand Prix",
        wrong: ["Casino", "Word-Cross", "Multiverse Golf"],
        source: "public/boost.js:230-232, the comment above PRIX_ARSENAL_ITEMS at :233" },
    ],
  },
];

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

export function categoriesIn(sectionId) {
  return CATEGORIES.filter((c) => c.section === sectionId);
}

/**
 * Every wrong answer anywhere in a column, which is what a clue falls back on
 * when its own three decoys are not enough to fill four options. Drawing from
 * the column rather than from the whole bank is the point: the family holds.
 */
export function poolFor(category) {
  const out = [];
  for (const c of category?.clues || []) {
    out.push(c.a, ...(c.wrong || []));
  }
  return out;
}
