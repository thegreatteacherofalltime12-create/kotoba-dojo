// The Buzzer, client side.
//
// The room holds every answer; this draws the board, the clue and the four
// options when they are yours, and sends a buzz stamped with the moment the
// button went down. Nothing here knows an answer before the room says so —
// not even the one on screen, which arrives as text with no answer attached.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (n) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;

export const B = {
  socket: null, code: null, you: null, isHost: false,
  game: null, onLeave: null, beat: null, tick: null,
  skew: 0, samples: [], deck: "podiums",
  options: null, optionsUntil: 0, pick: { round: 1, chosen: [] },
};

// ── the clock ────────────────────────────────────────────────────────

/**
 * A round trip, several times over.
 *
 * The race measures skew from a single serverNow, which bakes one way of
 * latency into the answer. That is harmless in a race and wrong here: it
 * would quietly hand a player on bad wifi a head start the size of their own
 * latency. This is the ordinary clock-sync arithmetic instead, and the sample
 * kept is the one from the quickest round trip, because that is the one least
 * polluted by a packet sitting in a queue somewhere.
 */
function measureSkew() {
  B.samples = [];
  for (let i = 0; i < 5; i++) {
    setTimeout(() => send({ type: "BZ_SKEW", t0: Date.now() }), i * 140);
  }
}

function onPong(msg) {
  const t1 = Date.now();
  const rtt = t1 - msg.t0;
  const skew = (msg.t0 + t1) / 2 - msg.serverNow;
  B.samples.push({ rtt, skew });
  B.samples.sort((a, b) => a.rtt - b.rtt);
  B.skew = B.samples[0].skew;
}

/** This browser's best guess at what the room's clock reads right now. */
const serverNow = () => Date.now() - B.skew;

// ── sound ────────────────────────────────────────────────────────────

let audioCtx = null;
let muted = false;
try { muted = localStorage.getItem("bz-muted") === "1"; } catch { /* private window */ }

export function isMuted() { return muted; }

export function setMuted(on) {
  muted = !!on;
  try { localStorage.setItem("bz-muted", muted ? "1" : "0"); } catch { /* fine */ }
  const b = $("btn-bz-mute");
  if (b) {
    b.textContent = muted ? "\u{1F507} Sound off" : "\u{1F50A} Sound on";
    b.setAttribute("aria-pressed", String(muted));
  }
}

/**
 * Three cues, synthesised, and nothing else.
 *
 * This is the first sound the arena has ever made, so the rule is strict:
 * nothing may be sound-only. Every cue below has a visual twin that carries
 * the whole meaning by itself, for a phone on silent and for anybody who
 * cannot hear it. The mute is deliberately not tied to prefers-reduced-motion
 * — somebody who dislikes things flying about has said nothing whatever about
 * wanting the buzzer cue taken away from them.
 */
export function playCue(type) {
  if (muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // A context made before the first tap starts suspended, and stays that
    // way until something asks it not to.
    if (audioCtx.state === "suspended") audioCtx.resume();

    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === "open") {
      // Two notes rising, which reads as "now" rather than as a warning.
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.setValueAtTime(780, t + 0.09);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.start(t); osc.stop(t + 0.28);
    } else if (type === "wrong") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, t);
      gain.gain.setValueAtTime(0.10, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      osc.start(t); osc.stop(t + 0.4);
    } else if (type === "tick") {
      osc.type = "square";
      osc.frequency.setValueAtTime(800, t);
      gain.gain.setValueAtTime(0.04, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.start(t); osc.stop(t + 0.06);
    }
  } catch { /* no audio here, and the screen still says everything */ }
}

// ── the socket ───────────────────────────────────────────────────────

export async function enterBuzzer(code, getToken, onLeave) {
  B.code = code;
  B.onLeave = onLeave;
  B.options = null;
  $("bz-code").textContent = code;
  $("bz-feed").textContent = "";
  $("bz-chat").textContent = "";
  setMuted(muted);
  showDeck("podiums");
  await connect(getToken);
}

async function connect(getToken) {
  closeBuzzer(false);
  const token = await getToken();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/buzzer/${B.code}/ws?token=${encodeURIComponent(token)}`);
  B.socket = ws;
  ws.onopen = () => measureSkew();
  ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch { /* ignore */ } };
  ws.onclose = () => {
    clearInterval(B.beat);
    B.beat = null;
    if (B.code) setTimeout(() => { if (B.code) connect(getToken); }, 1500);
  };
  clearInterval(B.beat);
  B.beat = setInterval(() => { send({ type: "PING" }); measureSkew(); }, 30_000);
  clearInterval(B.tick);
  B.tick = setInterval(paintClock, 100);
}

export function closeBuzzer(forget = true) {
  if (B.socket) { B.socket.onclose = null; B.socket.close(); B.socket = null; }
  clearInterval(B.tick); B.tick = null;
  clearInterval(B.beat); B.beat = null;
  if (forget) B.code = null;
}

const send = (o) => { try { B.socket?.send(JSON.stringify(o)); } catch { /* closed */ } };

let sayTimer = null;
function say(text) {
  const n = $("bz-error");
  n.textContent = text || "";
  n.hidden = !text;
  clearTimeout(sayTimer);
  if (text) sayTimer = setTimeout(() => { n.textContent = ""; n.hidden = true; }, 6_000);
}

// ── what the room says ───────────────────────────────────────────────

function handle(msg) {
  switch (msg.type) {
    case "BZ_WELCOME":
      B.you = msg.you;
      B.isHost = !!msg.isHost;
      B.catalogue = msg.catalogue || [];
      B.sections = msg.sections || [];
      B.aiLevels = msg.aiLevels || [];
      B.aiMax = msg.aiMax || 5;
      break;
    case "BZ_PONG": return onPong(msg);
    case "BZ_STATE": return draw(msg.game);
    case "BZ_OPTIONS":
      B.options = msg.options;
      B.optionsUntil = msg.until;
      return drawOptions();
    case "BZ_VERDICT": return verdict(msg);
    case "BZ_GO":
      $("bz-lobby").hidden = true;
      $("bz-board-wrap").hidden = false;
      return;
    case "BZ_FEED": return feedLine(msg.entry.text, msg.entry.at);
    case "BZ_CHAT": return chatLine(msg);
    case "BZ_OVER": return drawResults(msg);
    case "BZ_ERROR": return say(msg.message);
    default: break;
  }
}

function verdict(msg) {
  B.options = null;
  drawOptions();
  const flash = $("bz-flash");
  if (msg.right) {
    flash.textContent = `${msg.answer} — ${money(msg.value)}`;
    flash.className = "bz-flash good";
  } else {
    playCue("wrong");
    flash.textContent = msg.uid
      ? `Not ${msg.picked || "in time"}. −${money(msg.value)}`
      : `Nobody had it. ${msg.answer}`;
    flash.className = "bz-flash bad";
  }
}

// ── the board ────────────────────────────────────────────────────────

let lastStage = null;

function draw(g) {
  B.game = g;
  B.isHost = g.hostUid === B.you;

  const playing = g.phase === "PLAYING";
  $("bz-lobby").hidden = playing || g.phase === "RESULTS";
  $("bz-board-wrap").hidden = !playing;
  $("bz-phase").textContent = playing ? `Round ${g.round}` : g.phase === "RESULTS" ? "Finished" : "Lobby";

  if (!playing) drawLobby(g);
  else drawBoard(g);
  drawPodiums(g);
}

function drawBoard(g) {
  const host = $("bz-board");
  host.textContent = "";
  g.cats.forEach((c) => host.append(el("div", "bz-category", c.name)));
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < g.cats.length; col++) {
      const spent = g.spent[col][row];
      const cell = el("button", `bz-cell${spent ? " spent" : ""}`, money(g.values[row]));
      cell.disabled = spent || !!g.cell || g.turnUid !== B.you;
      cell.setAttribute("aria-label", `${g.cats[col].name}, ${money(g.values[row])}`);
      cell.onclick = () => send({ type: "BZ_PICK", col, row });
      host.append(cell);
    }
  }

  const c = g.cell;
  $("bz-clue-panel").hidden = !c;
  if (!c) { lastStage = null; return; }

  $("bz-clue-head").textContent = `${g.cats[c.col].name} · ${money(c.value)}`;
  $("bz-clue").textContent = c.q;

  const mine = c.holder === B.you;
  const out = c.wrongUids.includes(B.you);
  const open = c.stage === "OPEN" || c.stage === "WINDOW";

  // The state changes, not only the light — a buzzer that opens by animating
  // alone says nothing at all to somebody who cannot see it move.
  const bar = $("bz-buzzer");
  bar.hidden = c.stage === "REVEAL" || mine;
  bar.disabled = !open || out;
  bar.className = `btn bz-buzzer${open && !out ? " live" : ""}`;
  bar.textContent = out ? "You've had your go"
    : c.stage === "READING" ? "Wait…"
    : open ? "BUZZ"
    : c.holder ? `${nameOf(g, c.holder)} has it` : "…";

  if (c.stage !== lastStage) {
    if (c.stage === "OPEN" && lastStage === "READING") playCue("open");
    lastStage = c.stage;
  }
  if (c.answer) {
    $("bz-flash").textContent = c.answer;
    $("bz-flash").className = "bz-flash";
  }
  drawOptions();
}

function drawOptions() {
  const host = $("bz-options");
  host.textContent = "";
  host.hidden = !B.options;
  if (!B.options) return;
  B.options.forEach((o) => {
    const b = el("button", "bz-option", o);
    b.onclick = () => { B.options = null; drawOptions(); send({ type: "BZ_ANSWER", choice: o }); };
    host.append(b);
  });
}

/**
 * The clock, painted locally so it runs smoothly without the room having to
 * send a frame. Every deadline it reads came off the room's own clock, which
 * is the same clock a buzz is judged against.
 */
function paintClock() {
  const g = B.game;
  const fill = $("bz-bar-fill");
  const c = g?.cell;
  if (!c || !fill) { if (fill) fill.style.width = "0%"; return; }
  const now = serverNow();
  let from = c.shownAt || c.openAt, to = c.deadline;
  if (c.stage === "READING") { from = c.openAt - 4_000; to = c.openAt; }
  const span = Math.max(1, to - from);
  const left = Math.max(0, Math.min(1, (to - now) / span));
  fill.style.width = `${Math.round(left * 100)}%`;
  fill.className = c.stage === "ANSWERING" && left < 0.34 ? "low" : "";

  const secs = $("bz-secs");
  if (secs) {
    secs.textContent = c.stage === "ANSWERING" || c.stage === "OPEN"
      ? `${Math.max(0, (to - now) / 1000).toFixed(1)}s` : "";
  }
}

function nameOf(g, uid) {
  return g.players.find((p) => p.uid === uid)?.name || "Somebody";
}

function drawPodiums(g) {
  const host = $("bz-podiums");
  host.textContent = "";
  [...g.players].sort((a, b) => (b.money || 0) - (a.money || 0)).forEach((p) => {
    const row = el("div", `bz-podium${p.uid === B.you ? " me" : ""}${g.cell?.holder === p.uid ? " buzzed" : ""}`);
    row.append(el("span", "bz-who", p.name + (p.ai ? " \u{1F916}" : "")));
    row.append(el("span", `bz-cash${p.money < 0 ? " red" : ""}`, money(p.money)));
    if (p.bestReaction) row.append(el("span", "bz-rt", `${(p.bestReaction / 1000).toFixed(2)}s`));
    host.append(row);
  });
}

// ── the lobby ────────────────────────────────────────────────────────

function drawLobby(g) {
  $("btn-bz-solo").hidden = !B.isHost;
  $("btn-bz-solo").classList.toggle("on", !!g.solo);
  $("btn-bz-solo").setAttribute("aria-checked", String(!!g.solo));
  $("btn-bz-start").hidden = !B.isHost;
  $("bz-host-tag").hidden = !B.isHost;

  const tabs = $("bz-setup");
  tabs.textContent = "";
  const level = (B.aiLevels || []).find((l) => l.id === g.aiLevel);
  const rows = [
    { key: "cats", name: "Categories", now: g.cats.length ? `${g.cats.length} chosen` : "None yet" },
  ];
  if (g.solo) rows.push(
    { key: "count", name: "How many players", now: `${g.aiCount} computer${g.aiCount === 1 ? "" : "s"}` },
    { key: "level", name: "How quick they are", now: level?.name || g.aiLevel });

  for (const r of rows) {
    const b = el("button", "bz-tab");
    b.append(el("span", "bt-name", r.name));
    b.append(el("span", "bt-now", r.now));
    b.disabled = !B.isHost;
    b.onclick = () => openPick(r.key);
    tabs.append(b);
  }

  const chosen = $("bz-chosen");
  chosen.textContent = "";
  g.cats.forEach((c) => chosen.append(el("span", "bz-chip", c.name)));
  $("bz-note").textContent = g.cats.length === 6
    ? "Ready when you are."
    : `${6 - g.cats.length} more ${6 - g.cats.length === 1 ? "category" : "categories"} to choose.`;
}

function openPick(which) {
  const card = $("bz-pick-body");
  const g = B.game;
  card.textContent = "";
  $("bz-pick-title").textContent = which === "cats" ? "Choose six categories"
    : which === "count" ? "How many computer players" : "How quick they are";

  if (which === "count") {
    for (let n = 1; n <= (B.aiMax || 5); n++) {
      const b = el("button", `ai-level${g.aiCount === n ? " on" : ""}`);
      b.append(el("b", null, `${n} computer${n === 1 ? "" : "s"}`));
      b.append(el("i", null, n === 1 ? "One opponent, head to head." : `A table of ${n + 1}.`));
      b.onclick = () => { send({ type: "BZ_AI", count: n }); closePick(); };
      card.append(b);
    }
    return showPick();
  }

  if (which === "level") {
    const blurb = { rookie: "Knows about a third of the board and is slow to the buzzer.",
      club: "Knows over half of it and is quick enough to hurt.",
      pro: "Knows most of the board and gets there first. Beating five is a win." };
    for (const l of B.aiLevels) {
      const b = el("button", `ai-level${g.aiLevel === l.id ? " on" : ""}`);
      b.append(el("b", null, l.name));
      b.append(el("i", null, blurb[l.id] || ""));
      b.onclick = () => { send({ type: "BZ_AI", level: l.id }); closePick(); };
      card.append(b);
    }
    return showPick();
  }

  // Categories. A hundred and four is far too many for a dropdown, so they
  // come grouped under their sections with six ticks to spend.
  B.pick.chosen = g.cats.map((c) => c.id);
  const count = el("p", "bz-count");
  const surprise = el("button", "btn btn-primary btn-wide", "Surprise me");
  surprise.onclick = () => { send({ type: "BZ_RANDOM" }); closePick(); };
  card.append(surprise, count);

  const refresh = () => {
    count.textContent = `${B.pick.chosen.length} of 6 chosen`;
    card.querySelectorAll("[data-cat]").forEach((n) => {
      const on = B.pick.chosen.includes(n.dataset.cat);
      n.classList.toggle("on", on);
      n.disabled = !on && B.pick.chosen.length >= 6;
    });
    done.disabled = B.pick.chosen.length !== 6;
  };

  for (const s of B.sections) {
    const list = B.catalogue.filter((c) => c.section === s.id);
    if (!list.length) continue;
    card.append(el("h3", "bz-sec", s.name));
    const grid = el("div", "bz-cats");
    for (const c of list) {
      const b = el("button", "bz-catpick");
      b.dataset.cat = c.id;
      b.append(el("b", null, c.name));
      if (g.used?.includes(c.id)) b.append(el("i", null, "played here already"));
      b.onclick = () => {
        const at = B.pick.chosen.indexOf(c.id);
        if (at === -1) { if (B.pick.chosen.length < 6) B.pick.chosen.push(c.id); }
        else B.pick.chosen.splice(at, 1);
        refresh();
      };
      grid.append(b);
    }
    card.append(grid);
  }

  const done = el("button", "btn btn-primary btn-wide", "Use these six");
  done.onclick = () => { send({ type: "BZ_CATS", ids: B.pick.chosen }); closePick(); };
  card.append(done);
  refresh();
  showPick();
}

function showPick() { $("bz-pick").hidden = false; document.body.classList.add("panel-open"); }
function closePick() { $("bz-pick").hidden = true; document.body.classList.remove("panel-open"); }

// ── results ──────────────────────────────────────────────────────────

function drawResults({ results }) {
  const host = $("bz-results");
  host.hidden = false;
  host.textContent = "";
  host.append(el("h2", null, "The board is finished"));
  for (const r of results) {
    const row = el("div", `bz-result${r.uid === B.you ? " me" : ""}`);
    row.append(el("span", "bz-place", `${r.placement}`));
    row.append(el("span", "bz-who", r.name));
    row.append(el("span", "bz-cash", money(r.money)));
    row.append(el("span", "bz-sub", `${r.right} right · ${r.wrong} wrong`));
    row.append(el("span", "bz-sub", r.banked > 0 ? `banked ${money(r.banked)}` : "banked nothing"));
    if (typeof r.gain === "number") row.append(el("span", "bz-sub", `+${r.gain} MMR`));
    host.append(row);
  }
}

// ── feed and chat ────────────────────────────────────────────────────

function stamp(at) {
  return new Date(at || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function feedLine(text, at) {
  const p = el("p", "bz-feed-line");
  p.innerHTML = `<span class="bz-time">${stamp(at)}</span> ${esc(text)}`;
  const host = $("bz-feed");
  host.prepend(p);
  while (host.children.length > 60) host.lastChild.remove();
}

function chatLine(m) {
  const p = el("p", "bz-chat-line");
  p.innerHTML = `<b>${esc(m.name)}</b> <span class="bz-time">${stamp(m.at)}</span><br>${esc(m.text)}`;
  const host = $("bz-chat");
  host.prepend(p);
  while (host.children.length > 60) host.lastChild.remove();
}

const PANES = [["bz-t-podiums", "podiums"], ["bz-t-feed", "feed"], ["bz-t-chat", "chat"]];

function showDeck(which) {
  B.deck = which;
  for (const [tab, pane] of PANES) {
    const t = $(tab);
    if (t) { t.classList.toggle("on", pane === which); t.setAttribute("aria-selected", String(pane === which)); }
    const body = $(`bz-pane-${pane}`);
    if (body) body.hidden = pane !== which;
  }
}

// ── wiring ───────────────────────────────────────────────────────────

function wire() {
  $("btn-bz-leave").onclick = () => { closeBuzzer(); B.onLeave?.(); };
  $("btn-bz-solo").onclick = () => send({ type: "BZ_SOLO", on: !B.game?.solo });
  $("btn-bz-start").onclick = () => send({ type: "BZ_START" });
  $("btn-bz-mute").onclick = () => setMuted(!muted);

  // A buzz is stamped here, at the moment the button goes down, and converted
  // to the room's clock on the way out. What the room measures is the gap
  // between the buzzers opening and this instant — a reaction, not a distance
  // from Cloudflare.
  const hit = (e) => {
    e.preventDefault();
    send({ type: "BZ_BUZZ", at: serverNow() });
  };
  const bar = $("bz-buzzer");
  if (bar) bar.onpointerdown = hit;
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || $("screen-buzzer").hidden) return;
    if (document.activeElement?.tagName === "INPUT") return;
    e.preventDefault();
    hit(e);
  });

  for (const [tab, pane] of PANES) {
    const t = $(tab);
    if (t) t.onclick = () => showDeck(pane);
  }
  // .onkeydown rather than addEventListener: the battleship original binds
  // its chat inside a redraw, so the listeners pile up and one Enter fires as
  // many times as the room has pushed state.
  const input = $("bz-say");
  if (input) {
    input.onkeydown = (e) => {
      if (e.key !== "Enter" || !input.value.trim()) return;
      send({ type: "BZ_SAY", text: input.value });
      input.value = "";
    };
  }
  $("btn-bz-send").onclick = () => {
    const i = $("bz-say");
    if (!i.value.trim()) return;
    send({ type: "BZ_SAY", text: i.value });
    i.value = "";
  };
  $("bz-pick").querySelectorAll("[data-close]").forEach((n) => { n.onclick = closePick; });
}

wire();
