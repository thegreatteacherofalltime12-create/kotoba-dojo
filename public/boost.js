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

// The Battleship arsenal: bought in the shop, armed in the Apply Token tab
// of a battle (four per battle, two nukes at most), fired from the Arsenal
// strip on the battle screen. Only what is used is spent. Prices and rules
// mirror src/battleship.js.
export const ARSENAL_ITEMS = [
  { key: "bs_nuke", name: "Nuke Missile", icon: "\u2622\uFE0F", price: 500000, max: 2,
    blurb: "Takes your turn. Skirmish: a hit sinks the whole ship. Fleet Action: a 3\u00d73 blast. Open Ocean: 7\u00d77. Two a battle." },
  { key: "bs_shots", name: "Extra Shots", icon: "\u{1F3AF}", price: 25000,
    blurb: "+2 / +4 / +6 shots by chart for one turn, spread over captains as usual." },
  { key: "bs_ships", name: "Extra Ships", icon: "\u{1F6A2}", price: 5000,
    blurb: "Three more hulls of your choosing, on any chart. Arm before you place." },
  { key: "bs_strike", name: "Tactical Air Strike", icon: "\u2708\uFE0F", price: 35000,
    blurb: "Takes your turn. A 6\u00d76 blast anchored where you point, on any chart. Needs a carrier afloat." },
  { key: "bs_shield", name: "Air Strike Defence", icon: "\u{1F6E1}\uFE0F", price: 40000,
    blurb: "A hidden 6\u00d76 area of your water. Squares of an air strike inside it do nothing; it then shows, spent." },
  { key: "bs_reveal", name: "Air Strike Reveal", icon: "\u{1F52D}", price: 13000,
    blurb: "Shows you one captain's Air Strike Defence, if they have one, before you waste a strike on it." },
  { key: "bs_torpedo", name: "Submarine Torpedo", icon: "\u{1F41F}", price: 1437,
    blurb: "One extra single-square shot on your turn, on top of your volley, while your submarine is afloat." },
];
export const HULL_OPTIONS = [
  ["carrier", "Carrier (5)"], ["battleship", "Battleship (4)"], ["cruiser", "Cruiser (3)"],
  ["submarine", "Submarine (3)"], ["destroyer", "Destroyer (2)"],
];
export const arsenalItem = (key) => ARSENAL_ITEMS.find((t) => t.key === key);

// The Minesweeper arsenal. Mirrors src/arsenals.js.
export const MINE_ARSENAL_ITEMS = [
  { key: "ms_reveal", name: "Mine Reveal", icon: "\u{1F50E}", price: 20000, max: 2,
    blurb: "Shows two of the field's mines on your board. Any field. Two a round." },
  { key: "ms_buster", name: "Mine Buster", icon: "\u{1F9E8}", price: 5000, max: 5,
    blurb: "Pick a square: a mine there is destroyed and the ground opens; clean ground just opens. Intermediate and Expert only. Five a round." },
  { key: "ms_clear", name: "Clear Map", icon: "\u{1F9F9}", price: 200000, max: 1,
    blurb: "Before you have dug anything, opens a 5\u00d75 where you point \u2014 a mine inside it ends your sweep. One a round." },
  { key: "ms_shield", name: "Invincibility", icon: "\u{1F6E1}\uFE0F", price: 30550, max: 2,
    blurb: "Ten seconds in which a mine you dig is defused instead of ending you. Two a round." },
];
export const GAME_ARSENAL_ITEMS = { battleship: ARSENAL_ITEMS, minesweeper: MINE_ARSENAL_ITEMS };

/**
 * The shop, one arsenal per game: the game's 1.5\u00d7 boost first, then
 * whatever else that game sells. Other games' arsenals grow here too.
 */
export const GAME_ARSENALS = TOKEN_ITEMS.map((t) => ({
  game: t.game,
  name: `${t.name.replace(/ boost$/, "")} Arsenal`,
  icon: t.icon,
  items: [
    { key: t.game, name: t.name, icon: "\u26A1", price: TOKEN_PRICE, blurb: t.blurb },
    ...(GAME_ARSENAL_ITEMS[t.game] || []),
  ],
}));
export const shopItem = (key) => GAME_ARSENALS.flatMap((a) => a.items).find((t) => t.key === key);

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
.tok-live { animation: tokpulse 1.6s ease-in-out infinite; border-color: #F4CE5A !important; color: #F4CE5A !important; }
.tok-h { margin: .5rem 0 0; font-family: var(--display, inherit); font-size: .78rem; letter-spacing: .1em; text-transform: uppercase; opacity: .8; display: flex; justify-content: space-between; }
.tok-row.ars .tok-have { opacity: .9; }
.tok-blurb { font-size: .66rem; opacity: .7; margin-top: .1rem; }
.tok-acts { display: flex; gap: .3rem; align-items: center; }
.tok-btn.tok-minus { padding: .4rem .55rem; }
.tok-hulls { display: flex; gap: .3rem; flex-wrap: wrap; margin-top: .3rem; }
.tok-hulls select { font: inherit; font-size: .7rem; background: rgba(255,255,255,.08); color: inherit; border: 1px solid rgba(255,255,255,.18); border-radius: 6px; padding: .2rem .3rem; }
.tok-off { font-size: .74rem; opacity: .7; }`;
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
export function applyTokenTab({ game, send, button, host, label, arsenal = false }) {
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
    state = { loading: false, busy: false, tokens: msg.tokens || {}, applied: !!msg.applied, error: msg.error || null, day: !!msg.day, arsenal: msg.arsenal || state.arsenal || null };
    if (button) button.classList.toggle("tok-live", state.applied);
    if (el && !el.hidden) draw();
  }

  /** A fresh arsenal view from the room, without a full reply. */
  function arsenalState(view) {
    state = { ...state, arsenal: view };
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
    // This game's boost only; the arsenal follows for games that have one.
    const rows = TOKEN_ITEMS.filter((t) => t.game === game).map((t) => {
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
          ? `<p class="tok-empty">You hold none. Buy them with casino money in your profile under ⚡ Token shop.</p>`
          : "";
    h.innerHTML = `
      <div class="tok-modal">
        <div class="tok-back" data-close></div>
        <div class="tok-card" role="dialog" aria-modal="true" aria-label="Apply Token">
          <div class="tok-head"><h2>⚡ Apply Token</h2><button class="tok-x" data-close aria-label="Close">&times;</button></div>
          <div class="tok-body">
            <p class="tok-sub">Your ${here.where === "the Casino" ? "Casino" : here.where} arsenal. Apply the ${here.name} and this ${label || "match"} pays half again on the MMR${here.game === "casino" ? " — on every win for the rest of the day" : ""}.</p>
            ${rows}
            ${note}
            ${arsenal ? arsenalHtml() : ""}
          </div>
        </div>
      </div>`;
    h.querySelectorAll("[data-close]").forEach((n) => { n.onclick = close; });
    const b = h.querySelector("[data-apply]");
    if (b) b.onclick = apply;
    h.querySelectorAll("[data-arm]").forEach((n) => {
      n.onclick = () => {
        const key = n.dataset.arm;
        const hulls = key === "bs_ships" ? [...h.querySelectorAll("[data-hull]")].map((x) => x.value) : undefined;
        state = { ...state, busy: true, error: null };
        draw();
        send({ type: "ARM_TOKEN", key, hulls });
      };
    });
    h.querySelectorAll("[data-disarm]").forEach((n) => {
      n.onclick = () => { state = { ...state, busy: true, error: null }; draw(); send({ type: "DISARM_TOKEN", key: n.dataset.disarm }); };
    });
  }

  // The arsenal, under the boost: what is held, what is armed, and the
  // buttons to arm and put back. The room says what is allowed.
  function arsenalHtml() {
    const ars = state.arsenal;
    const tokens = state.tokens || {};
    if (state.loading && !ars) return "";
    if (!ars) return "";
    const armedTotal = Object.values(ars.armed || {}).reduce((n, v) => n + v, 0);
    const head = `<h3 class="tok-h"><span>${here.name.replace(/ boost$/, "")} arsenal</span><span>Armed ${armedTotal}${ars.cap != null ? ` / ${ars.cap}` : ""}</span></h3>`;
    if (!ars.on) return head + `<p class="tok-off">The host has the arsenal switched off for this battle.</p>`;
    const list = Array.isArray(arsenal) ? arsenal : ARSENAL_ITEMS;
    const rows = list.map((t) => {
      const held = tokens[t.key] || 0;
      const armed = ars.armed?.[t.key] || 0;
      const used = ars.used?.[t.key] || 0;
      const limit = ars.max?.[t.key] ?? t.max;
      const canArm = !state.busy && held > armed && (ars.cap == null || armedTotal < ars.cap) && !(limit && armed >= limit) && !(t.key === "bs_ships" && armed);
      const canDisarm = !state.busy && armed > used;
      const hulls = t.key === "bs_ships" && !armed
        ? `<div class="tok-hulls">${[0, 1, 2].map((i) => `<select data-hull aria-label="Extra hull ${i + 1}">${HULL_OPTIONS.map(([v, l], j) => `<option value="${v}" ${j === [2, 3, 4][i] ? "selected" : ""}>${l}</option>`).join("")}</select>`).join("")}</div>`
        : t.key === "bs_ships" && armed && ars.hulls?.length ? `<div class="tok-blurb">Bringing: ${ars.hulls.map((x) => HULL_OPTIONS.find(([v]) => v === x)?.[1].replace(/ \(\d\)/, "") || x).join(", ")}</div>` : "";
      return `<div class="tok-row ars">
        <span class="tok-ico">${t.icon}</span>
        <div>
          <div class="tok-name">${t.name}</div>
          <div class="tok-blurb">${t.blurb}</div>
          <div class="tok-have">${held ? `You hold <b>${held}</b>` : "None held"}${armed ? ` \u00b7 armed <b>${armed}</b>${used ? ` (${used} used)` : ""}` : ""}</div>
          ${hulls}
        </div>
        <div class="tok-acts">
          ${canDisarm ? `<button class="tok-btn tok-minus" data-disarm="${t.key}" title="Put one back">\u2212</button>` : ""}
          <button class="tok-btn" data-arm="${t.key}" ${canArm ? "" : "disabled"}>${armed ? "Arm another" : "Arm"}</button>
        </div>
      </div>`;
    }).join("");
    return head + rows + `<p class="tok-sub">Armed tokens are fired from the Arsenal strip on the game screen. Only what you use is spent; the rest stays armed.</p>`;
  }

  if (button) button.onclick = open;
  return { open, close, receive, reset, arsenalState };
}
