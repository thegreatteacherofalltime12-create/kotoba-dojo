// Multiverse Grand Prix, client side.
//
// The room holds the answers and every metre of the track; this draws the
// grid, the word in your hands and the clock it is measured against, and
// sends guesses. Nothing here knows an answer before the room says so.

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

export async function enterPrix(code, getToken, onLeave) {
  P.code = code;
  P.onLeave = onLeave;
  P.item = null;
  $("prix-code").textContent = code;
  $("prix-results").hidden = true;
  $("prix-race").hidden = true;
  $("prix-chat").textContent = "";
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
const say = (text) => {
  const n = $("prix-error");
  n.textContent = text || "";
  n.hidden = !text;
};

// ── what the room says ───────────────────────────────────────────────

function handle(msg) {
  switch (msg.type) {
    case "PRIX_WELCOME":
      P.you = msg.you;
      P.isHost = !!msg.isHost;
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
      flash(`${msg.name} takes the flag.`);
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
    drawCircuits();
    drawLengths();
    drawClasses();
    const here = g.players.filter((p) => p.online).length;
    $("prix-note").textContent = g.solo
      ? "Solo. Begin whenever you are ready."
      : here < 2 ? "Waiting for at least one more racer." : `${here} on the grid.`;
  }
  drawTrack();
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
  for (const c of g.classes) {
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
  const marks = [];
  if (me?.deflector) marks.push("🛡️ Deflector up");
  if (me?.fogged) marks.push("🌫️ Fogged");
  if (me?.slowed) marks.push("🌞 Slowed");

  host.hidden = !held && !marks.length;
  host.textContent = "";
  if (held) {
    const b = el("button", "prix-fire");
    b.type = "button";
    b.append(el("span", "pf-ico", ITEM_ICONS[held] || "🎁"));
    b.append(el("span", "pf-name", itemName(held)));
    b.append(el("span", "pf-blurb", itemBlurb(held)));
    b.onclick = () => send({ type: "PRIX_USE" });
    host.append(b);
  }
  if (marks.length) host.append(el("p", "prix-marks", marks.join("   ")));
}

/** Something landed on you. */
function takeHit(msg) {
  if (msg.deflected) return flash(`${itemName(msg.item)} deflected.`);
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
    const kart = el("span", "pl-kart", p.uid === P.you ? "\u{1F3CE}️" : "\u{1F697}");
    // The room moves a kart in steps; the slide between them is here, so it
    // reads as a race rather than a table of numbers.
    kart.style.left = `${Math.min(100, (p.at / g.total) * 100)}%`;
    road.append(kart);
    row.append(road);
    row.append(el("span", "pl-lap", p.done ? "FLAG" : `L${p.lap}/${g.laps}`));
    host.append(row);
  }
  const me = field.find((p) => p.uid === P.you);
  if (me && g.phase === "RACING") $("prix-phase").textContent = `Lap ${me.lap} of ${g.laps}`;
  drawHand();
}

// ── the item in your hands ───────────────────────────────────────────

function drawItem() {
  const it = P.item;
  if (!it) return;
  $("prix-clue").textContent = it.clue || (it.clueInMs > 0 ? "No clue yet — the letters are all you get." : "");
  $("prix-clue").classList.toggle("held", !it.clue);

  const host = $("prix-letters");
  host.textContent = "";
  for (const ch of it.scrambled) host.append(el("span", "ptile", ch));
  if (it.hint) {
    const h = el("p", "prix-hint", `Starts with ${it.hint}`);
    host.append(h);
  }

  const box = $("prix-guess");
  box.value = "";
  box.maxLength = it.len;
  box.disabled = false;
  box.focus();
  // The flash is not cleared here on purpose: firing an item deals the next
  // word at once, and wiping it would mean nobody ever reads what their own
  // item just did.

  clearInterval(P.tick);
  P.tick = setInterval(runClock, 100);
  runClock();
}

/** The allowance, drawn as a bar. Past it the bar is spent, not the round. */
function runClock() {
  const it = P.item;
  if (!it) { clearInterval(P.tick); P.tick = null; return; }
  const now = Date.now() - P.clockSkew;
  const gone = now - it.dealtAt;
  const left = Math.max(0, it.allowanceMs - gone);
  const fill = $("prix-bar-fill");
  fill.style.width = `${Math.max(0, Math.min(100, (left / it.allowanceMs) * 100))}%`;
  fill.className = gone <= it.allowanceMs / 3 ? "full" : left > 0 ? "fading" : "spent";
  $("btn-prix-skip").hidden = left > 0;
  // The clue arrives partway through on the hardest class.
  if (!it.clue && it.clueInMs > 0 && gone >= it.clueInMs) {
    it.clue = "—";
    send({ type: "PING" });
  }
}

function showResult(msg) {
  if (msg.ok) {
    const bits = [`${msg.word} · +${msg.delta} m`];
    if (msg.slowed) bits.push("(flared)");
    if (msg.box) bits.push(`🎁 ${itemName(msg.box)}`);
    flash(bits.join(" "));
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
  host.innerHTML = `
    <div class="panel-head"><h2>The flag</h2></div>
    <div class="pad">
      <div class="belt-rows">
        ${rows.map((r) => `
          <div class="belt-row ${r.uid === P.you ? "is-mine" : ""}">
            <span class="rec-rank">${r.placement}</span>
            <span class="bn">${escapeHtml(r.name)}</span>
            <span class="pl-stat">${r.solved} words · ${r.spins} spin${r.spins === 1 ? "" : "s"}${r.fired ? ` · ${r.fired} fired` : ""}</span>
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
