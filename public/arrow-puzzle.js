// Arrow Puzzle Tap Away — client side.
//
// Tap blocks to clear a path to the edge in the direction they point.
// Three multiplayer modes (Race / Turn-based / Collaborative) plus Solo.
// Two visual modes: 2D flat grid and 3D isometric canvas — toggle on the board.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

export const AP = {
  socket: null, code: null, you: null, state: null, onLeave: null, beat: null,
  visual: "2d",   // current visual mode for THIS client ("2d" or "3d")
  closing: null,
};

const CLOSE_AFTER_S = 15;

export async function enterArrow(code, getToken, onLeave) {
  AP.code = code;
  AP.onLeave = onLeave;
  AP.state = null;
  AP.visual = "2d";
  stopClosing();
  $("ap-code").textContent = code;
  $("ap-chatlog").textContent = "";
  $("ap-results").hidden = true;
  $("ap-error").hidden = true;
  await connect(getToken);
}

async function connect(getToken) {
  closeArrow(false);
  const token = await getToken();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/arrows/${AP.code}/ws?token=${encodeURIComponent(token)}`);
  AP.socket = ws;
  ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch { /* ignore */ } };
  ws.onclose = () => {
    clearInterval(AP.beat); AP.beat = null;
    if (AP.code) setTimeout(() => { if (AP.code) connect(getToken); }, 1500);
  };
  clearInterval(AP.beat);
  AP.beat = setInterval(() => send({ type: "PING" }), 30_000);
}

export function closeArrow(forget = true) {
  if (forget) stopClosing();
  if (AP.socket) { AP.socket.onclose = null; AP.socket.close(); AP.socket = null; }
  if (forget) { AP.code = null; }
}

const send = (o) => { if (AP.socket?.readyState === WebSocket.OPEN) AP.socket.send(JSON.stringify(o)); };

function say(text, good = false, ms = 2800) {
  const n = $("ap-error");
  n.hidden = !text;
  n.className = good ? "notice" : "notice notice-bad";
  n.textContent = text || "";
  if (text) setTimeout(() => { if (n.textContent === text) n.hidden = true; }, ms);
}

// ── message handler ────────────────────────────────────────────────────
function handle(msg) {
  switch (msg.type) {
    case "AP_WELCOME":
      AP.you = msg.you;
      break;
    case "AP_STATE":
      AP.state = msg.state;
      draw();
      break;
    case "AP_TAPPED":
      // Animate the removal then re-draw (state follows separately)
      flashTap(msg.id);
      break;
    case "AP_START":
      $("ap-results").hidden = true;
      say("");
      stopClosing();
      break;
    case "AP_REJECT":
      say(msg.why);
      break;
    case "AP_OVER":
      showResults(msg.results);
      startClosing();
      break;
    case "AP_CHAT":
      addChat(msg.line);
      break;
  }
}

// ── main draw ──────────────────────────────────────────────────────────
function draw() {
  const s = AP.state;
  if (!s) return;

  // Phase label
  const phaseMap = { LOBBY: "Lobby", PLAYING: "Playing", OVER: "Finished" };
  const phaseEl = $("ap-phase");
  if (phaseEl) phaseEl.textContent = phaseMap[s.phase] || s.phase;

  // Mode / dim badge
  const modeEl = $("ap-mode-label");
  if (modeEl) {
    const modeNames = { race: "Race", turns: "Turn-based", collab: "Collaborative", solo: "Solo" };
    modeEl.textContent = `${modeNames[s.mode] || s.mode} · ${s.dim}D puzzle`;
  }

  drawHost(s);
  drawScoreboard(s);
  drawBoard(s);
  drawFeed(s);
}

// ── lobby host panel ───────────────────────────────────────────────────
function drawHost(s) {
  const panel = $("ap-host");
  if (!panel) return;
  panel.hidden = !(s.phase === "LOBBY" && s.isHost);

  const note = $("ap-lobby-note");
  if (note) {
    if (s.mode === "solo" || s.people.length < 2)
      note.textContent = `${s.people.length} player${s.people.length !== 1 ? "s" : ""} in the room.`;
    else
      note.textContent = `${s.people.length} players ready.`;
  }

  const wait = $("ap-wait");
  if (wait) wait.hidden = s.phase !== "LOBBY" || s.isHost;

  // Show/hide the game area
  const game = $("ap-game");
  if (game) game.hidden = s.phase === "LOBBY";

  // Sync the in-game toggle to match current AP.visual state on first show
  const gameToggle = $("ap-vis-game");
  if (gameToggle && s.phase !== "LOBBY") {
    gameToggle.checked = AP.visual === "3d";
  }
}

// ── scoreboard ─────────────────────────────────────────────────────────
function drawScoreboard(s) {
  const board = $("ap-scoreboard");
  if (!board) return;
  board.hidden = s.phase === "LOBBY";
  if (s.phase === "LOBBY") return;

  board.innerHTML = "";
  const sorted = [...s.people].sort((a, b) => (s.scores[b.uid] || 0) - (s.scores[a.uid] || 0));
  for (const p of sorted) {
    const row = el("div", "ap-score-row" + (p.uid === AP.you ? " ap-score-you" : ""));
    const name = el("span", "ap-score-name", p.name);
    const score = el("span", "ap-score-pts", String(s.scores[p.uid] || 0));
    if (p.done) {
      const done = el("span", "ap-score-done", " ✓");
      row.append(name, score, done);
    } else if (s.mode === "turns" && s.turn === p.uid) {
      const turn = el("span", "ap-score-turn", " ◀");
      row.append(name, score, turn);
    } else {
      row.append(name, score);
    }
    board.append(row);
  }
}

// ── feed ───────────────────────────────────────────────────────────────
function drawFeed(s) {
  const feed = $("ap-feed");
  if (!feed || !s.feed?.length) return;
  feed.textContent = s.feed[s.feed.length - 1].text;
}

// ── board rendering ────────────────────────────────────────────────────
function drawBoard(s) {
  const wrap = $("ap-game");
  if (!wrap) return;
  wrap.hidden = s.phase === "LOBBY";
  if (s.phase === "LOBBY") return;

  if (AP.visual === "3d") draw3D(s);
  else draw2D(s);
}

// ── 2D flat grid ───────────────────────────────────────────────────────
const DIR_ARROWS = { up: "↑", down: "↓", left: "←", right: "→", "+x": "→", "-x": "←", "+y": "↑", "-y": "↓", "+z": "⊙", "-z": "⊗" };

function tappableSet(blocks, dim, size) {
  const tappable = new Set();
  for (const b of blocks) {
    if (canTapClient(blocks, b, dim, size)) tappable.add(b.id);
  }
  return tappable;
}

function canTapClient(blocks, block, dim, size) {
  if (dim === 3) {
    const occ = new Set(blocks.filter((b) => b.id !== block.id).map((b) => `${b.x},${b.y},${b.z}`));
    return pathClearClient3D(occ, block, size);
  }
  const occ = new Set(blocks.filter((b) => b.id !== block.id).map((b) => `${b.row},${b.col}`));
  return pathClearClient2D(occ, block, size);
}

function pathClearClient2D(occ, b, size) {
  const { row: r, col: c, dir } = b;
  if (dir === "up")    for (let i = r - 1; i >= 0; i--)    { if (occ.has(`${i},${c}`)) return false; }
  if (dir === "down")  for (let i = r + 1; i < size; i++)  { if (occ.has(`${i},${c}`)) return false; }
  if (dir === "left")  for (let j = c - 1; j >= 0; j--)    { if (occ.has(`${r},${j}`)) return false; }
  if (dir === "right") for (let j = c + 1; j < size; j++)  { if (occ.has(`${r},${j}`)) return false; }
  return true;
}

function pathClearClient3D(occ, b, size) {
  const { x, y, z, dir } = b;
  if (dir === "+x") for (let i = x + 1; i < size; i++) { if (occ.has(`${i},${y},${z}`)) return false; }
  if (dir === "-x") for (let i = x - 1; i >= 0; i--)  { if (occ.has(`${i},${y},${z}`)) return false; }
  if (dir === "+y") for (let i = y + 1; i < size; i++) { if (occ.has(`${x},${i},${z}`)) return false; }
  if (dir === "-y") for (let i = y - 1; i >= 0; i--)  { if (occ.has(`${x},${i},${z}`)) return false; }
  if (dir === "+z") for (let i = z + 1; i < size; i++) { if (occ.has(`${x},${y},${i}`)) return false; }
  if (dir === "-z") for (let i = z - 1; i >= 0; i--)  { if (occ.has(`${x},${y},${i}`)) return false; }
  return true;
}

function draw2D(s) {
  const container = $("ap-grid-2d");
  const canvas = $("ap-grid-3d");
  if (container) container.hidden = false;
  if (canvas) canvas.hidden = true;

  if (!container) return;
  container.innerHTML = "";

  const { board, dim, size, mode, turn } = s;
  const myTurn = mode === "turns" ? turn === AP.you : true;

  if (dim === 3) {
    // Show each z-layer of the 3D puzzle as a 2D slice
    for (let z = 0; z < size; z++) {
      const layerBlocks = board.filter((b) => b.z === z);
      const tappable = tappableSet(board, dim, size);
      const label = el("div", "ap-layer-label", `Layer ${z + 1}`);
      container.append(label);
      const grid = el("div", "ap-grid");
      grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const cell = el("div", "ap-cell ap-cell-empty");
          const block = layerBlocks.find((b) => b.x === x && b.y === y);
          if (block) {
            cell.className = "ap-cell ap-cell-block" + (tappable.has(block.id) ? " ap-cell-tappable" : "");
            cell.textContent = DIR_ARROWS[block.dir] || "?";
            if (tappable.has(block.id) && myTurn) {
              cell.addEventListener("click", () => tapBlock(block.id));
              cell.style.cursor = "pointer";
            }
          }
          grid.append(cell);
        }
      }
      container.append(grid);
    }
    return;
  }

  // Pure 2D puzzle
  const tappable = tappableSet(board, dim, size);
  const grid = el("div", "ap-grid");
  grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = el("div", "ap-cell ap-cell-empty");
      const block = board.find((b) => b.row === r && b.col === c);
      if (block) {
        const tap = tappable.has(block.id);
        cell.className = "ap-cell ap-cell-block" + (tap ? " ap-cell-tappable" : "");
        cell.textContent = DIR_ARROWS[block.dir] || "?";
        if (tap && myTurn) {
          cell.addEventListener("click", () => tapBlock(block.id));
          cell.style.cursor = "pointer";
        }
      }
      grid.append(cell);
    }
  }
  container.append(grid);
}

// ── 3D isometric canvas renderer ──────────────────────────────────────
const ISO = {
  TILE_W: 60, TILE_H: 36,
  face: { top: "#a0bcd4", left: "#6a8fa8", right: "#4e7490" },
  tap:  { top: "#f7c948", left: "#c4932e", right: "#a07020" },
  empty: "rgba(0,0,0,0.04)",
};

function isoProject(x, y, z, originX, originY, tw, th) {
  return {
    sx: originX + (x - z) * tw / 2,
    sy: originY + (x + z) * th / 4 - y * th / 2,
  };
}

function draw3D(s) {
  const container = $("ap-grid-2d");
  const canvas = $("ap-grid-3d");
  if (container) container.hidden = true;
  if (canvas) canvas.hidden = false;
  if (!canvas) return;

  const { board, dim, size, mode, turn } = s;
  const myTurn = mode === "turns" ? turn === AP.you : true;
  const tappable = tappableSet(board, dim, size);
  const tw = ISO.TILE_W, th = ISO.TILE_H;

  // Fit canvas
  const containerWidth = canvas.parentElement?.clientWidth || 400;
  const scale = Math.min(1, (containerWidth - 32) / ((size + size) * tw / 2));
  const W = Math.round(containerWidth);
  const H = Math.round(((size + size) * th / 4 + size * th / 2 + th * 2) * scale);
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(scale, scale);

  const originX = W / 2 / scale;
  const originY = th * 2;

  // Sort by painter's algorithm: draw back to front
  const sorted = [...board].sort((a, b) => {
    const da = (dim === 3 ? a.x + a.z - a.y : a.row + a.col);
    const db = (dim === 3 ? b.x + b.z - b.y : b.row + b.col);
    return da - db;
  });

  // Store hit areas for click detection
  canvas._hitAreas = [];

  for (const block of sorted) {
    const bx = dim === 3 ? block.x : block.col;
    const by = dim === 3 ? block.y : 0;
    const bz = dim === 3 ? block.z : block.row;
    const isTap = tappable.has(block.id);
    const { sx, sy } = isoProject(bx, by, bz, originX, originY, tw, th);
    drawIsoCube(ctx, sx, sy, tw, th, isTap, DIR_ARROWS[block.dir] || "?");

    // Record hit area (top face diamond)
    canvas._hitAreas.push({ id: block.id, isTap, sx, sy, tw, th });
  }

  ctx.restore();

  // Wire click handler (once)
  if (!canvas._apBound) {
    canvas._apBound = true;
    canvas.addEventListener("click", (e) => {
      if (!AP.state) return;
      const s2 = AP.state;
      const myTurn2 = s2.mode === "turns" ? s2.turn === AP.you : true;
      if (!myTurn2) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mx = (e.clientX - rect.left) * scaleX / (canvas.width / (canvas.width));
      const my = (e.clientY - rect.top) * scaleY / (canvas.height / (canvas.height));
      // Check hit areas in reverse order (front to back)
      for (let i = (canvas._hitAreas || []).length - 1; i >= 0; i--) {
        const a = canvas._hitAreas[i];
        if (!a.isTap) continue;
        if (hitTestIso(mx, my, a.sx, a.sy, a.tw, a.th)) {
          tapBlock(a.id);
          return;
        }
      }
    });
  }
}

function hitTestIso(mx, my, sx, sy, tw, th) {
  // Top face diamond: 4 corners at (sx, sy), (sx+tw/2, sy+th/2), (sx, sy+th), (sx-tw/2, sy+th/2)
  const dx = mx - sx, dy = my - (sy + th / 2);
  return Math.abs(dx) / (tw / 2) + Math.abs(dy) / (th / 2) <= 1.1;
}

function drawIsoCube(ctx, sx, sy, tw, th, isTap, arrow) {
  const face = isTap ? ISO.tap : ISO.face;
  // Top face
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + tw / 2, sy + th / 2);
  ctx.lineTo(sx, sy + th);
  ctx.lineTo(sx - tw / 2, sy + th / 2);
  ctx.closePath();
  ctx.fillStyle = face.top;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Left face
  ctx.beginPath();
  ctx.moveTo(sx - tw / 2, sy + th / 2);
  ctx.lineTo(sx, sy + th);
  ctx.lineTo(sx, sy + th + th / 2);
  ctx.lineTo(sx - tw / 2, sy + th);
  ctx.closePath();
  ctx.fillStyle = face.left;
  ctx.fill();
  ctx.stroke();

  // Right face
  ctx.beginPath();
  ctx.moveTo(sx + tw / 2, sy + th / 2);
  ctx.lineTo(sx, sy + th);
  ctx.lineTo(sx, sy + th + th / 2);
  ctx.lineTo(sx + tw / 2, sy + th);
  ctx.closePath();
  ctx.fillStyle = face.right;
  ctx.fill();
  ctx.stroke();

  // Arrow on top face
  ctx.save();
  ctx.translate(sx, sy + th / 2 + 2);
  ctx.font = `bold ${Math.round(th * 0.5)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isTap ? "#1a1000" : "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 2;
  ctx.fillText(arrow, 0, 0);
  ctx.restore();
}

// ── tap logic ──────────────────────────────────────────────────────────
function tapBlock(id) {
  const s = AP.state;
  if (!s || s.phase !== "PLAYING") return;
  if (s.mode === "turns" && s.turn !== AP.you) { say("It's not your turn."); return; }
  send({ type: "AP_TAP", id });
}

// Flash tapped block briefly (optimistic UI: state from server follows)
const _flashTimers = new Map();
function flashTap(id) {
  const cells = document.querySelectorAll(`[data-block-id="${id}"]`);
  for (const c of cells) {
    c.classList.add("ap-cell-flash");
    clearTimeout(_flashTimers.get(id));
    _flashTimers.set(id, setTimeout(() => c.classList.remove("ap-cell-flash"), 300));
  }
}

// ── visual toggle ──────────────────────────────────────────────────────
export function bindArrowControls() {
  // Lobby visual toggle (sets default for the host's start command)
  const lobbyToggle = $("ap-visual-toggle");
  if (lobbyToggle) {
    lobbyToggle.addEventListener("change", () => {
      const label = $("ap-visual-label");
      if (label) label.textContent = lobbyToggle.checked ? "3D" : "2D";
    });
  }

  // In-game visual toggle (per-client, switches 2D ↔ 3D on the fly)
  const gameToggle = $("ap-vis-game");
  if (gameToggle) {
    gameToggle.addEventListener("change", () => {
      AP.visual = gameToggle.checked ? "3d" : "2d";
      if (AP.state) drawBoard(AP.state);
    });
  }

  const startBtn = $("btn-ap-start");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      const mode = $("ap-mode")?.value || "race";
      const dim = Number($("ap-dim")?.value || 2);
      const visual = $("ap-visual-toggle")?.checked ? "3d" : "2d";
      send({ type: "AP_START", mode, dim, visual });
    });
  }

  const chatInput = $("ap-text");
  const chatSend = $("btn-ap-say");
  if (chatInput && chatSend) {
    const doSay = () => {
      const text = chatInput.value.trim();
      if (!text) return;
      send({ type: "AP_SAY", text });
      chatInput.value = "";
    };
    chatSend.addEventListener("click", doSay);
    chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSay(); });
  }

  const leaveBtn = $("btn-ap-leave");
  if (leaveBtn) {
    leaveBtn.addEventListener("click", () => {
      closeArrow();
      AP.onLeave?.();
    });
  }
}

// ── chat ───────────────────────────────────────────────────────────────
function addChat(line) {
  const log = $("ap-chatlog");
  if (!log) return;
  const p = el("p", "");
  const name = el("b", "", line.name + ": ");
  p.append(name, document.createTextNode(line.text));
  log.append(p);
  while (log.children.length > 60) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

// ── results ────────────────────────────────────────────────────────────
function showResults(results) {
  const box = $("ap-results");
  if (!box) return;
  box.hidden = false;
  box.innerHTML = "";
  const h = el("h3", "", "Game Over");
  box.append(h);
  for (const r of results) {
    const row = el("div", "ap-result-row" + (r.uid === AP.you ? " ap-result-you" : ""));
    const place = el("span", "ap-result-place", `#${r.placement} `);
    const name = el("span", "ap-result-name", r.name);
    const pts = el("span", "ap-result-pts", ` · ${r.score} blocks`);
    const mmr = el("span", "ap-result-mmr", ` · ${r.gain >= 0 ? "+" : ""}${r.gain} MMR`);
    row.append(place, name, pts, mmr);
    if (r.promoted) {
      const belt = el("span", "ap-result-belt", ` 🎉 ${r.belt}`);
      row.append(belt);
    }
    box.append(row);
  }
}

function startClosing() {
  if (AP.closing) return;
  let left = CLOSE_AFTER_S;
  const btn = $("btn-ap-leave");
  if (!btn) return;
  AP.closing = setInterval(() => {
    left--;
    if (left <= 0) {
      stopClosing();
      closeArrow();
      AP.onLeave?.();
    }
  }, 1000);
}

function stopClosing() {
  clearInterval(AP.closing);
  AP.closing = null;
}
