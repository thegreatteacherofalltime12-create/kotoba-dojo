/**
 * Multiverse Golf — the rules, and the only place the words live.
 *
 * The answers never leave this module. The browser is told hit / near / miss
 * for a guess and nothing else, which is the whole reason scoring moved to the
 * server: a word list in the page is a word list the player can read.
 */

function sparse(n, map) {
  const out = Array(n).fill(null);
  for (const [i, v] of Object.entries(map)) out[Number(i)] = v;
  return out;
}

const DICT = {
  classic: {
    label: "Webster 1828",
    mult: 1.15,
    4: [
      ["ABET","To encourage, counsel, or aid in a design or purpose."],
      ["AVER","To affirm with confidence; to declare positively."],
      ["BALM","An oily aromatic substance; that which heals or soothes."],
      ["BOON","A gift; a grant; a benefaction bestowed."],
      ["CANT","A whining manner of speech; the peculiar words of a sect."],
      ["CURD","The coagulated part of milk, whereof cheese is made."],
      ["DIRK","A kind of dagger or poniard, borne by the Highlander."],
      ["DOFF","To put off, as dress; to strip; to lay aside."],
      ["EWER","A kind of pitcher with a wide spout, to bring water."],
      ["FANE","A temple; a place consecrated to religion."],
      ["GIRD","To bind round with a belt; to encompass; to invest."],
      ["GLEN","A valley; a dale; a depression between hills."],
      ["HALE","Sound; healthy; robust; not impaired by age."],
      ["KILN","A large stove or oven for hardening or drying."],
      ["LATH","A thin narrow board, nailed to rafters to support tiles."],
      ["LOAM","A rich mould; soil of clay and sand with vegetable matter."],
      ["MEAD","A fermented liquor of honey and water; also, a meadow."],
      ["MIEN","Aspect; air; manner; the external appearance of a person."],
      ["MIRE","Deep mud; earth so wet as to yield to the feet."],
      ["NIGH","Near; not distant; close at hand in place or time."],
      ["PELF","Money; riches; used in contempt or reproach."],
      ["RIME","White frost; congealed dew or vapour on the ground."],
      ["SAGE","A wise man; one venerable for years and wisdom."],
      ["SHOD","Furnished with shoes; having the feet covered."],
      ["TROW","To believe; to trust; to think or suppose."],
      ["VALE","A tract of low ground between hills; a valley."],
      ["WELT","A border or edging, as of a shoe or garment."],
      ["WHIT","A point; a jot; the smallest part imaginable."],
      ["WOAD","A plant yielding a blue dye, used by the ancient Britons."],
      ["YOKE","A frame of wood by which oxen are joined for drawing."]
    ],
    5: [
      ["ABASH","To confound; to strike with shame or confusion of face."],
      ["ADAGE","A proverb; an old saying which has obtained credit."],
      ["AMBIT","The compass or circuit of a thing; the line encompassing."],
      ["ARBOR","A bower; a seat shaded by trees or twining plants."],
      ["AUGUR","One who pretends to foretell events by signs and omens."],
      ["BEGET","To procreate; to generate; to produce as an effect."],
      ["BOSOM","The breast of a human being; the seat of the affections."],
      ["BRINE","Water saturated with salt; the sea; the ocean."],
      ["CHURL","A rustic; a countryman; a rude, surly, ill-bred man."],
      ["CROFT","A little close adjoining a dwelling, used for pasture."],
      ["DIRGE","A song or tune intended to express grief for the dead."],
      ["EXTOL","To raise in words; to praise; to magnify; to celebrate."],
      ["FEIGN","To invent or imagine; to make a show of; to counterfeit."],
      ["GLEBE","Turf; soil; the land belonging to a parish church."],
      ["HEATH","A plant of the genus Erica; ground overgrown with shrubs."],
      ["IMBUE","To tincture deeply; to cause to imbibe, as a colour."],
      ["KNELL","The sound of a bell rung at a funeral; a death signal."],
      ["LIEGE","A lord or superior; one to whom fealty is due."],
      ["PIETY","Reverence of the Supreme Being; devotion to duty."],
      ["QUELL","To crush; to subdue; to reduce to peace or submission."],
      ["REALM","A kingdom; a royal jurisdiction or extent of government."],
      ["SCRIP","A small writing; a certificate; a small bag or wallet."],
      ["SHIRE","A division of territory; a county under a sheriff."],
      ["SMITE","To strike; to give a blow with the hand or a weapon."],
      ["TITHE","The tenth part of the produce of land, given for support."],
      ["USURY","Formerly, interest; now, exorbitant interest for money."],
      ["VERGE","A rod or staff of office; the brink or extreme edge."],
      ["WROTH","Very angry; much exasperated; full of wrath."],
      ["YIELD","To produce, as land or trees; to give up; to surrender."]
    ],
    6: [
      ["ARDENT","Hot; burning; having the quality of fire; passionate."],
      ["BEHEST","Command; precept; mandate; injunction."],
      ["CANDID","White; fair; open; frank; free from undue bias."],
      ["DEARTH","Scarcity; want; need; a want of things convenient."],
      ["ESTATE","The interest or quantity of interest a man has in lands."],
      ["FEALTY","Fidelity to a lord; the faithful adherence of a tenant."],
      ["GAMBOL","To dance and skip about in sport; to frisk; to leap."],
      ["HOMAGE","The submission and service which a tenant promises."],
      ["INFAMY","Total loss of reputation; public disgrace."],
      ["LAMENT","To mourn; to grieve; to weep or wail; to express sorrow."],
      ["MALICE","Extreme enmity of heart; a disposition to injure others."],
      ["NECTAR","The drink of the gods; any very sweet and pleasant drink."],
      ["OBLIGE","To constrain by necessity, physical or moral; to bind."],
      ["PARLEY","Mutual discourse; conference with an enemy in war."],
      ["PLIGHT","To pledge; to give as security; a condition or state."],
      ["QUARRY","A place where stones are dug; the game a hawk pursues."],
      ["REPOSE","To lay at rest; to sleep; to rest in confidence."],
      ["SOLACE","Comfort in grief; alleviation of grief or anxiety."],
      ["SUNDRY","Several; divers; more than one or two."],
      ["TEMPER","Due mixture of different qualities; disposition of mind."],
      ["THRALL","A slave; a bondman; a state of servitude."],
      ["UNRULY","Not submissive to rule; disregarding restraint; turbulent."],
      ["VASSAL","A feudatory; one who holds land of a superior lord."],
      ["WISDOM","The right use of knowledge; sound judgment in action."],
      ["ZEALOT","One who is zealous; one carried away by excess of zeal."]
    ]
  },
  modern: {
    label: "Modern",
    mult: 1.0,
    4: [
      ["BLOG","A regularly updated website written in a personal style."],
      ["CHIP","A small wafer of silicon carrying an integrated circuit."],
      ["DUNK","To slam a basketball down through the hoop."],
      ["FLEX","To show something off, usually a little too obviously."],
      ["GLOW","A steady light without flame; a warm radiance."],
      ["GRID","A network of evenly spaced lines crossing at right angles."],
      ["HACK","A clever shortcut; also, to break into a computer system."],
      ["HYPE","Aggressive promotion; excitement built up in advance."],
      ["JAZZ","Music built on improvisation, swing and blue notes."],
      ["JOLT","A sudden sharp shock or movement."],
      ["KIWI","A fuzzy green fruit; a flightless bird; a New Zealander."],
      ["LOOP","A structure that repeats until a condition is met."],
      ["MEME","An idea or image that spreads rapidly across the internet."],
      ["MINT","An aromatic herb; also, brand new and unused."],
      ["PING","A short signal sent to test whether a host responds."],
      ["PLOT","The sequence of events in a story; also, to chart data."],
      ["QUIZ","A short test of knowledge."],
      ["RAMP","A sloping surface joining two different levels."],
      ["SPAM","Unsolicited messages sent in bulk."],
      ["SWAP","To exchange one thing for another."],
      ["TOFU","Curd made from soya milk, pressed into blocks."],
      ["VIBE","The mood or atmosphere a place or person gives off."],
      ["WIFI","Wireless networking over radio bands."],
      ["YOGA","A practice of posture, breathing and meditation."],
      ["ZOOM","To move very fast; to enlarge the view."]
    ],
    5: [
      ["AUDIO","Sound, especially when recorded or transmitted."],
      ["BINGE","To consume a great deal in one sitting."],
      ["CACHE","A store of things hidden away; fast temporary memory."],
      ["CLOUD","Remote servers used for storage and computing."],
      ["DEBUG","To find and remove faults from a program."],
      ["DRONE","An uncrewed aircraft flown by remote control."],
      ["EMOJI","A small pictorial character used in messages."],
      ["FLASK","A narrow-necked bottle, often for liquids or hot drinks."],
      ["FROST","A deposit of ice crystals formed on cold surfaces."],
      ["GLYPH","A single character or symbol in a typeface."],
      ["GRAPH","A diagram showing the relation between quantities."],
      ["HOTEL","An establishment providing paid lodging."],
      ["INBOX","The folder where incoming messages arrive."],
      ["JUICE","Liquid pressed from fruit or vegetables."],
      ["KAYAK","A narrow canoe paddled with a double-bladed oar."],
      ["LASER","A device emitting a narrow, intense beam of light."],
      ["MERGE","To combine two things into one."],
      ["NINJA","A covert agent of feudal Japan; a highly skilled operator."],
      ["OCEAN","A vast body of salt water covering most of the planet."],
      ["PIXEL","The smallest addressable dot on a screen."],
      ["QUERY","A question, especially one put to a database."],
      ["ROBOT","A machine capable of carrying out tasks automatically."],
      ["SOLAR","Relating to the sun or powered by it."],
      ["TWEET","A short public post; the call of a small bird."],
      ["URBAN","Relating to a town or city."],
      ["VIRAL","Spreading rapidly from person to person."],
      ["YACHT","A sailing or motor vessel used for cruising or racing."],
      ["ZEBRA","An African horse with black and white stripes."]
    ],
    6: [
      ["ARCADE","A covered walkway; a hall of coin-operated games."],
      ["BRANCH","A limb of a tree; a separate line of development in code."],
      ["BUDGET","A plan setting out expected income and spending."],
      ["CIPHER","A code; a way of disguising a message."],
      ["DEPLOY","To put into position and into use."],
      ["DIGEST","To break down food; a condensed summary."],
      ["ENGINE","A machine converting energy into motion."],
      ["FILTER","A device or rule that lets some things through and blocks others."],
      ["GADGET","A small mechanical or electronic device."],
      ["HYBRID","Something made by combining two different things."],
      ["IMPACT","The striking of one body against another; a marked effect."],
      ["JUNGLE","Dense tropical forest tangled with vegetation."],
      ["KERNEL","The core of a seed; the central part of an operating system."],
      ["LAPTOP","A portable computer that folds shut."],
      ["MATRIX","A rectangular array of numbers; an environment that shapes things."],
      ["NEURAL","Relating to nerves, or to a network modelled on them."],
      ["ORACLE","A source of wise counsel or prophecy."],
      ["PLUGIN","A component adding a feature to an existing program."],
      ["QUIVER","To tremble slightly; a case for arrows."],
      ["ROCKET","A vehicle driven by the thrust of expelled gases."],
      ["SENSOR","A device that detects and measures a physical property."],
      ["STREAM","A small river; a continuous flow of data."],
      ["TOGGLE","A switch with two positions; to flip between them."],
      ["TUNNEL","A passage dug underground or through rock."],
      ["UPLOAD","To transfer data to a remote system."],
      ["VECTOR","A quantity having both magnitude and direction."],
      ["WIDGET","A small application or control on a screen."],
      ["ZENITH","The highest point; the peak of something."]
    ]
  }
};

/* ============================================================
   DIFFICULTY
   Each tier changes the PUZZLE, not just the payout.
   ============================================================ */
/** Card par decides word length: a par three is a four-letter word, and so on. */
const PAR_LEN = { 3: 4, 4: 5, 5: 6 };

const DIFF = {
  easy:   { label:"EASY",   ico:"🟢", mult:0.75, guessAdj:+1, words:1,
            blurb:"One word to hole out. Your guesses are your strokes against the hole's real par. The opening letter is shown, the pool is limited to familiar words, and hazards don't bite." },
  medium: { label:"MEDIUM", ico:"🟡", mult:1.00, guessAdj:0, words:5,
            blurb:"Five words to hole out — each solved word is one shot down the fairway. Par for the hole is 5. The full word pool, the clue up front, hazards live." },
  hard:   { label:"HARD",   ico:"🔴", mult:1.35, guessAdj:-1, words:8,
            blurb:"Eight words to hole out, par 8, and a guess fewer on each. No clue until you've played two, the obscure pool, and every letter you uncover must be reused." }
};
/* Guesses allowed per word in the multi-word tiers. */
const wordAllowance = len => (len===6 ? 6 : 5) + 0;
/* Words a modern player will recognise — the Easy answer pool. */

const EASY_WORDS = new Set(("BALM BOON CANT GIRD GLEN HALE KILN LATH LOAM MEAD MIRE NIGH RIME SAGE SHOD VALE " +
"WELT WHIT YOKE ABET AVER DOFF ADAGE ARBOR BEGET BOSOM BRINE EXTOL FEIGN HEATH KNELL LIEGE PIETY QUELL " +
"REALM SHIRE SMITE TITHE USURY VERGE YIELD ARDENT CANDID DEARTH ESTATE GAMBOL HOMAGE INFAMY LAMENT " +
"MALICE NECTAR OBLIGE PARLEY PLIGHT QUARRY REPOSE SOLACE SUNDRY TEMPER UNRULY WISDOM ZEALOT " +
"BLOG CHIP DUNK FLEX GLOW GRID HACK HYPE JAZZ JOLT KIWI LOOP MEME MINT PING PLOT QUIZ RAMP SPAM SWAP " +
"TOFU VIBE WIFI YOGA ZOOM AUDIO BINGE CLOUD DRONE EMOJI FLASK FROST GRAPH HOTEL INBOX JUICE KAYAK LASER " +
"MERGE NINJA OCEAN PIXEL QUERY ROBOT SOLAR TWEET URBAN VIRAL YACHT ZEBRA ARCADE BRANCH BUDGET DIGEST " +
"ENGINE FILTER GADGET HYBRID IMPACT JUNGLE LAPTOP MATRIX ORACLE ROCKET SENSOR STREAM TOGGLE TUNNEL " +
"UPLOAD VECTOR WIDGET ZENITH").split(/\s+/));

const COURSES = [
  { id:"augusta", name:"AUGUSTA NATIONAL 2026", sub:"The Masters Course", ico:"🌳", loc:"Georgia, USA",
    pars:[4,5,4,3,4,3,4,5,4, 4,4,3,5,4,5,3,4,4],
    yards:[445,585,350,240,495,180,450,570,460, 495,520,155,545,440,550,170,440,465],
    names:{4:"Magnolia",11:"White Dogwood",14:"Firethorn"},
    haz: sparse(18,{4:"sand",11:"water",14:"water"}) },
  { id:"pebble", name:"PEBBLE BEACH", sub:"Pebble Beach Golf Links", ico:"🌊", loc:"California, USA",
    pars:[4,5,4,4,3,5,3,4,4, 4,4,3,4,5,4,4,3,5],
    yards:[380,516,404,331,195,523,106,428,505, 495,390,202,445,580,397,403,208,543],
    names:{7:"The Chasm",13:"The Dogleg",17:"Cliffs of Doom"},
    haz: sparse(18,{7:"water",13:"sand",17:"water"}) },
  { id:"standrews", name:"ST ANDREWS OLD", sub:"The Home of Golf", ico:"🏴", loc:"Fife, Scotland",
    pars:[4,4,4,4,5,4,4,3,4, 4,3,4,4,5,4,4,4,4],
    yards:[376,453,397,480,568,412,371,175,352, 386,174,348,465,614,455,423,495,357],
    names:{10:"Eden",13:"Hell Bunker",16:"Road Hole"},
    haz: sparse(18,{10:"water",13:"sand",16:"sand"}) },
  { id:"sawgrass", name:"TPC SAWGRASS", sub:"The Stadium Course", ico:"🏝", loc:"Florida, USA",
    pars:[4,5,3,4,4,4,4,3,5, 4,5,4,3,4,4,5,3,4],
    yards:[423,532,177,384,471,393,442,219,583, 424,558,302,181,481,449,523,137,447],
    names:{7:"The Bend",12:"Short Water",16:"Island Green"},
    haz: sparse(18,{7:"sand",12:"water",16:"water"}) },
  { id:"royalmelb", name:"ROYAL MELBOURNE WEST", sub:"The Sandbelt", ico:"🦘", loc:"Victoria, Australia",
    pars:[4,5,4,5,3,4,4,3,4, 4,5,4,4,4,5,3,4,3],
    yards:[429,480,354,470,176,428,148,305,440, 466,455,383,145,388,463,215,462,432],
    names:{2:"The Sandbelt",10:"Bunker Row",15:"The Cross"},
    haz: sparse(18,{2:"sand",10:"sand",15:"water"}) },
  { id:"kiawah", name:"KIAWAH ISLAND OCEAN", sub:"The Ocean Course", ico:"🌅", loc:"South Carolina, USA",
    pars:[4,5,4,4,3,4,5,3,4, 4,5,4,4,3,4,5,3,4],
    yards:[395,543,390,453,207,455,527,197,464, 439,562,466,404,194,421,579,221,439],
    names:{4:"The Marsh",13:"Tidal Creek",16:"Ocean Reach"},
    haz: sparse(18,{4:"water",13:"water",16:"sand"}) }
];

export { DICT, COURSES, EASY_WORDS, DIFF, PAR_LEN };

/** Every word the dictionaries allow, for checking a guess is a real word. */
const ALLOWED = { 4: new Set(), 5: new Set(), 6: new Set() };
for (const set of ["classic", "modern"]) {
  for (const n of [4, 5, 6]) {
    for (const [w] of DICT[set][n]) ALLOWED[n].add(w);
  }
}
export const isWord = (g) => !!ALLOWED[g.length]?.has(g);

/**
 * Wordle's marking, done here rather than in the page.
 *
 * Two passes, because a letter already matched exactly cannot also count as
 * misplaced somewhere else — guess SPEED against SPEND marks only one E.
 */
export function evaluate(guess, answer) {
  const n = answer.length;
  const res = Array(n).fill("miss");
  const pool = {};
  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) res[i] = "hit";
    else pool[answer[i]] = (pool[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < n; i++) {
    if (res[i] === "hit") continue;
    const ch = guess[i];
    if (pool[ch] > 0) { res[i] = "near"; pool[ch]--; }
  }
  return res;
}

/** How well a guess struck it, nought to one — this is how far the ball goes. */
export function quality(res) {
  let s = 0;
  for (const r of res) s += r === "hit" ? 2 : r === "near" ? 1 : 0;
  return s / (res.length * 2);
}

export function scoreName(strokes, par) {
  if (strokes === 1) return "HOLE IN ONE";
  const d = strokes - par;
  if (d <= -3) return "ALBATROSS";
  if (d === -2) return "EAGLE";
  if (d === -1) return "BIRDIE";
  if (d === 0) return "PAR";
  if (d === 1) return "BOGEY";
  if (d === 2) return "DOUBLE BOGEY";
  if (d === 3) return "TRIPLE BOGEY";
  return `+${d}`;
}

const POINTS_TABLE = { "-4": 90, "-3": 70, "-2": 48, "-1": 30, "0": 18, "1": 9, "2": 4, "3": 1, "4": 0 };
export function pointsFor(strokes, par) {
  if (strokes === 1) return 100;
  const d = Math.max(-4, Math.min(4, strokes - par));
  return POINTS_TABLE[String(d)] ?? 0;
}

/** The pool a hole draws from, given the tee. */
export function poolFor(dict, len, diff) {
  const all = DICT[dict][len];
  if (diff === "easy") {
    const e = all.filter(([w]) => EASY_WORDS.has(w));
    return e.length >= 5 ? e : all;
  }
  if (diff === "hard") {
    const hasRepeat = (w) => new Set(w).size !== w.length;
    const h = all.filter(([w]) => !EASY_WORDS.has(w) || hasRepeat(w));
    return h.length >= 12 ? h : all;
  }
  return all;
}

/** Guesses allowed on a word before the hole is conceded. */
export const maxGuesses = (par, diff) => Math.max(2, (PAR_LEN[par] || 5) + 1 + DIFF[diff].guessAdj);

export const courseById = (id) => COURSES.find((c) => c.id === id) || COURSES[0];
