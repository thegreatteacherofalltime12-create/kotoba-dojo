// Multiverse Grand Prix, client side.
//
// The room holds the answers and every metre of the track; this draws the
// grid, the word in your hands and the clock it is measured against, and
// sends guesses. Nothing here knows an answer before the room says so.

import { applyTokenTab, PRIX_ARSENAL_ITEMS } from "./boost.js";
import { kartById } from "./cosmetics.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export const P = {
  socket: null, code: null, you: null, isHost: false,
  game: null, item: null, tick: null, beat: null,
  onLeave: null, clockSkew: 0,
};

let boostTab = null;
const tokenTab = () => (boostTab ||= applyTokenTab({
  game: "prix", send, button: $("btn-prix-boost"), label: "race", arsenal: PRIX_ARSENAL_ITEMS,
}));

export async function enterPrix(code, getToken, onLeave) {
  P.code = code;
  P.onLeave = onLeave;
  P.item = null;
  $("prix-code").textContent = code;
  $("prix-results").hidden = true;
  $("prix-race").hidden = true;
  $("prix-chat").textContent = "";
  // Build the token tab now. It is what puts the click handler on the
  // Apply Token button, and nothing else ever asks the room for tokens, so
  // leaving it until a PRIX_TOKENS arrives means it is never built at all.
  tokenTab();
  await connect(getToken);
}

async function connect(getToken) {
  closePrix(false);
  const token = await getToken();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/prix/${P.code}/ws?token=${encodeURIComponent(token)}`);
  P.socket = ws;
  ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch { /* ignore */ } };
  ws.onclose = () => {
    clearInterval(P.beat);
    P.beat = null;
    if (P.code) setTimeout(() => { if (P.code) connect(getToken); }, 1500);
  };
  clearInterval(P.beat);
  P.beat = setInterval(() => send({ type: "PING" }), 30_000);
}

export function closePrix(forget = true) {
  if (P.socket) { P.socket.onclose = null; P.socket.close(); P.socket = null; }
  clearInterval(P.tick);
  P.tick = null;
  if (forget) P.code = null;
}

const send = (o) => { try { P.socket?.send(JSON.stringify(o)); } catch { /* closed */ } };
let sayTimer = null;
const say = (text) => {
  const n = $("prix-error");
  n.textContent = text || "";
  n.hidden = !text;
  clearTimeout(sayTimer);
  // A refusal is about a moment. Left up, it reads as though the race is
  // still broken long after the thing it was about has passed.
  if (text) sayTimer = setTimeout(() => { n.textContent = ""; n.hidden = true; }, 6_000);
};

// ── what the room says ───────────────────────────────────────────────

function handle(msg) {
  switch (msg.type) {
    case "PRIX_WELCOME":
      P.you = msg.you;
      P.isHost = !!msg.isHost;
      break;
    case "PRIX_TOKENS":
      tokenTab().receive(msg);
      if (msg.arsenal) tokenTab().arsenalState(msg.arsenal);
      break;
    case "PRIX_STATE":
      P.game = msg.game;
      P.isHost = msg.game.hostUid === P.you;
      draw();
      break;
    case "PRIX_START":
      P.clockSkew = Date.now() - (msg.serverNow || Date.now());
      say("");
      flash("Lights out.");
      break;
    case "PRIX_ITEM":
      P.item = msg;
      P.clockSkew = Date.now() - (msg.serverNow || Date.now());
      drawItem();
      break;
    case "PRIX_RESULT":
      showResult(msg);
      break;
    case "PRIX_USED":
      flash(msg.note || "Fired.");
      break;
    case "PRIX_FIRED":
      if (msg.uid !== P.you) flash(`${msg.name}: ${itemName(msg.item)}`);
      break;
    case "PRIX_HIT":
      takeHit(msg);
      break;
    case "PRIX_FLAG":
      if (msg.uid === P.you) {
        P.item = null;
        P.flagAt = Date.now() + (msg.graceMs || 0);
        clearInterval(P.tick);
        P.tick = setInterval(drawWaiting, 500);
      }
      flash(`${msg.name} takes the flag.`);
      drawWaiting();
      break;
    case "PRIX_OVER":
      P.item = null;
      drawResults(msg);
      break;
    case "PRIX_CHAT":
      addChat(msg);
      break;
    case "PRIX_ERROR":
      say(msg.message);
      break;
    default: break;
  }
}

// ── the lobby ────────────────────────────────────────────────────────

function draw() {
  const g = P.game;
  if (!g) return;
  const racing = g.phase === "RACING";
  $("prix-phase").textContent = racing ? `Lap 1 of ${g.laps}` : g.phase === "RESULTS" ? "Race over" : "Waiting";
  $("prix-lobby").hidden = racing;
  $("prix-race").hidden = !racing;
  $("prix-results").hidden = g.phase !== "RESULTS";
  $("prix-host-tag").hidden = !P.isHost;
  $("btn-prix-start").hidden = !P.isHost;
  $("btn-prix-solo").hidden = !P.isHost;
  $("btn-prix-solo").setAttribute("aria-checked", g.solo ? "true" : "false");
  $("btn-prix-solo").classList.toggle("is-on", !!g.solo);

  // Chat is a lobby thing. Once the lights are out there is no time to read it.
  const open = g.chatOpen !== false;
  $("prix-text").disabled = !open;
  $("btn-prix-send").disabled = !open;
  $("prix-chat-tag").textContent = open ? "" : "Shut for the race";

  if (!racing) {
    drawEngines();
    drawDrivers();
    drawCircuits();
    drawLengths();
    drawClasses();
    const here = g.players.filter((p) => p.online).length;
    $("prix-note").textContent = g.solo
      ? `Solo, against ${g.aiCount} ${g.aiCount === 1 ? "computer" : "computers"}. Begin whenever you are ready.`
      : here < 2 ? "Waiting for at least one more racer." : `${here} on the grid.`;
  }
  drawTrack();
}

/** What the race runs on, and — for trivia — which theme. The host's call. */
function drawEngines() {
  const g = P.game;
  const host = $("prix-engines");
  host.textContent = "";
  for (const e of g.engines || []) {
    const b = el("button", "ai-level" + (g.engine === e.id ? " is-on" : ""));
    b.type = "button";
    b.disabled = !P.isHost;
    b.append(el("b", null, e.name));
    b.append(el("i", null, e.sub));
    b.onclick = () => send({ type: "PRIX_ENGINE", engine: e.id });
    host.append(b);
  }

  const themes = (g.engines || []).find((e) => e.id === "trivia")?.themes || [];
  const box = $("prix-theme-box");
  const sel = $("prix-theme");
  box.hidden = g.engine !== "trivia";
  if (box.hidden) return;
  if (sel.options.length !== themes.length + 1) {
    sel.textContent = "";
    const mixed = document.createElement("option");
    mixed.value = "mixed";
    mixed.textContent = "Everything, mixed";
    sel.append(mixed);
    for (const t of themes) {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.name;
      sel.append(o);
    }
  }
  sel.value = g.theme || "mixed";
  sel.disabled = !P.isHost;
  sel.onchange = () => send({ type: "PRIX_THEME", theme: sel.value });
}

/** How many computers line up, and how quick they are. The host's call. */
function drawDrivers() {
  const g = P.game;
  const box = $("prix-ai");
  box.hidden = !g.solo;
  if (!g.solo) return;

  const counts = $("prix-ai-count");
  counts.textContent = "";
  for (let n = 1; n <= (g.aiMax || 5); n++) {
    const b = el("button", "ai-level" + (g.aiCount === n ? " is-on" : ""));
    b.type = "button";
    b.disabled = !P.isHost;
    b.append(el("b", null, String(n)));
    b.append(el("i", null, n === 1 ? "driver" : "drivers"));
    b.onclick = () => send({ type: "PRIX_AI", count: n });
    counts.append(b);
  }

  const levels = $("prix-ai-level");
  levels.textContent = "";
  for (const l of g.aiLevels || []) {
    const b = el("button", "ai-level" + (g.aiLevel === l.id ? " is-on" : ""));
    b.type = "button";
    b.disabled = !P.isHost;
    b.append(el("b", null, l.name));
    b.append(el("i", null, l.blurb));
    b.onclick = () => send({ type: "PRIX_AI", level: l.id });
    levels.append(b);
  }
}

function drawCircuits() {
  const g = P.game;
  const host = $("prix-circuits");
  host.textContent = "";
  for (const c of g.circuits) {
    const votes = g.votes?.[c.id] || 0;
    const mine = g.myVotes?.[P.you] === c.id;
    const b = el("button", "prix-circuit" + (g.circuit === c.id ? " is-on" : "") + (mine ? " mine" : ""));
    b.type = "button";
    b.append(el("span", "pc-ico", c.ico));
    b.append(el("span", "pc-name", c.name));
    b.append(el("span", "pc-sub", c.sub));
    b.append(el("span", "pc-votes", votes ? `${votes} vote${votes === 1 ? "" : "s"}` : "no votes"));
    b.onclick = () => send({ type: "PRIX_VOTE", circuit: c.id });
    host.append(b);
  }
}

function drawLengths() {
  const g = P.game;
  const host = $("prix-lengths");
  host.textContent = "";
  for (const l of g.lengths) {
    const b = el("button", "ai-level" + (g.length === l.id ? " is-on" : ""));
    b.type = "button";
    b.disabled = !P.isHost;
    b.append(el("b", null, l.name));
    b.append(el("i", null, `${l.laps} laps · ${l.sub}`));
    b.onclick = () => send({ type: "PRIX_LENGTH", length: l.id });
    host.append(b);
  }
}

function drawClasses() {
  const g = P.game;
  const me = g.players.find((p) => p.uid === P.you);
  const host = $("prix-classes");
  host.textContent = "";
  const levels = (g.engines || []).find((e) => e.id === g.engine)?.levels || [];
  for (const c of levels) {
    const b = el("button", "ai-level" + (me?.klass === c.id ? " is-on" : ""));
    b.type = "button";
    b.append(el("b", null, c.name));
    b.append(el("i", null, `${c.sub} · ×${c.mult} MMR`));
    b.onclick = () => send({ type: "PRIX_CLASS", klass: c.id });
    host.append(b);
  }
}

// ── the track ────────────────────────────────────────────────────────

const ITEM_ICONS = {
  slipstream: "💨", nitro: "⚡", deflector: "🛡️", slick: "🪶",
  comet: "☄️", scrambler: "🌀", fog: "🌫️", flare: "🌞",
};
const itemName = (id) => P.game?.items?.find((i) => i.id === id)?.name || id;
const itemBlurb = (id) => P.game?.items?.find((i) => i.id === id)?.blurb || "";

/** The item in your hands, with what it does written on it. */
function drawHand() {
  const g = P.game;
  const host = $("prix-hand");
  if (!g) return;
  const me = g.players.find((p) => p.uid === P.you);
  const held = me?.holding;
  const spare = me?.holding2;
  const marks = [];
  // Telemetry: what the car in front is carrying. The room only sends this
  // to a racer who paid for it.
  const ahead = P.item?.ahead;
  if (ahead !== undefined) marks.push(ahead ? `\u{1F4E1} Ahead: ${itemName(ahead)}` : "\u{1F4E1} Ahead: empty hands");
  if (me?.deflector) marks.push(me.deflector > 1 ? `🛡️ Deflector up ×${me.deflector}` : "🛡️ Deflector up");
  if (me?.fogged) marks.push("🌫️ Fogged");
  if (me?.slowed) marks.push("🌞 Slowed");

  host.hidden = !held && !marks.length;
  host.textContent = "";
  if (held) {
    // The room says whether this can be fired from where you are. Only the
    // flare is ever refused, and only from the top three.
    const stuck = me?.canFire === false;
    const b = el("button", "prix-fire" + (stuck ? " is-stuck" : ""));
    b.type = "button";
    b.disabled = stuck;
    b.append(el("span", "pf-ico", ITEM_ICONS[held] || "🎁"));
    b.append(el("span", "pf-name", itemName(held)));
    b.append(el("span", "pf-blurb", stuck ? "Not from up here — a flare is fired from fourth or worse." : itemBlurb(held)));
    b.onclick = () => send({ type: "PRIX_USE" });
    host.append(b);
    if (stuck) {
      // Otherwise full hands wave every later box past for the rest of the
      // race, and there is nothing the racer can do about it.
      const d = el("button", "btn btn-tiny prix-drop", "Throw it away");
      d.type = "button";
      d.onclick = () => send({ type: "PRIX_DROP" });
      host.append(d);
    }
  }
  if (spare) marks.unshift(`🎁 ${itemName(spare)} in the other hand`);
  if (marks.length) host.append(el("p", "prix-marks", marks.join("   ")));
}

/** Something landed on you. */
function takeHit(msg) {
  if (msg.deflected) return flash(`${itemName(msg.item)} deflected.`);
  if (msg.shrugged) return flash(`${itemName(msg.item)} — the mudguards shrug it off.`);
  const said = {
    comet: `Comet. -${msg.metres} m`,
    slick: `Oil slick. -${msg.metres} m`,
    scrambler: "Scrambled.",
    fog: "Fogged.",
    flare: "Solar flare. Answers pay less.",
  }[msg.item] || "Hit.";
  flash(said, true);
}

function drawTrack() {
  const g = P.game;
  const host = $("prix-track");
  host.textContent = "";
  const field = g.players.filter((p) => !p.watching);
  if (!field.length) { host.append(el("p", "panel-sub", "Nobody on the grid yet.")); return; }
  // Watching rather than racing: the room sends the gallery every hand, so
  // the gallery is shown them. On the road you see only your own, which is
  // what makes an item a decision and Telemetry worth buying.
  const inStands = !!g.players.find((x) => x.uid === P.you)?.watching;

  const order = [...field].sort((a, b) => (a.place || 99) - (b.place || 99));
  for (const p of order) {
    const row = el("div", "prix-lane" + (p.uid === P.you ? " mine" : ""));
    row.append(el("span", "pl-place", p.place ? `${p.place}` : "-"));
    row.append(el("span", "pl-name", p.name));
    const road = el("div", "pl-road");
    // The boxes, and any oil lying about, drawn where they sit.
    for (const m of g.marks || []) {
      const dot = el("span", "pl-box");
      dot.style.left = `${Math.min(100, (m / g.total) * 100)}%`;
      if ((p.at || 0) >= m) dot.classList.add("gone");
      road.append(dot);
    }
    for (const m of g.slicks || []) {
      const oil = el("span", "pl-slick");
      oil.style.left = `${Math.min(100, (m / g.total) * 100)}%`;
      road.append(oil);
    }
    // Everybody drives what they picked in their profile.
    const kart = el("span", "pl-kart", kartById(p.kart).ico);
    kart.title = `${p.name} \u2014 ${kartById(p.kart).name}`;
    // The room moves a kart in steps; the slide between them is here, so it
    // reads as a race rather than a table of numbers.
    kart.style.left = `${Math.min(100, (p.at / g.total) * 100)}%`;
    road.append(kart);
    row.append(road);
    if (inStands) {
      const carried = [p.holding, p.holding2].filter(Boolean);
      const bits = carried.map((it) => ITEM_ICONS[it] || "🎁");
      if (p.deflector) bits.push(p.deflector > 1 ? `🛡️\u00d7${p.deflector}` : "🛡️");
      const strip = el("span", "pl-hand", bits.join(" "));
      strip.title = carried.length ? carried.map(itemName).join(", ") : "Empty hands";
      row.append(strip);
    }
    row.append(el("span", "pl-lap", p.done ? "FLAG" : `L${p.lap}/${g.laps}`));
    host.append(row);
  }
  const me = field.find((p) => p.uid === P.you);
  if (me && g.phase === "RACING") $("prix-phase").textContent = `Lap ${me.lap} of ${g.laps}`;
  drawHand();
  drawWaiting();
}

/**
 * Your race, once you are home. The word box goes, because answering into
 * a race you have finished is nonsense, and the rest of the field gets the
 * minute the room is giving them.
 */
function drawWaiting() {
  const g = P.game;
  const me = g?.players?.find((p) => p.uid === P.you);
  const done = !!me?.done && g?.phase === "RACING";
  const item = $("prix-item");
  const note = $("prix-waiting");
  if (item) item.hidden = done;
  if (!note) return;
  note.hidden = !done;
  if (!done) return;
  const left = Math.max(0, Math.round(((P.flagAt || 0) - Date.now()) / 1000));
  note.textContent = left
    ? `You took the flag. The rest of the field has ${left}s.`
    : "You took the flag. Waiting on the rest.";
}

// ── the item in your hands ───────────────────────────────────────────

function drawItem() {
  const it = P.item;
  if (!it) return;
  const kind = it.kind || "type";
  // The room sends the same item again when something it promised for
  // later arrives, or when a weapon lands. That is not a new deal: it must
  // not wipe what is already typed, and it must not play a memory sequence
  // over again, which would be handing the answer back.
  P.fresh = P.lastDeal !== it.dealtAt;
  P.lastDeal = it.dealtAt;

  // Everything that is not this engine's face goes away first.
  $("prix-letters").hidden = kind !== "type";
  $("prix-tiles").hidden = kind !== "tiles";
  $("prix-choices").hidden = kind !== "choice";
  const box = $("prix-guess");
  const go = $("btn-prix-guess");
  const typed = kind === "type" || kind === "number";
  box.hidden = !typed;
  go.hidden = !typed;

  $("prix-clue").textContent = clueFor(it);
  $("prix-clue").classList.toggle("held", kind === "type" && !it.clue);

  if (kind === "type") drawLetters(it);
  if (kind === "number") drawSum(it);
  if (kind === "tiles") drawTiles(it);
  if (kind === "choice") drawChoices(it);

  if (typed) {
    if (P.fresh) box.value = "";
    box.maxLength = kind === "number" ? 12 : it.len;
    box.inputMode = kind === "number" ? "decimal" : "text";
    box.placeholder = kind === "number" ? "The answer" : "The word";
    box.disabled = false;
    if (P.fresh) box.focus();
  }

  clearInterval(P.tick);
  P.tick = setInterval(runClock, 100);
  runClock();
}

/** The line above the item, in whichever engine's words. */
function clueFor(it) {
  if (it.kind === "number") return "What does it come to?";
  if (it.kind === "tiles") return "Watch the tiles, then tap them back in order.";
  if (it.kind === "choice") return it.question || "";
  return it.clue || (it.clueInMs > 0 ? "No clue yet \u2014 the letters are all you get." : "");
}

function drawLetters(it) {
  const host = $("prix-letters");
  host.textContent = "";
  for (const ch of it.scrambled || "") host.append(el("span", "ptile", ch));
  if (it.hint) host.append(el("p", "prix-hint", `Starts with ${it.hint}`));
}

/** A sum, written large, because that is the whole of the question. */
function drawSum(it) {
  const host = $("prix-letters");
  host.hidden = false;
  host.textContent = "";
  host.append(el("span", "psum", it.text || ""));
  // Grades 7-8 is half made of negatives and no phone's number pad carries
  // a minus sign, so the answer would be untypeable without this.
  const sign = el("button", "psign", "\u00b1");
  sign.type = "button";
  sign.title = "Make the answer negative";
  sign.onclick = () => {
    const box = $("prix-guess");
    box.value = box.value.startsWith("-") ? box.value.slice(1) : "-" + box.value;
    box.focus();
  };
  host.append(sign);
}

/**
 * The tiles light in order, then it is your turn. The sequence is on screen
 * for exactly as long as the room said, and the taps are collected here and
 * sent as one answer.
 */
function drawTiles(it) {
  const host = $("prix-tiles");
  host.textContent = "";
  P.taps = [];
  const pads = [];
  for (let i = 0; i < (it.tiles || 6); i++) {
    const b = el("button", `ptile-pad t${i}`);
    b.type = "button";
    b.disabled = true;
    b.onclick = () => {
      P.taps.push(i);
      b.classList.add("lit");
      setTimeout(() => b.classList.remove("lit"), 180);
      if (P.taps.length >= (it.len || it.seq.length)) {
        send({ type: "PRIX_GUESS", guess: P.taps.join(",") });
        P.taps = [];
      }
    };
    pads.push(b);
    host.append(b);
  }

  // Play it back, then hand the tiles over. An item that has been seen
  // before is redrawn without the playback: a fog bank or a scrambler
  // landing on a memory racer must not show them the sequence twice.
  if (!P.fresh) {
    for (const b of pads) b.disabled = false;
    return;
  }
  const flash = it.flashMs || 600;
  (it.seq || []).forEach((tile, n) => {
    setTimeout(() => { pads[tile]?.classList.add("lit"); }, n * flash);
    setTimeout(() => { pads[tile]?.classList.remove("lit"); }, n * flash + flash * 0.62);
  });
  setTimeout(() => { for (const b of pads) b.disabled = false; }, (it.seq || []).length * flash + 150);
}

/** Four answers, one tap. */
function drawChoices(it) {
  const host = $("prix-choices");
  host.textContent = "";
  (it.options || []).forEach((text, i) => {
    const b = el("button", "pchoice", text);
    b.type = "button";
    b.onclick = () => {
      for (const other of host.children) other.disabled = true;
      send({ type: "PRIX_GUESS", guess: String(i) });
    };
    host.append(b);
  });
  if (it.themeName) host.append(el("p", "prix-hint", it.themeName));
}

/** The allowance, drawn as a bar. Past it the bar is spent, not the round. */
function runClock() {
  const it = P.item;
  if (!it) { clearInterval(P.tick); P.tick = null; return; }
  const now = Date.now() - P.clockSkew;
  // Showing an item is not answering it, so the bar starts when the racer
  // is allowed to move and runs over what is left of the allowance.
  const lead = it.leadMs || 0;
  const gone = Math.max(0, now - it.dealtAt - lead);
  const span = Math.max(1, it.allowanceMs - lead);
  const left = Math.max(0, span - gone);
  const fill = $("prix-bar-fill");
  fill.style.width = `${Math.max(0, Math.min(100, (left / span) * 100))}%`;
  fill.className = gone <= span / 3 ? "full" : left > 0 ? "fading" : "spent";
  // A Spotter's skips do not wait for the allowance, which is the only
  // thing they are for.
  const spare = it.skips || 0;
  const skip = $("btn-prix-skip");
  skip.hidden = left > 0 && spare < 1;
  skip.textContent = left > 0 ? `Skip (${spare} left)` : "Skip";
  // The clue arrives partway through on the hardest class. The room is the
  // only thing that knows it is time, so ask it for the face again.
  if (!it.clue && it.clueInMs > 0 && now - it.dealtAt >= it.clueInMs && P.askedFor !== it.dealtAt) {
    P.askedFor = it.dealtAt;
    send({ type: "PRIX_PEEK" });
  }
}

function showResult(msg) {
  if (msg.ok) {
    // Only the words engine has a word to name; a sum or a sequence just
    // moves you.
    const bits = [msg.word ? `${msg.word} · +${msg.delta} m` : `Right · +${msg.delta} m`];
    if (msg.slowed) bits.push("(flared)");
    if (msg.box) bits.push(`🎁 ${itemName(msg.box)}`);
    flash(bits.join(" "));
  } else if (msg.spare) {
    // The one moment the token is visible. It read as a bug before.
    flash("Not that — your spare word covers it. Nothing lost.");
    const box = $("prix-guess");
    box.value = "";
    box.focus();
  } else if (msg.near) {
    // A real word from the same letters. Nothing lost; the clue is what
    // tells the two apart.
    flash("Right letters, wrong word. Read the clue.");
    const box = $("prix-guess");
    box.value = "";
    box.focus();
  } else {
    flash(`Not that. -${msg.delta * -1} m`, true);
    const box = $("prix-guess");
    box.value = "";
    box.focus();
  }
}

function flash(text, bad = false) {
  const n = $("prix-flash");
  n.textContent = text;
  n.className = "prix-flash" + (bad ? " bad" : " good");
}

// ── results ──────────────────────────────────────────────────────────

function drawResults(msg) {
  clearInterval(P.tick);
  P.tick = null;
  const host = $("prix-results");
  host.hidden = false;
  $("prix-race").hidden = true;
  const rows = msg.results || [];
  // Only one of the four engines deals words.
  const noun = { words: "words", maths: "sums", memory: "sequences", trivia: "answers" }[P.game?.engine] || "answers";
  host.innerHTML = `
    <div class="panel-head"><h2>The flag</h2></div>
    <div class="pad">
      <div class="belt-rows">
        ${rows.map((r) => `
          <div class="belt-row ${r.uid === P.you ? "is-mine" : ""}">
            <span class="rec-rank">${r.placement}</span>
            <span class="bn">${escapeHtml(r.name)}</span>
            <span class="pl-stat">${r.solved} ${noun} · ${r.spins} spin${r.spins === 1 ? "" : "s"}${r.fired ? ` · ${r.fired} fired` : ""}</span>
            <span class="bt">${r.score} · ${r.gain >= 0 ? "+" : ""}${r.gain} MMR</span>
          </div>`).join("")}
      </div>
      <p class="panel-sub">${rows.some((r) => r.status === "finished") ? "" : "Nobody took the flag before the cap."}</p>
    </div>`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── the paddock ──────────────────────────────────────────────────────

function addChat(m) {
  const host = $("prix-chat");
  const line = el("div", "pc-line" + (m.uid === P.you ? " mine" : ""));
  line.append(el("b", null, m.name));
  line.append(el("span", null, m.text));
  host.append(line);
  host.scrollTop = host.scrollHeight;
}

// ── controls ─────────────────────────────────────────────────────────

function wire() {
  $("btn-prix-solo").onclick = () => send({ type: "PRIX_SOLO", on: !P.game?.solo });
  $("btn-prix-start").onclick = () => { say(""); send({ type: "PRIX_START" }); };
  $("btn-prix-skip").onclick = () => send({ type: "PRIX_SKIP" });
  $("btn-prix-guess").onclick = submit;
  $("prix-guess").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  $("btn-prix-send").onclick = sayLine;
  $("prix-text").addEventListener("keydown", (e) => { if (e.key === "Enter") sayLine(); });
  $("btn-prix-leave").onclick = () => {
    if (P.isHost && P.game?.phase === "RACING") send({ type: "PRIX_END_MATCH" });
    const go = P.onLeave;
    closePrix();
    go?.();
  };
}

function submit() {
  const box = $("prix-guess");
  const word = box.value.trim().toUpperCase();
  if (!word) return;
  send({ type: "PRIX_GUESS", guess: word });
  box.value = "";
}

function sayLine() {
  const box = $("prix-text");
  const text = box.value.trim();
  if (!text) return;
  send({ type: "PRIX_SAY", text });
  box.value = "";
}

wire();
