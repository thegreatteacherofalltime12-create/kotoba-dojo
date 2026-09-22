// Minesweeper, client side. The layout lives on the server; this draws only
// what has been uncovered for this player.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const FLAG_HOLD_MS = 2000;

export const M = {
  socket: null, code: null, you: null, isHost: false,
  game: null, shape: null,
  revealed: {}, flags: new Set(),
  craters: new Set(),  // mines busted out of your board
  arsenal: null,       // what you armed, from the room
  mode: null,          // buster / clear while a token is being aimed
  shieldUntil: 0, shieldTick: null,
  clock: 0, endsAt: 0, tick: null, scores: null,
  started: 0, onLeave: null, beat: null,
};

export async function enterMines(code, getToken, onLeave) {
  M.code = code;
  M.onLeave = onLeave;
  M.revealed = {};
  M.flags = new Set();
  $("mine-code").textContent = code;
  $("mine-results").hidden = true;
  loadScores();
  await connectMines(getToken);
}

async function connectMines(getToken) {
  closeMines(false);
  const token = await getToken();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/mines/${M.code}/ws?token=${encodeURIComponent(token)}`);
  M.socket = ws;
  ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch { /* ignore */ } };
  ws.onclose = () => {
    clearInterval(M.beat);
    M.beat = null;
    if (M.code) setTimeout(() => { if (M.code) connectMines(getToken); }, 1500);
  };

  // Keeps the field listed while it waits for sweepers.
  clearInterval(M.beat);
  M.beat = setInterval(() => send({ type: "PING" }), 30_000);
}

export function closeMines(forget = true) {
  if (M.socket) { M.socket.onclose = null; M.socket.close(); M.socket = null; }
  clearInterval(M.tick);
  M.tick = null;
  if (forget) M.code = null;
}

const send = (o) => { if (M.socket?.readyState === WebSocket.OPEN) M.socket.send(JSON.stringify(o)); };

let tokens = null;
const tokenTab = () => (tokens ||= applyTokenTab({ game: "minesweeper", send, button: $("btn-mine-boost"), label: "round", arsenal: MINE_ARSENAL_ITEMS }));

function say(text) {
  const n = $("mine-error");
  n.hidden = !text;
  n.textContent = text || "";
  if (text) setTimeout(() => { if (n.textContent === text) n.hidden = true; }, 4000);
}

function handle(msg) {
  switch (msg.type) {
    case "MINE_WELCOME": M.you = msg.you; M.isHost = !!msg.isHost; break;
    case "MINE_STATE": M.game = msg.game; drawShell(); drawArsenal(); break;
    case "MINE_START":
      M.shape = msg.shape;
      M.revealed = { ...msg.opening };
      M.flags = new Set();
      M.craters = new Set();
      M.mode = null; M.shieldUntil = 0;
      M.clock = msg.serverNow - Date.now();
      M.endsAt = msg.endsAt;
      $("mine-results").hidden = true;
      drawBoard();
      runClock();
      break;
    case "MINE_RESUME":
      M.shape = msg.shape;
      M.revealed = { ...msg.revealed };
      M.flags = new Set(msg.flags || []);
      M.craters = new Set(msg.craters || []);
      M.clock = msg.serverNow - Date.now();
      M.endsAt = msg.endsAt;
      drawBoard();
      runClock();
      break;
    case "MINE_DUG":
      Object.assign(M.revealed, msg.cells);
      for (const c of msg.craters || []) M.craters.add(c);
      paintCells([...Object.keys(msg.cells), ...(msg.craters || [])]);
      break;
    case "MINE_ARSENAL_STATE":
      M.arsenal = msg.arsenal;
      tokenTab().arsenalState(msg.arsenal);
      drawArsenal();
      break;
    case "MINE_SHIELD":
      M.shieldUntil = Date.now() + (msg.until - msg.serverNow);
      $("mine-face").textContent = "\u{1F607}";
      drawArsenal();
      break;
    case "MINE_NOTE": say(msg.text); break;
    case "MINE_FLAGS":
      for (const c of msg.cells || []) M.flags.add(c);
      paintCells(msg.cells || []);
      break;
    case "MINE_FLAGGED":
      if (msg.on) M.flags.add(msg.cell); else M.flags.delete(msg.cell);
      paintCells([msg.cell]);
      break;
    case "MINE_BOOM":
      M.revealed[msg.cell] = -1;
      for (const m of msg.mines) if (M.revealed[m] === undefined) M.revealed[m] = -2;
      paintCells([...msg.mines, msg.cell]);
      $("mine-face").textContent = "😵";
      break;
    case "MINE_CLEARED":
      if (msg.uid === M.you) $("mine-face").textContent = "😎";
      break;
    case "MINE_OVER": showResults(msg); tokenTab().reset(); break;
    case "MINE_TOKENS": tokenTab().receive(msg); if (msg.arsenal) { M.arsenal = msg.arsenal; drawArsenal(); } break;
    case "MINE_SCORES_STALE": loadScores(); break;
    case "MINE_ERROR": say(msg.message); break;
  }
}

// ── shell ───────────────────────────────────────────────────────────

function drawShell() {
  const g = M.game;
  if (!g) return;

  const hosting = M.isHost && g.phase !== "ACTIVE";
  $("mine-host").hidden = !hosting;
  $("mine-phase").textContent =
    g.phase === "ACTIVE" ? `Round ${g.round}` : g.phase === "RESULTS" ? "Round over" : "Waiting";

  if (hosting) {
    $("btn-mine-solo").classList.toggle("on", !!g.solo);
    $("btn-mine-solo").setAttribute("aria-checked", String(!!g.solo));

    const levels = $("mine-levels");
    levels.textContent = "";
    for (const l of g.levels) {
      const b = el("button", "ai-pick" + (g.level === l.id ? " on" : ""));
      b.type = "button";
      b.append(el("span", "ai-name", l.name));
      b.append(el("span", "ai-blurb", l.blurb));
      b.onclick = () => send({ type: "MINE_LEVEL", level: l.id });
      levels.append(b);
    }

    const here = g.players.filter((p) => p.online).length;
    const short = !g.solo && here < 2;
    $("btn-mine-start").disabled = short;
    $("btn-mine-start").textContent = g.solo ? "Begin solo sweep" : "Begin the round";
    $("mine-note").textContent = g.solo
      ? "Solo sweep. Begin whenever you're ready."
      : short ? "Waiting for at least one more sweeper."
      : `${here} sweepers here. Everyone gets the same board.`;
  }

  drawScores();

  const board = $("mine-standings");
  board.textContent = "";
  for (const p of [...g.players].sort((a, z) => z.progress - a.progress)) {
    const li = el("li", p.done ? (p.won ? "cleared" : "out") : "");
    li.append(el("span", "ms-name", p.name + (p.uid === M.you ? " (you)" : "")));
    if (p.watching) li.append(el("span", "ms-tag", "watching"));
    else if (p.done) li.append(el("span", "ms-tag", p.won ? "cleared" : "out"));
    const bar = el("div", "ms-bar");
    bar.append(Object.assign(el("span"), { style: `width:${p.progress}%` }));
    li.append(bar);
    li.append(el("span", "ms-pct", `${p.progress}%`));
    board.append(li);
  }
}

function runClock() {
  clearInterval(M.tick);
  const run = () => {
    const left = Math.max(0, M.endsAt - (Date.now() + M.clock));
    const t = Math.round(left / 1000);
    $("mine-timer").textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    if (left <= 0) clearInterval(M.tick);
  };
  run();
  M.tick = setInterval(run, 1000);
}

// ── board ───────────────────────────────────────────────────────────

function drawBoard() {
  const { rows, cols, mines } = M.shape;
  const host = $("mine-grid");
  host.textContent = "";
  $("mine-face").textContent = "🙂";
  $("mine-count").textContent = String(mines).padStart(3, "0");

  const grid = el("div", "mgrid");
  grid.style.setProperty("--cols", String(cols));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = `${r},${c}`;
      const box = el("button", "mcell");
      box.type = "button";
      box.dataset.cell = cell;
      // Pointer events rather than touch events, so a mouse and a thumb take
      // exactly the same path and the behaviour is identical on both.
      let hold = null;
      let flagged = false;

      const startHold = () => {
        flagged = false;
        clearTimeout(hold);
        box.classList.add("holding");
        hold = setTimeout(() => {
          hold = null;
          flagged = true;                       // so the release doesn't dig
          box.classList.remove("holding");
          send({ type: "MINE_FLAG", cell });
          navigator.vibrate?.(30);
        }, FLAG_HOLD_MS);
      };
      const cancelHold = () => {
        clearTimeout(hold);
        hold = null;
        box.classList.remove("holding");
      };

      box.addEventListener("pointerdown", (e) => {
        if (e.button > 0) return;               // right-click has its own path
        startHold();
      });
      box.addEventListener("pointerup", cancelHold);
      box.addEventListener("pointerleave", cancelHold);
      box.addEventListener("pointercancel", cancelHold);

      box.onclick = () => {
        // A press that became a flag is not also a dig.
        if (flagged) { flagged = false; return; }
        const aimed = MINE_ARSENAL_ITEMS.find((t) => t.act === M.mode && t.aim === "cell");
        if (aimed) {
          const what = M.mode === "clear"
            ? "Clear the 5\u00d75 around this square? A mine inside it ends your sweep."
            : aimed.name + " here?";
          if (!window.confirm(what)) return;
          send({ type: "MINE_ARSENAL", action: M.mode, cell });
          M.mode = null;
          grid.classList.remove("aiming");
          grid.querySelectorAll(".blast").forEach((n) => n.classList.remove("blast"));
          drawArsenal();
          return;
        }
        send({ type: "MINE_DIG", cell });
      };
      box.onmouseenter = () => {
        const span = M.mode === "clear" ? 2 : M.mode === "recon" || M.mode === "detect" ? 1 : 0;
        if (!span) return;
        grid.querySelectorAll(".blast").forEach((n) => n.classList.remove("blast"));
        const [r0, c0] = cell.split(",").map(Number);
        for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) {
          const n = grid.querySelector(`[data-cell="${r0 + i},${c0 + j}"]`);
          if (n && !n.classList.contains("open")) n.classList.add("blast");
        }
      };
      box.onmouseleave = () => { grid.querySelectorAll(".blast").forEach((n) => n.classList.remove("blast")); };
      // Still there for anyone who prefers it, on a mouse.
      box.oncontextmenu = (e) => { e.preventDefault(); cancelHold(); send({ type: "MINE_FLAG", cell }); };
      grid.append(box);
    }
  }
  host.append(grid);
  paintCells(Object.keys(M.revealed));
  drawArsenal();
}

// ── the arsenal strip ───────────────────────────────────────────────
function drawArsenal() {
  const host = $("mine-arsenal");
  if (!host) return;
  const ars = M.arsenal;
  const me = M.game?.players?.find((p) => p.uid === M.you);
  const live = M.game?.phase === "ACTIVE" && M.shape && me && !me.done && !me.watching;
  const left = (k) => (ars?.armed?.[k] || 0) - (ars?.used?.[k] || 0);
  const any = ars && MINE_ARSENAL_ITEMS.some((t) => left(t.key) > 0);
  const shielded = M.shieldUntil > Date.now();
  host.hidden = !(live && (any || shielded || ars?.gloves > 0 || ars?.second));
  host.textContent = "";
  $("mine-grid").querySelector(".mgrid")?.classList.toggle("aiming", !!M.mode && !host.hidden);
  if (host.hidden) { M.mode = null; clearInterval(M.shieldTick); M.shieldTick = null; return; }

  host.append(el("span", "ars-label", "Arsenal"));
  const mk = (label, on, disabled, click, title) => {
    const b = el("button", "ars-btn" + (on ? " on" : ""), label);
    b.type = "button"; b.disabled = !!disabled; if (title) b.title = title;
    b.onclick = click;
    host.append(b);
  };
  for (const t of MINE_ARSENAL_ITEMS) {
    const n = left(t.key);
    if (n <= 0) continue;
    if (t.act === "shield" && shielded) continue;
    const short = t.name.replace("Sapper's ", "").replace(" Charge", "").replace(" Patrol", "").replace(" Sweep", (t.act === "second" ? " Sweep" : ""));
    const label = t.icon + " " + short + " \u00d7" + n;
    const off =
      (t.act === "buster" && !ars.canBust) ||
      (t.act === "clear" && ars.digs > 0) ||
      (t.act === "opening" && ars.digs > 0) ||
      (t.act === "second" && ars.second) ||
      (t.act === "promo" && ars.promo);
    const title =
      t.act === "buster" && !ars.canBust ? "Intermediate and Expert fields only"
      : (t.act === "clear" || t.act === "opening") && ars.digs > 0 ? "Only before you have dug anything"
      : t.blurb;
    mk(label, false, off, () => {
      if (t.aim === "cell") { M.mode = M.mode === t.act ? null : t.act; drawArsenal(); return; }
      if (t.aim === "line") { askLine(t); return; }
      if (!window.confirm(t.name + "? " + t.blurb)) return;
      send({ type: "MINE_ARSENAL", action: t.act });
    }, title);
  }
  if (shielded)
    mk("\u{1F6E1}\uFE0F " + Math.ceil((M.shieldUntil - Date.now()) / 1000) + "s", true, true, () => {}, "Invincible");
  if (ars.gloves > 0)
    mk("\u{1F9E4} " + ars.gloves + " left", true, true, () => {}, "Mines the gloves will defuse");
  if (ars.second)
    mk("\u267B\uFE0F Ready", true, true, () => {}, "One mine will not end your sweep");

  const aiming = MINE_ARSENAL_ITEMS.find((t) => t.act === M.mode);
  if (aiming) {
    const p = el("p", "ars-hint", aiming.name + " \u2014 tap the square. ");
    const x = el("button", "btn btn-tiny", "Cancel");
    x.type = "button"; x.onclick = () => { M.mode = null; drawArsenal(); };
    p.append(x);
    host.append(p);
  }
  // What the scouts have found, newest first.
  if (ars.intel?.length) {
    const p = el("p", "ars-hint", ars.intel.map((x) => x.text).join("  \u00b7  "));
    p.className = "ars-hint ars-intel";
    host.append(p);
  }
  clearInterval(M.shieldTick); M.shieldTick = null;
  if (shielded) M.shieldTick = setInterval(() => { if (M.shieldUntil <= Date.now()) { $("mine-face").textContent = "\u{1F642}"; } drawArsenal(); }, 1000);
}

/** A row or a column, for the radar. */
function askLine(t) {
  const answer = window.prompt("Radar Sweep \u2014 which line? A row as R then its number, a column as C then its number (R1 to R" + (M.shape?.rows || 0) + ", C1 to C" + (M.shape?.cols || 0) + ").", "R1");
  if (!answer) return;
  const m = /^\s*([rcRC])\s*(\d+)\s*$/.exec(answer);
  if (!m) return say("That is not a line. Try R3, or C7.");
  const n = Number(m[2]) - 1;
  const max = m[1].toLowerCase() === "r" ? (M.shape?.rows || 0) : (M.shape?.cols || 0);
  if (!(n >= 0 && n < max)) return say("There is no line there.");
  send({ type: "MINE_ARSENAL", action: "radar", line: m[1].toLowerCase() + n });
}

function paintCells(cells) {
  for (const cell of cells) {
    const box = $("mine-grid").querySelector(`[data-cell="${cell}"]`);
    if (!box) continue;
    const n = M.revealed[cell];

    box.className = "mcell";
    box.textContent = "";

    if (M.flags.has(cell) && n === undefined) { box.textContent = "🚩"; box.classList.add("flagged"); continue; }
    if (n === undefined) continue;

    box.classList.add("open");
    box.disabled = true;
    if (n === -1) { box.classList.add("boom"); box.textContent = "💣"; }
    else if (n === -2) { box.classList.add("shown"); box.textContent = "💣"; }
    else if (n === -3) { box.classList.add("known"); box.textContent = "💣"; }
    else if (n > 0) { box.textContent = String(n); box.classList.add(`n${n}`); }
    if (M.craters.has(cell)) box.classList.add("crater");
  }
  const known = Object.values(M.revealed).filter((v) => v === -3).length;
  const left = Math.max(0, (M.shape?.mines || 0) - M.craters.size - M.flags.size - known);
  $("mine-count").textContent = String(left).padStart(3, "0");
}

// ── high scores ─────────────────────────────────────────────────────

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

export async function loadScores() {
  try {
    const res = await fetch("/api/mines/scores");
    M.scores = (await res.json()).scores || {};
  } catch { M.scores = null; }
  drawScores();
}

function drawScores() {
  const level = M.game?.level || M.shape?.level || "beginner";
  const rows = (M.scores && M.scores[level]) || [];
  const name = (M.game?.levels || []).find((l) => l.id === level)?.name || level;

  $("mine-scores").querySelector(".hs-title").textContent = `Fastest Clears — ${name}`;
  const body = $("mine-score-body");
  body.textContent = "";

  if (!rows.length) {
    body.append(el("div", "hs-empty", "No board cleared yet. Be first."));
    return;
  }
  rows.slice(0, 5).forEach((r, i) => {
    const line = el("div", "hs-row" + (r.uid === M.you ? " mine" : ""));
    line.append(el("span", "hs-rank", `${i + 1}.`));
    line.append(el("span", "hs-name", r.name + (r.assisted ? " \u26A1" : "")));
    line.append(el("span", "hs-time", secs(r.ms)));
    body.append(line);
  });
  // A clear that had a token behind it says so, here and in Records.
  if (rows.slice(0, 5).some((r) => r.assisted))
    body.append(el("div", "hs-legend", "\u26A1 set with a token"));
}

// ── controls and results ────────────────────────────────────────────

export function bindMineControls() {
  $("btn-mine-solo").onclick = () => send({ type: "MINE_SOLO", on: !M.game?.solo });
  $("btn-mine-start").onclick = () => send({ type: "MINE_START" });
  tokenTab();
  $("btn-mine-leave").onclick = () => {
    if (M.shape && !confirm("End the match and take the MMR you've earned so far?")) return;
    send({ type: "MINE_END_MATCH" });
    closeMines(); M.onLeave?.();
  };
}

function showResults(msg) {
  const host = $("mine-results");
  host.hidden = false;
  host.textContent = "";
  host.append(el("h3", "", "Round over"));
  if (msg.bounty && (msg.bounty.claim || msg.bounty.defend)) {
    const card = el("div");
    card.innerHTML = window.__bountyCard ? window.__bountyCard(msg.bounty) : "";
    host.append(card);
  }
  const list = el("ol", "results-list");
  msg.results.forEach((r, i) => {
    const li = el("li", r.status === "cleared" ? "" : "dnf");
    li.append(el("span", "rank", String(i + 1)));
    li.append(el("span", "who", r.name));
    li.append(el("span", "time", r.status === "cleared"
      ? `${Math.round((r.elapsedMs || 0) / 1000)}s`
      : "hit a mine"));
    li.append(el("span", "gain", `+${r.gain}`));
    li.append(el("span", "pts", String(r.score)));
    list.append(li);
  });
  host.append(list);
}import { applyTokenTab, MINE_ARSENAL_ITEMS } from "./boost.js";

