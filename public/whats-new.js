// What's changed, in the players' words rather than ours.
//
// This is the one file to edit when something ships. Add an entry at the top
// with the time it went out; everything else follows from that.
//
//   `at`    when it shipped, ISO. Drives both the pulse and the ordering.
//   `title` a few words, shown in bold.
//   `text`  a sentence or two. What changed and where to find it.
//   `where` optional, names the part of the game it touches.
//
// The tab pulses while anything here is newer than PULSE_HOURS and unread.
// Notes stay readable for KEEP_DAYS so somebody who plays twice a week still
// finds out what happened.

export const PULSE_HOURS = 12;
export const KEEP_DAYS = 7;

export const UPDATES = [
  {
    at: "2026-09-22T20:00:00Z",
    where: "Word-Cross",
    title: "The Word-Cross arsenal",
    text: "Eighteen tokens for the dojo. Sight: Free Letter, Word Shape, First Letters, Anagram Sheet, "
      + "Spellcheck, Sensei's Eye, Theme Reading. Solving for you: Random Gift, Shortest Straw, Free "
      + "Word, Last Word, and a Cascade that takes everything its crossings complete. Points: Head "
      + "Start, Perfect Ink, Double Ink, Salvage, Fast Hands, and a Quiet Grid that hides your progress "
      + "from the field. Game Modes now marks every game that can be played alone \u2014 which is all of them.",
  },
  {
    at: "2026-09-22T18:00:00Z",
    where: "Battleship",
    title: "Eleven more for the fleet",
    text: "The Battleship Arsenal is eighteen tokens now, and you may arm six a battle instead of four. "
      + "Scouting: Sonar Ping, Radar Sweep, Spotter Plane, Periscope. Firepower: Depth Charge, and "
      + "Priority Target, which lifts the rotation for a turn. Damage control: Point Defence, Repair "
      + "Crew, Reinforced Hull, Evasive Maneuvers, and a Smoke Screen that reports every hit on you as "
      + "a miss until it clears.",
  },
  {
    at: "2026-09-22T16:00:00Z",
    where: "Minesweeper",
    title: "Fourteen more for the minefield",
    text: "The Minesweeper Arsenal is eighteen tokens now. Scouts: Metal Detector, Radar Sweep, Quadrant "
      + "Scan, Spotter Drone, Frontier Flags. Survival: Sapper's Gloves, Second Sweep, Recon Patrol. "
      + "Ground: Demolition Charge, Lucky Opening, Chord. And three that change what the round is worth "
      + "\u2014 Stopwatch, Hazard Pay and Field Promotion.",
  },
  {
    at: "2026-09-22T05:00:00Z",
    where: "Multiverse Golf",
    title: "The golf arsenal",
    text: "Eighteen tokens for Multiverse Golf: a Mulligan takes a stroke back, a Gimme concedes the hole "
      + "at par, Caddie's Hint and Local Knowledge place letters, Lucky Bounce caps a bad hole at par, "
      + "Double Down and Eagle Eye and Ace Chaser pay out on a good one, and the Scorecard Pencil strikes "
      + "your worst hole from the card. Arm them under \u26A1 Apply Token, fire them from the strip above "
      + "the hole. Only what you use is spent.",
  },
  {
    at: "2026-09-21T20:30:00Z",
    where: "Token shop",
    title: "Every token is a tenth of the price",
    text: "Every price in the Token shop has lost its last digit: a boost is $200, a nuke is $50,000, a "
      + "torpedo is $143, Clear Map is $20,000. Same tokens, same rules, a tenth of the cost.",
  },
  {
    at: "2026-09-21T18:00:00Z",
    where: "Minesweeper",
    title: "The Minesweeper arsenal",
    text: "Four tokens in the Minesweeper Arsenal: Mine Reveal shows two mines, Mine Buster destroys one "
      + "(Intermediate and Expert), Clear Map opens a 5×5 before your first dig — a mine inside ends "
      + "you — and Invincibility makes ten seconds explosion-proof. Arm them under ⚡ Apply Token, "
      + "fire them from the strip above the field. Only what you use is spent.",
  },
  {
    at: "2026-09-21T04:00:00Z",
    where: "Battleship",
    title: "The arsenal",
    text: "The Token shop is now one arsenal per game — tap a game to open its window, with its 1.5× boost "
      + "first. Seven new tokens in the Battleship Arsenal: Nuke Missile, Extra Shots, Extra Ships, "
      + "Tactical Air Strike, Air Strike Defence, Air Strike Reveal and Submarine Torpedo. Arm up to four a "
      + "battle (two nukes at most) under \u26A1 Apply Token, then fire them from the Arsenal strip. Only what "
      + "you use is spent. The rule book has every rule.",
  },
  {
    at: "2026-09-20T16:00:00Z",
    where: "Sign-in",
    title: "Keys at the door",
    text: "The game is sold on Etsy. Registering now asks for the order number on your receipt — "
      + "that number is your key, locked to your account for good, and it resets a forgotten pin from "
      + "the sign-in page. Everyone already playing is in without one. The invite now points new "
      + "players at the listing.",
  },
  {
    at: "2026-09-20T01:00:00Z",
    where: "Sign-in",
    title: "Guest play has ended",
    text: "Everyone plays under a registered name now. If you were training as a guest, register a "
      + "name and a pin — it takes ten seconds, and everything from here on is yours to keep.",
  },
  {
    at: "2026-09-19T21:00:00Z",
    where: "Every game",
    title: "Apply Token",
    text: "Every game now carries an \u26A1 Apply Token tab that lists the boost tokens you've bought. "
      + "A token no longer fires on its own: open the tab inside the game and apply it to the match "
      + "you're in, and that round pays 1.5\u00D7 MMR. The casino's applies to the rest of the day.",
  },
  {
    at: "2026-09-19T19:30:00Z",
    where: "Profile",
    title: "The token shop",
    text: "Billing is gone \u2014 nothing in the game costs real money. Casino money buys boost tokens "
      + "instead: one for each game, $200 apiece from your wallet, under Token shop in your profile. "
      + "A token pays half again on the MMR of the round it's applied to; the "
      + "casino one boosts every win for a day. The feed marks a boosted win \u26A1.",
  },
  {
    at: "2026-09-19T18:30:00Z",
    where: "Conduct",
    title: "The chats are screened",
    text: "Every line in the arena chat and the game chats is checked before it is posted \u2014 no "
      + "links or pictures, nothing sexual, hateful or abusive. A refused line is a strike and you are "
      + "told why; three strikes and the account is removed from the arena, with one request for "
      + "review to the admin. The rule book has the full Conduct section.",
  },
  {
    at: "2026-09-19T17:30:00Z",
    where: "Casino",
    title: "Wins on the floor pay MMR",
    text: "Every hand you win at any table, and every race you collect on, is worth 5 MMR \u2014 up to "
      + "100 a day. The floor log says so beside the win, and your lifetime stats count them.",
  },
  {
    at: "2026-09-19T17:00:00Z",
    where: "Prestige",
    title: "Retire with honours",
    text: "Reach General and a blue button appears on your card: retire from the Space Force with the "
      + "Medal of Honor beside your name, your MMR and prestige go back to zero, and you enlist in the "
      + "Army \u2014 nine enlisted ranks, then ten officer ranks \u2014 then the Navy, the Marine Corps, "
      + "the Air Force and the Coast Guard. Every title, frame and banner you earned stays yours; "
      + "lifetime MMR counts every ladder climbed. Each retirement adds one to the medal (\u00d71, "
      + "\u00d72\u2026), the rankings put retirees first, and Retired All Stars in Achievements "
      + "lists them. Golf courses now wear their own photos.",
  },
  {
    at: "2026-09-19T03:20:00Z",
    where: "Everywhere",
    title: "Achievements, record books, and a tidier Create Match",
    text: "A new Achievements tab (in Everything else on a phone) shows every banner, title and "
      + "frame you have earned and your lifetime stats. Your record is private unless you switch it "
      + "to Public \u2014 then anyone can tap your name in the Arena Rankings to see it. Records grew "
      + "Battleship (most hits, ships sunk, captains eliminated), Golf course records per course, and "
      + "a Hall of Fame cut every three months. Create Match is a plain grid of games. The maths "
      + "arcade mixes in second-grade sums and the fast bonus needs an answer inside seven seconds.",
  },
  {
    at: "2026-09-17T21:00:00Z",
    where: "Battleship",
    title: "Aim pays, fire spreads, and up to five computers",
    text: "Your accuracy now shapes your score: half your shots landing is par, sharper shooting "
      + "earns up to three quarters more, spraying the water costs up to a quarter. With several "
      + "opponents you can spread a turn's shots over more than one captain \u2014 two here, two there, "
      + "or all on one. Solo Match now lets you face one to five computers at one difficulty; they "
      + "follow the same rotation as everyone else, so the table can never pile onto you, and Hard "
      + "ones split their fire.",
  },
  {
    at: "2026-09-17T19:30:00Z",
    where: "Arena Rankings",
    title: "Ten more banners",
    text: "Speed Reader and Lone Scholar for Word-Cross; Dead Eye and Open Ocean for Battleship; "
      + "Lightning Sweep and Lone Sapper for Minesweeper; Hole in One and Grand Tour for golf; Jackpot "
      + "for a single cash-out of $500 or more; and Multiverse Tourist for playing every game at "
      + "least once. Each shows how far along you are.",
  },
  {
    at: "2026-09-17T18:30:00Z",
    where: "Arena Rankings",
    title: "Banners",
    text: "Eighteen banners, three a game, each a moving backdrop on your row in the Arena Rankings. "
      + "Earned by what you do: a first win, ten boards cleared, twenty hulls sunk, a round under "
      + "par, a thousand dollars banked, a hundred games played. Every finished round now counts "
      + "toward them, so the tally starts today. Pick yours under Banners in your fighter profile.",
  },
  {
    at: "2026-09-17T16:00:00Z",
    where: "Profile",
    title: "Dress your fighter",
    text: "Tap your avatar on the card. Keep your gi under OG Robes, or pick from a hundred-odd emoji "
      + "and every NFL, NHL, MLB and USL side. Thirty frames in three tiers \u2014 Rare are free, Epic "
      + "open at Green belt and travel their colours round you, Legendary open with your first "
      + "prestige and pulse. Twenty-four titles, earned by lifetime MMR. The Arena Rankings show all "
      + "of it; the podium's frames move, everyone else's hold still until they climb. Banners next.",
  },
  {
    at: "2026-09-16T18:40:00Z",
    where: "Battleship",
    title: "Fleet Action and Open Ocean open for business",
    text: "Picking the bigger charts used to leave the room on the old 10\u00d710 board and the "
      + "server refusing every fleet. The chart, its fleet and its shots a turn now reach every "
      + "captain the moment the host picks it. Also: on a phone, the header folds into Create Match "
      + "and one Everything else button.",
  },
  {
    at: "2026-09-15T00:00:00Z",
    where: "Everywhere",
    title: "A lighter arena",
    text: "The home screen used to ask the database for the chat, the feed and the rankings from every "
      + "browser, every few seconds. It now asks once and shares the answer, so the game costs a "
      + "fraction of what it did to keep open and nothing you see has changed. Polls also rest while "
      + "a tab is in the background, and the chat takes twelve lines a minute from one person.",
  },
  {
    at: "2026-09-13T21:58:58Z",
    where: "Battleship",
    title: "Three charts to fight on",
    text: "The host now picks the theatre. Skirmish is the old 10\u00d710 with five ships and two "
      + "shots a turn. Fleet Action is 15\u00d715 with seven ships and four shots. Open Ocean is "
      + "20\u00d720 with nine ships and five shots \u2014 three carriers apiece. The host can also hide "
      + "captains' names, so everyone shows as Captain A, B and C.",
  },
  {
    at: "2026-09-13T14:48:00Z",
    where: "Word-Cross",
    title: "Twenty-four new categories",
    text: "Science, Math, American History and American Myths — six categories each, every "
      + "one at easy, medium and hard. Biology to The Human Body, Arithmetic to Probability, "
      + "The Revolution to Civil Rights, Tall Tales to Founding Legends. Six hundred puzzles "
      + "in all. The category list shows six at a time and scrolls for the rest.",
  },
  {
    at: "2026-09-13T14:48:00Z",
    where: "Arena",
    title: "Chat lets you know",
    text: "When somebody posts and you haven't seen it, the Chat tab pulses gold until you "
      + "open it. Your own lines don't count. And the sign-in page stands on Earth again.",
  },
  {
    at: "2026-09-13T14:16:00Z",
    where: "Word-Cross",
    title: "The crossword plays in orbit",
    text: "Earth and the nebula behind the grid. Every game will get a ground of its own.",
  },
  {
    at: "2026-09-13T14:09:00Z",
    where: "Arena",
    title: "The home screen, tidied",
    text: "Chat, Feed and Open Rooms are one panel now, closed until you tap a tab; it "
      + "remembers which you left open. Belts moved into View Rules. Bounty moved into "
      + "Records beside Wallets. And the default theme has a new ground — the cobra in "
      + "orbit — with a crop that fits any phone.",
  },
  {
    at: "2026-09-13T13:49:00Z",
    where: "Rankings",
    title: "Officers outrank everyone",
    text: "Prestige comes first in the Arena Rankings now: every officer above everyone "
      + "unranked, higher rank first, MMR only settling ties within a rank. Each officer wears "
      + "their Space Force insignia and title beside their name — drawn properly, from the "
      + "gold bar up to four stars. Three on the podium by default; tap the bar for the full "
      + "list.",
  },
  {
    at: "2026-09-13T12:39:00Z",
    where: "Fix",
    title: "No more phantom updates",
    text: "The app was telling everyone a new version was ready on every load, reload or not, "
      + "because two build stamps had drifted apart. They're written together now. You'll see "
      + "the bar only when there's actually something new.",
  },
  {
    at: "2026-09-13T12:26:00Z",
    where: "Casino",
    title: "Pai Gow, set on the table",
    text: "Pick your two-card low hand with both hands named as you tap, house way to start, "
      + "and Set Hand & Compare when you're happy. The result lays out yours and the dealer's "
      + "as high and low, then a line per bet and the net.",
  },
  {
    at: "2026-09-13T01:26:00Z",
    where: "Casino",
    title: "Three-Card and Criss Cross, dealt properly",
    text: "Three-Card deals the dealer's three face down over your three face up, fold and "
      + "play side by side. Criss Cross lays the cross out as a cross — the horizontal three "
      + "are your across hand, the vertical three your down hand, the middle belongs to both — "
      + "and turns each arm as you bet it.",
  },
  {
    at: "2026-09-13T01:18:00Z",
    where: "Casino",
    title: "Hi-Lo, one card at a time",
    text: "Bet, deal, see your card, then call higher or lower and eight-or-higher or under "
      + "eight. The second card turns over on a beat and the verdict lands after it. Also: the "
      + "Wallets board in Records places the top ten, 1st to 10th, and stays live while it's open.",
  },
  {
    at: "2026-09-13T01:18:00Z",
    where: "Feed",
    title: "Every game, and who played",
    text: "Golf rounds were showing up as Word-Cross. Every game is named now, and the line "
      + "says who else was in it — “Ana won Battleship · vs Bo, Cy”.",
  },
  {
    at: "2026-09-13T01:00:00Z",
    where: "Multiverse Golf",
    title: "Every hole is a scramble",
    text: "The letters of the word are dealt face up, shuffled, and the swing is putting them "
      + "right — on every tee. Green is in place, gold is the wrong spot, and the ball goes as "
      + "far as the letters that landed.",
  },
  {
    at: "2026-09-11T14:07:00Z",
    where: "Multiverse Golf",
    title: "You call the start",
    text: "Nothing tees off on its own. Create a match, pick a course — or Random, which "
      + "draws a new one every round — and press Tee off when you're ready. Play solo, or open "
      + "a room where you call the start. A solo round is yours alone; nobody else can walk in.",
  },
  {
    at: "2026-09-11T14:07:00Z",
    where: "Battleship",
    title: "Latecomers are welcome",
    text: "Walk into a battle already under way and you get ten seconds to lay a fleet, then a "
      + "slot behind whoever's firing. Nobody can shoot at you while you're placing. The door "
      + "closes once it's down to the last two captains.",
  },
  {
    at: "2026-09-10T16:00:00Z",
    where: "New game",
    title: "Multiverse Golf",
    text: "Eighteen holes of word golf. Each hole deals you a scrambled word \u2014 unscramble "
      + "it, and every letter you put in its place is yards down the fairway. Solve it in two "
      + "for an eagle. Six real courses, three sets of tees, and everyone in a room is dealt "
      + "the same letters. Points go to your MMR when the round ends.",
  },
  {
    at: "2026-09-09T14:00:00Z",
    where: "Word-Cross",
    title: "St. Louis City SC scrolls",
    text: "A new category with three grids. City SC Basics covers the club as it stands, "
      + "Founding the Club covers how it was built, and Before the City goes back through "
      + "a century of St. Louis soccer \u2014 the Billikens, the 1950 World Cup side, the Stars "
      + "and the Steamers.",
  },
  {
    at: "2026-09-09T13:00:00Z",
    where: "Word-Cross",
    title: "America scrolls",
    text: "A new category with two grids: all fifty State Capitals, and State Animals "
      + "covering the official state mammals. Both are untimed \u2014 they pay 50 MMR a word "
      + "whether or not you finish, plus 500 for completing one inside twenty minutes.",
  },
  {
    at: "2026-09-09T13:00:00Z",
    where: "Word-Cross",
    title: "Scrolls are published",
    text: "Anything you write in the scroll writer now goes to a shared library, so "
      + "everyone can open a dojo on it. Your scrolls show how many times they've been "
      + "played and how many people solved them.",
  },
  {
    at: "2026-09-09T00:30:00Z",
    where: "Casino",
    title: "The horse race runs on cards",
    text: "Five trap cards are dealt face down before the off and turn over once the whole "
      + "field is past them, knocking back whichever runner is on the card. The deck and the "
      + "card just turned sit below the track.",
  },
  {
    at: "2026-09-09T00:30:00Z",
    where: "Casino",
    title: "A favourite every twelve hours",
    text: "One of the seven runners carries a blue ribbon and wins about two races in three. "
      + "It changes at midnight and midday, and no horse takes the ribbon twice until all "
      + "seven have had a turn.",
  },
  {
    at: "2026-09-08T16:45:00Z",
    where: "Casino",
    title: "The Big Six wheel spins",
    text: "Fifty-four segments, and you can back as many symbols as you like \u2014 one spin "
      + "settles the whole board. The wedges you have money on light up as it slows.",
  },
];
