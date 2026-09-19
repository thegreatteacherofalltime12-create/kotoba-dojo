// node scripts/cosmetics-test.mjs
//
// What a fighter can wear, and the rules for earning it. The same module
// runs in the browser and in the Worker, so this pins both the catalogue
// and the gate.
import {
  AVATARS, LEAGUES, FRAMES, FRAME_TIERS, TITLES, lifetime, meets, needText,
  knownAvatar, avatarHtml, framedHtml, frameEarned, titleEarned, allowed,
  BANNERS, featsFor, bannerEarned, bannerNeedText, bannerHtml, isMark,
} from "../public/cosmetics.js";
import { GI_COLORS } from "../public/arena.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };
const gis = GI_COLORS.map((g) => g.id);
const gi = (id, size) => `<svg data-gi="${id}" width="${size}"></svg>`;

console.log("\nthe catalogue");
ok("a hundred avatars at least", AVATARS.length >= 100);
ok("no avatar twice", new Set(AVATARS).size === AVATARS.length);
ok("four leagues", LEAGUES.map((l) => l.name).join() === "NFL,NHL,MLB,USL");
ok("full leagues", LEAGUES.every((l) => l.teams.length >= 24));
const teamIds = LEAGUES.flatMap((l) => l.teams.map((t) => t.id));
ok("no team id twice", new Set(teamIds).size === teamIds.length);
ok("every team has a colour", LEAGUES.every((l) => l.teams.every((t) => /^#[0-9A-Fa-f]{6}$/.test(t.bg))));
const byTier = (t) => FRAMES.filter((f) => f.tier === t && f.id !== "none");
ok("ten still, ten travelling, ten pulsing", byTier("rare").length === 10 && byTier("epic").length === 10 && byTier("legendary").length === 10);
ok("shapes other than circles in every tier", ["rare", "epic", "legendary"].every((t) => byTier(t).some((f) => f.shape !== "circle")));
ok("no frame id twice", new Set(FRAMES.map((f) => f.id)).size === FRAMES.length);
ok("twenty titles at least", TITLES.length >= 20);
ok("no title id twice", new Set(TITLES.map((t) => t.id)).size === TITLES.length);
ok("every game has titles", ["crossword", "battleship", "minesweeper", "links", "casino", "arena"]
  .every((g) => TITLES.some((t) => t.game === g)));
const mmrNeeds = TITLES.filter((t) => t.need.mmr).map((t) => t.need.mmr);
ok("the MMR titles climb", mmrNeeds.every((n, i) => i === 0 || n > mmrNeeds[i - 1]));

console.log("\nearning");
ok("lifetime counts what prestige spent", lifetime({ mmr: 200, prestige: 2 }) === 6200);
ok("a fresh player has the free things", meets({}, { mmr: 0, prestige: 0 }) && titleEarned("student", { mmr: 0 }));
ok("and nothing gated", !titleEarned("wordsmith", { mmr: 1199 }) && !frameEarned("lightning", { mmr: 599 }));
ok("green belt opens the epic frames", frameEarned("lightning", { mmr: 600 }) && !frameEarned("pulse-ring", { mmr: 5000 }));
ok("the first prestige opens the legendary ones", frameEarned("pulse-ring", { mmr: 0, prestige: 1 }));
ok("a promotion never costs a title", titleEarned("grandmaster", { mmr: 0, prestige: 1 }));
ok("prestige titles need prestige, not points", !titleEarned("officer", { mmr: 9000, prestige: 0 }) && titleEarned("officer", { mmr: 0, prestige: 1 }));
ok("the need reads plainly", needText({ mmr: 1200 }) === "1,200 lifetime MMR" && needText({ prestige: 3 }) === "Prestige 3" && needText({}) === "Free");

console.log("\nthe gate");
const low = { mmr: 50, prestige: 0 };
let kept = allowed({ avatar: "e:🐉", frame: "lightning", title: "admiral" }, low, gis);
ok("an unearned frame and title fall back", kept.frame === "none" && kept.title === "");
ok("the avatar is kept", kept.avatar === "e:🐉");
kept = allowed({ avatar: "t:nfl-kc", frame: "gold", title: "letter-runner" }, { mmr: 150, prestige: 0 }, gis);
ok("earned choices pass", kept.avatar === "t:nfl-kc" && kept.frame === "gold" && kept.title === "letter-runner");
kept = allowed({ avatar: "e:💩", frame: "made-up", title: "made-up" }, { mmr: 9999, prestige: 9 }, gis);
ok("unknown ids fall back whatever the standing", kept.avatar === gis[0] && kept.frame === "none" && kept.title === "");
ok("nothing at all is fine", allowed(null, low, gis).avatar === gis[0]);
ok("gi ids are known, junk is not", knownAvatar("crimson", gis) && !knownAvatar("e:", gis) && !knownAvatar(42, gis));

console.log("\ndrawing");
ok("a gi is drawn by the caller", avatarHtml("crimson", 40, gi).includes('data-gi="crimson"'));
ok("an emoji is a span", avatarHtml("e:🐉", 40, gi).startsWith('<span class="av av-emoji"'));
ok("a team carries its colour", avatarHtml("t:nfl-kc", 40, gi).includes("--bg:#E31837"));
ok("no frame is just the avatar", framedHtml("<i/>", "none", 40).includes("af-none") && !framedHtml("<i/>", "none", 40).includes("af-ring"));
ok("a rare frame holds still", framedHtml("<i/>", "gold", 40).includes("af-still"));
ok("an epic frame turns", framedHtml("<i/>", "lightning", 40).includes("af-spin"));
ok("a legendary frame pulses", framedHtml("<i/>", "pulse-ring", 40).includes("af-pulse"));
ok("and can be frozen", framedHtml("<i/>", "pulse-ring", 40, false).includes("af-frozen") && !framedHtml("<i/>", "pulse-ring", 40, true).includes("af-frozen"));
ok("the shape is on the wrapper", framedHtml("<i/>", "bronze-hex", 40).includes("af-hex"));

console.log("\nfeats");
const m = (game, n) => ({ game, results: new Array(n).fill({}) });
let f = featsFor(m("battleship", 3), { placement: 1, status: "won", sunk: 4 });
ok("a win in a field counts as a win, and the ships sunk", f.won_battleship === 1 && f.won_any === 1 && f.sunk_battleship === 4 && f.played_any === 1);
f = featsFor(m("battleship", 3), { placement: 2, status: "sunk", sunk: 2 });
ok("a loss counts the play and the sinkings only", !f.won_any && f.sunk_battleship === 2 && f.played_battleship === 1);
f = featsFor(m("minesweeper", 1), { placement: 1, status: "cleared" });
ok("a solo clear is a clear and a solo, not a win", f.cleared_minesweeper === 1 && f.solo_minesweeper === 1 && !f.won_any);
f = featsFor(m("links", 2), { placement: 1, status: "finished", toPar: -3 });
ok("golf under par is noted", f.under_par_links === 1 && f.finished_links === 1 && f.won_links === 1);
f = featsFor(m("links", 2), { placement: 2, status: "ended", toPar: 2 });
ok("a round walked off is played, not finished", f.played_links === 1 && !f.finished_links && !f.under_par_links);
f = featsFor(m("crossword", 4), { placement: 3, status: "finished", solved: 7 });
ok("words solved add up", f.solved_crossword === 7 && !f.won_any);
f = featsFor({ results: [{}] }, { placement: 1, status: "finished", solved: 0 });
ok("no game named is a crossword, and zero words is nothing", f.played_crossword === 1 && !("solved_crossword" in f));

f = featsFor(m("battleship", 4), { placement: 1, status: "won", hits: 9, sunk: 3, eliminated: 2 });
ok("captains eliminated are counted", f.eliminated_battleship === 2);
f = featsFor({ game: "links", courseId: "augusta", results: [{}, {}] }, { placement: 2, status: "finished", toPar: -2, holes: 18 });
ok("a finished round leaves a course record, as a mark not a count", f.best_links_augusta === -2 && isMark("best_links_augusta") && !isMark("won_links"));
f = featsFor({ game: "links", courseId: "augusta", results: [{}, {}] }, { placement: 2, status: "ended", toPar: -2, holes: 9 });
ok("a round walked off leaves none", !("best_links_augusta" in f));

console.log("\nbanners");
ok("twenty-eight banners, every game with at least four", BANNERS.length === 28
  && ["crossword", "battleship", "minesweeper", "links", "casino", "arena"].every((g) => BANNERS.filter((b) => b.game === g).length >= 4));
ok("no banner id twice", new Set(BANNERS.map((b) => b.id)).size === BANNERS.length);
ok("every banner's feat is one the games can count",
  BANNERS.every((b) => (b.need.all || [b.need.feat]).every((k) =>
    ["won_", "solved_", "sunk_", "cleared_", "finished_", "under_par_", "played_", "solo_", "fast_", "hits_", "deep_", "aces_", "holes_", "banks", "banked", "bigbank"].some((p) => k.startsWith(p)))));
const st = { mmr: 0, prestige: 0, feats: { won_battleship: 1, banked: 999, played_any: 100 } };
ok("earned by the counter", bannerEarned("first-blood", st) && bannerEarned("centurion", st));
ok("not before it", !bannerEarned("fleet-admiral", st) && !bannerEarned("high-roller", st));
ok("nothing earned with no record", !bannerEarned("debut", { mmr: 0 }) && !bannerEarned("made-up", st));
ok("progress reads plainly", bannerNeedText(BANNERS.find((b) => b.id === "high-roller"), st) === "999 / 1,000 dollars banked");
ok("the gate keeps an earned banner and drops an unearned one",
  allowed({ banner: "first-blood" }, st, gis).banner === "first-blood" && allowed({ banner: "the-house" }, st, gis).banner === "");
ok("a banner is a backdrop with its icon", bannerHtml("first-blood").includes("bnr-battleship") && bannerHtml("first-blood").includes('data-icon="⚓"'));
ok("and can be frozen", bannerHtml("first-blood", false).includes("bnr-frozen") && !bannerHtml("first-blood", true).includes("bnr-frozen"));
ok("an unknown banner draws nothing", bannerHtml("nope") === "");

console.log("\nthe second ten");
f = featsFor(m("crossword", 2), { placement: 2, status: "finished", elapsedMs: 150_000, solved: 5 });
ok("a round finished in under three minutes is fast", f.fast_crossword === 1);
f = featsFor(m("crossword", 2), { placement: 1, status: "finished", elapsedMs: 200_000, solved: 5 });
ok("and one that took longer is not", !f.fast_crossword);
f = featsFor(m("crossword", 1), { placement: 1, status: "gave up", elapsedMs: 10_000 });
ok("giving up quickly is not fast", !f.fast_crossword && !f.solo_crossword);
f = featsFor({ game: "battleship", mapId: "hard", results: [{}, {}] }, { placement: 1, status: "won", hits: 17, sunk: 9 });
ok("hits are counted and a win on Open Ocean is deep", f.hits_battleship === 17 && f.deep_battleship === 1);
f = featsFor({ game: "battleship", mapId: "easy", results: [{}, {}] }, { placement: 1, status: "won", hits: 3, sunk: 5 });
ok("a win on Skirmish is not deep", !f.deep_battleship && f.hits_battleship === 3);
f = featsFor({ game: "battleship", mapId: "hard", results: [{}, {}] }, { placement: 2, status: "sunk", hits: 3, sunk: 1 });
ok("losing on Open Ocean is not deep either", !f.deep_battleship);
f = featsFor(m("minesweeper", 1), { placement: 1, status: "cleared", elapsedMs: 45_000 });
ok("a board cleared inside a minute is a lightning sweep", f.fast_minesweeper === 1 && f.cleared_minesweeper === 1);
f = featsFor(m("minesweeper", 1), { placement: 1, status: "sunk", elapsedMs: 5_000 });
ok("blowing up fast is not", !f.fast_minesweeper);
f = featsFor(m("links", 2), { placement: 2, status: "ended", holes: 9, aces: 1, toPar: 4 });
ok("holes and aces count even on a round walked off", f.holes_links === 9 && f.aces_links === 1);
f = featsFor(m("links", 2), { placement: 1, status: "finished", holes: 18, aces: 0, toPar: -1 });
ok("no ace, no ace counter", f.holes_links === 18 && !("aces_links" in f));
const tour = { feats: { played_crossword: 3, played_battleship: 1, played_minesweeper: 2, played_links: 1 } };
ok("the tourist needs every game", !bannerEarned("tourist", tour));
tour.feats.banks = 1;
ok("and has it once the last one is played", bannerEarned("tourist", tour));
ok("progress names what is still to play",
  bannerNeedText(BANNERS.find((b) => b.id === "tourist"), { feats: { played_links: 1 } }) === "1 / 5 games · still to play: Word-Cross, Battleship, Minesweeper, casino cash-outs");
ok("a jackpot is one big bank", bannerEarned("jackpot", { feats: { bigbank: 1 } }) && !bannerEarned("jackpot", { feats: { banked: 9000, banks: 30 } }));
ok("the gate takes a spread banner too", allowed({ banner: "tourist" }, { mmr: 0, feats: tour.feats }, gis).banner === "tourist");

console.log(bad ? `\n${bad} failing` : "\nall cosmetics checks passed");
process.exit(bad ? 1 : 0);
