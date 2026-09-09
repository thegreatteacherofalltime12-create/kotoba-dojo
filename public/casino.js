// The casino floor, client side.
//
// Everything that decides anything now lives in the Durable Object: the race,
// the bet board, the dealer, and every player's table money. This draws what
// it is told and sends what the player asks for. That is what makes the floor
// shared — one race, one board, everyone seeing the same cards turn.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
import { casinoRulesHtml, TABLE_GAMES, ROULETTE_UI, BIGSIX_UI, BACCARAT_BOARD,
  BIGSIX_WHEEL, BIGSIX_TONE } from "./game-modes.js";

const money = (n) => `$${Math.round(n || 0).toLocaleString()}`;

/** Bind a click, tolerating a control the page doesn't have. */
const on = (id, fn) => {
  const n = $(id);
  if (n) n.onclick = fn;
  else console.warn(`[casino] no #${id} on the page — is index.html cached?`);
};

export const K = {
  socket: null, idToken: null, onLeave: null,
  you: null, floor: null, mine: null,
  suits: [], bets: [], finish: 7, hurdles: 5,
  logLines: [],
  tab: "race",
  stake: 10,
  pairPlus: false,
  wheelBets: {},
  level: "medium",
  side: { fortune: false, aceBonus: false, bonus: false },
  lowPick: [],
  table: null,       // which card table is open over the floor, if any
  lastHand: null,    // the last hand to finish, for the card-room results bar
  slip: { type: "win", picks: [], stake: 10 },
  open: true,
  minimised: false,
};

/* ── connection ──────────────────────────────────────────────────────── */

export async function enterCasino(_purse, _save, onLeave, idToken) {
  K.idToken = idToken;
  K.onLeave = onLeave;
  K.open = true;
  K.tab = "race";
  K.minimised = false;
  K.logLines = [];
  await connect();
}

async function connect() {
  closeSocket();
  const token = await K.idToken();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/floor/ws?token=${encodeURIComponent(token)}`);
  K.socket = ws;
  ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch { /* ignore */ } };
  ws.onclose = () => { if (K.open) setTimeout(() => { if (K.open) connect(); }, 1500); };
}

function closeSocket() {
  if (K.socket) { K.socket.onclose = null; K.socket.close(); K.socket = null; }
}

export function leaveCasino() { K.open = false; closeSocket(); }

const send = (o) => { if (K.socket?.readyState === WebSocket.OPEN) K.socket.send(JSON.stringify(o)); };

function handle(msg) {
  switch (msg.type) {
    case "FLOOR_WELCOME":
      K.you = msg.you; K.horses = msg.horses; K.suits = msg.suits; K.bets = msg.bets;
      K.finish = msg.finish; K.hurdles = msg.hurdles;
      break;
    case "FLOOR_STATE": {
      const before = K.floor?.table?.phase;
      K.floor = msg.floor; K.mine = msg.you;
      // Hands are cleared a few seconds after they settle, so the result is
      // kept here or the card-room results bar would have nothing to show.
      if (before !== "SETTLED" && K.floor?.table?.phase === "SETTLED")
        K.lastHand = { at: Date.now(), seats: K.floor.table.seats.map((x) => ({ ...x })) };
      draw();
      break;
    }
    case "FLOOR_LOG": logLine(msg.entry); break;
    case "FLOOR_RESULT": showResult(msg); break;
    case "FLOOR_BANKED":
      window.alert(`${money(msg.amount)} banked to your wallet.`);
      if (K.bankAndLeave) { K.bankAndLeave = false; leaveCasino(); K.onLeave?.(); }
      break;
    case "TABLE_BLOCKED": showBlocked(msg); break;
    case "TABLE_HAND": showHand(msg); break;
    case "TABLE_RESULT": showTableResult(msg); break;
    case "FLOOR_ERROR": say(msg.message); break;
  }
}

function say(text) {
  // A table overlay covers the floor, so a message posted down there is a
  // message nobody reads. If a table is open it goes on the table.
  const inTable = $("tgame") || $("table-actions");
  if (inTable && !$("table-modal").hidden) {
    const bar = el("p", "notice notice-bad tsay", text);
    inTable.prepend(bar);
    setTimeout(() => bar.remove(), 4000);
    return;
  }
  const n = $("floor-sub");
  if (!n) return;
  const held = n.textContent;
  n.textContent = text;
  n.classList.add("bad");
  setTimeout(() => { n.textContent = held; n.classList.remove("bad"); }, 3500);
}

const PIPS = {
  hearts: { pip: "\u2665", name: "Hearts", red: true },
  diamonds: { pip: "\u2666", name: "Diamonds", red: true },
  clubs: { pip: "\u2663", name: "Clubs", red: false },
  spades: { pip: "\u2660", name: "Spades", red: false },
};
// The pips are known here as well as on the server, so a card is never drawn
// with a question mark on it just because a message hasn't landed yet.
const suit = (id) => (K.suits || []).find((s) => s.id === id)
  || PIPS[id] || { pip: "\u2022", name: id, red: false };
const horse = (id) => (K.horses || []).find((h) => h.id === id)
  || { pip: "\u2660", rank: "?", name: id, red: true };

/* ── controls ────────────────────────────────────────────────────────── */

export function bindCasino() {
  on("btn-casino-earn", openArcade);

  // The proper way out: bank first, then leave.
  on("btn-casino-bank", () => {
    const held = K.mine?.table || 0;
    if (!held) { leaveCasino(); K.onLeave?.(); return; }
    if (!window.confirm(`End your session and bank ${money(held)} to your wallet?`)) return;
    K.bankAndLeave = true;
    send({ type: "FLOOR_BANK" });
  });

  on("ft-race", () => { K.tab = "race"; draw(); });
  on("ft-tables", () => { K.tab = "tables"; draw(); });
  // The arrow folds the track away; it never leaves the floor.
  on("ft-min", () => { K.minimised = !K.minimised; draw(); });

  on("btn-floor-bet", openBetPicker);
  on("btn-casino-rules", openCasinoRules);
  on("btn-table-results", showTableResults);
  on("btn-wallet", openWallet);
  on("btn-chat", openChat);
  on("btn-floor-start", () => send({ type: "FLOOR_START" }));
  on("btn-floor-results", () => {
    const f = K.floor;
    if (!f?.race?.finished?.length) return say("No race has finished yet.");
    window.alert("Finish order: " + f.race.finished.map((id) => horse(id).name).join(", "));
  });
}

/* ── drawing ─────────────────────────────────────────────────────────── */

function draw() {
  const f = K.floor;
  if (!f) return;

  $("floor-cash").textContent = money(K.mine?.table);
  $("floor-tokens").textContent = String(K.mine?.tokens ?? 0);
  $("race-body").hidden = K.minimised;
  $("ft-min").textContent = K.minimised ? "\u25B2" : "\u25BC";
  $("ft-min").title = K.minimised ? "Show the race" : "Minimise the race";
  $("ft-race").classList.toggle("on", K.tab === "race");
  $("ft-tables").classList.toggle("on", K.tab === "tables");
  $("view-race").hidden = K.tab !== "race";
  $("view-tables").hidden = K.tab !== "tables";
  $("floor-title").innerHTML = K.tab === "race" ? "&#127943; Horse Race" : "&#127183; The Card Room";

  // Betting, the starter and the race results belong to the race. On the card
  // tables they are meaningless, so they leave rather than sit there greyed.
  const racing = K.tab === "race";
  $("btn-floor-bet").hidden = !racing;
  $("btn-floor-results").hidden = !racing;
  $("btn-floor-start").hidden = !racing;
  $("floor-banner").hidden = !racing;
  $("ft-min").hidden = !racing;
  $("btn-table-results").hidden = racing;

  if (racing) { drawBanner(f); drawTrack(f); drawHurdles(f); drawBoard(f); }
  else drawGameTabs();

  // A table that is open over the floor keeps redrawing behind the overlay.
  if (K.table === "blackjack" && !$("table-modal").hidden) drawTable(f);
}

function drawBanner(f) {
  const running = f.phase === "RUNNING";
  const start = $("btn-floor-start");
  start.disabled = running || !f.bets.length;
  start.innerHTML = running
    ? "&#127937; Race under way"
    : f.bets.length ? "&#127937; Start the race" : "&#127937; Place a bet to start";

  const b = $("floor-banner");
  b.classList.toggle("running", running);
  b.querySelector(".fb-k").innerHTML = running
    ? "&#127943; They're away" : f.phase === "PAID" ? "&#127942; Paid out" : "&#127943; Betting open";
  b.querySelector(".fb-l").textContent = running
    ? "No more bets"
    : f.phase === "PAID" ? "Next race opening" : "Place your bets \u2014 then START the race";
  $("floor-sub").textContent = f.bets.length
    ? `${f.bets.length} bet${f.bets.length === 1 ? "" : "s"} on the board`
    : "No bets yet";
}

function drawTrack(f) {
  const host = $("floor-track");
  host.textContent = "";
  const fav = f.race.favourite;

  // Said in words as well as marked on the card. A ribbon is easy to miss, and
  // which horse is fancied today is the most useful thing on the track.
  if (fav) {
    const h = horse(fav);
    const bar = el("p", "ftoday");
    bar.append(el("span", "ftoday-r", "\u{1F397}\uFE0F"));
    bar.append(el("span", "", `This week's favourite: ${h.rank}${h.pip} ${h.name}`));
    if (f.race.favouriteEndsAt) {
      const left = Math.max(0, f.race.favouriteEndsAt - Date.now());
      const days = Math.floor(left / 86_400_000);
      const hrs = Math.floor((left % 86_400_000) / 3600_000);
      bar.append(el("span", "ftoday-t", days
        ? `new favourite in ${days}d ${hrs}h`
        : `new favourite in ${hrs}h`));
    }
    host.append(bar);
  }

  for (const h of (K.horses || [])) {
    const lane = el("div", `flane${h.id === fav ? " favourite" : ""}`);

    const card = el("div", `fcard${h.red ? " red" : ""}${h.id === fav ? " ribboned" : ""}`);
    // The ribbon sits over the card, so the day's favourite is obvious from
    // across the room without reading anything.
    if (h.id === fav) card.append(el("span", "fribbon", "\u{1F397}\uFE0F"));
    card.append(el("span", "fc-r", h.rank));
    card.append(el("span", "fc-s", h.pip));
    card.title = h.id === fav ? `${h.name} \u2014 today's favourite` : h.name;
    lane.append(card);

    const rail = el("div", "frail");
    rail.style.setProperty("--steps", String(K.finish));
    for (let i = 0; i < K.finish; i++) {
      const cell = el("div", "fstep");
      if (f.race.at[h.id] === i) cell.append(el("span", "fhorse", "\u{1F434}"));
      rail.append(cell);
    }
    const home = el("div", "fstep ffinish");
    if (f.race.at[h.id] >= K.finish) home.append(el("span", "fhorse", "\u{1F434}"));
    else home.append(el("span", "fflag", "\u{1F3C1}"));
    rail.append(home);
    lane.append(rail);

    const place = f.race.finished.indexOf(h.id);
    if (place !== -1) lane.append(el("span", "fplace", ["1st", "2nd", "3rd", "4th"][place]));
    host.append(lane);
  }
}

function drawHurdles(f) {
  const host = $("floor-hurdles");
  host.textContent = "";

  // The card just turned, beside the traps waiting to turn. Face down until
  // the whole field is past them, exactly as they are dealt.
  const traps = f.race.traps || [];
  for (const t of traps) {
    const card = el("div", `fhurdle${t.turned ? " up red" : ""}`);
    if (t.turned) {
      card.append(el("span", "fh-r", t.rank));
      card.append(el("span", "fh-s", t.suit));
      card.title = `Trap ${t.at} turned \u2014 ${t.rank}${t.suit} dropped back a place`;
    } else {
      card.append(el("span", "fh-back", "\u{1F0A0}"));
      card.title = `Trap ${t.at}, face down until every runner is past it`;
    }
    host.append(card);
  }

  // The deck and the card off the top of it.
  const deck = $("floor-deck");
  if (deck) {
    deck.textContent = "";
    const back = el("div", "fdeck-card back");
    back.append(el("span", "fh-back", "\u{1F0A0}"));
    deck.append(back);

    const slot = el("div", "fdeck-slot");
    if (f.race.last) {
      const c = el("div", "fdeck-card up");
      c.append(el("span", "fh-r", f.race.last.rank));
      c.append(el("span", "fh-s", f.race.last.suit));
      slot.append(c);
    } else {
      slot.append(el("div", "fdeck-card empty"));
    }
    deck.append(slot);
  }
}

function drawBoard(f) {
  $("floor-pool").textContent = `pool ${money(f.pool)}`;
  const host = $("floor-board");
  host.textContent = "";
  if (!f.bets.length) {
    host.append(el("p", "fempty", "No bets placed yet."));
    return;
  }
  for (const b of f.bets) {
    const bet = K.bets.find((x) => x.id === b.type);
    const row = el("div", `fbrow${b.uid === K.you ? " mine" : ""}`);
    row.append(el("span", "fbr-who", b.name + (b.uid === K.you ? " (you)" : "")));
    row.append(el("span", "fbr-t", bet?.name || b.type));
    const pips = el("span", "fbr-p");
    b.picks.forEach((id) => {
      const h = horse(id);
      const n = el("span", "red");
      n.textContent = `${h.rank}${h.pip}`;
      pips.append(n);
    });
    row.append(pips);
    row.append(el("span", "fbr-s", money(b.stake)));
    if (b.uid !== K.you && f.phase === "BETTING") {
      const copy = el("button", "fmini", "Copy");
      copy.title = `Back the same slip with ${money(b.stake)} of your own`;
      copy.onclick = () => send({ type: "FLOOR_COPY", betId: b.id, stake: b.stake });
      row.append(copy);
    }
    host.append(row);
  }
}

/* ── the live table ──────────────────────────────────────────────────── */

/** A real playing card: corner indices and a centre pip, like the paper ones. */
function cardFace(c) {
  if (!c || c.hidden) {
    const b = el("div", "pcard back");
    b.append(el("span", "pc-weave"));
    return b;
  }
  if (c.joker) {
    const j = el("div", "pcard joker");
    j.append(corner("JKR", "\u{1F0CF}", "pc-tl"));
    j.append(el("span", "pc-mid", "\u{1F0CF}"));
    j.append(corner("JKR", "\u{1F0CF}", "pc-br"));
    return j;
  }
  const pip = suit(c.suit).pip;
  const d = el("div", `pcard${c.red ? " red" : ""}`);
  d.append(corner(c.rank, pip, "pc-tl"));
  d.append(el("span", "pc-mid", pip));
  d.append(corner(c.rank, pip, "pc-br"));
  return d;
}

function corner(rank, pip, where) {
  const n = el("span", `pc-i ${where}`);
  n.append(el("b", "", rank));
  n.append(el("i", "", pip));
  return n;
}

/**
 * A row of cards that only animates what's new.
 *
 * The floor pushes state on every change, so a hand redrawn wholesale would
 * re-deal itself several times a second. Each row remembers what it already
 * showed; those cards settle in place and only new ones fly in.
 */
const shown = new Map();

function handRow(cards, key, extra = "") {
  const row = el("div", `chand ${extra}`.trim());
  const before = shown.get(key) || new Set();
  const now = new Set();
  (cards || []).forEach((c, i) => {
    const id = !c ? `gap:${i}` : c.hidden ? `back:${i}` : `${c.rank}${c.suit}:${i}`;
    now.add(id);
    const node = cardFace(c);
    if (!before.has(id)) {
      node.classList.add("deal");
      node.style.setProperty("--i", String(i));
    }
    row.append(node);
  });
  shown.set(key, now);
  return row;
}

/**
 * Easy, Medium, Hard. Medium is the only one that deals the dealer a hand at
 * random; the other two let the house look at several and keep the worst or
 * the best, so the label is doing real work.
 */
function aiTabs(compact = false) {
  const row = el("div", `aitabs${compact ? " compact" : ""}`);
  for (const [id, name] of [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]]) {
    const b = el("button", `aitab${K.level === id ? " on" : ""}`, name);
    b.onclick = () => {
      K.level = id;
      [...row.children].forEach((n) => n.classList.toggle("on", n.textContent === name));
    };
    row.append(b);
  }
  return row;
}

/**
 * Ends the hand where it stands, forfeiting whatever is on it.
 *
 * Sits beside the difficulty tabs at Hold'em and at the top of every other
 * hand, so nobody is ever left waiting on a hand they have finished with.
 */
function endHandBtn() {
  const b = el("button", "endhand", "Forfeit hand");
  b.title = "Give the hand up now. Everything staked on it is lost.";
  b.onclick = () => {
    if (window.confirm(
      "Give this hand up? Everything staked on it is lost, and the token with it. "
      + "This is here for a hand that has gone wrong \u2014 it never beats playing on."
    )) send({ type: "TABLE_END" });
  };
  return b;
}

/* ── the Big Six wheel ────────────────────────────────────────────────
 *
 * Fifty-four wedges drawn once, then turned. The server still decides where it
 * stops — the wheel is told the answer and spins to it, rather than deciding
 * anything itself, so the animation can never disagree with the payout.
 */

const SEG = 360 / BIGSIX_WHEEL.length;
let wheelTurns = 0;   // kept so it always spins forwards, never back

const LABEL = { star: "\u2605", diamond: "\u25C6" };

function wedgePath(i) {
  const a0 = (i * SEG - 90) * Math.PI / 180;
  const a1 = ((i + 1) * SEG - 90) * Math.PI / 180;
  const r = 94;
  const x0 = 100 + r * Math.cos(a0), y0 = 100 + r * Math.sin(a0);
  const x1 = 100 + r * Math.cos(a1), y1 = 100 + r * Math.sin(a1);
  return `M100,100 L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
}

function wheelSvg(backed) {
  const on = backed instanceof Set ? backed : new Set(backed ? [backed] : []);
  const wedges = BIGSIX_WHEEL.map((sym, i) => {
    const mid = (i + 0.5) * SEG - 90;
    const rad = mid * Math.PI / 180;
    const lx = 100 + 74 * Math.cos(rad), ly = 100 + 74 * Math.sin(rad);
    return `
      <path d="${wedgePath(i)}" fill="${BIGSIX_TONE[sym]}"
            class="w6-seg${on.has(sym) ? " on" : ""}" />
      <text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}"
            transform="rotate(${(mid + 90).toFixed(2)} ${lx.toFixed(2)} ${ly.toFixed(2)})"
            class="w6-lab${sym === "star" || sym === "diamond" ? " big" : ""}">${LABEL[sym] || sym}</text>`;
  }).join("");

  return `
    <div class="w6-wrap">
      <div class="w6-point"></div>
      <svg viewBox="0 0 200 200" class="w6-svg" aria-hidden="true">
        <circle cx="100" cy="100" r="97" class="w6-rim" />
        <g id="w6-rotor" class="w6-rotor">${wedges}</g>
        <circle cx="100" cy="100" r="26" class="w6-hub" />
        <text x="100" y="104" class="w6-hub-t">BIG 6</text>
      </svg>
    </div>`;
}

/** Turns the wheel until the given symbol is under the pointer. */
function spinWheelTo(symbol) {
  return new Promise((resolve) => {
    const rotor = document.getElementById("w6-rotor");
    if (!rotor) { resolve(); return; }

    // Any wedge bearing that symbol will do; picking at random keeps the same
    // result from looking identical twice running.
    const seats = BIGSIX_WHEEL.map((s, i) => (s === symbol ? i : -1)).filter((i) => i >= 0);
    const seat = seats[Math.floor(Math.random() * seats.length)] ?? 0;
    const centre = (seat + 0.5) * SEG;

    wheelTurns += 5 + Math.floor(Math.random() * 3);
    const target = wheelTurns * 360 - centre;

    rotor.style.transition = "transform 4.2s cubic-bezier(.15,.7,.15,1)";
    rotor.style.transform = `rotate(${target}deg)`;
    setTimeout(resolve, 4400);
  });
}

/** A labelled band of felt. */
function zone(label, body) {
  const z = el("div", "tzone");
  z.append(el("p", "tzone-l", label));
  z.append(body);
  return z;
}

/** Forget what was on the felt, so the next hand deals in properly. */
const forgetCards = () => shown.clear();

function drawTable(f) {
  const t = f.table;
  if (!$("table-seats")) return;   // the overlay isn't open
  // Cards out means committed, the same as at every other table.
  setCanLeave(t.phase === "OPEN");

  const purseBox = $("bj-purse");
  if (purseBox) { purseBox.textContent = ""; purseBox.append(purseStrip()); }

  // Before the cards are out there is nothing to look at but your own bet, so
  // the felt stays out of the way until there is something on it.
  const betting = t.phase === "OPEN";
  $("table-seats").textContent = betting ? "" : `${t.seats.length} / 20 seated`;
  $("table-dealer").hidden = betting;
  $("table-seatlist").hidden = betting;

  const dealer = $("table-dealer");
  dealer.textContent = "";
  dealer.append(el("span", "ft-l", t.phase === "ACTING" ? "Dealer" : `Dealer ${t.dealer.length ? "" : ""}`));
  dealer.append(handRow(t.dealer || [], "bj-dealer"));

  const list = $("table-seatlist");
  list.textContent = "";
  for (const s of t.seats) {
    const row = el("div", `fseat${s.uid === K.you ? " mine" : ""}${s.result ? ` ${s.result}` : ""}`);
    row.append(el("span", "fseat-n", s.name + (s.uid === K.you ? " (you)" : "")));
    row.append(handRow(s.cards || [], `bj-${s.uid}`));
    row.append(el("span", "fseat-t", s.cards?.length ? String(s.total) : ""));
    row.append(el("span", "fseat-b", money(s.bet)));
    if (s.result) row.append(el("span", "fseat-r", s.result));
    list.append(row);
  }
  if (!t.seats.length) list.append(el("p", "fempty", "Nobody seated. Take a chair."));

  const acts = $("table-actions");
  acts.textContent = "";
  const seated = t.seats.find((s) => s.uid === K.you);

  if (t.phase === "OPEN") {
    // Anything already on the seat comes back before the new bet is taken, so
    // everything you hold is what's on the table plus whatever is staked here.
    const purse = (K.mine?.table || 0) + (seated?.bet || 0);
    acts.className = "bj-bet";

    acts.append(el("p", "tlede", "PLACE YOUR BET \u2014 type any amount or tap a chip (min $1)"));

    const deal = el("button", "tdeal", "");
    const bet = betPad(seated?.bet || 5, purse, (v) => {
      deal.textContent = `\u{1F0CF}  DEAL ${money(v)}`;
      deal.disabled = v < TABLE_MIN || v > purse;
    });
    acts.append(bet);

    // One button does both jobs: it takes the seat and calls for the cards.
    deal.onclick = () => {
      send({ type: "SEAT_TAKE", bet: bet.get() });
      send({ type: "SEAT_DEAL" });
    };
    acts.append(deal);

    if (seated) {
      const leave = el("button", "fbtn bj-leave", "Stand up");
      leave.onclick = () => send({ type: "SEAT_LEAVE" });
      acts.append(leave);
    }
    bet.set(bet.get());
  } else if (t.phase === "ACTING" && seated && !seated.done) {
    acts.className = "factions";
    const hit = el("button", "fbtn", "Hit");
    hit.onclick = () => send({ type: "SEAT_HIT" });
    const stand = el("button", "fbtn fbtn-go", "Stand");
    stand.onclick = () => send({ type: "SEAT_STAND" });
    acts.append(hit, stand);
  } else {
    acts.className = "factions";
    acts.append(el("p", "fnote", t.phase === "ACTING" ? "Waiting on the rest of the table." : "Settling up."));
  }
}

/* ── the card room ───────────────────────────────────────────────────── */

/** The tables on offer. Blackjack first, the rest alphabetically. */
function drawGameTabs() {
  const host = $("game-tabs");
  if (!host) return;
  host.textContent = "";
  for (const g of TABLE_GAMES) {
    const b = el("button", `gtab${g.ready ? "" : " soon"}`);
    b.append(el("span", "gtab-pip", g.pip));
    b.append(el("span", "gtab-name", g.name));
    if (!g.ready) b.append(el("span", "gtab-soon", "not built yet"));
    if (g.ready) b.append(el("span", "gtab-note", `($${g.min ?? 1} dollar min buy in)`));
    b.onclick = () => openTable(g.id);
    host.append(b);
  }
}

/**
 * The table window.
 *
 * Closing it ends the session at that table properly \u2014 no hand left open on
 * the server, no seat still held. So the way out only exists when nothing is
 * staked: with cards dealt and money down there is no X and no clicking the
 * backdrop, because a player who dislikes their cards would otherwise close the
 * window and ask for a fresh hand.
 */
function tableShell(title, body, { canLeave = true } = {}) {
  const host = $("table-modal");
  host.hidden = false;
  host.innerHTML = `
    ${canLeave ? `<div class="modal-back" data-close></div>` : `<div class="modal-back locked"></div>`}
    <div class="modal-card floor-card">
      <div class="modal-head">
        <h2>${title}</h2>
        ${canLeave
          ? `<button class="modal-close" data-close aria-label="Close and end this game">&times;</button>`
          : `<span class="modal-locked" title="Play the hand out">in play</span>`}
      </div>
      <div class="modal-body">${body}</div>
    </div>`;
  host.querySelectorAll("[data-close]").forEach((n) => { n.onclick = closeTable; });
}

/** Swaps the X in or out as a hand starts and finishes. */
function setCanLeave(canLeave) {
  const head = $("table-modal")?.querySelector(".modal-head");
  const back = $("table-modal")?.querySelector(".modal-back");
  if (!head) return;

  head.querySelector(".modal-close")?.remove();
  head.querySelector(".modal-locked")?.remove();

  if (canLeave) {
    const x = el("button", "modal-close", "\u00d7");
    x.setAttribute("aria-label", "Close and end this game");
    x.onclick = closeTable;
    head.append(x);
    if (back) { back.classList.remove("locked"); back.onclick = closeTable; }
  } else {
    const tag = el("span", "modal-locked", "in play");
    tag.title = "Play the hand out";
    head.append(tag);
    if (back) { back.classList.add("locked"); back.onclick = null; }
  }
}

/** What you're carrying, shown where you're about to spend it. */
function purseStrip() {
  const strip = el("div", "tpurse");
  const cash = el("div", "tpurse-c");
  cash.append(el("b", "", money(K.mine?.table)));
  cash.append(el("span", "", "MONEY"));
  const tok = el("div", "tpurse-t");
  tok.append(el("span", "", "\u{1F3B4}"));
  tok.append(el("b", "", `${K.mine?.tokens ?? 0} TOKEN${(K.mine?.tokens ?? 0) === 1 ? "" : "S"}`));
  strip.append(cash, tok);
  return strip;
}

/**
 * A labelled amount with a minus and a plus. Returns the row; read the
 * current figure back through the getter it hangs on the node.
 */
function moneyStepper(label, start, { min = 0, step = 5, max = Infinity, onChange } = {}) {
  const box = el("div", "mstep");
  box.append(el("p", "mstep-l", label));
  const row = el("div", "mstep-row");

  let v = Math.max(min, Math.min(max, start));
  const readout = el("div", "mstep-v", String(v));
  const set = (n) => {
    v = Math.max(min, Math.min(max, n));
    readout.textContent = String(v);
    onChange?.(v);
  };

  const down = el("button", "mstep-b down", "\u2212");
  down.onclick = () => set(v - step);
  const up = el("button", "mstep-b up", "+");
  up.onclick = () => set(v + step);

  row.append(down, readout, up);
  box.append(row);
  box.get = () => v;
  box.set = set;
  return box;
}

/**
 * The same stepper, but the figure is typeable. Nudging is quicker for small
 * changes and typing is quicker for large ones, so both are offered.
 */
function typedStepper(caption, start, { min = 5, step = 5, max = Infinity, onChange } = {}) {
  const box = el("div", "bstep");
  const down = el("button", "bstep-b", `\u2212$${step}`);
  const up = el("button", "bstep-b", `+$${step}`);

  const mid = el("div", "bstep-m");
  const field = el("input", "bstep-v");
  field.type = "number";
  field.min = String(min);
  field.step = String(step);
  mid.append(field);
  mid.append(el("span", "bstep-cap", caption));

  let v = Math.max(min, Math.min(max, start));
  const set = (n, keepTyping = false) => {
    v = Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
    if (!keepTyping) field.value = String(v);
    onChange?.(v);
  };
  field.value = String(v);
  // While typing, take what's there without snapping the caret about.
  field.oninput = () => set(field.value, true);
  field.onblur = () => set(field.value);
  down.onclick = () => set(v - step);
  up.onclick = () => set(v + step);

  box.append(down, mid, up);
  box.get = () => v;
  box.set = set;
  return box;
}

export const TABLE_MIN = 1;

/**
 * The bet surface every table shares: preset amounts, a field you can type
 * into, and All in. Returns the row, with .get() and .set() on it.
 */
function betPad(start, cash, onChange) {
  const wrap = el("div", "bpad");
  const most = Math.max(TABLE_MIN, cash);

  const stepper = typedStepper("BET", Math.min(Math.max(TABLE_MIN, start), most), {
    min: TABLE_MIN, step: 1, max: most, onChange: (v) => { mark(v); onChange?.(v); },
  });
  wrap.append(stepper);

  const chips = el("div", "bpad-chips");
  const presets = [1, 5, 10, 25, 50, 100].filter((n) => n <= most);
  const buttons = [];
  for (const n of presets) {
    const b = el("button", "hchip", money(n));
    b.onclick = () => stepper.set(n);
    buttons.push([n, b]);
    chips.append(b);
  }
  const all = el("button", "hchip all", `ALL IN ${money(most)}`);
  all.onclick = () => stepper.set(most);
  chips.append(all);
  wrap.append(chips);

  // The preset matching what's typed lights up, so the two never disagree.
  function mark(v) {
    for (const [n, b] of buttons) b.classList.toggle("on", n === v);
    all.classList.toggle("on", v === most);
  }
  mark(stepper.get());

  wrap.get = () => stepper.get();
  wrap.set = (n) => stepper.set(n);
  return wrap;
}

const betRow = (label, onGo, note) => {
  const r = el("div", "tbet");
  r.append(el("span", "tbet-n", label));
  if (note) r.append(el("span", "tbet-p", note));
  const go = el("button", "fbtn fbtn-go", "Bet");
  go.disabled = K.stake > (K.mine?.table || 0);
  go.onclick = onGo;
  r.append(go);
  return r;
};

export function openTable(id) {
  forgetCards();
  const g = TABLE_GAMES.find((x) => x.id === id);
  if (!g) return;
  K.table = id;

  if (!g.ready) {
    tableShell(`${g.pip} ${esc(g.name)}`,
      `<p class="fs-note">This table isn't built yet. Its rules are in the Casino
        Game Rules, and it will open here when it's ready.</p>`);
    return;
  }

  if (id === "holdem") {
    // One window, not two: the tab buys in and deals in the same click.
    tableShell(`${g.pip} Texas Hold'em \u00b7 vs Dealer`, `<div id="tgame"></div>`);
    return startHoldem();
  }

  if (id === "blackjack") {
    tableShell(`${g.pip} Blackjack`, `
      <div class="bj-top">
        <p class="bj-h">\u{1F0CF} YOUR TABLE</p>
        <div id="bj-purse"></div>
      </div>
      <p class="fs-note" id="table-seats"></p>
      <div id="table-dealer" class="ftable-row"></div>
      <div id="table-seatlist" class="fseats"></div>
      <div id="table-actions" class="factions"></div>`);
    if (K.floor) drawTable(K.floor);
    return;
  }

  tableShell(`${g.pip} ${esc(g.name)}`, `<div id="tgame"></div>`);
  drawGame(id);
}

const HOLDEM_MIN = 5;

/** Buys in and deals. The felt appears with cards already on it. */
function startHoldem() {
  const host = $("tgame");
  if (!host) return;
  if ((K.mine?.tokens || 0) < 1) {
    host.textContent = "";
    host.append(el("p", "notice notice-bad",
      "You're out of tokens. Earn one at the arcade \u2014 Earn Money on the floor bar."));
    return;
  }
  if ((K.mine?.table || 0) < HOLDEM_MIN) {
    host.textContent = "";
    host.append(el("p", "notice notice-bad",
      `Hold'em needs a ${money(HOLDEM_MIN)} buy-in and you have ${money(K.mine?.table)}.`));
    return;
  }
  host.textContent = "";
  host.append(el("p", "fs-note", "Dealing\u2026"));
  send({ type: "TABLE_DEAL", game: "holdem", ante: HOLDEM_MIN, level: K.level });
}

/** Whichever table is open, redrawn from scratch. */
function drawGame(id) {
  // Hold'em has no lobby screen; the tab deals it.
  if (id === "holdem") return startHoldem();
  const host = $("tgame");
  if (!host) return;
  host.textContent = "";
  host.append(purseStrip());
  // The purse strip already says what you're carrying; the rest is the bet.
  // Roulette, the wheel and hi-lo stake from the shared pad too, so the
  // amount is typeable everywhere rather than four fixed chips.
  const staking = ["roulette", "bigsix", "hilo"].includes(id);
  if (staking) {
    host.append(el("p", "tlede", "YOUR STAKE \u2014 type any amount or tap a chip (min $1)"));
    const pad = betPad(K.stake || 5, K.mine?.table || 0, (v) => { K.stake = v; });
    host.append(pad);
  }

  // Out of tokens is a dead end at the tables, so say where to get more
  // rather than leaving a row of buttons that quietly refuse.
  if ((K.mine?.tokens || 0) < 1) {
    host.append(el("p", "notice notice-bad",
      "You're out of tokens. Earn one at the arcade \u2014 Earn Money on the floor bar. The horse race needs none."));
    return;
  }

  const play = (extra) => send({ type: "TABLE_PLAY", game: id, amount: K.stake, ...extra });

  if (id === "roulette") {
    const cash = K.mine?.table || 0;
    // Selection only — the wheel is spun by the server on one bet, exactly as
    // before. The felt is a nicer way to choose it, not a new game.
    let pick = null, number = null;

    const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
    const staked = el("span", "rl-staked", money(0));

    const head = el("div", "rl-head");
    head.append(el("p", "rl-title", "PLACE YOUR BETS"));
    host.append(head);

    // ── chip ────────────────────────────────────────────────────────
    const chipRow = el("div", "rl-chips");
    chipRow.append(el("span", "rl-l", "CHIP:"));
    const custom = el("input", "rl-custom");
    custom.type = "number"; custom.min = "1"; custom.value = String(Math.min(5, cash) || 1);

    const chipBtns = [];
    const setChip = (v) => {
      K.stake = Math.max(1, Math.min(cash, Math.round(v) || 1));
      custom.value = String(K.stake);
      chipBtns.forEach(([amount, b]) => b.classList.toggle("on", amount === K.stake));
      refresh();
    };
    for (const amount of [1, 5, 25, 100].filter((n) => n <= Math.max(1, cash))) {
      const b = el("button", "rl-chip", money(amount));
      b.onclick = () => setChip(amount);
      chipBtns.push([amount, b]);
      chipRow.append(b);
    }
    const allIn = el("button", "rl-chip all", "ALL IN");
    allIn.onclick = () => setChip(cash);
    chipRow.append(allIn);
    chipRow.append(el("span", "rl-l", "CUSTOM $"));
    custom.oninput = () => { K.stake = Math.max(1, Math.min(cash, Number(custom.value) || 1)); refresh(); };
    chipRow.append(custom);
    host.append(chipRow);

    // ── bet type ────────────────────────────────────────────────────
    // Only straight is wired: split, street, corner and line need the server
    // to understand multi-number slips, which it does not yet. They are shown
    // rather than hidden so the felt is complete, and disabled rather than
    // silently broken.
    const typeRow = el("div", "rl-types");
    typeRow.append(el("span", "rl-l", "BET:"));
    for (const [id2, label, ready] of [
      ["straight", "straight", true], ["split", "split", false],
      ["street", "street", false], ["corner", "corner", false], ["line", "line", false],
    ]) {
      const b = el("button", `rl-type${id2 === "straight" ? " on" : ""}${ready ? "" : " soon"}`, label);
      if (!ready) b.title = "Not built yet \u2014 single numbers and the outside bets are live";
      b.disabled = !ready;
      typeRow.append(b);
    }
    host.append(typeRow);

    // ── the felt ────────────────────────────────────────────────────
    const cellFor = (label, cls, onPick) => {
      const c = el("button", `rl-cell ${cls}`, label);
      c.onclick = onPick;
      return c;
    };
    const choose = (id2, n, node) => {
      pick = id2; number = n;
      host.querySelectorAll(".rl-cell.picked").forEach((x) => x.classList.remove("picked"));
      node.classList.add("picked");
      refresh();
    };

    const zeros = el("div", "rl-zeros");
    for (const [label, n] of [["0", 0], ["00", 37]]) {
      const c = cellFor(label, "green", () => choose("straight", n, c));
      zeros.append(c);
    }
    host.append(zeros);

    const grid = el("div", "rl-grid");
    // Top row is the third column, as it is on a real layout.
    for (const [start2, col] of [[3, "col3"], [2, "col2"], [1, "col1"]]) {
      for (let i = 0; i < 12; i++) {
        const n = start2 + i * 3;
        const c = cellFor(String(n), RED.has(n) ? "red" : "black", () => choose("straight", n, c));
        grid.append(c);
      }
      const twoToOne = cellFor("2:1", "side", () => choose(col, null, twoToOne));
      grid.append(twoToOne);
    }
    host.append(grid);

    const dozens = el("div", "rl-dozens");
    for (const [label, id2] of [["1st 12", "dozen1"], ["2nd 12", "dozen2"], ["3rd 12", "dozen3"]]) {
      const c = cellFor(label, "wide", () => choose(id2, null, c));
      dozens.append(c);
    }
    host.append(dozens);

    const outside = el("div", "rl-outside");
    for (const [label, id2, cls] of [
      ["1\u201318", "low", ""], ["EVEN", "even", ""], ["\u25CF RED", "red", "isred"],
      ["\u25CF BLACK", "black", "isblack"], ["ODD", "odd", ""], ["19\u201336", "high", ""],
    ]) {
      const c = cellFor(label, `wide ${cls}`, () => choose(id2, null, c));
      outside.append(c);
    }
    host.append(outside);

    // ── spin ────────────────────────────────────────────────────────
    const acts = el("div", "rl-acts");
    const spin = el("button", "rl-spin", "\u25B6 SPIN");
    spin.onclick = () => {
      if (!pick) return say("Choose a bet on the felt first.");
      play({ pick, number });
    };
    const clear = el("button", "rl-clear", "CLEAR");
    clear.onclick = () => {
      pick = null; number = null;
      host.querySelectorAll(".rl-cell.picked").forEach((x) => x.classList.remove("picked"));
      refresh();
    };
    acts.append(spin, clear);
    host.append(acts);

    function refresh() {
      staked.textContent = money(pick ? K.stake : 0);
      spin.disabled = !pick || K.stake > cash;
      const row = ROULETTE_UI.find((b) => b.id === pick);
      spin.textContent = pick
        ? `\u25B6 SPIN \u00b7 ${money(K.stake)} at ${row ? row.pays : 35}:1`
        : "\u25B6 SPIN";
    }

    // The staked figure belongs beside the purse at the top.
    const purse = host.querySelector(".tpurse");
    if (purse) {
      const box = el("div", "tpurse-c");
      box.append(staked);
      box.append(el("span", "", "STAKED"));
      purse.prepend(box);
    }
    setChip(K.stake || 5);

  } else if (id === "bigsix") {
    const cash = K.mine?.table || 0;
    K.wheelBets = K.wheelBets || {};
    const backed = () => new Set(Object.keys(K.wheelBets).filter((k) => K.wheelBets[k] > 0));

    const wheel = el("div", "w6");
    wheel.innerHTML = wheelSvg(backed());
    host.append(wheel);

    host.append(el("p", "fs-note",
      "Back as many symbols as you like \u2014 one spin settles the lot. Tap a symbol to add your chip, tap its total to take it off."));

    const total = el("p", "ttotal");
    const spin = el("button", "rl-spin", "\u25B6 SPIN");

    const refresh = () => {
      const sum = Object.values(K.wheelBets).reduce((a, b) => a + b, 0);
      total.textContent = sum ? `On the wheel: ${money(sum)}` : "Nothing on the wheel yet";
      spin.disabled = sum < 1 || sum > cash;
      spin.textContent = sum ? `\u25B6 SPIN \u00b7 ${money(sum)} down` : "\u25B6 SPIN";
      wheel.innerHTML = wheelSvg(backed());
      [...chips.children].forEach((node, i) => {
        const b = BIGSIX_UI[i];
        const amount = K.wheelBets[b.id] || 0;
        node.classList.toggle("on", amount > 0);
        node.querySelector(".w6-pick-bet").textContent = amount ? money(amount) : "";
        node.querySelector(".w6-off").hidden = amount < 1;
      });
    };

    const chips = el("div", "w6-picks");
    for (const b of BIGSIX_UI) {
      const c = el("button", "w6-pick");
      c.style.setProperty("--tone", BIGSIX_TONE[b.id]);
      c.append(el("span", "w6-pick-s", LABEL[b.id] || b.name));
      c.append(el("span", "w6-pick-p", `${b.pays}:1`));
      c.append(el("span", "w6-pick-n", `${b.sections}/54`));
      c.append(el("span", "w6-pick-bet", ""));
      c.onclick = () => {
        const staked = Object.values(K.wheelBets).reduce((a, x) => a + x, 0);
        if (staked + K.stake > cash) return say("That's more than you have on the table.");
        K.wheelBets[b.id] = (K.wheelBets[b.id] || 0) + K.stake;
        refresh();
      };
      // A phone has no right-click, so taking a bet off needs its own control.
      const off = el("span", "w6-off", "\u2715");
      off.title = `Take your ${b.name} bet off`;
      off.onclick = (e) => { e.stopPropagation(); delete K.wheelBets[b.id]; refresh(); };
      c.append(off);
      chips.append(c);
    }
    host.append(chips);
    host.append(total);

    const acts = el("div", "rl-acts");
    spin.onclick = () => {
      spin.disabled = true;
      spin.textContent = "Spinning\u2026";
      send({ type: "TABLE_PLAY", game: "bigsix", bets: { ...K.wheelBets } });
      K.wheelBets = {};
    };
    const clear = el("button", "rl-clear", "CLEAR");
    clear.onclick = () => { K.wheelBets = {}; refresh(); };
    acts.append(spin, clear);
    host.append(acts);

    refresh();

  } else if (id === "baccarat") {
    const cash = K.mine?.table || 0;
    K.board = K.board || {};

    host.append(el("p", "bshoe", "8-deck shoe"));

    // The chip sets the size of every tap on the board.
    const chipBox = el("div", "bchip-row");
    chipBox.append(el("span", "bchip-l", "CHIP"));
    let chip;
    const totalLine = el("p", "ttotal");
    const retotal = () => {
      const sum = Object.values(K.board).reduce((a, b) => a + b, 0);
      totalLine.textContent = `Total wagered: ${money(sum)}`;
      deal.disabled = sum < 1 || sum > cash;
    };
    chip = betPad(5, cash, () => chip.onValue?.());
    chipBox.append(chip);
    host.append(chipBox);

    host.append(el("p", "fs-note",
      "Set your chip amount above, then + BET on the right adds it \u00b7 \u2715 on the left removes that bet."));

    const deal = el("button", "tdeal", "\u{1F0CF}  DEAL");

    const addRow = (b, into) => {
      const row = el("div", `brow ${b.tone}`);

      const clear = el("button", "brow-x", "\u2715");
      clear.title = "Take this bet off";
      clear.onclick = () => { delete K.board[b.id]; amount.textContent = ""; retotal(); };
      row.append(clear);

      const label = el("div", "brow-l");
      label.append(el("b", "", b.name.toUpperCase()));
      label.append(el("span", "", b.odds));
      row.append(label);

      const amount = el("span", "brow-a", K.board[b.id] ? money(K.board[b.id]) : "");
      row.append(amount);

      const add = el("button", "brow-b", "");
      const relabel = () => { add.textContent = `+ BET ${money(chip.get())}`; };
      add.onclick = () => {
        K.board[b.id] = (K.board[b.id] || 0) + chip.get();
        amount.textContent = money(K.board[b.id]);
        retotal();
      };
      relabel();
      row.append(add);
      into.append(row);
      return relabel;
    };

    const relabels = [];
    const main = el("div", "bboard");
    for (const b of BACCARAT_BOARD.filter((x) => !x.side)) relabels.push(addRow(b, main));
    host.append(main);

    host.append(el("p", "bside-h", "SIDE BETS"));
    const side = el("div", "bboard");
    for (const b of BACCARAT_BOARD.filter((x) => x.side)) relabels.push(addRow(b, side));
    host.append(side);

    // Every + BET button follows the chip.
    chip.onValue = () => relabels.forEach((f) => f());

    host.append(totalLine);
    deal.onclick = () => {
      send({ type: "TABLE_PLAY", game: "baccarat", bets: { ...K.board } });
      K.board = {};
    };
    host.append(deal);
    retotal();

  } else if (id === "hilo") {
    host.append(el("p", "fs-note",
      "Two calls on the next card. Both have to come in; both right pays 1:1, and a tie pushes."));
    for (const [dir, dirName] of [[true, "Higher"], [false, "Lower"]]) {
      for (const [band, bandName] of [[true, "8 or higher"], [false, "under 8"]]) {
        host.append(betRow(`${dirName} \u00b7 ${bandName}`,
          () => play({ higher: dir, eightUp: band }), "pays 1:1"));
      }
    }

  } else if (id === "paigow") {
    host.append(el("p", "tlede", "YOUR ANTE \u2014 type any amount or tap a chip (min $1)"));
    const pad = betPad(K.stake || 5, K.mine?.table || 0, (v) => { K.stake = v; });
    host.append(pad);
    host.append(el("p", "fs-note",
      "Seven cards each and the dealer's are face up. Split yours into a five and a two \u2014 the five must be the stronger \u2014 and beat the dealer on both to win. One each is a push, and a dealer ace-high pushes automatically."));
    for (const [key, label] of [["fortune", "Fortune Bonus"], ["aceBonus", "Ace-High Bonus"]]) {
      const b = el("button", `fchip${K.side[key] ? " on" : ""}`, `${label} ${K.side[key] ? "on" : "off"}`);
      b.onclick = () => { K.side[key] = !K.side[key]; drawGame(id); };
      host.append(b);
    }
    const go = el("button", "fbtn fbtn-go", `Ante ${money(K.stake)} and deal`);
    go.onclick = () => send({
      type: "TABLE_DEAL", game: "paigow", ante: K.stake,
      fortune: K.side.fortune ? K.stake : 0, aceBonus: K.side.aceBonus ? K.stake : 0,
    });
    host.append(go);

  } else if (id === "crisscross") {
    host.append(el("p", "tlede",
      "YOUR ANTE \u2014 posted twice, one for each arm (min $1)"));
    const pad = betPad(K.stake || 5, Math.floor((K.mine?.table || 0) / 2), (v) => { K.stake = v; });
    host.append(pad);
    host.append(el("p", "fs-note",
      "Two equal antes, two cards of your own and five in a cross. Bet Across, then Down, then the Middle \u2014 each one to three times the ante. Antes and lines pay from jacks up and push on sixes through tens."));
    const b = el("button", `fchip${K.side.bonus ? " on" : ""}`, `5 Card Bonus ${K.side.bonus ? "on" : "off"}`);
    b.onclick = () => { K.side.bonus = !K.side.bonus; drawGame(id); };
    host.append(b);
    const go = el("button", "fbtn fbtn-go", `Post ${money(K.stake * 2)} in antes`);
    go.disabled = K.stake * 2 > (K.mine?.table || 0);
    go.onclick = () => send({
      type: "TABLE_DEAL", game: "crisscross", ante: K.stake,
      bonus: K.side.bonus ? K.stake : 0,
    });
    host.append(go);

  } else if (id === "threecard") {
    const cash = K.mine?.table || 0;

    host.append(el("p", "tlede",
      "ANTE and PAIR PLUS \u2014 type any amount or tap a chip (min $1, Pair Plus optional)"));

    const deal = el("button", "tdeal", "");
    const total = el("p", "ttotal");
    let ante, pp;
    const retotal = () => {
      const a = ante.get(), b = ppOn ? pp.get() : 0;
      total.textContent = `Total to deal: ${money(a + b)} \u00b7 ${b ? `Pair Plus ${money(b)}` : "Pair Plus off"}`;
      deal.textContent = `\u{1F0CF}  DEAL ${money(a + b)}`;
      deal.disabled = a < TABLE_MIN || a + b > cash;
    };

    let ppOn = false;
    host.append(el("p", "mstep-l", "ANTE"));
    ante = betPad(Math.min(5, cash) || TABLE_MIN, cash, retotal);
    host.append(ante);

    const ppHead = el("div", "pp-head");
    ppHead.append(el("p", "mstep-l", "PAIR PLUS"));
    const ppToggle = el("button", "hchip", "OFF");
    ppHead.append(ppToggle);
    host.append(ppHead);

    pp = betPad(Math.min(5, cash) || TABLE_MIN, cash, retotal);
    pp.hidden = true;
    ppToggle.onclick = () => {
      ppOn = !ppOn;
      ppToggle.textContent = ppOn ? "ON" : "OFF";
      ppToggle.classList.toggle("on", ppOn);
      pp.hidden = !ppOn;
      retotal();
    };
    host.append(pp);

    deal.onclick = () => send({
      type: "TABLE_DEAL", game: "threecard",
      ante: ante.get(), side: ppOn ? pp.get() : 0,
    });
    host.append(total);
    host.append(deal);
    host.append(el("p", "fs-note",
      "Playing costs the ante again. The dealer needs queen-high to qualify, and a straight beats a flush."));
    retotal();

  } else if (id === "fivecard") {
    const cash = K.mine?.table || 0;

    host.append(el("p", "tlede",
      "PLACE YOUR BET \u2014 type any amount or tap a chip (min $1)"));

    const deal = el("button", "tdeal", "");
    const bet = betPad(Math.min(5, cash) || TABLE_MIN, cash, (v) => {
      deal.textContent = `\u{1F0CF}  DEAL ${money(v)}`;
      deal.disabled = v < TABLE_MIN || v > cash;
    });
    host.append(bet);

    deal.onclick = () => send({ type: "TABLE_DEAL", game: "fivecard", ante: bet.get(), side: 0 });
    host.append(deal);
    host.append(el("p", "fs-note",
      "Five cards, throw back what you don't want, and get paid against the paytable from jacks up."));
  }
}

/**
 * You asked for cards at one table while a hand is still open at another.
 *
 * Being told to go and finish it is useless if you are standing somewhere
 * else, so both ways out are offered right here: go back to that hand, or give
 * it up and stay where you are.
 */
function showBlocked(msg) {
  const host = $("tgame");
  if (!host) return;
  const label = TABLE_GAMES.find((g) => g.id === msg.game)?.name || msg.game;

  host.textContent = "";
  host.append(el("p", "notice notice-bad", `${msg.message} A hand can only be open at one table at a time.`));

  const acts = el("div", "factions");
  const go = el("button", "fbtn fbtn-go", `Back to ${label}`);
  go.onclick = () => openTable(msg.game);
  const drop = el("button", "fbtn hfold", "Give that hand up");
  drop.onclick = () => {
    if (!window.confirm(`Give up your ${label} hand? Everything staked on it is lost.`)) return;
    send({ type: "TABLE_END" });
    // The table you actually wanted, once the other one is clear.
    setTimeout(() => openTable(msg.wanted || K.table), 300);
  };
  acts.append(go, drop);
  host.append(acts);
}

/** A dealt hand, waiting on the player. */
function showHand(msg) {
  const host = $("tgame");
  if (!host) return;
  setCanLeave(false);      // money is on the table now
  host.textContent = "";
  const head = el("div", "hz-head");
  head.append(el("span", "hz-l", "Your hand"));
  head.append(endHandBtn());
  host.append(head);
  host.append(el("p", "fs-note", msg.rank));

  const hand = handRow(msg.cards, "hand", "thand");
  host.append(hand);

  if (msg.game === "holdem") {
    if (msg.level) K.level = msg.level;
    host.textContent = "";
    const staked = msg.staked ?? msg.ante ?? 0;

    // Dealer's two, face down until the river is settled.
    const dealerRow = el("div", "hz-head");
    dealerRow.append(el("span", "hz-l", "Dealer"));
    dealerRow.append(aiTabs(true));
    dealerRow.append(endHandBtn());
    host.append(dealerRow);
    host.append(handRow([null, null], "hdealer", "thand"));

    const boardBox = el("div", "hboard");
    boardBox.append(handRow(msg.board || [], "board", "thand"));
    host.append(boardBox);

    host.append(el("p", "hz-l", "You"));
    host.append(handRow(msg.cards, "hole", "thand"));

    const street = String(msg.street || "").toUpperCase();
    const owed = msg.pending || 0;
    host.append(el("p", `hstatus${owed ? " urgent" : ""}`,
      owed ? `\u25CF ${street} \u2014 ${(msg.dealerSaid || "the dealer bets").toUpperCase()} \u2014 CALL or FOLD`
        : `\u25CF ${street} \u2014 CHECK or BET`));
    if (msg.dealerSaid && !owed) host.append(el("p", "hsaid", msg.dealerSaid));

    const pot = el("p", "hpot");
    pot.append(el("span", "", `Pot ${money(staked)} \u00b7 Buy-in ${money(msg.ante ?? 5)}`));
    pot.append(el("span", "hpot-r", `${money(staked)} staked`));
    host.append(pot);

    // The stepper: nothing here can bet more than the player holds.
    const cash = K.mine?.table || 0;
    let amount = Math.min(cash - (cash % 5), 0);
    const readout = el("div", "hstep-v", "0");
    const bet = el("button", "fbtn hbet", "Bet $0");
    const setAmount = (n) => {
      amount = Math.max(0, Math.min(cash - (cash % 5), n));
      readout.textContent = String(amount);
      bet.textContent = `Bet ${money(amount)}`;
      bet.disabled = amount < 5;
    };

    const stepper = el("div", "hstep");
    const down = el("button", "hstep-b", "\u2212$5");
    down.onclick = () => setAmount(amount - 5);
    const up = el("button", "hstep-b", "+$5");
    up.onclick = () => setAmount(amount + 5);
    const mid = el("div", "hstep-m");
    mid.append(readout);
    mid.append(el("span", "hstep-cap", "BET AMOUNT"));
    stepper.append(down, mid, up);
    host.append(stepper);

    const quick = el("div", "hquick");
    const min = el("button", "hchip", "MIN $5");
    min.onclick = () => setAmount(5);
    const all = el("button", "hchip", `ALL IN ${money(cash - (cash % 5))}`);
    all.onclick = () => setAmount(cash - (cash % 5));
    quick.append(min, all);
    host.append(quick);

    const acts = el("div", "hacts");
    if (owed) {
      // The dealer has bet into you. Nothing else is on offer.
      stepper.hidden = true;
      quick.hidden = true;
      const call = el("button", "fbtn hcheck", `CALL ${money(owed)}`);
      call.disabled = owed > cash;
      call.onclick = () => send({ type: "TABLE_ACT", move: "call" });
      const fold = el("button", "fbtn hfold", "FOLD");
      fold.onclick = () => send({ type: "TABLE_ACT", move: "fold" });
      acts.append(call, fold);
    } else {
      const check = el("button", "fbtn hcheck", "CHECK");
      check.onclick = () => send({ type: "TABLE_ACT", move: "check" });
      bet.onclick = () => { if (amount >= 5) send({ type: "TABLE_ACT", move: "bet", amount }); };
      acts.append(check, bet);
    }
    host.append(acts);

    setAmount(0);
    return;
  }

  if (msg.game === "paigow") {
    host.textContent = "";
    const pgHead = el("div", "hz-head");
    pgHead.append(el("span", "hz-l", "Pai Gow"));
    pgHead.append(endHandBtn());
    host.append(pgHead);
    host.append(zone("The dealer's seven, face up", handRow(msg.dealer, "pgdealer", "thand")));

    K.lowPick = [];
    host.append(el("p", "fs-note", "Tap two of yours for the low hand, or take the house way."));
    const mine = handRow(msg.cards, "pgmine", "thand pickable");
    [...mine.children].forEach((node, i) => {
      node.onclick = () => {
        const at = K.lowPick.indexOf(i);
        if (at !== -1) { K.lowPick.splice(at, 1); node.classList.remove("picked"); }
        else if (K.lowPick.length < 2) { K.lowPick.push(i); node.classList.add("picked"); }
      };
    });
    host.append(mine);

    const acts = el("div", "factions");
    const set = el("button", "fbtn fbtn-go", "Set my hand");
    set.onclick = () => {
      if (K.lowPick.length !== 2) return say("Pick exactly two cards for the low hand.");
      send({ type: "TABLE_ACT", low: K.lowPick });
    };
    const hw = el("button", "fbtn", "House Way");
    hw.onclick = () => send({ type: "TABLE_ACT", low: msg.houseWay });
    acts.append(set, hw);
    host.append(acts);
    return;
  }

  if (msg.game === "crisscross") {
    host.textContent = "";
    const ccHead = el("div", "hz-head");
    ccHead.append(el("span", "hz-l", `Betting the ${msg.stage}`));
    ccHead.append(endHandBtn());
    host.append(ccHead);
    host.append(el("p", "fs-note", "Your two cards"));
    host.append(handRow(msg.cards, "hole", "thand"));

    if (msg.revealed?.length) {
      host.append(el("p", "fs-note", "Turned over so far:"));
      host.append(handRow(msg.revealed, "cross", "thand"));
    }

    const acts = el("div", "factions");
    for (const m of [1, 2, 3]) {
      const b = el("button", "fbtn fbtn-go", `${m}\u00d7 (${money(msg.ante * m)})`);
      b.onclick = () => send({ type: "TABLE_ACT", move: "bet", mult: m });
      acts.append(b);
    }
    const fold = el("button", "fbtn", "Fold this line");
    fold.onclick = () => send({ type: "TABLE_ACT", move: "fold" });
    acts.append(fold);
    host.append(acts);
    return;
  }

  if (msg.game === "threecard") {
    const acts = el("div", "factions");
    const play = el("button", "fbtn fbtn-go", `Play (${money(msg.ante)} more)`);
    play.onclick = () => send({ type: "TABLE_ACT", move: "play" });
    const fold = el("button", "fbtn", "Fold");
    fold.onclick = () => send({ type: "TABLE_ACT", move: "fold" });
    acts.append(play, fold);
    host.append(acts);
    return;
  }

  // Five-card draw: tap the ones you don't want.
  const toss = new Set();
  host.append(el("p", "fs-note", "Tap the cards to throw away, then draw."));
  [...hand.children].forEach((node, i) => {
    node.style.cursor = "pointer";
    node.onclick = () => {
      if (toss.has(i)) { toss.delete(i); node.classList.remove("tossed"); }
      else { toss.add(i); node.classList.add("tossed"); }
    };
  });
  const draw = el("button", "fbtn fbtn-go", "Draw");
  draw.onclick = () => send({ type: "TABLE_ACT", discards: [...toss] });
  host.append(draw);
}

/** What happened, and the way back to another go. */
async function showTableResult(msg) {
  K.lastHand = { at: Date.now(), title: msg.title, returned: msg.returned, staked: msg.staked };
  const host = $("tgame");
  if (!host) return;
  setCanLeave(true);       // nothing staked, so the way out is back

  // The wheel knows the answer before the player does, so it turns first.
  // Printing the payout over a still wheel would give the game away.
  if (msg.game === "bigsix" && msg.detail?.landed && document.getElementById("w6-rotor")) {
    await spinWheelTo(msg.detail.landed);
  }
  host.textContent = "";

  const net = (msg.returned || 0) - (msg.staked ?? 0);
  host.append(el("p", `arc-sum ${msg.returned > 0 ? "arc-good" : "arc-bad"}`,
    msg.returned > 0 ? "\u2713" : "\u2717"));
  host.append(el("p", "fs-note", msg.title));

  const d = msg.detail || {};
  if (d.player && d.banker) {
    for (const [who, cards, total] of [["Player", d.player, d.playerTotal], ["Banker", d.banker, d.bankerTotal]]) {
      const row = el("div", "ftable-row");
      row.append(el("span", "ft-l", `${who} ${total}`));
      row.append(handRow(cards, `res-${who}`));
      host.append(row);
    }
  }
  if (d.dealer) {
    const row = el("div", "ftable-row");
    row.append(el("span", "ft-l", `Dealer: ${d.dealerRank}`));
    row.append(handRow(d.dealer, "res-dealer"));
    host.append(row);
  }
  if (d.cards) {
    host.append(handRow(d.cards, "res-final", "thand"));
  }
  if (d.returns && d.bets) {
    const rows = el("div", "w6-settle");
    for (const [id, amount] of Object.entries(d.bets)) {
      const back = d.returns[id] || 0;
      const line = el("p", `w6-line${back ? " won" : ""}`);
      line.append(el("span", "", `${LABEL[id] || id} \u00b7 ${money(amount)}`));
      line.append(el("span", "", back ? `pays ${money(back)}` : "lost"));
      rows.append(line);
    }
    host.append(rows);
  }
  if (d.bonus) host.append(el("p", "fs-note", `Ante bonus: ${d.bonus}`));
  if (d.pairPlus) host.append(el("p", "fs-note", `Pair Plus: ${d.pairPlus}`));

  host.append(el("p", "arc-pay", net > 0 ? `You win ${money(net)}` : net === 0 ? "Push" : `Down ${money(-net)}`));

  const again = el("button", "fbtn fbtn-go", "Next hand");
  again.onclick = () => drawGame(K.table);
  host.append(again);
}

export function closeTable() {
  // Standing up as well as closing: a held seat with a bet on it would leave
  // the shared table waiting on somebody who has gone.
  if (K.table === "blackjack" && K.floor?.table?.seats?.some((x) => x.uid === K.you))
    send({ type: "SEAT_LEAVE" });
  forgetCards();
  K.table = null;
  const host = $("table-modal");
  host.hidden = true;
  host.textContent = "";
}

/** The card room's own results bar, separate from the race's. */
function showTableResults() {
  const hand = K.lastHand;
  if (!hand?.seats?.length) return say("No hand has finished yet.");
  const lines = hand.seats
    .map((x) => `${x.name}: ${x.result || "no result"}${x.cards?.length ? ` (${x.total})` : ""}`)
    .join("\n");
  window.alert(`Last hand at the card table\n\n${lines}`);
}

/* ── the rule sheet ──────────────────────────────────────────────────── */

export function openCasinoRules() {
  const host = $("casino-rules-modal");
  host.hidden = false;
  host.innerHTML = `
    <div class="modal-back" data-close></div>
    <div class="modal-card floor-card rules-card">
      <div class="modal-head">
        <h2>&#128220; Casino Game Rules</h2>
        <button class="modal-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body rules-cols">${casinoRulesHtml()}</div>
    </div>`;
  host.querySelectorAll("[data-close]").forEach((n) => {
    n.onclick = () => { host.hidden = true; host.textContent = ""; };
  });
}

/* ── log and results ─────────────────────────────────────────────────── */

function logNode(e) {
  const p = el("p", "flog-line");
  p.innerHTML = `<span class="fl-t">${new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span> ${esc(e.text)}`;
  return p;
}

function logLine(e) {
  K.logLines.unshift(e);
  K.logLines = K.logLines.slice(0, 60);
  const host = $("casino-log");
  if (!host) return;                 // the window is closed; it will catch up
  host.prepend(logNode(e));
  while (host.children.length > 60) host.lastChild.remove();
}

function showResult(msg) {
  const names = msg.order.map((id) => horse(id).name);
  const mine = msg.winners.filter((w) => w.name === (K.floor?.players || []).find((p) => p.uid === K.you)?.name);
  const won = mine.reduce((a, w) => a + w.paid, 0);
  say(won ? `You collect ${money(won)}. Finish: ${names.join(", ")}` : `Finish: ${names.join(", ")}`);
}


/* ── Earn Money: the maths arcade ─────────────────────────────────────
 *
 * The only thing on the floor that pays MMR, which is exactly why none of it
 * is decided here. The Worker issues the sum, keeps the answer, times the
 * solve on its own clock and credits the table itself. This draws the sum and
 * sends what was typed.
 */

let arcTimer = null;

export function openArcade() {
  const host = $("arcade-modal");
  host.hidden = false;
  host.innerHTML = `
    <div class="modal-back" data-close></div>
    <div class="modal-card floor-card">
      <div class="modal-head">
        <h2>&#129518; Earn Money</h2>
        <button class="modal-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body" id="arc-body">
        <p class="fs-note">Loading a sum&hellip;</p>
      </div>
    </div>`;
  host.querySelectorAll("[data-close]").forEach((n) => { n.onclick = closeArcade; });
  nextSum();
}

export function closeArcade() {
  clearInterval(arcTimer);
  arcTimer = null;
  const host = $("arcade-modal");
  host.hidden = true;
  host.textContent = "";
}

async function nextSum() {
  const body = $("arc-body");
  if (!body) return;
  body.innerHTML = `<p class="fs-note">Loading a sum&hellip;</p>`;

  let p;
  try {
    const token = await K.idToken();
    const res = await fetch("/api/puzzle/new", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    p = await res.json();
    if (p.error) throw new Error(p.error);
  } catch (err) {
    body.innerHTML = `<p class="fs-note arc-bad">${esc(err.message || "Could not fetch a sum.")}</p>`;
    return;
  }

  const started = Date.now();
  body.innerHTML = `
    <p class="fs-note">Answer before the bar runs out. Under ${Math.round(p.fastMs / 1000)}s pays a bonus.</p>
    <p class="arc-sum">${esc(p.text)}</p>
    <div class="arc-bar"><span class="arc-fill" id="arc-fill"></span></div>
    <input id="arc-answer" class="arc-answer" type="number" inputmode="numeric" autocomplete="off" />
    <button id="arc-go" class="fbtn fbtn-go">Submit</button>`;

  const input = $("arc-answer");
  input.focus();

  clearInterval(arcTimer);
  arcTimer = setInterval(() => {
    const left = Math.max(0, p.limitMs - (Date.now() - started));
    const fill = $("arc-fill");
    if (!fill) { clearInterval(arcTimer); return; }
    fill.style.width = `${(left / p.limitMs) * 100}%`;
    if (left <= 0) { clearInterval(arcTimer); submit(p.id); }
  }, 100);

  const submit = async (id) => {
    clearInterval(arcTimer);
    const answer = Number($("arc-answer")?.value);
    let r;
    try {
      const token = await K.idToken();
      const res = await fetch("/api/puzzle/solve", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id, answer }),
      });
      r = await res.json();
    } catch {
      body.innerHTML = `<p class="fs-note arc-bad">That didn't reach the server.</p>`;
      return;
    }
    showPay(r);
  };

  $("arc-go").onclick = () => submit(p.id);
  input.onkeydown = (e) => { if (e.key === "Enter") submit(p.id); };
}

function showPay(r) {
  const body = $("arc-body");
  if (!body) return;

  if (!r.correct) {
    body.innerHTML = `
      <p class="arc-sum arc-bad">&#10007;</p>
      <p class="fs-note">The answer was <b>${esc(String(r.answer ?? "?"))}</b>. Nothing earned that time.</p>
      <button id="arc-next" class="fbtn fbtn-go">Another sum</button>`;
  } else {
    body.innerHTML = `
      <p class="arc-sum arc-good">&#10003;</p>
      <div class="arc-pay">
        <span>MMR <b class="arc-good">+${r.mmr}</b></span>
        <span>Cash <b>${money(r.cash)}</b></span>
        <span>Tokens <b>+${r.token}</b></span>
      </div>
      <p class="fs-note">${r.fast ? `Under the wire &mdash; ${r.multiplier}&times; bonus applied.` : `Solved in ${(r.elapsedMs / 1000).toFixed(1)}s.`}</p>
      <p class="fs-note">Cash and tokens land on the table. Bank them before you leave the floor.</p>
      <button id="arc-next" class="fbtn fbtn-go">Another sum</button>`;
  }
  $("arc-next").onclick = nextSum;
}
