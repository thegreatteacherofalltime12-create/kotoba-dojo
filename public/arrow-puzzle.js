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
  tick: null, bucket: 0,   // the ten-second clock Medium's glow moves on
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
  // A phone starts with the chat folded so the puzzle gets the screen.
  setChatCollapsed(window.matchMedia("(max-width: 760px)").matches);
  $("ap-results").hidden = true;
  $("ap-error").hidden = true;
  clearInterval(AP.tick);
  AP.tick = setInterval(() => {
    if (AP.state?.phase !== "PLAYING" || AP.state.level !== "medium") return;
    const bucket = Math.floor(Date.now() / 10_000);
    if (bucket !== AP.bucket) { AP.bucket = bucket; drawBoard(AP.state); }
  }, 500);
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
  if (forget) { AP.code = null; clearInterval(AP.tick); AP.tick = null; }
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
    const level = s.level ? ` · ${s.level[0].toUpperCase()}${s.level.slice(1)}` : "";
    modeEl.textContent = `${modeNames[s.mode] || s.mode} · ${s.dim}D puzzle${level}`;
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
  const hint = $("ap-3d-hint");
  if (hint) hint.hidden = true;

  if (!container) return;
  container.innerHTML = "";

  const { board, dim, size, mode, turn } = s;
  const myTurn = mode === "turns" ? turn === AP.you : true;
  const tappable = tappableSet(board, dim, size);
  const glowing = glowSet(s, tappable);

  if (dim === 3) {
    // Show each z-layer of the 3D puzzle as a 2D slice
    for (let z = 0; z < size; z++) {
      const layerBlocks = board.filter((b) => b.z === z);
      const label = el("div", "ap-layer-label", `Layer ${z + 1}`);
      container.append(label);
      const grid = el("div", "ap-grid");
      grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const cell = el("div", "ap-cell ap-cell-empty");
          const block = layerBlocks.find((b) => b.x === x && b.y === y);
          if (block) {
            cell.className = "ap-cell ap-cell-block" + (glowing.has(block.id) ? " ap-cell-tappable" : "");
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
  const grid = el("div", "ap-grid");
  grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = el("div", "ap-cell ap-cell-empty");
      const block = board.find((b) => b.row === r && b.col === c);
      if (block) {
        const tap = tappable.has(block.id);
        cell.className = "ap-cell ap-cell-block" + (glowing.has(block.id) ? " ap-cell-tappable" : "");
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

// ── 3D cube renderer ───────────────────────────────────────────────────
// A real cube: drag it to turn it. Orthographic projection, cubes painted
// far to near, and every block's arrow drawn on each face you can see, so
// its direction reads from any angle. A tap on any face taps that block.
const CUBE = {
  yaw: 0.62, pitch: 0.55,            // where the cube is turned to, in radians
  base: ["#a7c1d8", "#6f93ad", "#51728d"],
  glow: ["#f9d35a", "#cf9c31", "#a67c22"],
  edge: "rgba(10,14,20,.6)",
};
let dragging = null;

const DIR_VEC = {
  up: [0, 0, -1], down: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0],
  "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1],
};
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, { n: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0] },
];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function rotate([x, y, z]) {
  const cy = Math.cos(CUBE.yaw), sy = Math.sin(CUBE.yaw);
  const cp = Math.cos(CUBE.pitch), sp = Math.sin(CUBE.pitch);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

function blockCentre(b, dim, size) {
  const h = (size - 1) / 2;
  return dim === 3 ? [b.x - h, b.y - h, b.z - h] : [b.col - h, 0, b.row - h];
}

/** Which of the free blocks are shown glowing, by the level the host picked. */
function glowSet(s, tappable) {
  if (s.level === "hard") return new Set();
  if (s.level !== "medium") return tappable;
  // Everyone sees the same 45%, and it changes every ten seconds.
  const ids = [...tappable].sort((a, b) => a - b);
  const want = Math.round(ids.length * 0.45);
  let seed = ((s.roundNo || 1) * 7919 + Math.floor(Date.now() / 10_000)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return new Set(ids.slice(0, Math.max(want, ids.length ? 1 : 0)));
}

function draw3D(s) {
  const container = $("ap-grid-2d");
  const canvas = $("ap-grid-3d");
  const hint = $("ap-3d-hint");
  if (container) container.hidden = true;
  if (canvas) canvas.hidden = false;
  if (hint) hint.hidden = false;
  if (!canvas) return;

  const { board, dim, size } = s;
  const tappable = tappableSet(board, dim, size);
  const glowing = glowSet(s, tappable);

  const W = Math.round(canvas.parentElement?.clientWidth || 360);
  const H = Math.round(Math.min(W, 440));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const S = (Math.min(W, H) * 0.9) / (size * 1.75);
  const cx = W / 2, cy = H / 2;
  const proj = (p) => [cx + p[0] * S, cy - p[1] * S];

  const cubes = board.map((b) => ({ b, c: rotate(blockCentre(b, dim, size)) })).sort((p, q) => p.c[2] - q.c[2]);
  const hits = [];
  ctx.lineJoin = "round";

  // Easy starts as a solid cube, and its outline stays where it was as blocks
  // go, so the shape you are clearing never seems to shift.
  if (dim === 3 && s.level === "easy") drawFrame(ctx, proj, size);

  for (const { b, c } of cubes) {
    const pal = glowing.has(b.id) ? CUBE.glow : CUBE.base;
    const d = DIR_VEC[b.dir] || [0, 0, 0];
    for (const f of FACES) {
      const n = rotate(f.n);
      if (n[2] <= 0.02) continue;
      const fc = add(c, f.n, 0.5);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, k]) => proj(rotate(add(add(fc, f.u, a * 0.5), f.v, k * 0.5))));
      ctx.beginPath();
      corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = pal[n[2] > 0.8 ? 0 : n[2] > 0.45 ? 1 : 2];
      ctx.fill();
      ctx.strokeStyle = CUBE.edge; ctx.lineWidth = 1;
      ctx.stroke();
      hits.push({ id: b.id, poly: corners });
      drawArrowOnFace(ctx, proj, f, fc, d, n[2], S, glowing.has(b.id));
    }
  }
  canvas._hits = hits;
  bindCube(canvas);
}

/** The twelve edges of the full cube, faint, behind the blocks. */
function drawFrame(ctx, proj, size) {
  const h = size / 2;
  const corner = (i) => proj(rotate([i & 1 ? h : -h, i & 2 ? h : -h, i & 4 ? h : -h]));
  ctx.save();
  ctx.strokeStyle = "rgba(190, 210, 235, .35)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      const [ax, ay] = corner(i), [bx, by] = corner(i | bit);
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** The block's arrow as it lies on this face: in-plane as an arrow, through the face as ⊙ (out) or ⊗ (in). */
function drawArrowOnFace(ctx, proj, f, fc, d, facing, S, glow) {
  const du = dot(d, f.u), dv = dot(d, f.v), dn = dot(d, f.n);
  ctx.strokeStyle = glow ? "#1a1000" : "#f4f7fb";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(1.5, S * 0.07);
  ctx.lineCap = "round";
  const [px, py] = proj(rotate(fc));
  if (Math.abs(dn) > 0.5) {
    const r = S * 0.17 * Math.sqrt(facing);
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
    if (dn > 0) { ctx.beginPath(); ctx.arc(px, py, r * 0.3, 0, Math.PI * 2); ctx.fill(); }
    else { const k = r * 0.55; ctx.beginPath(); ctx.moveTo(px - k, py - k); ctx.lineTo(px + k, py + k); ctx.moveTo(px + k, py - k); ctx.lineTo(px - k, py + k); ctx.stroke(); }
    return;
  }
  const along = add([0, 0, 0], f.u, du); along[0] += f.v[0] * dv; along[1] += f.v[1] * dv; along[2] += f.v[2] * dv;
  const perp = add(add([0, 0, 0], f.u, -dv), f.v, du);
  const tail = add(fc, along, -0.3), head = add(fc, along, 0.3);
  const wingA = add(add(head, along, -0.2), perp, 0.16), wingB = add(add(head, along, -0.2), perp, -0.16);
  const [tx, ty] = proj(rotate(tail)), [hx, hy] = proj(rotate(head));
  const [ax, ay] = proj(rotate(wingA)), [bx, by] = proj(rotate(wingB));
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.lineTo(bx, by); ctx.stroke();
}

function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Drag turns the cube; a tap that did not move picks the block under the finger. */
function bindCube(canvas) {
  if (canvas._apBound) return;
  canvas._apBound = true;
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener("pointerdown", (e) => {
    dragging = { x: e.clientX, y: e.clientY, yaw: CUBE.yaw, pitch: CUBE.pitch, moved: false, start: at(e) };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) dragging.moved = true;
    if (!dragging.moved) return;
    CUBE.yaw = dragging.yaw + (dx / canvas.clientWidth) * Math.PI * 1.6;
    CUBE.pitch = Math.max(-1.45, Math.min(1.45, dragging.pitch + (dy / canvas.clientHeight) * Math.PI));
    if (AP.state && AP.visual === "3d") draw3D(AP.state);
  });
  const up = (e) => {
    if (!dragging) return;
    const tap = !dragging.moved ? dragging.start : null;
    dragging = null;
    if (!tap) return;
    for (let i = (canvas._hits || []).length - 1; i >= 0; i--) {
      if (pointInPoly(tap, canvas._hits[i].poly)) return void tapBlock(canvas._hits[i].id);
    }
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", () => { dragging = null; });
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
      const level = $("ap-level")?.value || "easy";
      send({ type: "AP_START", mode, dim, visual, level });
    });
  }

  $("ap-chat-head")?.addEventListener("click", () => {
    setChatCollapsed(!$("ap-chat").classList.contains("is-collapsed"));
  });

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
let unread = 0;

function setChatCollapsed(collapsed) {
  const panel = $("ap-chat");
  if (!panel) return;
  panel.classList.toggle("is-collapsed", collapsed);
  $("ap-chat-head")?.setAttribute("aria-expanded", String(!collapsed));
  const fold = $("ap-chat-fold");
  if (fold) fold.innerHTML = collapsed ? "Show &#9660;" : "Hide &#9650;";
  if (!collapsed) {
    unread = 0;
    const badge = $("ap-chat-unread");
    if (badge) badge.hidden = true;
    const log = $("ap-chatlog");
    if (log) log.scrollTop = log.scrollHeight;
  }
}

function addChat(line) {
  const log = $("ap-chatlog");
  if (!log) return;
  const p = el("p", "");
  const name = el("b", "", line.name + ": ");
  p.append(name, document.createTextNode(line.text));
  log.append(p);
  while (log.children.length > 60) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  // Folded away, a new line from somebody else shows as a count on the header.
  if ($("ap-chat")?.classList.contains("is-collapsed") && line.uid !== AP.you) {
    unread += 1;
    const badge = $("ap-chat-unread");
    if (badge) { badge.textContent = String(unread); badge.hidden = false; }
  }
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
