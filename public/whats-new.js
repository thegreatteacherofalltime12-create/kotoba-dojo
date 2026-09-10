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
    at: "2026-09-10T16:00:00Z",
    where: "New game",
    title: "Multiverse Golf",
    text: "Eighteen holes of word golf. Each hole is a hidden word \u2014 guess it, and how "
      + "well you guessed is how far the ball travels. Solve it in two for an eagle. Six real "
      + "courses, three sets of tees, and everyone in a room plays the same holes with the same "
      + "words. Points go to your MMR when the round ends.",
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
