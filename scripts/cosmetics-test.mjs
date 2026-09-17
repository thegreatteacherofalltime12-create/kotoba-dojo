// node scripts/cosmetics-test.mjs
//
// What a fighter can wear, and the rules for earning it. The same module
// runs in the browser and in the Worker, so this pins both the catalogue
// and the gate.
import {
  AVATARS, LEAGUES, FRAMES, FRAME_TIERS, TITLES, lifetime, meets, needText,
  knownAvatar, avatarHtml, framedHtml, frameEarned, titleEarned, allowed,
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

console.log(bad ? `\n${bad} failing` : "\nall cosmetics checks passed");
process.exit(bad ? 1 : 0);
