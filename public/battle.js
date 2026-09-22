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
// The squares a blast covers — the same rule as the server's, for the preview.
/** The cross a depth charge falls in — the server's shape, for the preview. */
function crossArea(cell, size) {
  const [r, c] = String(cell).split(",").map(Number);
  return [[r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    .filter(([rr, cc]) => rr >= 0 && cc >= 0 && rr < size && cc < size)
    .map(([rr, cc]) => `${rr},${cc}`);
}

function blastArea(cell, span, size) {
  const [r, c] = String(cell).split(",").map(Number);
  const odd = span % 2 === 1;
  const clamp = (v) => Math.max(0, Math.min(size - span, v));
  const r0 = odd ? r - Math.floor(span / 2) : clamp(r);
  const c0 = odd ? c - Math.floor(span / 2) : clamp(c);
  const out = [];
  for (let i = 0; i < span; i++) for (let j = 0; j < span; j++) {
    const rr = r0 + i, cc = c0 + j;
    if (rr >= 0 && cc >= 0 && rr < size && cc < size) out.push(`${rr},${cc}`);
  }
  return out;
}

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
  mode: null,        // nuke / strike / torpedo / shield while a token is being aimed
  arsenal: null,     // what this captain armed, from the room
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
  B.volley = {};      // target uid -> the squares picked on their water
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

let tokens = null;
const tokenTab = () => (tokens ||= applyTokenTab({ game: "battleship", send, button: $("btn-battle-boost"), arsenal: true }));

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
      // The chart can change in the lobby, and the board, the fleet and the
      // shots go with it. Taking these only from the welcome left a 10x10
      // grid and five ships on the screen after the host picked Open Ocean.
      if (msg.game?.size) {
        if (msg.game.size !== B.size) { B.placing = []; B.placeIdx = 0; B.shots = []; B.volley = {}; }
        B.size = msg.game.size;
      }
      if (msg.game?.fleet?.length) B.ships = msg.game.fleet;
      // Your own fleet may carry extra hulls, and your turn may carry extra shots.
      if (msg.yourFleetSpec?.length) {
        if (B.ships.length !== msg.yourFleetSpec.length) { B.placing = []; B.placeIdx = 0; }
        B.ships = msg.yourFleetSpec;
      }
      B.shotsPerTurn = msg.yourShots || msg.game?.shots || B.shotsPerTurn;
      B.arsenal = msg.arsenal || null;
      if (msg.game?.turnUid !== B.you && B.mode !== "shield") B.mode = null;
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
      tokenTab().reset();
      break;
    case "TOKENS":
      tokenTab().receive(msg);
      break;
    case "BATTLE_ERROR":
      say(msg.message);
      break;
    case "BATTLE_NOTE":
      feedLine(msg.text);
      say(msg.text);
      break;
    case "BATTLE_ARSENAL_STATE":
      B.arsenal = msg.arsenal;
      tokenTab().arsenalState(msg.arsenal);
      if (B.game) drawBattle(B.game.players.find((p) => p.uid === B.you));
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
  // One button: while the host has a battle running it ends the battle for
  // everyone and stays for the results; otherwise it walks out.
  $("btn-battle-leave").textContent = B.isHost && g.phase === "ACTIVE" ? "End the battle" : "End Match";

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
  // How many computers to face — one by default, up to five — and one
  // difficulty for the lot.
  host.append(el("span", "ai-label", "Opponents"));
  const counts = el("div", "ai-counts");
  for (let n = 1; n <= (g.maxAi || 5); n++) {
    const b = el("button", "ai-count" + ((g.aiCount || 1) === n ? " on" : ""));
    b.type = "button";
    b.textContent = String(n);
    b.title = n === 1 ? "One on one" : `You against ${n} computers`;
    b.onclick = () => send({ type: "BATTLE_SOLO", on: true, level: g.aiLevel || "medium", count: n });
    counts.append(b);
  }
  host.append(counts);
  host.append(el("span", "ai-label", (g.aiCount || 1) > 1 ? "Their difficulty (all of them)" : "Their difficulty"));
  for (const d of g.difficulties || []) {
    const b = el("button", "ai-pick" + (g.aiLevel === d.id ? " on" : ""));
    b.type = "button";
    b.append(el("span", "ai-name", d.name));
    b.append(el("span", "ai-blurb", d.blurb));
    b.onclick = () => send({ type: "BATTLE_SOLO", on: true, level: d.id, count: g.aiCount || 1 });
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
    ["useTokens", "Allow the arsenal", !!g.useTokens, "Captains may arm nukes, air strikes and the rest from the Token shop."],
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
    send({ type: "BATTLE_SOLO", on, level: B.game?.aiLevel || "medium", count: B.game?.aiCount || 1 });
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
    const volley = Object.entries(B.volley).filter(([, c]) => c.length).map(([target, cells]) => ({ target, cells }));
    const total = volley.reduce((n, v) => n + v.cells.length, 0);
    if (!volley.length) return say("Choose who you're firing at.");
    if (total !== B.shotsPerTurn) return say(`Choose ${B.shotsPerTurn} squares in all.`);
    send({ type: "BATTLE_FIRE", volley });
    B.shots = [];
    B.volley = {};
  };
  for (const [tab, pane] of [["bt-captains", "captains"], ["bt-feed", "feed"], ["bt-chat", "chat"]]) {
    const el0 = $(tab);
    if (el0) el0.onclick = () => showDeck(pane);
  }
  showDeck(B.deck || "captains");

  $("btn-battle-leave").onclick = () => {
    if (B.isHost && B.game?.phase === "ACTIVE") {
      if (!window.confirm("End the battle now? Everyone still afloat is ranked by damage dealt, and MMR is awarded as normal.")) return;
      send({ type: "BATTLE_END" });
      return;
    }
    if (B.game?.phase === "ACTIVE" && !confirm("Leave the battle and take the MMR you've earned so far?")) return;
    send({ type: "BATTLE_END" });
    closeBattle(); B.onLeave?.();
  };
  $("battle-say").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
  $("btn-battle-send").onclick = sendChat;
  tokenTab();
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
  // their water should stay on screen between turns. Shots picked on a
  // captain who has since gone down go with them.
  if (B.target && !foes.some((p) => p.uid === B.target)) { B.target = null; B.shots = []; }
  for (const uid of Object.keys(B.volley)) if (!foes.some((p) => p.uid === uid)) delete B.volley[uid];
  if (!myTurn) B.volley = {};
  const spent = Object.values(B.volley).reduce((n, c) => n + c.length, 0);
  // With one opponent there's nothing to choose, so choose it for them.
  if (!B.target && foes.length === 1) B.target = foes[0].uid;
  if (!B.target && myTurn) B.target = (B.targets.find((t) => t.allowed) || {}).uid || null;

  drawArsenal(me, myTurn);

  const sel = $("target-list");
  sel.textContent = "";
  const blocked = B.targets.find((t) => t.uid === B.target && !t.allowed);

  if (foes.length <= 1 && !watching) {
    sel.append(el("p", "panel-sub",
      g.phase === "OVER" ? "The guns are quiet."
        : myTurn ? `One opponent left. Pick ${B.shotsPerTurn} squares and fire.`
        : "Waiting for your opponent."));
  } else {
    if (myTurn && foes.length > 1) {
      sel.append(el("p", "panel-sub volley-hint",
        `${B.shotsPerTurn} shots this turn. Spread them over several captains, or put them all on one.`));
    }
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
      // How many of this turn's shots are on their water.
      const on = (B.volley[t.uid] || []).length;
      if (on) b.append(el("span", "tgt-shots", `${on} shot${on === 1 ? "" : "s"}`));
      b.onclick = () => { B.target = t.uid; drawBattle(me); };
      sel.append(b);
    }
  }

  // Their water.
  const enemy = g.players.find((p) => p.uid === B.target);
  const board = $("enemy-grid");
  board.textContent = "";
  if (enemy) {
    const mine = B.volley[enemy.uid] || [];
    $("enemy-name").textContent = `${enemy.name} — ${enemy.remaining} ships left${myTurn && mine.length ? ` · ${mine.length} shot${mine.length === 1 ? "" : "s"} here` : ""}`;
    const struck = new Set(enemy.struck || []);
    const seen = new Set(enemy.incoming || []);
    const wrecked = new Set(enemy.sunkCells || []);
    // A defence you were shown, or one that has already taken a strike.
    const intel = new Set(B.arsenal?.intel?.[enemy.uid] || []);   // a defence, or a ship the spotter found
    const shown = new Set(enemy.shieldShown || []);
    const blastMode = ["nuke", "strike", "depth", "sonar"].includes(B.mode);
    const span = B.mode === "nuke" ? (B.arsenal?.nukeSpan || 1)
      : B.mode === "strike" ? (B.arsenal?.strikeSpan || 6)
      : B.mode === "sonar" ? 3 : 1;
    const grid = el("div", "bgrid");
    grid.style.setProperty("--n", String(B.size));
    for (let r = 0; r < B.size; r++) {
      for (let c = 0; c < B.size; c++) {
        const cell = `${r},${c}`;
        const known = seen.has(cell);
        const box = el("button", "bcell" +
          (known ? (struck.has(cell) ? " hit" : " miss") : "") +
          (wrecked.has(cell) ? " wreck" : "") +
          (intel.has(cell) ? " shield" : shown.has(cell) ? " shield spent" : "") +
          (mine.includes(cell) ? " picked" : ""));
        box.type = "button";
        box.disabled = !myTurn || (known && !blastMode);
        if (blastMode) {
          box.onmouseenter = () => {
            grid.querySelectorAll(".blast").forEach((n) => n.classList.remove("blast"));
            const area = B.mode === "depth" ? crossArea(cell, B.size) : blastArea(cell, span, B.size);
            for (const x of area) {
              const [rr, cc] = x.split(",").map(Number);
              grid.children[rr * B.size + cc]?.classList.add("blast");
            }
          };
          box.onmouseleave = () => grid.querySelectorAll(".blast").forEach((n) => n.classList.remove("blast"));
        }
        box.onclick = () => {
          if (["nuke", "strike", "torpedo", "depth", "sonar"].includes(B.mode)) {
            const what = { nuke: "the nuke", strike: "the air strike", torpedo: "a torpedo", depth: "a depth charge", sonar: "a sonar ping" }[B.mode];
            if (!window.confirm(`Send ${what} at ${enemy.name} here?`)) return;
            send({ type: "BATTLE_ARSENAL", action: B.mode, target: enemy.uid, cell });
            // A blast is the turn; a torpedo or a ping leaves the volley alone.
            if (B.mode === "nuke" || B.mode === "strike" || B.mode === "depth") B.volley = {};
            B.mode = null;
            drawBattle(me);
            return;
          }
          const picks = B.volley[enemy.uid] = B.volley[enemy.uid] || [];
          const at = picks.indexOf(cell);
          if (at !== -1) picks.splice(at, 1);
          else if (spent < B.shotsPerTurn) picks.push(cell);
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

  const left = B.shotsPerTurn - spent;
  // Every captain with shots on them must be one the rotation allows.
  const aimedAt = Object.keys(B.volley).filter((uid) => B.volley[uid].length);
  const barred = aimedAt.map((uid) => B.targets.find((t) => t.uid === uid)).find((t) => t && !t.allowed);
  const ready = myTurn && aimedAt.length > 0 && !barred && left === 0;
  $("btn-fire").disabled = !ready;
  $("btn-fire").textContent = !myTurn ? "Not your turn"
    : barred ? `${barred.name}: ${barred.reason}`
    : blocked && !aimedAt.length ? blocked.reason
    : ready ? (aimedAt.length > 1 ? `Fire on ${aimedAt.length} captains` : "Take your Shot")
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
  const shielding = B.mode === "shield";
  const myShield = new Set(B.arsenal?.shield?.cells || []);
  const shieldSpent = !!B.arsenal?.shield?.spent;
  const grid = el("div", "bgrid own" + (shielding ? " aiming" : ""));
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
      if (myShield.has(cell)) cls += shieldSpent ? " shield spent" : " shield";
      if (!shielding) { grid.append(el("div", cls)); continue; }
      const box = el("button", cls);
      box.type = "button";
      box.onmouseenter = () => {
        grid.querySelectorAll(".blast").forEach((n) => n.classList.remove("blast"));
        for (const x of blastArea(cell, B.arsenal?.strikeSpan || 6, B.size)) {
          const [rr, cc] = x.split(",").map(Number);
          grid.children[rr * B.size + cc]?.classList.add("blast");
        }
      };
      box.onmouseleave = () => grid.querySelectorAll(".blast").forEach((n) => n.classList.remove("blast"));
      box.onclick = () => {
        if (!window.confirm("Put the Air Strike Defence here? It stays until a strike hits it.")) return;
        send({ type: "BATTLE_ARSENAL", action: "shield", cell });
        B.mode = null;
        drawBattle(me);
      };
      grid.append(box);
    }
  }
  mine.append(grid);
}

// ── the arsenal strip ───────────────────────────────────────────────
//
// One button per armed token with uses left. Blasts and the torpedo put the
// enemy board into an aiming mode; the shield does the same on your own.
function drawArsenal(me, myTurn) {
  const host = $("battle-arsenal");
  if (!host) return;
  const ars = B.arsenal;
  const g = B.game;
  const left = (k) => (ars?.armed?.[k] || 0) - (ars?.used?.[k] || 0);
  const any = ars && ars.on && ARSENAL_ITEMS.some((t) => t.act !== "ships" && left(t.key) > 0);
  host.hidden = !any || g.phase !== "ACTIVE" || !me?.alive;
  host.textContent = "";
  if (host.hidden) { if (B.mode) B.mode = null; return; }

  host.append(el("span", "ars-label", "Arsenal"));
  const mk = (label, on, disabled, click, title) => {
    const b = el("button", "ars-btn" + (on ? " on" : ""), label);
    b.type = "button"; b.disabled = !!disabled; if (title) b.title = title;
    b.onclick = click;
    host.append(b);
  };
  const aim = (mode) => () => { B.mode = B.mode === mode ? null : mode; drawBattle(me); };
  const target = () => g.players.find((p) => p.uid === B.target);

  for (const t of ARSENAL_ITEMS) {
    if (t.act === "ships") continue;             // armed before the fleets sail
    const n = left(t.key);
    if (n <= 0) continue;
    const short = t.name.replace("Tactical ", "").replace("Submarine ", "").replace(" Missile", "").replace("Air Strike Reveal", "Reveal").replace("Air Strike Defence", "Defence").replace("Evasive Maneuvers", "Evade").replace("Reinforced Hull", "Armour");
    let label = t.icon + " " + short + " \u00d7" + n;
    let on = false;
    let off = false;
    let title = t.blurb;
    if (t.act === "extra" && ars.extraActive) { label = t.icon + " +" + ars.extraShots + " this turn"; on = true; off = true; }
    else if (t.act === "extra") off = !myTurn;
    else if (t.act === "strike") { off = !myTurn || !ars.carrierAfloat; if (!ars.carrierAfloat) title = "Your carrier is gone"; }
    else if (t.act === "torpedo") { off = !myTurn || !ars.subAfloat; if (!ars.subAfloat) title = "Your submarine is gone"; }
    else if (t.act === "nuke" || t.act === "depth") off = !myTurn;
    else if (t.act === "priority") { on = !!ars.priority; off = !myTurn || !!ars.priority; }
    else if (t.act === "shield") { on = B.mode === "shield"; off = !!(ars.shield && !ars.shield.spent); if (off) title = "A defence is already in place"; }
    else if (t.act === "smoke") { on = !!ars.smoke; off = !!ars.smoke; if (off) title = "The smoke is already up"; }
    else if (t.act === "repair") { off = !ars.damaged; if (off) title = "Nothing of yours is damaged"; }
    else if (t.act === "armour") { off = !ars.armourable; if (off) title = "Every ship you have is reinforced, or gone"; }
    else if (t.act === "evade") { off = !ars.movable; if (off) title = "Only an unhit ship can slip away"; }
    if (t.aim === "cell" || t.aim === "own") on = B.mode === t.act;
    if ((t.aim === "target" || t.aim === "line") && !B.target) { off = true; title = "Pick a captain first"; }
    mk(label, on, off, () => {
      if (t.aim === "cell" || t.aim === "own") return aim(t.act)();
      if (t.aim === "line") return askLine(t);
      const who = target();
      const ask = t.aim === "target" ? t.name + " on " + (who ? who.name : "them") + "?" : t.name + "? " + t.blurb;
      if (!window.confirm(ask)) return;
      send({ type: "BATTLE_ARSENAL", action: t.act, ...(t.aim === "target" ? { target: B.target } : {}) });
    }, title);
  }
  if (ars.point > 0)
    mk("\u{1F6DF} " + ars.point + " ready", true, true, () => {}, "Shots that will be turned aside");
  if (ars.smoke)
    mk("\u{1F32B}\uFE0F Smoke up", true, true, () => {}, "Hits on you read as misses until it clears");

  if (B.mode) {
    const hint = {
      nuke: "Nuke armed \u2014 pick a square on the enemy's water. It takes your turn.",
      strike: "Air strike armed \u2014 point at the enemy's water; the 6\u00d76 area is shown as you hover. It takes your turn.",
      depth: "Depth charge armed \u2014 pick a square; the cross around it is shown as you hover. It takes your turn.",
      sonar: "Sonar armed \u2014 point at the enemy's water; the 3\u00d73 window is shown as you hover.",
      torpedo: "Torpedo armed \u2014 pick one square on the enemy's water.",
      shield: "Pick a square on your own water; the 6\u00d76 defence is shown as you hover.",
    }[B.mode];
    const p = el("p", "ars-hint", (hint || "Pick a square.") + " ");
    const x = el("button", "btn btn-tiny", "Cancel");
    x.type = "button"; x.onclick = () => { B.mode = null; drawBattle(me); };
    p.append(x);
    host.append(p);
  }
  if (ars.reports?.length) {
    const p = el("p", "ars-hint ars-intel", ars.reports.map((x) => x.text).join("  \u00b7  "));
    host.append(p);
  }
}

/** A row or a column, for the radar. */
function askLine(t) {
  const size = B.size || 10;
  const answer = window.prompt("Radar Sweep \u2014 which line? A row as R then its number, a column as C then its number (R1 to R" + size + ", C1 to C" + size + ").", "R1");
  if (!answer) return;
  const m = /^\s*([rcRC])\s*([0-9]+)\s*$/.exec(answer);
  if (!m) return say("That is not a line. Try R3, or C7.");
  const n = Number(m[2]) - 1;
  if (!(n >= 0 && n < size)) return say("There is no line there.");
  send({ type: "BATTLE_ARSENAL", action: "radar", target: B.target, line: m[1].toLowerCase() + n });
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
    li.append(el("span", "time", `${r.hits} hits · ${r.sunk} sunk${r.shots ? ` · ${r.accuracy}% aim${r.aim > 1 ? ` (+${Math.round((r.aim - 1) * 100)}%)` : r.aim < 1 ? ` (${Math.round((r.aim - 1) * 100)}%)` : ""}` : ""}`));
    li.append(el("span", "gain", `+${r.gain}`));
    li.append(el("span", "pts", String(r.score)));
    list.append(li);
  });
  host.append(list);

  drawReveal(msg.reveal);
  partingClock();
}import { applyTokenTab, ARSENAL_ITEMS } from "./boost.js";

