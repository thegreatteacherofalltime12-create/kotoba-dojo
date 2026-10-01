// Match-3 Attack Arena, client side.
//
// The room runs every rule and sends the finished result of each move; this
// draws it. Nothing here decides what a swap did, how much charge it made or
// whether a word is right — the browser is handed the letters and the clue and
// sends a guess back, and the answer never reaches it.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const COLS = 6;
const ROWS = 10;
const RUBBLE = 9;
const GLYPH = ["◆", "●", "▲", "■", "★"];
/** How long a clear is shown before the well settles into what it left. */
const POP_MS = 230;

export const M = {
  socket: null, code: null, you: null, state: null, onLeave: null, beat: null, tick: null,
  skew: 0,            // server clock minus ours
  anim: false,        // a cascade is being drawn
  pending: null,      // a state that arrived while it was
  shown: null,        // the board you are looking at, which lags the room while a cascade plays
  sel: null,          // the tile you tapped first
  drag: null,
  lockUntil: 0,
};

export async function enterMatch3(code, getToken, onLeave) {
  M.code = code;
  M.onLeave = onLeave;
  M.state = null; M.shown = null; M.pending = null; M.anim = false; M.sel = null;
  $("m3-code").textContent = code;
  $("m3-results").hidden = true;
  $("m3-error").hidden = true;
  await connect(getToken);
}

async function connect(getToken) {
  closeMatch3(false);
  const token = await getToken();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/match3/${M.code}/ws?token=${encodeURIComponent(token)}`);
  M.socket = ws;
  ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch { /* ignore */ } };
  ws.onclose = () => {
    clearInterval(M.beat); M.beat = null;
    if (M.code) setTimeout(() => { if (M.code) connect(getToken); }, 1500);
  };
  clearInterval(M.beat);
  M.beat = setInterval(() => send({ type: "PING" }), 30_000);
  clearInterval(M.tick);
  M.tick = setInterval(drawClock, 200);
}

export function closeMatch3(forget = true) {
  if (M.socket) { M.socket.onclose = null; M.socket.close(); M.socket = null; }
  if (forget) { M.code = null; clearInterval(M.tick); M.tick = null; }
}

const send = (o) => { if (M.socket?.readyState === WebSocket.OPEN) M.socket.send(JSON.stringify(o)); };
const now = () => Date.now() - M.skew;

function say(text, good = false) {
  const n = $("m3-error");
  n.hidden = !text;
  n.className = good ? "notice" : "notice notice-bad";
  n.textContent = text || "";
  if (text) setTimeout(() => { if (n.textContent === text) n.hidden = true; }, 2600);
}

/* ── what the room says ──────────────────────────────────────────── */

function handle(msg) {
  switch (msg.type) {
    case "M3_WELCOME": M.you = msg.you; break;
    case "M3_STATE":
      M.skew = Date.now() - (msg.state?.now || Date.now());
      if (M.anim) { M.pending = msg.state; break; }
      M.state = msg.state;
      draw();
      break;
    case "M3_START": $("m3-results").hidden = true; say(""); break;
    case "M3_RESULT": playResult(msg); break;
    case "M3_REJECT": say(msg.why); break;
    case "M3_WRONG":
      M.lockUntil = Date.now() + (msg.wait || 1200);
      $("m3-word").classList.remove("shake"); void $("m3-word").offsetWidth; $("m3-word").classList.add("shake");
      say("Not that word.");
      drawWord();
      break;
    case "M3_SOLVED":
      $("m3-guess").value = "";
      say(msg.send > 0
        ? `${msg.word} — launched ${msg.send}${msg.cancel ? `, ${msg.cancel} cancelled incoming` : ""}.`
        : `${msg.word} — solved, but there was no charge to send.`, true);
      break;
    case "M3_OVER": showResults(msg); break;
  }
}

/* ── drawing the wells ───────────────────────────────────────────── */

/** A well of ROWS x COLS cells, built once and repainted: sixty buttons are not worth rebuilding every move. */
function paint(host, board, { mine = false, flash = null, land = null } = {}) {
  let grid = host.firstElementChild;
  if (!grid) {
    grid = el("div", "m3-grid");
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = el("div", "m3c");
      cell.dataset.r = r; cell.dataset.c = c;
      grid.append(cell);
    }
    host.append(grid);
  }
  const hot = new Set((flash || []).map(([r, c]) => `${r},${c}`));
  const fall = new Set((land || []).map(([r, c]) => `${r},${c}`));
  for (let i = 0; i < grid.children.length; i++) {
    const cell = grid.children[i];
    const r = Math.floor(i / COLS), c = i % COLS;
    const v = board?.[r]?.[c];
    let cls = "m3c";
    if (v === null || v === undefined) cls += " empty";
    else if (v === RUBBLE) cls += " rubble";
    else cls += ` t${v}`;
    if (hot.has(`${r},${c}`)) cls += " pop";
    if (fall.has(`${r},${c}`)) cls += " drop";
    if (mine && M.sel && M.sel[0] === r && M.sel[1] === c) cls += " sel";
    if (cell.className !== cls) cell.className = cls;
    const text = v !== null && v !== undefined && v !== RUBBLE ? GLYPH[v] : v === RUBBLE ? "▦" : "";
    if (cell.textContent !== text) cell.textContent = text;
  }
}

function draw() {
  const s = M.state;
  if (!s) return;
  const playing = s.phase === "PLAYING";
  $("m3-phase").textContent = playing ? "In the arena" : s.phase === "OVER" ? "Match over" : "Lobby";

  $("m3-host").hidden = !(s.isHost && s.phase !== "PLAYING");
  $("m3-wait").hidden = s.phase !== "LOBBY" || s.isHost;
  $("m3-game").hidden = s.phase === "LOBBY";
  const two = (s.people || []).length >= 2;
  $("btn-m3-start").textContent = s.phase === "OVER" ? "Fight again" : two ? "Begin the match" : "Play the computer";
  $("m3-level-row").hidden = two;
  $("m3-lobby-note").textContent = two
    ? `${s.people.map((p) => p.name).join(" and ")} are here.`
    : `Waiting for an opponent — share the code ${s.code} — or play the computer.`;
  if (s.aiLevel) $("m3-level").value = s.aiLevel;

  if (s.phase === "LOBBY") return;

  const me = s.me, foe = s.foe;
  if (me) {
    if (!M.anim) M.shown = me.board;
    paint($("m3-me-grid"), M.shown || me.board, { mine: true });
    $("m3-me-name").textContent = me.name;
    $("m3-me-charge").style.width = `${Math.round((me.charge / me.maxCharge) * 100)}%`;
    $("m3-me-charge-n").textContent = String(me.charge);
    $("m3-me-in").textContent = me.incoming ? `⚠ ${me.incoming} rubble coming` : "";
    $("m3-me-in").hidden = !me.incoming;
  }
  if (foe) {
    paint($("m3-foe-grid"), foe.board);
    $("m3-foe-name").textContent = `${foe.name}${foe.ai ? " (cpu)" : ""}`;
    $("m3-foe-charge").style.width = `${Math.round((foe.charge / (me?.maxCharge || 30)) * 100)}%`;
    $("m3-foe-charge-n").textContent = String(foe.charge);
    $("m3-foe-in").textContent = foe.incoming ? `${foe.incoming} on its way` : "";
    $("m3-foe-in").hidden = !foe.incoming;
    $("m3-foe-grid").classList.toggle("is-over", !!foe.over);
  }
  $("m3-me-grid").classList.toggle("is-over", !!me?.over);
  drawWord();
  const feed = $("m3-feed");
  feed.textContent = "";
  for (const e of (s.feed || []).slice(-5)) feed.append(el("div", "m3-ev", e.text));
  drawClock();
}

function drawWord() {
  const w = M.state?.me?.word;
  const live = M.state?.phase === "PLAYING" && !M.state?.me?.over && !!w;
  $("m3-word").hidden = !live;
  if (!live) return;
  const host = $("m3-letters");
  const text = w.scrambled;
  if (host.dataset.word !== text) {
    host.dataset.word = text;
    host.textContent = "";
    for (const ch of text) host.append(el("span", "m3-letter", ch));
    $("m3-guess").maxLength = w.len;
    $("m3-guess").value = "";
  }
  $("m3-clue").textContent = w.clue;
  const locked = Date.now() < M.lockUntil;
  $("btn-m3-go").disabled = locked;
  const charge = M.state.me.charge;
  $("m3-hint").textContent = charge > 0
    ? `Solve it to send your ${charge} charge across.`
    : "Clear tiles to build charge — then solve a word to send it.";
}

/** The clock and the two rise bars, which move without the room saying anything. */
function drawClock() {
  const s = M.state;
  if (!s || s.phase !== "PLAYING") return;
  const left = Math.max(0, Math.round((s.endsAt - now()) / 1000));
  $("m3-clock").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  for (const [who, id] of [[s.me, "m3-me-rise"], [s.foe, "m3-foe-rise"]]) {
    if (!who) continue;
    const span = who.riseMs || 6000;
    const into = Math.min(1, Math.max(0, 1 - (who.riseAt - now()) / span));
    $(id).style.width = `${Math.round(into * 100)}%`;
  }
  if (M.lockUntil && Date.now() >= M.lockUntil) { M.lockUntil = 0; drawWord(); }
}

/* ── your move, drawn ────────────────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The cascade the room worked out, played back: what cleared, then the well as
 * it settled, a step at a time. The room's picture of each step is what gets
 * drawn, so what you see is exactly what happened.
 */
async function playResult(msg) {
  M.anim = true;
  const host = $("m3-me-grid");
  let board = (M.shown || M.state?.me?.board || []).map((row) => row.slice());
  const a = M.lastSwap?.[0], b = M.lastSwap?.[1];
  if (a && b) { const t = board[a[0]][a[1]]; board[a[0]][a[1]] = board[b[0]][b[1]]; board[b[0]][b[1]] = t; }
  M.sel = null;
  for (const step of msg.steps) {
    paint(host, board, { mine: true, flash: [...step.cells, ...step.rubble] });
    await sleep(POP_MS);
    board = step.after;
    paint(host, board, { mine: true });
    await sleep(70);
  }
  M.shown = msg.board;
  paint(host, msg.board, { mine: true, land: msg.landed });
  if (msg.landed?.length) say(`${msg.landed.length} rubble landed.`);
  if (msg.shuffled) say("No moves left — the well was shaken up.", true);
  M.anim = false;
  if (M.pending) { M.state = M.pending; M.pending = null; }
  draw();
}

/** A swap, as the room will judge it. */
function trySwap(a, b) {
  if (M.anim || M.state?.phase !== "PLAYING" || M.state?.me?.over) return;
  M.lastSwap = [a, b];
  send({ type: "M3_SWAP", a, b });
}

function cellAt(ev) {
  // A press is on whatever it landed on. Only a drag has to ask what is under
  // the finger now, because the browser keeps sending events to the tile it
  // started on.
  const t = ev.type === "pointerdown" ? ev.target : (document.elementFromPoint(ev.clientX, ev.clientY) || ev.target);
  const c = t?.closest?.(".m3c");
  if (!c || !$("m3-me-grid").contains(c)) return null;
  return [Number(c.dataset.r), Number(c.dataset.c)];
}

const adjacent = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

/* ── results ─────────────────────────────────────────────────────── */

function showResults(msg) {
  const box = $("m3-results");
  box.hidden = false;
  box.textContent = "";
  const mine = msg.results.find((r) => r.uid === M.you);
  box.append(el("h2", null, !mine ? "Match over" : mine.placement === 1 ? "You win" : "You lose"));
  box.append(el("p", "panel-sub", msg.reason === "time" ? "Time ran out — the harder hitter wins." : msg.reason === "ended" ? "The host called it." : "A stack overflowed."));
  const list = el("ol", "m3-results-list");
  for (const r of msg.results) {
    const row = el("li");
    row.append(el("b", null, `${r.placement}. ${r.name}${r.ai ? " (cpu)" : ""}`));
    row.append(el("span", null, ` ${r.score} pts · ${r.sent} sent · ${r.solved} words · best chain ${r.maxChain}`));
    if (!r.ai) row.append(el("i", null, ` ${r.gain >= 0 ? "+" : ""}${r.gain} MMR · ${r.belt}`));
    list.append(row);
  }
  box.append(list);
}

/* ── controls ────────────────────────────────────────────────────── */

export function bindMatch3Controls() {
  $("btn-m3-leave").onclick = () => { send({ type: "M3_END" }); closeMatch3(); M.onLeave?.(); };
  $("btn-m3-start").onclick = () => send({
    type: "M3_START",
    solo: (M.state?.people || []).length < 2,
    level: $("m3-level").value,
  });

  const submit = () => {
    const word = $("m3-guess").value.trim();
    if (word) send({ type: "M3_GUESS", word });
  };
  $("btn-m3-go").onclick = submit;
  $("m3-guess").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  $("btn-m3-skip").onclick = () => send({ type: "M3_SKIP" });

  // A tile is moved by dragging it onto a neighbour, or by tapping it and then
  // the neighbour: a finger and a mouse do the same thing.
  const grid = $("m3-me-grid");
  grid.addEventListener("pointerdown", (ev) => {
    const at = cellAt(ev);
    if (!at) return;
    M.drag = at;
    if (M.sel && adjacent(M.sel, at)) { const from = M.sel; M.sel = null; M.drag = null; trySwap(from, at); return; }
    M.sel = at;
    if (M.state?.me) paint(grid, M.shown || M.state.me.board, { mine: true });
    ev.preventDefault();
  });
  grid.addEventListener("pointermove", (ev) => {
    if (!M.drag) return;
    const at = cellAt(ev);
    if (at && adjacent(M.drag, at)) { const from = M.drag; M.drag = null; M.sel = null; trySwap(from, at); }
  });
  const up = () => { M.drag = null; };
  grid.addEventListener("pointerup", up);
  grid.addEventListener("pointercancel", up);
}
