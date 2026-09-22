import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut, updateProfile,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, getDoc, doc, setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { buildLayout } from "./layout.js";
import { GI_COLORS, giSvg, GAME_MODES } from "./arena.js";
import {
  AVATARS, LEAGUES, FRAMES, FRAME_TIERS, TITLES, GAME_NAMES, BANNERS,
  avatarHtml, framedHtml, titleById, meets, needText,
  bannerById, bannerEarned, bannerNeedText, bannerHtml, achievementsFor, lifetime,
} from "./cosmetics.js";
import { enterBattle, closeBattle, bindBattleControls } from "./battle.js";
import { enterMines, closeMines, bindMineControls } from "./mines.js";
import { THEMES, applyTheme, savedTheme, themeById, THEME_EPOCH, DEFAULT_THEME, isStale } from "./theme.js";
import { enterCasino, leaveCasino, bindCasino } from "./casino.js";
import { casinoRulesHtml } from "./game-modes.js";
import { UPDATES, PULSE_HOURS, KEEP_DAYS } from "./whats-new.js";
import { BRANCHES, branchOf, rankOf, atTop, rankLabel } from "./ranks.js";
import { applyTokenTab, GAME_ARSENALS, shopItem, WORD_ARSENAL_ITEMS } from "./boost.js";

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
  frame: "none",
  title: "",
  banner: "",
  open: false,      // whether the record is public
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
  $("btn-auth").textContent = { signin: "Enter the dojo", signup: "Create and enter", recover: "Reset the pin and enter" }[mode];
  $("auth-pin").autocomplete = mode === "signin" ? "current-password" : "new-password";
  $("auth-pin-label").textContent = mode === "recover" ? "New six-digit pin" : "Six-digit pin";
  $("auth-order-field").hidden = mode === "signin";
  $("btn-forgot").hidden = mode !== "signin";
  $("btn-forgot").textContent = "Forgot your pin?";
  $("gate-key").hidden = mode === "signin";
  $("gate-hint").textContent = {
    signin: "Forgotten your pin? Your Etsy order number resets it.",
    signup: "Names are yours alone. Pins are not — pick one you'll remember, and don't reuse a pin that guards anything important.",
    recover: "Enter the name, the order number that opened it, and the pin you want from now on.",
  }[mode];
  say("gate-error", "");
}

// Where a key comes from. Asked once at the gate; the invite uses it too.
async function loadShopfront() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    S.etsy = cfg.etsy || "";
  } catch { S.etsy = S.etsy || ""; }
  const a = $("gate-etsy");
  a.hidden = !S.etsy;
  if (S.etsy) a.href = S.etsy;
}
loadShopfront();

$("btn-forgot").onclick = () => setMode(authMode === "recover" ? "signin" : "recover");

// The order number a fresh registration will lock to itself once signed in.
let pendingOrder = null;
const ORDER_RE = /^\d{8,12}$/;
const cleanOrder = (v) => String(v || "").replace(/[^\d]/g, "");

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

  const order = cleanOrder($("auth-order").value);
  if (authMode !== "signin" && !ORDER_RE.test(order))
    return say("gate-error", "The Etsy order number is 8 to 12 digits — it's on your receipt.");

  $("btn-auth").disabled = true;
  say("gate-error", "");
  try {
    if (authMode === "signup") {
      pendingOrder = order;
      const cred = await createUserWithEmailAndPassword(auth, addressFor(name), secretFor(pin));
      await updateProfile(cred.user, { displayName: name });
    } else if (authMode === "recover") {
      const res = await fetch("/api/recover", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, order, pin }),
      });
      const out = await res.json();
      if (!out.ok) { say("gate-error", out.error || "That didn't work."); return; }
      await signInWithEmailAndPassword(auth, addressFor(name), secretFor(pin));
    } else {
      await signInWithEmailAndPassword(auth, addressFor(name), secretFor(pin));
    }
  } catch (e) {
    say("gate-error", authError(e.code, e.message));
  } finally {
    $("btn-auth").disabled = false;
  }
};

$("btn-signout").onclick = () => { closeSocket(); signOut(auth); };
$("pb-avatar").onclick = drawAvatarPicker;

onAuthStateChanged(auth, async (user) => {
  clearTimeout(bootTimeout);
  $("boot").hidden = true;
  S.user = user;
  if (!user) { show("gate"); return; }
  // Guest play is over. A browser still holding an anonymous session is
  // signed out and told why, and the server refuses the token regardless.
  if (user.isAnonymous) {
    S.user = null;
    await signOut(auth).catch(() => {});
    show("gate");
    say("gate-error", "Guest play has ended. Register a name to keep playing \u2014 it takes ten seconds.");
    return;
  }
  try {
    // Every account is made with a name; the address it signed up under
    // stands in if that ever failed to save.
    if (!user.displayName) await updateProfile(user, { displayName: (user.email || "").split("@")[0] || "Player" });
    render();
    // The gate: an account without a key is held here. A registration that
    // came with one hands it over now; anyone else is asked for theirs.
    let me = await askStanding();
    if (me && !me.unlocked && !me.unknown && pendingOrder) {
      const out = await redeemKey(pendingOrder);
      pendingOrder = null;
      if (out.ok) me = await askStanding();
      else { drawLocked(me, out.error); return; }
    }
    if (me && !me.unlocked) { drawLocked(me); return; }
    enterHome();
  } catch (err) {
    window.__fault("Signed in, but the app couldn't start", "The browser console has the details.", err.message);
  }
});

function enterHome() {
  $("locked")?.remove();
  show("home");
  window.__ready = true;
  drawRuleBelts();
  // Firestore is optional — the game runs on the built-in puzzles without
  // it. None of these may block the screen from drawing: if no database has
  // been provisioned, the SDK retries forever rather than failing.
  loadAvatar();
  loadBank();
  loadScrolls();
}

async function redeemKey(order) {
  try {
    const res = await fetch("/api/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({ order }),
    });
    return await res.json();
  } catch { return { ok: false, error: "Couldn't reach the arena. Try again." }; }
}

// Held at the door: signed in, no key yet (or a revoked one).
function drawLocked(me, error) {
  show("gate");
  let host = $("locked");
  if (!host) { host = el("div", "barred"); host.id = "locked"; document.body.append(host); }
  const revoked = me.reason === "revoked";
  const unknown = !!me.unknown;
  host.innerHTML = `
    <div class="barred-card locked-card">
      <h2>${revoked ? "\u26D4 This key was revoked" : unknown ? "\u23F3 One moment" : "\u{1F511} Enter your key"}</h2>
      ${revoked
        ? `<p>The order number on this account was revoked by the admin. If that's a mistake, send a message through Etsy with your name here (<b>${escapeHtml(S.user?.displayName || "")}</b>).</p>`
        : unknown
          ? `<p>${escapeHtml(me.reason || "The arena couldn't check your key.")}</p>`
          : `<p>You're signed in as <b>${escapeHtml(S.user?.displayName || "")}</b>. The game is sold on Etsy; the order number on your receipt is your key. Enter it once and it's yours \u2014 it opens this account and resets a forgotten pin.</p>
             <div class="keyrow"><input id="locked-order" inputmode="numeric" maxlength="14" placeholder="Etsy order number" autocomplete="off"><button id="locked-go" class="btn btn-primary">Unlock</button></div>`}
      <p id="locked-error" class="notice notice-bad" ${error ? "" : "hidden"}>${escapeHtml(error || "")}</p>
      ${S.etsy && !revoked ? `<a class="etsy" href="${escapeHtml(S.etsy)}" target="_blank" rel="noopener">Get a key on Etsy \u2192</a>` : ""}
      <div class="keyrow">
        ${unknown ? `<button id="locked-retry" class="btn">Try again</button>` : ""}
        <button id="locked-out" class="btn btn-quiet">Log out</button>
      </div>
    </div>`;
  $("locked-out").onclick = () => { host.remove(); closeSocket(); signOut(auth); };
  if ($("locked-retry")) $("locked-retry").onclick = async () => {
    const again = await askStanding();
    if (again && again.unlocked) enterHome(); else drawLocked(again || me);
  };
  if ($("locked-go")) $("locked-go").onclick = async () => {
    const order = cleanOrder($("locked-order").value);
    if (!ORDER_RE.test(order)) return say("locked-error", "An Etsy order number is 8 to 12 digits.");
    $("locked-go").disabled = true;
    const out = await redeemKey(order);
    if (out.ok) { const again = await askStanding(); if (again?.unlocked) return enterHome(); }
    say("locked-error", out.error || "That key didn't open the door.");
    $("locked-go").disabled = false;
  };
  $("locked-order")?.focus();
}

function render() {
  $("home-name").textContent = S.user?.displayName || "Student";
}

// Reads the profile, and writes it back only when something differs: a new
// account, a name changed elsewhere, a theme from before the current house
// look. A visit that changes nothing writes nothing — it used to write every
// time, and before the read had even come back, so a slow read could put
// the default gi over a saved one.
async function loadAvatar() {
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "users", S.user.uid)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    const v = snap.data();
    if (v?.avatar) S.avatar = v.avatar;
    if (v?.frame) S.frame = v.frame;
    if (typeof v?.title === "string") S.title = v.title;
    if (typeof v?.banner === "string") S.banner = v.banner;
    if (typeof v?.open === "boolean") S.open = v.open;
    let write = !snap.exists() || (v.displayName || "") !== (S.user?.displayName || "");
    // The theme follows the player between the desktop and the phone.
    // A saved theme from before the current house look is moved on once. The
    // next choice a player makes sticks as normal.
    if (isStale(v?.themeEpoch)) {
      applyTheme(DEFAULT_THEME);
      write = true;
    } else if (v?.theme && themeById(v.theme).id === v.theme) {
      applyTheme(v.theme);
    }
    if (write) saveProfile();
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
        frame: S.frame || "none", title: S.title || "", banner: S.banner || "", open: !!S.open,
        theme: document.documentElement.dataset.theme || savedTheme(),
        themeEpoch: THEME_EPOCH,
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
 * Read from the Worker's reading room, which holds a copy of the board and
 * settles the order: prestige outranks MMR — the point of the game is to
 * rank up, and prestiging costs 3,000 MMR, so an order by MMR alone would
 * drop a freshly promoted officer off the bottom of the list the moment they
 * were promoted. This used to be two Firestore queries from every browser
 * every thirty seconds; now it is one request that costs the database
 * nothing.
 */
async function loadRankings() {
  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
  try {
    const res = await Promise.race([
      fetch("/api/rankings", { headers: { Authorization: `Bearer ${await idToken()}` } }),
      timeout(6000),
    ]);
    standings = (await res.json()).standings || [];
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

/**
 * Enlisted insignia: chevrons up to three, rockers beneath for the next
 * three, and a star in the middle for the top three grades. Drawn in the
 * same ink as the officer pips so the two ladders read as one system.
 */
function chevronSvg(grade, cls = "insig") {
  const k = Math.min(Math.max(1, Number(grade) || 1), 9);
  const chev = Math.min(k, 3), rock = Math.min(Math.max(0, k - 3), 3), star = k >= 7;
  const [fill, stroke] = INSIG_INK.gold;
  let body = "";
  for (let i = 0; i < chev; i++) body += `<path d="M4 ${6 + i * 4.5} L20 ${1 + i * 4.5} L36 ${6 + i * 4.5}" fill="none" stroke-width="2.6"/>`;
  for (let i = 0; i < rock; i++) body += `<path d="M5 ${17 + i * 3.6} Q20 ${21.5 + i * 3.6} 35 ${17 + i * 3.6}" fill="none" stroke-width="2.4"/>`;
  if (star) body += `<polygon points="${starPoints(20, 13.5, 3.6, 1.5)}" stroke-width=".8"/>`;
  return `<svg class="${cls}" viewBox="0 0 40 28" role="img" aria-label="enlisted grade ${k}" fill="${fill}" stroke="${stroke}" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
}

/** The insignia for a rank in any branch. */
function rankSvg(branch, prestige, cls = "insig") {
  const r = rankOf(branch, prestige);
  if (!r) return "";
  return r.kind === "officer" ? insigniaSvg(r.grade, cls) : chevronSvg(r.grade, cls);
}

/** The Medal of Honor, with how many times it was earned. */
function medalSvg(n, cls = "medal-honor") {
  if (!n) return "";
  return `<span class="${cls}" title="Medal of Honor \u00d7${n} \u2014 retired ${n} time${n === 1 ? "" : "s"}">` +
    `<svg viewBox="0 0 24 34" aria-hidden="true"><path d="M6 0h12l-3 12H9z" fill="#3B82F6"/><path d="M9 0h6l-1.5 12h-3z" fill="#E5E7EB"/>` +
    `<circle cx="12" cy="22" r="9" fill="#E8C15A" stroke="#7A5A12" stroke-width="1"/><polygon points="${starPoints(12, 22, 6, 2.6)}" fill="#7A5A12"/></svg>` +
    `<b>\u00d7${n}</b></span>`;
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

const RANK_ABBR = ["2LT", "1LT", "CPT", "MAJ", "LTC", "COL", "BG", "MG", "LTG", "GEN"];

function drawMyRank() {
  const me = standings.find((r) => r.uid === S.user?.uid);
  const mmr = me?.mmr ?? 0;
  const p = me?.prestige || 0;
  const [, name, hex] = belt(mmr);

  $("pb-swatch").style.background = hex;
  $("pb-beltname").textContent = name;
  $("pb-mmr").textContent = mmr.toLocaleString();

  // The insignia beside the rank, in whichever branch they are climbing,
  // and the medal for every ladder already climbed.
  const branch = me?.branch || 0;
  const rank = rankOf(branch, p);
  $("pb-insignia").innerHTML = p ? rankSvg(branch, p, "insig pb-insig") + medalSvg(me?.retired || 0) : medalSvg(me?.retired || 0);
  $("pb-star").textContent = rank ? rank.abbr : "—";
  $("pb-star").title = rank ? `${rank.name}, ${rank.branch.name}` : "Not yet earned";

  $("pb-avatar").innerHTML = framedHtml(avatarHtml(S.avatar, 56, giSvg), S.frame, 56, true);
  const top = atTop(branch, p);
  $("btn-prestige").hidden = mmr < PRESTIGE_COST || top;
  $("btn-retire").hidden = !top;
  reserveCardSpace();
}

// The card floats over the page, so the column beneath it starts below it.
// Measured rather than guessed: the card grows when Prestige is offered and
// the banner is a different height on every width.
function reserveCardSpace() {
  const card = $("playerbox"), bar = document.querySelector(".ladder-bar"), tabs = document.querySelector(".drawer-tabs");
  // Not offsetParent: a fixed element reports none, so that check never let
  // this run. A hidden card has no client rects; a shown one has.
  if (!card || !bar || !tabs || card.getClientRects().length === 0) return;
  // The belt ladder runs the full width under the banner, so it is the first
  // thing the card would cover. The room is made above the tab row, not
  // above the ladder: the tabs slide down and the ladder follows them, so
  // the tabs stay sitting on the belts as they always did.
  const want = card.getBoundingClientRect().bottom + 10;
  tabs.style.marginTop = "0px";
  bar.style.marginTop = "0px";
  const have = bar.getBoundingClientRect().top;
  tabs.style.marginTop = `${Math.max(0, want - have)}px`;
}
addEventListener("resize", reserveCardSpace);
// Any change to the card's size — it appearing, the name arriving, Prestige
// being offered — re-measures. The observer fires for each of those.
if ("ResizeObserver" in window) new ResizeObserver(reserveCardSpace).observe($("playerbox"));

// ── the avatar overlay ───────────────────────────────────────────────
//
// The only way to change the gi. Tap the avatar on the card and the choices
// open over the page; pick one and it saves and closes.
// ── the fighter profile overlay ──────────────────────────────────────
//
// Tap the avatar on the card and this opens over the page: OG Robes, a
// hundred-odd emoji and the four leagues, thirty frames in three tiers, and
// the titles — greyed until earned. Nothing is saved until Save Profile.
// The server checks every choice against the board before it is shown to
// anyone else, so the picker's own greying is a courtesy, not the gate.
let cosTab = "robes";

function myStanding() {
  const me = standings.find((r) => r.uid === S.user?.uid);
  return { mmr: me?.mmr ?? 0, prestige: me?.prestige ?? 0, retired: me?.retired ?? 0, spent: me?.spent ?? 0, feats: me?.feats || {} };
}

function drawAvatarPicker() {
  const host = $("avatar-modal");
  const pick = { avatar: S.avatar, frame: S.frame || "none", title: S.title || "", banner: S.banner || "" };
  const standing = myStanding();
  host.hidden = false;

  const tabs = [["robes", "OG Robes"], ["avatars", "Avatars"], ["frames", "Frames"], ["titles", "Titles"], ["banners", "Banners"]];
  const av = (id, size) => avatarHtml(id, size, giSvg);

  const body = () => {
    if (cosTab === "robes") return `
      <p class="panel-sub">The original gis.</p>
      <div class="gis">
        ${GI_COLORS.map((g) => `
          <button class="gi ${g.id === pick.avatar ? "is-on" : ""}" data-av="${g.id}" title="${g.name}">
            ${giSvg(g.id, 52)}<span>${g.name}</span>
          </button>`).join("")}
      </div>`;

    if (cosTab === "avatars") return `
      <div class="cos-label">Choose avatar</div>
      <div class="cos-box">
        ${AVATARS.map((e) => `<button class="cos-cell ${"e:" + e === pick.avatar ? "is-on" : ""}" data-av="e:${e}">${e}</button>`).join("")}
      </div>
      <div class="cos-label cos-label-sport">\u{1F3C6} Sports team avatars</div>
      ${LEAGUES.map((l) => `
        <div class="cos-league">${l.name}</div>
        <div class="cos-box cos-box-teams">
          ${l.teams.map((t) => `
            <button class="cos-cell cos-team ${"t:" + t.id === pick.avatar ? "is-on" : ""}" data-av="t:${t.id}" title="${t.name}" style="--bg:${t.bg}">${t.emoji}</button>`).join("")}
        </div>`).join("")}`;

    if (cosTab === "frames") return Object.entries(FRAME_TIERS).map(([tier, t]) => {
      const open = meets(t.need, standing);
      return `
        <div class="cos-label cos-tier-${tier}">${t.name}${open ? "" : ` · \u{1F512} ${needText(t.need)}`}</div>
        <div class="cos-frames">
          ${FRAMES.filter((f) => f.tier === tier).map((f) => `
            <button class="cos-frame ${f.id === pick.frame ? "is-on" : ""}" data-frame="${f.id}" ${open ? "" : "disabled"} title="${f.name}">
              ${framedHtml(av(pick.avatar, 40), f.id, 40, true)}<span>${f.name}</span>
            </button>`).join("")}
        </div>`;
    }).join("");

    if (cosTab === "titles") return `
      <p class="panel-sub">Earned by lifetime MMR — what is on your rating plus what prestige has spent. Shown beside your name in the Arena Rankings.</p>
      <div class="cos-titles">
        <button class="cos-title ${pick.title === "" ? "is-on" : ""}" data-title=""><span class="ct-name">No title</span></button>
        ${TITLES.map((t) => {
          const open = meets(t.need, standing);
          return `
            <button class="cos-title ${t.id === pick.title ? "is-on" : ""} ${open ? "" : "locked"}" data-title="${t.id}" ${open ? "" : "disabled"}>
              <span class="ct-name">${open ? "" : "\u{1F512} "}${t.name}</span>
              <span class="ct-game">${GAME_NAMES[t.game]}</span>
              <span class="ct-need">${open ? "Earned" : needText(t.need)}</span>
            </button>`;
        }).join("")}
      </div>`;

    // Banners: three a game, earned by what you have done in it. Shown on
    // your row in the Arena Rankings and nowhere else.
    const games = [...new Set(BANNERS.map((b) => b.game))];
    return `
      <p class="panel-sub">A moving backdrop on your row in the Arena Rankings. Earned by what you do in each game.</p>
      <div class="cos-banners">
        <button class="cos-banner ${pick.banner === "" ? "is-on" : ""}" data-banner=""><span class="cb-name">No banner</span></button>
        ${games.map((g) => `
          <div class="cos-league">${GAME_NAMES[g]}</div>
          ${BANNERS.filter((b) => b.game === g).map((b) => {
            const open = bannerEarned(b.id, standing);
            return `
              <button class="cos-banner ${b.id === pick.banner ? "is-on" : ""} ${open ? "" : "locked"}" data-banner="${b.id}" ${open ? "" : "disabled"}>
                ${bannerHtml(b.id, open)}
                <span class="cb-name">${open ? "" : "\u{1F512} "}${b.name}</span>
                <span class="cb-need">${open ? "Earned" : bannerNeedText(b, standing)}</span>
              </button>`;
          }).join("")}`).join("")}
      </div>`;
  };

  const render = () => {
    host.innerHTML = `
      <div class="modal-back" data-close></div>
      <div class="modal-card cos-card">
        <div class="modal-head">
          <h2>Fighter profile</h2>
          <button class="modal-close" data-close aria-label="Close">&times;</button>
        </div>
        <div class="cos-preview">
          ${framedHtml(av(pick.avatar, 64), pick.frame, 64, true)}
          <div class="cos-preview-txt">
            <div class="cos-preview-name">${escapeHtml(S.user?.displayName || "Student")}</div>
            <div class="cos-preview-title">${pick.title ? escapeHtml(titleById(pick.title)?.name || "") : "—"}</div>
          </div>
        </div>
        <div class="subtabs cos-tabs">
          ${tabs.map(([id, name]) => `<button class="stab ${cosTab === id ? "is-on" : ""}" data-tab="${id}">${name}</button>`).join("")}
        </div>
        <div class="modal-body cos-body">${body()}</div>
        <div class="cos-acts">
          <button class="btn cos-save" data-save>✓ Save profile</button>
          <button class="btn btn-ghost" data-close>Cancel</button>
        </div>
      </div>`;
    const close = () => { host.hidden = true; host.textContent = ""; };
    host.querySelectorAll("[data-close]").forEach((n) => { n.onclick = close; });
    host.querySelectorAll("[data-tab]").forEach((b) => { b.onclick = () => { cosTab = b.dataset.tab; render(); }; });
    host.querySelectorAll("[data-av]").forEach((b) => { b.onclick = () => { pick.avatar = b.dataset.av; render(); }; });
    host.querySelectorAll("[data-frame]").forEach((b) => { b.onclick = () => { pick.frame = b.dataset.frame; render(); }; });
    host.querySelectorAll("[data-title]").forEach((b) => { b.onclick = () => { pick.title = b.dataset.title; render(); }; });
    host.querySelectorAll("[data-banner]").forEach((b) => { b.onclick = () => { pick.banner = b.dataset.banner; render(); }; });
    host.querySelector("[data-save]").onclick = async () => {
      const changed = pick.avatar !== S.avatar || pick.frame !== (S.frame || "none") || pick.title !== (S.title || "") || pick.banner !== (S.banner || "");
      close();
      if (!changed) return;
      Object.assign(S, pick);
      drawMyRank();
      saveProfile();
      // The board's copy, checked by the server. What comes back is what
      // everyone else sees, so it is what the card shows too.
      try {
        const res = await fetch("/api/cosmetics", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
          body: JSON.stringify({ ...pick, open: !!S.open }),
        });
        const out = await res.json();
        if (out.ok && out.cosmetics) {
          const kept = out.cosmetics;
          if (kept.frame !== S.frame || kept.title !== S.title || kept.avatar !== S.avatar || kept.banner !== S.banner) {
            Object.assign(S, kept);
            drawMyRank();
            saveProfile();
          }
          loadRankings();
        }
      } catch { /* the card still shows it; the board catches up next save */ }
    };
  };
  render();
}

// ── conduct: the barred, and the admin's desk ───────────────────────
//
// After sign-in the arena is asked where you stand. A barred player sees a
// notice over the home screen with one way back: a request for review,
// which the admin approves or denies. The admin sees a Reports button on
// their card that pulses while there is something unread.
let adminPoll = null;

async function askStanding() {
  try {
    const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${await idToken()}` } });
    const me = await res.json();
    if (me.banned) drawBarred(me);
    else $("barred")?.remove();
    S.admin = !!me.admin;
    S.me = me;
    if (typeof me.etsy === "string") S.etsy = me.etsy;
    $("btn-reports").hidden = !S.admin;
    $("btn-keys").hidden = !S.admin;
    clearInterval(adminPoll);
    if (S.admin) { checkReports(); adminPoll = setInterval(() => { if (!document.hidden) checkReports(); }, 60_000); }
    return me;
  } catch { return null; /* the arena is unreachable; nothing to gate on */ }
}

// ── the keys desk ─────────────────────────────────────────────────
// Every order number that has opened an account. Revoke one and the account
// it opened is held at the door; let a name in by hand after checking the
// order on Etsy; reset a pin for someone who has lost theirs.
async function drawKeys() {
  const host = $("avatar-modal");
  host.hidden = false;
  host.innerHTML = `<div class="modal-back" data-close></div><div class="modal-card reports-card"><div class="modal-head"><h2>\u{1F511} Keys</h2><button class="modal-close" data-close aria-label="Close">&times;</button></div><div class="modal-body"><p class="panel-sub">Reading the desk&hellip;</p></div></div>`;
  const close = () => { host.hidden = true; host.textContent = ""; };
  host.querySelectorAll("[data-close]").forEach((n) => { n.onclick = close; });
  let desk;
  try {
    const res = await fetch("/api/admin/keys", { headers: { Authorization: `Bearer ${await idToken()}` } });
    desk = await res.json();
  } catch { desk = { keys: [] }; }
  const post = async (body) => {
    try {
      const res = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!out.ok) { say("keys-status", out.error || "Refused."); return false; }
      return true;
    } catch { say("keys-status", "Couldn't reach the desk."); return false; }
  };
  const keys = desk.keys || [];
  host.querySelector(".modal-body").innerHTML = `
    <p class="panel-sub">Accounts from before ${desk.epoch ? new Date(desk.epoch).toLocaleDateString() : "the keys"} are in without one. ${desk.etsy ? "" : "No Etsy link is set yet \u2014 put it in ETSY_URL and the invite and gate will carry it."}</p>
    <div class="key-forms">
      <div class="joinrow"><input id="keys-unlock-name" maxlength="16" placeholder="Name to let in by hand"><button class="btn btn-small" id="keys-unlock">Let in</button></div>
      <div class="joinrow"><input id="keys-pin-name" maxlength="16" placeholder="Name"><input id="keys-pin" inputmode="numeric" maxlength="6" placeholder="New pin" style="flex:0 0 7rem"><button class="btn btn-small" id="keys-setpin">Reset pin</button></div>
      <p id="keys-status" class="notice" hidden></p>
    </div>
    <h3 class="rec-h">Keys used \u00b7 ${keys.length}</h3>
    ${keys.length ? keys.map((k) => `
      <div class="key-row ${k.revoked ? "off" : ""}">
        <span><b>${escapeHtml(k.name)}</b> \u00b7 order #${escapeHtml(k.order)}${k.revoked ? " \u00b7 revoked" : ""}</span>
        <span class="rep-when">${ago(new Date(k.at).toISOString())}</span>
        <button class="btn btn-small" data-key="${escapeHtml(k.order)}" data-do="${k.revoked ? "restore" : "revoke"}">${k.revoked ? "Restore" : "Revoke"}</button>
      </div>`).join("") : `<p class="panel-sub">No key has been used yet.</p>`}`;
  host.querySelectorAll("[data-key]").forEach((b) => {
    b.onclick = async () => { if (await post({ action: b.dataset.do, order: b.dataset.key })) drawKeys(); };
  });
  $("keys-unlock").onclick = async () => {
    const name = $("keys-unlock-name").value.trim();
    if (await post({ action: "unlock", name })) say("keys-status", `${name} is in.`, false);
  };
  $("keys-setpin").onclick = async () => {
    const name = $("keys-pin-name").value.trim(), pin = $("keys-pin").value.trim();
    if (await post({ action: "pin", name, pin })) say("keys-status", `${name}'s pin is now ${pin}. Tell them, then have them change it.`, false);
  };
}
$("btn-keys").onclick = drawKeys;

function drawBarred(me) {
  let host = $("barred");
  if (!host) { host = el("div", "barred"); host.id = "barred"; document.body.append(host); }
  const asked = me.appeal;
  host.innerHTML = `
    <div class="barred-card">
      <h2>⛔ You have been removed from the arena</h2>
      <p class="panel-sub">${escapeHtml(me.reason || "Conduct")} · ${new Date(me.at || Date.now()).toLocaleDateString()}</p>
      <p>The rule book is short on this: rude, pornographic, abusive or soliciting behaviour means removal. Three refused lines is automatic.</p>
      ${asked
        ? `<p class="barred-asked">Your request for review was sent ${ago(new Date(asked.at).toISOString())}. The admin will look at it.</p>`
        : `<label class="barred-l">Ask for a review</label>
           <textarea id="appeal-text" maxlength="600" rows="4" placeholder="Say what happened and why you should be let back in."></textarea>
           <button id="appeal-send" class="btn btn-primary">Send the request</button>`}
      <button id="appeal-out" class="btn btn-quiet">Log out</button>
    </div>`;
  $("appeal-out").onclick = () => { closeSocket(); signOut(auth); };
  if ($("appeal-send")) $("appeal-send").onclick = async () => {
    const text = $("appeal-text").value.trim();
    if (text.length < 10) return;
    $("appeal-send").disabled = true;
    try {
      await fetch("/api/appeal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
        body: JSON.stringify({ text }),
      });
    } catch { /* fall through to the re-ask */ }
    askStanding();
  };
}

async function checkReports() {
  try {
    const res = await fetch("/api/admin/reports", { headers: { Authorization: `Bearer ${await idToken()}` } });
    const desk = await res.json();
    $("btn-reports").classList.toggle("pulse", (desk.unseen || 0) > 0);
    $("btn-reports").textContent = desk.unseen ? `⚠️ Reports (${desk.unseen})` : "⚠️ Reports";
  } catch { /* next minute */ }
}

async function drawReports() {
  const host = $("avatar-modal");
  host.hidden = false;
  host.innerHTML = `<div class="modal-back" data-close></div><div class="modal-card reports-card"><div class="modal-head"><h2>⚠️ Reports</h2><button class="modal-close" data-close aria-label="Close">&times;</button></div><div class="modal-body"><p class="panel-sub">Reading the desk&hellip;</p></div></div>`;
  const close = () => { host.hidden = true; host.textContent = ""; };
  host.querySelectorAll("[data-close]").forEach((n) => { n.onclick = close; });
  let desk;
  try {
    const res = await fetch("/api/admin/reports", { method: "POST", headers: { Authorization: `Bearer ${await idToken()}` } });
    desk = await res.json();
  } catch { desk = { reports: [], bans: {}, appeals: {} }; }
  $("btn-reports").classList.remove("pulse");
  $("btn-reports").textContent = "⚠️ Reports";

  const act = async (uid, action) => {
    await fetch("/api/admin/act", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({ uid, action }),
    }).catch(() => {});
    drawReports();
  };
  const appeals = Object.entries(desk.appeals || {});
  const bans = Object.entries(desk.bans || {});
  host.querySelector(".modal-body").innerHTML = `
    <h3 class="rec-h">Requests for review · ${appeals.length}</h3>
    ${appeals.length ? appeals.map(([uid, a]) => `
      <div class="rep-row">
        <div class="rep-main"><b>${escapeHtml(a.name)}</b> <span class="rep-when">${ago(new Date(a.at).toISOString())}</span>
          <p class="rep-text">${escapeHtml(a.text)}</p>
          <p class="rep-why">Barred: ${escapeHtml(desk.bans?.[uid]?.reason || "")}</p></div>
        <div class="rep-acts"><button class="btn btn-small btn-primary" data-act="unbar" data-uid="${uid}">Approve · let back in</button><button class="btn btn-small" data-act="deny" data-uid="${uid}">Deny</button></div>
      </div>`).join("") : `<p class="panel-sub">Nobody is asking.</p>`}
    <h3 class="rec-h">Barred · ${bans.length}</h3>
    ${bans.length ? bans.map(([uid, b]) => `
      <div class="rep-row">
        <div class="rep-main"><b>${escapeHtml(b.name || uid)}</b> <span class="rep-when">${ago(new Date(b.at).toISOString())}</span><p class="rep-why">${escapeHtml(b.reason || "")}</p></div>
        <div class="rep-acts"><button class="btn btn-small" data-act="unbar" data-uid="${uid}">Lift the bar</button></div>
      </div>`).join("") : `<p class="panel-sub">Nobody is barred.</p>`}
    <h3 class="rec-h">Refused lines · ${(desk.reports || []).length}</h3>
    ${(desk.reports || []).length ? (desk.reports || []).slice(0, 60).map((r) => `
      <div class="rep-row">
        <div class="rep-main"><b>${escapeHtml(r.name)}</b> <span class="rep-when">${ago(new Date(r.at).toISOString())} · ${escapeHtml(r.where || "")} · strike ${r.strikes ?? "?"}</span>
          <p class="rep-text">${escapeHtml(r.text)}</p>
          <p class="rep-why">${escapeHtml(r.reason)}</p></div>
        <div class="rep-acts">${desk.bans?.[r.uid] ? "" : `<button class="btn btn-small" data-act="bar" data-uid="${r.uid}">Bar</button>`}<button class="btn btn-small" data-act="clear" data-uid="${r.uid}">Clear strikes</button></div>
      </div>`).join("") : `<p class="panel-sub">Nothing refused. Quiet arena.</p>`}`;
  host.querySelectorAll("[data-act]").forEach((b) => { b.onclick = () => act(b.dataset.uid, b.dataset.act); });
}

$("btn-reports").onclick = drawReports;

$("btn-retire").onclick = async () => {
  const meRow = standings.find((r) => r.uid === S.user?.uid);
  const from = branchOf(meRow?.branch || 0);
  const to = BRANCHES[(BRANCHES.indexOf(from) + 1) % BRANCHES.length];
  const times = (meRow?.retired || 0) + 1;
  if (!window.confirm(
    `Retire from the ${from.name} with the Medal of Honor \u00d7${times}? Your MMR and prestige go back to zero `
    + `and you enlist in the ${to.name} — everything you have earned (titles, frames, banners) stays yours. `
    + `This cannot be undone. Continue?`
  )) return;
  $("btn-retire").disabled = true;
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch("/api/retire", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    say("home-error", body.ok ? `Retired with honours. Welcome to the ${body.to}.` : body.error, !body.ok);
    await loadRankings();
  } catch (e) {
    say("home-error", "Couldn't reach the arena. Try again.");
  } finally {
    $("btn-retire").disabled = false;
  }
};

$("btn-prestige").onclick = async () => {
  // Read from the standings, which is where the prestige count actually lives.
  const meRow = standings.find((r) => r.uid === S.user?.uid);
  const held = meRow?.prestige || 0;
  const next = rankLabel(meRow?.branch || 0, held + 1);   // plain text: this goes into a confirm()
  if (!window.confirm(
    `Prestige costs ${PRESTIGE_COST.toLocaleString()} MMR and promotes you to ${next}. `
    + `Anything above the cost stays on your rating. This cannot be undone. Continue?`
  )) return;
  $("btn-prestige").disabled = true;
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch("/api/prestige", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    say("home-error", body.ok ? `Prestiged. ${next} unlocked.` : body.error, !body.ok);
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
    const rk = rankOf(r.branch || 0, r.prestige);
    const tag = (rk ? `<span class="rank-tag">${rankSvg(r.branch || 0, r.prestige)}<span>${rk.name}${r.branch ? `, ${rk.branch.name}` : ""}</span></span>` : "")
      + medalSvg(r.retired || 0);
    // What they wear. Frames and banners move only on the podium; everyone
    // else's hold still until they climb into the top three.
    const cos = r.cos || {};
    const worn = cos.title ? titleById(cos.title) : null;
    return `
      <div class="slot ${i === 0 ? "lead" : ""} ${r.uid === S.user?.uid ? "you2" : ""} ${wanted ? "wanted-slot" : ""} ${r.prestige || r.retired ? "officer" : ""} ${cos.banner ? "has-banner" : ""}">
        ${cos.banner ? bannerHtml(cos.banner, i < 3) : ""}
        <span class="sr">${MEDALS[i] ? `<span class="medal" title="${["Champion", "Second", "Third"][i]}">${MEDALS[i]}</span>` : ordinal(i + 1)}</span>
        ${wanted ? `<span class="sb-target">\u{1F3AF}</span>` : ""}
        <span class="sa">${framedHtml(avatarHtml(cos.avatar || "white", 30, giSvg), cos.frame || "none", 30, i < 3)}</span>
        <span class="sb" style="background:${hex}"></span>
        <span class="sn"><span class="sn-in"><span class="sn-name">${escapeHtml(r.name)}${tag}</span>${worn ? `<span class="st">${escapeHtml(worn.name)}</span>` : ""}</span></span>
        <span class="sp">${r.mmr.toLocaleString()}</span>
      </div>`;
  }).join("");
  $("strip").querySelectorAll(".slot").forEach((slot, i) => {
    const r = standings[i];
    if (!r) return;
    slot.classList.add("peek");
    slot.title = "See their achievements";
    slot.onclick = () => viewFighter(r.uid);
  });
  bindRankingsFold();
  foldRankings(document.querySelector(".rankings")?.classList.contains("open") || false);
}

// ── achievements ─────────────────────────────────────────────────────
//
// Everything a fighter has earned, read off the same board row the rankings
// carry: banners, titles and frame tiers unlocked, and the lifetime tallies
// behind them. Yours opens from the header; anyone else's opens from their
// name in the Arena Rankings — if they have set their record to Public.
let achvTab = "earned";

function standingOf(row) {
  return { mmr: row?.mmr ?? 0, prestige: row?.prestige ?? 0, retired: row?.retired ?? 0, spent: row?.spent ?? 0, feats: row?.feats || {} };
}

function achievementsHtml(row, mine) {
  const st = standingOf(row);
  const a = achievementsFor(st);
  const cos = row?.cos || {};
  const gi = (id, size) => avatarHtml(id, size, giSvg);
  const head = `
    <div class="achv-head">
      ${framedHtml(gi(cos.avatar || "white", 56), cos.frame || "none", 56, true)}
      <div>
        <div class="achv-name">${escapeHtml(row?.name || S.user?.displayName || "Student")}</div>
        <div class="achv-sub">${cos.title ? escapeHtml(titleById(cos.title)?.name || "") + " · " : ""}${st.prestige ? `${rankLabel(row?.branch || 0, st.prestige)} · ` : ""}${row?.retired ? `Medal of Honor ×${row.retired} · ` : ""}${lifetime(st).toLocaleString()} lifetime MMR</div>
      </div>
      ${mine ? `
        <button class="achv-open ${S.open ? "is-public" : ""}" id="achv-open" title="Who can see this record">
          ${S.open ? "\u{1F30D} Public" : "\u{1F512} Private"}
        </button>` : ""}
    </div>`;

  const tabs = [["earned", "Earned"], ["stats", "Lifetime stats"], ["retired", "Retired All Stars"]];
  const strip = `<div class="subtabs">${tabs.map(([id, name]) =>
    `<button class="stab ${achvTab === id ? "is-on" : ""}" data-atab="${id}">${name}</button>`).join("")}</div>`;

  let body = "";
  if (achvTab === "earned") {
    body = `
      <h3 class="rec-h">Banners · ${a.banners.length} of ${BANNERS.length}</h3>
      ${a.banners.length ? `<div class="achv-banners">${a.banners.map((b) => `
        <div class="achv-banner">${bannerHtml(b.id, true)}<span class="cb-name">${b.name}</span><span class="cb-need">${GAME_NAMES[b.game]}</span></div>`).join("")}</div>`
        : `<p class="panel-sub">No banners yet. Every finished round counts toward one.</p>`}
      <h3 class="rec-h">Titles · ${a.titles.length} of ${TITLES.length}</h3>
      <div class="achv-chips">${a.titles.map((t) => `<span class="achv-chip">${t.name}</span>`).join("")}</div>
      <h3 class="rec-h">Frames</h3>
      <div class="achv-chips">${a.frameTiers.map((t) => `<span class="achv-chip tier-${t.id}">${t.name} ✓</span>`).join("")}</div>`;
  } else if (achvTab === "stats") {
    body = a.stats.length ? `<div class="belt-rows">${a.stats.map((s) => `
      <div class="belt-row"><span class="bn">${s.label}</span><span class="bt">${s.value.toLocaleString()}</span></div>`).join("")}</div>`
      : `<p class="panel-sub">Nothing on the record yet. Play something.</p>`;
  } else {
    const stars = standings.filter((r) => r.retired > 0).sort((a, b) => b.retired - a.retired);
    body = stars.length ? `
      <p class="panel-sub">Fighters who climbed a whole ladder and retired with the Medal of Honor.</p>
      <div class="belt-rows">${stars.map((r) => `
        <div class="belt-row ${r.uid === S.user?.uid ? "is-mine" : ""}">
          <span class="bn">${escapeHtml(r.name)} ${medalSvg(r.retired)}</span>
          <span class="bt">now ${rankLabel(r.branch || 0, r.prestige) || `enlisting, ${branchOf(r.branch || 0).name}`}</span>
        </div>`).join("")}</div>`
      : `<p class="panel-sub">Fighters who reach the top of a ladder and retire will be listed here with their Medal of Honor. Nobody has yet.</p>`;
  }
  return head + strip + body;
}

function drawAchievements(row = null) {
  const host = $("drawer-achv");
  const mine = !row;
  const me = mine ? standings.find((r) => r.uid === S.user?.uid) || { name: S.user?.displayName, cos: { avatar: S.avatar, frame: S.frame, title: S.title } } : row;
  const priv = !mine && !row.cos?.open;
  host.innerHTML = `
    <div class="modal-back" data-close></div>
    <div class="modal-card achv-card">
      <div class="modal-head">
        <h2>\u{1F3C5} Achievements</h2>
        <button class="modal-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        ${priv ? `<p class="panel-sub achv-private">\u{1F512} This fighter keeps their record private.</p>` : achievementsHtml(me, mine)}
      </div>
    </div>`;
  host.querySelectorAll("[data-close]").forEach((n) => { n.onclick = () => closePanel("drawer-achv", "tab-achv"); });
  host.querySelectorAll("[data-atab]").forEach((b) => { b.onclick = () => { achvTab = b.dataset.atab; drawAchievements(row); }; });
  const toggle = $("achv-open");
  if (toggle) toggle.onclick = async () => {
    S.open = !S.open;
    drawAchievements();
    saveProfile();
    try {
      await fetch("/api/cosmetics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
        body: JSON.stringify({ avatar: S.avatar, frame: S.frame, title: S.title, banner: S.banner, open: S.open }),
      });
      loadRankings();
    } catch { /* the toggle shows; the board catches up on the next save */ }
  };
}

/** Somebody else's record, from their row in the rankings. */
function viewFighter(uid) {
  const row = standings.find((r) => r.uid === uid);
  if (!row) return;
  achvTab = "earned";
  if (row.uid === S.user?.uid) { if (drawer("drawer-achv")) drawAchievements(); return; }
  if (drawer("drawer-achv")) drawAchievements(row);
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
        <button class="stab ${tab === "tokens" ? "is-on" : ""}" data-rule="tokens">\u26A1 Tokens</button>
        <button class="stab" data-points>Points</button>
      </div>
      ${inner}
    </div>`;

  if (tab === "modes") {
    $("drawer-rules").innerHTML = shell(`
      <p class="panel-sub">Every game in the arena \u2014 and <b>every one of them can be played on your own</b>. Tap a game for how it is played and how it scores.</p>
      <div class="gamegrid rules-games">
        ${GAME_RULES.map((g) => `
          <button class="gamepick" data-game-rules="${g.id}">
            <span class="gp-ico">${g.icon}</span>
            <span class="gp-name">${g.name}</span>
            <span class="gp-players">${g.players}</span>
            <span class="gp-solo">${g.solo}</span>
          </button>`).join("")}
      </div>`);
    bindRuleTabs();
    $("drawer-rules").querySelectorAll("[data-game-rules]").forEach((b) => { b.onclick = () => openGameRules(b.dataset.gameRules); });
    return;
  }

  if (tab === "match" || tab === "bounty" || tab === "belts" || tab === "tokens") {
    $("drawer-rules").innerHTML = shell(tab === "match" ? matchRules() : tab === "bounty" ? bountyRules() : tab === "tokens" ? tokensRules() : beltsRuleHtml());
    bindRuleTabs();
    return;
  }

  $("drawer-rules").innerHTML = shell(`
      <div class="rules-cols">

        <div class="rule-sec rule-conduct">
          <h3>Conduct</h3>
          <p class="lede2">The arena is for playing. Anyone who is rude, pornographic, abusive, or solicits anything of that nature \u2014 in any chat, in any game \u2014 will not be allowed to play any more.</p>
          <ul>
            <li>Every chat line is screened before it is posted. A refused line is a <b>strike</b>; the sender is told why.</li>
            <li>Links and pictures are not allowed in the chats.</li>
            <li><b>Three strikes</b> and the account is removed from the arena automatically.</li>
            <li>A removed player may send one request for review. The admin approves or denies it; there is no other way back.</li>
            <li>The admin may remove anyone at any time for conduct the screen did not catch.</li>
          </ul>
        </div>

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
            <div class="belt-row"><span class="bn">Under 7 seconds</span><span class="bt">50 MMR</span></div>
            <div class="belt-row"><span class="bn">15 seconds</span><span class="bt">25 MMR</span></div>
            <div class="belt-row"><span class="bn">20 seconds</span><span class="bt">17 MMR</span></div>
            <div class="belt-row"><span class="bn">25 seconds</span><span class="bt">8 MMR</span></div>
            <div class="belt-row"><span class="bn">30 seconds or more</span><span class="bt">0 MMR</span></div>
          </div>
          <ul style="margin-top:.6rem">
            <li><b>50 MMR</b> is the most a single puzzle can pay.</li>
            <li>The award falls evenly across <b>thirty seconds</b> from the moment the puzzle appears.</li>
            <li>Solving inside <b>seven seconds</b> multiplies it by <b>1.5</b>, which reaches the cap.</li>
            <li>A wrong answer ends that puzzle. Take another.</li>
            <li>Ten seconds pass before the next is offered.</li>
            <li>The arena sets the puzzle, keeps the answer and times the solve on its own clock, so the award is the same wherever you play.</li>
          </ul>
        </div>

        <div class="rule-sec">
          <h3>The casino</h3>
          <p class="lede2">Cash and table tokens are their own economy. Every hand or race you win pays <b>5 MMR</b>, up to <b>100 a day</b>; the arcade pays the rest.</p>
          <ul>
            <li>You start with <b>$100</b> and no table tokens.</li>
            <li>Every solved arcade puzzle pays <b>$5&ndash;15</b> to the table and a table token.</li>
            <li>Cash is won at the table and banks to your wallet only when a match is ended properly. Quitting loses it.</li>
            <li><b>Table Card Games</b> opens at <b>$50 and 2 table tokens</b>.</li>
            <li><b>Blackjack:</b> lose and it costs your bet and one table token. Win or push and your tokens are safe.</li>
            <li><b>Horse Race:</b> free to enter, cash wagers, 1:1 up to 24:1.</li>
            <li>Banked casino money buys the <b>arena tokens</b> in your profile's Token shop \u2014 see the \u26A1 Tokens tab.</li>
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
              ["Solve inside 7 seconds", "50"],
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
      ${box("\u{1F511} Membership", [
        "The game is sold on Etsy. Your Etsy order number is your key: enter it once when you register and it's locked to that account for good.",
        "A key opens one account and no other. A used number is refused at the door.",
        "Forgotten your pin? The order number that opened your account resets it from the sign-in page.",
        "Everyone who was already playing before the keys went in is in for good \u2014 nothing to enter.",
        "A number found to be reused or not yours can be revoked by the admin, and the account it opened is held at the door until it's sorted out through Etsy.",
      ])}
    </div>`;
}

/** The Tokens tab: where they are, how they are earned, how they are used. */
function tokensRules() {
  const box = (title, bullets) => ruleBox(title, { bullets });
  return `
    <div class="ruleboxes">
      ${box("\u{1F4CD} Where to find them", [
        "Open your <b>Profile</b> and pick <b>\u26A1 Token shop</b>. It shows one arsenal per game \u2014 Word-Cross, Battleship, Minesweeper, Golf and Casino \u2014 with how many tokens each sells and how many you hold.",
        "Tap a game and its arsenal opens in a window: that game's <b>1.5\u00d7 boost</b> first, then anything else it sells. Buy from there.",
        "Inside a game, the <b>\u26A1 Apply Token</b> button (top bar in every game, header on the golf page) lists that game's tokens you hold.",
      ])}
      ${box("\u{1F4B0} How they are earned", [
        "Tokens cost <b>casino money</b>, never real money. Nothing in the game is bought with real money.",
        "Casino money comes from the floor: solve arcade puzzles under <b>Earn Money</b> ($5\u201315 each), win hands at the tables, collect on horse races.",
        "Winnings sit on the table until you <b>Officially end match</b>; only then do they bank to your wallet. Quitting the floor forfeits what's on the table.",
        "The wallet you see in the Token shop is that banked money. A boost costs $200; the arsenals run from $143 to $50,000.",
      ])}
      ${box("\u26A1 How a boost is used", [
        "A token does nothing until you apply it. In the game, press <b>\u26A1 Apply Token</b> and apply the boost to the match you're in.",
        "An applied boost pays <b>1.5\u00d7 the MMR</b> when that round is scored, without touching the in-game score. The round that uses it spends it.",
        "The Casino boost is spent the moment it's applied and boosts <b>every casino win for the rest of the day</b> (UTC). The daily cap still stands.",
        "The feed marks a boosted win with \u26A1.",
      ])}
      ${box("\u26A1 Tokens and the record books", [
        "A round that fires a token is a <b>token-assisted</b> round, and the record books mark it with \u26A1. Nothing is kept off a board for using one \u2014 the figure stands, and the mark only says how it was set.",
        "<b>Fastest Clears</b> (Minesweeper, per level) marks the time. <b>Course records</b> (Golf) keep two marks for each player \u2014 the best card played clean and the best played with tokens \u2014 and show the lower of the two, marked if it took a token.",
        "<b>Highest single round</b> marks its holder if that round used one, and the Battleship tallies say how many of the rounds behind them did.",
        "The <b>1.5\u00d7 boost</b> is not an assist: it pays more for a round, it does not play it for you.",
      ])}
      ${box("\u{1F3B0} The Casino Arsenal", [
        "Eighteen tokens for the floor, priced in casino money. Arm them under <b>\u26A1 Apply Token</b>; fire them from the Arsenal strip above the floor. Each is capped per session, and a casino token is spent the moment it is used \u2014 there is no round to settle up at the end of.",
        "<b>Not one of them hands you cash.</b> Table money banks to your wallet one for one, so a token that paid cash would be a money pump. These give chips, odds, sight and MMR instead.",
        "<b>Chip Run</b> ($2,000, 2): five table tokens. <b>Comp Pass</b> ($900, 1): the card room takes you without one for the rest of the day.",
        "<b>Blackjack Safety</b> ($600, 4): a losing hand costs no table token. <b>Insurance Policy</b> ($2,500, 2): a losing hand gives your stake back. <b>Dealer's Off Day</b> ($1,100, 3): a push pays as a win.",
        "<b>Peek</b> ($1,800, 2): shows the dealer's hole card. <b>Second Deal</b> ($1,200, 3): re-deals your opening two. <b>Tip the Dealer</b> ($800, 4): swaps one card for the next in the shoe. <b>Card Counter</b> ($1,400, 3): names the tens and aces left. <b>Fresh Shoe</b> ($400, 3): six new decks, between hands.",
        "<b>Photo Finish</b> ($1,500, 3): a horse of yours that comes third pays as if it came second. <b>Scratch the Bet</b> ($1,000, 3): pulls a bet off the board, stake returned, even after the off. <b>Extra Furlong</b> ($2,200, 2): a horse you name starts a step up, called before the off. <b>Bet Doubler</b> ($3,000, 2): your next winning bet pays twice.",
        "<b>Flashcards</b> ($1,600, 2): your next three arcade puzzles pay double cash. <b>Extra Credit</b> ($2,400, 2): your next puzzle pays the full 50 MMR whatever the clock says. <b>Raise the Cap</b> ($4,000, 1): today's 100 MMR ceiling becomes 150.",
        "<b>Night Deposit</b> ($2,000, 2): banks what is on your table without ending your session \u2014 leave the table and settle any bet first.",
        "Extra Credit and Raise the Cap lift MMR directly; everything else changes the game, not the ladder.",
      ])}
      ${box("\u{1F520} The Word-Cross Arsenal", [
        "Eighteen tokens, priced in casino money. Arm them under <b>\u26A1 Apply Token</b>; fire them from the Arsenal strip above the grid. Each is capped per round; only what you use is spent, and the rest stays armed for the next round in that dojo.",
        "<b>Free Letter</b> ($300, 8): shows one letter of the entry you are on. <b>Word Shape</b> ($500, 5): its first and last. <b>First Letters</b> ($1,200, 2): the opening letter of every entry left.",
        "<b>Anagram Sheet</b> ($800, 4): that entry's letters, scrambled. <b>Spellcheck</b> ($900, 4): marks what you have typed, letter by letter \u2014 right letter right place, right letter wrong place.",
        "<b>Sensei's Eye</b> ($600, 3): names the unsolved entry that crosses the most others. <b>Theme Reading</b> ($200, 2): names the scroll.",
        "<b>Random Gift</b> ($1,500, 4) solves one entry for you; <b>Shortest Straw</b> ($1,200, 3) takes the shortest; <b>Free Word</b> ($2,500, 3) takes the one you point at; <b>Last Word</b> ($900, 2) closes the grid when one is left.",
        "<b>Cascade</b> ($4,000, 1): solves the entry you point at, then every entry its crossings complete \u2014 which on a tight grid can be most of what is left.",
        "<b>Head Start</b> ($1,000, 3): your clock reads 45 seconds earlier when the round is scored. <b>Perfect Ink</b> ($3,000, 1): finish, and the round scores no lower than 75. <b>Double Ink</b> ($2,600, 2): \u00d71.25 on the score. <b>Salvage</b> ($1,400, 2): a round you do not finish scores as if you had solved two more.",
        "<b>Fast Hands</b> ($400, 2): the typing rate limit is lifted for the round. <b>Quiet Grid</b> ($700, 3): the field stops seeing you close.",
        "Those last four change what the round is worth, so they lift your MMR.",
      ])}
      ${box("\u2622\uFE0F The Battleship Arsenal", [
        "Eighteen tokens, priced in casino money: Nuke Missile ($50,000), Extra Shots ($2,500), Extra Ships ($500), Tactical Air Strike ($3,500), Air Strike Defence ($4,000), Air Strike Reveal ($1,300) and Submarine Torpedo ($143), and the nine below.",
        "Inside a battle, open <b>\u26A1 Apply Token</b> to <b>arm</b> them: at most <b>six</b> tokens a battle, and at most <b>two</b> nukes. Armed tokens appear on the <b>Arsenal strip</b> above the target list; that is where they are fired.",
        "Only what you fire is spent. Anything armed and unused goes back to your pile when the battle is recorded.",
        "<b>Nuke:</b> takes your turn. On Skirmish a hit sinks the whole ship it lands on. On Fleet Action it blasts 3\u00d73; on Open Ocean, 7\u00d77.",
        "<b>Extra Shots:</b> +2 on Skirmish, +4 on Fleet Action, +6 on Open Ocean, for the one turn you call it \u2014 spread over captains like any volley.",
        "<b>Extra Ships:</b> three more hulls of your choosing, any chart. Arm before you place your fleet.",
        "<b>Tactical Air Strike:</b> takes your turn. A 6\u00d76 blast anchored where you point, on any chart, so long as one of your carriers is afloat.",
        "<b>Air Strike Defence:</b> a hidden 6\u00d76 area of your own water. Strike squares inside it do nothing; the defence then shows and is spent. It does not stop a nuke.",
        "<b>Air Strike Reveal:</b> shows you one captain's defence, if they have one, so a strike isn't wasted on it.",
        "<b>Submarine Torpedo:</b> one extra single-square shot on your turn, on top of your volley, while your submarine is afloat.",
        "<b>Sonar Ping</b> ($900, 4): names how many ship squares sit in the 3\u00d73 you point at, without firing. <b>Radar Sweep</b> ($1,500, 3): the same for a whole row or column.",
        "<b>Spotter Plane</b> ($1,200, 3): pinpoints one square of a ship still afloat. <b>Periscope</b> ($700, 3): names which ships a captain still has, and their lengths.",
        "<b>Depth Charge</b> ($2,000, 3): takes your turn \u2014 a five-square cross, the square you pick and the four beside it.",
        "<b>Priority Target</b> ($1,000, 3): the rotation is lifted for one turn, so you may fire at anyone, even the captain you just hit.",
        "<b>Point Defence</b> ($1,600, 3): the next shot that would hit you is turned aside and reads as a miss.",
        "<b>Repair Crew</b> ($3,000, 2): takes one hit off your most damaged ship, and that square reads as open water again.",
        "<b>Reinforced Hull</b> ($2,600, 2): your largest unhurt ship turns the first shell aside \u2014 the water stays unmarked, and she needs one more shot than her length.",
        "<b>Evasive Maneuvers</b> ($2,200, 2): moves your largest unhit ship to a new berth. Shots that missed her old one mean nothing now.",
        "<b>Smoke Screen</b> ($4,500, 1): for a full round of turns every hit on your water is reported to the shooter as a miss. When it clears, the hits appear where they always were.",
        "Blast hits count for score and sinkings, but not toward your accuracy bonus. Computer captains never carry tokens. The host can switch the arsenal off for a battle.",
      ])}
      ${box("⛳ The Golf Arsenal", [
        "Eighteen tokens, armed under <b>\u26A1 Apply Token</b> and fired from the Arsenal strip above the hole. Each is capped per round; only what you use is spent, and the rest stays armed for the next round in that room.",
        "<b>Mulligan</b> ($800, 3): takes one stroke back off the hole you are on.",
        "<b>Caddie's Hint</b> ($400, 5): places one letter of the word you are on. <b>Local Knowledge</b> ($600, 4): places the first and last.",
        "<b>Range Finder</b> ($600, 3): buys the clue early on the hard tees, where it is withheld until two words are behind you.",
        "<b>Ground Under Repair</b> ($900, 3): the next word you fail costs one stroke instead of two \u2014 and on the forward tees a blown hole is par+1 rather than par+3.",
        "<b>Gimme</b> ($2,500, 2): concedes the hole you are on at par and moves you along.",
        "<b>Practice Swing</b> ($500, 5): your next guess costs no stroke and eats no guess. <b>Extra Club</b> ($500, 4): two more guesses on this word.",
        "<b>Club Fitting</b> ($700, 3): swaps the word for another of the same length. <b>Drop Zone</b> ($1,200, 2): the word starts again and the strokes it cost come off.",
        "<b>Lucky Bounce</b> ($1,800, 2): the hole you are on scores no worse than par.",
        "<b>Preferred Lies</b> ($1,500, 2): the next hole is played from one tee forward \u2014 fewer words, at that tee's par.",
        "<b>Double Down</b> ($1,000, 3): declared on the tee before you swing \u2014 par or better doubles the hole's points, worse halves them.",
        "<b>Eagle Eye</b> ($2,000, 2): your next hole under par pays double. <b>Ace Chaser</b> ($2,800, 2): your next hole in one pays 150 instead of 100.",
        "<b>Scorecard Pencil</b> ($3,000, 1): your worst hole comes off the card when the round is scored.",
        "<b>Wind Gauge</b> ($2,200, 2): shows the dealt letters in their right order for two seconds. <b>Caddie's Book</b> ($900, 2): reads you the clues for the next three holes.",
      ])}
      ${box("💣 The Minesweeper Arsenal", [
        "Eighteen tokens, priced in casino money. Arm them under <b>⚡ Apply Token</b>; fire them from the Arsenal strip above the field. Each is capped per round; only what you use is spent, and the rest stays armed for the next round.",
        "<b>Mine Reveal:</b> shows two of the field's mines on your board, marked so you can't dig them. Any field. Two a round.",
        "<b>Mine Buster:</b> pick a square. A mine there is destroyed — for you only; the numbers around it drop and the square opens. Clean ground just opens. Intermediate and Expert fields only. Five a round.",
        "<b>Clear Map:</b> only before you have dug anything yourself (the opening doesn't count). Opens a 5×5 around the square you pick. A mine inside it ends your sweep — unless you are invincible, in which case the mines are defused. One a round.",
        "<b>Invincibility:</b> for ten seconds a mine you dig is defused under your feet instead of ending you. Two a round.",
        "<b>Metal Detector</b> ($800, 5): names how many mines sit in the 3\u00d73 you point at, without opening it. <b>Radar Sweep</b> ($1,200, 4): the same for a whole row or column. <b>Quadrant Scan</b> ($600, 3): mine counts for the four quarters.",
        "<b>Spotter Drone</b> ($1,500, 3): opens the three safest unopened squares, numbers only. <b>Frontier Flags</b> ($2,400, 3): flags three mines that touch ground you have already opened.",
        "<b>Sapper's Gloves</b> ($4,500, 2): the next three mines you dig are defused, however long it takes. <b>Second Sweep</b> ($12,000, 1): one mine does not end you \u2014 your sweep carries on from where it stood.",
        "<b>Recon Patrol</b> ($3,200, 3): opens a 3\u00d73 and flags any mine inside rather than triggering it. <b>Demolition Charge</b> ($2,500, 2): destroys the three mines nearest the square you pick.",
        "<b>Lucky Opening</b> ($1,000, 1): before your first dig, opens the biggest clearing on the field. <b>Chord</b> ($300, 8): opens everything around a number whose flags already match it \u2014 with the same risk as doing it by hand.",
        "<b>Stopwatch</b> ($2,000, 3): thirty seconds off your clear time when the round is scored. <b>Hazard Pay</b> ($1,800, 2): a sweep ended by a mine scores as if you had uncovered 15% more. <b>Field Promotion</b> ($3,500, 1): your round is scored one level up.",
        "The last three change what the round is worth, so they lift your MMR and can reach the Fastest Clears board.",
        "A defused or busted mine leaves a crater on your board and counts as ground to clear; the shared field everyone else races on never changes.",
      ])}
    </div>`;
}

// ── the game modes ────────────────────────────────────────────────
//
// One entry per game: how it is played and how it scores. The Game Modes
// tab shows them as a grid; each opens over the rule book on its own.
const GAME_RULES = [
  {
    id: "crossword", icon: "\u{1F520}", name: "Word-Cross", players: "1 or more \u00b7 ranked", solo: "\u2713 SOLO TRAINING",
    play: [
      "<b>Solo Training \u2014 yes, you can play this alone.</b> One solver, the same grid, the same fifteen-minute clock, and it scores and pays MMR exactly as a match does. Switch it on in the host controls before you begin.",
      "The host (the <b>sensei</b>) picks a scroll \u2014 a ten-word crossword from the bank or one a player published \u2014 and begins the round. Everyone solves the same grid at once.",
      "Tap a clue or a square, type the word, and the arena checks it: a right answer locks in, a wrong one flashes. Every entry is checked on the server, never guessed on your phone.",
      "<b>Solo Training</b> is you against the clock on the same terms. <b>Rumble</b> is three or more solvers; placement counts.",
      "The round lasts <b>15 minutes</b>. Finish early and your time is your score; run out and what you solved still counts.",
    ],
    score: [
      "A full solve inside <b>45 seconds</b> scores 100; from there the score falls evenly to 1 at the fifteen-minute mark.",
      "That score is your base MMR gain, plus the challenge and completion bonuses from Match Rules. Only bank scrolls are ranked \u2014 a player's own scroll is played for fun.",
      "Fast solves and solo solves feed the Word-Cross banners and titles.",
    ],
  },
  {
    id: "battleship", icon: "\u2693", name: "Battleship Royale", players: "2 to 8 captains", solo: "\u2713 SOLO VS 1\u20135 AI",
    play: [
      "<b>Solo Match \u2014 yes, you can play this alone.</b> You against one to five computer captains at one difficulty, and it scores and pays MMR exactly as a battle between people does.",
      "Three charts: <b>Skirmish</b> (10\u00d710, 5 ships, 2 shots a turn), <b>Fleet Action</b> (15\u00d715, 7 ships, 4 shots) and <b>Open Ocean</b> (20\u00d720, 9 ships, 5 shots). The host picks before fleets are laid.",
      "Lay your fleet by hand or press Random. Turns go round the table; on yours, pick your squares on one or more captains' water and fire. Split the shots however you like \u2014 or all on one.",
      "<b>Rotation:</b> with more than three opponents you must fire at three others before coming back to the same captain, so nobody can be ganged up on. The AI obeys it too.",
      "A captain whose last ship goes down is out. Last afloat wins. <b>Solo Match</b> puts you against one to five computers at one difficulty; Hard ones split their fire.",
      "The host may hide names (everyone is Captain A, B, C) and may switch the <b>arsenal</b> off \u2014 eighteen tokens, from a Sonar Ping to a Smoke Screen, six armed a battle. Tokens are in the \u26A1 Tokens tab.",
    ],
    score: [
      "Hits and ships sunk, weighted by the chart, times an <b>accuracy bonus</b>: half your shots landing is par, sharper shooting pays up to 1.75\u00d7, spraying the water costs up to a quarter.",
      "Placement adds up to 30, surviving adds 20. Capped at 100, then into MMR like every game.",
      "Blast hits from the arsenal count for score and sinkings, not for accuracy.",
    ],
  },
  {
    id: "minesweeper", icon: "\u{1F4A3}", name: "Minesweeper", players: "1 or more \u00b7 a race", solo: "\u2713 SOLO SWEEP",
    play: [
      "<b>Solo Sweep \u2014 yes, you can play this alone.</b> One sweeper against the clock on the same field, scored and paid exactly as a race is.",
      "Three fields: <b>Beginner</b> (9\u00d79, 10 mines), <b>Intermediate</b> (16\u00d716, 40 mines) and <b>Expert</b> (16\u00d730, 99 mines). Everyone in the room sweeps the same field; the opening square is safe and already cleared.",
      "Tap to dig, long-press or right-click to flag. A number is how many mines touch that square. Dig a mine and your sweep ends where it stands.",
      "<b>Solo Sweep</b> is you against the clock. In a race the first to clear wins; the round caps at <b>10 minutes</b>.",
      "The <b>arsenal</b> — eighteen tokens, from a Metal Detector to a Second Sweep — is armed under ⚡ Apply Token and fired from the strip above the field. Rules in the ⚡ Tokens tab.",
    ],
    score: [
      "A cleared field scores 55 plus up to 45 for speed, weighted by the level (Intermediate \u00d71.15, Expert \u00d71.3).",
      "A field you didn't clear scores up to 55 for how much of it you uncovered, so a good run into a mine still pays.",
      "Fastest clears per level sit in Records.",
    ],
  },
  {
    id: "links", icon: "\u26F3", name: "Multiverse Golf", players: "1 or more \u00b7 18 holes", solo: "\u2713 SOLO ROUND",
    play: [
      "<b>Solo \u2014 yes, you can play this alone.</b> Eighteen holes on your own, chosen under Playing before you go to the tee, scored and paid exactly as a room is.",
      "Eighteen holes on one of six real courses \u2014 Augusta, Pebble Beach, St Andrews, Sawgrass, Royal Melbourne, Kiawah \u2014 or a random draw. Pick your tees and a dictionary (Webster 1828 or Modern).",
      "Each hole is a word: the letters are dealt scrambled with a clue. <b>Unscramble the letters to score a hole in one.</b> Every guess is a stroke; the ball moves down the fairway with each one.",
      "<b>Easy:</b> one word to hole out, the first letter shown, familiar words, no hazards. <b>Medium:</b> five words a hole, par 5, hazards live. <b>Hard:</b> eight words, par 8, one guess fewer, no clue until you've played two.",
      "Hole out and the ball flies to the pin; press <b>Ready for the next hole</b> when you are. Everyone moves at their own pace; the field table keeps score underneath.",
      "The <b>arsenal</b> \u2014 eighteen tokens, from a mulligan to a gimme \u2014 is armed under \u26A1 Apply Token and fired from the strip above the hole. Rules in the \u26A1 Tokens tab.",
    ],
    score: [
      "Points per hole against par: a hole in one is 100, an eagle 48, a birdie 30, par 18, a bogey 9, and a triple bogey 1.",
      "Your round's points, against the course's par total, become the round score that goes into MMR. Rounds under par and aces feed the golf banners; each course keeps its own record in Records.",
    ],
  },
  {
    id: "casino", icon: "\u{1F3B0}", name: "The Casino", players: "the whole arena \u00b7 one floor", solo: "\u2713 PLAY ALONE",
    play: [
      "<b>Yes, you can play this alone.</b> The floor is shared, but nothing on it needs anyone else \u2014 the arcade, the horse race and every table can be played on your own, for the same MMR.",
      "One shared floor. You walk in with <b>$100</b> and no table tokens; <b>Earn Money</b> opens the maths arcade, where every solved puzzle pays $5\u201315 to the table and a table token \u2014 and the quickest MMR in the arena.",
      "<b>Horse Race:</b> free to enter, cash wagers from 1:1 to 24:1, place a bet and start the race.",
      "<b>Table Card Games</b> open at $50 and 2 table tokens: blackjack, baccarat, roulette, Big Six, hold'em and more. Every table plays the same dealer.",
      "Winnings sit on the table. <b>Officially end match</b> banks them to your wallet; leaving any other way forfeits them.",
    ],
    score: [
      "Every hand or race you win pays <b>5 MMR</b>, up to <b>100 a day</b>. The arcade pays up to 50 MMR a puzzle by speed (see the Arena tab).",
      "Banked money buys the arena's tokens in your profile's Token shop.",
      "The <b>arsenal</b> \u2014 eighteen tokens, from a Comp Pass to a Night Deposit \u2014 is armed under \u26A1 Apply Token and fired from the strip above the floor. Rules in the \u26A1 Tokens tab.",
      "The full table rules \u2014 baccarat's third card, roulette's layout, the Big Six wheel \u2014 are under <b>Casino Game Rules</b> on the floor bar.",
    ],
  },
];

function openGameRules(id) {
  const g = GAME_RULES.find((x) => x.id === id);
  if (!g) return;
  const host = $("points-modal");
  host.hidden = false;
  host.innerHTML = `
    <div class="modal-back" data-close></div>
    <div class="modal-card game-rules-card">
      <div class="modal-head">
        <h2>${g.icon} ${g.name}</h2>
        <button class="modal-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <p class="panel-sub">${g.players}</p>
        ${ruleBox("How it is played", { bullets: g.play })}
        ${ruleBox("How it scores", { bullets: g.score })}
      </div>
    </div>`;
  host.querySelectorAll("[data-close]").forEach((n) => { n.onclick = () => { host.hidden = true; host.textContent = ""; }; });
}


// Header tabs open one drawer at a time; clicking an open one closes it.
const DRAWERS = [
  ["tab-create", "drawer-create"],
  ["tab-achv", "drawer-achv"],
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

// The phone's one button for everything but Create Match. Picking anything
// inside it closes it; so does tapping anywhere else.
const moreMenu = (open) => {
  const on = open ?? !$("more-menu").classList.contains("is-open");
  $("more-menu").classList.toggle("is-open", on);
  $("tab-more").classList.toggle("is-on", on);
  $("tab-more").setAttribute("aria-expanded", String(on));
};
$("tab-more").onclick = (e) => { e.stopPropagation(); moreMenu(); };
$("more-menu").addEventListener("click", () => moreMenu(false));
document.addEventListener("click", (e) => {
  if (!$("more-menu").contains(e.target) && !$("tab-more").contains(e.target)) moreMenu(false);
});

$("tab-achv").onclick = () => { achvTab = "earned"; if (drawer("drawer-achv")) drawAchievements(); };
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
$("tab-profile").onclick = () => { if (drawer("drawer-profile")) drawProfile("info"); };
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

// One tile per game: tap it and the room opens. Nothing to read first.
const GAME_ICONS = { crossword: "\u{1F520}", battleship: "\u2693", minesweeper: "\u{1F4A3}", casino: "\u{1F3B0}", links: "\u26F3" };

function drawCreate() {
  $("drawer-create").innerHTML = `
    <div class="modal-back" data-close></div>
    <div class="modal-card">
      <div class="modal-head">
        <h2>Create a match</h2>
        <button class="modal-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
      <div class="gamegrid">
        ${GAME_MODES.map((m) => m.available
          ? `<button class="gamepick" data-mode="${m.id}" data-kind="${m.kind}" data-game="${m.game || "crossword"}">
              <span class="gp-ico" aria-hidden="true">${GAME_ICONS[m.game || "crossword"] || "\u{1F3AE}"}</span>
              <span class="gp-name">${m.name}</span>
              <span class="gp-players">${m.players}</span>
            </button>`
          : `<div class="gamepick soon">
              <span class="gp-ico" aria-hidden="true">${GAME_ICONS[m.game || "crossword"] || "\u{1F3AE}"}</span>
              <span class="gp-name">${m.name}</span>
              <span class="gp-players">Coming soon</span>
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
  // New players need a key, so the invite sends them to the listing; until
  // there is one, it sends them to the door.
  const link = S.etsy || location.origin;
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
        <p class="panel-sub">${S.etsy ? "Point a phone camera at the code, or send the link. It goes to the Etsy listing \u2014 the order number is their key at the door." : "Point a phone camera at the code, or send the link."}</p>
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
      navigator.share({ title: "Omni Multiverse of Madness", text: S.etsy ? "Get a key and come and play." : "Come and play.", url: link }).catch(() => {});
  }
}

// ── records ───────────────────────────────────────────────────────
// Everything here is read from what the server already wrote: the leaderboard
// the Worker maintains, and the clear times the Minesweeper object banks in
// KV. Nothing is self-reported, so a record means what it says.
/**
 * The mark a record carries when a token had a hand in it. A boolean is one
 * entry set with help; a number is how many rounds of a lifetime tally used
 * one. The figure is never hidden or held back — this only says how.
 */
function asstTag(a) {
  if (a === true) return '<span class="rec-asst" title="Set with an arsenal token in hand">\u26A1</span>';
  if (typeof a === "number" && a > 0)
    return '<span class="rec-asst" title="' + a + ' token-assisted round' + (a === 1 ? "" : "s") +
      ' in this tally">\u26A1' + a + '</span>';
  return "";
}
const ASSIST_LEGEND =
  '<p class="panel-sub rec-legend">\u26A1 marks a figure a token had a hand in. The record still stands \u2014 the mark only says how it was set.</p>';

async function loadRecords(tab = "arena") {
  const host = $("drawer-records");
  if (tab === "wallet") return drawWallet(host);
  if (tab === "bounty") return drawBountyRecords(host);
  if (tab === "battleship") return drawBattleshipRecords(host);
  if (tab === "golf") return drawGolfRecords(host);
  if (tab === "hof") return drawHallOfFame(host);
  host.innerHTML = `<div class="drawer-in"><div class="drawer-head"><h2>Records</h2></div><p class="panel-sub">Reading the books&hellip;</p></div>`;

  if (!standings.length) await loadRankings();
  let mines = {};
  try {
    const res = await fetch("/api/mines/scores");
    mines = (await res.json()).scores || {};
  } catch { mines = {}; }

  const best = (key) => [...standings].sort((a, z) => (z[key] || 0) - (a[key] || 0))[0];
  const holders = [
    ["Highest single round", best("best"), (r) => `${r.best} points`,
      (r) => asstTag(!!r.bestAsst && r.best <= r.bestAsst)],
    ["Most MMR banked", best("mmr"), (r) => `${r.mmr.toLocaleString()} MMR`],
    ["Most rounds played", best("rounds"), (r) => `${r.rounds} rounds`],
    ["Most prestiges", best("prestige"), (r) => (r.prestige ? `${r.prestige}\u00d7` : "none yet")],
  ].filter(([, r]) => r);

  const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const levels = [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["expert", "Expert"]];

  host.innerHTML = `
    <div class="drawer-in">
      <div class="drawer-head"><h2>Records</h2></div>
      ${recTabs("arena")}
      ${bounty?.holder ? `
        <div class="bounty-card claimed" style="margin-bottom:.9rem">
          <p class="bc-k">\u{1F3AF} The bounty</p>
          <p class="bc-line"><b>${escapeHtml(bounty.holder.name)}</b> wears the target</p>
          <p class="bc-sub">Mark to beat: ${bounty.holder.perHour}/hr &middot; ${bounty.holder.defends || 0} defence${(bounty.holder.defends || 0) === 1 ? "" : "s"}${bounty.holder.rotated ? " &middot; auto-rotated" : ""}</p>
        </div>` : ""}
      <p class="panel-sub">Held across the whole arena. Set by the games themselves, not self-reported.</p>
      ${ASSIST_LEGEND}

      <div class="rules-cols">
        <div class="rule-sec">
          <h3>Arena</h3>
          ${holders.length ? `<div class="belt-rows">${holders.map(([label, r, fmt, mark]) => `
            <div class="belt-row ${r.uid === S.user?.uid ? "is-mine" : ""}">
              <span class="bn">${label}</span>
              <span class="rec-who">${escapeHtml(r.name)}${mark ? mark(r) : ""}</span>
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
                  <span class="bn">${escapeHtml(r.name)}${asstTag(r.assisted === true)}</span>
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
            <li>Best maths arcade streak inside seven seconds.</li>
          </ul>
        </div>
      </div>
    </div>`;

  host.querySelectorAll("[data-rec]").forEach((b) => { b.onclick = () => loadRecords(b.dataset.rec); });
}

// ── the record books: battleship, golf, the hall of fame ─────────────
//
// All three read one public route, /api/records, which the reading room
// answers from the counters every finished round leaves on the board.

/** The subtab strip every Records page shares. */
function recTabs(on) {
  const tabs = [
    ["arena", "Records"], ["wallet", "\u{1F4B0} Wallets"], ["bounty", "\u{1F3AF} Bounty"],
    ["battleship", "⚓ Battleship"], ["golf", "⛳ Golf"], ["hof", "\u{1F3DB}️ Hall of Fame"],
  ];
  return `<div class="subtabs rec-tabs">${tabs.map(([id, name]) =>
    `<button class="stab ${on === id ? "is-on" : ""}" data-rec="${id}">${name}</button>`).join("")}</div>`;
}

async function readRecordBooks() {
  try {
    const res = await fetch("/api/records");
    return await res.json();
  } catch { return null; }
}

const topFive = (rows, fmt) => rows?.length
  ? `<div class="belt-rows">${rows.map((r, i) => `
      <div class="belt-row ${r.uid === S.user?.uid ? "is-mine" : ""}">
        <span class="rec-rank">${i + 1}</span>
        <span class="bn">${escapeHtml(r.name)}${asstTag(r.assisted)}</span>
        <span class="bt">${fmt(r.value)}</span>
      </div>`).join("")}</div>`
  : `<p class="panel-sub">Nobody has set this yet.</p>`;

async function drawBattleshipRecords(host) {
  clearInterval(walletPoll);
  host.innerHTML = `<div class="drawer-in"><div class="drawer-head"><h2>Records</h2></div>${recTabs("battleship")}<p class="panel-sub">Reading the log&hellip;</p></div>`;
  const books = await readRecordBooks();
  const b = books?.battleship || {};
  host.innerHTML = `
    <div class="drawer-in">
      <div class="drawer-head"><h2>⚓ Battleship</h2></div>
      ${recTabs("battleship")}
      <p class="panel-sub">Lifetime tallies, kept by the games themselves.</p>
      <p class="panel-sub rec-legend">\u26A1 counts the rounds behind a tally that fired an arsenal token.</p>
      <div class="rules-cols">
        <div class="rule-sec"><h3>Most hits</h3>${topFive(b.hits, (v) => `${v.toLocaleString()} hits`)}</div>
        <div class="rule-sec"><h3>Most ships sunk</h3>${topFive(b.sunk, (v) => `${v.toLocaleString()} sunk`)}</div>
        <div class="rule-sec"><h3>Most captains eliminated</h3>${topFive(b.eliminated, (v) => `${v.toLocaleString()} eliminated`)}</div>
      </div>
    </div>`;
  host.querySelectorAll("[data-rec]").forEach((x) => { x.onclick = () => loadRecords(x.dataset.rec); });
}

const toParText = (v) => (v === 0 ? "E" : v > 0 ? `+${v}` : String(v));

async function drawGolfRecords(host) {
  clearInterval(walletPoll);
  host.innerHTML = `<div class="drawer-in"><div class="drawer-head"><h2>Records</h2></div>${recTabs("golf")}<p class="panel-sub">Reading the cards&hellip;</p></div>`;
  const [books, courseRes] = await Promise.all([
    readRecordBooks(),
    fetch("/api/links/courses").then((r) => r.json()).catch(() => ({ courses: [] })),
  ]);
  const courses = courseRes.courses || [];
  const golf = books?.golf || {};
  host.innerHTML = `
    <div class="drawer-in">
      <div class="drawer-head"><h2>⛳ Golf</h2></div>
      ${recTabs("golf")}
      <p class="panel-sub">Course records: the five best rounds to par on each course. Tap a course.</p>
      ${ASSIST_LEGEND}
      <div class="course-tiles">
        ${courses.map((c) => {
          const rows = golf[c.id] || [];
          return `
            <button class="course-tile" data-course="${c.id}">
              <span class="ct-ico">${c.ico}</span>
              <span class="ct-name">${escapeHtml(c.name)}</span>
              <span class="ct-sub">${escapeHtml(c.loc)} · par ${c.par}</span>
              <span class="ct-rec">${rows.length ? `Record ${toParText(rows[0].value)}${rows[0].assisted ? " \u26A1" : ""} · ${escapeHtml(rows[0].name)}` : "No record yet"}</span>
            </button>`;
        }).join("")}
      </div>
    </div>`;
  host.querySelectorAll("[data-rec]").forEach((x) => { x.onclick = () => loadRecords(x.dataset.rec); });
  host.querySelectorAll("[data-course]").forEach((b) => {
    b.onclick = () => {
      const c = courses.find((x) => x.id === b.dataset.course);
      const modal = $("avatar-modal");
      modal.hidden = false;
      modal.innerHTML = `
        <div class="modal-back" data-close></div>
        <div class="modal-card course-card">
          <div class="modal-head">
            <h2>${c.ico} ${escapeHtml(c.name)}</h2>
            <button class="modal-close" data-close aria-label="Close">&times;</button>
          </div>
          <div class="modal-body">
            <p class="panel-sub">${escapeHtml(c.sub)} · ${escapeHtml(c.loc)} · par ${c.par}</p>
            <h3 class="rec-h">Best rounds to par</h3>
            ${topFive(golf[c.id], toParText)}
          </div>
        </div>`;
      modal.querySelectorAll("[data-close]").forEach((n) => { n.onclick = () => { modal.hidden = true; modal.textContent = ""; }; });
    };
  });
}

async function drawHallOfFame(host) {
  clearInterval(walletPoll);
  host.innerHTML = `<div class="drawer-in"><div class="drawer-head"><h2>Records</h2></div>${recTabs("hof")}<p class="panel-sub">Opening the hall&hellip;</p></div>`;
  const books = await readRecordBooks();
  const hof = books?.hallOfFame || { rows: [] };
  const when = (t) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  host.innerHTML = `
    <div class="drawer-in">
      <div class="drawer-head"><h2>\u{1F3DB}️ Hall of Fame</h2></div>
      ${recTabs("hof")}
      <p class="hof-note">Updates every 3 months · cut ${when(hof.at)} · next ${when(hof.next)}</p>
      ${hof.rows.length ? `<div class="belt-rows hof-rows">${hof.rows.map((r, i) => `
        <div class="belt-row ${r.uid === S.user?.uid ? "is-mine" : ""}">
          <span class="rec-rank">${i + 1}</span>
          <span class="bn">${escapeHtml(r.name)}${r.prestige ? `<span class="rank-tag">${rankSvg(r.branch || 0, r.prestige)}<span>${rankLabel(r.branch || 0, r.prestige)}</span></span>` : ""}${medalSvg(r.retired || 0)}</span>
          <span class="bt">${r.prestige ? `P${r.prestige} · ` : ""}${r.mmr.toLocaleString()} MMR</span>
        </div>`).join("")}</div>`
        : `<p class="panel-sub">The hall is empty until the first cut.</p>`}
    </div>`;
  host.querySelectorAll("[data-rec]").forEach((x) => { x.onclick = () => loadRecords(x.dataset.rec); });
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
      ${recTabs("bounty")}
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
      ${recTabs("wallet")}

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
    if (document.hidden) return;
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
  // On a phone the tab is behind one button, which pulses in its place.
  $("tab-more")?.classList.toggle("pulse", n > 0);
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

const KIND_PIP = { game: "\u{1F3C6}", prestige: "\u2B50", retire: "\u{1F396}\uFE0F", award: "\u{1F396}\uFE0F", note: "\u{1F4E3}" };

function ago(iso) {
  if (!iso) return "";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// A promotion is news. The feed tab pulses yellow from the moment someone
// prestiges until the feed has been opened and seen, the way the chat tab
// does for a line you have not read. Only promotions do this: a finished
// game every few minutes would keep the tab lit all day.
const FEED_SEEN_KEY = "omni.feed.seen";
let feedSeen = 0;
try { feedSeen = Number(localStorage.getItem(FEED_SEEN_KEY) || 0); } catch { /* fine */ }

function feedInView() {
  return !document.hidden && commonsOpen() && commonsTab === "feed";
}

function markFeedRead(rows) {
  const newest = Math.max(feedSeen, ...rows.map((r) => new Date(r.at).getTime() || 0));
  feedSeen = newest;
  try { localStorage.setItem(FEED_SEEN_KEY, String(newest)); } catch { /* fine */ }
  $("ct-feed")?.classList.remove("unread");
}

async function loadFeed() {
  const host = $("commons-feed");
  if (!host) return;
  let rows = [];
  try {
    const res = await fetch("/api/feed");
    rows = (await res.json()).feed || [];
  } catch { rows = null; }

  if (rows) {
    const promoted = rows.filter((r) => r.kind === "prestige" || r.kind === "retire");
    const newest = Math.max(0, ...promoted.map((r) => new Date(r.at).getTime() || 0));
    if (feedInView()) markFeedRead(rows);
    else if (newest > feedSeen) $("ct-feed")?.classList.add("unread");
  }

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
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      say("home-error", out.error || "That line was refused.");
      if (out.barred) askStanding();
    }
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

  // Nothing is fetched while the panel is closed; there is nothing to show
  // it in. Nor while the tab is hidden: the return is caught below.
  clearInterval(commonsPoll);
  commonsPoll = setInterval(() => {
    if (document.hidden) return;
    loadChat();                                       // always: they own the unread marks
    loadFeed();
  }, 15_000);
  loadChat();
  loadFeed();
}

// Coming back to the tab after a while, the first thing you see should be
// current rather than whatever the last poll caught before you left. Bound
// once: bound in startCommons, every return to the home screen stacked
// another copy, and each tab-focus fetched the chat that many times.
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !rankPoll) return;
  loadRankings();
  loadChat();
  loadFeed();
});

// ── profile ───────────────────────────────────────────────────────
/** Everything about the player lives here: rank, prestige, name, invite, exit. */
function profileSummary() {
  const me = standings.find((r) => r.uid === S.user?.uid);
  const mmr = me?.mmr ?? 0;
  const [, name, hex] = belt(mmr);
  const p = me?.prestige || 0;
  return `
    <div class="pf-summary">
      <span class="pf-face">${framedHtml(avatarHtml(S.avatar, 54, giSvg), S.frame, 54, true)}</span>
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

// ── the token shop ───────────────────────────────────────────────────
//
// Casino money buys boost tokens: one per game, each worth half again on
// the MMR of a round of that game (the casino's boosts every win for a
// day). Applied from the Apply Token tab inside the game; the list of them
// lives in boost.js so the shop and the tab agree.

/** One line of an arsenal window. */
function shopRow(t, held) {
  return `
    <div class="shop-item">
      <span class="shop-ico">${t.icon}</span>
      <div class="shop-txt">
        <div class="shop-name">${t.name}</div>
        <div class="shop-blurb">${t.blurb}</div>
        <div class="shop-have" id="have-${t.key}">${held ? `You hold ${held}` : "None held"}</div>
      </div>
      <button class="btn btn-primary btn-small" data-buy="${t.key}">Buy \u00b7 $${t.price.toLocaleString()}</button>
    </div>`;
}

/** The wallet, read live; the figure already shown stands if the arena is out of reach. */
async function refreshWallet() {
  try {
    const res = await fetch("/api/wallet", { headers: { Authorization: `Bearer ${await idToken()}` } });
    const wallet = (await res.json()).wallet;
    if (typeof wallet === "number") S.purse = { ...(S.purse || {}), wallet };
  } catch { /* the figure we had stands */ }
  document.querySelectorAll(".shop-wallet b").forEach((n) => { n.textContent = `$${(S.purse?.wallet ?? 0).toLocaleString()}`; });
}

// The shop: one card per game. Each opens that game's arsenal in its own
// window — its 1.5\u00d7 boost and whatever else it sells — so nobody
// scrolls a list of everything to find one thing.
async function drawShop(body) {
  const me = standings.find((r) => r.uid === S.user?.uid);
  const tokens = me?.tokens || {};
  const heldIn = (a) => a.items.reduce((n, t) => n + (tokens[t.key] || 0), 0);
  body.innerHTML = `
    <p class="panel-sub">Casino money buys tokens, one arsenal per game. Inside a game, press <b>\u26A1 Apply Token</b> to use what you hold.</p>
    <div class="shop-wallet">\u{1F4B0} Wallet: <b>$${(S.purse?.wallet ?? 0).toLocaleString()}</b></div>
    <div class="gamegrid shop-games">
      ${GAME_ARSENALS.map((a) => `
        <button class="gamepick" data-arsenal="${a.game}">
          <span class="gp-ico">${a.icon}</span>
          <span class="gp-name">${a.name}</span>
          <span class="gp-players">${a.items.length} token${a.items.length === 1 ? "" : "s"}${heldIn(a) ? ` \u00b7 you hold ${heldIn(a)}` : ""}</span>
        </button>`).join("")}
    </div>`;
  body.querySelectorAll("[data-arsenal]").forEach((b) => { b.onclick = () => drawArsenalShop(b.dataset.arsenal); });
  refreshWallet();
}

function drawArsenalShop(game) {
  const a = GAME_ARSENALS.find((x) => x.game === game);
  if (!a) return;
  const me = standings.find((r) => r.uid === S.user?.uid);
  const tokens = me?.tokens || {};
  const host = $("avatar-modal");
  host.hidden = false;
  host.innerHTML = `
    <div class="modal-back" data-close></div>
    <div class="modal-card shop-card">
      <div class="modal-head">
        <h2>${a.icon} ${a.name}</h2>
        <button class="modal-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="shop-wallet">\u{1F4B0} Wallet: <b>$${(S.purse?.wallet ?? 0).toLocaleString()}</b></div>
        ${game === "battleship" ? `<p class="panel-sub">Armed in a battle under Apply Token \u2014 four a battle, two nukes at most \u2014 and fired from the Arsenal strip. Only what you use is spent.</p>` : ""}
        <div class="shop-items">${a.items.map((t) => shopRow(t, tokens[t.key])).join("")}</div>
        <p id="shop-status" class="notice" hidden></p>
      </div>
    </div>`;
  const close = () => { host.hidden = true; host.textContent = ""; drawProfile("shop"); };
  host.querySelectorAll("[data-close]").forEach((n) => { n.onclick = close; });
  refreshWallet();
  host.querySelectorAll("[data-buy]").forEach((b) => {
    b.onclick = async () => {
      const key = b.dataset.buy;
      const item = shopItem(key);
      if (!window.confirm(`Buy a ${item.name} for $${item.price.toLocaleString()} from your wallet?`)) return;
      b.disabled = true;
      try {
        const res = await fetch("/api/shop/buy", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
          body: JSON.stringify({ game: key }),
        });
        const out = await res.json();
        if (out.ok) {
          S.purse = { ...(S.purse || {}), wallet: out.wallet };
          document.querySelectorAll(".shop-wallet b").forEach((n) => { n.textContent = `$${out.wallet.toLocaleString()}`; });
          $(`have-${key}`).textContent = `You hold ${out.tokens ?? "?"}`;
          say("shop-status", `${item.name} bought. In the game, press \u26A1 Apply Token to use it.`, false);
          loadRankings();
        } else {
          say("shop-status", out.error || "The shop could not sell that.");
        }
      } catch { say("shop-status", "Couldn't reach the shop. Try again."); }
      b.disabled = false;
    };
  });
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
          <button class="stab ${tab === "info" ? "is-on" : ""}" data-tab="info">Info</button>
        <button class="stab ${tab === "theme" ? "is-on" : ""}" data-tab="theme">Theme</button>
        <button class="stab ${tab === "shop" ? "is-on" : ""}" data-tab="shop">\u26A1 Token shop</button>
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
        if (b.dataset.theme === (document.documentElement.dataset.theme || savedTheme())) return;
        applyTheme(b.dataset.theme);
        saveProfile();
        drawProfile("theme");
      };
    });
    return;
  }

  if (tab === "shop") { drawShop(body); return; }

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
    if (next.slice(0, 24) === auth.currentUser.displayName) return say("pf-status", "That is your name already.", false);
    await updateProfile(auth.currentUser, { displayName: next.slice(0, 24) });
    saveProfile();
    render();
    say("pf-status", "Name saved.", false);
  };

  $("pf-save-pin").onclick = async () => {
    const oldPin = $("pf-old").value, newPin = $("pf-new").value;
    if (!/^\d{6}$/.test(oldPin) || !/^\d{6}$/.test(newPin))
      return say("pf-status", "Both pins are six digits.");
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
  // The chat poll goes with it: inside a game there is no panel to draw into.
  if (!on) { clearInterval(commonsPoll); commonsPoll = null; return; }
  // Every thirty seconds, quietly. A visible countdown told people to wait
  // for something that takes no waiting.
  loadRankings();
  rankPoll = setInterval(() => { if (!document.hidden) loadRankings(); }, 30_000);
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
  drawDojoArsenal();
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

// The Apply Token tab of the dojo. The room answers TOKENS; a scored round
// clears what was applied, so the light goes out with it.
const dojoTokens = applyTokenTab({ game: "crossword", send: sendMsg, button: $("btn-dojo-boost"), label: "round", arsenal: WORD_ARSENAL_ITEMS });

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
      sendMsg({ type: "TOKENS" });
      break;

    case "ROUND_RESUME":
      startRound(msg, msg.solved, msg.solvedLetters || {});
      break;

    case "CHECK_RESULT":
      if (msg.correct) { if (msg.gift) fillEntry(msg.entryId, msg.word); markSolved(msg.entryId); }
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
      dojoTokens.reset();
      break;

    case "TOKENS":
      dojoTokens.receive(msg);
      if (msg.arsenal) { S.ars = msg.arsenal; drawDojoArsenal(); }
      break;

    case "ARSENAL_STATE":
      S.ars = msg.arsenal;
      dojoTokens.arsenalState(msg.arsenal);
      paintArsenal();
      drawDojoArsenal();
      break;

    case "ARSENAL_NOTE":
      feed(escapeHtml(msg.text), true);
      say("dojo-error", msg.text);
      break;

    case "ARSENAL_ANAGRAM":
      feed(`<b>Anagram</b> — ${escapeHtml(msg.letters)}`, true);
      break;

    case "ARSENAL_SPELL":
      showSpell(msg);
      break;

    case "ARSENAL_POINT":
      pointAt(msg.entryId);
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

// ── the arsenal ─────────────────────────────────────────────────────
//
// One button per armed token with uses left. The ones that work on an entry
// use whichever entry you are on; the rest fire where they stand.
function drawDojoArsenal() {
  const host = $("dojo-arsenal");
  if (!host) return;
  const a = S.ars;
  const left = (k) => (a?.armed?.[k] || 0) - (a?.used?.[k] || 0);
  const any = a && a.playing && WORD_ARSENAL_ITEMS.some((t) => left(t.key) > 0);
  host.hidden = !any;
  host.textContent = "";
  if (!any) return;

  host.append(el("span", "ars-label", "Arsenal"));
  for (const t of WORD_ARSENAL_ITEMS) {
    const n = left(t.key);
    if (n <= 0) continue;
    const on = (t.act === "perfect" && a.perfect) || (t.act === "fast" && a.fast) || (t.act === "quiet" && a.quiet);
    const off = on
      || (t.aim === "entry" && !S.cur)
      || (t.act === "last" && a.left !== 1);
    const short = t.name.replace("Sensei's ", "").replace(" Sheet", "").replace(" Reading", "");
    const b = el("button", "ars-btn" + (on ? " on" : ""), `${t.icon} ${short} \u00d7${n}`);
    b.type = "button";
    b.disabled = !!off;
    b.title = off && t.aim === "entry" ? "Pick an entry first" : t.blurb;
    b.onclick = () => {
      if (!window.confirm(`${t.name}? ${t.blurb}`)) return;
      const body = { type: "USE_TOKEN", action: t.act };
      if (t.aim === "entry") body.entryId = S.cur?.entryId;
      if (t.act === "spell") body.guess = typedWord(S.cur?.entryId);
      sendMsg(body);
    };
    host.append(b);
  }
  const flags = [];
  if (a.head) flags.push(`${Math.round(a.head / 1000)}s off the clock`);
  if (a.perfect) flags.push("Perfect Ink");
  if (a.double) flags.push(`Double Ink \u00d7${(1.25 ** a.double).toFixed(2)}`);
  if (a.salvage) flags.push(`Salvage +${a.salvage}`);
  if (a.fast) flags.push("Fast Hands");
  if (a.quiet) flags.push("Quiet Grid");
  if (flags.length) host.append(el("p", "ars-hint", flags.join(" \u00b7 ")));
  if (a.reports?.length)
    host.append(el("p", "ars-hint ars-intel", a.reports.map((x) => x.text).join("  \u00b7  ")));
}

/** What is typed in an entry right now, for the spellcheck. */
function typedWord(entryId) {
  if (!entryId || !S.entries.has(entryId)) return "";
  return entryCells(entryId).map((c) => c.input.value || "").join("");
}

/** Letters a token has shown, painted into the grid. */
function paintArsenal() {
  const shown = S.ars?.letters || {};
  for (const [entryId, letters] of Object.entries(shown)) {
    if (!S.entries.has(entryId)) continue;
    const cells = entryCells(entryId);
    for (const [i, ch] of Object.entries(letters)) {
      const cell = cells[Number(i)];
      if (!cell || cell.input.readOnly) continue;
      cell.input.value = ch;
      cell.box.classList.add("shown");
    }
  }
}

/** An entry a token solved outright: its letters go in before it locks. */
function fillEntry(entryId, word) {
  if (!S.entries.has(entryId)) return;
  entryCells(entryId).forEach((cell, i) => {
    if (word?.[i]) cell.input.value = word[i];
    cell.box.classList.add("gifted");
  });
}

function showSpell(msg) {
  const row = el("div", "wc-spell");
  [...msg.guess].forEach((ch, i) => row.append(el("span", msg.marks[i] || "no", ch)));
  const host = $("clue-bar") || $("grid-wrap");
  feed("<b>Spellcheck</b> — " + [...msg.guess].map((ch, i) =>
    msg.marks[i] === "right" ? `<b>${escapeHtml(ch)}</b>` : msg.marks[i] === "near" ? `<i>${escapeHtml(ch)}</i>` : escapeHtml(ch)).join(""), true);
  void host; void row;
}

/** The Sensei's Eye: light an entry up for a moment. */
function pointAt(entryId) {
  if (!S.entries.has(entryId)) return;
  const cells = entryCells(entryId);
  for (const c of cells) c.box.classList.add("pointed");
  setTimeout(() => { for (const c of cells) c.box.classList.remove("pointed"); }, 6000);
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
