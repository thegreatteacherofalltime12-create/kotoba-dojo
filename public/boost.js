// Boost tokens on the client: the shop's list of them, and the Apply Token
// tab every game carries.
//
// A token is bought in the profile's Token shop and does nothing until the
// player opens Apply Token inside a game and applies it to the match they are
// in. The tab asks the room what the player holds (TOKENS), and applying
// sends APPLY_TOKEN; the room answers both with the same reply, which this
// draws. Nothing here decides anything — the room does, and the round's own
// record write spends the token.

export const TOKEN_PRICE = 200;

export const TOKEN_ITEMS = [
  { game: "crossword", name: "Word-Cross boost", icon: "\u{1F520}", where: "Word-Cross", blurb: "1.5× MMR on one ranked Word-Cross round" },
  { game: "battleship", name: "Battleship boost", icon: "⚓", where: "Battleship Royale", blurb: "1.5× MMR on one Battleship Royale" },
  { game: "minesweeper", name: "Minesweeper boost", icon: "\u{1F4A3}", where: "Minesweeper", blurb: "1.5× MMR on one Minesweeper board" },
  { game: "links", name: "Golf boost", icon: "⛳", where: "Multiverse Golf", blurb: "1.5× MMR on one round of Multiverse Golf" },
  { game: "casino", name: "Casino boost", icon: "\u{1F3B0}", where: "the Casino", blurb: "1.5× on every casino win for a day" },
  { game: "prix", name: "Grand Prix boost", icon: "\u{1F3CE}\uFE0F", where: "the Grand Prix", blurb: "1.5× MMR on one Multiverse Grand Prix" },
  { game: "buzzer", name: "Buzzer boost", icon: "🛎️", where: "The Buzzer", blurb: "1.5× MMR on one board of The Buzzer" },
  { game: "artillery", name: "Artillery boost", icon: "💥", where: "Artillery Tank Duel", blurb: "1.5× MMR on one Artillery Tank Duel" },
];

export const tokenItem = (game) => TOKEN_ITEMS.find((t) => t.game === game) || TOKEN_ITEMS[0];

/**
 * The multipliers, above the 1.5x boosts.
 *
 * Unlike a boost, which belongs to one game, a multiplier works in whatever
 * you are playing — so there is one shelf of five rather than five on every
 * game's shelf. One to a match, and applying one is applying it instead of
 * the game's boost. Prices and multipliers mirror MULTIPLIERS in src/mmr.js.
 *
 * The casino is the exception, and the floor says so if you try: it sells a
 * day rather than a match, and a multiplier has no match to sit on.
 */
export const MULTIPLIER_ITEMS = [
  { key: "mx2", mult: 2, name: "2\u00d7 MMR", icon: "\u2716\uFE0F", price: 5000,
    blurb: "Double the MMR of one ranked match, in any game. Spent by the match that uses it." },
  { key: "mx3", mult: 3, name: "3\u00d7 MMR", icon: "\u{1F538}", price: 8000,
    blurb: "Triple the MMR of one ranked match, in any game." },
  { key: "mx4", mult: 4, name: "4\u00d7 MMR", icon: "\u{1F536}", price: 12000,
    blurb: "Four times the MMR of one ranked match, in any game." },
  { key: "mx5", mult: 5, name: "5\u00d7 MMR", icon: "\u{1F31F}", price: 15000,
    blurb: "Five times the MMR of one ranked match, in any game." },
  { key: "mx6", mult: 6, name: "6\u00d7 MMR", icon: "\u{1F4AB}", price: 20000,
    blurb: "Six times the MMR of one ranked match, in any game. The dearest thing the shop sells for a single round." },
];

export const multiplierItem = (key) => MULTIPLIER_ITEMS.find((m) => m.key === key) || null;

// The Battleship arsenal: bought in the shop, armed in the Apply Token tab
// of a battle (four per battle, two nukes at most), fired from the Arsenal
// strip on the battle screen. Only what is used is spent. Prices and rules
// mirror src/battleship.js.
export const ARSENAL_ITEMS = [
  { key: "bs_nuke", name: "Nuke Missile", icon: "\u2622\uFE0F", price: 50000, max: 2, act: "nuke", aim: "cell",
    blurb: "Takes your turn. Skirmish: a hit sinks the whole ship. Fleet Action: a 3\u00d73 blast. Open Ocean: 7\u00d77. Two a battle." },
  { key: "bs_shots", name: "Extra Shots", icon: "\u{1F3AF}", price: 2500, act: "extra",
    blurb: "+2 / +4 / +6 shots by chart for one turn, spread over captains as usual." },
  { key: "bs_ships", name: "Extra Ships", icon: "\u{1F6A2}", price: 500, act: "ships",
    blurb: "Three more hulls of your choosing, on any chart. Arm before you place." },
  { key: "bs_strike", name: "Tactical Air Strike", icon: "\u2708\uFE0F", price: 3500, act: "strike", aim: "cell",
    blurb: "Takes your turn. A 6\u00d76 blast anchored where you point, on any chart. Needs a carrier afloat." },
  { key: "bs_shield", name: "Air Strike Defence", icon: "\u{1F6E1}\uFE0F", price: 4000, act: "shield", aim: "own",
    blurb: "A hidden 6\u00d76 area of your water. Squares of an air strike inside it do nothing; it then shows, spent." },
  { key: "bs_reveal", name: "Air Strike Reveal", icon: "\u{1F52D}", price: 1300, act: "reveal", aim: "target",
    blurb: "Shows you one captain's Air Strike Defence, if they have one, before you waste a strike on it." },
  { key: "bs_torpedo", name: "Submarine Torpedo", icon: "\u{1F41F}", price: 143, act: "torpedo", aim: "cell",
    blurb: "One extra single-square shot on your turn, on top of your volley, while your submarine is afloat." },

  { key: "bs_sonar", name: "Sonar Ping", icon: "\u{1F50A}", price: 900, max: 4, act: "sonar", aim: "cell",
    blurb: "Names how many ship squares sit in the 3\u00d73 you point at, without firing. Four a battle." },
  { key: "bs_radar", name: "Radar Sweep", icon: "\u{1F4E1}", price: 1500, max: 3, act: "radar", aim: "line",
    blurb: "Names how many ship squares are in one row or column of a captain's water. Three a battle." },
  { key: "bs_spotter", name: "Spotter Plane", icon: "\u{1F6E9}\uFE0F", price: 1200, max: 3, act: "spotter", aim: "target",
    blurb: "Pinpoints one square of one ship the chosen captain still has afloat. Three a battle." },
  { key: "bs_scope", name: "Periscope", icon: "\u{1F52D}", price: 700, max: 3, act: "scope", aim: "target",
    blurb: "Names which ships a captain still has afloat, and their lengths. Three a battle." },
  { key: "bs_depth", name: "Depth Charge", icon: "\u{1F4A3}", price: 2000, max: 3, act: "depth", aim: "cell",
    blurb: "Takes your turn: a five-square cross \u2014 the square you pick and the four beside it. Three a battle." },
  { key: "bs_priority", name: "Priority Target", icon: "\u{1F3AF}", price: 1000, max: 3, act: "priority",
    blurb: "The rotation is lifted for this turn: fire at anyone, even the captain you just hit. Three a battle." },
  { key: "bs_point", name: "Point Defence", icon: "\u{1F6DF}", price: 1600, max: 3, act: "point",
    blurb: "The next shot that would hit you is a miss. Three a battle." },
  { key: "bs_repair", name: "Repair Crew", icon: "\u{1F527}", price: 3000, max: 2, act: "repair",
    blurb: "Takes one hit back off your most damaged ship; that square reads as open water again. Two a battle." },
  { key: "bs_armour", name: "Reinforced Hull", icon: "\u{1F6E1}", price: 2600, max: 2, act: "armour",
    blurb: "Your largest unhurt ship turns the first shell aside — the water there stays unmarked and she needs one more shot than her length. Two a battle." },
  { key: "bs_evade", name: "Evasive Maneuvers", icon: "\u2194\uFE0F", price: 2200, max: 2, act: "evade",
    blurb: "Moves your largest unhit ship to a new berth \u2014 shots that missed her old one mean nothing now. Two a battle." },
  { key: "bs_smoke", name: "Smoke Screen", icon: "\u{1F32B}\uFE0F", price: 4500, max: 1, act: "smoke",
    blurb: "For a full round of turns every hit on your water is reported to the shooter as a miss. The truth shows when it clears. One a battle." },
];
export const HULL_OPTIONS = [
  ["carrier", "Carrier (5)"], ["battleship", "Battleship (4)"], ["cruiser", "Cruiser (3)"],
  ["submarine", "Submarine (3)"], ["destroyer", "Destroyer (2)"],
];
export const arsenalItem = (key) => ARSENAL_ITEMS.find((t) => t.key === key);

// The Minesweeper arsenal. Mirrors src/arsenals.js.
export const MINE_ARSENAL_ITEMS = [
  { key: "ms_reveal", name: "Mine Reveal", icon: "\u{1F50E}", price: 2000, max: 2, act: "reveal",
    blurb: "Shows two of the field's mines on your board. Any field. Two a round." },
  { key: "ms_buster", name: "Mine Buster", icon: "\u{1F9E8}", price: 500, max: 5, act: "buster", aim: "cell",
    blurb: "Pick a square: a mine there is destroyed and the ground opens; clean ground just opens. Intermediate and Expert only. Five a round." },
  { key: "ms_clear", name: "Clear Map", icon: "\u{1F9F9}", price: 20000, max: 1, act: "clear", aim: "cell",
    blurb: "Before you have dug anything, opens a 5\u00d75 where you point \u2014 a mine inside it ends your sweep. One a round." },
  { key: "ms_shield", name: "Invincibility", icon: "\u{1F6E1}\uFE0F", price: 3055, max: 2, act: "shield",
    blurb: "Ten seconds in which a mine you dig is defused instead of ending you. Two a round." },
  { key: "ms_detect", name: "Metal Detector", icon: "\u{1F9F2}", price: 800, max: 5, act: "detect", aim: "cell",
    blurb: "Names how many mines sit in the 3\u00d73 you point at, without opening it. Any field. Five a round." },
  { key: "ms_radar", name: "Radar Sweep", icon: "\u{1F4E1}", price: 1200, max: 4, act: "radar", aim: "line",
    blurb: "Names how many mines are in one row or column you pick. Four a round." },
  { key: "ms_quad", name: "Quadrant Scan", icon: "\u{1F5FA}\uFE0F", price: 600, max: 3, act: "quad",
    blurb: "Mine counts for the four quarters of the field. Three a round." },
  { key: "ms_drone", name: "Spotter Drone", icon: "\u{1F6F8}", price: 1500, max: 3, act: "drone",
    blurb: "Opens the three safest unopened squares \u2014 numbers only, no flood. Three a round." },
  { key: "ms_flags", name: "Frontier Flags", icon: "\u{1F6A9}", price: 2400, max: 3, act: "flags",
    blurb: "Flags three mines that touch ground you have already opened. Three a round." },
  { key: "ms_gloves", name: "Sapper\'s Gloves", icon: "\u{1F9E4}", price: 4500, max: 2, act: "gloves",
    blurb: "The next three mines you dig are defused, however long it takes. Two a round." },
  { key: "ms_second", name: "Second Sweep", icon: "\u267B\uFE0F", price: 12000, max: 1, act: "second",
    blurb: "If you hit a mine, your sweep carries on from where it stood \u2014 once. One a round." },
  { key: "ms_recon", name: "Recon Patrol", icon: "\u{1FA96}", price: 3200, max: 3, act: "recon", aim: "cell",
    blurb: "Opens a 3\u00d73; any mine inside is flagged rather than triggered. Three a round." },
  { key: "ms_demo", name: "Demolition Charge", icon: "\u{1F4A5}", price: 2500, max: 2, act: "demo", aim: "cell",
    blurb: "Destroys the three mines nearest the square you pick. Two a round." },
  { key: "ms_opening", name: "Lucky Opening", icon: "\u{1F331}", price: 1000, max: 1, act: "opening",
    blurb: "Before your first dig, opens the biggest clearing on the field. One a round." },
  { key: "ms_chord", name: "Chord", icon: "\u26CF\uFE0F", price: 300, max: 8, act: "chord", aim: "cell",
    blurb: "Opens everything around a number whose flags already match it \u2014 with the same risk as doing it by hand. Eight a round." },
  { key: "ms_watch", name: "Stopwatch", icon: "\u23F1\uFE0F", price: 2000, max: 3, act: "watch",
    blurb: "Thirty seconds off your clear time when the round is scored. Three a round." },
  { key: "ms_hazard", name: "Hazard Pay", icon: "\u{1FA79}", price: 1800, max: 2, act: "hazard",
    blurb: "A sweep ended by a mine scores as if you had uncovered 15% more. Two a round." },
  { key: "ms_promo", name: "Field Promotion", icon: "\u{1F396}\uFE0F", price: 3500, max: 1, act: "promo",
    blurb: "Your round is scored one level up \u2014 Beginner as Intermediate, Intermediate as Expert. One a round." },
];
// The golf arsenal. Mirrors src/arsenals.js.
export const LINKS_ARSENAL_ITEMS = [
  { key: "gf_mulligan", name: "Mulligan", icon: "\u{1F504}", price: 800, max: 3, act: "mulligan",
    blurb: "Takes one stroke back off the hole you are on. Three a round." },
  { key: "gf_hint", name: "Caddie\'s Hint", icon: "\u{1F4A1}", price: 400, max: 5, act: "hint",
    blurb: "Places one letter of the word you are on. Five a round." },
  { key: "gf_finder", name: "Range Finder", icon: "\u{1F4CF}", price: 600, max: 3, act: "finder",
    blurb: "Buys the clue early on the hard tees, where it is withheld until two words are behind you. Three a round." },
  { key: "gf_relief", name: "Ground Under Repair", icon: "\u{1F6A7}", price: 900, max: 3, act: "relief",
    blurb: "The next word you fail costs one stroke instead of two \u2014 and on the forward tees a blown hole is par+1 rather than par+3. Three a round." },
  { key: "gf_gimme", name: "Gimme", icon: "\u{1F91D}", price: 2500, max: 2, act: "gimme",
    blurb: "Concedes the hole you are on at par and moves you along. Two a round." },
  { key: "gf_practice", name: "Practice Swing", icon: "\u{1F3CC}\uFE0F", price: 500, max: 5, act: "practice",
    blurb: "Your next guess costs no stroke and eats no guess. Five a round." },
  { key: "gf_fitting", name: "Club Fitting", icon: "\u{1F527}", price: 700, max: 3, act: "fitting",
    blurb: "Swaps the word you are on for another of the same length. Three a round." },
  { key: "gf_bounce", name: "Lucky Bounce", icon: "\u{1F340}", price: 1800, max: 2, act: "bounce",
    blurb: "The hole you are on scores no worse than par. Two a round." },
  { key: "gf_local", name: "Local Knowledge", icon: "\u{1F5FA}\uFE0F", price: 600, max: 4, act: "local",
    blurb: "Places the first and last letters of the word you are on. Four a round." },
  { key: "gf_club", name: "Extra Club", icon: "\u{1F3CC}", price: 500, max: 4, act: "club",
    blurb: "Two more guesses on the word you are on before the hole is conceded. Four a round." },
  { key: "gf_drop", name: "Drop Zone", icon: "\u{1F3AF}", price: 1200, max: 2, act: "drop",
    blurb: "The word starts again, and the strokes your guesses cost come off. Two a round." },
  { key: "gf_tees", name: "Preferred Lies", icon: "\u26F3", price: 1500, max: 2, act: "tees",
    blurb: "The next hole is played from one tee forward \u2014 fewer words, at that tee's par. Two a round." },
  { key: "gf_double", name: "Double Down", icon: "\u2696\uFE0F", price: 1000, max: 3, act: "double",
    blurb: "Declared on the tee: par or better doubles the hole's points, worse halves them. Three a round." },
  { key: "gf_eagle", name: "Eagle Eye", icon: "\u{1F985}", price: 2000, max: 2, act: "eagle",
    blurb: "Your next hole under par pays double. Two a round." },
  { key: "gf_pencil", name: "Scorecard Pencil", icon: "\u270F\uFE0F", price: 3000, max: 1, act: "pencil",
    blurb: "Your worst hole comes off the card when the round is scored. One a round." },
  { key: "gf_wind", name: "Wind Gauge", icon: "\u{1F32C}\uFE0F", price: 2200, max: 2, act: "wind",
    blurb: "Shows the dealt letters in their right order for two seconds. Two a round." },
  { key: "gf_book", name: "Caddie\'s Book", icon: "\u{1F4D2}", price: 900, max: 2, act: "book",
    blurb: "Reads you the clues for the next three holes. Two a round." },
  { key: "gf_ace", name: "Ace Chaser", icon: "\u{1F3AF}", price: 2800, max: 2, act: "ace",
    blurb: "Your next hole in one pays 150 points instead of 100. Two a round." },

];
// The Word-Cross arsenal. Mirrors src/arsenals.js.
export const WORD_ARSENAL_ITEMS = [
  { key: "wc_letter", name: "Free Letter", icon: "\u{1F58A}\uFE0F", price: 300, max: 8, act: "letter", aim: "entry",
    blurb: "Reveals one letter of the entry you are on. Eight a round." },
  { key: "wc_shape", name: "Word Shape", icon: "\u{1F524}", price: 500, max: 5, act: "shape", aim: "entry",
    blurb: "Names the first and last letters of the entry you are on. Five a round." },
  { key: "wc_anagram", name: "Anagram Sheet", icon: "\u{1F500}", price: 800, max: 4, act: "anagram", aim: "entry",
    blurb: "Shows that entry's letters, scrambled. Four a round." },
  { key: "wc_spell", name: "Spellcheck", icon: "\u2705", price: 900, max: 4, act: "spell", aim: "entry",
    blurb: "Marks what you have typed letter by letter \u2014 right letter right place, right letter wrong place. Four a round." },
  { key: "wc_eye", name: "Sensei\'s Eye", icon: "\u{1F441}\uFE0F", price: 600, max: 3, act: "eye",
    blurb: "Points out the unsolved entry that crosses the most others. Three a round." },
  { key: "wc_theme", name: "Theme Reading", icon: "\u{1F4DC}", price: 200, max: 2, act: "theme",
    blurb: "Names the scroll's title. Two a round." },
  { key: "wc_firsts", name: "First Letters", icon: "\u{1F170}\uFE0F", price: 1200, max: 2, act: "firsts",
    blurb: "Reveals the first letter of every unsolved entry at once. Two a round." },
  { key: "wc_gift", name: "Random Gift", icon: "\u{1F381}", price: 1500, max: 4, act: "gift",
    blurb: "Solves one unsolved entry, chosen for you. Four a round." },
  { key: "wc_short", name: "Shortest Straw", icon: "\u{1F956}", price: 1200, max: 3, act: "short",
    blurb: "Solves the shortest unsolved entry. Three a round." },
  { key: "wc_word", name: "Free Word", icon: "\u270D\uFE0F", price: 2500, max: 3, act: "word", aim: "entry",
    blurb: "Solves the entry you are on. Three a round." },
  { key: "wc_last", name: "Last Word", icon: "\u{1F3C1}", price: 900, max: 2, act: "last",
    blurb: "Solves the final entry when only one is left. Two a round." },
  { key: "wc_cascade", name: "Cascade", icon: "\u{1F30A}", price: 4000, max: 1, act: "cascade", aim: "entry",
    blurb: "Solves the entry you are on, then any entry its crossings complete. One a round." },
  { key: "wc_head", name: "Head Start", icon: "\u23EA", price: 1000, max: 3, act: "head",
    blurb: "Your clock reads 45 seconds earlier when the round is scored. Three a round." },
  { key: "wc_perfect", name: "Perfect Ink", icon: "\u{1F48E}", price: 3000, max: 1, act: "perfect",
    blurb: "Finish the grid and the round scores no lower than 75. One a round." },
  { key: "wc_double", name: "Double Ink", icon: "\u2716\uFE0F", price: 2600, max: 2, act: "double",
    blurb: "The round's score is multiplied by 1.25. Two a round." },
  { key: "wc_salvage", name: "Salvage", icon: "\u{1F9F0}", price: 1400, max: 2, act: "salvage",
    blurb: "A round you do not finish scores as if you had solved two more. Two a round." },
  { key: "wc_fast", name: "Fast Hands", icon: "\u26A1", price: 400, max: 2, act: "fast",
    blurb: "The typing rate limit is lifted for you this round. Two a round." },
  { key: "wc_quiet", name: "Quiet Grid", icon: "\u{1F92B}", price: 700, max: 3, act: "quiet",
    blurb: "Your progress stops showing to the field. Three a round." },
];
// The Casino arsenal. Mirrors src/arsenals.js.
export const CASINO_ARSENAL_ITEMS = [
  { key: "cs_chips", name: "Chip Run", icon: "\u{1F39F}\uFE0F", price: 2000, max: 2, act: "chips",
    blurb: "Five table tokens straight to your seat. Two a session." },
  { key: "cs_comp", name: "Comp Pass", icon: "\u{1F3AB}", price: 900, max: 1, act: "comp",
    blurb: "The card room takes you without a table token for the rest of the day. One a session." },
  { key: "cs_safe", name: "Blackjack Safety", icon: "\u{1F6E1}\uFE0F", price: 600, max: 4, act: "safe",
    blurb: "A losing hand costs you no table token. Four a session." },
  { key: "cs_peek", name: "Peek", icon: "\u{1F440}", price: 1800, max: 2, act: "peek",
    blurb: "Shows the dealer's hole card on the hand in play. Two a session." },
  { key: "cs_redeal", name: "Second Deal", icon: "\u{1F504}", price: 1200, max: 3, act: "redeal",
    blurb: "Re-deals your opening two cards. Three a session." },
  { key: "cs_tip", name: "Tip the Dealer", icon: "\u{1F4B5}", price: 800, max: 4, act: "tip",
    blurb: "Swaps one card in your hand for the next in the shoe. Four a session." },
  { key: "cs_count", name: "Card Counter", icon: "\u{1F9EE}", price: 1400, max: 3, act: "count",
    blurb: "Names how many tens and aces are left in the shoe. Three a session." },
  { key: "cs_insure", name: "Insurance Policy", icon: "\u{1F4CB}", price: 2500, max: 2, act: "insure",
    blurb: "A losing hand gives your stake back. Two a session." },
  { key: "cs_tie", name: "Dealer\'s Off Day", icon: "\u{1F91D}", price: 1100, max: 3, act: "tie",
    blurb: "A push pays as a win. Three a session." },
  { key: "cs_shoe", name: "Fresh Shoe", icon: "\u{1F0CF}", price: 400, max: 3, act: "shoe",
    blurb: "Six new decks, shuffled, between hands. Three a session." },
  { key: "cs_photo", name: "Photo Finish", icon: "\u{1F4F8}", price: 1500, max: 3, act: "photo",
    blurb: "A horse of yours that comes third pays as if it came second. Three a session." },
  { key: "cs_scratch", name: "Scratch the Bet", icon: "\u2702\uFE0F", price: 1000, max: 3, act: "scratch",
    blurb: "Pulls your bet back off the board, stake returned, even after the off. Three a session." },
  { key: "cs_furlong", name: "Extra Furlong", icon: "\u{1F40E}", price: 2200, max: 2, act: "furlong", aim: "horse",
    blurb: "A horse you pick starts one step up the track. Before the off. Two a session." },
  { key: "cs_double", name: "Bet Doubler", icon: "\u2716\uFE0F", price: 3000, max: 2, act: "double",
    blurb: "Your next winning bet pays double. Two a session." },
  { key: "cs_flash", name: "Flashcards", icon: "\u{1F5C2}\uFE0F", price: 1600, max: 2, act: "flash",
    blurb: "Your next three arcade puzzles pay double cash. Two a session." },
  { key: "cs_credit", name: "Extra Credit", icon: "\u{1F393}", price: 2400, max: 2, act: "credit",
    blurb: "Your next arcade puzzle pays the full 50 MMR whatever the clock says. Two a session." },
  { key: "cs_cap", name: "Raise the Cap", icon: "\u{1F4C8}", price: 4000, max: 1, act: "cap",
    blurb: "Today's 100 MMR ceiling becomes 150. One a session." },
  { key: "cs_deposit", name: "Night Deposit", icon: "\u{1F3E6}", price: 2000, max: 2, act: "deposit",
    blurb: "Banks what is on your table without ending your session. Two a session." },
];
// The Grand Prix arsenal. Mirrors src/arsenals.js. Nothing here is a
// weapon: the free items in the boxes are the weapons, and money should
// never buy one.
export const PRIX_ARSENAL_ITEMS = [
  { key: "gp_start", name: "Start Boost", icon: "\u{1F6A6}", price: 600, max: 3,
    blurb: "Two hundred metres off the line, the moment the lights go out." },
  { key: "gp_tow", name: "Tow Rope", icon: "\u{1FA9D}", price: 900, max: 3,
    blurb: "Your next five answers each pay twenty metres more." },
  { key: "gp_slip", name: "Slipstream Canister", icon: "\u{1F4A8}", price: 1200, max: 2,
    blurb: "Start the race already holding a Slipstream. A second one needs a Twin Box to hold it." },
  { key: "gp_nitro", name: "Nitro Canister", icon: "\u26A1", price: 1500, max: 2,
    blurb: "Start the race already holding a Nitro Word. A second one needs a Twin Box to hold it." },
  { key: "gp_fuel", name: "Long Fuel", icon: "\u26FD", price: 1800, max: 1,
    blurb: "Every allowance is a fifth longer, all race." },
  { key: "gp_warmup", name: "Warm-Up Lap", icon: "\u{1F321}\uFE0F", price: 700, max: 3,
    blurb: "Three answers pay a full boost whatever the clock said. Three more for each one armed." },
  { key: "gp_tyres", name: "Slick Tyres", icon: "\u{1F6DE}", price: 700, max: 1,
    blurb: "A spin costs five metres instead of fifteen." },
  { key: "gp_seal", name: "Scrutineer's Seal", icon: "\u{1F6E1}\uFE0F", price: 1100, max: 3,
    blurb: "Start the race with a Deflector already up. One for each one armed." },
  { key: "gp_guards", name: "Mudguards", icon: "\u{1F6E2}\uFE0F", price: 800, max: 1,
    blurb: "Oil slicks do nothing to you." },
  { key: "gp_visor", name: "Sun Visor", icon: "\u{1F576}\uFE0F", price: 1000, max: 1,
    blurb: "Fog and flares last half as long on you." },
  { key: "gp_radio", name: "Pit Radio", icon: "\u{1F4FB}", price: 600, max: 1,
    blurb: "A clue that would be withheld is never withheld from you." },
  { key: "gp_spotter", name: "Spotter", icon: "\u{1F52D}", price: 900, max: 3,
    blurb: "Three skips that need no waiting." },
  { key: "gp_spare", name: "Spare Word", icon: "\u{1F9F0}", price: 500, max: 5,
    blurb: "One wrong answer a lap costs nothing. One more a lap for each one armed." },
  { key: "gp_tele", name: "Telemetry", icon: "\u{1F4E1}", price: 1300, max: 1,
    blurb: "You can see what the racer ahead is holding." },
  { key: "gp_twin", name: "Twin Box", icon: "\u{1F381}", price: 2000, max: 1,
    blurb: "Hold two items at once instead of one." },
  { key: "gp_magnet", name: "Box Magnet", icon: "\u{1F9F2}", price: 1400, max: 3,
    blurb: "Three boxes your hands had no room for are collected anyway, and wait for a hand. Nothing you are carrying is ever swapped out for one." },
  { key: "gp_polish", name: "Podium Polish", icon: "\u{1F3C6}", price: 2500, max: 2,
    blurb: "Eight points on the race score when it is counted." },
  { key: "gp_points", name: "Points Finish", icon: "\u{1F3C1}", price: 3000, max: 1,
    blurb: "A race you do not finish is scored as though you had." },
];


/**
 * The Buzzer's arsenal: the Grand Prix grid plus ten dollars, because the two
 * do the same jobs at the same points. The rule is the race's and it is held
 * just as hard here — nothing you buy may be aimed at another player. Money
 * buys you a better seat at the board, never a way to hurt the person beside
 * you. Every one of these is applied by the room the moment it can be, so a
 * token armed is a token spent rather than a button to remember.
 */
export const BUZZER_ARSENAL_ITEMS = [
  { key: "bz_second", name: "Second Look", icon: "👀", price: 510, max: 5,
    blurb: "Your first wrong answer in each round costs you nothing. One per round, per token." },
  { key: "bz_card", name: "Category Card", icon: "🗂️", price: 610, max: 3,
    blurb: "One category's scope is shown to you before the board turns — what family its answers belong to." },
  { key: "bz_long", name: "Long Look", icon: "⏳", price: 710, max: 2,
    blurb: "Fifteen seconds to choose instead of ten, all night." },
  { key: "bz_house", name: "House Money", icon: "🏦", price: 810, max: 1,
    blurb: "You sit down on ,500 rather than ,000. The extra floats with the rest of the stake." },
  { key: "bz_fewer", name: "Two Fewer", icon: "✂️", price: 910, max: 3,
    blurb: "On the first clue you take, two of the wrong options are taken away. One clue, per token." },
  { key: "bz_pockets", name: "Deep Pockets", icon: "👛", price: 1010, max: 2,
    blurb: "Your Daily Double ceiling doubles, so you may wager past what you are holding." },
  { key: "bz_nudge", name: "The Nudge", icon: "👉", price: 1110, max: 2,
    blurb: "Which category hides a Daily Double, told to you and nobody else, once a round." },
  { key: "bz_finger", name: "Fast Finger", icon: "⚡", price: 1210, max: 3,
    blurb: "Your next three buzzes land a fraction earlier — sixty milliseconds, never under the human floor." },
  { key: "bz_insure", name: "Insurance", icon: "🛡️", price: 1310, max: 2,
    blurb: "A Daily Double that goes wrong costs you half of what you wagered." },
  { key: "bz_book", name: "Open Book", icon: "📖", price: 1510, max: 2,
    blurb: "On the first clue of each round, the four options are shown to you before anyone may buzz." },
  { key: "bz_polish", name: "Podium Polish", icon: "🏆", price: 2510, max: 2,
    blurb: "Eight points on the match score when it is counted." },
  { key: "bz_points", name: "Points Finish", icon: "🏁", price: 3010, max: 1,
    blurb: "A board you do not see the end of is scored as though you had." },
];

/**
 * The tank arsenal: bought in the shop, armed in the Apply Token tab of a
 * duel, and then either picked up with a shot or fired on its own.
 *
 * Three ways in, and the tab says which is which, because getting it wrong
 * costs a turn:
 *
 *   shot    picked before you fire, and it goes up with the shell
 *   strike  takes the turn on its own, pointed at a column of the map
 *   guard   raised while somebody else is shooting, and spent by their blast
 *   turn    takes your turn and does its work at once
 *
 * The room resolves every one of them. Prices and limits mirror
 * src/arsenals.js; the mechanics are src/artillery.js.
 */
export const TANK_ARSENAL_ITEMS = [
  { key: "at_orbital", name: "Orbital Strike", icon: "🛸", price: 5000, max: 1, act: "strike", aim: "column",
    blurb: "Takes your turn. Three vertical lasers come down on the column you point at and the two beside it." },
  { key: "at_teleport", name: "Teleport Evade", icon: "🌀", price: 4500, max: 2, act: "turn",
    blurb: "Takes your turn. Your tank appears at the safest spot on the map — the one furthest from everybody else." },
  { key: "at_bubble", name: "Invulnerability Shield", icon: "🛡️", price: 4000, max: 2, act: "guard",
    blurb: "Raise it any time. The next blast that reaches you does nothing at all, and the shield is gone." },
  { key: "at_carpet", name: "Carpet Bomb", icon: "✈️", price: 3500, max: 2, act: "strike", aim: "column",
    blurb: "Takes your turn. Five explosions in a line across the column you point at." },
  { key: "at_triple", name: "Triple Shot", icon: "🔫", price: 2500, max: 3, act: "shot",
    blurb: "Three shells instead of one, six degrees apart. All three fly against the ground as it was." },
  { key: "at_homing", name: "Homing Missile", icon: "🚀", price: 2000, max: 4, act: "shot",
    blurb: "Turns toward the nearest enemy all the way down — enough to pull a shot that was nearly right onto the tank, nowhere near enough to rescue a bad one. A hill in the way still stops it." },
  { key: "at_leveler", name: "Terrain Leveler", icon: "🚧", price: 1800, max: 2, act: "strike", aim: "column",
    blurb: "Takes your turn and hurts nobody: 360 units of map are flattened to their own average height." },
  { key: "at_vampire", name: "Vampire Shell", icon: "🦸", price: 1500, max: 3, act: "shot",
    blurb: "Half of everything the shot deals comes back to you as health." },
  { key: "at_double", name: "Double Damage", icon: "✖️", price: 1200, max: 3, act: "shot",
    blurb: "Everything the shot deals, doubled — before any shield or armour on the other end." },
  { key: "at_emp", name: "EMP Blast", icon: "💡", price: 1000, max: 3, act: "turn", aim: "target",
    blurb: "Takes your turn. One tank loses its aiming line for its next turn and shoots by feel." },
  { key: "at_nowind", name: "Wind Nullifier", icon: "🌬️", price: 800, max: 1, act: "shot",
    blurb: "Your shot flies as though the wind were zero, whatever the gauge says." },
  { key: "at_napalm", name: "Napalm Fire", icon: "🔥", price: 750, max: 4, act: "shot",
    blurb: "A smaller blast that leaves a pool of fire: 12 a turn for three turns to anyone standing in it." },
  { key: "at_cluster", name: "Cluster Fragment", icon: "🧨", price: 600, max: 5, act: "shot",
    blurb: "Comes apart at the top of its arc into three smaller shells that finish the flight." },
  { key: "at_bouncy", name: "Bouncy Shell", icon: "⛳", price: 500, max: 5, act: "shot",
    blurb: "Bounces off the ground once — off the slope it landed on — instead of exploding." },
  { key: "at_repair", name: "Armor Repair", icon: "🔧", price: 450, max: 4, act: "turn",
    blurb: "Takes your turn. Twenty hit points back, never past a hundred." },
  { key: "at_tracer", name: "Tracer Round", icon: "📍", price: 400, max: 3, act: "sight",
    blurb: "In a duel with the aim assist off, it draws your arc for one turn \u2014 the exact flight, to where it lands. Costs you no turn to look. Worth nothing in a room that draws it for everybody, and the room will tell you so rather than taking the token." },
  { key: "at_chute", name: "Parachute", icon: "🪂", price: 300, max: 1, act: "guard",
    blurb: "For the whole duel: the ground can go from under you and the fall costs nothing." },
  { key: "at_armour", name: "Heavy Armor", icon: "🦺", price: 250, max: 4, act: "guard",
    blurb: "Raise it any time. The next hit lands fifteen per cent lighter, and the plate is spent." },
  { key: "at_mud", name: "Mud Shell", icon: "🪨", price: 200, max: 5, act: "shot",
    blurb: "Hurts nobody and raises a mound where it lands, instead of digging a crater." },
];

export const GAME_ARSENAL_ITEMS = {
  buzzer: BUZZER_ARSENAL_ITEMS,
  artillery: TANK_ARSENAL_ITEMS,
  prix: PRIX_ARSENAL_ITEMS,
  casino: CASINO_ARSENAL_ITEMS,
  crossword: WORD_ARSENAL_ITEMS, battleship: ARSENAL_ITEMS, minesweeper: MINE_ARSENAL_ITEMS, links: LINKS_ARSENAL_ITEMS };

/**
 * The shop, one arsenal per game: the game's 1.5\u00d7 boost first, then
 * whatever else that game sells. Other games' arsenals grow here too.
 */
export const GAME_ARSENALS = TOKEN_ITEMS.map((t) => ({
  game: t.game,
  name: `${t.name.replace(/ boost$/, "")} Arsenal`,
  icon: t.icon,
  items: [
    { key: t.game, name: t.name, icon: "\u26A1", price: TOKEN_PRICE, blurb: t.blurb },
    ...(GAME_ARSENAL_ITEMS[t.game] || []),
  ],
}));
/**
 * The multiplier shelf. It belongs to no game, so it is its own arsenal in
 * the shop rather than repeated on all eight.
 */
export const MULTIPLIER_ARSENAL = {
  game: "multipliers",
  name: "MMR Multipliers",
  icon: "\u2716\uFE0F",
  items: MULTIPLIER_ITEMS.map((m) => ({ key: m.key, name: m.name, icon: m.icon, price: m.price, blurb: m.blurb })),
};

export const SHOP_SHELVES = [MULTIPLIER_ARSENAL, ...GAME_ARSENALS];

export const shopItem = (key) =>
  SHOP_SHELVES.flatMap((a) => a.items).find((t) => t.key === key);

// The tab's own styles, carried with it so the golf page (which has none of
// the arena's stylesheet) draws the same window.
let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const css = document.createElement("style");
  css.textContent = `
.tok-modal { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 1rem; font-family: var(--body, inherit); }
.tok-back { position: absolute; inset: 0; background: rgba(2, 6, 23, .68); backdrop-filter: blur(4px); }
.tok-card { position: relative; width: min(30rem, 100%); max-height: 84vh; overflow-y: auto; background: rgba(15, 23, 42, .96); border: 1px solid rgba(255,255,255,.14); border-radius: 16px; box-shadow: 0 30px 80px rgba(2, 6, 23, .7); color: #eef2f7; }
.tok-head { display: flex; align-items: center; gap: .8rem; padding: .7rem .9rem; border-bottom: 1px solid rgba(255,255,255,.12); }
.tok-head h2 { flex: 1; margin: 0; font-family: var(--display, inherit); font-size: 1rem; letter-spacing: .08em; }
.tok-x { font: inherit; font-size: 1.1rem; line-height: 1; background: transparent; border: 1px solid rgba(255,255,255,.14); color: inherit; cursor: pointer; padding: .2rem .55rem; border-radius: 6px; }
.tok-body { padding: .9rem; display: grid; gap: .55rem; }
.tok-sub { margin: 0; font-size: .8rem; opacity: .75; }
.tok-row { display: grid; grid-template-columns: auto 1fr auto; gap: .7rem; align-items: center; padding: .5rem .65rem; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; background: rgba(255,255,255,.04); }
.tok-row.is-here { border-color: #F4CE5A; background: rgba(244, 206, 90, .08); }
.tok-ico { font-size: 1.45rem; line-height: 1; }
.tok-name { font-family: var(--display, inherit); font-weight: 800; font-size: .84rem; }
.tok-have { font-size: .68rem; opacity: .8; margin-top: .1rem; }
.tok-have b { color: #F4CE5A; }
.tok-else { font-size: .64rem; opacity: .6; text-align: right; max-width: 7rem; }
.tok-btn { font: inherit; font-weight: 700; font-size: .74rem; cursor: pointer; padding: .4rem .7rem; border-radius: 8px; border: 1px solid #F4CE5A; background: rgba(244, 206, 90, .16); color: #F4CE5A; white-space: nowrap; }
.tok-btn:disabled { opacity: .55; cursor: default; }
.tok-btn.is-on { background: #F4CE5A; color: #1a1400; }
.tok-note { margin: 0; font-size: .8rem; border-left: 2px solid rgba(255,255,255,.2); padding-left: .7rem; }
.tok-note.good { color: #F4CE5A; border-left-color: #F4CE5A; }
.tok-note.bad { color: #ff8a8a; border-left-color: #ff5c5c; }
.tok-empty { margin: 0; font-size: .8rem; opacity: .8; }
@keyframes tokpulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(244, 206, 90, 0); } 50% { box-shadow: 0 0 0 4px rgba(244, 206, 90, .35); } }
.tok-live { animation: tokpulse 1.6s ease-in-out infinite; border-color: #F4CE5A !important; color: #F4CE5A !important; }
.tok-h { margin: .5rem 0 0; font-family: var(--display, inherit); font-size: .78rem; letter-spacing: .1em; text-transform: uppercase; opacity: .8; display: flex; justify-content: space-between; }
.tok-row.ars .tok-have { opacity: .9; }
.tok-blurb { font-size: .66rem; opacity: .7; margin-top: .1rem; }
.tok-acts { display: flex; gap: .3rem; align-items: center; }
.tok-btn.tok-minus { padding: .4rem .55rem; }
.tok-hulls { display: flex; gap: .3rem; flex-wrap: wrap; margin-top: .3rem; }
.tok-hulls select { font: inherit; font-size: .7rem; background: rgba(255,255,255,.08); color: inherit; border: 1px solid rgba(255,255,255,.18); border-radius: 6px; padding: .2rem .3rem; }
.tok-off { font-size: .74rem; opacity: .7; }`;
  document.head.appendChild(css);
}

/**
 * The Apply Token tab of one game.
 *
 *   const tab = applyTokenTab({ game: "battleship", send, button: $("btn-battle-boost") });
 *   ... case "TOKENS": tab.receive(msg);
 *
 * `send` posts to the room's socket. `button` (optional) opens the tab and
 * lights up once a token is applied. `host` is where the window is drawn;
 * one is made at the end of <body> when none is given.
 */
export function applyTokenTab({ game, send, button, host, label, arsenal = false }) {
  ensureStyles();
  const here = tokenItem(game);
  let el = host || null;
  let state = { loading: true };

  const mount = () => {
    if (!el) { el = document.createElement("div"); el.hidden = true; document.body.appendChild(el); }
    return el;
  };

  function close() { if (el) { el.hidden = true; el.textContent = ""; } }

  function open() {
    const h = mount();
    h.hidden = false;
    state = { loading: true, applied: state.applied, tokens: state.tokens };
    draw();
    send({ type: "TOKENS" });
  }

  /** `key` picks a multiplier; without one it is the game's own boost. */
  function apply(key) {
    state = { ...state, busy: true, error: null };
    draw();
    send({ type: "APPLY_TOKEN", key });
  }

  function receive(msg) {
    state = { loading: false, busy: false, tokens: msg.tokens || {}, applied: !!msg.applied, error: msg.error || null, day: !!msg.day, arsenal: msg.arsenal || state.arsenal || null, appliedKey: msg.appliedKey || null, mult: msg.mult || null };
    if (button) button.classList.toggle("tok-live", state.applied);
    if (el && !el.hidden) draw();
  }

  /** A fresh arsenal view from the room, without a full reply. */
  function arsenalState(view) {
    state = { ...state, arsenal: view };
    if (el && !el.hidden) draw();
  }

  /** Forget the applied light — for a room that scored and moved on. */
  function reset() {
    state = { ...state, applied: false };
    if (button) button.classList.remove("tok-live");
  }

  function draw() {
    const h = mount();
    const tokens = state.tokens || {};
    const total = Object.values(tokens).reduce((a, n) => a + (n || 0), 0);
    // This game's boost only; the arsenal follows for games that have one.
    const rows = TOKEN_ITEMS.filter((t) => t.game === game).map((t) => {
      const n = tokens[t.game] || 0;
      const isHere = t.game === game;
      const right = isHere
        ? `<button class="tok-btn ${state.applied ? "is-on" : ""}" data-apply ${state.applied || state.busy || state.loading || n < 1 ? "disabled" : ""}>${
          state.applied ? "Applied ⚡" : state.busy ? "Applying…" : `Apply to this ${label || "match"}`}</button>`
        : `<span class="tok-else">Use in ${t.where}</span>`;
      return `<div class="tok-row ${isHere ? "is-here" : ""}">
        <span class="tok-ico">${t.icon}</span>
        <div><div class="tok-name">${t.name}</div><div class="tok-have">${state.loading ? "…" : n ? `You hold <b>${n}</b>` : "None held"}</div></div>
        ${right}
      </div>`;
    }).join("");
    // The multipliers, which work in any game and are therefore not on any
    // game's list. The casino has no match to put one on, so it does not
    // offer them; the floor refuses them too, in case this ever forgets.
    const mults = game === "casino" ? "" : MULTIPLIER_ITEMS.map((m) => {
      const n = tokens[m.key] || 0;
      const on = state.appliedKey === m.key;
      return `<div class="tok-row is-here">
        <span class="tok-ico">${m.icon}</span>
        <div><div class="tok-name">${m.name}</div><div class="tok-have">${state.loading ? "…" : n ? `You hold <b>${n}</b>` : "None held"}</div></div>
        <button class="tok-btn ${on ? "is-on" : ""}" data-apply-mult="${m.key}" ${state.applied || state.busy || state.loading || n < 1 ? "disabled" : ""}>${
          on ? "Applied ⚡" : `Apply ${m.mult}×`}</button>
      </div>`;
    }).join("");
    const worth = state.mult || 1.5;
    const note = state.error
      ? `<p class="tok-note bad">${state.error}</p>`
      : state.applied
        ? `<p class="tok-note good">⚡ Applied. ${state.day
          ? "Every casino win for the rest of today (UTC) pays half again."
          : `This ${label || "match"} pays ${worth}× MMR when it is scored.`}</p>`
        : !state.loading && total === 0
          ? `<p class="tok-empty">You hold none. Buy them with casino money in your profile under ⚡ Token shop.</p>`
          : "";
    h.innerHTML = `
      <div class="tok-modal">
        <div class="tok-back" data-close></div>
        <div class="tok-card" role="dialog" aria-modal="true" aria-label="Apply Token">
          <div class="tok-head"><h2>⚡ Apply Token</h2><button class="tok-x" data-close aria-label="Close">&times;</button></div>
          <div class="tok-body">
            <p class="tok-sub">Your ${String(here.where || "").replace(/^the /, "")} arsenal. Apply the ${here.name} and this ${label || "match"} pays half again on the MMR${here.game === "casino" ? " — on every win for the rest of the day" : ""}.</p>
            ${rows}
            ${mults ? `<p class="tok-sub">Multipliers work in any game. One to a ${label || "match"}, instead of the boost rather than as well as it.</p>${mults}` : ""}
            ${note}
            ${arsenal ? arsenalHtml() : ""}
          </div>
        </div>
      </div>`;
    h.querySelectorAll("[data-close]").forEach((n) => { n.onclick = close; });
    const b = h.querySelector("[data-apply]");
    if (b) b.onclick = () => apply();
    h.querySelectorAll("[data-apply-mult]").forEach((n) => {
      n.onclick = () => apply(n.dataset.applyMult);
    });
    h.querySelectorAll("[data-arm]").forEach((n) => {
      n.onclick = () => {
        const key = n.dataset.arm;
        const hulls = key === "bs_ships" ? [...h.querySelectorAll("[data-hull]")].map((x) => x.value) : undefined;
        state = { ...state, busy: true, error: null };
        draw();
        send({ type: "ARM_TOKEN", key, hulls });
      };
    });
    h.querySelectorAll("[data-disarm]").forEach((n) => {
      n.onclick = () => { state = { ...state, busy: true, error: null }; draw(); send({ type: "DISARM_TOKEN", key: n.dataset.disarm }); };
    });
  }

  // The arsenal, under the boost: what is held, what is armed, and the
  // buttons to arm and put back. The room says what is allowed.
  function arsenalHtml() {
    const ars = state.arsenal;
    const tokens = state.tokens || {};
    if (state.loading && !ars) return "";
    if (!ars) return "";
    const armedTotal = Object.values(ars.armed || {}).reduce((n, v) => n + v, 0);
    const head = `<h3 class="tok-h"><span>${here.name.replace(/ boost$/, "")} arsenal</span><span>Armed ${armedTotal}${ars.cap != null ? ` / ${ars.cap}` : ""}</span></h3>`;
    if (!ars.on) return head + `<p class="tok-off">The host has the arsenal switched off for this battle.</p>`;
    const list = Array.isArray(arsenal) ? arsenal : ARSENAL_ITEMS;
    const rows = list.map((t) => {
      const held = tokens[t.key] || 0;
      const armed = ars.armed?.[t.key] || 0;
      const used = ars.used?.[t.key] || 0;
      const limit = ars.max?.[t.key] ?? t.max;
      const canArm = !state.busy && held > armed && (ars.cap == null || armedTotal < ars.cap) && !(limit && armed >= limit) && !(t.key === "bs_ships" && armed);
      const canDisarm = !state.busy && armed > used;
      const hulls = t.key === "bs_ships" && !armed
        ? `<div class="tok-hulls">${[0, 1, 2].map((i) => `<select data-hull aria-label="Extra hull ${i + 1}">${HULL_OPTIONS.map(([v, l], j) => `<option value="${v}" ${j === [2, 3, 4][i] ? "selected" : ""}>${l}</option>`).join("")}</select>`).join("")}</div>`
        : t.key === "bs_ships" && armed && ars.hulls?.length ? `<div class="tok-blurb">Bringing: ${ars.hulls.map((x) => HULL_OPTIONS.find(([v]) => v === x)?.[1].replace(/ \(\d\)/, "") || x).join(", ")}</div>` : "";
      return `<div class="tok-row ars">
        <span class="tok-ico">${t.icon}</span>
        <div>
          <div class="tok-name">${t.name}</div>
          <div class="tok-blurb">${t.blurb}</div>
          <div class="tok-have">${held ? `You hold <b>${held}</b>` : "None held"}${armed ? ` \u00b7 armed <b>${armed}</b>${used ? ` (${used} used)` : ""}` : ""}</div>
          ${hulls}
        </div>
        <div class="tok-acts">
          ${canDisarm ? `<button class="tok-btn tok-minus" data-disarm="${t.key}" title="Put one back">\u2212</button>` : ""}
          <button class="tok-btn" data-arm="${t.key}" ${canArm ? "" : "disabled"}>${armed ? "Arm another" : "Arm"}</button>
        </div>
      </div>`;
    }).join("");
    const foot = game === "prix"
      ? "Everything armed takes hold at the lights, so what you arm is what you spend."
      : "Armed tokens are fired from the Arsenal strip on the game screen. Only what you use is spent; the rest stays armed.";
    return head + rows + `<p class="tok-sub">${foot}</p>`;
  }

  if (button) button.onclick = open;
  return { open, close, receive, reset, arsenalState };
}
