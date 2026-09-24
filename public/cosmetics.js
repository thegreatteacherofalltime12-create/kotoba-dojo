// What a fighter can wear: avatars, frames, titles — and the rules for
// earning them.
//
// One module for both sides. The browser reads it to draw the overlay and
// the rankings; the Worker imports the same file to decide whether a choice
// is earned before it is written. A title the client claims but has not
// earned is refused there, so the rankings can trust what they show.
//
// Earning is measured in lifetime MMR: what is on the board now plus what
// prestige has already spent. A promotion costs 3,000 MMR and should never
// cost a title along with it.

export const PRESTIGE_COST = 3000;
export const lifetime = ({ mmr = 0, prestige = 0, spent = 0 } = {}) => (mmr || 0) + (prestige || 0) * PRESTIGE_COST + (spent || 0);
/** Prestiges counted across retirements: a retiree has climbed past General. */
export const prestigeEver = (standing) => (standing?.prestige || 0) + (standing?.retired || 0) * 10;

// ── avatars ────────────────────────────────────────────────────────────
//
// An avatar id is one of three things: a gi id from arena.js ("crimson"),
// an emoji ("e:🐉"), or a team ("t:nfl-kc"). The gis are the OG Robes.

export const AVATARS = [
  "🥋", "👊", "🤛", "🥊", "💪", "🦶", "🤩", "🤙", "✊", "🤜",
  "🧘", "🏃", "🤸", "🏋️", "🤺", "🏊", "🧗", "🤿", "🏄", "🚴",
  "🐍", "🐉", "🦅", "🐺", "🦁", "🦎", "🦍", "🐗", "🐻", "🦈",
  "🐯", "🦊", "🐶", "🐴", "🦬", "🐊", "🦖", "🦕", "🐧", "🐙",
  "🦂", "🦉", "🐝", "🦋", "🐢", "🦜", "🦩", "🐬", "🐋", "🦭",
  "🐲", "🦄", "🐸", "🐼", "🐨", "🦘", "🦥", "🐿️", "🦔", "🐇",
  "🚀", "🛸", "🪐", "🌙", "☀️", "⭐", "🌟", "⚡", "🔥", "❄️",
  "🌊", "🌪️", "🌈", "🌋", "☄️", "🌌", "🧊", "💧", "🍀", "🌵",
  "🎯", "🎲", "🃏", "🎰", "🏆", "🥇", "🎖️", "🏅", "🎳", "⛳",
  "⚔️", "🛡️", "🗡️", "🏹", "🔱", "⚓", "🚢", "⛵", "🧭", "🗺️",
  "💣", "💥", "🧨", "🔮", "🧿", "💎", "👑", "🎩", "🎭", "🎪",
  "🥷", "🧙", "🧛", "🧟", "👽", "🤖", "👾", "💀", "🎃", "🦾",
];

// Team avatars: an emoji on a disc in the team's colour. No logos — a
// mascot or a mark that reads as the team, in its colours.
const league = (id, name, rows) => ({
  id, name,
  teams: rows.map(([code, team, emoji, bg]) => ({ id: `${id}-${code}`, name: team, emoji, bg })),
});

export const LEAGUES = [
  league("nfl", "NFL", [
    ["ari", "Cardinals", "🐦", "#97233F"], ["atl", "Falcons", "🦅", "#A71930"], ["bal", "Ravens", "🐦‍⬛", "#241773"],
    ["buf", "Bills", "🦬", "#00338D"], ["car", "Panthers", "🐆", "#0085CA"], ["chi", "Bears", "🐻", "#0B162A"],
    ["cin", "Bengals", "🐯", "#FB4F14"], ["cle", "Browns", "🟤", "#311D00"], ["dal", "Cowboys", "⭐", "#003594"],
    ["den", "Broncos", "🐴", "#FB4F14"], ["det", "Lions", "🦁", "#0076B6"], ["gb", "Packers", "🧀", "#203731"],
    ["hou", "Texans", "🐂", "#03202F"], ["ind", "Colts", "🐎", "#002C5F"], ["jax", "Jaguars", "🐆", "#006778"],
    ["kc", "Chiefs", "🏹", "#E31837"], ["lv", "Raiders", "☠️", "#1a1a1a"], ["lac", "Chargers", "⚡", "#0080C6"],
    ["lar", "Rams", "🐏", "#003594"], ["mia", "Dolphins", "🐬", "#008E97"], ["min", "Vikings", "🛡️", "#4F2683"],
    ["ne", "Patriots", "🎩", "#002244"], ["no", "Saints", "⚜️", "#9F8958"], ["nyg", "Giants", "🗽", "#0B2265"],
    ["nyj", "Jets", "✈️", "#125740"], ["phi", "Eagles", "🦅", "#004C54"], ["pit", "Steelers", "🔩", "#101820"],
    ["sf", "49ers", "⛏️", "#AA0000"], ["sea", "Seahawks", "🦅", "#002244"], ["tb", "Buccaneers", "🏴‍☠️", "#D50A0A"],
    ["ten", "Titans", "🔥", "#4B92DB"], ["was", "Commanders", "🪖", "#5A1414"],
  ]),
  league("nhl", "NHL", [
    ["ana", "Ducks", "🦆", "#F47A38"], ["bos", "Bruins", "🐻", "#FFB81C"], ["buf", "Sabres", "🗡️", "#003087"],
    ["cgy", "Flames", "🔥", "#C8102E"], ["car", "Hurricanes", "🌀", "#CC0000"], ["chi", "Blackhawks", "🪶", "#CF0A2C"],
    ["col", "Avalanche", "❄️", "#6F263D"], ["cbj", "Blue Jackets", "💣", "#002654"], ["dal", "Stars", "⭐", "#006847"],
    ["det", "Red Wings", "🐙", "#CE1126"], ["edm", "Oilers", "🛢️", "#041E42"], ["fla", "Panthers", "🐆", "#C8102E"],
    ["la", "Kings", "👑", "#111111"], ["min", "Wild", "🌲", "#154734"], ["mtl", "Canadiens", "🏒", "#AF1E2D"],
    ["nsh", "Predators", "🐯", "#FFB81C"], ["nj", "Devils", "😈", "#CE1126"], ["nyi", "Islanders", "🏝️", "#00539B"],
    ["nyr", "Rangers", "🗽", "#0038A8"], ["ott", "Senators", "🏛️", "#C52032"], ["phi", "Flyers", "🧡", "#F74902"],
    ["pit", "Penguins", "🐧", "#FCB514"], ["sj", "Sharks", "🦈", "#006D75"], ["sea", "Kraken", "🦑", "#001628"],
    ["stl", "Blues", "🎵", "#002F87"], ["tb", "Lightning", "⚡", "#002868"], ["tor", "Maple Leafs", "🍁", "#00205B"],
    ["uta", "Mammoth", "🦣", "#6CACE4"], ["van", "Canucks", "🐋", "#00205B"], ["vgk", "Golden Knights", "⚔️", "#B4975A"],
    ["wsh", "Capitals", "🦅", "#C8102E"], ["wpg", "Jets", "✈️", "#041E42"],
  ]),
  league("mlb", "MLB", [
    ["ari", "Diamondbacks", "🐍", "#A71930"], ["atl", "Braves", "🪓", "#CE1141"], ["bal", "Orioles", "🐦", "#DF4601"],
    ["bos", "Red Sox", "🧦", "#BD3039"], ["chc", "Cubs", "🐻", "#0E3386"], ["cws", "White Sox", "🧦", "#27251F"],
    ["cin", "Reds", "🔴", "#C6011F"], ["cle", "Guardians", "🛡️", "#00385D"], ["col", "Rockies", "🏔️", "#333366"],
    ["det", "Tigers", "🐯", "#0C2340"], ["hou", "Astros", "⭐", "#002D62"], ["kc", "Royals", "👑", "#004687"],
    ["laa", "Angels", "😇", "#BA0021"], ["lad", "Dodgers", "🔵", "#005A9C"], ["mia", "Marlins", "🐟", "#00A3E0"],
    ["mil", "Brewers", "🍺", "#12284B"], ["min", "Twins", "👯", "#002B5C"], ["nym", "Mets", "🍎", "#002D72"],
    ["nyy", "Yankees", "🎩", "#0C2340"], ["ath", "Athletics", "🐘", "#003831"], ["phi", "Phillies", "🔔", "#E81828"],
    ["pit", "Pirates", "🏴‍☠️", "#27251F"], ["sd", "Padres", "🟫", "#2F241D"], ["sf", "Giants", "🌉", "#FD5A1E"],
    ["sea", "Mariners", "⚓", "#0C2C56"], ["stl", "Cardinals", "🐦", "#C41E3A"], ["tb", "Rays", "☀️", "#092C5C"],
    ["tex", "Rangers", "🤠", "#003278"], ["tor", "Blue Jays", "🐦", "#134A8E"], ["wsh", "Nationals", "🏛️", "#AB0003"],
  ]),
  league("usl", "USL", [
    ["bhm", "Birmingham Legion", "🦁", "#1B2A4A"], ["chs", "Charleston Battery", "⚓", "#F5C518"],
    ["cos", "Colorado Springs Switchbacks", "🏔️", "#0A2240"], ["det", "Detroit City", "🏭", "#6E1E2A"],
    ["elp", "El Paso Locomotive", "🚂", "#1A2B5F"], ["tul", "FC Tulsa", "⚡", "#0B3D91"],
    ["hfd", "Hartford Athletic", "🐐", "#0F6E3F"], ["ind", "Indy Eleven", "⚔️", "#0A2240"],
    ["lv", "Las Vegas Lights", "💡", "#F7B500"], ["ldn", "Loudoun United", "🦅", "#C8102E"],
    ["lou", "Louisville City", "🐎", "#4E2A84"], ["mem", "Memphis 901", "🎸", "#0A2240"],
    ["mia", "Miami FC", "☀️", "#00A3E0"], ["mb", "Monterey Bay", "🌊", "#1F6F8B"],
    ["nm", "New Mexico United", "🌵", "#F5C518"], ["nc", "North Carolina FC", "🐺", "#0A2240"],
    ["oak", "Oakland Roots", "🌳", "#0B6E4F"], ["oc", "Orange County", "🍊", "#F26522"],
    ["phx", "Phoenix Rising", "🔥", "#B71C1C"], ["pit", "Pittsburgh Riverhounds", "🐕", "#F7B500"],
    ["ri", "Rhode Island", "🦞", "#1B2A4A"], ["sac", "Sacramento Republic", "🦅", "#6E1E2A"],
    ["sa", "San Antonio", "🐂", "#C8102E"], ["tb", "Tampa Bay Rowdies", "🟢", "#0F6E3F"],
  ]),
];

const TEAMS = new Map(LEAGUES.flatMap((l) => l.teams.map((t) => [t.id, t])));

/** True for any avatar id this module or the gi list knows. */
export function knownAvatar(id, giIds) {
  if (typeof id !== "string") return false;
  if (id.startsWith("e:")) return AVATARS.includes(id.slice(2));
  if (id.startsWith("t:")) return TEAMS.has(id.slice(2));
  return giIds.includes(id);
}

/** The markup for an avatar, sized in px; gis are drawn by the caller. */
export function avatarHtml(id, size, giSvg) {
  if (typeof id === "string" && id.startsWith("e:") && AVATARS.includes(id.slice(2))) {
    return `<span class="av av-emoji" style="--s:${size}px" role="img">${id.slice(2)}</span>`;
  }
  if (typeof id === "string" && id.startsWith("t:") && TEAMS.has(id.slice(2))) {
    const t = TEAMS.get(id.slice(2));
    return `<span class="av av-team" style="--s:${size}px;--bg:${t.bg}" role="img" aria-label="${t.name}">${t.emoji}</span>`;
  }
  return giSvg(id, size);
}

// ── frames ─────────────────────────────────────────────────────────────
//
// Three boxes of ten. Rare frames hold still and are free. Epic frames
// carry their colours round the avatar and open at Green belt. Legendary
// frames pulse and open with the first prestige.

export const FRAME_TIERS = {
  rare: { name: "Rare", need: {} },
  epic: { name: "Epic", need: { mmr: 600 } },
  legendary: { name: "Legendary", need: { prestige: 1 } },
};

const frame = (id, name, tier, shape, colors) => ({ id, name, tier, shape, colors });

export const FRAMES = [
  frame("none", "None", "rare", "circle", []),
  // rare — still
  frame("gold", "Gold", "rare", "circle", ["#F4CE5A", "#B8860B"]),
  frame("crimson", "Crimson", "rare", "circle", ["#F43F5E", "#9F1239"]),
  frame("ice", "Ice", "rare", "circle", ["#7DD3FC", "#0EA5E9"]),
  frame("emerald", "Emerald", "rare", "circle", ["#34D399", "#047857"]),
  frame("royal", "Royal Purple", "rare", "circle", ["#A78BFA", "#5B21B6"]),
  frame("steel-square", "Steel Square", "rare", "square", ["#CBD5E1", "#64748B"]),
  frame("slate-rounded", "Slate Rounded", "rare", "rounded", ["#94A3B8", "#334155"]),
  frame("bronze-hex", "Bronze Hex", "rare", "hex", ["#D6A05C", "#8A4B1F"]),
  frame("silver-diamond", "Silver Diamond", "rare", "diamond", ["#E5E7EB", "#9CA3AF"]),
  frame("iron-shield", "Iron Shield", "rare", "shield", ["#A1A1AA", "#3F3F46"]),
  // epic — colours travel round
  frame("emerald-ring", "Emerald Ring", "epic", "circle", ["#34D399", "#0F766E", "#A7F3D0"]),
  frame("lightning", "Lightning", "epic", "circle", ["#FDE047", "#F59E0B", "#FFFBEB"]),
  frame("thorns", "Thorns", "epic", "circle", ["#F43F5E", "#7F1D1D", "#FDA4AF"]),
  frame("frost-crystal", "Frost Crystal", "epic", "hex", ["#BAE6FD", "#0284C7", "#F0F9FF"]),
  frame("flame-edge", "Flame Edge", "epic", "rounded", ["#FB923C", "#DC2626", "#FEF3C7"]),
  frame("prismatic-ring", "Prismatic Ring", "epic", "circle", ["#F43F5E", "#F59E0B", "#22C55E", "#3B82F6", "#A855F7"]),
  frame("toxic-hex", "Toxic Hex", "epic", "hex", ["#A3E635", "#365314", "#D9F99D"]),
  frame("onyx-block", "Onyx Block", "epic", "square", ["#E5E7EB", "#111827", "#6B7280"]),
  frame("war-shield", "War Shield", "epic", "shield", ["#EF4444", "#1F2937", "#FCA5A5"]),
  frame("orbiter", "Orbiter", "epic", "diamond", ["#60A5FA", "#1E3A8A", "#DBEAFE"]),
  // legendary — pulses
  frame("pulse-ring", "Pulse Ring", "legendary", "circle", ["#F472B6", "#9D174D"]),
  frame("star-ring", "Star Ring", "legendary", "circle", ["#FDE68A", "#F59E0B"]),
  frame("blood-moon", "Blood Moon", "legendary", "circle", ["#EF4444", "#450A0A"]),
  frame("phantom", "Phantom", "legendary", "rounded", ["#C4B5FD", "#312E81"]),
  frame("cyber", "Cyber", "legendary", "square", ["#22D3EE", "#0E7490"]),
  frame("inferno", "Inferno", "legendary", "hex", ["#FB923C", "#7C2D12"]),
  frame("nebula", "Nebula", "legendary", "circle", ["#A855F7", "#2563EB"]),
  frame("aurora", "Aurora", "legendary", "rounded", ["#34D399", "#818CF8"]),
  frame("void-diamond", "Void Diamond", "legendary", "diamond", ["#E9D5FF", "#111111"]),
  frame("royal-shield", "Royal Shield", "legendary", "shield", ["#F4CE5A", "#4C1D95"]),
];

export const frameById = (id) => FRAMES.find((f) => f.id === id) || FRAMES[0];

/**
 * An avatar in its frame. `live` lets the frame move; the rankings freeze
 * everyone outside the top three.
 */
export function framedHtml(avatar, frameId, size, live = true) {
  const f = frameById(frameId);
  if (f.id === "none") return `<span class="af af-none" style="--s:${size}px">${avatar}</span>`;
  const fx = f.tier === "epic" ? "af-spin" : f.tier === "legendary" ? "af-pulse" : "af-still";
  const stops = f.colors.length > 1 ? [...f.colors, f.colors[0]].join(", ") : `${f.colors[0]}, ${f.colors[0]}`;
  return `<span class="af af-${f.shape} ${fx} ${live ? "" : "af-frozen"}" style="--s:${size}px;--c1:${f.colors[0]};--c2:${f.colors[1] || f.colors[0]};--stops:${stops}" title="${f.name}">`
    + `<span class="af-ring"></span><span class="af-in">${avatar}</span></span>`;
}

// ── titles ─────────────────────────────────────────────────────────────
//
// The rule template. A title is earned when the player's lifetime MMR and
// prestige both meet `need`. Adding a title is one line here; the overlay
// and the server read the same table. Ordered by how hard they are.

const title = (id, name, game, need) => ({ id, name, game, need });

export const TITLES = [
  title("student", "Student", "arena", {}),
  title("letter-runner", "Letter Runner", "crossword", { mmr: 100 }),
  title("deckhand", "Deckhand", "battleship", { mmr: 200 }),
  title("sapper", "Sapper", "minesweeper", { mmr: 300 }),
  title("caddie", "Caddie", "links", { mmr: 400 }),
  title("card-shark", "Card Shark", "casino", { mmr: 500 }),
  title("grid-walker", "Grid Walker", "crossword", { mmr: 600 }),
  title("gunner", "Gunner", "battleship", { mmr: 700 }),
  title("bomb-whisperer", "Bomb Whisperer", "minesweeper", { mmr: 800 }),
  title("scrambler", "Scrambler", "links", { mmr: 900 }),
  title("high-roller", "High Roller", "casino", { mmr: 1000 }),
  title("wordsmith", "Wordsmith", "crossword", { mmr: 1200 }),
  title("fleet-captain", "Fleet Captain", "battleship", { mmr: 1400 }),
  title("minefield-master", "Minefield Master", "minesweeper", { mmr: 1600 }),
  title("eagle-eye", "Eagle Eye", "links", { mmr: 1800 }),
  title("house-breaker", "House Breaker", "casino", { mmr: 2000 }),
  title("lexicon-sensei", "Lexicon Sensei", "crossword", { mmr: 2200 }),
  title("admiral", "Admiral of the Multiverse", "battleship", { mmr: 2400 }),
  title("black-belt", "Black Belt", "arena", { mmr: 2600 }),
  title("grandmaster", "Grandmaster of the Grid", "crossword", { mmr: 2800 }),
  title("officer", "Space Force Officer", "arena", { prestige: 1 }),
  title("champion", "Multiverse Champion", "arena", { prestige: 3 }),
  title("warlord", "Warlord of Madness", "arena", { prestige: 5 }),
  title("general", "General of the Arena", "arena", { prestige: 10 }),
];

export const GAME_NAMES = {
  arena: "Arena", crossword: "Word-Cross", battleship: "Battleship",
  minesweeper: "Minesweeper", links: "Multiverse Golf", casino: "Casino",
};

export const titleById = (id) => TITLES.find((t) => t.id === id) || null;

/** Whether a `need` is met by a standing. */
export function meets(need, standing) {
  const life = lifetime(standing);
  return life >= (need?.mmr || 0) && prestigeEver(standing) >= (need?.prestige || 0);
}

/** How a `need` reads to a player who has not met it. */
export function needText(need) {
  if (need?.prestige) return `Prestige ${need.prestige}`;
  if (need?.mmr) return `${need.mmr.toLocaleString()} lifetime MMR`;
  return "Free";
}


// ── feats ──────────────────────────────────────────────────────────────
//
// What a finished round adds to a player's record, counted on the board
// row as `feats.<key>`. Banners are earned from these. Every key is a
// plain counter so the match write can increment it in the same commit
// that records the score — no read, no extra write.

const DONE = new Set(["finished", "solved", "won", "cleared"]);
export const FAST_CROSSWORD_MS = 3 * 60_000;    // a round finished this fast is a Speed Reader's
export const FAST_MINESWEEPER_MS = 60_000;      // a board cleared this fast is a Lightning Sweep
export const BIG_BANK = 500;                    // a single cash-out this size is a Jackpot

/** A counter that is a low-water mark rather than a running total. */
export const isMark = (key) => key.startsWith("best_");

/**
 * Did an arsenal token help this round along? The 1.5x boost does not
 * count: it pays more for a round, it does not play it for you. A round
 * that used one is marked on the record boards rather than kept off them.
 */
export const assistedRound = (r) =>
  r?.assisted === true || Object.values(r?.spent || {}).some((n) => Number(n) > 0);

export function featsFor(match, r) {
  const game = match.game || "crossword";
  // A room that fields computer opponents reports how many actually lined
  // up, because its results rows only carry the people. Without it, beating
  // five drivers would count as having raced alone.
  const field = Number(match.field) || match.results.length;
  const done = DONE.has(r.status);
  const won = field > 1 && r.placement === 1;
  const out = { played_any: 1, [`played_${game}`]: 1 };
  if (won) { out.won_any = 1; out[`won_${game}`] = 1; }
  if (field === 1 && done) out[`solo_${game}`] = 1;
  const helped = assistedRound(r);
  if (helped) { out.assisted_any = 1; out[`assisted_${game}`] = 1; }
  if (game === "crossword") {
    if (r.solved > 0) out.solved_crossword = r.solved;
    if (done && r.elapsedMs > 0 && r.elapsedMs < FAST_CROSSWORD_MS) out.fast_crossword = 1;
  }
  if (game === "battleship") {
    if (r.sunk > 0) out.sunk_battleship = r.sunk;
    if (r.hits > 0) out.hits_battleship = r.hits;
    if (r.eliminated > 0) out.eliminated_battleship = r.eliminated;
    if (won && match.mapId === "hard") out.deep_battleship = 1;
  }
  if (game === "minesweeper" && r.status === "cleared") {
    out.cleared_minesweeper = 1;
    if (r.elapsedMs > 0 && r.elapsedMs < FAST_MINESWEEPER_MS) out.fast_minesweeper = 1;
  }
  if (game === "links") {
    if (r.holes > 0) out.holes_links = r.holes;
    if (r.aces > 0) out.aces_links = r.aces;
    if (r.status === "finished") {
      out.finished_links = 1;
      if (r.toPar < 0) out.under_par_links = 1;
      // The course record: a low-water mark, not a count. Keys that begin
      // with best_ are written as a minimum rather than an increment.
      // A card set with tokens keeps its own mark, so the clean record and
      // the assisted one sit side by side instead of one erasing the other.
      if (match.courseId && Number.isFinite(r.toPar))
        out[helped ? `best_asst_links_${match.courseId}` : `best_links_${match.courseId}`] = r.toPar;
    }
  }
  return out;
}

// ── banners ────────────────────────────────────────────────────────────
//
// A banner is a moving backdrop on a player's row in the Arena Rankings —
// and nowhere else. Three per game, earned by that game's feats.

// A need is one counter reaching a count — or, with `all`, several
// counters each reaching one, for banners that ask for a bit of everything.
const banner = (id, name, game, feat, count, icon, colors) => ({ id, name, game, need: { feat, count }, icon, colors });
const spread = (id, name, game, all, icon, colors) => ({ id, name, game, need: { all }, icon, colors });

export const BANNERS = [
  banner("first-word", "First Word", "crossword", "won_crossword", 1, "🔤", ["#1d4ed8", "#60a5fa"]),
  banner("word-hoard", "Word Hoard", "crossword", "solved_crossword", 100, "📚", ["#312e81", "#818cf8"]),
  banner("lexicon", "Lexicon", "crossword", "won_crossword", 10, "📜", ["#0f766e", "#5eead4"]),
  banner("first-blood", "First Blood", "battleship", "won_battleship", 1, "⚓", ["#0c4a6e", "#38bdf8"]),
  banner("twenty-hulls", "Twenty Hulls", "battleship", "sunk_battleship", 20, "💥", ["#7f1d1d", "#f87171"]),
  banner("fleet-admiral", "Fleet Admiral", "battleship", "won_battleship", 10, "🎖️", ["#1e3a8a", "#fbbf24"]),
  banner("defused", "Defused", "minesweeper", "cleared_minesweeper", 1, "🚩", ["#3f6212", "#a3e635"]),
  banner("steady-hands", "Steady Hands", "minesweeper", "cleared_minesweeper", 10, "🧤", ["#334155", "#cbd5e1"]),
  banner("bomb-squad", "Bomb Squad", "minesweeper", "won_minesweeper", 10, "💣", ["#78350f", "#fb923c"]),
  banner("on-the-green", "On the Green", "links", "finished_links", 1, "⛳", ["#14532d", "#4ade80"]),
  banner("under-par", "Under Par", "links", "under_par_links", 1, "🦅", ["#065f46", "#fde047"]),
  banner("course-record", "Course Record", "links", "won_links", 5, "🏌️", ["#166534", "#bbf7d0"]),
  banner("first-cash-out", "First Cash-Out", "casino", "banks", 1, "💵", ["#713f12", "#facc15"]),
  banner("high-roller", "High Roller", "casino", "banked", 1000, "🎰", ["#581c87", "#f0abfc"]),
  banner("the-house", "The House", "casino", "banked", 10000, "👑", ["#7c2d12", "#fcd34d"]),
  banner("debut", "Debut", "arena", "played_any", 1, "🥋", ["#1f2937", "#9ca3af"]),
  banner("centurion", "Centurion", "arena", "played_any", 100, "🛡️", ["#3b0764", "#c084fc"]),
  banner("champion", "Champion", "arena", "won_any", 25, "🏆", ["#7f1d1d", "#fbbf24"]),
  // the second ten
  banner("speed-reader", "Speed Reader", "crossword", "fast_crossword", 1, "⏱️", ["#0e7490", "#67e8f9"]),
  banner("lone-scholar", "Lone Scholar", "crossword", "solo_crossword", 10, "🕯️", ["#4a1d96", "#a78bfa"]),
  banner("dead-eye", "Dead Eye", "battleship", "hits_battleship", 100, "🎯", ["#7c2d12", "#fdba74"]),
  banner("open-ocean", "Open Ocean", "battleship", "deep_battleship", 1, "🌊", ["#082f49", "#0ea5e9"]),
  banner("lightning-sweep", "Lightning Sweep", "minesweeper", "fast_minesweeper", 1, "⚡", ["#713f12", "#fde047"]),
  banner("lone-sapper", "Lone Sapper", "minesweeper", "solo_minesweeper", 10, "🔦", ["#1e293b", "#94a3b8"]),
  banner("hole-in-one", "Hole in One", "links", "aces_links", 1, "🏆", ["#14532d", "#fde68a"]),
  banner("grand-tour", "Grand Tour", "links", "holes_links", 100, "🗺️", ["#134e4a", "#5eead4"]),
  banner("jackpot", "Jackpot", "casino", "bigbank", 1, "💎", ["#831843", "#f9a8d4"]),
  spread("tourist", "Multiverse Tourist", "arena",
    ["played_crossword", "played_battleship", "played_minesweeper", "played_links", "banks"], "🪐", ["#1e1b4b", "#c7d2fe"]),
];

export const bannerById = (id) => BANNERS.find((b) => b.id === id) || null;

export const bannerEarned = (id, standing) => {
  const b = bannerById(id);
  if (!b) return false;
  const have = (k) => standing?.feats?.[k] || 0;
  if (b.need.all) return b.need.all.every((k) => have(k) >= 1);
  return have(b.need.feat) >= b.need.count;
};

export const FEAT_TEXT = {
  won_crossword: "Word-Cross wins", solved_crossword: "words solved", won_battleship: "Battleship wins",
  sunk_battleship: "ships sunk", cleared_minesweeper: "boards cleared", won_minesweeper: "Minesweeper wins",
  finished_links: "rounds of golf finished", under_par_links: "rounds under par", won_links: "golf wins",
  banks: "casino cash-outs", banked: "dollars banked", played_any: "games played", won_any: "wins",
  fast_crossword: "rounds finished in under 3 minutes", solo_crossword: "solo Word-Cross finishes",
  hits_battleship: "hits landed", deep_battleship: "wins on Open Ocean",
  fast_minesweeper: "boards cleared in under a minute", solo_minesweeper: "solo clears",
  aces_links: "holes in one", holes_links: "holes played", bigbank: "cash-outs of $500 or more",
  played_crossword: "Word-Cross", played_battleship: "Battleship", played_minesweeper: "Minesweeper", played_links: "Golf",
  won_prix: "Grand Prix wins", played_prix: "races started", solo_prix: "solo races finished",
  casino_wins: "casino wins worth MMR",
};

/** How a banner's need reads, with how far along the player is. */
export function bannerNeedText(b, standing) {
  if (b.need.all) {
    const done = b.need.all.filter((k) => (standing?.feats?.[k] || 0) >= 1).length;
    const left = b.need.all.filter((k) => !(standing?.feats?.[k] || 0)).map((k) => FEAT_TEXT[k] || k);
    return `${done} / ${b.need.all.length} games${left.length ? ` · still to play: ${left.join(", ")}` : ""}`;
  }
  const have = standing?.feats?.[b.need.feat] || 0;
  return `${Math.min(have, b.need.count).toLocaleString()} / ${b.need.count.toLocaleString()} ${FEAT_TEXT[b.need.feat] || b.need.feat}`;
}

/** The backdrop for a rankings row. `live` lets it move. */
export function bannerHtml(id, live = true) {
  const b = bannerById(id);
  if (!b) return "";
  return `<span class="bnr bnr-${b.game} ${live ? "" : "bnr-frozen"}" style="--b1:${b.colors[0]};--b2:${b.colors[1]}" data-icon="${b.icon}" title="${b.name}" aria-hidden="true"></span>`;
}

export const frameEarned = (id, standing) => meets(FRAME_TIERS[frameById(id).tier].need, standing);
export const titleEarned = (id, standing) => { const t = titleById(id); return !!t && meets(t.need, standing); };

/**
 * The choice a player may keep, given where they stand. Anything unknown
 * or unearned falls back — the server calls this before writing, so an
 * unearned title never reaches the board.
 */
/**
 * The kart you race in.
 *
 * Cosmetic and nothing else: every kart on the grid is the same car, and
 * the only thing that moves it is answering. Free to choose, like the
 * avatars — nothing here is earned, so nothing here needs a standing to
 * check against.
 */
export const KARTS = [
  { id: "f1", name: "Formula", ico: "\u{1F3CE}\uFE0F" },
  { id: "saloon", name: "Saloon", ico: "\u{1F697}" },
  { id: "estate", name: "Estate", ico: "\u{1F699}" },
  { id: "pickup", name: "Pickup", ico: "\u{1F6FB}" },
  { id: "taxi", name: "Taxi", ico: "\u{1F695}" },
  { id: "camper", name: "Camper", ico: "\u{1F690}" },
  { id: "squad", name: "Squad Car", ico: "\u{1F693}" },
  { id: "ambulance", name: "Ambulance", ico: "\u{1F691}" },
  { id: "engine", name: "Fire Engine", ico: "\u{1F692}" },
  { id: "tractor", name: "Tractor", ico: "\u{1F69C}" },
  { id: "rickshaw", name: "Rickshaw", ico: "\u{1F6FA}" },
  { id: "moto", name: "Motorcycle", ico: "\u{1F3CD}\uFE0F" },
  { id: "scooter", name: "Scooter", ico: "\u{1F6F5}" },
  { id: "bicycle", name: "Bicycle", ico: "\u{1F6B2}" },
  { id: "skateboard", name: "Skateboard", ico: "\u{1F6F9}" },
  { id: "skates", name: "Roller Skates", ico: "\u{1F6FC}" },
  { id: "sled", name: "Sled", ico: "\u{1F6F7}" },
  { id: "bus", name: "Bus", ico: "\u{1F68C}" },
  { id: "truck", name: "Truck", ico: "\u{1F69A}" },
  { id: "lorry", name: "Lorry", ico: "\u{1F69B}" },
  { id: "loco", name: "Locomotive", ico: "\u{1F682}" },
  { id: "tram", name: "Tram", ico: "\u{1F68B}" },
  { id: "chopper", name: "Helicopter", ico: "\u{1F681}" },
  { id: "sailboat", name: "Sailboat", ico: "\u26F5" },
  { id: "duck", name: "Duck", ico: "\u{1F986}" },
  // Earned on the track. A race against computer drivers counts: the arena
  // already pays it MMR like any other, so it would be strange to call it a
  // win for the belt and not for the kart.
  { id: "flag", name: "Chequered", ico: "\u{1F3C1}", need: { feat: "won_prix", count: 1 } },
  { id: "rocket", name: "Rocket", ico: "\u{1F680}", need: { feat: "won_prix", count: 3 } },
  { id: "dino", name: "Tyrannosaur", ico: "\u{1F996}", need: { feat: "won_prix", count: 5 } },
  { id: "unicorn", name: "Unicorn", ico: "\u{1F984}", need: { feat: "won_prix", count: 10 } },
  { id: "saucer", name: "Flying Saucer", ico: "\u{1F6F8}", need: { feat: "won_prix", count: 25 } },
  // For turning up and for going round alone, so a player with nobody to
  // race still has something to chase.
  { id: "snail", name: "Snail", ico: "\u{1F40C}", need: { feat: "played_prix", count: 10 } },
  { id: "horse", name: "Racehorse", ico: "\u{1F40E}", need: { feat: "solo_prix", count: 10 } },
  { id: "tortoise", name: "Tortoise", ico: "\u{1F422}", need: { feat: "solo_prix", count: 25 } },
];
export const DEFAULT_KART = "f1";
export const kartById = (id) => KARTS.find((k) => k.id === id) || KARTS[0];
export const knownKart = (id) => KARTS.some((k) => k.id === id);

/**
 * Whether a kart is this player's to drive. Most are free; the ones with a
 * need are won on the track, counted from the same feats the banners use.
 */
export const kartEarned = (id, standing) => {
  const k = KARTS.find((x) => x.id === id);
  if (!k) return false;
  if (!k.need) return true;
  return (standing?.feats?.[k.need.feat] || 0) >= k.need.count;
};

/** How a locked kart reads, with how far along the player is. */
export function kartNeedText(k, standing) {
  if (!k?.need) return "Free";
  const have = standing?.feats?.[k.need.feat] || 0;
  return `${Math.min(have, k.need.count).toLocaleString()} / ${k.need.count.toLocaleString()} ${FEAT_TEXT[k.need.feat] || k.need.feat}`;
}

export function allowed(cos, standing, giIds) {
  const out = {};
  out.avatar = knownAvatar(cos?.avatar, giIds) ? cos.avatar : giIds[0];
  out.frame = frameEarned(cos?.frame, standing) ? frameById(cos?.frame).id : "none";
  out.title = titleEarned(cos?.title, standing) ? cos.title : "";
  out.banner = bannerEarned(cos?.banner, standing) ? cos.banner : "";
  out.kart = kartEarned(cos?.kart, standing) ? cos.kart : DEFAULT_KART;
  out.open = cos?.open === true || cos?.open === "1";
  return out;
}

// ── achievements ───────────────────────────────────────────────────────
//
// Everything a standing has earned, listed. Read by the Achievements tab
// for the player's own record and for anyone who has set theirs public.

export function achievementsFor(standing) {
  const banners = BANNERS.filter((b) => bannerEarned(b.id, standing));
  const titles = TITLES.filter((t) => meets(t.need, standing));
  const frameTiers = Object.entries(FRAME_TIERS).filter(([, t]) => meets(t.need, standing)).map(([id, t]) => ({ id, name: t.name }));
  const feats = standing?.feats || {};
  const stats = Object.keys(feats)
    .filter((k) => !isMark(k) && feats[k] > 0)
    .map((k) => ({ key: k, label: statLabel(k), value: feats[k] }))
    .sort((a, b) => a.label.localeCompare(b.label));
  for (const k of Object.keys(feats)) {
    if (isMark(k)) stats.push({ key: k, label: statLabel(k), value: feats[k] });
  }
  return { banners, titles, frameTiers, stats };
}

const STAT_GAMES = { crossword: "Word-Cross", battleship: "Battleship", minesweeper: "Minesweeper", links: "Golf", casino: "Casino", any: "All games" };
function statLabel(key) {
  if (key.startsWith("best_asst_links_")) return `Best assisted round to par, ${key.slice("best_asst_links_".length)}`;
  if (key.startsWith("best_links_")) return `Best round to par, ${key.slice("best_links_".length)}`;
  if (FEAT_TEXT[key] && !key.startsWith("played_")) return FEAT_TEXT[key][0].toUpperCase() + FEAT_TEXT[key].slice(1);
  const m = key.match(/^(played|won|solo|assisted)_(\w+)$/);
  if (m) return `${{ played: "Played", won: "Won", solo: "Solo finishes", assisted: "Token-assisted rounds" }[m[1]]}, ${STAT_GAMES[m[2]] || m[2]}`;
  return key;
}
