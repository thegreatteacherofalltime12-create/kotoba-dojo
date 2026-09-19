// Boost tokens on the client: the shop's list of them, and the Apply Token
// tab every game carries.
//
// A token is bought in the profile's Token shop and does nothing until the
// player opens Apply Token inside a game and applies it to the match they are
// in. The tab asks the room what the player holds (TOKENS), and applying
// sends APPLY_TOKEN; the room answers both with the same reply, which this
// draws. Nothing here decides anything — the room does, and the round's own
// record write spends the token.

export const TOKEN_PRICE = 2000;

export const TOKEN_ITEMS = [
  { game: "crossword", name: "Word-Cross boost", icon: "\u{1F520}", where: "Word-Cross", blurb: "1.5× MMR on one ranked Word-Cross round" },
  { game: "battleship", name: "Battleship boost", icon: "⚓", where: "Battleship Royale", blurb: "1.5× MMR on one Battleship Royale" },
  { game: "minesweeper", name: "Minesweeper boost", icon: "\u{1F4A3}", where: "Minesweeper", blurb: "1.5× MMR on one Minesweeper board" },
  { game: "links", name: "Golf boost", icon: "⛳", where: "Multiverse Golf", blurb: "1.5× MMR on one round of Multiverse Golf" },
  { game: "casino", name: "Casino boost", icon: "\u{1F3B0}", where: "the Casino", blurb: "1.5× on every casino win for a day" },
];

export const tokenItem = (game) => TOKEN_ITEMS.find((t) => t.game === game) || TOKEN_ITEMS[0];

// The tab's own styles, carried with it so the golf page (which has none of
// the arena's stylesheet) draws the same window.
let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const css = document.createElement("style");
  css.textContent = `
.tok-modal { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 1rem; font-family: var(--body, inherit); }
.tok-back { position: absolute; inset: 0; background: rgba(2, 6, 23, .68); backdrop-filter: blur(4px); }
.tok-card { position: relative; width: min(30rem, 100%); max-height: 84vh; overflow-y: auto; background: rgba(15, 23, 42, .96); border: 1px solid rgba(255,255,255,.14); border-radius: 16px; box-shadow: 0 30px 80px rgba(2, 6, 23, .7); color: #eef2f7; }
.tok-head { display: flex; align-items: center; gap: .8rem; padding: .7rem .9rem; border-bottom: 1px solid rgba(255,255,255,.12); }
.tok-head h2 { flex: 1; margin: 0; font-family: var(--display, inherit); font-size: 1rem; letter-spacing: .08em; }
.tok-x { font: inherit; font-size: 1.1rem; line-height: 1; background: transparent; border: 1px solid rgba(255,255,255,.14); color: inherit; cursor: pointer; padding: .2rem .55rem; border-radius: 6px; }
.tok-body { padding: .9rem; display: grid; gap: .55rem; }
.tok-sub { margin: 0; font-size: .8rem; opacity: .75; }
.tok-row { display: grid; grid-template-columns: auto 1fr auto; gap: .7rem; align-items: center; padding: .5rem .65rem; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; background: rgba(255,255,255,.04); }
.tok-row.is-here { border-color: #F4CE5A; background: rgba(244, 206, 90, .08); }
.tok-ico { font-size: 1.45rem; line-height: 1; }
.tok-name { font-family: var(--display, inherit); font-weight: 800; font-size: .84rem; }
.tok-have { font-size: .68rem; opacity: .8; margin-top: .1rem; }
.tok-have b { color: #F4CE5A; }
.tok-else { font-size: .64rem; opacity: .6; text-align: right; max-width: 7rem; }
.tok-btn { font: inherit; font-weight: 700; font-size: .74rem; cursor: pointer; padding: .4rem .7rem; border-radius: 8px; border: 1px solid #F4CE5A; background: rgba(244, 206, 90, .16); color: #F4CE5A; white-space: nowrap; }
.tok-btn:disabled { opacity: .55; cursor: default; }
.tok-btn.is-on { background: #F4CE5A; color: #1a1400; }
.tok-note { margin: 0; font-size: .8rem; border-left: 2px solid rgba(255,255,255,.2); padding-left: .7rem; }
.tok-note.good { color: #F4CE5A; border-left-color: #F4CE5A; }
.tok-note.bad { color: #ff8a8a; border-left-color: #ff5c5c; }
.tok-empty { margin: 0; font-size: .8rem; opacity: .8; }
@keyframes tokpulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(244, 206, 90, 0); } 50% { box-shadow: 0 0 0 4px rgba(244, 206, 90, .35); } }
.tok-live { animation: tokpulse 1.6s ease-in-out infinite; border-color: #F4CE5A !important; color: #F4CE5A !important; }`;
  document.head.appendChild(css);
}

/**
 * The Apply Token tab of one game.
 *
 *   const tab = applyTokenTab({ game: "battleship", send, button: $("btn-battle-boost") });
 *   ... case "TOKENS": tab.receive(msg);
 *
 * `send` posts to the room's socket. `button` (optional) opens the tab and
 * lights up once a token is applied. `host` is where the window is drawn;
 * one is made at the end of <body> when none is given.
 */
export function applyTokenTab({ game, send, button, host, label }) {
  ensureStyles();
  const here = tokenItem(game);
  let el = host || null;
  let state = { loading: true };

  const mount = () => {
    if (!el) { el = document.createElement("div"); el.hidden = true; document.body.appendChild(el); }
    return el;
  };

  function close() { if (el) { el.hidden = true; el.textContent = ""; } }

  function open() {
    const h = mount();
    h.hidden = false;
    state = { loading: true, applied: state.applied, tokens: state.tokens };
    draw();
    send({ type: "TOKENS" });
  }

  function apply() {
    state = { ...state, busy: true, error: null };
    draw();
    send({ type: "APPLY_TOKEN" });
  }

  function receive(msg) {
    state = { loading: false, busy: false, tokens: msg.tokens || {}, applied: !!msg.applied, error: msg.error || null, day: !!msg.day };
    if (button) button.classList.toggle("tok-live", state.applied);
    if (el && !el.hidden) draw();
  }

  /** Forget the applied light — for a room that scored and moved on. */
  function reset() {
    state = { ...state, applied: false };
    if (button) button.classList.remove("tok-live");
  }

  function draw() {
    const h = mount();
    const tokens = state.tokens || {};
    const total = Object.values(tokens).reduce((a, n) => a + (n || 0), 0);
    const rows = TOKEN_ITEMS.map((t) => {
      const n = tokens[t.game] || 0;
      const isHere = t.game === game;
      const right = isHere
        ? `<button class="tok-btn ${state.applied ? "is-on" : ""}" data-apply ${state.applied || state.busy || state.loading || n < 1 ? "disabled" : ""}>${
          state.applied ? "Applied ⚡" : state.busy ? "Applying…" : `Apply to this ${label || "match"}`}</button>`
        : `<span class="tok-else">Use in ${t.where}</span>`;
      return `<div class="tok-row ${isHere ? "is-here" : ""}">
        <span class="tok-ico">${t.icon}</span>
        <div><div class="tok-name">${t.name}</div><div class="tok-have">${state.loading ? "…" : n ? `You hold <b>${n}</b>` : "None held"}</div></div>
        ${right}
      </div>`;
    }).join("");
    const note = state.error
      ? `<p class="tok-note bad">${state.error}</p>`
      : state.applied
        ? `<p class="tok-note good">⚡ Applied. ${state.day
          ? "Every casino win for the rest of today (UTC) pays half again."
          : `This ${label || "match"} pays 1.5× MMR when it is scored.`}</p>`
        : !state.loading && total === 0
          ? `<p class="tok-empty">You hold no tokens. Buy them with casino money in your profile under ⚡ Token shop.</p>`
          : "";
    h.innerHTML = `
      <div class="tok-modal">
        <div class="tok-back" data-close></div>
        <div class="tok-card" role="dialog" aria-modal="true" aria-label="Apply Token">
          <div class="tok-head"><h2>⚡ Apply Token</h2><button class="tok-x" data-close aria-label="Close">&times;</button></div>
          <div class="tok-body">
            <p class="tok-sub">Tokens you've bought. Apply the ${here.name} here and this ${label || "match"} pays half again on the MMR${here.game === "casino" ? " — on every win for the rest of the day" : ""}.</p>
            ${rows}
            ${note}
          </div>
        </div>
      </div>`;
    h.querySelectorAll("[data-close]").forEach((n) => { n.onclick = close; });
    const b = h.querySelector("[data-apply]");
    if (b) b.onclick = apply;
  }

  if (button) button.onclick = open;
  return { open, close, receive, reset };
}
