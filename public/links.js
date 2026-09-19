import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { attachHole, setHole, strike } from "./hole.js";

/**
 * Multiverse Golf, wired to the arena.
 *
 * This file draws and types. It holds no words, marks no guesses and keeps no
 * score — all of that is decided in the Worker, which is the point: a
 * dictionary in the page is a dictionary the player can read, and points kept
 * in the page are points the player can edit.
 */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const S = { user: null, sock: null, state: null, code: null, courses: [], tees: [], drawnHole: 0, ballAt: 0, hold: false };

function say(text, kind = "") {
  const m = $("msg");
  m.textContent = text || "";
  m.className = `msg ${kind}`;
}

/* ── the lobby ─────────────────────────────────────────────────────── */

async function loadCourses() {
  try {
    const res = await fetch("/api/links/courses");
    const body = await res.json();
    S.courses = body.courses || [];
    S.tees = body.tees || [];
  } catch {
    $("lobby-note").textContent = "The course list didn't load. Reload the page.";
    return;
  }

  const c = $("sel-course");
  // Nothing is chosen until the player chooses it. The first entry is a
  // prompt, not a course, and the tee stays closed while it is the one showing.
  const ask = el("option", "", "Choose a course\u2026");
  ask.value = "";
  ask.disabled = true;
  ask.selected = true;
  c.append(ask);
  // Resolved on the server, not here: the room has to agree on the course, and
  // a random pick made in one browser is not a pick the room has made.
  const anyOne = el("option", "", "🎲 Random course");
  anyOne.value = "random";
  c.append(anyOne);
  for (const course of S.courses) {
    const o = el("option", "", `${course.ico} ${course.name} — par ${course.par}`);
    o.value = course.id;
    c.append(o);
  }
  const t = $("sel-tee");
  for (const tee of S.tees) {
    const o = el("option", "", tee.words > 1
      ? `${tee.label} — ${tee.words} words a hole`
      : `${tee.label} — one word a hole`);
    o.value = tee.id;
    t.append(o);
  }
  t.value = "easy";
  c.onchange = syncPlayMode;
  syncPlayMode();
}

/** Solo hides the room code: there is nobody to share it with. */
function syncPlayMode() {
  const solo = $("sel-play").value === "solo";
  $("wrap-code").hidden = solo;
  // No course, no tee. The button says why rather than doing nothing.
  const chosen = !!$("sel-course").value;
  $("btn-start").disabled = !chosen;
  $("btn-start").textContent = chosen ? "Go to the tee" : "Choose a course first";
  $("lobby-note").textContent = solo
    ? "A private round, just you. Nobody else can find it, and it still banks MMR when you finish."
    : "Anyone joining the same room code plays the same eighteen holes with the same words. "
      + "You decide when to tee off, so give them time to arrive.";
}

const randomCode = () =>
  Array.from({ length: 4 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");

/* ── the round ─────────────────────────────────────────────────────── */

async function connect({ joining = false } = {}) {
  // A joiner takes the course the room already has; only a room being opened
  // has to have chosen one.
  if (!joining && !$("sel-course").value) return say("Choose a course \u2014 or Random \u2014 before you tee off.", "bad");
  const solo = $("sel-play").value === "solo";
  // Solo always gets a fresh code of its own. Reusing one you had typed would
  // drop you into a room somebody else may already be standing in.
  const code = (solo ? randomCode() : ($("in-code").value || randomCode()))
    .toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 3) return say("A room code needs at least three characters.", "bad");
  $("in-code").value = code;
  S.code = code;

  const token = await S.user.getIdToken();
  const q = new URLSearchParams({
    token,
    course: $("sel-course").value,
    diff: $("sel-tee").value,
    dict: $("sel-dict").value,
    solo: solo ? "1" : "0",
  });
  const url = `${location.origin.replace(/^http/, "ws")}/api/links/${code}/ws?${q}`;

  const sock = new WebSocket(url);
  S.sock = sock;

  sock.onopen = () => {
    $("lobby").hidden = true;
    attachHole($("hole"));
    // Nothing starts on its own. The room reports its phase and the waiting
    // card decides what to show: a round already running is joined, one that
    // has not begun waits for whoever opened the room to call it.
    say("");
  };
  sock.onclose = () => { say("Disconnected. Reload to rejoin.", "bad"); $("btn-guess").disabled = true; };
  sock.onerror = () => say("The connection failed.", "bad");
  sock.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "LINKS_STATE") return draw(msg.state);
    if (msg.type === "LINKS_MARK") return marked(msg);
    if (msg.type === "LINKS_REJECT") return say(msg.why, "bad");
    if (msg.type === "LINKS_OVER") return over(msg);
  };
}

const send = (o) => { try { S.sock?.send(JSON.stringify(o)); } catch { /* closed */ } };

/**
 * The room before anyone has swung.
 *
 * A round never begins on its own. Whoever opened the room decides when, which
 * is what gives everyone else time to arrive and the host time to settle on a
 * course — including leaving it to the dice.
 */
function drawWaiting(state) {
  const waiting = state.phase === "LOBBY";
  $("waiting").hidden = !waiting;
  $("play").hidden = waiting;
  $("btn-end").hidden = waiting;
  if (!waiting) return;

  const here = (state.field || []).map((p) => p.name);
  $("wait-title").textContent = state.solo ? "On the tee — solo" : "On the tee";
  $("wait-course").textContent = state.randomCourse
    ? `\u{1F3B2} Random \u2014 ${state.course.name} is up, and it is redrawn when you tee off.`
    : `${state.course.name} \u00b7 ${state.course.loc} \u00b7 ${state.diff} tees`;
  $("wait-who").textContent = state.solo
    ? `A private round. Nobody else can join it.`
    : here.length === 1
      ? `${here[0]} is on the tee. Room ${state.code}.`
      : `${here.join(", ")} \u2014 ${here.length} in the room ${state.code}.`;

  $("btn-teeoff").hidden = !state.isHost;
  $("wait-note").textContent = state.solo
    ? "Take as long as you like over the course. It still banks MMR when you finish."
    : state.isHost
      ? "Take as long as you like. Anyone joining this code before you tee off plays the same holes."
      : "Waiting for the player who opened the room to tee off.";
}

function draw(state) {
  S.state = state;
  if (!state) return;
  // The photo behind the page is the course being played.
  document.body.dataset.course = state.phase === "LOBBY" && state.randomCourse ? "" : (state.course?.id || "");
  drawWaiting(state);
  if (state.phase === "LOBBY") return;

  // Holed out: the ball is going in and the next hole waits behind the
  // button. The card table below still updates, so the field is live.
  const h = S.hold ? null : state.hole;
  $("in-guess").disabled = S.hold;
  $("btn-guess").disabled = S.hold;
  if (h) {
    $("h-no").textContent = h.no;
    $("h-name").textContent = h.name || "";
    $("h-par").textContent = h.wordsTotal > 1
      ? `par ${h.par} · ${h.wordsTotal} words`
      : `par ${h.par}`;
    $("h-yards").textContent = `${h.yards} yds`;
    const haz = $("h-haz");
    haz.hidden = !h.hazard;
    if (h.hazard) { haz.textContent = h.hazard; haz.className = `pill ${h.hazard}`; }
    $("h-strokes").textContent = h.wordsTotal > 1
      ? `${h.strokes} shots · word ${h.wordIndex + 1} of ${h.wordsTotal}`
      : `${h.strokes} strokes`;

    $("h-clue").innerHTML = h.clue
      ? `<em>Clue —</em> ${escapeHtml(h.clue)}`
      : `<em>No clue from these tees until you've played two words. The letters are all you get.</em>`;

    // The letters dealt. Redrawn whenever the word changes, which on the
    // multi-word tees is several times a hole.
    const dealt = $("h-dealt");
    const key = `${h.no}:${h.wordIndex}:${h.scrambled || ""}`;
    if (dealt.dataset.key !== key) {
      dealt.dataset.key = key;
      dealt.textContent = "";
      for (const ch of (h.scrambled || "")) dealt.append(el("div", "gtile", ch));
    }

    $("in-guess").maxLength = h.len;
    $("in-guess").placeholder = "•".repeat(h.len);

    // A new hole means a new drawing. The ball is only sent flying when the
    // server reports it somewhere it wasn't, so redraws don't re-animate.
    if (S.drawnHole !== h.no) {
      S.drawnHole = h.no;
      S.ballAt = 0;
      setHole({ courseId: state.course.id, hole: h.no - 1, hazard: h.hazard, par: h.cardPar, yards: h.yards });
    }
    if ((h.ball || 0) !== S.ballAt) {
      S.ballAt = h.ball || 0;
      strike(S.ballAt, h.hazard);
    }

    const pct = Math.round((h.ball || 0) * 100);
    $("fair-fill").style.width = `${pct}%`;
    $("fair-ball").style.left = `${pct}%`;

    drawGuesses(h.guesses, h.len);
  }

  const body = $("field");
  body.textContent = "";
  for (const p of state.field || []) {
    const tr = el("tr", p.uid === state.you ? "you" : "");
    tr.append(el("td", "", p.name));
    tr.append(el("td", "n", p.done ? "in" : String(p.hole + 1)));
    const par = el("td", `n ${p.toPar < 0 ? "under" : p.toPar > 0 ? "over" : ""}`);
    par.textContent = p.toPar === 0 ? "E" : p.toPar > 0 ? `+${p.toPar}` : String(p.toPar);
    tr.append(par);
    tr.append(el("td", "n", String(p.points)));
    body.append(tr);
  }

  $("sub").textContent = `${state.course.name} · ${state.course.loc} · ${state.diff} tees`;
}

function drawGuesses(guesses, len) {
  const host = $("guesses");
  host.textContent = "";
  for (const g of guesses || []) {
    const row = el("div", "grow");
    for (let i = 0; i < len; i++) {
      row.append(el("div", `gtile ${g.marks[i]}`, g.word[i]));
    }
    host.append(row);
  }
}

function marked(msg) {
  if (msg.holed) {
    const { name, strokes, points } = msg.holed;
    say(`${name} — ${strokes} shots, ${points} points.`, "good");
    // The ball rolls to the cup. Unless that was the last hole, the next
    // one waits until the player says they are ready — on their own clock,
    // not the table's.
    strike(1, "hole");
    if (!msg.roundOver) {
      S.hold = true;
      $("btn-next").hidden = false;
      $("h-strokes").textContent = `${strokes} strokes · ${name}`;
    }
  } else if (msg.conceded) {
    say(`Picked up. The word was ${msg.conceded}.`, "bad");
  } else if (msg.nextWord) {
    say("Solved. Next word.", "good");
  } else if (msg.solved) {
    say("In the cup.", "good");
  } else {
    say("");
  }
  $("in-guess").value = "";
  $("in-guess").focus();
}

function over(msg) {
  S.hold = false;
  $("play").hidden = true;
  $("btn-end").hidden = true;
  $("btn-next").hidden = true;
  // The server ranks the field and sends it in order; re-sorting here on the
  // ladder score would tangle two players who shot different cards to the
  // same rating.
  const winner = msg.results[0];
  say("");
  const card = el("div", "card");
  card.append(el("h2", "", msg.status === "ended" ? "Round ended" : "Round complete"));
  for (const r of msg.results) {
    const line = el("p", "sub");
    const toPar = r.toPar === 0 ? "E" : r.toPar > 0 ? `+${r.toPar}` : String(r.toPar);
    const mmr = r.gain == null ? "" : ` · +${r.gain} MMR`;
    line.textContent = `${r.name} — ${toPar} through ${r.holes}, ${r.points} points${mmr}`;
    card.append(line);
  }
  card.append(el("p", "", winner ? `${winner.name} takes it.` : ""));
  // The same red button as the one at the top: the round is over, and this
  // is how you leave it.
  const again = el("button", "btn end", "Officially end round");
  again.onclick = () => { location.href = "/"; };
  card.append(again);
  $("play").after(card);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ── wiring ────────────────────────────────────────────────────────── */

$("sel-play").onchange = syncPlayMode;
$("btn-start").onclick = connect;
$("btn-home").onclick = () => { location.href = "/"; };
$("btn-next").onclick = () => {
  S.hold = false;
  $("btn-next").hidden = true;
  say("");
  if (S.state) draw(S.state);
  $("in-guess").focus();
};
$("btn-end").onclick = () => {
  if (window.confirm("End the round here? Your card is scored as it stands.")) send({ type: "LINKS_END" });
};
$("btn-teeoff").onclick = () => {
  $("btn-teeoff").disabled = true;
  send({ type: "LINKS_START" });
  // Re-enabled if the round does not begin, so a refusal is not a dead button.
  setTimeout(() => { $("btn-teeoff").disabled = false; }, 1500);
};
$("btn-leave").onclick = () => { location.href = "/"; };
$("btn-guess").onclick = swing;
$("in-guess").addEventListener("keydown", (e) => { if (e.key === "Enter") swing(); });

function swing() {
  const word = ($("in-guess").value || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!word) return;
  send({ type: "LINKS_GUESS", word });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "/"; return; }
  S.user = user;
  await loadCourses();

  // Arrived from Open Rooms with a code attached: join straight into it
  // rather than making them type the code they just clicked.
  const arrived = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  const creating = arrived.startsWith("NEW:");
  const invited = creating ? "" : arrived;
  if (creating) {
    // Create Match reserved a code from the shared pool. Hold it, open the
    // room mode, and leave the course to the player: nothing is dealt and
    // nothing is chosen until they have chosen it and gone to the tee.
    $("sel-play").value = "room";
    $("in-code").value = arrived.slice(4);
    syncPlayMode();
    $("lobby-note").textContent = `Your room is ${arrived.slice(4)}. Pick a course and tees, then go to the tee.`;
  }
  if (invited) {
    // An invitation is by definition not a solo round. Set the mode before
    // connecting: solo draws itself a fresh code, which would land them in an
    // empty room of their own rather than the one they just clicked.
    $("sel-play").value = "room";
    syncPlayMode();
    $("in-code").value = invited;
    $("lobby-note").textContent = `Joining ${invited}. If a round is already under way you walk straight into it; if not, you wait on the tee with everyone else.`;
    connect({ joining: true });
  }
});
