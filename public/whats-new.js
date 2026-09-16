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
