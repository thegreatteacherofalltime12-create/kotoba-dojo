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

function say(text) {
  const n = $("mine-error");
  n.hidden = !text;
  n.textContent = text || "";
  if (text) setTimeout(() => { if (n.textContent === text) n.hidden = true; }, 4000);
}

function handle(msg) {
  switch (msg.type) {
    case "MINE_WELCOME": M.you = msg.you; M.isHost = !!msg.isHost; break;
    case "MINE_STATE": M.game = msg.game; drawShell(); break;
    case "MINE_START":
      M.shape = msg.shape;
      M.revealed = { ...msg.opening };
      M.flags = new Set();
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
      M.clock = msg.serverNow - Date.now();
      M.endsAt = msg.endsAt;
      drawBoard();
      runClock();
      break;
    case "MINE_DUG": Object.assign(M.revealed, msg.cells); paintCells(Object.keys(msg.cells)); break;
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
    case "MINE_OVER": showResults(msg); break;
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
        send({ type: "MINE_DIG", cell });
      };
      // Still there for anyone who prefers it, on a mouse.
      box.oncontextmenu = (e) => { e.preventDefault(); cancelHold(); send({ type: "MINE_FLAG", cell }); };
      grid.append(box);
    }
  }
  host.append(grid);
  paintCells(Object.keys(M.revealed));
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
    else if (n > 0) { box.textContent = String(n); box.classList.add(`n${n}`); }
  }
  const left = Math.max(0, (M.shape?.mines || 0) - M.flags.size);
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
    line.append(el("span", "hs-name", r.name));
    line.append(el("span", "hs-time", secs(r.ms)));
    body.append(line);
  });
}

// ── controls and results ────────────────────────────────────────────

export function bindMineControls() {
  $("btn-mine-solo").onclick = () => send({ type: "MINE_SOLO", on: !M.game?.solo });
  $("btn-mine-start").onclick = () => send({ type: "MINE_START" });
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
}
