import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously, signOut, updateProfile,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, getDoc, doc, setDoc,
  query, where, orderBy, limit, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { buildLayout } from "./layout.js";
import { GI_COLORS, giSvg, GAME_MODES } from "./arena.js";
import { enterBattle, closeBattle, bindBattleControls } from "./battle.js";
import { enterMines, closeMines, bindMineControls } from "./mines.js";
import { THEMES, applyTheme, savedTheme, themeById, THEME_EPOCH, DEFAULT_THEME, isStale } from "./theme.js";
import { enterCasino, leaveCasino, bindCasino } from "./casino.js";
import { casinoRulesHtml } from "./game-modes.js";
import { UPDATES, PULSE_HOURS, KEEP_DAYS } from "./whats-new.js";

/**
 * True where typing summons an on-screen keyboard. Three tests rather than
 * one: a device only has to fail to claim a fine pointer, or hovering, or
 * touch support, and any of those alone is enough to go the careful route.
 */
const VIRTUAL_KEYBOARD =
  window.matchMedia("(pointer: coarse)").matches ||
  window.matchMedia("(hover: none)").matches ||
  (navigator.maxTouchPoints || 0) > 0;

const WORDS = 10;
// Belts run on lifetime MMR, not on a single round's score. A round pays
// 0-100 points; those bank into MMR, and MMR is what the arena ranks on.
const BELTS = [
  [2600, "Black",  "#111111"], [1525, "Brown",  "#a52a2a"],
  [1200, "Purple", "#b10dc9"], [875,  "Blue",   "#0074d9"],
  [600,  "Green",  "#2ecc40"], [400,  "Orange", "#ff851b"],
  [200,  "Yellow", "#ffdc00"], [1,    "White",  "#ffffff"],
  [0,    "Unranked", "#4c5468"],
];
const belt = (mmr) => BELTS.find(([m]) => (mmr ?? 0) >= m);
const initials = (n) => String(n).replace(/[^A-Za-z0-9. _]/g, "").split(/[._ ]+/)
  .filter(Boolean).map(p => p[0]).join("").slice(0, 2).toUpperCase();

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// The commonest reason this screen stays empty: the config was never filled
// in. Say so plainly rather than failing somewhere deep inside the SDK.
const unset = Object.entries(firebaseConfig)
  .filter(([, v]) => !v || String(v).includes("REPLACE_ME"))
  .map(([k]) => k);
if (unset.length) {
  window.__fault(
    "Firebase isn't configured yet",
    `public/firebase-config.js still has placeholder values for: ${unset.join(", ")}. Copy your web app config from the Firebase console (Project settings \u2192 Your apps \u2192 Web), paste it into that file, and deploy again.`
  );
  throw new Error("firebase-config.js still contains placeholders");
}

let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (err) {
  window.__fault("Firebase would not start", "The config in public/firebase-config.js was rejected.", err.message);
  throw err;
}

/**
 * If Firebase never reports a sign-in state, the page would otherwise sit on
 * the loading text for ever.
 *
 * It used to give up after eight seconds and blame the config, which is nearly
 * always wrong: a phone waking from sleep on a weak signal misses eight seconds
 * easily, and a config that has been working for months has not suddenly become
 * invalid. It now waits longer, doesn't count time spent in the background, and
 * says what is actually likely — with a way out rather than a dead end.
 */
let bootTimeout = null;
function armBootTimeout() {
  clearTimeout(bootTimeout);
  bootTimeout = setTimeout(() => {
    if (window.__faulted()) return;

    // Backgrounded is not stalled. A phone in a pocket gets more time.
    if (document.hidden) { armBootTimeout(); return; }

    if (!navigator.onLine) {
      window.__fault("No connection", "The arena will open as soon as you're back online.");
      window.addEventListener("online", () => location.reload(), { once: true });
      return;
    }

    window.__fault(
      "Signing in is taking too long",
      "The connection to Firebase hasn't answered. This is usually a poor signal \u2014 "
      + "it will retry on its own, or pull down to reload."
    );
    // One quiet retry: most of these come right on a second attempt.
    setTimeout(() => { if (!S.user) location.reload(); }, 12_000);
  }, 20_000);
}
armBootTimeout();

// Time spent asleep isn't time spent failing, so the clock restarts on waking.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !window.__faulted() && !S?.user) armBootTimeout();
});

const S = {
  user: null,
  socket: null,
  code: null,
  isSensei: false,
  lobby: null,
  puzzle: null,
  clock: 0,          // server time minus local time
  endsAt: 0,
  untimed: false,
  words: 10,
  ticker: null,
  cells: new Map(),  // "r,c" -> { input, entries: [] }
  entries: new Map(),
  solved: new Set(),
  cur: null,         // { entryId, idx }
  padEntry: null,    // entry open in the phone pad
  roundMs: 900_000,
  avatar: "white",
  // The banked wallet, plus a short history of what has gone into it.
  purse: { wallet: 100, tokens: 0, log: [] },
  bank: [],
  category: "",
  scrolls: [],
  forgeGrid: null,
};

// ───────────────────────────────────────────────────────────── screens

function show(name) {
  for (const s of ["gate", "home", "forge", "dojo", "battle", "mines", "casino"]) $(`screen-${s}`).hidden = s !== name;
  // The doorway belongs to the sign-in page; everything past it is the forest.
  document.body.classList.toggle("at-gate", name === "gate");
  if (typeof watchDojos === "function" && name !== "home") watchDojos(false);
  if (typeof watchRankings === "function") watchRankings(name === "home");
  window.scrollTo(0, 0);
}
function say(node, message, bad = true) {
  const n = $(node);
  n.hidden = !message;
  n.textContent = message || "";
  n.className = `notice ${bad ? "notice-bad" : "notice-good"}`;
}

// ───────────────────────────────────────────────────────────── auth

const GUEST_A = ["Quiet", "Steady", "Early", "Patient", "Restless", "Barefoot", "Northern"];
const GUEST_B = ["Pine", "Crane", "Stone", "River", "Lantern", "Bamboo", "Ember"];
const guestName = () =>
  `${GUEST_A[(Math.random() * GUEST_A.length) | 0]} ${GUEST_B[(Math.random() * GUEST_B.length) | 0]}`;

// Firebase Auth has no username/password mode — only email/password. A name
// maps to a fixed synthetic address, which makes Firebase itself enforce that
// names are unique: a taken name comes back as email-already-in-use, with no
// race and no separate registry to keep in sync.
//
// Pins are NOT unique, and must not be. A pin is a password: it belongs to one
// name. Refusing a duplicate would tell whoever typed it that somebody else
// uses that pin, and with only 100,000 possible pins accounts would collide
// almost at once. Six digits is a million, which is ten times better and
// still not a serious secret.
const NAME_DOMAIN = "kotoba-dojo.local";
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const PIN_RE = /^\d{6}$/;

const addressFor = (name) => `${name.toLowerCase()}@${NAME_DOMAIN}`;
// Firebase requires at least six characters. Six digits already clears that,
// but the suffix stays so accounts made under the old five-digit rule keep
// working — the derivation must never change once anyone has signed up.
const secretFor = (pin) => `${pin}#kd`;

let authMode = "signin";

function setMode(mode) {
  authMode = mode;
  $("tab-signin").classList.toggle("is-on", mode === "signin");
  $("tab-signup").classList.toggle("is-on", mode === "signup");
  $("btn-auth").textContent = mode === "signin" ? "Enter the dojo" : "Create and enter";
  $("auth-pin").autocomplete = mode === "signin" ? "current-password" : "new-password";
  $("gate-hint").textContent = mode === "signin"
    ? "Forgotten your pin? There's no way to recover it — make a new name."
    : "Names are yours alone. Pins are not — pick one you'll remember, and don't reuse a pin that guards anything important.";
  say("gate-error", "");
}

$("tab-signin").onclick = () => setMode("signin");
$("tab-signup").onclick = () => setMode("signup");

$("auth-pin").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
});
for (const id of ["auth-name", "auth-pin"]) {
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-auth").click(); });
}

function authError(code, message) {
  switch (code) {
    case "auth/email-already-in-use":
      return "That name is taken. Pick another.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      // Deliberately identical: saying which half was wrong would let someone
      // fish for names that exist.
      return "That name and pin don't match an account.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute and try again.";
    case "auth/operation-not-allowed":
      return "Email/password sign-in isn't enabled in the Firebase console yet.";
    case "auth/network-request-failed":
      return "Couldn't reach Firebase. Check your connection.";
    default:
      return message;
  }
}

$("btn-auth").onclick = async () => {
  const name = $("auth-name").value.trim();
  const pin = $("auth-pin").value.trim();

  if (!NAME_RE.test(name))
    return say("gate-error", "Names are 3 to 16 characters: letters, numbers or underscores.");
  if (!PIN_RE.test(pin))
    return say("gate-error", "The pin is exactly six digits.");

  $("btn-auth").disabled = true;
  say("gate-error", "");
  try {
    if (authMode === "signup") {
      const cred = await createUserWithEmailAndPassword(auth, addressFor(name), secretFor(pin));
      await updateProfile(cred.user, { displayName: name });
    } else {
      await signInWithEmailAndPassword(auth, addressFor(name), secretFor(pin));
    }
  } catch (e) {
    say("gate-error", authError(e.code, e.message));
  } finally {
    $("btn-auth").disabled = false;
  }
};

$("btn-guest").onclick = async () => {
  $("btn-guest").disabled = true;
  say("gate-error", "");
  try {
    const cred = await signInAnonymously(auth);
    await updateProfile(cred.user, { displayName: guestName() });
    render();
  } catch (e) {
    say("gate-error", e.code === "auth/operation-not-allowed"
      ? "Anonymous sign-in isn't enabled in the Firebase console yet."
      : authError(e.code, e.message));
  } finally {
    $("btn-guest").disabled = false;
  }
};

$("btn-signout").onclick = () => { closeSocket(); signOut(auth); };

onAuthStateChanged(auth, async (user) => {
  clearTimeout(bootTimeout);
  $("boot").hidden = true;
  S.user = user;
  if (!user) { show("gate"); return; }
  try {
    if (!user.displayName) await updateProfile(user, { displayName: guestName() });
    render();
    show("home");
    window.__ready = true;
    drawRuleBelts();
    loadAvatar();
    // Firestore is optional — the game runs on the built-in puzzles without
    // it. None of these may block the screen from drawing: if no database has
    // been provisioned, the SDK retries forever rather than failing.
    saveProfile();
    loadBank();
    loadScrolls();
  } catch (err) {
    window.__fault("Signed in, but the app couldn't start", "The browser console has the details.", err.message);
  }
});

function render() {
  $("home-name").textContent = S.user?.displayName || "Student";
}

async function loadAvatar() {
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "users", S.user.uid)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    const v = snap.data();
    if (v?.avatar) S.avatar = v.avatar;
    // The theme follows the player between the desktop and the phone.
    // A saved theme from before the current house look is moved on once. The
    // next choice a player makes sticks as normal.
    if (isStale(v?.themeEpoch)) {
      applyTheme(DEFAULT_THEME);
      saveProfile();
    } else if (v?.theme && themeById(v.theme).id === v.theme) {
      applyTheme(v.theme);
    }
    if (v?.casino) {
      // Older saves kept a single "cash" figure; treat it as banked. This is a
      // starting point only — the live figure is read from the server, because
      // banking happens there long after this ran.
      S.purse = { wallet: v.casino.wallet ?? v.casino.cash ?? 0, log: v.casino.log || [] };
    }
  } catch { /* first visit, or no database */ }
  drawMyRank();
}

async function saveProfile() {
  const u = auth.currentUser;
  if (!u) return;
  try {
    await setDoc(
      doc(db, "users", u.uid),
      {
        uid: u.uid, displayName: u.displayName || "Student", avatar: S.avatar,
        theme: document.documentElement.dataset.theme || savedTheme(),
        themeEpoch: THEME_EPOCH,
        lastSeen: serverTimestamp(),
      },
      { merge: true }
    );
  } catch { /* rules may forbid it; not fatal */ }
}

// ───────────────────────────────────────────────────────────── home

async function loadBank() {
  try {
    const res = await fetch("/api/puzzles");
    S.bank = (await res.json()).puzzles || [];
  } catch { S.bank = []; }
}

/** Themes in the archive, in the order they first appear. */
function categories() {
  const out = [];
  for (const p of S.bank) {
    if (!out.some((c) => c.id === p.theme)) out.push({ id: p.theme, name: p.themeName || p.theme });
  }
  return out;
}

async function loadScrolls() {
  const list = $("scroll-list");
  list.textContent = "";
  try {
    const res = await fetch("/api/scrolls");
    S.scrolls = (await res.json()).scrolls || [];
  } catch { S.scrolls = []; }

  if (!S.scrolls.length) {
    list.append(el("li", "", "No scrolls yet. Write one and everybody can play it."));
    return;
  }
  for (const s of S.scrolls) {
    const mine = s.uid === S.user?.uid;
    const li = el("li", mine ? "mine" : "");
    li.append(el("span", "name", s.title || "Untitled scroll"));
    li.append(el("span", "meta", mine ? "yours" : `by ${s.author}`));
    // The author's record. Nobody minds seeing it on someone else's scroll,
    // and on your own it's the whole point of publishing.
    li.append(el("span", "plays", s.plays
      ? `${s.plays} play${s.plays === 1 ? "" : "s"} \u00b7 ${s.wins} solved, ${s.losses} not`
      : "not played yet"));
    list.append(li);
  }
}

$("btn-open").onclick = async () => {
  const res = await fetch("/api/dojo/new");
  const { code } = await res.json();
  enterDojo(code);
};

let dojoPoll = null;

async function loadDojos() {
  const list = $("dojo-list");
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch("/api/dojos", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("could not load the board");
    const { dojos } = await res.json();

    list.textContent = "";
    if (!dojos.length) {
      list.append(el("li", "empty", "No dojos open right now. Open one and others can join you."));
      return;
    }
    for (const d of dojos) {
      const li = el("li");
      const main = el("div", "dojo-main-col");
      main.append(el("span", "name", `${d.sensei}'s dojo`));
      const label = (g) => GAME_MODES.find((m) => m.game === g)?.name || "Word Cross";
      const detail = d.phase === "ACTIVE"
        ? `Round ${d.roundNo} under way${d.puzzle ? ` — ${d.puzzle}` : ""}`
        : d.puzzle ? `Waiting to start — ${d.puzzle}` : "Getting set up";
      main.append(el("span", "meta", detail));
      li.append(main);
      li.append(el("span", "game-tag", label(d.game || "crossword")));
      li.append(el("span", "count", `${d.players} in`));
      if (d.phase === "ACTIVE") li.append(el("span", "tag-live", "live"));
      const join = el("button", "btn btn-tiny", "Enter");
      join.onclick = () => openRoom(d.game || "crossword", d.code);
      li.append(join);
      list.append(li);
    }
  } catch (e) {
    list.textContent = "";
    list.append(el("li", "empty", "Couldn't load the board. It'll retry shortly."));
  }
}

// Only poll while the board is actually on screen.
function watchDojos(on) {
  clearInterval(dojoPoll);
  dojoPoll = null;
  if (!on) return;
  loadDojos();
  dojoPoll = setInterval(loadDojos, 5000);
}

$("btn-refresh").onclick = loadDojos;

// ───────────────────────────────────────────────────────────── arena rankings

let standings = [];
let bounty = null;          // { holder, kills, defends, history }
let rankPoll = null;

/**
 * Lifetime standings, written by the Worker after each ranked round.
 *
 * Two reads, merged. Prestige outranks MMR — the point of the game is to rank
 * up, and prestiging costs 3,000 MMR, so a single read ordered by MMR would
 * drop a freshly promoted officer off the bottom of the list the moment they
 * were promoted. So the officers are read as a set of their own, everyone
 * else by MMR, and the order is settled here: rank first, MMR within a rank.
 * Neither read needs a composite index.
 */
async function loadRankings() {
  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
  const row = (d) => {
    const v = d.data();
    return {
      uid: v.uid || d.id,
      name: v.name || "Unknown",
      mmr: v.totalPoints || 0,
      best: v.bestScore || 0,
      rounds: v.roundsPlayed || 0,
      prestige: v.prestige || 0,
    };
  };
  try {
    const board = collection(db, "leaderboard");
    const [officers, byMmr] = await Promise.race([
      Promise.all([
        getDocs(query(board, where("prestige", ">", 0), orderBy("prestige", "desc"), limit(60))),
        getDocs(query(board, orderBy("totalPoints", "desc"), limit(24))),
      ]),
      timeout(6000),
    ]);
    const seen = new Map();
    for (const d of [...officers.docs, ...byMmr.docs]) { const r = row(d); seen.set(r.uid, r); }
    standings = [...seen.values()]
      .sort((a, b) => (b.prestige - a.prestige) || (b.mmr - a.mmr) || a.name.localeCompare(b.name))
      .slice(0, 24);
  } catch {
    standings = [];
  }
  // Draw first. The bounty is decoration on top of the standings, and this
  // used to wait on it before drawing anything — so one slow or hanging
  // request left the rankings blank with nothing to say why.
  drawStrip();
  drawLadder();
  drawMyRank();

  try {
    const res = await Promise.race([
      fetch("/api/bounty"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    bounty = await res.json();
    drawStrip();   // now with the target marked, if there is one
  } catch { /* the target simply won't show */ }
}

function myMmr() {
  return standings.find((r) => r.uid === S.user?.uid)?.mmr ?? 0;
}

const BLACK_BELT = 2600;
// Prestige is priced, not reached: a flat cost every time, and it takes only
// that much rather than everything. The server decides; this only draws it.
const PRESTIGE_COST = 3000;
const PRESTIGE_RANKS = [
  "Second Lieutenant", "First Lieutenant", "Captain", "Major", "Lieutenant Colonel",
  "Colonel", "Brigadier General", "Major General", "Lieutenant General", "General",
];

/**
 * The Space Force officer insignia, drawn rather than approximated.
 *
 * A gold bar, a silver bar, two silver bars; a gold oak leaf, a silver oak
 * leaf; the eagle; and one to four stars. Emoji stood in for these before,
 * and the stand-ins were wrong where it mattered — a maple leaf for the
 * Major, a sprig for the Lieutenant Colonel — and rendered differently on
 * every phone. These render the same everywhere and read at a glance, which
 * is what an insignia is for: it has to be obvious who outranks whom.
 */
const INSIG_INK = { gold: ["#E8C15A", "#7A5A12"], silver: ["#E6EAEE", "#4B5563"] };
function starPoints(cx, cy, R = 6.2, r = 2.6) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}
const OAK_LEAF = "M20 2.5 C17.5 4.5 15.5 6.5 13 6.8 C14.6 8.6 13.4 10.6 10.8 11.6 " +
  "C13.2 12.6 14.6 14.6 13 16.6 C15.4 16.4 17.4 18.2 20 21.5 C22.6 18.2 24.6 16.4 27 16.6 " +
  "C25.4 14.6 26.8 12.6 29.2 11.6 C26.6 10.6 25.4 8.6 27 6.8 C24.5 6.5 22.5 4.5 20 2.5 Z";
const EAGLE = "M20 4 L22.6 8.2 L36.5 6.2 L27.4 11.4 L33.5 13.6 L24.2 14.6 L22.2 21 " +
  "L20 17.4 L17.8 21 L15.8 14.6 L6.5 13.6 L12.6 11.4 L3.5 6.2 L17.4 8.2 Z";

function insigniaSvg(n, cls = "insig") {
  const rank = Math.min(Math.max(1, Number(n) || 1), PRESTIGE_RANKS.length);
  const name = PRESTIGE_RANKS[rank - 1];
  const [fill, stroke] = rank === 1 || rank === 4 ? INSIG_INK.gold : INSIG_INK.silver;
  let body = "", width = 40;
  if (rank <= 2) body = `<rect x="16" y="3" width="8" height="18" rx="1.6"/>`;
  else if (rank === 3) body = `<rect x="10" y="3" width="8" height="18" rx="1.6"/><rect x="22" y="3" width="8" height="18" rx="1.6"/>`;
  else if (rank <= 5) body = `<path d="${OAK_LEAF}"/><path d="M20 5 L20 20" fill="none" stroke-width="1.1"/>`;
  else if (rank === 6) body = `<path d="${EAGLE}"/>`;
  else {
    const k = rank - 6;
    width = k * 13 + 4;
    body = Array.from({ length: k }, (_, i) => `<polygon points="${starPoints(8.5 + i * 13, 12)}"/>`).join("");
  }
  return `<svg class="${cls}" viewBox="0 0 ${width} 24" role="img" aria-label="${name}"` +
    ` fill="${fill}" stroke="${stroke}" stroke-width=".9" stroke-linejoin="round"><title>${name}</title>${body}</svg>`;
}

/** Insignia beside a name. Empty for the unprestiged. */
const prestigePip = (n) => {
  if (!n) return "";
  const name = PRESTIGE_RANKS[Math.min(n, PRESTIGE_RANKS.length) - 1];
  const more = n > 1 ? ` \u00b7 ${n} prestiges` : "";
  return `<span class="pip" title="${name}${more}">${insigniaSvg(n)}</span>`;
};

/** Insignia and rank name together, as on a profile. */
const prestigeRank = (n) => {
  const rank = Math.min(Math.max(1, n), PRESTIGE_RANKS.length);
  return `<span class="rank-tag">${insigniaSvg(rank)}<span>${PRESTIGE_RANKS[rank - 1]}</span></span>`;
};
const prestigeName = (n) => PRESTIGE_RANKS[Math.min(Math.max(1, n), PRESTIGE_RANKS.length) - 1];

function drawMyRank() {
  const me = standings.find((r) => r.uid === S.user?.uid);
  const mmr = me?.mmr ?? 0;
  const p = me?.prestige || 0;
  const [, name, hex] = belt(mmr);

  $("pb-swatch").style.background = hex;
  $("pb-beltname").innerHTML = `${escapeHtml(name)}${prestigePip(p)}`;
  $("pb-mmr").innerHTML = `${mmr.toLocaleString()}${prestigePip(p)}`;

  // The insignia below already carries its own pips, so this counts prestiges
  // rather than repeating them.
  $("pb-star").textContent = p ? `${p}\u00d7` : "\u2014";
  $("pb-insignia").innerHTML = p ? prestigeRank(p) : "Not yet earned";

  $("pb-avatar").innerHTML = giSvg(S.avatar, 26);
  $("btn-prestige").hidden = mmr < PRESTIGE_COST;
}

$("btn-prestige").onclick = async () => {
  // Read from the standings, which is where the prestige count actually lives.
  const held = standings.find((r) => r.uid === S.user?.uid)?.prestige || 0;
  const next = prestigeName(held + 1);   // plain text: this goes into a confirm()
  if (!window.confirm(
    `Prestige costs ${PRESTIGE_COST.toLocaleString()} MMR and promotes you to ${next}. `
    + `Anything above the cost stays on your rating. This cannot be undone. Continue?`
  )) return;
  $("btn-prestige").disabled = true;
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch("/api/prestige", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    say("home-error", body.ok ? `Prestiged. ${prestigeName(held + 1)} unlocked.` : body.error, !body.ok);
    await loadRankings();
  } catch (e) {
    say("home-error", "Couldn't reach the arena. Try again.");
  } finally {
    $("btn-prestige").disabled = false;
  }
};

function drawLadder() {
  const mine = belt(myMmr())[1];
  $("ladder").innerHTML = [...BELTS].filter(([m]) => m >= 1).reverse()
    .map(([at, name, hex]) => `
      <div class="rung ${name === mine ? "you" : ""}">
        <div class="swatch" style="background:${hex}"></div>
        <div class="nm">${name}</div>
        <div class="at">${at.toLocaleString()}+</div>
      </div>`).join("");
}

/** Asks the server whether ranked scoring actually works, and says so. */
async function runDiagnostic() {
  const out = $("diag-out");
  out.hidden = false;
  out.textContent = "Checking…";
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch("/api/diag/ranked", { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    out.textContent = "";
    for (const step of body.steps || []) {
      const line = el("div", step.ok ? "diag-ok" : "diag-bad");
      line.textContent = `${step.ok ? "\u2713" : "\u2717"} ${step.step}${step.detail ? ` — ${step.detail}` : ""}`;
      out.append(line);
    }
    out.append(el("div", body.ok ? "diag-ok" : "diag-bad", body.summary || ""));
    if (body.ok) loadRankings();
  } catch (e) {
    out.textContent = `Couldn't run the check: ${e.message}`;
  }
}

// ── the rankings fold ─────────────────────────────────────────────────
//
// Three on the podium by default; the bar is the handle. Which way it was
// left is kept in this browser, so someone who wants the full list open
// does not have to open it every visit.
const RANK_FOLD_KEY = "omni.rankings.open";
function foldRankings(open) {
  const sec = document.querySelector(".rankings");
  if (!sec) return;
  sec.classList.toggle("open", open);
  const head = sec.querySelector(".rankings-head");
  if (head) head.setAttribute("aria-expanded", String(open));
  const hint = $("rank-fold-hint");
  if (hint) hint.textContent = open ? "Top 3 \u25B4" : `Full list \u00b7 ${standings.length} \u25BE`;
  try { localStorage.setItem(RANK_FOLD_KEY, open ? "1" : "0"); } catch { /* fine */ }
}
function bindRankingsFold() {
  const head = document.querySelector(".rankings-head");
  if (!head || head.dataset.bound) return;
  head.dataset.bound = "1";
  head.setAttribute("role", "button");
  head.setAttribute("tabindex", "0");
  const toggle = () => foldRankings(!document.querySelector(".rankings")?.classList.contains("open"));
  head.onclick = toggle;
  head.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
  let open = false;
  try { open = localStorage.getItem(RANK_FOLD_KEY) === "1"; } catch { /* fine */ }
  foldRankings(open);
}

function drawStrip() {
  // The empty state used to live on the podium, which no longer exists.
  if (!standings.length) {
    $("strip").innerHTML = `<div class="empty">
      No ranked rounds yet. Standings fill in once matches are recorded.
      <button id="btn-diag" class="btn btn-tiny">Why is this empty?</button>
      <p id="diag-out" class="panel-sub" hidden></p>
    </div>`;
    $("btn-diag").onclick = runDiagnostic;
    return;
  }

  // Champion, second and third are marked in the list rather than shown again
  // above it. The order already says who is winning: officers first, by rank,
  // then everyone else by MMR — and the insignia says so at a glance.
  const MEDALS = ["\u{1F3C6}", "\u{1F948}", "\u{1F949}"];

  $("strip").innerHTML = standings.map((r, i) => {
    const [, , hex] = belt(r.mmr);
    const wanted = bounty?.holder?.uid === r.uid;
    const tag = r.prestige
      ? `<span class="rank-tag">${insigniaSvg(r.prestige)}<span>${prestigeName(r.prestige)}</span></span>`
      : "";
    return `
      <div class="slot ${i === 0 ? "lead" : ""} ${r.uid === S.user?.uid ? "you2" : ""} ${wanted ? "wanted-slot" : ""} ${r.prestige ? "officer" : ""}">
        <span class="sr">${MEDALS[i] ? `<span class="medal" title="${["Champion", "Second", "Third"][i]}">${MEDALS[i]}</span>` : ordinal(i + 1)}</span>
        ${wanted ? `<span class="sb-target">\u{1F3AF}</span>` : ""}
        <span class="sb" style="background:${hex}"></span>
        <span class="sn">${escapeHtml(r.name)}${tag}</span>
        <span class="sp">${r.mmr.toLocaleString()}</span>
      </div>`;
  }).join("");
  bindRankingsFold();
  foldRankings(document.querySelector(".rankings")?.classList.contains("open") || false);
}

function drawRuleBelts(tab = "arena") {
  const belts = [...BELTS].filter(([m]) => m >= 1).reverse()
    .map(([at, name, hex]) => `
      <div class="belt-row">
        <span class="sw" style="background:${hex}"></span>
        <span class="bn">${name}</span>
        <span class="bt">${at.toLocaleString()}+</span>
      </div>`).join("");

  const shell = (inner) => `
    <div class="drawer-in">
      <div class="drawer-head"><h2>\u{1F4D6} The Rule Book</h2></div>
      <div class="subtabs">
        <button class="stab ${tab === "arena" ? "is-on" : ""}" data-rule="arena">Arena</button>
        <button class="stab ${tab === "modes" ? "is-on" : ""}" data-rule="modes">Game Modes</button>
        <button class="stab ${tab === "match" ? "is-on" : ""}" data-rule="match">Match Rules</button>
        <button class="stab ${tab === "bounty" ? "is-on" : ""}" data-rule="bounty">Bounty \u{1F3AF}</button>
        <button class="stab ${tab === "belts" ? "is-on" : ""}" data-rule="belts">Belts</button>
        <button class="stab" data-points>Points</button>
      </div>
      ${inner}
    </div>`;

  if (tab === "modes") {
    $("drawer-rules").innerHTML = shell(`<div class="rules-cols">${casinoRulesHtml()}</div>`);
    bindRuleTabs();
    return;
  }

  if (tab === "match" || tab === "bounty" || tab === "belts") {
    $("drawer-rules").innerHTML = shell(tab === "match" ? matchRules() : tab === "bounty" ? bountyRules() : beltsRuleHtml());
    bindRuleTabs();
    return;
  }

  $("drawer-rules").innerHTML = shell(`
      <div class="rules-cols">

        <div class="rule-sec">
          <h3>Belts</h3>
          <p class="lede2">Shared across every game. Black at 2,600.</p>
          <div class="belt-rows">${belts}</div>
        </div>

        <div class="rule-sec">
          <h3>MMR</h3>
          <ul>
            <li>Your match score is your <b>base gain</b>.</li>
            <li><b>Challenge bonus</b> 0&ndash;15, by how far the field sits above you.</li>
            <li><b>Completion</b> +15 for finishing the session.</li>
            <li><b>Rumble</b> (3 or more players): +15, plus up to +10 for beating your seed.</li>
            <li>MMR never falls. The worst round pays 0.</li>
            <li><b>Prestige</b> costs ${PRESTIGE_COST.toLocaleString()} MMR and promotes you one Space Force officer rank, from Second Lieutenant up to General. The cost comes off your rating rather than clearing it, and it never changes however many you have.</li>
          </ul>
        </div>

        <div class="rule-sec">
          <h3>The maths arcade</h3>
          <p class="lede2">In the Casino, under Earn Money Here. The quickest MMR in the arena.</p>
          <div class="belt-rows">
            <div class="belt-row"><span class="bn">Under 10 seconds</span><span class="bt">50 MMR</span></div>
            <div class="belt-row"><span class="bn">15 seconds</span><span class="bt">25 MMR</span></div>
            <div class="belt-row"><span class="bn">20 seconds</span><span class="bt">17 MMR</span></div>
            <div class="belt-row"><span class="bn">25 seconds</span><span class="bt">8 MMR</span></div>
            <div class="belt-row"><span class="bn">30 seconds or more</span><span class="bt">0 MMR</span></div>
          </div>
          <ul style="margin-top:.6rem">
            <li><b>50 MMR</b> is the most a single puzzle can pay.</li>
            <li>The award falls evenly across <b>thirty seconds</b> from the moment the puzzle appears.</li>
            <li>Solving inside <b>ten seconds</b> multiplies it by <b>1.5</b>, which reaches the cap.</li>
            <li>A wrong answer ends that puzzle. Take another.</li>
            <li>Ten seconds pass before the next is offered.</li>
            <li>The arena sets the puzzle, keeps the answer and times the solve on its own clock, so the award is the same wherever you play.</li>
          </ul>
        </div>

        <div class="rule-sec">
          <h3>The casino</h3>
          <p class="lede2">Cash and tokens are their own economy. No casino game pays MMR &mdash; only the arcade does.</p>
          <ul>
            <li>You start with <b>$100</b> and no tokens.</li>
            <li>Every solved puzzle pays <b>$5&ndash;15</b> to the table and a token.</li>
            <li>Cash is won at the table and banks to your wallet only when a match is ended properly. Quitting loses it.</li>
            <li><b>Table Card Games</b> opens at <b>$50 and 2 tokens</b>.</li>
            <li><b>Blackjack:</b> lose and it costs your bet and one token. Win or push and your tokens are safe.</li>
            <li><b>Horse Race:</b> free to enter, cash wagers, 1:1 up to 24:1.</li>
          </ul>
        </div>

        <div class="rule-sec">
          <h3>Sensei points</h3>
          <div class="tiers">
            <div class="tier"><span class="dot2" style="background:#a8703c"></span><span class="tn">Bronze</span><span class="tp">2</span></div>
            <div class="tier"><span class="dot2" style="background:#b9bcc2"></span><span class="tn">Silver</span><span class="tp">3</span></div>
            <div class="tier"><span class="dot2" style="background:#e0b32a"></span><span class="tn">Gold</span><span class="tp">4</span></div>
            <div class="tier"><span class="dot2" style="background:#7fd4e8"></span><span class="tn">Diamond</span><span class="tp">5</span></div>
            <div class="tier"><span class="dot2" style="background:#dfe6ea"></span><span class="tn">Platinum</span><span class="tp">6</span></div>
          </div>
          <ul style="margin-top:.5rem">
            <li>Achievements stack and pay in full each time.</li>
            <li>Wins pay 1 point, a Rumble win pays 2.</li>
            <li>Spend 5 points to spin for a Sensei Token.</li>
          </ul>
        </div>

      </div>`);

  bindRuleTabs();
}

function bindRuleTabs() {
  const host = $("drawer-rules");
  host.querySelectorAll("[data-rule]").forEach((b) => {
    b.onclick = () => drawRuleBelts(b.dataset.rule);
  });
  // Points opens over the page rather than replacing what you were reading.
  host.querySelectorAll("[data-points]").forEach((b) => { b.onclick = openPoints; });
}

/**
 * How a score is arrived at, per game, and what happens to it afterwards.
 * An overlay because it is a thing you check mid-thought and then dismiss,
 * not a page you sit and read.
 */
export function openPoints() {
  const host = $("points-modal");
  host.hidden = false;

  const table = (rows) => `<div class="belt-rows">${rows.map(([a, b]) => `
    <div class="belt-row"><span class="bn">${a}</span><span class="bt">${b}</span></div>`).join("")}</div>`;

  host.innerHTML = `
    <div class="modal-back" data-close></div>
    <div class="modal-card points-card">
      <div class="modal-head">
        <h2>How points work</h2>
        <button class="modal-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <p class="panel-sub">Every game scores out of 100 in its own way. That score is the base of your MMR for the round.</p>

        <div class="ruleboxes">
          <section class="rulebox">
            <h3 class="rulebox-h">Word Cross</h3>
            ${table([
              ["Solve inside 45 seconds", "100"],
              ["Slower, down to the buzzer", "99 to 1"],
              ["Unfinished at the buzzer", "0"],
            ])}
          </section>

          <section class="rulebox">
            <h3 class="rulebox-h">Minesweeper</h3>
            ${table([
              ["Clear the field", "55 to 100 by speed"],
              ["Hit a mine part way", "up to 55, by how much you cleared"],
              ["Harder boards", "pay more"],
            ])}
          </section>

          <section class="rulebox">
            <h3 class="rulebox-h">Battleship Royale</h3>
            ${table([
              ["Every hit", "4"],
              ["Every ship sunk", "12"],
              ["Finishing position", "up to 30"],
              ["Still afloat at the end", "+20"],
            ])}
          </section>

          <section class="rulebox">
            <h3 class="rulebox-h">Maths arcade</h3>
            ${table([
              ["Solve inside 10 seconds", "50"],
              ["15 seconds", "25"],
              ["20 seconds", "17"],
              ["30 seconds or more", "0"],
            ])}
          </section>

          <section class="rulebox">
            <h3 class="rulebox-h">Score becomes MMR</h3>
            <ul class="rulebox-l">
              <li>Your score is the <b>base gain</b>.</li>
              <li><b>Challenge bonus</b> 0&ndash;15, by how far the field sits above you.</li>
              <li><b>Completion</b> +15 for finishing the session.</li>
              <li><b>Rumble</b> (3 or more): +15, plus up to +10 for beating your seed.</li>
              <li><b>Bounty</b> +50 for a claim, +25 for a defence.</li>
              <li>MMR never falls. The worst round pays 0.</li>
            </ul>
          </section>

          <section class="rulebox">
            <h3 class="rulebox-h">The casino</h3>
            <ul class="rulebox-l">
              <li>Cash and tokens are a separate economy and pay no MMR.</li>
              <li>Only the maths arcade pays MMR inside the casino.</li>
              <li>Money is won at the table and banks to your wallet when a match ends properly.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>`;

  host.querySelectorAll("[data-close]").forEach((n) => { n.onclick = closePoints; });
}

export function closePoints() {
  const host = $("points-modal");
  host.hidden = true;
  host.textContent = "";
}

/**
 * The bounty. Same boxes, same styling as Match Rules — this is a long set of
 * rules and the containers are what stop it becoming a wall.
 */
function bountyRules() {
  return `
    <div class="ruleboxes">
      ${ruleBox("\u{1F3AF} Rumble Bounty \u2014 Overview", {
        body: "When a Rumble or Pump Up The Volume match ends, the winner has a Bounty placed on their head. They become a target for the rest of the dojo. The next person who beats them in an eligible match claims the bounty rewards.",
      })}

      ${ruleBox("How to Claim the Bounty", { bullets: [
        "The bounty score is tracked as average points per hour &mdash; fair across all durations.",
        "<b>Bounty not in your match:</b> score higher per-hour than the bounty's per-hour average in any mode.",
        "<b>Bounty is in your match:</b> special rule &mdash; finish 1st place and they don't, you take it (per-hour doesn't matter here).",
        "Works in 1v1, Rumble and PUTV &mdash; any duration.",
      ] })}

      ${ruleBox("\u23F1 Eligible Matches", { bullets: [
        "1v1, Rumble and PUTV &mdash; any duration.",
        "Solo matches do <b>not</b> claim or transfer the bounty.",
        "If no one claims the bounty within 48 hours, it auto-rotates to a random Top 10 player.",
        "Score-to-beat for an auto-rotated bounty is based on that player's last completed game (per-hour average).",
      ] })}

      ${ruleBox("\u{1F3C6} Rewards for Claiming", { bullets: [
        "<b>+50 bonus MMR</b> on top of your normal match MMR.",
        "\u{1F3AF} Bounty Hunter achievement (+4 Sensei Points).",
        "&lsquo;BOUNTY HUNTER \u{1F3AF}&rsquo; title (auto-equipped).",
        "\u{1F3AF} Bounty Hunter avatar (auto-equipped).",
        "\u{1F3AF} Bounty Hunter legendary frame with red glow, gold shadow and firework click effect (auto-equipped).",
        "You instantly become the new bounty target.",
      ] })}

      ${ruleBox("\u{1F4B0} Bounty Kill Achievements", {
        bullets: [
          "\u{1F4B0} <b>Bounty Kill I</b> &mdash; take down the bounty 1 time (silver).",
          "\u{1F4B0} <b>Bounty Kill II</b> &mdash; take down the bounty 2 times (gold).",
          "\u{1F4B0} <b>Bounty Kill III</b> &mdash; take down the bounty 3 times (diamond).",
          "\u{1F4B0} <b>Bounty Kill IV</b> &mdash; take down the bounty 4 or more times (platinum).",
        ],
        note: "Each unlocks a matching equippable title.",
      })}

      ${ruleBox("\u{1F6E1}\uFE0F Defending the Bounty", { bullets: [
        "If you're the bounty and you win an eligible match (2hr 1v1 or 2hr Rumble), you keep the bounty and earn <b>+25 bonus MMR</b>.",
        "Defending unlocks the \u{1F6E1}\uFE0F Bounty Defender gold achievement and matching title.",
        "In a Rumble, defending also raises your score-on-record, so future hunters must beat the new higher number.",
      ] })}

      ${ruleBox("\u{1F441} Spotting the Bounty", { bullets: [
        "Look at the home page Arena Rankings &mdash; the bounty target has a pulsing gold ring around their avatar.",
        "A red \u{1F3AF} badge sits on the top-right corner of their avatar.",
        "A &lsquo;\u2605 WANTED \u2605&rsquo; label glows below their avatar.",
        "A flashing &lsquo;\u{1F3AF} RUMBLE BOUNTY&rsquo; tag also appears in their info row.",
      ] })}

      ${ruleBox("\u{1F3AC} Bounty Transfer Animation", {
        body: "When the bounty transfers, all players see a graphic on the post-match screen showing who lost the bounty and who claimed it. The new bounty target is locked in immediately.",
      })}

      ${ruleBox("\u{1F5E1}\uFE0F Bounty Slayer Achievements", {
        body: "Track your total bounty kills to unlock escalating rewards:",
        bullets: [
          "\u{1F5E1}\uFE0F <b>Bounty Slayer</b> &mdash; 5 total kills (diamond) &mdash; unlocks title and the Bounty Slayer legendary frame.",
          "\u2694\uFE0F <b>Bounty Executioner</b> &mdash; 10 total kills (platinum) &mdash; unlocks title, avatar and the Bounty Executioner frame.",
          "\u{1F479} <b>Bounty Warlord</b> &mdash; 15 total kills (legendary) &mdash; unlocks title, avatar, the Warlord diamond frame and a loot drop.",
        ],
        note: "Each milestone stacks. A Bounty Warlord has earned all three titles, frames and avatars.",
      })}
    </div>`;
}

/**
 * Match Rules. Each section is its own bordered box rather than a run of
 * headings — these are the rules people argue about after a match, and they
 * need to be findable at a glance, not read in order.
 */
function ruleBox(title, { body, bullets, note } = {}) {
  return `
    <section class="rulebox">
      <h3 class="rulebox-h">${title}</h3>
      ${body ? `<p class="rulebox-b">${body}</p>` : ""}
      ${bullets ? `<ul class="rulebox-l">${bullets.map((b) => `<li>${b}</li>`).join("")}</ul>` : ""}
      ${note ? `<p class="rulebox-n">${note}</p>` : ""}
    </section>`;
}

function matchRules() {
  const box = (title, bullets) => ruleBox(title, { bullets });

  return `
    <div class="ruleboxes">
      ${box("Match Duration", [
        "The match creator can end the match early at any time.",
        "Other players can vote to end early &mdash; if all non-creator players agree, the match ends.",
      ])}
      ${box("Match Completion Bonus", [
        "The match completion bonus is only awarded if you finish the match in full.",
        "Leaving early &mdash; whether you quit, disconnect, or walk away before the final whistle &mdash; forfeits your completion bonus.",
        "Your logged metrics still count, but no bonus MMR for an incomplete session.",
      ])}
      ${box("Verification", [
        "When a match ends, MMR updates immediately &mdash; no confirmation step needed.",
        "All matches are recorded with full stats, date, and time. Disputes? Check the match history.",
      ])}
      ${box("\u{1F3C5} Sensei Points &amp; Tokens", [
        "Earn Sensei Points by unlocking achievements. Each tier grants: Bronze = 2 &middot; Silver = 3 &middot; Gold = 4 &middot; Diamond = 5 &middot; Platinum = 6.",
        "Achievements can be earned multiple times &mdash; every earn awards points.",
        "Spend 5 Sensei Points in the Sensei Tokens to spin the wheel and win a Sensei Token.",
        "Apply a Sensei Token before any match &mdash; it grants bonus MMR at the end without affecting the in-game score.",
        "Zeroes achievements grant 2 random tokens (good consolation for tough games).",
        "Win achievements award points: 1v1 = +1, Rumble = +2.",
        "If you finish a game with zero achievements, you get one free random token as a consolation.",
      ])}
    </div>`;
}


// Header tabs open one drawer at a time; clicking an open one closes it.
const DRAWERS = [
  ["tab-create", "drawer-create"],
  ["tab-profile", "drawer-profile"],
  ["tab-records", "drawer-records"],
  ["tab-news", "drawer-news"],
  ["tab-rules", "drawer-rules"],
  ["tab-scrolls", "drawer-scrolls"],
  ["tab-invite", "drawer-invite"],
];

/**
 * A drawer is a view, not an overlay, so the rankings and the commons stand
 * down while one is open. Opening Open Rooms should show open rooms and
 * nothing else.
 *
 * Modals are exempt: they cover the page on their own and the column behind
 * them is meant to stay put.
 */
function drawer(which) {
  const opening = $(which).hidden;
  let openPanel = null;
  for (const [tab, panel] of DRAWERS) {
    const showing = panel === which && opening;
    $(panel).hidden = !showing;
    $(tab).setAttribute("aria-expanded", String(showing));
    $(tab).classList.toggle("is-on", showing);
    if (showing) openPanel = panel;
  }

  // These float over the page now rather than pushing it about, so the
  // standings and the chat stay where they were while you read something.
  const overlay = openPanel && $(openPanel).classList.contains("as-modal");
  $("panel-x").hidden = !overlay;
  document.body.classList.toggle("panel-open", !!overlay);
  return opening;
}

/** Closes whichever overlay panel is open. */
function closeOpenPanel() {
  for (const [tab, panel] of DRAWERS) {
    if (!$(panel).hidden) return closePanel(panel, tab);
  }
}

$("panel-x").onclick = closeOpenPanel;
for (const id of ["drawer-records", "drawer-rules", "drawer-scrolls", "drawer-news"]) {
  // Only a click on the backdrop itself, never one that bubbled up from the
  // card, or reading the rules would keep shutting the rules.
  $(id).addEventListener("click", (e) => { if (e.target === $(id)) closeOpenPanel(); });
}

$("tab-rules").onclick = () => drawer("drawer-rules");
$("tab-records").onclick = () => { if (drawer("drawer-records")) loadRecords(); };
if ($("tab-news")) {
  $("tab-news").onclick = () => { if (drawer("drawer-news")) drawNews(); };
} else {
  console.warn("[news] no #tab-news on the page \u2014 is index.html cached?");
}
$("tab-scrolls").onclick = () => { if (drawer("drawer-scrolls")) loadScrolls(); };
$("tab-create").onclick = () => { if (drawer("drawer-create")) drawCreate(); };
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("points-modal").hidden) return closePoints();
  for (const [tab, panel] of DRAWERS) if (!$(panel).hidden) closePanel(panel, tab);
});
$("tab-profile").onclick = () => { if (drawer("drawer-profile")) drawProfile("avatar"); };
$("tab-invite").onclick = () => { if (drawer("drawer-invite")) drawInvite(); };

// ── create match ──────────────────────────────────────────────────
// Modes come from the registry in arena.js, so a new game shows up here the
// moment it is added there — nothing in this function needs to change.
function closePanel(panel, tab) {
  $(panel).hidden = true;
  $(tab).setAttribute("aria-expanded", "false");
  $(tab).classList.remove("is-on");
  $("panel-x").hidden = true;
  document.body.classList.remove("panel-open");
}
const closeCreate = () => closePanel("drawer-create", "tab-create");

function drawCreate() {
  $("drawer-create").innerHTML = `
    <div class="modal-back" data-close></div>
    <div class="modal-card">
      <div class="modal-head">
        <h2>Create a match</h2>
        <button class="modal-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
      <p class="panel-sub">Pick what you want to run. Solo training opens a private dojo just for you.</p>
      <div class="modecards">
        ${GAME_MODES.map((m) => `
          <div class="modecard ${m.available ? "" : "soon"}">
            <div class="mc-top">
              <span class="mc-name">${m.name}</span>
              <span class="mc-players">${m.players}</span>
            </div>
            <p class="mc-blurb">${m.blurb}</p>
            ${m.available
              ? `<button class="btn btn-primary btn-small" data-mode="${m.id}" data-kind="${m.kind}" data-game="${m.game || "crossword"}">Start</button>`
              : `<span class="mc-soon">Coming soon</span>`}
          </div>`).join("")}
      </div>
      </div>
    </div>`;

  $("drawer-create").querySelectorAll("[data-close]").forEach((el) => { el.onclick = closeCreate; });

  $("drawer-create").querySelectorAll("button[data-mode]").forEach((b) => {
    b.onclick = async () => {
      closeCreate();
      const res = await fetch("/api/dojo/new");
      const { code } = await res.json();
      openRoom(b.dataset.game || "crossword", code, true);
    };
  });
}

// ── belts ─────────────────────────────────────────────────────────
/** The belt ladder, with yours marked. A tab of the rule book now. */
function beltsRuleHtml() {
  const mine = belt(myMmr())[1];
  return `
    <div class="rules-in">
      <p class="panel-sub">Shared across every mode. You're on <b>${mine}</b>.</p>
      <div class="belt-rows">
        ${[...BELTS].filter(([m]) => m >= 1).reverse().map(([at, name, hex]) => `
          <div class="belt-row ${name === mine ? "is-mine" : ""}">
            <span class="sw" style="background:${hex}"></span>
            <span class="bn">${name}</span>
            <span class="bt">${at.toLocaleString()}+</span>
          </div>`).join("")}
      </div>
    </div>`;
}

// ── invite ────────────────────────────────────────────────────────
function drawInvite() {
  const link = location.origin;
  const host = $("drawer-invite");
  host.innerHTML = `
    <div class="modal-back" data-close></div>
    <div class="modal-card red">
      <div class="modal-head">
        <h2>Invite to the Dojo</h2>
        <button class="modal-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body invite">
        <div class="qr" id="qr"></div>
        <p class="panel-sub">Point a phone camera at the code, or send the link.</p>
        <div class="joinrow">
          <input id="invite-link" readonly value="${link}">
          <button id="invite-copy" class="btn">Copy</button>
        </div>
        <button id="invite-share" class="btn btn-primary" hidden>Share&hellip;</button>
        <p id="invite-status" class="notice" hidden></p>
      </div>
    </div>`;

  host.querySelectorAll("[data-close]").forEach((el) => {
    el.onclick = () => closePanel("drawer-invite", "tab-invite");
  });

  // The QR library is a convenience, not a dependency: if it fails to load,
  // the link and copy button still do the job.
  if (window.QRCode) {
    try {
      new window.QRCode($("qr"), {
        text: link, width: 190, height: 190,
        colorDark: "#0a0a0a", colorLight: "#ece2cf",
        correctLevel: window.QRCode.CorrectLevel.M,
      });
    } catch { $("qr").innerHTML = `<p class="panel-sub">Couldn't draw the code. Use the link below.</p>`; }
  } else {
    $("qr").innerHTML = `<p class="panel-sub">Couldn't load the code generator. Use the link below.</p>`;
  }

  $("invite-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      say("invite-status", "Link copied.", false);
    } catch {
      $("invite-link").select();
      say("invite-status", "Press Ctrl+C to copy.", false);
    }
  };

  if (navigator.share) {
    $("invite-share").hidden = false;
    $("invite-share").onclick = () =>
      navigator.share({ title: "Omni Multiverse of Madness", text: "Come and play.", url: link }).catch(() => {});
  }
}

// ── records ───────────────────────────────────────────────────────
// Everything here is read from what the server already wrote: the leaderboard
// the Worker maintains, and the clear times the Minesweeper object banks in
// KV. Nothing is self-reported, so a record means what it says.
async function loadRecords(tab = "arena") {
  const host = $("drawer-records");
  if (tab === "wallet") return drawWallet(host);
  if (tab === "bounty") return drawBountyRecords(host);
  host.innerHTML = `<div class="drawer-in"><div class="drawer-head"><h2>Records</h2></div><p class="panel-sub">Reading the books&hellip;</p></div>`;

  if (!standings.length) await loadRankings();
  let mines = {};
  try {
    const res = await fetch("/api/mines/scores");
    mines = (await res.json()).scores || {};
  } catch { mines = {}; }

  const best = (key) => [...standings].sort((a, z) => (z[key] || 0) - (a[key] || 0))[0];
  const holders = [
    ["Highest single round", best("best"), (r) => `${r.best} points`],
    ["Most MMR banked", best("mmr"), (r) => `${r.mmr.toLocaleString()} MMR`],
    ["Most rounds played", best("rounds"), (r) => `${r.rounds} rounds`],
    ["Most prestiges", best("prestige"), (r) => (r.prestige ? `${r.prestige}\u00d7` : "none yet")],
  ].filter(([, r]) => r);

  const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const levels = [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["expert", "Expert"]];

  host.innerHTML = `
    <div class="drawer-in">
      <div class="drawer-head"><h2>Records</h2></div>
      <div class="subtabs">
        <button class="stab is-on" data-rec="arena">Records</button>
        <button class="stab" data-rec="wallet">\u{1F4B0} Wallets</button>
        <button class="stab" data-rec="bounty">\u{1F3AF} Bounty</button>
      </div>
      ${bounty?.holder ? `
        <div class="bounty-card claimed" style="margin-bottom:.9rem">
          <p class="bc-k">\u{1F3AF} The bounty</p>
          <p class="bc-line"><b>${escapeHtml(bounty.holder.name)}</b> wears the target</p>
          <p class="bc-sub">Mark to beat: ${bounty.holder.perHour}/hr &middot; ${bounty.holder.defends || 0} defence${(bounty.holder.defends || 0) === 1 ? "" : "s"}${bounty.holder.rotated ? " &middot; auto-rotated" : ""}</p>
        </div>` : ""}
      <p class="panel-sub">Held across the whole arena. Set by the games themselves, not self-reported.</p>

      <div class="rules-cols">
        <div class="rule-sec">
          <h3>Arena</h3>
          ${holders.length ? `<div class="belt-rows">${holders.map(([label, r, fmt]) => `
            <div class="belt-row ${r.uid === S.user?.uid ? "is-mine" : ""}">
              <span class="bn">${label}</span>
              <span class="rec-who">${escapeHtml(r.name)}</span>
              <span class="bt">${fmt(r)}</span>
            </div>`).join("")}</div>`
            : `<p class="panel-sub">No ranked rounds recorded yet.</p>`}
        </div>

        <div class="rule-sec">
          <h3>Minesweeper, fastest clears</h3>
          ${levels.map(([id, name]) => {
            const rows = (mines[id] || []).slice(0, 3);
            return `
              <p class="rec-sub">${name}</p>
              ${rows.length ? `<div class="belt-rows">${rows.map((r, i) => `
                <div class="belt-row ${r.uid === S.user?.uid ? "is-mine" : ""}">
                  <span class="rec-rank">${i + 1}</span>
                  <span class="bn">${escapeHtml(r.name)}</span>
                  <span class="bt">${secs(r.ms)}</span>
                </div>`).join("")}</div>`
                : `<p class="panel-sub">Nobody has cleared it yet.</p>`}`;
          }).join("")}
        </div>

        <div class="rule-sec">
          <h3>Still to be set</h3>
          <p class="lede2">These arrive as the games record them.</p>
          <ul>
            <li>Fastest ten-word grid, per archive and difficulty.</li>
            <li>Longest run of clears without a loss.</li>
            <li>Most ships sunk in a single Battleship Royale.</li>
            <li>Best maths arcade streak inside ten seconds.</li>
          </ul>
        </div>
      </div>
    </div>`;

  host.querySelectorAll("[data-rec]").forEach((b) => { b.onclick = () => loadRecords(b.dataset.rec); });
}

/** The banked side of the casino, and what has gone into it. */
/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 22nd, 23rd. */
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

let walletPoll = null;

/** The two figures the wallet panel shows: yours, and the top ten. */
async function readWallets() {
  let mine = null, top = null;
  try {
    const res = await fetch("/api/wallet", { headers: { Authorization: `Bearer ${await idToken()}` } });
    mine = (await res.json()).wallet || 0;
  } catch { /* keep what we had */ }
  try {
    const res = await fetch("/api/wallets/top");
    top = (await res.json()).wallets || [];
  } catch { /* keep what we had */ }
  return { mine, top };
}

function walletBoard(top) {
  if (!top.length) return `<p class="panel-sub">Nobody has banked anything yet. Be first.</p>`;
  // Largest first, ten of them. The server already sends them that way;
  // sorting again here costs nothing and makes the order a promise of the
  // board rather than of the query.
  const ranked = [...top].sort((a, b) => (b.wallet || 0) - (a.wallet || 0)).slice(0, 10);
  return `
    <div class="belt-rows">${ranked.map((r, i) => `
      <div class="belt-row${r.uid === S.user?.uid ? " mine" : ""}">
        <span class="bn"><b class="wal-place">${ordinal(i + 1)}</b> ${escapeHtml(r.name)}</span>
        <span class="bt">$${r.wallet.toLocaleString()}</span>
      </div>`).join("")}</div>`;
}

/**
 * The bounty ledger: kills, defences, and the titles they earn. Lives in
 * Records beside the wallet board; it is a record of play, not a setting.
 */
function bountyPanelHtml() {
  const me = bounty || {};
  const kills = me.kills?.[S.user?.uid] || 0;
  const defends = me.defends?.[S.user?.uid] || 0;
  const holding = me.holder?.uid === S.user?.uid;
  const KILL = [[1, "Bounty Kill I", "silver"], [2, "Bounty Kill II", "gold"],
                [3, "Bounty Kill III", "diamond"], [4, "Bounty Kill IV", "platinum"]];
  const SLAY = [[5, "Bounty Slayer", "diamond"], [10, "Bounty Executioner", "platinum"],
                [15, "Bounty Warlord", "legendary"]];
  return `
    ${holding ? `<div class="bounty-card claimed"><p class="bc-k">\u{1F3AF} You are the bounty</p>
      <p class="bc-sub">The mark to beat is ${me.holder.perHour}/hr. Win an eligible match to defend it for +25.</p></div>` : ""}
    <div class="wal-figures">
      <div><span class="wal-l">Bounty kills</span><b class="wal-n">${kills}</b></div>
      <div><span class="wal-l">Defences</span><b class="wal-n">${defends}</b></div>
      <div><span class="wal-l">Holding</span><b class="wal-n">${holding ? "Yes" : "No"}</b></div>
    </div>
    <p class="rec-sub">Kill achievements</p>
    <div class="belt-rows">
      ${KILL.map(([at, name, tier]) => `
        <div class="belt-row ${kills >= at ? "is-mine" : "dim"}">
          <span class="bn">\u{1F4B0} ${name}</span>
          <span class="rec-who">${tier}</span>
          <span class="bt">${kills >= at ? "earned" : `${at} kill${at === 1 ? "" : "s"}`}</span>
        </div>`).join("")}
    </div>
    <p class="rec-sub">Slayer milestones</p>
    <div class="belt-rows">
      ${SLAY.map(([at, name, tier]) => `
        <div class="belt-row ${kills >= at ? "is-mine" : "dim"}">
          <span class="bn">${name}</span>
          <span class="rec-who">${tier}</span>
          <span class="bt">${kills >= at ? "earned" : `${at} kills`}</span>
        </div>`).join("")}
    </div>
    <p class="panel-sub" style="margin-top:.7rem">Milestones stack. A Warlord holds every title, frame and avatar below it.</p>`;
}

function drawBountyRecords(host) {
  clearInterval(walletPoll);
  host.innerHTML = `
    <div class="drawer-in">
      <div class="drawer-head"><h2>Records</h2></div>
      <div class="subtabs">
        <button class="stab" data-rec="arena">Records</button>
        <button class="stab" data-rec="wallet">\u{1F4B0} Wallets</button>
        <button class="stab is-on" data-rec="bounty">\u{1F3AF} Bounty</button>
      </div>
      ${bountyPanelHtml()}
    </div>`;
  host.querySelectorAll("[data-rec]").forEach((b) => { b.onclick = () => loadRecords(b.dataset.rec); });
}


async function drawWallet(host) {
  host.innerHTML = `<div class="drawer-in"><div class="drawer-head"><h2>Records</h2></div><p class="panel-sub">Counting the takings&hellip;</p></div>`;

  // Banking happens on the server, so the figure comes from the server. The
  // copy read at sign-in is always behind by however long you have been playing.
  const first = await readWallets();
  const mine = first.mine ?? (S.purse?.wallet || 0);
  const top = first.top ?? [];
  S.purse = { ...(S.purse || {}), wallet: mine };

  host.innerHTML = `
    <div class="drawer-in">
      <div class="drawer-head"><h2>Records</h2></div>
      <div class="subtabs">
        <button class="stab" data-rec="arena">Records</button>
        <button class="stab is-on" data-rec="wallet">\u{1F4B0} Wallets</button>
        <button class="stab" data-rec="bounty">\u{1F3AF} Bounty</button>
      </div>

      <div class="wal-figures">
        <div><span class="wal-l">Your wallet</span><b class="wal-n" id="wal-mine">$${mine.toLocaleString()}</b></div>
      </div>

      <p class="panel-sub">Money banks here when a casino session is ended properly with
      <b>Officially end match</b>. Quitting or closing the browser mid-game leaves it on the table.
      Your wallet is yours alone \u2014 only the totals below are shared.</p>

      <p class="rec-sub">Biggest wallets on the floor</p>
      <div id="wal-board">${walletBoard(top)}</div>
    </div>`;
  host.querySelectorAll("[data-rec]").forEach((b) => { b.onclick = () => loadRecords(b.dataset.rec); });

  // Live while it is open. Someone banking on the floor should show up here
  // without the drawer being closed and opened again; the rows are replaced
  // in place so nothing jumps. The poll stops itself once the panel is gone.
  clearInterval(walletPoll);
  walletPoll = setInterval(async () => {
    const board = document.getElementById("wal-board");
    if (!board || !board.isConnected || $("drawer-records")?.hidden) { clearInterval(walletPoll); return; }
    const now = await readWallets();
    if (now.top) board.innerHTML = walletBoard(now.top);
    if (now.mine != null) {
      const me = document.getElementById("wal-mine");
      if (me) me.textContent = `$${now.mine.toLocaleString()}`;
      S.purse = { ...(S.purse || {}), wallet: now.mine };
    }
  }, 15_000);
}

// ── what's new ─────────────────────────────────
//
// One tab that pulses when something has shipped in the last twelve hours and
// the player hasn't looked. Reading it stops the pulse for good, until the next
// thing ships. Which notes have been read is kept in this browser rather than
// on the account: it costs nothing, and the worst it can do is show the pulse
// once more on a second device.

const NEWS_KEY = "omni.news.seen";

function seenNews() {
  try { return new Set(JSON.parse(localStorage.getItem(NEWS_KEY) || "[]")); }
  catch { return new Set(); }
}

function markNewsSeen(ids) {
  try {
    const all = [...seenNews(), ...ids];
    localStorage.setItem(NEWS_KEY, JSON.stringify(all.slice(-200)));
  } catch { /* private browsing; the pulse will simply return */ }
}

const newsId = (u) => `${u.at}|${u.title}`;

/** Notes still worth showing, newest first. */
function currentNews() {
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  return [...UPDATES]
    .filter((u) => new Date(u.at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

/** Anything shipped in the pulse window that this browser hasn't read. */
function unreadNews() {
  const fresh = Date.now() - PULSE_HOURS * 3600_000;
  const seen = seenNews();
  return currentNews().filter((u) => new Date(u.at).getTime() >= fresh && !seen.has(newsId(u)));
}

function refreshNewsPulse() {
  const tab = $("tab-news");
  if (!tab) return;
  const n = unreadNews().length;
  tab.classList.toggle("pulse", n > 0);
  tab.textContent = n > 0 ? `What's New (${n})` : "What's New";
}

function drawNews() {
  const host = $("drawer-news");
  if (!host) return;
  try {
    drawNewsInner(host);
  } catch (err) {
    console.error("[news]", err);
    host.innerHTML = `<div class="drawer-in"><div class="drawer-head"><h2>What's New</h2></div>
      <p class="panel-sub">These notes couldn't be shown. The browser console has the reason.</p></div>`;
  }
}

function drawNewsInner(host) {
  const rows = currentNews();
  const seen = seenNews();
  const fresh = Date.now() - PULSE_HOURS * 3600_000;

  host.innerHTML = `
    <div class="drawer-in">
      <div class="drawer-head"><h2>What's New</h2></div>
      ${rows.length ? `<div class="news-list">${rows.map((u) => {
        const isNew = new Date(u.at).getTime() >= fresh && !seen.has(newsId(u));
        return `
          <div class="news-row${isNew ? " fresh" : ""}">
            <div class="news-top">
              ${u.where ? `<span class="news-where">${escapeHtml(u.where)}</span>` : ""}
              <b>${escapeHtml(u.title)}</b>
              ${isNew ? `<span class="news-tag">new</span>` : ""}
              <span class="news-when">${ago(u.at)}</span>
            </div>
            <p class="news-text">${escapeHtml(u.text)}</p>
          </div>`;
      }).join("")}</div>`
        : `<p class="panel-sub">Nothing new in the last ${KEEP_DAYS} days.</p>`}
    </div>`;

  // Opening it is reading it.
  markNewsSeen(rows.map(newsId));
  refreshNewsPulse();
}

// ── the commons ───────────────────────────────────────────────────
// A feed of everything the arena has done in the last day, and a room for
// everyone to talk in. Both are read from the Worker rather than straight from
// the database, so a browser can neither post as somebody else nor be turned
// away by security rules.

// Chat is what people come back to, so it opens on chat and the feed waits
// behind it.
let commonsTab = "chat";
let commonsPoll = null;

const KIND_PIP = { game: "\u{1F3C6}", prestige: "\u2B50", award: "\u{1F396}\uFE0F", note: "\u{1F4E3}" };

function ago(iso) {
  if (!iso) return "";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

async function loadFeed() {
  const host = $("commons-feed");
  if (!host) return;
  let rows = [];
  try {
    const res = await fetch("/api/feed");
    rows = (await res.json()).feed || [];
  } catch { rows = null; }

  if (rows === null) {
    host.innerHTML = `<p class="panel-sub">The feed couldn't be read just now.</p>`;
    return;
  }
  if (!rows.length) {
    host.innerHTML = `<p class="panel-sub">Nothing in the last 24 hours. Play something.</p>`;
    return;
  }
  host.innerHTML = rows.map((r) => `
    <div class="feed-row ${escapeHtml(r.kind)}">
      <span class="fr-pip">${KIND_PIP[r.kind] || KIND_PIP.note}</span>
      <div class="fr-body">
        <p class="fr-t">${escapeHtml(r.text)}</p>
        ${r.detail ? `<p class="fr-d">${escapeHtml(r.detail)}</p>` : ""}
      </div>
      <span class="fr-when">${ago(r.at)}</span>
    </div>`).join("");
}

const CHAT_SEEN_KEY = "omni.chat.seen";
let chatSeen = 0;
try { chatSeen = Number(localStorage.getItem(CHAT_SEEN_KEY) || 0); } catch { /* fine */ }

/** Is the chat actually in front of the player right now? */
function chatInView() {
  return !document.hidden && commonsOpen() && commonsTab === "chat";
}

/** Everything up to now counts as read. */
function markChatRead(rows) {
  const newest = Math.max(chatSeen, ...rows.map((r) => new Date(r.at).getTime() || 0));
  chatSeen = newest;
  try { localStorage.setItem(CHAT_SEEN_KEY, String(newest)); } catch { /* fine */ }
  $("ct-chat")?.classList.remove("unread");
}

async function loadChat() {
  const host = $("commons-chat");
  if (!host) return;
  let rows = [];
  try {
    const res = await fetch("/api/chat");
    rows = (await res.json()).chat || [];
  } catch { rows = []; }

  // Somebody else has spoken since you last looked: say so on the tab, and
  // keep saying so until the chat is open in front of you. Your own lines
  // never count — you have read what you wrote.
  const others = rows.filter((r) => r.uid !== S.user?.uid);
  const newest = Math.max(0, ...others.map((r) => new Date(r.at).getTime() || 0));
  if (chatInView()) markChatRead(rows);
  else if (newest > chatSeen) $("ct-chat")?.classList.add("unread");

  // Nothing to draw into while the panel is closed or on another tab.
  if (!commonsOpen() || commonsTab !== "chat") return;

  const stuck = host.scrollTop + host.clientHeight >= host.scrollHeight - 30;
  host.innerHTML = rows.length ? rows.map((r) => `
    <div class="chat-row${r.uid === S.user?.uid ? " mine" : ""}">
      <span class="cr-who">${escapeHtml(r.name)}</span>
      <span class="cr-txt">${escapeHtml(r.text)}</span>
      <span class="cr-when">${ago(r.at)}</span>
    </div>`).join("")
    : `<p class="panel-sub">Nobody has said anything yet. Go on.</p>`;
  // Only follow the bottom if they were already there; yanking someone away
  // from what they were reading is worse than a missed line.
  if (stuck) host.scrollTop = host.scrollHeight;
}

// Closed until asked for. The tabs are the handle: tapping one opens the
// panel on it, tapping the open tab again closes it. Which way it was left,
// and on which tab, is kept in this browser.
const COMMONS_KEY = "omni.commons.open";
function commonsOpen() { return !!document.querySelector(".commons")?.classList.contains("open"); }
function foldCommons(open) {
  const sec = document.querySelector(".commons");
  if (!sec) return;
  sec.classList.toggle("open", open);
  if (!open) { for (const id of ["ct-feed", "ct-chat", "ct-rooms"]) $(id).classList.remove("on"); }
  // The rooms board polls only while it is the tab showing.
  watchDojos(open && commonsTab === "rooms");
  try { localStorage.setItem(COMMONS_KEY, open ? `1:${commonsTab}` : "0"); } catch { /* fine */ }
}
function tapCommons(which) {
  if (commonsOpen() && commonsTab === which) { foldCommons(false); return; }
  showCommons(which);
}

function showCommons(which) {
  commonsTab = which;
  $("ct-feed").classList.toggle("on", which === "feed");
  $("ct-chat").classList.toggle("on", which === "chat");
  $("ct-rooms").classList.toggle("on", which === "rooms");
  $("commons-feed").hidden = which !== "feed";
  $("commons-chat").hidden = which !== "chat";
  $("commons-rooms").hidden = which !== "rooms";
  $("chat-composer").hidden = which !== "chat";
  foldCommons(true);
  if (which === "feed") loadFeed(); else if (which === "chat") loadChat();
  if (which === "chat") $("ct-chat").classList.remove("unread");
}

async function sendChat() {
  const field = $("chat-say");
  const text = field.value.trim();
  if (!text) return;
  field.value = "";
  try {
    await fetch("/api/chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch { /* it will be missing from the next poll, which is answer enough */ }
  loadChat();
}

function startCommons() {
  $("ct-feed").onclick = () => tapCommons("feed");
  $("ct-chat").onclick = () => tapCommons("chat");
  $("ct-rooms").onclick = () => tapCommons("rooms");
  $("chat-send").onclick = sendChat;
  $("chat-say").onkeydown = (e) => { if (e.key === "Enter") sendChat(); };

  // Closed unless it was left open, in which case it comes back on the same tab.
  let saved = "0";
  try { saved = localStorage.getItem(COMMONS_KEY) || "0"; } catch { /* fine */ }
  if (saved.startsWith("1:")) showCommons(["feed", "rooms"].includes(saved.slice(2)) ? saved.slice(2) : "chat");
  else foldCommons(false);

  // Nothing is fetched while the panel is closed; there is nothing to show it in.
  clearInterval(commonsPoll);
  commonsPoll = setInterval(() => {
    loadChat();                                       // always: it owns the unread mark
    if (commonsOpen() && commonsTab === "feed") loadFeed();
  }, 15_000);
  loadChat();
  // Coming back to the tab after a while, the first thing you see should be
  // current rather than whatever the last poll caught before you left.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    loadChat();
    if (commonsOpen() && commonsTab === "feed") loadFeed();
  });
}

// ── profile ───────────────────────────────────────────────────────
/** Everything about the player lives here: rank, prestige, name, invite, exit. */
function profileSummary() {
  const me = standings.find((r) => r.uid === S.user?.uid);
  const mmr = me?.mmr ?? 0;
  const [, name, hex] = belt(mmr);
  const p = me?.prestige || 0;
  return `
    <div class="pf-summary">
      <span class="pf-face">${giSvg(S.avatar, 54)}</span>
      <div class="pf-id">
        <div class="pf-name">${escapeHtml(S.user?.displayName || "Student")}</div>
        <div class="pf-beltline"><span class="belt" style="background:${hex}"></span>${name} belt</div>
      </div>
      <div class="pf-nums">
        <span class="pb-label">MMR</span>
        <div class="pb-amount">${mmr.toLocaleString()}</div>
        <span class="pb-label">Prestige</span>
        <div class="pf-star">${p ? "\u2605".repeat(Math.min(p, 5)) : "\u2014"}</div>
      </div>
    </div>
    <div class="pf-actions">
      <button id="pf-invite" class="btn pf-red">Invite to the Dojo</button>
      ${mmr >= PRESTIGE_COST ? `<button id="pf-prestige" class="btn btn-primary">Prestige \u00b7 ${PRESTIGE_COST.toLocaleString()} MMR</button>` : ""}
      <button id="pf-signout" class="btn btn-quiet">Sign out</button>
    </div>`;
}

function drawProfile(tab) {
  const host = $("drawer-profile");
  host.innerHTML = `
    <div class="modal-back" data-close></div>
    <div class="modal-card red">
      <div class="modal-head">
        <h2>Profile</h2>
        <button class="modal-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        ${profileSummary()}
        <div class="subtabs">
          <button class="stab ${tab === "avatar" ? "is-on" : ""}" data-tab="avatar">Avatar</button>
          <button class="stab ${tab === "info" ? "is-on" : ""}" data-tab="info">Info</button>
        <button class="stab ${tab === "theme" ? "is-on" : ""}" data-tab="theme">Theme</button>
        <button class="stab ${tab === "billing" ? "is-on" : ""}" data-tab="billing">Billing</button>
        </div>
        <div id="profile-body"></div>
      </div>
    </div>`;

  host.querySelectorAll("[data-close]").forEach((el) => {
    el.onclick = () => closePanel("drawer-profile", "tab-profile");
  });
  host.querySelectorAll(".stab").forEach((b) => { b.onclick = () => drawProfile(b.dataset.tab); });

  $("pf-invite").onclick = () => {
    closePanel("drawer-profile", "tab-profile");
    if (drawer("drawer-invite")) drawInvite();
  };
  $("pf-signout").onclick = () => { closeSocket(); signOut(auth); };
  if ($("pf-prestige")) $("pf-prestige").onclick = () => $("btn-prestige").click();

  const body = $("profile-body");

  if (tab === "avatar") {
    body.innerHTML = `
      <p class="panel-sub">Pick your gi.</p>
      <div class="gis">
        ${GI_COLORS.map((g) => `
          <button class="gi ${g.id === S.avatar ? "is-on" : ""}" data-gi="${g.id}" title="${g.name}">
            ${giSvg(g.id, 52)}<span>${g.name}</span>
          </button>`).join("")}
      </div>`;
    body.querySelectorAll("button[data-gi]").forEach((b) => {
      b.onclick = async () => {
        S.avatar = b.dataset.gi;
        drawProfile("avatar");
        drawMyRank();
        saveProfile();
      };
    });
    return;
  }


  if (tab === "theme") {
    const now = document.documentElement.dataset.theme || savedTheme();
    body.innerHTML = `
      <p class="panel-sub">The layout never changes &mdash; only the ink. Boards stay white in every theme, so a grid is always readable.</p>
      <div class="themes">
        ${THEMES.map((t) => `
          <button class="theme-pick ${t.id === now ? "on" : ""}" data-theme="${t.id}">
            <span class="theme-chips">
              <i style="background:${t.paper}"></i><i style="background:${t.ink}"></i>
              <i style="background:${t.a1}"></i><i style="background:${t.a2}"></i>
            </span>
            <span>
              <span class="theme-name">${t.name}</span>
              <span class="theme-state">${t.id === now ? "In use" : "Select"}</span>
            </span>
          </button>`).join("")}
      </div>`;
    body.querySelectorAll("[data-theme]").forEach((b) => {
      b.onclick = () => {
        applyTheme(b.dataset.theme);
        saveProfile();
        drawProfile("theme");
      };
    });
    return;
  }

  if (tab === "billing") {
    body.innerHTML = `
      <p class="panel-sub">Nothing is stored yet. When bonus multipliers go live, a card saved here will pay for them.</p>
      <div class="pf-card-empty">
        <div class="pf-card-icon">&#9679;&#9679;&#9679;&#9679;</div>
        <div>
          <div class="pf-card-title">No card on file</div>
          <div class="pf-card-sub">Card details will be held by the payment provider, never by this game.</div>
        </div>
      </div>
      <button class="btn" disabled>Add a card</button>
      <p class="panel-sub" style="margin-top:.6rem">Payments aren't connected yet, so this is switched off.</p>`;
    return;
  }

  body.innerHTML = `
    <p class="panel-sub">Your sign-in name never changes &mdash; it's how the arena knows you. This is the name others see.</p>
    <label class="field"><span>Display name</span>
      <input id="pf-name" maxlength="24" value="${escapeHtml(S.user?.displayName || "")}"></label>
    <button id="pf-save-name" class="btn btn-small">Save name</button>
    <hr class="rule-line">
    <label class="field"><span>Current pin</span>
      <input id="pf-old" class="pin-input" inputmode="numeric" maxlength="6" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"></label>
    <label class="field"><span>New pin</span>
      <input id="pf-new" class="pin-input" inputmode="numeric" maxlength="6" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"></label>
    <button id="pf-save-pin" class="btn btn-small">Change pin</button>
    <p id="pf-status" class="notice" hidden></p>`;

  for (const id of ["pf-old", "pf-new"]) {
    $(id).addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
  }

  $("pf-save-name").onclick = async () => {
    const next = $("pf-name").value.trim();
    if (next.length < 2) return say("pf-status", "That name is too short.");
    await updateProfile(auth.currentUser, { displayName: next.slice(0, 24) });
    saveProfile();
    render();
    say("pf-status", "Name saved.", false);
  };

  $("pf-save-pin").onclick = async () => {
    const oldPin = $("pf-old").value, newPin = $("pf-new").value;
    if (!/^\d{6}$/.test(oldPin) || !/^\d{6}$/.test(newPin))
      return say("pf-status", "Both pins are six digits.");
    if (auth.currentUser.isAnonymous)
      return say("pf-status", "Guests have no pin to change.");
    try {
      // Firebase requires a fresh sign-in before a credential change.
      const cred = EmailAuthProvider.credential(auth.currentUser.email, secretFor(oldPin));
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, secretFor(newPin));
      $("pf-old").value = ""; $("pf-new").value = "";
      say("pf-status", "Pin changed.", false);
    } catch (e) {
      say("pf-status", e.code === "auth/invalid-credential" || e.code === "auth/wrong-password"
        ? "That current pin is wrong."
        : authError(e.code, e.message));
    }
  };
}

// Standings refresh on a fixed two-minute cycle rather than on every change,
// so the board stays still long enough to read.
function watchRankings(on) {
  clearInterval(rankPoll);
  rankPoll = null;
  if (!on) return;
  // Every thirty seconds, quietly. A visible countdown told people to wait
  // for something that takes no waiting.
  loadRankings();
  rankPoll = setInterval(loadRankings, 30_000);
  startCommons();
  refreshNewsPulse();
}

/**
 * Room type to the function that opens it. This is the only place the
 * mapping exists — a new game adds one line here and one entry in
 * GAME_MODES, and code entry, the rooms board and Create Match all follow.
 */
const ROOMS = {
  crossword: (code) => enterDojo(code),
  battleship: (code, back) => { show("battle"); enterBattle(code, idToken, back); },
  minesweeper: (code, back) => { show("mines"); enterMines(code, idToken, back); },
  // Multiverse Golf runs on its own page: a full-screen course doesn't fit
  // inside a panel, and the round is long enough to want the whole window.
  // A room being created lands on the lobby with its code, to choose a course
  // before anything is dealt; an invitation to a room already open walks in.
  links: (code, _back, fresh) => { location.href = `/links.html#${fresh ? "new:" : ""}${code || ""}`; },
  // Solo against the house: no room to join, so the code is ignored.
  casino: (_code, back) => {
    show("casino");
    enterCasino(null, null, () => { leaveCasino(); back(); }, idToken);
  },
};

const idToken = () => auth.currentUser.getIdToken();

/** Opens whichever game a code belongs to. */
async function joinByCode(code) {
  let game = "crossword";
  try {
    const res = await fetch(`/api/room/${encodeURIComponent(code)}`);
    const body = await res.json();
    if (body.game) game = body.game;
    else return say("rooms-error", "No room with that code. Check it and try again.");
  } catch {
    return say("rooms-error", "Couldn't reach the arena. Try again.");
  }
  openRoom(game, code);
}

function openRoom(game, code, fresh = false) {
  const open = ROOMS[game];
  if (!open) {
    // Better to say so than to guess and open the wrong game, which is
    // exactly what a silent fallback to the crossword used to do.
    return say("rooms-error", `That room is a game this version doesn't know (${game}). Update the app.`);
  }
  open(code, () => { show("home"); loadDojos(); }, fresh);
}

$("btn-join").onclick = () => {
  const code = $("join-code").value.trim().toUpperCase();
  if (code.length < 3) return say("rooms-error", "That code is too short.");
  say("rooms-error", "");
  joinByCode(code);
};
$("join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btn-join").click(); });

// ───────────────────────────────────────────────────────────── scroll writer

$("btn-forge").onclick = () => { buildForgeRows(); show("forge"); };
$("btn-forge-back").onclick = () => show("home");
$("btn-forge-clear").onclick = () => { buildForgeRows(); refreshForge(); };

function buildForgeRows() {
  const wrap = $("forge-rows");
  wrap.textContent = "";
  for (let i = 0; i < WORDS; i++) {
    const row = el("div", "forge-row");
    row.append(el("span", "n", String(i + 1)));
    const w = el("input", "word");
    w.maxLength = 12;
    w.placeholder = "WORD";
    w.setAttribute("aria-label", `Word ${i + 1}`);
    const c = el("input", "clue");
    c.maxLength = 140;
    c.placeholder = "Clue";
    c.setAttribute("aria-label", `Clue ${i + 1}`);
    row.append(w, c);
    wrap.append(row);
  }
  $("forge-title").value = "";
  wrap.addEventListener("input", debounce(refreshForge, 350));
}

function forgeWords() {
  return [...$("forge-rows").children].map((row) => ({
    answer: row.querySelector(".word").value.toUpperCase().replace(/[^A-Z]/g, ""),
    clue: row.querySelector(".clue").value.trim(),
  }));
}

function refreshForge() {
  const words = forgeWords();
  [...$("forge-rows").children].forEach((r) => r.classList.remove("bad"));

  const filled = words.filter((w) => w.answer.length >= 3);
  if (filled.length < WORDS) {
    $("forge-canvas").textContent = "";
    $("forge-canvas").append(
      el("p", "empty", `${WORDS - filled.length} more word${WORDS - filled.length === 1 ? "" : "s"} to go.`)
    );
    say("forge-status", "");
    $("btn-forge-save").disabled = true;
    S.forgeGrid = null;
    return;
  }

  const missingClue = words.findIndex((w) => !w.clue);
  if (missingClue !== -1) {
    say("forge-status", `Word ${missingClue + 1} still needs a clue.`);
    $("btn-forge-save").disabled = true;
    return;
  }

  const res = buildLayout(words, 400);
  if (!res.ok) {
    const idx = words.findIndex((w) => w.answer === res.stuck);
    if (idx !== -1) $("forge-rows").children[idx].classList.add("bad");
    say("forge-status", `"${res.stuck}" shares no usable letters with the others. Swap it for something that does.`);
    $("forge-canvas").textContent = "";
    $("btn-forge-save").disabled = true;
    S.forgeGrid = null;
    return;
  }

  S.forgeGrid = res.grid;
  say("forge-status", "The grid holds. Save it, then pick it when you open a dojo.", false);
  $("btn-forge-save").disabled = false;
  drawStatic($("forge-canvas"), res.grid);
}

$("btn-forge-save").onclick = async () => {
  if (!S.forgeGrid) return;
  const title = $("forge-title").value.trim() || "Untitled scroll";
  $("btn-forge-save").disabled = true;
  say("forge-status", "Publishing\u2026", false);
  try {
    // Published rather than filed away: the grid goes to the library so
    // anyone can open a dojo on it, and the server checks it on the way in.
    const res = await fetch("/api/scrolls", {
      method: "POST",
      headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        puzzle: { title, rows: S.forgeGrid.rows, cols: S.forgeGrid.cols, entries: S.forgeGrid.entries },
      }),
    });
    const body = await res.json();
    if (!res.ok) { say("forge-status", body.error || "That couldn't be published."); $("btn-forge-save").disabled = false; return; }
    await loadScrolls();
    show("home");
  } catch (e) {
    say("forge-status", `Couldn't publish: ${e.message}`);
    $("btn-forge-save").disabled = false;
  }
};

// ───────────────────────────────────────────────────────────── grid drawing

function gridCells(puzzle) {
  const map = new Map();
  for (const e of puzzle.entries) {
    for (let i = 0; i < e.len; i++) {
      const r = e.row + (e.dir === "down" ? i : 0);
      const c = e.col + (e.dir === "across" ? i : 0);
      const k = `${r},${c}`;
      const cell = map.get(k) || { r, c, entries: [], num: null };
      cell.entries.push({ id: e.id, index: i });
      if (i === 0) cell.num = e.num;
      map.set(k, cell);
    }
  }
  return map;
}

function frame(host, puzzle) {
  host.textContent = "";
  const grid = el("div", "xgrid");
  // Fit the grid to whatever space there is: on a phone that means the full
  // width minus padding, on a desktop it stops growing at 46px a cell.
  const avail = Math.min(host.clientWidth || 560, window.innerWidth - 24);
  const byWidth = Math.floor((avail - (puzzle.cols - 1) * 2) / puzzle.cols);
  const size = Math.max(20, Math.min(46, byWidth));
  grid.style.setProperty("--cell", `${size}px`);
  grid.style.gridTemplateColumns = `repeat(${puzzle.cols}, ${size}px)`;
  host.append(grid);
  return grid;
}

/** Read-only grid: the forge preview and the answer reveal. */
function drawStatic(host, puzzle) {
  const map = gridCells(puzzle);
  const grid = frame(host, puzzle);
  const letters = new Map();
  for (const e of puzzle.entries) {
    if (!e.answer) continue;
    for (let i = 0; i < e.answer.length; i++) {
      const r = e.row + (e.dir === "down" ? i : 0);
      const c = e.col + (e.dir === "across" ? i : 0);
      letters.set(`${r},${c}`, e.answer[i]);
    }
  }
  for (let r = 0; r < puzzle.rows; r++) {
    for (let c = 0; c < puzzle.cols; c++) {
      const cell = map.get(`${r},${c}`);
      const box = el("div", cell ? "xcell" : "xcell void");
      if (cell) {
        const input = el("input");
        input.value = letters.get(`${r},${c}`) || "";
        input.readOnly = true;
        input.tabIndex = -1;
        box.append(input);
        if (cell.num) box.append(el("span", "num", String(cell.num)));
      }
      grid.append(box);
    }
  }
}

/** The playable grid. */
function drawPlayable(puzzle) {
  S.cells = gridCells(puzzle);
  S.entries = new Map(puzzle.entries.map((e) => [e.id, e]));
  const grid = frame($("grid-wrap"), puzzle);

  for (let r = 0; r < puzzle.rows; r++) {
    for (let c = 0; c < puzzle.cols; c++) {
      const key = `${r},${c}`;
      const cell = S.cells.get(key);
      const box = el("div", cell ? "xcell" : "xcell void");
      if (cell) {
        const input = el("input");
        input.maxLength = 1;
        input.autocapitalize = "characters";
        input.autocomplete = "off";
        input.inputMode = "text";
        input.dataset.key = key;
        input.setAttribute("aria-label", `Row ${r + 1} column ${c + 1}`);
        input.addEventListener("focus", () => selectFrom(key));
        input.addEventListener("click", () => {
          if (!isNarrow()) return;
          const ids = cell.entries.map((x) => x.id);
          const pick = ids.find((id) => !S.solved.has(id)) || ids[0];
          if (openEntryPad(pick)) input.blur();
        });
        input.addEventListener("beforeinput", onBeforeInput);
        input.addEventListener("keydown", onKeyDown);
        box.append(input);
        if (cell.num) box.append(el("span", "num", String(cell.num)));
        cell.input = input;
        cell.box = box;
      }
      grid.append(box);
    }
  }
  drawClues(puzzle);
}

function drawClues(puzzle) {
  for (const dir of ["across", "down"]) {
    const ol = $(`clues-${dir}`);
    ol.textContent = "";
    for (const e of puzzle.entries.filter((x) => x.dir === dir)) {
      const li = el("li");
      li.dataset.entry = e.id;
      li.append(el("span", "cn", String(e.num)));
      li.append(el("span", "ct", e.clue));
      li.onclick = () => { if (!openEntryPad(e.id)) focusEntry(e.id, 0); };
      ol.append(li);
    }
  }
}

function entryCells(entryId) {
  const e = S.entries.get(entryId);
  const out = [];
  for (let i = 0; i < e.len; i++) {
    const r = e.row + (e.dir === "down" ? i : 0);
    const c = e.col + (e.dir === "across" ? i : 0);
    out.push(S.cells.get(`${r},${c}`));
  }
  return out;
}

function selectFrom(key) {
  const cell = S.cells.get(key);
  if (!cell) return;
  const ids = cell.entries.map((x) => x.id);
  let next = S.cur && ids.includes(S.cur.entryId) ? S.cur.entryId : null;
  if (!next) next = ids.find((id) => !S.solved.has(id)) || ids[0];
  const idx = cell.entries.find((x) => x.id === next).index;
  setCurrent(next, idx);
}

function setCurrent(entryId, idx) {
  S.cur = { entryId, idx };
  const e = S.entries.get(entryId);
  if (e) {
    $("cb-num").textContent = `${e.num}${e.dir === "across" ? "A" : "D"}`;
    $("cb-clue").textContent = e.clue;
  }
  for (const cell of S.cells.values()) cell.box.classList.remove("in-entry");
  for (const cell of entryCells(entryId)) cell.box.classList.add("in-entry");
  for (const li of document.querySelectorAll(".clue-col li"))
    li.classList.toggle("active", li.dataset.entry === entryId);
}

function focusEntry(entryId, idx) {
  const cells = entryCells(entryId);
  const start = cells.findIndex((c, i) => i >= idx && !c.input.value);
  const target = cells[start === -1 ? Math.min(idx, cells.length - 1) : start];
  setCurrent(entryId, cells.indexOf(target));
  target.input.focus();
  target.input.select();
}

function step(delta) {
  if (!S.cur) return;
  const cells = entryCells(S.cur.entryId);
  const next = S.cur.idx + delta;
  if (next < 0 || next >= cells.length) return;
  setCurrent(S.cur.entryId, next);
  cells[next].input.focus();
  cells[next].input.select();
}

function onBeforeInput(e) {
  const input = e.target;
  if (input.readOnly) { e.preventDefault(); return; }
  if (e.inputType === "deleteContentBackward" || e.inputType === "deleteContentForward") return;
  const ch = (e.data || "").toUpperCase().replace(/[^A-Z]/g, "");
  e.preventDefault();
  if (!ch) return;
  input.value = ch[0];
  onFilled(input.dataset.key);
  step(1);
}

function onKeyDown(e) {
  const input = e.target;
  const cell = S.cells.get(input.dataset.key);

  if (e.key === "Backspace") {
    e.preventDefault();
    if (input.readOnly) { step(-1); return; }
    if (input.value) { input.value = ""; return; }
    step(-1);
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const ids = [...S.entries.keys()];
    const at = ids.indexOf(S.cur.entryId);
    const order = e.shiftKey ? ids.slice(0, at).reverse().concat(ids.slice(at).reverse())
                             : ids.slice(at + 1).concat(ids.slice(0, at + 1));
    const next = order.find((id) => !S.solved.has(id)) || order[0];
    focusEntry(next, 0);
    return;
  }
  if (e.key === " ") {
    e.preventDefault();
    const other = cell.entries.find((x) => x.id !== S.cur.entryId);
    if (other) { setCurrent(other.id, other.index); }
    return;
  }
  const moves = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
  if (moves[e.key]) {
    e.preventDefault();
    const [dr, dc] = moves[e.key];
    let r = cell.r + dr, c = cell.c + dc;
    while (r >= 0 && c >= 0) {
      const n = S.cells.get(`${r},${c}`);
      if (n) { n.input.focus(); n.input.select(); return; }
      r += dr; c += dc;
    }
  }
}

/** After a letter lands, submit any entry that is now completely filled. */
function onFilled(key) {
  const cell = S.cells.get(key);
  for (const { id } of cell.entries) {
    if (S.solved.has(id)) continue;
    const cells = entryCells(id);
    if (cells.every((c) => c.input.value)) {
      const guess = cells.map((c) => c.input.value).join("");
      sendMsg({ type: "CHECK_ENTRY", entryId: id, guess });
    }
  }
}

// ── entry pad (phones) ────────────────────────────────────────────
// A ten-word grid plus a keyboard doesn't fit a phone. Tapping a clue opens
// the one entry full-screen: its boxes wrap left-to-right onto as many rows
// as it needs, with the clue beside them.
const isNarrow = () => window.matchMedia("(max-width: 760px)").matches;

function openEntryPad(entryId) {
  if (!isNarrow() || !S.entries.has(entryId)) return false;
  const e = S.entries.get(entryId);
  S.padEntry = entryId;

  $("ep-tag").textContent = `${e.num} ${e.dir}`;
  $("ep-dir").textContent = `${e.num} ${e.dir === "across" ? "Across" : "Down"}`;
  $("ep-text").textContent = e.clue;

  const host = $("ep-cells");
  host.textContent = "";
  const cells = entryCells(entryId);
  cells.forEach((cell, i) => {
    const box = el("div", "ep-cell");
    const input = el("input");
    input.maxLength = 1;
    input.autocapitalize = "characters";
    input.autocomplete = "off";
    input.value = cell.input.value;
    input.readOnly = cell.input.readOnly;
    input.dataset.i = String(i);
    box.append(input);
    box.append(el("span", "ep-n", String(i + 1)));
    host.append(box);
  });

  host.querySelectorAll("input").forEach((input) => {
    input.addEventListener("beforeinput", (ev) => {
      if (input.readOnly) { ev.preventDefault(); return; }
      if (ev.inputType.startsWith("delete")) return;
      const ch = (ev.data || "").toUpperCase().replace(/[^A-Z]/g, "");
      ev.preventDefault();
      if (!ch) return;
      input.value = ch[0];
      commitPad();
      const next = host.querySelector(`input[data-i="${Number(input.dataset.i) + 1}"]`);
      if (next) { next.focus(); next.select(); }
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Backspace") return;
      ev.preventDefault();
      if (input.value && !input.readOnly) { input.value = ""; commitPad(); return; }
      const prev = host.querySelector(`input[data-i="${Number(input.dataset.i) - 1}"]`);
      if (prev) { prev.focus(); prev.select(); }
    });
  });

  $("entry-pad").hidden = false;
  const first = [...host.querySelectorAll("input")].find((i) => !i.value && !i.readOnly)
    || host.querySelector("input");
  if (first) { first.focus(); first.select(); }
  return true;
}

/** Push the pad's letters back into the real grid and submit if complete. */
function commitPad() {
  if (!S.padEntry) return;
  const cells = entryCells(S.padEntry);
  const inputs = [...$("ep-cells").querySelectorAll("input")];
  inputs.forEach((input, i) => {
    if (cells[i] && !cells[i].input.readOnly) cells[i].input.value = input.value;
  });
  const key = `${cells[0].r},${cells[0].c}`;
  onFilled(key);
}

function closeEntryPad() {
  $("entry-pad").hidden = true;
  S.padEntry = null;
}

$("ep-close").onclick = closeEntryPad;
$("ep-prev").onclick = () => padHop(-1);
$("ep-next").onclick = () => padHop(1);

function padHop(delta) {
  const ids = [...S.entries.keys()];
  const at = ids.indexOf(S.padEntry);
  for (let i = 1; i <= ids.length; i++) {
    const next = ids[(at + delta * i + ids.length * ids.length) % ids.length];
    if (!S.solved.has(next)) { openEntryPad(next); return; }
  }
  closeEntryPad();
}

function markSolved(entryId) {
  S.solved.add(entryId);
  if (S.padEntry === entryId) {
    $("ep-cells").querySelectorAll("input").forEach((i) => { i.readOnly = true; });
    setTimeout(() => { if (S.padEntry === entryId) padHop(1); }, 450);
  }
  for (const cell of entryCells(entryId)) {
    cell.box.classList.add("done");
    cell.input.readOnly = true;
  }
  const li = document.querySelector(`.clue-col li[data-entry="${entryId}"]`);
  if (li) li.classList.add("done");
}

function flashWrong(entryId) {
  for (const cell of entryCells(entryId)) {
    cell.box.classList.add("wrong");
    setTimeout(() => cell.box.classList.remove("wrong"), 320);
  }
}

// ───────────────────────────────────────────────────────────── dojo socket

async function enterDojo(code) {
  S.code = code;
  $("dojo-code").textContent = code;
  resetRoundUI();
  showView("lobby");
  show("dojo");
  await connect();
}

function closeSocket() {
  if (S.socket) { S.socket.onclose = null; S.socket.close(); S.socket = null; }
  clearInterval(S.ticker);
  S.ticker = null;
}

async function connect() {
  closeSocket();
  const token = await auth.currentUser.getIdToken();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/api/dojo/${S.code}/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  S.socket = ws;

  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  };
  ws.onclose = () => {
    clearInterval(S.beat);
    S.beat = null;
    if (S.code) {
      feed("Connection lost. Reconnecting.");
      // The DO keys everything by uid, so a reconnect restores the round.
      setTimeout(() => { if (S.code) connect(); }, 1500);
    }
  };

  // Keeps the dojo listed while it waits for players.
  clearInterval(S.beat);
  S.beat = setInterval(() => sendMsg({ type: "PING" }), 30_000);
}

function sendMsg(obj) {
  if (S.socket?.readyState === WebSocket.OPEN) S.socket.send(JSON.stringify(obj));
}

$("btn-leave").onclick = () => {
  if (S.puzzle && !confirm("End the match and take the MMR you've earned so far?")) return;
  sendMsg({ type: "END_MATCH" });
  S.code = null; closeSocket(); show("home"); loadScrolls();
};
$("btn-copy").onclick = async () => {
  try { await navigator.clipboard.writeText(S.code); $("btn-copy").textContent = "Copied"; }
  catch { $("btn-copy").textContent = S.code; }
  setTimeout(() => ($("btn-copy").textContent = "Copy code"), 1600);
};

function showView(which) {
  for (const v of ["lobby", "play", "referee", "results"]) $(`view-${v}`).hidden = v !== which;
}

function handle(msg) {
  switch (msg.type) {
    case "WELCOME":
      S.isSensei = !!msg.isSensei;
      if (msg.promoted) feed("The sensei left. You are leading now.");
      break;

    case "LOBBY_STATE":
      S.lobby = msg.lobby;
      S.isSensei = msg.lobby.senseiUid === S.user.uid;
      paintRoster();
      paintLobby();
      break;

    case "ROUND_START":
      startRound(msg);
      break;

    case "ROUND_RESUME":
      startRound(msg, msg.solved, msg.solvedLetters || {});
      break;

    case "CHECK_RESULT":
      if (msg.correct) markSolved(msg.entryId);
      else flashWrong(msg.entryId);
      break;

    case "PROGRESS":
      if (msg.uid !== S.user.uid) paintRoster();
      break;

    case "PLAYER_FINISHED":
      feed(`<b>${escapeHtml(msg.name)}</b> finished in ${fmt(msg.elapsedMs)} — ${msg.score} points.`, true);
      break;

    case "ROUND_END":
      endRound(msg);
      break;

    case "PUZZLE_ACCEPTED":
      say("dojo-error", "");
      break;

    case "ERROR":
      if (S.lobby?.phase === "ACTIVE") feed(msg.message);
      else say("dojo-error", msg.message);
      break;
  }
}

// ───────────────────────────────────────────────────────────── lobby paint

function paintRoster() {
  const list = $("roster-list");
  list.textContent = "";
  if (!S.lobby) return;
  for (const m of S.lobby.members) {
    const li = el("li", m.online ? "" : "offline");
    const dot = el("span", "belt");
    dot.style.background = m.score == null ? "transparent"
      : m.status === "finished" ? "#4fa85c" : "#8d8b86";
    li.append(dot, el("span", "who", m.name));
    if (m.uid === S.lobby.senseiUid) li.append(el("span", "tag", "sensei"));
    else if (m.role === "referee") li.append(el("span", "tag", "referee"));
    else if (m.role === "spectator") li.append(el("span", "tag", "watching"));
    if (S.lobby.phase === "ACTIVE" && m.role === "player")
      li.append(el("span", "pips", `${m.solvedCount}/${WORDS}`));
    else if (m.score != null && S.lobby.phase === "RESULTS")
      li.append(el("span", "pips", String(m.score)));
    list.append(li);
  }
}

function paintLobby() {
  if (!S.lobby) return;
  const sensei = S.isSensei;
  $("sensei-controls").hidden = !sensei || S.lobby.phase === "ACTIVE";

  if (S.lobby.phase === "LOBBY") showView("lobby");
  if (S.lobby.phase === "RESULTS") $("results-note").textContent = sensei
    ? "Pick another scroll below and go again."
    : "Waiting for the sensei to set the next scroll.";

  if (sensei) {
    const solo = S.lobby.gameMode === "solo";
    const listed = S.lobby.listed !== false;

    $("btn-dojo-solo").classList.toggle("on", solo);
    $("btn-dojo-solo").setAttribute("aria-checked", String(solo));
    // A solo dojo has nobody to list it to.
    $("listed-toggle").hidden = solo;
    $("listed-toggle").classList.toggle("on", listed);
    $("listed-toggle").setAttribute("aria-checked", String(listed));

    drawCategorySelect();
    drawScrollSelect();

    const others = S.lobby.members.filter((m) => m.online).length;
    $("btn-start").disabled = !S.lobby.puzzle || (!solo && others < 2);
    $("btn-start").textContent = solo ? "Begin solo training" : "Begin the round";
    $("host-note").textContent = !S.lobby.puzzle
      ? "Choose a category and a scroll to begin."
      : solo
        ? "Solo training. Begin whenever you're ready."
        : others < 2
          ? "Waiting for at least one more student."
          : `${others} in the hall. Ready when you are.`;
  }

  $("lobby-heading").textContent = S.lobby.puzzle
    ? S.lobby.puzzle.title
    : "Waiting in the hall";
  const solo = S.lobby.gameMode === "solo";
  $("lobby-note").textContent = solo
    ? (S.lobby.puzzle ? "Solo training. Begin whenever you're ready." : "Choose a scroll to train against.")
    : S.lobby.puzzle
      ? (S.isSensei ? "Ready when you are." : "The scroll is set. Waiting for the sensei to begin.")
      : (S.isSensei ? "Choose a scroll to get started." : "Waiting for the sensei to choose a scroll.");
}

// Category first, then the twenty-four inside it. One flat list of forty-eight
// puzzles is a scroll-wheel; two steps is a choice.
// ── the category dropdown ──────────────────────────────────────────
//
// Twenty-eight categories is too many for a native select, which opens as
// tall as the screen allows. This is a dropdown that shows six and scrolls
// for the rest. The native <select> stays underneath as the value and the
// change event; everything else keeps reading and writing that.
function catDrop() {
  const sel = $("cat-select");
  if (!sel || sel.dataset.dropped) return;
  sel.dataset.dropped = "1";
  sel.hidden = true;

  const wrap = el("div", "catdrop");
  const btn = el("button", "catdrop-btn");
  btn.type = "button";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  const label = el("span", "catdrop-label", "");
  const caret = el("span", "catdrop-caret", "▾");
  btn.append(label, caret);
  const list = el("ul", "catdrop-list");
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.append(btn, list);
  sel.after(wrap);

  const close = () => { list.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const open = () => {
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    list.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  };
  const sync = () => {
    label.textContent = sel.options[sel.selectedIndex]?.textContent || "Choose a category";
    list.textContent = "";
    for (const o of sel.options) {
      const li = el("li", `catdrop-item${o.value === sel.value ? " on" : ""}`, o.textContent);
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(o.value === sel.value));
      li.onclick = () => {
        sel.value = o.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
        close();
      };
      list.append(li);
    }
  };
  btn.onclick = () => { if (list.hidden) open(); else close(); };
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) close(); });
  btn.onkeydown = (e) => { if (e.key === "Escape") close(); };

  // Redraws of the select re-run through here.
  new MutationObserver(sync).observe(sel, { childList: true });
  sel.addEventListener("change", sync);
  sync();
}

function drawCategorySelect() {
  const sel = $("cat-select");
  const want = sel.value || S.category || (categories()[0]?.id ?? "");
  sel.textContent = "";
  for (const c of categories()) {
    const o = el("option", "", c.name);
    o.value = c.id;
    sel.append(o);
  }
  if (S.scrolls.length) {
    const o = el("option", "", "Player scrolls");
    o.value = "mine";
    sel.append(o);
  }
  sel.value = [...sel.options].some((o) => o.value === want) ? want : (sel.options[0]?.value ?? "");
  S.category = sel.value;
  catDrop();
}

function drawScrollSelect() {
  const sel = $("scroll-select");
  const want = sel.value;
  sel.textContent = "";
  const none = el("option", "", "Choose a scroll");
  none.value = "";
  sel.append(none);

  if (S.category === "mine") {
    // The library, not a private drawer: every published scroll, with whose
    // it is when it isn't yours.
    for (const sc of S.scrolls) {
      const mine = sc.uid === S.user?.uid;
      const o = el("option", "", `${sc.title || "Untitled scroll"}${mine ? "" : ` \u2014 ${sc.author}`}`);
      o.value = `custom:${sc.id}`;
      sel.append(o);
    }
  } else {
    for (const level of ["easy", "medium", "hard"]) {
      const rows = S.bank.filter((p) => p.theme === S.category && p.difficulty === level);
      if (!rows.length) continue;
      const g = document.createElement("optgroup");
      g.label = level[0].toUpperCase() + level.slice(1);
      for (const p of rows) {
        const o = el("option", "", p.title);
        o.value = `bank:${p.id}`;
        g.append(o);
      }
      sel.append(g);
    }
  }
  sel.value = [...sel.options].some((o) => o.value === want) ? want : "";
}

$("cat-select").onchange = (e) => { S.category = e.target.value; drawScrollSelect(); };

$("scroll-select").onchange = (e) => {
  const v = e.target.value;
  if (!v) return;
  const [kind, id] = v.split(":");
  if (kind === "bank") {
    sendMsg({ type: "SET_PUZZLE", source: "bank", id });
  } else {
    // Published scrolls are fetched by the server from the library. The grid
    // no longer travels through the sensei's browser, which is what lets a
    // dojo run somebody else's scroll at all.
    sendMsg({ type: "SET_PUZZLE", source: "published", id });
  }
};

$("btn-start").onclick = () => { say("dojo-error", ""); sendMsg({ type: "START_ROUND" }); };

// Step between entries from the clue bar, for thumbs rather than Tab.
function hopEntry(delta) {
  if (!S.cur) return;
  const ids = [...S.entries.keys()];
  const at = ids.indexOf(S.cur.entryId);
  for (let i = 1; i <= ids.length; i++) {
    const next = ids[(at + delta * i + ids.length * ids.length) % ids.length];
    if (!S.solved.has(next)) return focusEntry(next, 0);
  }
}
$("clue-prev").onclick = () => hopEntry(-1);
$("clue-next").onclick = () => hopEntry(1);

// The on-screen keyboard overlays the page rather than resizing it on iOS,
// so the clue bar is lifted by however much of the viewport it covers.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const lift = () => {
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb", `${covered}px`);
  };
  vv.addEventListener("resize", lift);
  vv.addEventListener("scroll", lift);
  lift();
}

$("listed-toggle").onclick = () =>
  sendMsg({ type: "SET_VISIBILITY", listed: !(S.lobby?.listed !== false) });

$("btn-dojo-solo").onclick = () =>
  sendMsg({ type: "SET_GAME_MODE", mode: S.lobby?.gameMode === "solo" ? "match" : "solo" });

// ───────────────────────────────────────────────────────────── round

function resetRoundUI() {
  $("clue-bar").hidden = true;
  closeEntryPad();
  S.solved = new Set();
  S.cur = null;
  S.puzzle = null;
  $("grid-wrap").textContent = "";
  $("timer").hidden = true;
  clearInterval(S.ticker);
  S.ticker = null;
}

function startRound(msg, alreadySolved = [], solvedLetters = {}) {
  resetRoundUI();
  S.clock = msg.serverNow - Date.now();
  S.untimed = !!msg.untimed;
  S.endsAt = msg.endsAt;
  S.roundMs = msg.durationMs || (msg.endsAt ? msg.endsAt - msg.startedAt : 0);
  S.words = msg.puzzle?.entries?.length || 10;

  const me = S.lobby?.members.find((m) => m.uid === S.user.uid);
  if (me && (me.role === "referee" || me.role === "spectator")) {
    showView("referee");
    $("view-referee").querySelector("h2").textContent =
      me.role === "referee" ? "You wrote this one" : "Round already running";
    $("view-referee").querySelector(".panel-sub").textContent =
      me.role === "referee"
        ? "You know every answer, so you sit this round out and watch the board."
        : "You arrived after the start. Watch this one out; you're in for the next.";
    paintRefereeAnswers();
  } else {
    S.puzzle = msg.puzzle;
    drawPlayable(msg.puzzle);
    showView("play");
    $("clue-bar").hidden = false;
    for (const id of alreadySolved) {
      if (!S.entries.has(id)) continue;
      // Letters come back with the resume: the player already earned them,
      // and locked-but-empty cells would block their crossings.
      const word = solvedLetters[id] || "";
      entryCells(id).forEach((cell, i) => { if (word[i]) cell.input.value = word[i]; });
      markSolved(id);
    }
    const first = msg.puzzle.entries.find((e) => !S.solved.has(e.id));
    if (first) {
      if (VIRTUAL_KEYBOARD) setCurrent(first.id, 0);
      else focusEntry(first.id, 0);
    }
  }

  // An untimed scroll has no clock to show; a counter would only suggest
  // there is a deadline somewhere.
  if (S.untimed) {
    $("timer").hidden = true;
  } else {
    $("timer").hidden = false;
    tick();
    S.ticker = setInterval(tick, 250);
  }
}

function tick() {
  const left = Math.max(0, S.endsAt - (Date.now() + S.clock));
  const pct = Math.max(0, Math.min(100, (left / (S.roundMs || 900_000)) * 100));
  $("timer-fill").style.width = `${pct}%`;
  $("timer-read").textContent = fmt(left);
  $("timer").classList.toggle("urgent", left <= 60_000);
  if (left <= 0) { clearInterval(S.ticker); S.ticker = null; }
}

/**
 * The post-match graphic. Shown whenever a match moved the bounty, so
 * everybody watching learns who lost it and who has it now.
 */
export function bountyCard(b) {
  if (!b) return "";
  if (b.claim) {
    return `
      <div class="bounty-card claimed">
        <p class="bc-k">\u{1F3AF} Bounty claimed</p>
        <p class="bc-line">
          <b>${escapeHtml(b.claim.name)}</b> takes the bounty
          ${b.claim.fromName ? `from <b>${escapeHtml(b.claim.fromName)}</b>` : "&mdash; it was unheld"}
        </p>
        <p class="bc-sub">+${b.claim.bonus} MMR &middot; kill number ${b.claim.kills} &middot; they are the target now</p>
        ${b.unlocked?.length ? `<p class="bc-un">Unlocked: ${b.unlocked.map((u) => escapeHtml(u.name)).join(" \u00b7 ")}</p>` : ""}
      </div>`;
  }
  if (b.defend) {
    return `
      <div class="bounty-card defended">
        <p class="bc-k">\u{1F6E1}\uFE0F Bounty defended</p>
        <p class="bc-line"><b>${escapeHtml(b.defend.name)}</b> holds the target</p>
        <p class="bc-sub">+${b.defend.bonus} MMR &middot; defence number ${b.defend.defends} &middot; the mark is now ${b.defend.rate}/hr</p>
      </div>`;
  }
  return "";
}

function endRound(msg) {
  for (const r of msg.results || []) {
    if (r.promoted) feed(`<b>${escapeHtml(r.name)}</b> promoted to ${r.belt} belt at ${r.mmrAfter.toLocaleString()} MMR.`, true);
  }
  clearInterval(S.ticker);
  S.ticker = null;
  $("timer").hidden = true;

  const list = $("results-list");
  list.textContent = "";
  msg.results.forEach((r, i) => {
    const li = el("li", r.status === "dnf" ? "dnf" : r.status === "ended" ? "part" : "");
    li.append(el("span", "rank", String(i + 1)));
    li.append(el("span", "who", r.name));
    li.append(el("span", "time", r.status === "dnf" ? "unfinished"
      : r.status === "ended" ? `${r.solved}/${S.words || 10} words` : fmt(r.elapsedMs)));
    if (r.gain != null) {
      const bits = [`${r.breakdown.base} base`];
      if (r.breakdown.challenge) bits.push(`+${r.breakdown.challenge} challenge`);
      if (r.breakdown.completion) bits.push(`+${r.breakdown.completion} finish`);
      if (r.breakdown.seed) bits.push(`+${r.breakdown.seed} seed`);
      const g = el("span", "gain", `+${r.gain} MMR`);
      g.title = bits.join(", ");
      li.append(g);
    }
    li.append(el("span", "pts", String(r.score)));
    list.append(li);
  });

  const card = bountyCard(msg.bounty);
  if (card) {
    const box = el("div");
    box.innerHTML = card;
    list.after(box);
  }

  const rev = $("revealed");
  rev.textContent = "";
  if (msg.puzzle?.entries) {
    for (const e of msg.puzzle.entries) {
      const row = el("div", "row");
      row.append(el("span", "a", `${e.num} ${e.dir === "across" ? "across" : "down"}`));
      row.append(el("span", "c", `${e.answer} — ${e.clue}`));
      rev.append(row);
    }
  }
  showView("results");
}

/** The sensei wrote this scroll, so their own copy is the reference. */
function paintRefereeAnswers() {
  const host = $("referee-answers");
  host.textContent = "";
  const id = S.lobby?.puzzle?.id;
  const scroll = S.scrolls.find((s) => s.id === id);
  if (!scroll?.layout?.entries) return;
  for (const e of scroll.layout.entries) {
    const row = el("div", "row");
    row.append(el("span", "a", `${e.num} ${e.dir}`));
    row.append(el("span", "c", `${e.answer} — ${e.clue}`));
    host.append(row);
  }
}


// Which build this device is actually running. When a phone and a desktop
// disagree about what the app does, this is the first thing to compare.
{
  const stamp = document.querySelector('meta[name="build"]')?.content;
  const node = $("build-stamp");
  if (node && stamp) node.textContent = `build ${stamp}`;
  if (stamp) console.log(`[kotoba] build ${stamp}`);
}

// Paint before anything else draws, so there is no flash of the wrong palette.
applyTheme(savedTheme());

// Shared with the other games' end screens, which are separate modules.
window.__bountyCard = bountyCard;

bindBattleControls();
bindMineControls();
bindCasino();

// ── knowing when the arena has been rebuilt ─────────────────────────
//
// The service worker fetches code from the network, so a relaunch is already
// enough to be current. What it can't do is tell someone who has had the app
// open for hours. This asks a small file every few minutes and says so.
//
// It never reloads on its own: doing that mid-round would cost somebody a
// match. The choice stays with the player.
{
  const running = document.querySelector('meta[name="build"]')?.content || null;
  let told = false;

  const check = async () => {
    if (told || !running || document.hidden) return;
    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const { build } = await res.json();
      if (!build || build === running) return;

      told = true;
      const bar = $("update-bar");
      $("update-text").textContent = S.code
        ? "A new version is ready. It will apply when you finish this round."
        : "A new version of the Dojo is ready.";
      bar.hidden = false;
    } catch { /* offline, or the file isn't there yet */ }
  };

  $("update-now").onclick = () => location.reload();
  $("update-later").onclick = () => { $("update-bar").hidden = true; };

  setInterval(check, 5 * 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  setTimeout(check, 20_000);
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      // Ask the browser to look for a new worker now rather than whenever it
      // feels like it, which can be a day later.
      reg.update();

      let reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // A new worker took over, so the page is a version behind itself.
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    } catch { /* not fatal */ }
  });
}

// ───────────────────────────────────────────────────────────── odds and ends

function fmt(ms) {
  if (ms == null) return "—";
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function feed(html, rich = false) {
  const p = el("p", rich ? "hit" : "");
  if (rich) p.innerHTML = html;
  else p.textContent = html;
  const f = $("feed");
  f.prepend(p);
  while (f.children.length > 40) f.lastChild.remove();
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
