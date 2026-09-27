// Artillery Tank Duel, client side.
//
// The room fires every shell and sends the finished flight back, so nothing
// here works out where a shot went — it animates a path that has already
// happened and then takes the ground, the health and the deaths from the same
// message. That is why a console cannot hit anybody with this file: there is
// nothing in it to lie to.
//
// What it does own is the aiming: the dial, which tokens are going up with the
// next shell, and where a strike is pointed. All three are sent to the room
// and the room decides what they meant.
import { applyTokenTab, TANK_ARSENAL_ITEMS } from "./boost.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** How fast a flight is drawn, in path points a frame. */
const TRACE_SPEED = 2.2;
/** How long a crater flashes before the ground it made is drawn. */
const BLAST_MS = 420;

export const T = {
  socket: null, code: null, you: null, isHost: false,
  state: null,            // the last TANK_STATE
  terrain: [],            // what is drawn, which lags the state while a shell flies
  tanks: [],
  picked: new Set(),      // tokens going up with the next shot
  aimX: null,             // where a strike is pointed
  flying: null,           // the shot being animated
  frame: null, beat: null,
  onLeave: null,
};

export async function enterTanks(code, getToken, onLeave) {
  T.code = code;
  T.onLeave = onLeave;
  T.picked = new Set();
  T.aimX = null;
  $("tank-code").textContent = code;
  $("tank-results").hidden = true;
  await connect(getToken);
  loop();
}

async function connect(getToken) {
  closeTanks(false);
  const token = await getToken();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/tanks/${T.code}/ws?token=${encodeURIComponent(token)}`);
  T.socket = ws;
  ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch { /* ignore */ } };
  ws.onclose = () => {
    clearInterval(T.beat);
    T.beat = null;
    if (T.code) setTimeout(() => { if (T.code) connect(getToken); }, 1500);
  };
  clearInterval(T.beat);
  T.beat = setInterval(() => send({ type: "PING" }), 30_000);
}

export function closeTanks(forget = true) {
  if (T.socket) { T.socket.onclose = null; T.socket.close(); T.socket = null; }
  if (forget) {
    T.code = null;
    cancelAnimationFrame(T.frame);
    T.frame = null;
  }
}

const send = (o) => { if (T.socket?.readyState === WebSocket.OPEN) T.socket.send(JSON.stringify(o)); };

let tokens = null;
const tokenTab = () => (tokens ||= applyTokenTab({
  game: "artillery", send, button: $("btn-tank-boost"), label: "duel", arsenal: TANK_ARSENAL_ITEMS,
}));

function say(text, bad = true) {
  const n = $("tank-error");
  n.hidden = !text;
  n.className = bad ? "notice notice-bad" : "notice";
  n.textContent = text || "";
  if (text) setTimeout(() => { if (n.textContent === text) n.hidden = true; }, 4000);
}

/* ── what the room says ──────────────────────────────────────────── */

function handle(msg) {
  switch (msg.type) {
    case "TANK_WELCOME":
      T.you = msg.you;
      T.isHost = !!msg.isHost;
      break;
    case "TANK_STATE":
      T.state = msg.state;
      // While a shell is in the air the drawn field is the one it was fired
      // over: the state has already moved on, and using it would show the
      // crater before the shell reached it.
      if (!T.flying) {
        T.terrain = msg.state?.terrain || [];
        T.tanks = msg.state?.tanks || [];
      }
      drawShell();
      break;
    case "TANK_START":
      T.terrain = msg.terrain;
      say("");
      break;
    case "TANK_SHOT":
      // Everything the turn did, held until the animation has caught up.
      T.flying = {
        flights: msg.flights.map((f) => f.path),
        step: 0,
        blasts: msg.blasts,
        level: msg.level,
        until: 0,
        after: { terrain: msg.terrain, tanks: msg.tanks },
        hits: msg.hits,
      };
      if (msg.plan?.tokens?.length) T.picked = new Set();
      break;
    case "TANK_TURN":
      drawShell();
      break;
    case "TANK_BARREL": {
      const t = T.tanks.find((x) => x.uid === msg.uid);
      if (t) { t.angle = msg.angle; t.power = msg.power; }
      break;
    }
    case "TANK_EVENT":
      if (msg.kind === "teleport") {
        const t = T.tanks.find((x) => x.uid === msg.uid);
        if (t) { t.x = msg.x; t.y = msg.y; }
      }
      break;
    case "TANK_NOTE": say(msg.text, false); break;
    case "TANK_REJECT": say(msg.why); break;
    case "TANK_OVER": showResults(msg); break;
    case "TANK_TOKENS": tokenTab().receive(msg); drawStrip(); break;
    case "TANK_ARSENAL_STATE": tokenTab().arsenalState(msg.arsenal); drawStrip(); break;
  }
}

/* ── the field ───────────────────────────────────────────────────── */

function fit() {
  const c = $("tank-canvas");
  const world = T.state?.world || { w: 1000, h: 600 };
  const wide = c.clientWidth || 1000;
  c.width = Math.round(wide);
  c.height = Math.round((wide * world.h) / world.w);
  return { c, sx: c.width / world.w, sy: c.height / world.h };
}

function draw() {
  const { c, sx, sy } = fit();
  const g = c.getContext("2d");
  const world = T.state?.world || { w: 1000, h: 600, r: 11 };
  g.clearRect(0, 0, c.width, c.height);

  // sky
  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, "#0b1220");
  sky.addColorStop(1, "#243449");
  g.fillStyle = sky;
  g.fillRect(0, 0, c.width, c.height);

  // ground
  if (T.terrain.length) {
    g.beginPath();
    g.moveTo(0, c.height);
    for (let x = 0; x < T.terrain.length; x++) g.lineTo(x * sx, T.terrain[x] * sy);
    g.lineTo(c.width, c.height);
    g.closePath();
    const soil = g.createLinearGradient(0, 0, 0, c.height);
    soil.addColorStop(0, "#4b7a3a");
    soil.addColorStop(1, "#2a2016");
    g.fillStyle = soil;
    g.fill();
  }

  // fire still burning
  for (const f of T.state?.fires || []) {
    const ground = T.terrain[Math.round(f.x)] || 0;
    g.fillStyle = "rgba(255,132,40,0.35)";
    g.beginPath();
    g.ellipse(f.x * sx, ground * sy, f.radius * sx, 8 * sy, 0, 0, Math.PI * 2);
    g.fill();
  }

  // the tanks
  for (const t of T.tanks) {
    const x = t.x * sx, y = t.y * sy, r = world.r * sx;
    g.globalAlpha = t.dead ? 0.35 : 1;
    g.fillStyle = t.uid === T.you ? "#8fd0ff" : t.ai ? "#e2a06a" : "#d9e2ec";
    g.beginPath();
    g.arc(x, y, r, Math.PI, 0);
    g.fill();
    g.fillRect(x - r, y, r * 2, r * 0.7);
    // the barrel, where the room last heard it was pointed
    const rad = ((t.angle ?? 45) * Math.PI) / 180;
    g.strokeStyle = g.fillStyle;
    g.lineWidth = Math.max(2, r * 0.35);
    g.beginPath();
    g.moveTo(x, y - r * 0.4);
    g.lineTo(x + Math.cos(rad) * r * 2.2, y - r * 0.4 - Math.sin(rad) * r * 2.2);
    g.stroke();
    // health
    g.globalAlpha = 1;
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(x - r * 1.6, y - r * 2.6, r * 3.2, 5);
    g.fillStyle = t.hp > 50 ? "#68d391" : t.hp > 20 ? "#f6e05e" : "#fc8181";
    g.fillRect(x - r * 1.6, y - r * 2.6, (r * 3.2 * Math.max(0, t.hp)) / 100, 5);
    if ((t.guards || []).includes("at_bubble")) {
      g.strokeStyle = "rgba(143,208,255,0.8)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y - r * 0.3, r * 2, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.globalAlpha = 1;

  // a tracer round draws the last shot again while you aim
  const trace = T.state?.arsenal?.tracer?.path;
  if (trace?.length && !T.flying) {
    g.strokeStyle = "rgba(255,255,255,0.22)";
    g.setLineDash([4, 6]);
    g.beginPath();
    trace.forEach(([px, py], i) => (i ? g.lineTo(px * sx, py * sy) : g.moveTo(px * sx, py * sy)));
    g.stroke();
    g.setLineDash([]);
  }

  // where a strike is pointed
  if (T.aimX != null) {
    g.strokeStyle = "rgba(255,196,90,0.8)";
    g.beginPath();
    g.moveTo(T.aimX * sx, 0);
    g.lineTo(T.aimX * sx, c.height);
    g.stroke();
  }

  // the shot in the air
  if (T.flying) {
    g.lineWidth = 2;
    g.strokeStyle = "#ffd48a";
    for (const path of T.flying.flights) {
      const upto = Math.min(path.length, Math.floor(T.flying.step));
      if (upto < 2) continue;
      g.beginPath();
      for (let i = 0; i < upto; i++) {
        const [px, py] = path[i];
        i ? g.lineTo(px * sx, py * sy) : g.moveTo(px * sx, py * sy);
      }
      g.stroke();
      const [hx, hy] = path[upto - 1];
      g.fillStyle = "#fff3d6";
      g.beginPath();
      g.arc(hx * sx, hy * sy, 3, 0, Math.PI * 2);
      g.fill();
    }
    if (T.flying.until) {
      const left = (T.flying.until - Date.now()) / BLAST_MS;
      for (const b of T.flying.blasts) {
        g.fillStyle = `rgba(255,${b.kind === "mud" ? 200 : 120},60,${Math.max(0, left) * 0.7})`;
        g.beginPath();
        g.arc(b.x * sx, b.y * sy, b.radius * sx * (1.2 - Math.max(0, left) * 0.4), 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

/** One frame: move the shell along its path, then hand the field over. */
function loop() {
  T.frame = requestAnimationFrame(loop);
  const f = T.flying;
  if (f) {
    const longest = Math.max(...f.flights.map((p) => p.length), 1);
    if (f.step < longest) f.step += TRACE_SPEED;
    else if (!f.until) f.until = Date.now() + BLAST_MS;
    else if (Date.now() >= f.until) {
      T.terrain = f.after.terrain;
      T.tanks = f.after.tanks;
      T.flying = null;
      drawShell();
    }
  }
  draw();
}

/* ── the panels ──────────────────────────────────────────────────── */

function drawShell() {
  const s = T.state;
  if (!s) return;
  $("tank-phase").textContent = s.phase === "PLAYING" ? "In the field" : s.phase === "OVER" ? "Duel over" : "Lobby";
  const wind = s.wind || 0;
  $("tank-wind").textContent = `${wind === 0 ? "calm" : `${Math.abs(wind)} ${wind > 0 ? "→" : "←"}`}`;
  const turn = s.tanks.find((t) => t.uid === s.turn);
  const mine = s.turn === T.you;
  $("tank-turn").textContent = s.phase !== "PLAYING" ? "—" : mine ? "Your shot" : `${turn?.name || "—"} is shooting`;
  $("tank-fire").disabled = !mine || s.phase !== "PLAYING" || !!T.flying;
  $("tank-host").hidden = !s.isHost || s.phase === "PLAYING";
  $("btn-tank-start").textContent = s.roundNo ? "Fight again" : "Begin the duel";
  if (s.aim) {
    // The room withholds the dial from a tank an EMP has just hit, which is
    // the whole of what an EMP does — so an empty aim is not a missing reply.
    if (document.activeElement !== $("tank-angle")) $("tank-angle").value = s.aim.angle;
    if (document.activeElement !== $("tank-power")) $("tank-power").value = s.aim.power;
  }
  $("tank-emp").hidden = !s.emp;

  const field = $("tank-field");
  field.textContent = "";
  for (const t of [...s.tanks].sort((a, b) => b.hp - a.hp)) {
    const row = el("li", `tank-row${t.dead ? " out" : ""}${t.uid === s.turn ? " up" : ""}`);
    row.append(el("b", null, `${t.ico || "\u{1F396}"} ${t.name}${t.ai ? " (cpu)" : ""}`));
    row.append(el("span", "tank-hp", t.dead ? "destroyed" : `${t.hp} hp`));
    row.append(el("i", null, `${t.hits}/${t.shots} · ${t.damage} dealt`));
    field.append(row);
  }
  drawStrip();
}

/**
 * The strip of tokens that are fired with a shot, and the ones that are not.
 *
 * A guard or a teleport is sent the moment it is clicked; a shell or a strike
 * is only picked, and goes up with the next shot. The difference is the room's
 * and the strip only has to show it.
 */
function drawStrip() {
  const a = T.state?.arsenal;
  const strip = $("tank-strip");
  strip.hidden = !a?.on;
  if (!a?.on) return;
  strip.textContent = "";
  for (const item of TANK_ARSENAL_ITEMS) {
    const left = (a.armed[item.key] || 0) - (a.used[item.key] || 0);
    if (left <= 0) continue;
    const kind = a.kinds[item.key];
    const shot = kind === "shell" || kind === "strike";
    const b = el("button", `ars-btn${T.picked.has(item.key) ? " on" : ""}${a.guards?.includes(item.key) ? " live" : ""}`);
    b.title = item.blurb;
    b.append(el("span", "ars-ico", item.icon));
    b.append(el("span", "ars-name", item.name));
    b.append(el("span", "ars-left", `×${left}`));
    b.onclick = () => {
      if (shot) {
        // One payload at a time, because the room takes one and a second
        // pick would be silently dropped.
        if (T.picked.has(item.key)) T.picked.delete(item.key);
        else {
          if (a.payloads.includes(item.key)) for (const k of a.payloads) T.picked.delete(k);
          if (kind === "strike") T.picked = new Set();
          T.picked.add(item.key);
        }
        if (kind === "strike" && T.picked.has(item.key) && T.aimX == null) {
          say("Click the field to point the strike.", false);
        }
        drawStrip();
        return;
      }
      if (item.aim === "target") {
        const mark = T.state.tanks.find((t) => !t.dead && t.uid !== T.you);
        send({ type: "TANK_ARSENAL", key: item.key, at: mark?.uid });
        return;
      }
      send({ type: "TANK_ARSENAL", key: item.key });
    };
    strip.append(b);
  }
}

function showResults(msg) {
  const box = $("tank-results");
  box.hidden = false;
  box.textContent = "";
  box.append(el("h2", null, msg.status === "mutual" ? "Everybody lost" : "Last tank standing"));
  const list = el("ol", "tank-results-list");
  for (const r of msg.results) {
    const row = el("li");
    row.append(el("b", null, `${r.placement}. ${r.name}${r.ai ? " (cpu)" : ""}`));
    row.append(el("span", null, ` ${r.score} pts · ${r.hits}/${r.shots} · ${r.damage} dealt`));
    if (!r.ai) row.append(el("i", null, ` ${r.gain >= 0 ? "+" : ""}${r.gain} MMR · ${r.belt}`));
    list.append(row);
  }
  box.append(list);
  tokenTab().reset();
}

/* ── the controls ────────────────────────────────────────────────── */

export function bindTankControls() {
  $("btn-tank-leave").onclick = () => { send({ type: "TANK_END" }); closeTanks(); T.onLeave?.(); };
  // The tab binds the button itself, and asks the room what is held when it
  // opens — built here so the button works before the first reply lands.
  tokenTab();
  $("btn-tank-start").onclick = () => send({
    type: "TANK_START",
    ai: Number($("tank-ai").value || 0),
    level: $("tank-level").value,
  });

  const aim = () => send({
    type: "TANK_AIM",
    angle: Number($("tank-angle").value),
    power: Number($("tank-power").value),
  });
  $("tank-angle").oninput = () => { $("tank-angle-read").textContent = `${$("tank-angle").value}°`; };
  $("tank-power").oninput = () => { $("tank-power-read").textContent = $("tank-power").value; };
  $("tank-angle").onchange = aim;
  $("tank-power").onchange = aim;

  $("tank-fire").onclick = () => {
    send({
      type: "TANK_FIRE",
      angle: Number($("tank-angle").value),
      power: Number($("tank-power").value),
      use: [...T.picked],
      aimX: T.aimX,
    });
    $("tank-fire").disabled = true;
  };

  // Where a strike is called down. Nothing else on the canvas is clickable:
  // a shot is the dial, so that a phone and a mouse aim the same way.
  $("tank-canvas").onclick = (ev) => {
    const c = $("tank-canvas");
    const box = c.getBoundingClientRect();
    const world = T.state?.world || { w: 1000 };
    T.aimX = Math.round(((ev.clientX - box.left) / box.width) * world.w);
  };
}
