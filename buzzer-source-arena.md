# The Buzzer — source pack for the arena categories

Twelve categories are about this arena itself. Every answer in them has to be
true of the code as it stands, so this file is the code, pulled out of the
repo at the moment of writing rather than remembered.

**Read this, not the rule sheets.** `public/game-modes.js` is prose written
for players and is known to be out of date about the horse race. Where a
literal and the program disagree, the program wins — and there is a live
example of that below, in the horse race's `BETS` array, whose declared
payouts are overwritten by a `PRICES` loop twelve lines later.

Line numbers are from the working tree on 2026-09-26.

---

## BATTLESHIP ROYALE  `battleship`

### src/battleship.js — `export const MAPS`

```js
   14  export const MAPS = {
   15    easy:   { id: "easy",   name: "Skirmish", size: 10, shots: 2 },
   16    medium: { id: "medium", name: "Fleet Action", size: 15, shots: 4 },
   17    hard:   { id: "hard",   name: "Open Ocean", size: 20, shots: 5 },
   18  };
```

### src/battleship.js — `export const FLEETS`

```js
   46  export const FLEETS = {
   47    easy:   fleetOf({ carrier: 1, battleship: 1, cruiser: 1, submarine: 1, destroyer: 1 }),
   48    medium: fleetOf({ carrier: 2, battleship: 1, cruiser: 1, submarine: 1, destroyer: 2 }),
   49    hard:   fleetOf({ carrier: 3, battleship: 1, cruiser: 1, submarine: 1, destroyer: 3 }),
   50  };
```

### src/battleship.js — `export const ARM_CAP`

```js
   62  export const ARM_CAP = 6;
   63  export const NUKE_MAX = 2;
   64  export const EXTRA_HULLS = 3;
   65  export const SONAR_SPAN = 3;      // the sonar's window
```

### src/arsenals.js — `  battleship: {`

```js
   48    battleship: {
   49      bs_nuke:    { name: "Nuke Missile",        price: 50_000, max: 2, icon: "☢️" },
   50      bs_shots:   { name: "Extra Shots",          price: 2_500,  icon: "\u{1F3AF}" },
   51      bs_ships:   { name: "Extra Ships",          price: 500,     icon: "\u{1F6A2}" },
   52      bs_strike:  { name: "Tactical Air Strike",  price: 3_500,  icon: "✈️" },
   53      bs_shield:  { name: "Air Strike Defence",   price: 4_000,  icon: "\u{1F6E1}️" },
   54      bs_reveal:  { name: "Air Strike Reveal",    price: 1_300,  icon: "\u{1F52D}" },
   55      bs_torpedo: { name: "Submarine Torpedo",    price: 143,   icon: "\u{1F41F}" },
   56      bs_sonar:   { name: "Sonar Ping",          price: 900,   max: 4, icon: "\u{1F50A}" },
   57      bs_radar:   { name: "Radar Sweep",         price: 1_500, max: 3, icon: "\u{1F4E1}" },
   58      bs_spotter: { name: "Spotter Plane",       price: 1_200, max: 3, icon: "\u{1F6E9}\uFE0F" },
   59      bs_scope:   { name: "Periscope",           price: 700,   max: 3, icon: "\u{1F52D}" },
   60      bs_depth:   { name: "Depth Charge",        price: 2_000, max: 3, icon: "\u{1F4A3}" },
   61      bs_priority:{ name: "Priority Target",     price: 1_000, max: 3, icon: "\u{1F3AF}" },
   62      bs_point:   { name: "Point Defence",       price: 1_600, max: 3, icon: "\u{1F6DF}" },
   63      bs_repair:  { name: "Repair Crew",         price: 3_000, max: 2, icon: "\u{1F527}" },
   64      bs_armour:  { name: "Reinforced Hull",     price: 2_600, max: 2, icon: "\u{1F6E1}" },
   65      bs_evade:   { name: "Evasive Maneuvers",   price: 2_200, max: 2, icon: "\u2194\uFE0F" },
   66      bs_smoke:   { name: "Smoke Screen",        price: 4_500, max: 1, icon: "\u{1F32B}\uFE0F" },
   67    },
```

---

## THE MULTIVERSE GRAND PRIX  `prix`

### src/prix.js — `export const CIRCUITS`

```js
   22  export const CIRCUITS = [
   23    { id: "reef", name: "Neon Reef", sub: "Wide, bright, forgiving", ico: "\u{1F41A}", hard: "easiest", boxes: 3, lapM: 800 },
   24    { id: "cinder", name: "Cinder Rally", sub: "The one to learn on", ico: "\u{1F5FB}", hard: "middle", boxes: 4, lapM: 800 },
   25    { id: "canyon", name: "The Glass Canyon", sub: "One long straight", ico: "\u{1F3DC}️", hard: "middle", boxes: 2, lapM: 800 },
   26    { id: "orbital", name: "Orbital Ring", sub: "Short laps, constant contact", ico: "\u{1FA90}", hard: "middle", boxes: 4, lapM: 500 },
   27    { id: "bramble", name: "Bramble Hollow", sub: "Items everywhere", ico: "\u{1F33F}", hard: "middle", boxes: 8, lapM: 800 },
   28    { id: "midnight", name: "Midnight Circuit", sub: "The hard one", ico: "\u{1F311}", hard: "hardest", boxes: 3, lapM: 800 },
   29  ];
```

### src/prix.js — `export const LENGTHS`

```js
   33  export const LENGTHS = [
   34    { id: "sprint", name: "Sprint", laps: 2, sub: "3 to 4 minutes" },
   35    { id: "gp", name: "Grand Prix", laps: 3, sub: "5 to 7 minutes" },
   36    { id: "endurance", name: "Endurance", laps: 5, sub: "9 to 12 minutes" },
   37  ];
```

### src/prix.js — `export const ITEMS`

```js
  123  export const ITEMS = [
  124    { id: "slipstream", name: "Slipstream", ico: "\u{1F4A8}", aim: "self",
  125      blurb: `Straight to ${SLIPSTREAM_M} metres of distance.` },
  126    { id: "nitro", name: "Nitro Word", ico: "\u26A1", aim: "self",
  127      blurb: "Your word solves itself, at a full boost." },
  128    { id: "deflector", name: "Deflector", ico: "\u{1F6E1}\uFE0F", aim: "self",
  129      blurb: "Eats the next item aimed at you." },
  130    { id: "slick", name: "Oil Slick", ico: "\u{1FAB6}", aim: "drop",
  131      blurb: `Dropped behind you. The next kart across it loses ${SLICK_M} metres.` },
  132    { id: "comet", name: "Comet", ico: "\u2604\uFE0F", aim: "ahead",
  133      blurb: `The racer directly ahead loses their word and ${COMET_M} metres.` },
  134    { id: "scrambler", name: "Scrambler", ico: "\u{1F300}", aim: "ahead",
  135      blurb: "Reshuffles the letters of the racer ahead and hides their clue." },
  136    { id: "fog", name: "Fog Bank", ico: "\u{1F32B}\uFE0F", aim: "field",
  137      blurb: "Hides the clue from everyone ahead of you." },
  138    { id: "flare", name: "Solar Flare", ico: "\u{1F31E}", aim: "field",
  139      blurb: "Everyone ahead answers for less for eight seconds. From 4th or worse." },
  140  ];
```

### src/prix-engines.js — `export const ENGINES`

```js
  355  export const ENGINES = [words, maths, memory, trivia];
  356  export const engineById = (id) => ENGINES.find((e) => e.id === id) || words;
  357  /** What the browser is told about them: never a deal, never an answer. */
  358  export const engineList = () => ENGINES.map((e) => ({
  359    id: e.id, name: e.name, sub: e.sub, kind: e.kind,
  360    levels: e.levels.map((l) => ({ id: l.id, name: l.name, sub: l.sub, mult: l.mult })),
  361    ...(e.themes ? { themes: e.themes } : {}),
  362  }));
  363  /**
  364   * The clock a racer on this level works to, for the moments before their
  365   * first item exists — the lights, and anything that moves a kart that has
  366   * not been dealt to yet.
  367   */
  368  export const nominalAllowance = (engineId, levelId) => {
  369    const e = engineById(engineId);
  370    return (e.pace ? e.pace(levelId) : 15_000) || 15_000;
  371  };
```

### src/arsenals.js — `  prix: {`

```js
   88    prix: {
   89      gp_start:   { name: "Start Boost",        price: 600,   max: 3, icon: "\u{1F6A6}" },
   90      gp_tow:     { name: "Tow Rope",           price: 900,   max: 3, icon: "\u{1FA9D}" },
   91      gp_slip:    { name: "Slipstream Canister", price: 1_200, max: 2, icon: "\u{1F4A8}" },
   92      gp_nitro:   { name: "Nitro Canister",     price: 1_500, max: 2, icon: "\u26A1" },
   93      gp_fuel:    { name: "Long Fuel",          price: 1_800, max: 1, icon: "\u26FD" },
   94      gp_warmup:  { name: "Warm-Up Lap",        price: 700,   max: 3, icon: "\u{1F321}\uFE0F" },
   95      gp_tyres:   { name: "Slick Tyres",        price: 700,   max: 1, icon: "\u{1F6DE}" },
   96      gp_seal:    { name: "Scrutineer's Seal",  price: 1_100, max: 3, icon: "\u{1F6E1}\uFE0F" },
   97      gp_guards:  { name: "Mudguards",          price: 800,   max: 1, icon: "\u{1F6E2}\uFE0F" },
   98      gp_visor:   { name: "Sun Visor",          price: 1_000, max: 1, icon: "\u{1F576}\uFE0F" },
   99      gp_radio:   { name: "Pit Radio",          price: 600,   max: 1, icon: "\u{1F4FB}" },
  100      gp_spotter: { name: "Spotter",            price: 900,   max: 3, icon: "\u{1F52D}" },
  101      gp_spare:   { name: "Spare Word",         price: 500,   max: 5, icon: "\u{1F9F0}" },
  102      gp_tele:    { name: "Telemetry",          price: 1_300, max: 1, icon: "\u{1F4E1}" },
  103      gp_twin:    { name: "Twin Box",           price: 2_000, max: 1, icon: "\u{1F381}" },
  104      gp_magnet:  { name: "Box Magnet",         price: 1_400, max: 3, icon: "\u{1F9F2}" },
  105      gp_polish:  { name: "Podium Polish",      price: 2_500, max: 2, icon: "\u{1F3C6}" },
  106      gp_points:  { name: "Points Finish",      price: 3_000, max: 1, icon: "\u{1F3C1}" },
  107    },
```

---

## MIND THE MINES  `mines`

### src/minesweeper.js — `export const LEVELS`

```js
    6  export const LEVELS = [
    7    { id: "beginner",     name: "Beginner",     rows: 9,  cols: 9,  mines: 10, blurb: "Nine by nine, ten mines." },
    8    { id: "intermediate", name: "Intermediate", rows: 16, cols: 16, mines: 40, blurb: "Sixteen square, forty mines." },
    9    { id: "expert",       name: "Expert",       rows: 16, cols: 30, mines: 99, blurb: "Wide board, ninety-nine mines." },
   10  ];
```

### src/arsenals.js — `  minesweeper: {`

```js
  108    minesweeper: {
  109      ms_reveal:  { name: "Mine Reveal",   price: 2_000,  max: 2, icon: "\u{1F50E}" },
  110      ms_buster:  { name: "Mine Buster",   price: 500,     max: 5, icon: "\u{1F9E8}" },
  111      ms_clear:   { name: "Clear Map",     price: 20_000, max: 1, icon: "\u{1F9F9}" },
  112      ms_shield:  { name: "Invincibility", price: 3_055,  max: 2, icon: "\u{1F6E1}️" },
  113      ms_detect:  { name: "Metal Detector",    price: 800,    max: 5, icon: "\u{1F9F2}" },
  114      ms_radar:   { name: "Radar Sweep",       price: 1_200,  max: 4, icon: "\u{1F4E1}" },
  115      ms_quad:    { name: "Quadrant Scan",     price: 600,    max: 3, icon: "\u{1F5FA}\uFE0F" },
  116      ms_drone:   { name: "Spotter Drone",     price: 1_500,  max: 3, icon: "\u{1F6F8}" },
  117      ms_flags:   { name: "Frontier Flags",    price: 2_400,  max: 3, icon: "\u{1F6A9}" },
  118      ms_gloves:  { name: "Sapper's Gloves",   price: 4_500,  max: 2, icon: "\u{1F9E4}" },
  119      ms_second:  { name: "Second Sweep",      price: 12_000, max: 1, icon: "\u267B\uFE0F" },
  120      ms_recon:   { name: "Recon Patrol",      price: 3_200,  max: 3, icon: "\u{1FA96}" },
  121      ms_demo:    { name: "Demolition Charge", price: 2_500,  max: 2, icon: "\u{1F4A5}" },
  122      ms_opening: { name: "Lucky Opening",     price: 1_000,  max: 1, icon: "\u{1F331}" },
  123      ms_chord:   { name: "Chord",             price: 300,    max: 8, icon: "\u26CF\uFE0F" },
  124      ms_watch:   { name: "Stopwatch",         price: 2_000,  max: 3, icon: "\u23F1\uFE0F" },
  125      ms_hazard:  { name: "Hazard Pay",        price: 1_800,  max: 2, icon: "\u{1FA79}" },
  126      ms_promo:   { name: "Field Promotion",   price: 3_500,  max: 1, icon: "\u{1F396}\uFE0F" },
  127    },
```

---

## WORD-CROSS  `wordcross`

### src/scoring.js — `ROUND_MS`

```js
    8  export const ROUND_MS = 900_000; // fifteen minutes
    9  export const PERFECT_MS = 45_000; // anything at or under this scores 100
   10  
   11  export function scoreFor(elapsedMs) {
   12    if (!Number.isFinite(elapsedMs) || elapsedMs >= ROUND_MS) return 0;
   13    if (elapsedMs <= PERFECT_MS) return 100;
   14    const t = (elapsedMs - PERFECT_MS) / (ROUND_MS - PERFECT_MS);
   15    return Math.max(1, Math.round(100 - 99 * t));
```

### src/validate.js — `export const WORD_COUNT`

```js
    6  export const WORD_COUNT = 10;      // what a hand-written scroll must have
    7  const MIN_LEN = 3;
    8  const MAX_LEN = 13;                // JEFFERSONCITY is thirteen
    9  const MAX_DIM = 32;                // a fifty-word grid needs about thirty
```

### src/arsenals.js — `  crossword: {`

```js
   28    crossword: {
   29      wc_letter:  { name: "Free Letter",    price: 300,   max: 8, icon: "\u{1F58A}\uFE0F" },
   30      wc_shape:   { name: "Word Shape",     price: 500,   max: 5, icon: "\u{1F524}" },
   31      wc_anagram: { name: "Anagram Sheet",  price: 800,   max: 4, icon: "\u{1F500}" },
   32      wc_spell:   { name: "Spellcheck",     price: 900,   max: 4, icon: "\u2705" },
   33      wc_eye:     { name: "Sensei's Eye",   price: 600,   max: 3, icon: "\u{1F441}\uFE0F" },
   34      wc_theme:   { name: "Theme Reading",  price: 200,   max: 2, icon: "\u{1F4DC}" },
   35      wc_firsts:  { name: "First Letters",  price: 1_200, max: 2, icon: "\u{1F170}\uFE0F" },
   36      wc_gift:    { name: "Random Gift",    price: 1_500, max: 4, icon: "\u{1F381}" },
   37      wc_short:   { name: "Shortest Straw", price: 1_200, max: 3, icon: "\u{1F956}" },
   38      wc_word:    { name: "Free Word",      price: 2_500, max: 3, icon: "\u270D\uFE0F" },
   39      wc_last:    { name: "Last Word",      price: 900,   max: 2, icon: "\u{1F3C1}" },
   40      wc_cascade: { name: "Cascade",        price: 4_000, max: 1, icon: "\u{1F30A}" },
   41      wc_head:    { name: "Head Start",     price: 1_000, max: 3, icon: "\u23EA" },
   42      wc_perfect: { name: "Perfect Ink",    price: 3_000, max: 1, icon: "\u{1F48E}" },
   43      wc_double:  { name: "Double Ink",     price: 2_600, max: 2, icon: "\u2716\uFE0F" },
   44      wc_salvage: { name: "Salvage",        price: 1_400, max: 2, icon: "\u{1F9F0}" },
   45      wc_fast:    { name: "Fast Hands",     price: 400,   max: 2, icon: "\u26A1" },
   46      wc_quiet:   { name: "Quiet Grid",     price: 700,   max: 3, icon: "\u{1F92B}" },
   47    },
```

---

## MULTIVERSE GOLF  `golf`

### src/links.js — `const COURSES`

```js
  232  const COURSES = [
  233    { id:"augusta", name:"AUGUSTA NATIONAL 2026", sub:"The Masters Course", ico:"🌳", loc:"Georgia, USA",
  234      pars:[4,5,4,3,4,3,4,5,4, 4,4,3,5,4,5,3,4,4],
  235      yards:[445,585,350,240,495,180,450,570,460, 495,520,155,545,440,550,170,440,465],
  236      names:{4:"Magnolia",11:"White Dogwood",14:"Firethorn"},
  237      haz: sparse(18,{4:"sand",11:"water",14:"water"}) },
  238    { id:"pebble", name:"PEBBLE BEACH", sub:"Pebble Beach Golf Links", ico:"🌊", loc:"California, USA",
  239      pars:[4,5,4,4,3,5,3,4,4, 4,4,3,4,5,4,4,3,5],
  240      yards:[380,516,404,331,195,523,106,428,505, 495,390,202,445,580,397,403,208,543],
  241      names:{7:"The Chasm",13:"The Dogleg",17:"Cliffs of Doom"},
  242      haz: sparse(18,{7:"water",13:"sand",17:"water"}) },
  243    { id:"standrews", name:"ST ANDREWS OLD", sub:"The Home of Golf", ico:"🏴", loc:"Fife, Scotland",
  244      pars:[4,4,4,4,5,4,4,3,4, 4,3,4,4,5,4,4,4,4],
  245      yards:[376,453,397,480,568,412,371,175,352, 386,174,348,465,614,455,423,495,357],
  246      names:{10:"Eden",13:"Hell Bunker",16:"Road Hole"},
  247      haz: sparse(18,{10:"water",13:"sand",16:"sand"}) },
  248    { id:"sawgrass", name:"TPC SAWGRASS", sub:"The Stadium Course", ico:"🏝", loc:"Florida, USA",
  249      pars:[4,5,3,4,4,4,4,3,5, 4,5,4,3,4,4,5,3,4],
  250      yards:[423,532,177,384,471,393,442,219,583, 424,558,302,181,481,449,523,137,447],
  251      names:{7:"The Bend",12:"Short Water",16:"Island Green"},
  252      haz: sparse(18,{7:"sand",12:"water",16:"water"}) },
  253    { id:"royalmelb", name:"ROYAL MELBOURNE WEST", sub:"The Sandbelt", ico:"🦘", loc:"Victoria, Australia",
  254      pars:[4,5,4,5,3,4,4,3,4, 4,5,4,4,4,5,3,4,3],
  255      yards:[429,480,354,470,176,428,148,305,440, 466,455,383,145,388,463,215,462,432],
  256      names:{2:"The Sandbelt",10:"Bunker Row",15:"The Cross"},
  257      haz: sparse(18,{2:"sand",10:"sand",15:"water"}) },
  258    { id:"kiawah", name:"KIAWAH ISLAND OCEAN", sub:"The Ocean Course", ico:"🌅", loc:"South Carolina, USA",
  259      pars:[4,5,4,4,3,4,5,3,4, 4,5,4,4,3,4,5,3,4],
  260      yards:[395,543,390,453,207,455,527,197,464, 439,562,466,404,194,421,579,221,439],
  261      names:{4:"The Marsh",13:"Tidal Creek",16:"Ocean Reach"},
  262      haz: sparse(18,{4:"water",13:"water",16:"sand"}) }
  263  ];
```

### src/arsenals.js — `  links: {`

```js
   68    links: {
   69      gf_mulligan: { name: "Mulligan",            price: 800,   max: 3, icon: "🔄" },
   70      gf_hint:     { name: "Caddie's Hint",       price: 400,   max: 5, icon: "💡" },
   71      gf_finder:   { name: "Range Finder",        price: 600,   max: 3, icon: "📏" },
   72      gf_relief:   { name: "Ground Under Repair", price: 900,   max: 3, icon: "🚧" },
   73      gf_gimme:    { name: "Gimme",               price: 2_500, max: 2, icon: "🤝" },
   74      gf_practice: { name: "Practice Swing",      price: 500,   max: 5, icon: "🏌️" },
   75      gf_fitting:  { name: "Club Fitting",        price: 700,   max: 3, icon: "🔧" },
   76      gf_bounce:   { name: "Lucky Bounce",        price: 1_800, max: 2, icon: "🍀" },
   77      gf_local:    { name: "Local Knowledge",     price: 600,   max: 4, icon: "🗺️" },
   78      gf_club:     { name: "Extra Club",          price: 500,   max: 4, icon: "🏌" },
   79      gf_drop:     { name: "Drop Zone",           price: 1_200, max: 2, icon: "🎯" },
   80      gf_tees:     { name: "Preferred Lies",      price: 1_500, max: 2, icon: "⛳" },
   81      gf_double:   { name: "Double Down",         price: 1_000, max: 3, icon: "⚖️" },
   82      gf_eagle:    { name: "Eagle Eye",           price: 2_000, max: 2, icon: "🦅" },
   83      gf_pencil:   { name: "Scorecard Pencil",    price: 3_000, max: 1, icon: "✏️" },
   84      gf_wind:     { name: "Wind Gauge",          price: 2_200, max: 2, icon: "🌬️" },
   85      gf_book:     { name: "Caddie's Book",       price: 900,   max: 2, icon: "📒" },
   86      gf_ace:      { name: "Ace Chaser",          price: 2_800, max: 2, icon: "🎯" },
   87    },
```

---

## THE CASINO FLOOR  `floor`

### src/casino-core.js — `export const START_TABLE`

```js
   15  export const START_TABLE = 100;   // what a new arrival is staked
   16  export const MAX_SEATS = 20;      // per live table
   17  
   18  /* ── the deck ────────────────────────────────────────────────────────── */
```

### src/casino-core.js — `export const BETS`

```js
  158  export const BETS = [
  159    { id: "place", name: "1st or 2nd", pays: 3.5, picks: 1, blurb: "Your horse finishes in the top two." },
  160    { id: "win", name: "First Place", pays: 20, picks: 1, blurb: "Your horse wins outright." },
  161    { id: "exacta", name: "1st, 2nd - Exact Order", pays: 150, picks: 2, blurb: "Both, in the order you name them." },
  162    { id: "trifecta", name: "Top 3 - Exact", pays: 400, picks: 3, blurb: "The first three, in order." },
  163    { id: "superfecta", name: "Top 4 - Exact", pays: 1000, picks: 4, blurb: "The first four, in order." },
  164    // Borrowed from the market: one bets on a horse running away with it, the
  165    // other on it collapsing. Both need a margin, which is why they pay 50.
  166    { id: "long", name: "Long", pays: 50, picks: 1, side: true,
  167      blurb: "Wins by three clear steps over the runner-up." },
  168    { id: "short", name: "Short", pays: 50, picks: 1, side: true,
  169      blurb: "Finishes last, three clear steps behind the one in front." },
  170  ];
```

### src/arsenals.js — `  casino: {`

```js
    8    casino: {
    9      cs_chips:   { name: "Chip Run",           price: 2_000, max: 2, icon: "\u{1F39F}\uFE0F" },
   10      cs_comp:    { name: "Comp Pass",          price: 900,   max: 1, icon: "\u{1F3AB}" },
   11      cs_safe:    { name: "Blackjack Safety",   price: 600,   max: 4, icon: "\u{1F6E1}\uFE0F" },
   12      cs_peek:    { name: "Peek",               price: 1_800, max: 2, icon: "\u{1F440}" },
   13      cs_redeal:  { name: "Second Deal",        price: 1_200, max: 3, icon: "\u{1F504}" },
   14      cs_tip:     { name: "Tip the Dealer",     price: 800,   max: 4, icon: "\u{1F4B5}" },
   15      cs_count:   { name: "Card Counter",       price: 1_400, max: 3, icon: "\u{1F9EE}" },
   16      cs_insure:  { name: "Insurance Policy",   price: 2_500, max: 2, icon: "\u{1F4CB}" },
   17      cs_tie:     { name: "Dealer's Off Day",   price: 1_100, max: 3, icon: "\u{1F91D}" },
   18      cs_shoe:    { name: "Fresh Shoe",         price: 400,   max: 3, icon: "\u{1F0CF}" },
   19      cs_photo:   { name: "Photo Finish",       price: 1_500, max: 3, icon: "\u{1F4F8}" },
   20      cs_scratch: { name: "Scratch the Bet",    price: 1_000, max: 3, icon: "\u2702\uFE0F" },
   21      cs_furlong: { name: "Extra Furlong",      price: 2_200, max: 2, icon: "\u{1F40E}" },
   22      cs_double:  { name: "Bet Doubler",        price: 3_000, max: 2, icon: "\u2716\uFE0F" },
   23      cs_flash:   { name: "Flashcards",         price: 1_600, max: 2, icon: "\u{1F5C2}\uFE0F" },
   24      cs_credit:  { name: "Extra Credit",       price: 2_400, max: 2, icon: "\u{1F393}" },
   25      cs_cap:     { name: "Raise the Cap",      price: 4_000, max: 1, icon: "\u{1F4C8}" },
   26      cs_deposit: { name: "Night Deposit",      price: 2_000, max: 2, icon: "\u{1F3E6}" },
   27    },
```

---

## AND THEY'RE OFF!  `horses`

### src/casino-core.js — `HORSES`

```js
   40  export const HORSES = [
   41    { id: "king", rank: "K", name: "King of Spades" },
   42    { id: "queen", rank: "Q", name: "Queen of Spades" },
   43    { id: "jack", rank: "J", name: "Jack of Spades" },
   44    { id: "ten", rank: "10", name: "Ten of Spades" },
   45    { id: "nine", rank: "9", name: "Nine of Spades" },
   46    { id: "eight", rank: "8", name: "Eight of Spades" },
   47    { id: "seven", rank: "7", name: "Seven of Spades" },
   48  ].map((h) => ({ ...h, pip: "\u2660", red: true }));
   49  
   50  export const horseById = (id) => HORSES.find((h) => h.id === id);
   51  
   52  export const FINISH = 7;      // steps to the line
   53  export const HURDLES = 5;     // knock-backs along the track
   54  export const TICK_MS = 1500;
   55  
   56  /* ── the favourite of the day ────────────────────────────────────────── */
   57  
   58  const DAY_MS = 86_400_000;
   59  
```

### src/casino-core.js — `HURDLES`

```js
   53  export const HURDLES = 5;     // knock-backs along the track
   54  export const TICK_MS = 1500;
   55  
   56  /* ── the favourite of the day ────────────────────────────────────────── */
```

### src/casino-core.js — `PRICES`

```js
  144  const PRICES = {
  145    place: 4,
  146    win: 20,
  147    exacta: 150,
  148    trifecta: 400,
  149    superfecta: 1000,
  150    long: 100,
  151    short: 50,
  152  };
  153  
  154  export function oddsFor(betType) {
  155    return PRICES[betType] || 0;
  156  }
  157  
  158  export const BETS = [
  159    { id: "place", name: "1st or 2nd", pays: 3.5, picks: 1, blurb: "Your horse finishes in the top two." },
  160    { id: "win", name: "First Place", pays: 20, picks: 1, blurb: "Your horse wins outright." },
  161    { id: "exacta", name: "1st, 2nd - Exact Order", pays: 150, picks: 2, blurb: "Both, in the order you name them." },
  162    { id: "trifecta", name: "Top 3 - Exact", pays: 400, picks: 3, blurb: "The first three, in order." },
  163    { id: "superfecta", name: "Top 4 - Exact", pays: 1000, picks: 4, blurb: "The first four, in order." },
  164    // Borrowed from the market: one bets on a horse running away with it, the
  165    // other on it collapsing. Both need a margin, which is why they pay 50.
  166    { id: "long", name: "Long", pays: 50, picks: 1, side: true,
  167      blurb: "Wins by three clear steps over the runner-up." },
```

### src/casino-core.js — `FAVOURITE_STEP`

```js
  132  export const FAVOURITE_STEP = 0.252;
  133  
  134  /**
  135   * What a slip pays.
```

---

## TOKENS & ARSENALS  `tokens`

### src/arsenals.js — `export const ARSENALS`

```js
    7  export const ARSENALS = {
    8    casino: {
    9      cs_chips:   { name: "Chip Run",           price: 2_000, max: 2, icon: "\u{1F39F}\uFE0F" },
```

### src/firestore.js — `export const TOKEN_PRICE`

```js
  298  export const TOKEN_PRICE = 200;
  299  export const TOKEN_GAMES = ["crossword", "battleship", "minesweeper", "links", "casino", "prix"];
  300  // The Battleship arsenal sells alongside the boosts, each at its own price.
```

---

## BELTS & BRASS  `belts`

### src/mmr.js — `export const BELTS`

```js
    7  export const BELTS = [
    8    { at: BLACK_BELT, name: "Black",  hex: "#111111" },
    9    { at: 1525,       name: "Brown",  hex: "#a52a2a" },
   10    { at: 1200,       name: "Purple", hex: "#b10dc9" },
   11    { at: 875,        name: "Blue",   hex: "#0074d9" },
   12    { at: 600,        name: "Green",  hex: "#2ecc40" },
   13    { at: 400,        name: "Orange", hex: "#ff851b" },
   14    { at: 200,        name: "Yellow", hex: "#ffdc00" },
   15    { at: 1,          name: "White",  hex: "#ffffff" },
   16    { at: 0,          name: "Unranked", hex: "#4c5468" },
   17  ];
```

### src/mmr.js — `COMPLETION_BONUS`

```js
   24  export const COMPLETION_BONUS = 15;
   25  export const MAX_CHALLENGE_BONUS = 15;
   26  export const MAX_SEED_BONUS = 10;
   27  
   28  // A player 800 MMR below the field earns the full bonus; the scale is linear
```

### public/ranks.js — `export const BRANCHES`

```js
   29  export const BRANCHES = [
   30    { id: "space", name: "Space Force", emoji: "🚀", enlisted: [], officers: rows("officer", OFFICERS_SPACE) },
   31    { id: "army", name: "Army", emoji: "🪖", enlisted: rows("enlisted", [
   32      ["Private", "PVT"], ["Private Second Class", "PV2"], ["Private First Class", "PFC"], ["Specialist", "SPC"],
   33      ["Sergeant", "SGT"], ["Staff Sergeant", "SSG"], ["Sergeant First Class", "SFC"], ["Master Sergeant", "MSG"],
   34      ["Sergeant Major", "SGM"],
   35    ]), officers: rows("officer", OFFICERS_ARMY) },
   36    { id: "navy", name: "Navy", emoji: "⚓", enlisted: rows("enlisted", [
   37      ["Seaman Recruit", "SR"], ["Seaman Apprentice", "SA"], ["Seaman", "SN"], ["Petty Officer Third Class", "PO3"],
   38      ["Petty Officer Second Class", "PO2"], ["Petty Officer First Class", "PO1"], ["Chief Petty Officer", "CPO"],
   39      ["Senior Chief Petty Officer", "SCPO"], ["Master Chief Petty Officer", "MCPO"],
   40    ]), officers: rows("officer", OFFICERS_NAVY) },
   41    { id: "marines", name: "Marine Corps", emoji: "🦅", enlisted: rows("enlisted", [
   42      ["Private", "PVT"], ["Private First Class", "PFC"], ["Lance Corporal", "LCPL"], ["Corporal", "CPL"],
   43      ["Sergeant", "SGT"], ["Staff Sergeant", "SSGT"], ["Gunnery Sergeant", "GYSGT"], ["Master Sergeant", "MSGT"],
   44      ["Sergeant Major", "SGTMAJ"],
   45    ]), officers: rows("officer", OFFICERS_ARMY) },
   46    { id: "airforce", name: "Air Force", emoji: "✈️", enlisted: rows("enlisted", [
   47      ["Airman Basic", "AB"], ["Airman", "AMN"], ["Airman First Class", "A1C"], ["Senior Airman", "SRA"],
   48      ["Staff Sergeant", "SSGT"], ["Technical Sergeant", "TSGT"], ["Master Sergeant", "MSGT"],
   49      ["Senior Master Sergeant", "SMSGT"], ["Chief Master Sergeant", "CMSGT"],
   50    ]), officers: rows("officer", OFFICERS_ARMY) },
   51    { id: "coastguard", name: "Coast Guard", emoji: "🛟", enlisted: rows("enlisted", [
   52      ["Seaman Recruit", "SR"], ["Seaman Apprentice", "SA"], ["Seaman", "SN"], ["Petty Officer Third Class", "PO3"],
   53      ["Petty Officer Second Class", "PO2"], ["Petty Officer First Class", "PO1"], ["Chief Petty Officer", "CPO"],
   54      ["Senior Chief Petty Officer", "SCPO"], ["Master Chief Petty Officer", "MCPO"],
   55    ]), officers: rows("officer", OFFICERS_NAVY) },
   56  ];
```

### public/cosmetics.js — `PRESTIGE_COST`

```js
   13  export const PRESTIGE_COST = 3000;
   14  export const lifetime = ({ mmr = 0, prestige = 0, spent = 0 } = {}) => (mmr || 0) + (prestige || 0) * PRESTIGE_COST + (spent || 0);
   15  /** Prestiges counted across retirements: a retiree has climbed past General. */
   16  export const prestigeEver = (standing) => (standing?.prestige || 0) + (standing?.retired || 0) * 10;
   17  
```

---

## THE BOUNTY OFFICE  `bounty`

### src/bounty.js — `export const CLAIM_BONUS`

```js
    8  export const CLAIM_BONUS = 50;
    9  export const DEFEND_BONUS = 25;
   10  export const ROTATE_AFTER_MS = 48 * 60 * 60 * 1000;
   11  
   12  /** Solo play neither claims nor transfers the bounty. */
   13  export const ELIGIBLE_MODES = ["match", "rumble", "putv"];
   14  
   15  export function isEligible({ mode, field }) {
   16    return ELIGIBLE_MODES.includes(mode) && (field || 0) >= 2;
   17  }
```

### src/bounty.js — `export const KILL_TIERS`

```js
   30  export const KILL_TIERS = [
   31    { at: 1, id: "kill-1", name: "Bounty Kill I", tier: "silver", points: 3 },
   32    { at: 2, id: "kill-2", name: "Bounty Kill II", tier: "gold", points: 4 },
   33    { at: 3, id: "kill-3", name: "Bounty Kill III", tier: "diamond", points: 5 },
   34    { at: 4, id: "kill-4", name: "Bounty Kill IV", tier: "platinum", points: 6 },
   35  ];
```

### src/bounty.js — `export const SLAYER_TIERS`

```js
   37  export const SLAYER_TIERS = [
   38    { at: 5, id: "slayer", name: "Bounty Slayer", tier: "diamond", unlocks: "title and the Bounty Slayer legendary frame" },
   39    { at: 10, id: "executioner", name: "Bounty Executioner", tier: "platinum", unlocks: "title, avatar and the Bounty Executioner frame" },
   40    { at: 15, id: "warlord", name: "Bounty Warlord", tier: "legendary", unlocks: "title, avatar, the Warlord diamond frame and a loot drop" },
   41  ];
```

### src/bounty.js — `export function perHour`

```js
   23  export function perHour(score, durationMs) {
   24    const hours = Math.max(60_000, Number(durationMs) || 0) / 3_600_000;
   25    return Math.round((Number(score) || 0) / hours);
   26  }
```

---

## THE KART GARAGE  `garage`

### public/cosmetics.js — `export const KARTS`

```js
  413  export const KARTS = [
  414    { id: "f1", name: "Formula", ico: "\u{1F3CE}\uFE0F" },
  415    { id: "saloon", name: "Saloon", ico: "\u{1F697}" },
  416    { id: "estate", name: "Estate", ico: "\u{1F699}" },
  417    { id: "pickup", name: "Pickup", ico: "\u{1F6FB}" },
  418    { id: "taxi", name: "Taxi", ico: "\u{1F695}" },
  419    { id: "camper", name: "Camper", ico: "\u{1F690}" },
  420    { id: "squad", name: "Squad Car", ico: "\u{1F693}" },
  421    { id: "ambulance", name: "Ambulance", ico: "\u{1F691}" },
  422    { id: "engine", name: "Fire Engine", ico: "\u{1F692}" },
  423    { id: "tractor", name: "Tractor", ico: "\u{1F69C}" },
  424    { id: "rickshaw", name: "Rickshaw", ico: "\u{1F6FA}" },
  425    { id: "moto", name: "Motorcycle", ico: "\u{1F3CD}\uFE0F" },
  426    { id: "scooter", name: "Scooter", ico: "\u{1F6F5}" },
  427    { id: "bicycle", name: "Bicycle", ico: "\u{1F6B2}" },
  428    { id: "skateboard", name: "Skateboard", ico: "\u{1F6F9}" },
  429    { id: "skates", name: "Roller Skates", ico: "\u{1F6FC}" },
  430    { id: "sled", name: "Sled", ico: "\u{1F6F7}" },
  431    { id: "bus", name: "Bus", ico: "\u{1F68C}" },
  432    { id: "truck", name: "Truck", ico: "\u{1F69A}" },
  433    { id: "lorry", name: "Lorry", ico: "\u{1F69B}" },
  434    { id: "loco", name: "Locomotive", ico: "\u{1F682}" },
  435    { id: "tram", name: "Tram", ico: "\u{1F68B}" },
  436    { id: "chopper", name: "Helicopter", ico: "\u{1F681}" },
  437    { id: "sailboat", name: "Sailboat", ico: "\u26F5" },
  438    { id: "duck", name: "Duck", ico: "\u{1F986}" },
  439    // Earned on the track. A race against computer drivers counts: the arena
  440    // already pays it MMR like any other, so it would be strange to call it a
  441    // win for the belt and not for the kart.
  442    { id: "flag", name: "Chequered", ico: "\u{1F3C1}", need: { feat: "won_prix", count: 1 } },
  443    { id: "rocket", name: "Rocket", ico: "\u{1F680}", need: { feat: "won_prix", count: 3 } },
  444    { id: "dino", name: "Tyrannosaur", ico: "\u{1F996}", need: { feat: "won_prix", count: 5 } },
  445    { id: "unicorn", name: "Unicorn", ico: "\u{1F984}", need: { feat: "won_prix", count: 10 } },
  446    { id: "saucer", name: "Flying Saucer", ico: "\u{1F6F8}", need: { feat: "won_prix", count: 25 } },
  447    // For turning up and for going round alone, so a player with nobody to
  448    // race still has something to chase.
  449    { id: "snail", name: "Snail", ico: "\u{1F40C}", need: { feat: "played_prix", count: 10 } },
  450    { id: "horse", name: "Racehorse", ico: "\u{1F40E}", need: { feat: "solo_prix", count: 10 } },
  451    { id: "tortoise", name: "Tortoise", ico: "\u{1F422}", need: { feat: "solo_prix", count: 25 } },
  452  ];
```

### public/cosmetics.js — `DEFAULT_KART`

```js
  453  export const DEFAULT_KART = "f1";
  454  export const kartById = (id) => KARTS.find((k) => k.id === id) || KARTS[0];
  455  export const knownKart = (id) => KARTS.some((k) => k.id === id);
```

---

## DOJO LORE  `lore`

### public/arena.js — `export const GAME_MODES`

```js
   39  export const GAME_MODES = [
   40    {
   41      id: "dojo-crossword",
   42      name: "Word Cross Challenges",
   43      players: "1 or more",
   44      blurb: "Ten words, one clock. Train alone or open it up — everyone races the same grid independently, and three or more solvers makes it a Rumble where placement pays.",
   45      kind: "match",
   46      game: "crossword",
   47      available: true,
   48    },
   49    {
   50      id: "battleships",
   51      name: "Battleship Royale",
   52      players: "2-8 players",
   53      blurb: "Place a fleet, then two shots a turn at one rival. You must fire at three others before coming back to anyone.",
   54      kind: "match",
   55      game: "battleship",
   56      available: true,
   57    },
   58    {
   59      id: "grand-prix",
   60      name: "Multiverse Grand Prix",
   61      players: "1 or more",
   62      blurb: "A kart race where your vocabulary is the engine. Unscramble a word to move; the quicker you are for your own level, the further you go.",
   63      kind: "match",
   64      game: "prix",
   65      available: true,
   66    },
   67    {
   68      id: "minesweeper",
   69      name: "Minesweeper",
   70      players: "1 or more",
   71      blurb: "Everyone races the same field. Clear it fastest, or get as far as you can before one goes off.",
   72      kind: "match",
   73      game: "minesweeper",
   74      available: true,
   75    },
   76    {
   77      id: "casino",
   78      name: "Casino",
   79      blurb: "An open floor. One horse race, one bet board, one dealer — walk in whenever, back your own slip or copy somebody else's. Cash is its own economy and banks to your wallet.",
   80      players: "Open lobby",
   81      kind: "match",
   82      game: "casino",
   83      available: true,
   84    },
   85    {
   86      id: "links",
   87      name: "Multiverse Golf",
   88      players: "1 or more",
   89      blurb: "Eighteen holes of word golf. Each hole deals you a scrambled word \u2014 unscramble it, and every letter you put in its place is yards down the fairway. Two swings is an eagle. Six real courses, and everyone in a room is dealt the same letters.",
   90      kind: "match",
   91      game: "links",
   92      available: true,
   93    },
   94    {
   95      id: "the-buzzer",
   96      name: "The Buzzer",
   97      players: "1 or more",
   98      blurb: "Six categories, five rows, one buzzer. The clue is read to everyone at once and the quickest reaction takes it \u2014 then four options, ten seconds, and a wrong answer costs what a right one pays.",
   99      kind: "match",
  100      game: "buzzer",
  101      available: true,
  102    },
  103    {
  104      id: "gauntlet",
  105      name: "Gauntlet",
  106      players: "1 player",
  107      blurb: "Beat all eight belts in a row.",
  108      kind: "solo",
  109      available: false,
  110    },
  111  ];
```

### src/rooms.js — `export const GAME_IDS`

```js
   10  export const GAME_IDS = ["crossword", "battleship", "minesweeper", "casino", "links", "prix", "buzzer"];
   11  
   12  /**
```

---

