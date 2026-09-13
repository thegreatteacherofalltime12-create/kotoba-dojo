// Battleship Royale, client side. The server owns every fleet and every rule;
// this draws what it is told and sends intentions.

/**
 * The board comes from the server now rather than a constant here.
 *
 * Three theatres mean the size, the fleet and the shots per turn all vary by
 * room, and a second copy of those numbers in the page is a second copy to get
 * out of step. These two helpers are geometry, not rules, so they stay.
 */
const cellsFor = (row, col, dir, len) => {
  const out = [];
  for (let i = 0; i < len; i++) out.push(dir === "down" ? `${row + i},${col}` : `${row},${col + i}`);
  return out;
};

/** A fleet laid out at random, for the auto-place button. */
function randomFleet(fleet, size) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const taken = new Set();
    const out = [];
    let stuck = false;
    for (const spec of fleet) {
      let placed = false;
      for (let t = 0; t < 200 && !placed; t++) {
        const dir = Math.random() < 0.5 ? "across" : "down";
        const row = Math.floor(Math.random() * (dir === "down" ? size - spec.len + 1 : size));
        const col = Math.floor(Math.random() * (dir === "across" ? size - spec.len + 1 : size));
        const cells = cellsFor(row, col, dir, spec.len);
        if (cells.some((c) => taken.has(c))) continue;
        cells.forEach((c) => taken.add(c));
        out.push({ id: spec.id, row, col, dir });
        placed = true;
      }
      if (!placed) { stuck = true; break; }
    }
    if (!stuck) return out;
  }
  return null;
}

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const B = {
  socket: null,
  code: null,
  you: null,
  isHost: false,
  size: 10,          // all three come from the server's welcome
  ships: [],
  shotsPerTurn: 2,
  maps: [],
  mapId: "easy",
  game: null,
  fleet: null,
  targets: [],
  placing: [],       // fleet being laid out before the battle
  deck: "captains",  // which of captains / feed / chat is on show
  bye: null,         // the countdown out of a finished battle
  beat: null,        // keeps the room on the open board
  placeIdx: 0,
  dir: "across",
  target: null,
  shots: [],         // the two cells chosen this turn
  tick: null,
  onLeave: null,
};

// ── connection ──────────────────────────────────────────────────────

export async function enterBattle(code, getToken, onLeave) {
  B.code = code;
  B.onLeave = onLeave;
  B.placing = [];
  B.deck = "captains";
  const rev = document.getElementById("battle-reveal");
  if (rev) { rev.hidden = true; rev.textContent = ""; }
  B.placeIdx = 0;
  B.shots = [];
  B.target = null;
  $("battle-code").textContent = code;
  await connectBattle(getToken);
}

async function connectBattle(getToken) {
  closeBattle(false);
  const token = await getToken();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/battle/${B.code}/ws?token=${encodeURIComponent(token)}`);
  B.socket = ws;

  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  };
  ws.onclose = () => {
    clearInterval(B.beat);
    B.beat = null;
    if (B.code) {
      feedLine("Connection lost. Reconnecting.");
      setTimeout(() => { if (B.code) connectBattle(getToken); }, 1500);
    }
  };

  // The directory forgets a room it hasn't heard from in ninety seconds, and a
  // lobby waiting for players says nothing on its own. This is what keeps an
  // open room on the board.
  clearInterval(B.beat);
  B.beat = setInterval(() => send({ type: "PING" }), 30_000);
}

export function closeBattle(forget = true) {
  clearInterval(B.bye);
  B.bye = null;
  if (B.socket) { B.socket.onclose = null; B.socket.close(); B.socket = null; }
  clearInterval(B.tick);
  B.tick = null;
  if (forget) B.code = null;
}

const send = (obj) => {
  if (B.socket?.readyState === WebSocket.OPEN) B.socket.send(JSON.stringify(obj));
};

function handle(msg) {
  switch (msg.type) {
    case "BATTLE_WELCOME":
      B.you = msg.you;
      B.isHost = !!msg.isHost;
      B.size = msg.size || 10;
      B.ships = msg.fleet || [];
      B.shotsPerTurn = msg.shots || 2;
      B.maps = msg.maps || [];
      B.mapId = msg.mapId || "easy";
      break;
    case "BATTLE_STATE":
      B.game = msg.game;
      B.fleet = msg.yourFleet;
      B.targets = msg.targets || [];
      draw();
      break;
    case "BATTLE_FEED":
      feedLine(msg.entry.text, msg.entry.at);
      break;
    case "BATTLE_CHAT":
      chatLine(msg);
      break;
    case "BATTLE_OVER":
      showResults(msg);
      break;
    case "BATTLE_ERROR":
      say(msg.message);
      break;
  }
}

function say(text) {
  const n = $("battle-error");
  n.hidden = !text;
  n.textContent = text || "";
  if (text) setTimeout(() => { if (n.textContent === text) n.hidden = true; }, 5000);
}

/** Captains, shot feed and chat share one block; this picks which is on. */
function showDeck(which) {
  B.deck = which;
  for (const [tab, pane] of [["bt-captains", "captains"], ["bt-feed", "feed"], ["bt-chat", "chat"]]) {
    $(tab)?.classList.toggle("on", pane === which);
    const body = $(`bpane-${pane}`);
    if (body) body.hidden = pane !== which;
  }
}

// ── drawing ─────────────────────────────────────────────────────────

function draw() {
  if (!B.game) return;
  const g = B.game;
  const me = g.players.find((p) => p.uid === B.you);

  $("battle-phase").textContent =
    g.phase === "LOBBY" ? "Placing fleets" :
    g.phase === "ACTIVE" ? `Round ${g.round}` : "Battle over";

  const stillPlacing = !!me?.placing;
  $("view-place").hidden = !(g.phase === "LOBBY" || stillPlacing);
  drawSolo(g);
  $("view-battle").hidden = g.phase === "LOBBY" || stillPlacing;
  const hosting = B.isHost && g.phase === "LOBBY";
  $("host-panel").hidden = !hosting;
  $("btn-battle-start").hidden = !hosting;
  $("btn-battle-end").hidden = !(B.isHost && g.phase === "ACTIVE");

  const here = g.players.filter((p) => p.online && !p.ai).length;
  const ready = g.players.filter((p) => p.ready && !p.ai).length;
  const short = !g.solo && here < 2;
  $("btn-battle-start").disabled = short;
  $("btn-battle-start").textContent = g.solo ? "Begin solo match" : "Begin the battle";
  $("host-status").textContent = g.solo
    ? "Solo match. Place your fleet and begin whenever you're ready."
    : short
      ? "Waiting for at least one more captain."
      : `${here} captains here, ${ready} with fleets placed. Anyone still placing gets a random fleet.`;

  drawHostPanel();
  drawRoster();
  if (g.phase === "LOBBY") drawPlacing();
  else drawBattle(me);
  drawTurnClock();
}

function drawSolo(g) {
  const anon = $("btn-anon");
  anon.setAttribute("aria-checked", String(!!g.anon));
  anon.classList.toggle("on", !!g.anon);
  anon.hidden = !!g.solo;

  const on = !!g.solo;
  const btn = $("btn-solo");
  btn.setAttribute("aria-checked", String(on));
  btn.classList.toggle("on", on);
  btn.hidden = false;

  const host = $("ai-levels");
  host.hidden = !on;
  if (host.hidden) return;

  host.textContent = "";
  host.append(el("span", "ai-label", "Opponent"));
  for (const d of g.difficulties || []) {
    const b = el("button", "ai-pick" + (g.aiLevel === d.id ? " on" : ""));
    b.type = "button";
    b.append(el("span", "ai-name", d.name));
    b.append(el("span", "ai-blurb", d.blurb));
    b.onclick = () => send({ type: "BATTLE_SOLO", on: true, level: d.id });
    host.append(b);
  }
}

/**
 * The chart, and the two switches.
 *
 * Shown to the host in the lobby only: the board decides how big every fleet
 * is, so changing it once ships are placed would leave them in the sea.
 */
function drawHostPanel() {
  const g = B.game;
  const host = $("battle-host");
  if (!host) return;
  const hosting = B.isHost && g.phase === "LOBBY";
  host.hidden = !hosting;
  if (!hosting) return;

  host.textContent = "";
  host.append(el("span", "ai-label", "Chart"));

  const maps = el("div", "map-picks");
  for (const m of (g.maps || B.maps || [])) {
    const b = el("button", "ai-pick" + (g.mapId === m.id ? " on" : ""));
    b.type = "button";
    b.append(el("span", "ai-name", m.name));
    b.append(el("span", "ai-blurb", `${m.size}\u00d7${m.size} \u00b7 ${m.shots} shots a turn`));
    b.onclick = () => {
      if (g.mapId === m.id) return;
      if (!window.confirm(`Switch to ${m.name}? Any fleet already placed has to be laid out again.`)) return;
      send({ type: "BATTLE_MAP", mapId: m.id });
    };
    maps.append(b);
  }
  host.append(maps);

  const row = el("div", "host-switches");
  for (const [what, label, on, note] of [
    ["hideNames", "Hide captains' names", !!g.hideNames, "Everyone shows as Captain A, B, C."],
    ["useTokens", "Use tokens for this battle", !!g.useTokens, "Reserved \u2014 the token economy isn't built yet."],
  ]) {
    const b = el("button", "hswitch" + (on ? " on" : ""));
    b.type = "button";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", String(on));
    b.append(el("span", "hsw-dot"));
    b.append(el("span", "hsw-name", label));
    b.append(el("span", "hsw-note", note));
    b.onclick = () => send({ type: "BATTLE_TOGGLE", what, on: !on });
    row.append(b);
  }
  host.append(row);
}

function drawRoster() {
  const host = $("battle-roster");
  host.textContent = "";
  for (const p of B.game.players) {
    // Someone who arrived mid-battle is neither fighting nor sunk, so they
    // read as joining rather than as a casualty.
    const li = el("li", [
      p.placing ? "joining" : p.alive ? "" : "out",
      p.uid === B.game.turnUid ? "acting" : "",
      p.online ? "" : "away",
    ].join(" ").trim());
    li.append(el("span", "bp-name", p.name + (p.uid === B.you ? " (you)" : "")));
    li.append(el("span", "bp-ships",
      p.placing ? "placing a fleet" : p.alive ? `${p.remaining} ships left` : "sunk"));
    if (B.game.phase === "LOBBY") li.append(el("span", "bp-ready", p.ready ? "ready" : "placing"));
    host.append(li);
  }
}

function drawTurnClock() {
  clearInterval(B.tick);
  const g = B.game;
  if (g.phase !== "ACTIVE" || !g.turnEndsAt) { $("battle-clock").textContent = ""; return; }
  const who = g.players.find((p) => p.uid === g.turnUid);
  const mine = g.turnUid === B.you;
  const run = () => {
    const left = Math.max(0, Math.round((g.turnEndsAt - Date.now()) / 1000));
    $("battle-clock").textContent =
      `${mine ? "Your shot" : `${who?.name || "Someone"} to fire`} — ${left}s`;
    $("battle-clock").classList.toggle("mine", mine);
  };
  run();
  B.tick = setInterval(run, 1000);
}

// ── placement ───────────────────────────────────────────────────────

function drawPlacing() {
  const spec = B.ships[B.placeIdx];
  $("place-ship").textContent = spec ? `${spec.name} — ${spec.len} squares` : "Fleet ready";
  $("place-dir").textContent = B.dir === "across" ? "Across" : "Down";

  const taken = new Map();
  for (const p of B.placing) {
    const s = B.ships.find((f) => f.id === p.id);
    for (const cell of cellsFor(p.row, p.col, p.dir, s.len)) taken.set(cell, s.id);
  }

  const grid = el("div", "bgrid");
  grid.style.setProperty("--n", String(B.size));
  for (let r = 0; r < B.size; r++) {
    for (let c = 0; c < B.size; c++) {
      const cell = `${r},${c}`;
      const box = el("button", "bcell" + (taken.has(cell) ? " ship" : ""));
      box.type = "button";
      box.onmouseenter = () => preview(grid, r, c, taken);
      box.onmouseleave = () => grid.querySelectorAll(".ghost").forEach((n) => n.classList.remove("ghost"));
      box.onclick = () => placeAt(r, c, taken);
      grid.append(box);
    }
  }
  $("place-grid").textContent = "";
  $("place-grid").append(grid);
}

function preview(grid, r, c, taken) {
  const spec = B.ships[B.placeIdx];
  if (!spec) return;
  grid.querySelectorAll(".ghost").forEach((n) => n.classList.remove("ghost"));
  for (const cell of cellsFor(r, c, B.dir, spec.len)) {
    const [rr, cc] = cell.split(",").map(Number);
    if (rr >= B.size || cc >= B.size || taken.has(cell)) return;
    grid.children[rr * B.size + cc]?.classList.add("ghost");
  }
}

function placeAt(r, c, taken) {
  const spec = B.ships[B.placeIdx];
  if (!spec) return;
  const cells = cellsFor(r, c, B.dir, spec.len);
  for (const cell of cells) {
    const [rr, cc] = cell.split(",").map(Number);
    if (rr >= B.size || cc >= B.size) return say(`${spec.name} won't fit there.`);
    if (taken.has(cell)) return say("Something's already there.");
  }
  B.placing.push({ id: spec.id, row: r, col: c, dir: B.dir });
  B.placeIdx++;
  say("");
  if (B.placeIdx >= B.ships.length) send({ type: "BATTLE_PLACE", placements: B.placing });
  drawPlacing();
}

export function bindBattleControls() {
  $("btn-anon").onclick = () => send({ type: "BATTLE_ANON", on: !B.game?.anon });
  $("btn-solo").onclick = () => {
    const on = !B.game?.solo;
    send({ type: "BATTLE_SOLO", on, level: B.game?.aiLevel || "medium" });
  };
  $("btn-rotate").onclick = () => { B.dir = B.dir === "across" ? "down" : "across"; drawPlacing(); };
  $("btn-place-clear").onclick = () => { B.placing = []; B.placeIdx = 0; drawPlacing(); };
  $("btn-place-random").onclick = () => {
    B.placing = randomFleet(B.ships, B.size) || [];
    B.placeIdx = B.ships.length;
    send({ type: "BATTLE_PLACE", placements: B.placing });
    drawPlacing();
  };
  $("btn-battle-start").onclick = () => send({ type: "BATTLE_START" });
  $("btn-fire").onclick = () => {
    if (!B.target) return say("Choose who you're firing at.");
    if (B.shots.length !== B.shotsPerTurn) return say(`Choose ${B.shotsPerTurn} squares.`);
    send({ type: "BATTLE_FIRE", target: B.target, cells: B.shots });
    B.shots = [];
  };
  for (const [tab, pane] of [["bt-captains", "captains"], ["bt-feed", "feed"], ["bt-chat", "chat"]]) {
    const el0 = $(tab);
    if (el0) el0.onclick = () => showDeck(pane);
  }
  showDeck(B.deck || "captains");

  $("btn-battle-leave").onclick = () => {
    if (B.game?.phase === "ACTIVE" && !confirm("End the match and take the MMR you've earned so far?")) return;
    send({ type: "BATTLE_END" });
    closeBattle(); B.onLeave?.();
  };
  $("btn-battle-end").onclick = () => {
    if (!window.confirm("End the match now? Everyone still afloat is ranked by damage dealt, and MMR is awarded as normal.")) return;
    send({ type: "BATTLE_END" });
  };
  $("battle-say").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
  $("btn-battle-send").onclick = sendChat;
}

function sendChat() {
  const text = $("battle-say").value.trim();
  if (!text) return;
  send({ type: "BATTLE_SAY", text });
  $("battle-say").value = "";
}

// ── battle ──────────────────────────────────────────────────────────

function drawBattle(me) {
  const g = B.game;
  const myTurn = g.turnUid === B.you && g.phase === "ACTIVE";

  // Sunk, but still in the room: a spectator can look at anyone's water,
  // including the boards of captains who have already gone down.
  const watching = !!me && !me.alive && !me.placing;
  const foes = g.players.filter((p) =>
    p.uid !== B.you && (watching ? true : p.alive));

  // Drop a target only when they're gone, never because it isn't your turn —
  // their water should stay on screen between turns.
  if (B.target && !foes.some((p) => p.uid === B.target)) { B.target = null; B.shots = []; }
  // With one opponent there's nothing to choose, so choose it for them.
  if (!B.target && foes.length === 1) B.target = foes[0].uid;
  if (!B.target && myTurn) B.target = (B.targets.find((t) => t.allowed) || {}).uid || null;

  const sel = $("target-list");
  sel.textContent = "";
  const blocked = B.targets.find((t) => t.uid === B.target && !t.allowed);

  if (foes.length <= 1 && !watching) {
    sel.append(el("p", "panel-sub",
      g.phase === "OVER" ? "The guns are quiet."
        : myTurn ? "One opponent left. Pick two squares and fire."
        : "Waiting for your opponent."));
  } else {
    const picks = watching || !B.targets.length
      ? foes.map((p) => ({
        uid: p.uid, name: p.name, allowed: false,
        reason: watching ? (p.alive ? "watching" : "sunk") : "Not your turn",
      }))
      : B.targets;
    for (const t of picks) {
      const b = el("button", "tgt" + (t.allowed ? "" : " blocked") + (B.target === t.uid ? " on" : ""));
      b.type = "button";
      // Selecting is always allowed — it only chooses whose water is shown.
      b.disabled = false;
      b.append(el("span", "tgt-name", t.name));
      if (!t.allowed) b.append(el("span", "tgt-why", t.reason));
      b.onclick = () => { B.target = t.uid; B.shots = []; drawBattle(me); };
      sel.append(b);
    }
  }

  // Their water.
  const enemy = g.players.find((p) => p.uid === B.target);
  const board = $("enemy-grid");
  board.textContent = "";
  if (enemy) {
    $("enemy-name").textContent = `${enemy.name} — ${enemy.remaining} ships left`;
    const struck = new Set(enemy.struck || []);
    const seen = new Set(enemy.incoming || []);
    const wrecked = new Set(enemy.sunkCells || []);
    const grid = el("div", "bgrid");
    grid.style.setProperty("--n", String(B.size));
    for (let r = 0; r < B.size; r++) {
      for (let c = 0; c < B.size; c++) {
        const cell = `${r},${c}`;
        const known = seen.has(cell);
        const box = el("button", "bcell" +
          (known ? (struck.has(cell) ? " hit" : " miss") : "") +
          (wrecked.has(cell) ? " wreck" : "") +
          (B.shots.includes(cell) ? " picked" : ""));
        box.type = "button";
        box.disabled = !myTurn || known;
        box.onclick = () => {
          const at = B.shots.indexOf(cell);
          if (at !== -1) B.shots.splice(at, 1);
          else if (B.shots.length < B.shotsPerTurn) B.shots.push(cell);
          drawBattle(me);
        };
        grid.append(box);
      }
    }
    board.append(grid);
  } else {
    $("enemy-name").textContent = "No target";
    board.append(el("p", "panel-sub", "Pick a captain to see their water."));
  }

  const left = B.shotsPerTurn - B.shots.length;
  const ready = myTurn && B.target && !blocked && left === 0;
  $("btn-fire").disabled = !ready;
  $("btn-fire").textContent = !myTurn ? "Not your turn"
    : blocked ? blocked.reason
    : ready ? "Take your Shot"
    : `${left} shot${left === 1 ? "" : "s"} left`;
  // Green when the trigger is live, red when it isn't your go.
  $("btn-fire").classList.toggle("fire-ready", ready);
  $("btn-fire").classList.toggle("fire-waiting", !myTurn);

  // Your own water, with your fleet on it.
  const mine = $("own-grid");
  mine.textContent = "";
  const hitCells = new Set((B.fleet || []).flatMap((s) => s.hits));
  const shipCells = new Map();
  for (const s of B.fleet || []) for (const cell of s.cells) shipCells.set(cell, s.sunk);
  const taken = new Set(me?.incoming || []);
  const grid = el("div", "bgrid own");
  grid.style.setProperty("--n", String(B.size));
  for (let r = 0; r < B.size; r++) {
    for (let c = 0; c < B.size; c++) {
      const cell = `${r},${c}`;
      // Each hit is marked where it landed. A sunk ship is no longer painted
      // red end to end, so you can still read which squares were actually hit.
      let cls = "bcell";
      if (shipCells.has(cell)) cls += " ship";
      if (hitCells.has(cell)) cls += " hit wreck";
      else if (taken.has(cell)) cls += " miss";
      grid.append(el("div", cls));
    }
  }
  mine.append(grid);
}

// ── feed and chat ───────────────────────────────────────────────────

function stamp(at) {
  return new Date(at || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function feedLine(text, at) {
  const p = el("p", "bfeed-line");
  p.innerHTML = `<span class="bt">${stamp(at)}</span> ${esc(text)}`;
  const host = $("battle-feed");
  host.prepend(p);
  while (host.children.length > 60) host.lastChild.remove();
}

function chatLine(m) {
  const p = el("p", "bchat-line");
  p.innerHTML = `<b>${esc(m.name)}</b> <span class="bt">${stamp(m.at)}</span><br>${esc(m.text)}`;
  const host = $("battle-chat");
  host.prepend(p);
  while (host.children.length > 60) host.lastChild.remove();
}

/** The winner's water, ships and all, once there's nothing left to give away. */
function drawReveal(rev) {
  const host = $("battle-reveal");
  if (!host || !rev) return;
  host.hidden = false;
  host.textContent = "";
  host.append(el("h3", "", `${rev.name}'s fleet`));

  const ship = new Map();
  for (const sh of rev.ships) for (const cell of sh.cells) ship.set(cell, sh);
  const hit = new Set(rev.ships.flatMap((sh) => sh.hits || []));
  const shot = new Set(rev.incoming || []);

  const grid = el("div", "bgrid reveal-grid");
  grid.style.setProperty("--n", String(rev.size || B.size));
  for (let r = 0; r < (rev.size || B.size); r++) {
    for (let c = 0; c < (rev.size || B.size); c++) {
      const cell = `${r},${c}`;
      let cls = "bcell";
      if (ship.has(cell)) cls += " champ";
      if (hit.has(cell)) cls += " hit wreck";
      else if (shot.has(cell)) cls += " miss";
      grid.append(el("div", cls));
    }
  }
  host.append(grid);
  const standing = rev.ships.filter((sh) => !sh.sunk).length;
  host.append(el("p", "reveal-count",
    `${standing} of ${rev.ships.length} ships still afloat.`));
  host.append(el("p", "reveal-count", "Returning to the arena in 5 seconds\u2026"));
}

/** Everyone reads the board, then the room closes itself. */
function partingClock() {
  clearInterval(B.bye);
  let left = 5;
  const note = $("battle-reveal")?.lastChild;
  B.bye = setInterval(() => {
    left -= 1;
    if (note) note.textContent = `Returning to the arena in ${left} second${left === 1 ? "" : "s"}\u2026`;
    if (left <= 0) {
      clearInterval(B.bye);
      B.bye = null;
      closeBattle();
      B.onLeave?.();
    }
  }, 1000);
}

function showResults(msg) {
  const host = $("battle-results");
  host.textContent = "";
  host.hidden = false;
  host.append(el("h3", "", "Battle over"));
  if (msg.bounty && (msg.bounty.claim || msg.bounty.defend)) {
    const card = el("div");
    card.innerHTML = window.__bountyCard ? window.__bountyCard(msg.bounty) : "";
    host.append(card);
  }
  const list = el("ol", "results-list");
  msg.results.forEach((r, i) => {
    const li = el("li", r.status === "won" ? "" : "dnf");
    li.append(el("span", "rank", String(i + 1)));
    li.append(el("span", "who", r.name));
    li.append(el("span", "time", `${r.hits} hits · ${r.sunk} sunk`));
    li.append(el("span", "gain", `+${r.gain}`));
    li.append(el("span", "pts", String(r.score)));
    list.append(li);
  });
  host.append(list);

  drawReveal(msg.reveal);
  partingClock();
}
