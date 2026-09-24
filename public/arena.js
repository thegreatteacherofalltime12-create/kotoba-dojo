// Ten karate gi, one per colour. Drawn rather than fetched, because a hosted
// page can't load images from anywhere else and inline SVG scales cleanly.

export const GI_COLORS = [
  { id: "white",  name: "White",  robe: "#ece2cf", belt: "#3b3b42" },
  { id: "crimson",name: "Crimson",robe: "#b8321f", belt: "#2a1410" },
  { id: "gold",   name: "Gold",   robe: "#e0b32a", belt: "#3a2d08" },
  { id: "jade",   name: "Jade",   robe: "#4c8a45", belt: "#16240f" },
  { id: "azure",  name: "Azure",  robe: "#2f6fa8", belt: "#0d1c2b" },
  { id: "violet", name: "Violet", robe: "#6b4a94", belt: "#1c1229" },
  { id: "clay",   name: "Clay",   robe: "#8a5a3c", belt: "#241408" },
  { id: "slate",  name: "Slate",  robe: "#5b6472", belt: "#171b21" },
  { id: "sand",   name: "Sand",   robe: "#c2a878", belt: "#3a2e18" },
  { id: "ink",    name: "Ink",    robe: "#22242b", belt: "#c9a227" },
];

export function giSvg(id, size = 40) {
  const gi = GI_COLORS.find((g) => g.id === id) || GI_COLORS[0];
  return `
<svg viewBox="0 0 48 48" width="${size}" height="${size}" role="img" aria-label="${gi.name} gi">
  <rect width="48" height="48" fill="#0f1116"/>
  <circle cx="24" cy="13" r="6.4" fill="#d9b48f"/>
  <path d="M10 44v-13c0-6 4-10 8.5-11.4L24 27l5.5-7.4C34 21 38 25 38 31v13z" fill="${gi.robe}"/>
  <path d="M18.5 19.6 24 27l-4 17h-3z" fill="#000" opacity=".14"/>
  <path d="M29.5 19.6 24 27l4 17h3z" fill="#fff" opacity=".10"/>
  <rect x="10" y="34" width="28" height="4.6" fill="${gi.belt}"/>
  <rect x="21.6" y="34" width="4.8" height="8" fill="${gi.belt}"/>
</svg>`.trim();
}

// Every mode the dojo offers. Adding a game here is all it takes for it to
// appear under Create Match — nothing else in the UI needs touching.
/**
 * Every playable game. `game` is the room type: it decides which Durable
 * Object a code belongs to and which screen opens. Adding a game here and
 * adding its opener to ROOMS in app.js is the whole wiring — codes, the open
 * rooms board and Create Match all read from this list.
 */
export const GAME_MODES = [
  {
    id: "dojo-crossword",
    name: "Word Cross Challenges",
    players: "1 or more",
    blurb: "Ten words, one clock. Train alone or open it up — everyone races the same grid independently, and three or more solvers makes it a Rumble where placement pays.",
    kind: "match",
    game: "crossword",
    available: true,
  },
  {
    id: "battleships",
    name: "Battleship Royale",
    players: "2-8 players",
    blurb: "Place a fleet, then two shots a turn at one rival. You must fire at three others before coming back to anyone.",
    kind: "match",
    game: "battleship",
    available: true,
  },
  {
    id: "grand-prix",
    name: "Multiverse Grand Prix",
    players: "1 or more",
    blurb: "A kart race where your vocabulary is the engine. Unscramble a word to move; the quicker you are for your own level, the further you go.",
    kind: "match",
    game: "prix",
    available: true,
  },
  {
    id: "minesweeper",
    name: "Minesweeper",
    players: "1 or more",
    blurb: "Everyone races the same field. Clear it fastest, or get as far as you can before one goes off.",
    kind: "match",
    game: "minesweeper",
    available: true,
  },
  {
    id: "casino",
    name: "Casino",
    blurb: "An open floor. One horse race, one bet board, one dealer — walk in whenever, back your own slip or copy somebody else's. Cash is its own economy and banks to your wallet.",
    players: "Open lobby",
    kind: "match",
    game: "casino",
    available: true,
  },
  {
    id: "links",
    name: "Multiverse Golf",
    players: "1 or more",
    blurb: "Eighteen holes of word golf. Each hole deals you a scrambled word \u2014 unscramble it, and every letter you put in its place is yards down the fairway. Two swings is an eagle. Six real courses, and everyone in a room is dealt the same letters.",
    kind: "match",
    game: "links",
    available: true,
  },
  {
    id: "gauntlet",
    name: "Gauntlet",
    players: "1 player",
    blurb: "Beat all eight belts in a row.",
    kind: "solo",
    available: false,
  },
];
