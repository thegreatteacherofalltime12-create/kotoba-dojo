# The Buzzer — build handoff

A seventh game for the arena: a Jeopardy-style quiz board with a real-time
buzzer. This document is everything decided and everything built so far, so
another engineer can carry on without re-reading the codebase.

Design doc (settled, all decisions closed):
https://claude.ai/code/artifact/4386fefc-8793-4a3e-8353-372633c82297

---

## 1. Status

| Piece | State |
|---|---|
| `src/buzzer.js` — pure logic | **WRITTEN AND EXERCISED.** Board values, reading time, the buzzer clamps, options, score, banking, AI dials. |
| `src/buzzer-bank.js` — the clue bank | **NOT WRITTEN.** Format in §9. 50 draft clues ready to drop in (`buzzer-clues-arena.json`), unverified. |
| `src/buzzer-room.js` — the Durable Object | **NOT WRITTEN.** Full design in §5–6. |
| `public/buzzer.js` — the client | **NOT WRITTEN.** |
| Markup, styles, wiring | **NOT WRITTEN.** Exact insertion points in §7. |
| `scripts/buzzer-test.mjs` | **NOT WRITTEN.** Harness shape in §10. |

Nothing has been deployed. Nothing has been committed. The working tree has
one new untracked source file, `src/buzzer.js`, plus this handoff and its two
JSON files.

---

## 2. Names and ids — already chosen, change them here if you disagree

| Thing | Value | Why |
|---|---|---|
| Display name | **The Buzzer** | "Jeopardy!" is a trademark and this arena is sold on Etsy, so the format is copied and the name is not. Lives in one constant, `GAME_NAME` in `src/buzzer.js`. |
| Game id | `buzzer` | **Must be lowercase letters only.** `scripts/registry-test.mjs` parses `arena.js` with `/game:\s*"([a-z]+)"/` — digits or hyphens fail the test. |
| DO class | `BuzzerRoom` | |
| DO binding | `BUZZER` | |
| Route | `/api/buzzer/<CODE>/ws` | |
| Screen | `#screen-buzzer` | |
| CSS prefix | `bz-` | Avoid `bt-` / `.bt` — already used by Battleship's tabs and by `.belt-row .bt`. |
| Token key prefix | `bz_` | Must be globally unique across `ALL_TOKENS`. Existing: `cs_ wc_ bs_ gf_ gp_ ms_`. |
| Subtitle | "Six categories. Five rows. One buzzer." | |

---

## 3. The rules, as settled

**The board.** Six categories across, five rows down. Round 1 is
$200/$400/$600/$800/$1,000; round 2 doubles every value. Twelve categories
make a game — six a round — drawn from a bank of 104, so no two games look
alike. Whoever answered last picks the next clue.

**Choosing categories.** A Categories tab that opens an overlay window over
the lobby — the same pattern as the race lobby's `.prix-setup` / `.prix-tab` /
`#prix-pick`, which is what you asked for — with the 104 grouped under their
section headings. Three ways out: *Surprise me* (twelve at random), *Surprise
me from these* (tick whole sections and let it draw inside them), *Pick all
twelve*. Host chooses in a hosted game, the player in a solo one. Categories
already used in the room are marked.

**Answering, without typing.** Options stay hidden until you commit:

1. The clue appears to everybody at once. No options.
2. Reading time — the buzzers are shut, for about as long as it takes to read
   the clue aloud, scaled to its length.
3. The buzzers open, visibly and audibly. Anyone may buzz.
4. The first buzz takes the clue. That player, and only that player, is sent
   four options, for ten seconds. Choosing one stops the clock there and then.
5. Right: the value is added. Wrong: the value is taken off and the clue
   reopens for the others to buzz.
6. Nobody buzzes: the answer is shown and nobody scores.

The arithmetic is what makes this work. A blind buzz is one chance in four,
and a wrong answer costs what a right one pays — so guessing is worth minus
half the value, and no special rule is needed to punish it.

The three wrong options **must come from the same family as the answer** — the
other ships, the other tables, the other courses. A column whose decoys come
from nowhere in particular is a column where the right answer is obvious on
sight. This is the most important rule in the clue bank, and it is what killed
the THE COMMONS category during drafting.

**The buzzer.** Clock-stamped, not arrival-ordered. The browser reports when
the button went down, converted to the room's clock by a measured skew; the
room judges reaction time, not distance from the server. Guards, all already
implemented in `judgeBuzz` (§4):

- A stamp later than the moment the message arrived is impossible — clamped to
  arrival.
- A stamp older than `MAX_DRIFT_MS` (4s) is a drifted clock or a liar —
  clamped to arrival. **The worst a liar can do is be judged the way arrival
  order would have judged them anyway.**
- No reaction is ever recorded below `MIN_REACTION_MS` (150ms), the human
  floor. This does not stop a scripted auto-buzzer — nothing in a browser can —
  but it puts one level with the best human in the room rather than ahead of
  every human ever born. Ties at the floor fall back to arrival order.
- **Buzz before the buzzers open and you are locked out for 250ms.** This is
  the real rule and it is worth having: it punishes mashing and it makes
  watching the end of the reading worth doing.

**`BUZZ_WINDOW_MS = 350` is load-bearing.** A clock-stamped buzz is useless if
the room hands the clue to the first packet through the door. The first buzz
opens a 350ms window, everything inside it is collected, and the *lowest
reaction* wins. Without this the whole clock-stamp design does nothing.

**The money.** Everyone starts on $2,000. The $2,000 **floats** — it is a
stake, not a gift. You bank what you finish with *above* it, so a flat game
banks nothing and a bad one banks nothing rather than costing you. Banking is
one-way, via `bankWallet`, exactly like the casino.

**Below zero.** You keep playing. At or below zero you can still buzz, still
answer, still win it all back, and a Daily Double is still yours. The only
door that shuts is Final Jeopardy, and only if you are still at or below zero
when the second round ends. It never touches money already banked.

**Set pieces.** The round opening reveals the six categories one at a time.
One Daily Double in round 1, two in round 2 — a full-board splash, then the
wager, then the clue, no buzzing. Round 2 gets its own splash. Final: category
shown, secret wagers, one clue, everyone picks from the same four options, all
revealed together, **lowest score first** — which is what puts the person who
can still win last.

**Motion and sound.** Nothing may be motion-only or sound-only; every cue has
a visual twin that carries the whole meaning. `prefers-reduced-motion` is
respected. Three synthesised Web Audio cues and nothing else: buzzers opening,
a wrong answer, the Final Jeopardy tick. On by default, muted from the top
bar, setting remembered. **The arena has never made a sound before — this is
the first, so the off switch belongs somewhere obvious.**

**Solo.** A toggle like the race's, up to five computer players at a
difficulty you choose. Solo scores and pays like a hosted game; beating five
Pros is a win.

**Chat.** Open the whole way through, unlike the race — there are natural gaps
between clues and people should talk in them. Chat and feed laid out the way
Battleship lays them out (§6).

**Avatars.** Ten free, picked before the lights go up, in hosted and solo
alike. Drawn beside each player's money. Computers take the ones nobody picked.

**Arsenal.** Twelve tokens, the Grand Prix grid plus ten dollars. Nothing
bought may ever be aimed at another player.

| Token | Price | Limit | What it does |
|---|---|---|---|
| Second Look | $510 | 5 | Your first wrong answer of each round costs nothing |
| Category Card | $610 | 3 | See one category's name before the board turns |
| Long Look | $710 | 2 | Fifteen seconds to answer instead of ten |
| House Money | $810 | 1 | Start on $2,500 instead of $2,000 |
| Two Fewer | $910 | 3 | On one clue, two wrong options are taken away |
| Deep Pockets | $1,010 | 2 | Wager beyond your money on a Daily Double |
| The Nudge | $1,110 | 2 | Which row hides a Daily Double, in one category |
| Fast Finger | $1,210 | 3 | Your next three buzzes land a fraction earlier |
| Insurance | $1,310 | 2 | A Daily Double that goes wrong costs half |
| Open Book | $1,510 | 2 | One clue's options are shown before you buzz |
| Podium Polish | $2,510 | 2 | Eight points on the match score |
| Points Finish | $3,010 | 1 | A game you leave early is scored as though you stayed |

---

## 4. What is already written: `src/buzzer.js`

Pure functions only, so it is testable without standing a Durable Object up.
Exports:

```
GAME_NAME, COLS=6, ROWS=5, BASE_VALUE=200, ROUNDS, START_MONEY=2000
valueAt(row, round)            topValue(round)
READ_PER_CHAR_MS=62, READ_MIN_MS=2200, READ_MAX_MS=9000, readingMs(text)
ANSWER_MS=10000, NOBODY_MS=12000, REVEAL_MS=2600
BUZZ_WINDOW_MS=350, EARLY_LOCKOUT_MS=250, MIN_REACTION_MS=150, MAX_DRIFT_MS=4000
judgeBuzz({stamp, arrivedAt, openAt}) -> {ok, early, reaction, lockedUntil, why}
winningBuzz(buzzes) -> the buzz with the lowest reaction, ties by arrival
shuffle(list, rnd)   rngFrom(seed)   optionsFor(clue, pool, rnd) -> 4 strings
boardScore({placement, field, right, wrong, finished}) -> 0..100
standings(players)   bankable(money) -> money - 2000, floored at 0
AI_LEVELS, AI_MAX=5, AI_NAMES, aiLevelById(id)
aiIntent(level, rnd) -> {buzz, knows, reaction, thinkMs}
```

Verified at the command line:

```
values row0..4 [200,400,600,800,1000]  double [400, 2000]
early buzz   -> {ok:false, early:true, lockedUntil: openAt+250}
honest       -> reaction 300
liar (0)     -> reaction 380   (clamped to arrival — no better than arrival order)
future stamp -> reaction 380   (same clamp)
score        -> 96 for a clean win of four; 33 for last with 1 right and 6 wrong
bank         -> 3400 banks 1400; 1200 banks 0
```

**Computer players** are described by two dials and nothing else: `knows` (the
chance it has the answer) and `buzz` (a reaction-time range in ms, measured
from the moment the buzzers open — the same number a thumb produces). So a
computer and a person are judged by the same rule, with no special case
anywhere in the room. A player that does not know still buzzes sometimes
(`gamble`), slower, and then takes its one-in-four like anybody else.

```
rookie  knows .32  gamble .10  buzz [900,2600]  think [1200,3000]
club    knows .58  gamble .16  buzz [520,1500]  think [900,2400]
pro     knows .80  gamble .22  buzz [320,950]   think [600,1800]
```

---

## 5. The room to build: `src/buzzer-room.js`

Clone the shape of `src/grand-prix.js`. It is the closest existing room and
every convention below is lifted from it.

### 5.1 Skeleton (verbatim from `src/grand-prix.js`)

```js
export class BuzzerRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.buckets = new Map();
    state.blockConcurrencyWhile(async () => {
      this.g = (await state.storage.get("game")) || null;
    });
  }
  persist() { return this.state.storage.put({ game: this.g }); }
  sockets() { return this.state.getWebSockets(); }
  send(ws, type, payload = {}) {
    try { ws.send(JSON.stringify({ type, ...payload })); } catch { /* gone */ }
  }
  broadcast(type, payload = {}) {
    const msg = JSON.stringify({ type, ...payload });
    for (const ws of this.sockets()) { try { ws.send(msg); } catch { /* gone */ } }
  }
  connected() {
    const out = new Set();
    for (const ws of this.sockets()) {
      try { const a = ws.deserializeAttachment(); if (a?.uid) out.add(a.uid); } catch { /* gone */ }
    }
    return out;
  }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("This endpoint speaks WebSocket only.", { status: 426 });
    const uid = request.headers.get("X-Dojo-Uid");
    const name = request.headers.get("X-Dojo-Name") || "Player";
    const code = request.headers.get("X-Dojo-Code") || "buzzer";
    if (!uid) return new Response("Unauthenticated.", { status: 401 });
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ uid, name });
    await this.onJoin(uid, name, code, pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketClose(ws) { await this.onGone(ws); }
  async webSocketError(ws) { await this.onGone(ws); }
}
```

`webSocketMessage` is one `JSON.parse` in a try/catch, `const who =
ws.deserializeAttachment()`, one switch, and one outer try/catch replying
`BZ_ERROR { message: String(err?.message || err) }`. Unknown types fall through
to `"Unrecognised message."`

### 5.2 Per-socket redaction — the pattern that matters most here

The four options must reach exactly one player. Copy `publicState(open)` /
`handOf(p)` / `pushState()` from `src/grand-prix.js:188-275`. Verbatim:

```js
  pushState() {
    const shut = this.publicState(false);
    let gallery = null;
    for (const ws of this.sockets()) {
      let uid = null;
      try { uid = ws.deserializeAttachment()?.uid; } catch { /* gone */ }
      const me = uid && this.g.players[uid];
      if (me && me.watching) {
        gallery = gallery || this.publicState(true);
        this.send(ws, "BZ_STATE", { game: gallery });
        continue;
      }
      if (!me) { this.send(ws, "BZ_STATE", { game: shut }); continue; }
      const hand = this.handOf(me);
      this.send(ws, "BZ_STATE", {
        game: { ...shut, players: shut.players.map((r) => (r.uid === uid ? { ...r, ...hand } : r)) },
      });
    }
  }
```

Players see their own hand and nobody else's; anybody **watching** rather than
playing sees the lot, because that is what makes a game worth watching. The
clue text is public. The answer is private until reveal. The options are
private to whoever holds the clue.

### 5.3 State

```js
this.g = {
  code, phase: "LOBBY" | "PLAYING" | "RESULTS",
  hostUid, solo: false, aiCount: 3, aiLevel: "club",
  round: 1,
  cats: [{ id, name }, ...6],   // this round's columns
  used: [],                     // category ids already played in this room
  spent: [[false x5] x6],
  turnUid: null,                // whoever answered last picks
  cell: null,                   // see below
  players: {}, chat: [], feed: [],
  startedAt: null, seed: 0, roundNo: 0,
};
```

**Store clue references, not clue text.** `this.g` is one storage key
(`storage.put({ game: this.g })`) and every chat line rewrites the whole
thing. Keep `{catId, row}` on the board and resolve the text from the bank
when it is sent.

The open cell:

```js
cell = {
  col, row, value, catId, stage,
  q,                  // public
  a,                  // private until reveal
  options: [4],       // private to cell.holder
  shownAt, openAt,    // reading ends at openAt
  deadline,           // when this stage times out
  holder: null, wrongUids: [], buzzes: [], locked: {}, aiBuzz: {},
}
```

`stage` runs `READING → OPEN → WINDOW → ANSWERING → REVEAL`, then the cell
closes and `cell` goes back to null.

Ten seconds with no answer costs the value, exactly as a wrong answer does —
that is the real rule and it keeps a player from sitting on a clue.

### 5.4 Timers — alarms only, never `setTimeout`

There is no tick and no `setTimeout` anywhere in this codebase, and there must
not be one here: the hibernation API can evict the object between messages and
a pending timeout dies with it. One alarm, armed to whichever deadline comes
first. Copy `armAlarm` from `src/grand-prix.js:636`:

```js
  async armAlarm() {
    const when = [this.cellDeadline(), this.nextAiAt()].filter(Boolean);
    if (when.length) await this.state.storage.setAlarm(Math.max(Math.min(...when), Date.now() + 250));
  }
```

The 250ms floor stops an alarm storm. `alarm()` also doubles as idle GC — when
nothing is connected and no game is running, `storage.deleteAll()` and set
`this.g = null`.

**The room does not need to wake at `openAt`.** Buzzes are judged against
`openAt` after the fact, so the browser opens the buzzers on its own clock and
the room only has to know when they opened.

### 5.5 Computer players in the window

At the moment a cell opens, roll `aiIntent()` for each computer player and
store `{uid: reaction}` in `cell.aiBuzz`. Then:

- Arm the alarm at `openAt + min(reaction)` so a computer can *start* a window
  when no human buzzes.
- At resolve time, inject every computer whose reaction falls inside the
  window that is closing.

That way computers and people go through `winningBuzz()` together, and there
is no branch anywhere that asks whether a buzz came from a person.

### 5.6 Messages

Client → server. `PING`, `TOKENS`, `APPLY_TOKEN`, `ARM_TOKEN`, `DISARM_TOKEN`
are the shared cross-game names and are **not** prefixed; everything else is:

```
BZ_SKEW {t0}          -> reply BZ_PONG {t0, serverNow}   (see §6.1)
BZ_SOLO {on}          BZ_AI {count, level}
BZ_CATS {round, ids}  BZ_RANDOM {round, sections?}
BZ_START {}           BZ_PICK {col, row}
BZ_BUZZ {at}          BZ_ANSWER {choice}
BZ_SAY {text}         BZ_END_MATCH {}
```

Server → client:

```
BZ_WELCOME {you, isHost, serverNow, bank}   BZ_STATE {game}
BZ_OPTIONS {options, until}   -- to the holder only
BZ_FEED {entry}               -- WRAPPED, {at, text}
BZ_CHAT {uid, name, text, at} -- FLAT, the entry spread
BZ_OVER {results, mode, bounty}             BZ_ERROR {message}
```

The wrapped-vs-flat asymmetry is Battleship's and is load-bearing on the
client. Mirror it exactly or the render calls break silently.

### 5.7 Registering the room in the directory

`scripts/registry-test.mjs` asserts the source contains `announceRoom(this.env`,
`game: "buzzer"`, and **at least three** `this.announce()` call sites (join,
state change, leave). Copy `beat()` / `announce()` from
`src/grand-prix.js:78-96`.

Codes come from one pool with no game attached — `/api/dojo/new` mints one,
`/api/room/:code` asks the DIRECTORY which game owns it, and the directory
answers from the **live** list only. A room that never calls `announceRoom`
cannot be joined by code.

---

## 6. Chat and feed — copied from Battleship, as asked

Server, verbatim from `src/battle-lobby.js:117` and `:1228`:

```js
  log(text) {
    this.g.feed.unshift({ at: Date.now(), text });
    this.g.feed = this.g.feed.slice(0, 80);
    this.broadcast("BATTLE_FEED", { entry: this.g.feed[0] });
  }

  async say(uid, msg) {
    const p = this.g.players[uid];
    const text = String(msg.text || "").trim().slice(0, 200);
    if (!text) return;
    // The same screen as the arena chat; a refused line is a strike.
    const verdict = await moderate(this.env, text);
    if (!verdict.ok) {
      const strikes = await strikePlayer(this.env, uid, p?.name || "Captain", { text, reason: verdict.reason, where: "battleship chat" });
      const ws = this.socketFor(uid);
      if (ws) this.send(ws, "BATTLE_ERROR", { message: `That doesn't belong here (${verdict.reason}). Strike ${strikes ?? "?"} of 3.` });
      return;
    }
    const entry = { uid, name: this.nameOf(p) || "Captain", text, at: Date.now() };
    this.g.chat.push(entry);
    this.g.chat = this.g.chat.slice(-60);
    await this.persist();
    this.broadcast("BATTLE_CHAT", entry);
  }
```

Client, verbatim from `public/battle.js:796-816`:

```js
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
```

Tab switching, verbatim from `public/battle.js:230`:

```js
/** Captains, shot feed and chat share one block; this picks which is on. */
function showDeck(which) {
  B.deck = which;
  for (const [tab, pane] of [["bt-captains", "captains"], ["bt-feed", "feed"], ["bt-chat", "chat"]]) {
    $(tab)?.classList.toggle("on", pane === which);
    const body = $(`bpane-${pane}`);
    if (body) body.hidden = pane !== which;
  }
}
```

Panel markup, verbatim from `public/index.html:289-307`:

```html
      <section class="panel bdeck">
        <div class="btabs" role="tablist">
          <button id="bt-captains" class="btab on" role="tab">Captains</button>
          <button id="bt-feed" class="btab" role="tab">Shot Feed</button>
          <button id="bt-chat" class="btab" role="tab">Chat</button>
        </div>
        <div class="bdeck-body">
          <div id="bpane-captains"><ul id="battle-roster" class="battle-roster"></ul></div>
          <div id="bpane-feed" hidden><div id="battle-feed" class="bfeed"></div></div>
          <div id="bpane-chat" hidden>
            <div id="battle-chat" class="bchat"></div>
            <div class="composer">
              <input id="battle-say" maxlength="200" placeholder="Talk to the fleet" aria-label="Message the fleet">
              <button id="btn-battle-send" class="btn">Send</button>
            </div>
          </div>
        </div>
      </section>
```

The CSS, verbatim from `public/styles.css:876` and `:2057`:

```css
/* Fixed heights, not max-heights: a growing feed used to push everything
   under it down the page every time a shot landed. */
.bfeed, .bchat { padding: .6rem .9rem; display: grid; gap: .35rem; height: 220px; overflow-y: auto; align-content: start; }
.bfeed-line, .bchat-line { margin: 0; font-size: .84rem; color: #CBD5E1; max-width: none; }
.bchat-line b { color: var(--accent); font-family: var(--display); text-transform: uppercase; letter-spacing: .04em; }
.bt { font-family: var(--display); font-size: .72rem; color: #64748B; }

.bdeck { padding: 0; }
.btabs { display: flex; gap: .3rem; padding: .5rem .5rem 0; border-bottom: 1px solid var(--edge); }
.btab {
  flex: 1; padding: .45rem .6rem; font: inherit; font-size: .85rem; cursor: pointer;
  background: transparent; border: 1px solid transparent; border-bottom: none;
  border-radius: 6px 6px 0 0; color: var(--muted);
}
.btab:hover { color: var(--accent); }
.btab.on { background: rgba(255,255,255,.06); border-color: var(--edge); color: inherit; font-weight: 600; }
.bdeck-body { padding: .6rem; }
.bdeck-body .bfeed, .bdeck-body .bchat { max-height: 15rem; overflow-y: auto; }
```

**Copy these deliberately, not accidentally:**

- `g.feed` is **newest-first** (`unshift` + `slice(0, 80)`); `g.chat` is
  **oldest-first** (`push` + `slice(-60)`). The join backfill reverses the feed
  (`[...this.g.feed].reverse()`) so the client's `prepend` lands it
  newest-at-top. Get either direction wrong and history arrives upside down.
- **Nothing scrolls.** Both panels `prepend`. Do not add
  auto-scroll-to-bottom; this is the opposite of a conventional chat.
- `log()` never persists; `say()` does. Recent feed lines can be lost to an
  eviction. Fix it or keep it, but know which you are doing.
- Both renderers use `innerHTML` with a hand-rolled `esc()` on every
  interpolated value. Escape at interpolation; there is no sanitizer pass.
- Caps are three different numbers: 80 on the server, 60 in the DOM, and only
  the last 30 chat lines replayed on join.
- The tab id → pane name pairs are hardcoded as the same literal array in two
  places (`showDeck` and `draw`). Change one and you must change the other.
  The active tab is the class `on`; the buttons carry `role="tab"` but no aria
  state is ever set, so these tabs are not actually accessible. Copying this
  copies that gap — worth fixing rather than inheriting.
- **Bugs in the original, do not copy them:** the chat input listener is
  attached with `addEventListener("keydown", …)` *inside* `draw()`, which runs
  on every state push, so listeners accumulate — use `.onkeydown =`. And the
  `.composer` class has no CSS rule anywhere; the styled equivalent is
  `.chat-composer` (`styles.css:2673`).
- There is **no rate limiting** on chat anywhere in the codebase. If the quiz
  room wants one, that is new behaviour, not a copy.
- `moderate()` **fails open** — a Workers AI timeout returns `{ok:true}`. It
  also awaits a network round trip before the line is broadcast, and there is
  no optimistic local echo, so a chat line can take seconds to appear.

Feed voice: complete sentences, third person, ending in a period, written as a
narrator reporting the room — `${name} takes THE CASINO FLOOR for $600.`,
`${name} buzzed in at 0.31 seconds.`, `Nobody knew it. The answer was ${a}.`
Note the house habit of `|| "Nobody"` so a feed line never renders `undefined`.

### 6.1 The clock skew — do this properly, it is the whole buzzer

The race computes `P.clockSkew = Date.now() - msg.serverNow`, which bakes one
way of latency into the estimate. That is fine for a race and **not** fine
here: it would hand a high-latency player a systematic advantage proportional
to their own latency.

Use an NTP-style round trip instead. The client sends `BZ_SKEW {t0}`, the
server replies `BZ_PONG {t0, serverNow}`, and the client computes

```
skew = (t0 + t1) / 2 - serverNow      // t1 = receive time
```

keeping the sample from the **lowest** round trip out of several, which is
standard practice because it is the sample least polluted by queuing. The buzz
then sends `at: Date.now() - skew`.

---

## 7. Wiring — every insertion point, with anchors

Verified by reading the files.

**`wrangler.toml`** — append a binding block and a **new** migration tag. The
highest existing tag is `v9`. Never edit or reuse an existing tag.

```toml
[[durable_objects.bindings]]
name = "BUZZER"
class_name = "BuzzerRoom"

[[migrations]]
tag = "v10"
new_sqlite_classes = ["BuzzerRoom"]
```

**`src/index.js:21`** — anchor `export { GrandPrix } from "./grand-prix.js";`
Add below: `export { BuzzerRoom } from "./buzzer-room.js";`
A Durable Object class is only reachable if it is re-exported from the entry.

**`src/index.js:600`** — anchor:
```js
    const room = /^\/api\/(battle|mines|links|prix)\/([A-Za-z0-9-]{3,16})\/ws$/.exec(path);
```
Add `|buzzer` to the alternation, then extend the namespace ladder twelve
lines below with `: room[1] === "buzzer" ? env.BUZZER`. The route already
verifies the Firebase token, checks `barred()`, uppercases the code and
forwards `X-Dojo-Uid` / `X-Dojo-Name` / `X-Dojo-Code`.

**`src/rooms.js:10`** — anchor
`export const GAME_IDS = ["crossword", "battleship", "minesweeper", "casino", "links", "prix"];`
Append `"buzzer"`. `registry-test.mjs` asserts every `arena.js` `game:` value
appears here.

**`public/arena.js:94`** — insert a seventh `GAME_MODES` entry *before* the
`gauntlet` block, so the unavailable Gauntlet stays last:

```js
  {
    id: "the-buzzer",
    name: "The Buzzer",
    players: "1 or more",
    blurb: "Six categories, five rows, one buzzer. ...",
    kind: "match",
    game: "buzzer",
    available: true,
  },
```

**`public/app.js:19`** — anchor `import { enterPrix, closePrix } from "./prix.js";`
Add the new module import beside it. There is no `<script>` tag per game;
`app.js` is one `type="module"` entry and load order does not matter.

**`public/app.js:160`** — anchor:
```js
  for (const s of ["gate", "home", "forge", "dojo", "battle", "mines", "casino", "prix"]) $(`screen-${s}`).hidden = s !== name;
```
Append `"buzzer"`. If omitted, `show("buzzer")` throws on a null node **and**
the previous screen is never hidden.

**`public/app.js:2201`** — anchor
`const GAME_ICONS = { crossword: "\u{1F520}", battleship: "⚓", ... }`
Add `buzzer: "\u{1F6CE}️"` (or your pick). Use a `\u` escape, not a
literal emoji. **While you are here: `prix` is missing from this map and from
`GAME_NAMES` — the Grand Prix tile has been showing the generic fallback.**

**`public/app.js:3262`** — anchor
`  prix: (code, back) => { show("prix"); enterPrix(code, idToken, back); },`
Add directly below **in the same format**: exactly two leading spaces,
lowercase key, first parameter literally `code`. `registry-test.mjs` matches
`/^\s{2}([a-z]+):\s*\(_?code/gm` and will fail otherwise.

**`public/app.js:3304`** — anchor
`const REJOINABLE = new Set(["crossword", "battleship", "minesweeper", "prix"]);`
Add `"buzzer"`. Nothing else is needed — `enterHome()` already calls
`roomInUrl()` and `openRoom()`, so a mid-game refresh walks back in.

**`public/app.js:2063`** — add a seventh `GAME_RULES` object with the same six
keys (`id` must equal the game id) for the rule book. `play`/`score` strings
are injected as **raw HTML**; What's New strings are escaped. Opposite
conventions in adjacent features.

**`public/app.js:4444`** — anchor `bindBattleControls();` — if the new module
exports a binder, call it here. (`prix.js` uses the other convention and calls
its own top-level `wire()`. Pick one and be consistent.)

**`public/cosmetics.js:223`** — anchor `export const GAME_NAMES = {`
Add `buzzer: "The Buzzer"`. Required before any BANNERS entry with
`game: "buzzer"`, or `achievementsHtml` prints the literal `undefined`.

**`public/boost.js:19`** — one `TOKEN_ITEMS` line creates the ⚡ shop card, the
arsenal window and the `shopItem()` lookup. For the twelve-token arsenal, add
a `BUZZER_ARSENAL_ITEMS` array and register it in `GAME_ARSENAL_ITEMS`
(`public/boost.js:272`). Server truth is `src/arsenals.js`; `public/boost.js`
is a hand-kept mirror with **nothing checking that the two agree**.

**`public/index.html:577`** — anchor `<!-- the dojo -->`. Insert the new
`<section id="screen-buzzer" class="screen" hidden>` immediately before it.
Modals belong with the group at lines 441-448 — **not** at the end of the file
where `#prix-pick` ended up, after the script tags.
(Note: the comment at line 450 says `<!-- minesweeper -->` but labels the prix
section. Do not use it as an anchor.)

**`public/styles.css:1263-1305`** — screen backgrounds are hard-coded by id.
`#screen-dojo, #screen-battle, #screen-mines` share the dark play-surface
block. **A new section gets no play-surface styling until its id is added to
those selector lists** — it renders as the light home-screen theme.

**`public/whats-new.js:18`** — a new entry as the first element. The note's
identity is `${at}|${title}`; editing either on a shipped entry re-pulses the
tab for everyone, so fix typos in `text` only. The prix entry says "A sixth
game", so word this one **"A seventh game"** to keep the running count honest.

**`package.json`** — add `node scripts/buzzer-test.mjs` to the `test` chain.

**`public/sw.js`** needs nothing. Bump `const CACHE = "dojo-shell-v23"` only to
force installed copies to drop what they hold.

---

## 8. Money, scoring and MMR

Every game ends the same way: build a 0..100 `score`, feed it to
`sessionGain()`, multiply by `boosted()` if a boost was applied, and hand one
match object to `recordMatch(env, match)`.

```js
recordMatch(env, {
  code, roundNo, puzzleId,          // required; puzzleId e.g. `buzzer:${catIds.join(",")}`
  game: "buzzer", mode,             // mode = field.length >= 3 ? "rumble" : "match"
  field: results.length,            // override, because computers are on the board
  finishedAt: Date.now(),
  results: human,                   // humans only
})
```

Result row: `{ uid, name, score, gain, status, elapsedMs, placement, seed,
solved, spent, boost, mmrBefore, mmrAfter, belt, promoted, breakdown }`.

Copy the finish path from `src/grand-prix.js:1215-1289` wholesale. Watch:

- **`gain` falls back to `score`** everywhere (`r.gain ?? r.score`). A row that
  omits `gain` quietly awards its raw score as MMR. Always set it from
  `sessionGain().total`.
- **Clamp to 100 at the room**, right after the score function returns. The cap
  is a convention, not enforced anywhere.
- `mode` is decided by field size, not by the host. Set `p.seed` at round start
  from the MMR ordering: `seeded.indexOf(p.uid) + 1 || null`.
- `applyBounty` **mutates results in place** and must be awaited *before* the
  OVER broadcast and before `recordMatch`, or the MMR shown and the MMR written
  disagree. It returns null when `env.BOUNTY` is unbound, and that must never
  block a result.
- `recordMatch` is fire-and-forget by convention, inside `state.waitUntil?.()`,
  never awaited, with a `[buzzer]` log prefix — lowercase, in brackets.
- **Firestore write order is load-bearing.** `boardRowsFromCommit` reads
  transform results back by numeric position. Do not insert a transform before
  `bestAsst`.
- Two different `beltFor` functions exist with different tables. Result rows use
  the one from `src/mmr.js`, not `src/scoring.js`.
- `featsFor` gives `played_any`, `played_buzzer`, `won_any`, `won_buzzer`,
  `solo_buzzer`, `assisted_*` for free. Anything else needs a branch in
  `public/cosmetics.js:267`.
- `public/cosmetics.js` is **not** a mirror — the Worker imports it directly
  across the `public/` boundary. Editing it changes both sides at once.
- Armed is not spent. `p.ars = { armed: {}, used: {} }`; `used` is what actually
  took hold, copied into the result row as `spent` and decremented by the match
  write. A token that could not take effect must stay in `armed`.

Banking, at the end of a game, per player:

```js
const take = bankable(p.money);              // money - 2000, floored at 0
if (take > 0) await bankWallet(this.env, uid, take, p.name);
```

`bankWallet` refuses any non-positive amount with a bare `return false`,
indistinguishable from a network failure — the casino treats both identically:
put the money back, re-save, and say "Couldn't reach your wallet. Nothing was
moved." Do not surface a different message for the zero case. **Money and MMR
are separate ledgers and never convert.**

---

## 9. The clue bank: `src/buzzer-bank.js`

```js
export const SECTIONS = [
  { id: "arena", name: "The arena" }, { id: "staples", name: "The staples" },
  { id: "wordplay", name: "Wordplay" }, { id: "geography", name: "Geography" },
  { id: "history", name: "History" }, { id: "science", name: "Science and nature" },
  { id: "culture", name: "Culture" }, { id: "everyday", name: "Everyday life" },
];

export const CATEGORIES = [
  {
    id: "battleship", name: "BATTLESHIP ROYALE", section: "arena",
    scope: "Every answer is a piece of Battleship Royale as the server enforces it.",
    clues: [                       // index 0 is row 1, the $200 clue
      { q: "The smallest hull in the fleet, at two cells", a: "Destroyer",
        wrong: ["Carrier", "Cruiser", "Submarine"] },
      // ...five in all, difficulty climbing
    ],
  },
];

export function categoryById(id) { ... }
export function categoriesIn(section) { ... }
```

`optionsFor(clue, pool, rnd)` in `src/buzzer.js` already builds the four
options from `clue.wrong` plus an optional category-wide `pool`, shuffled on a
seed so every browser in the room sees the same order.

**POTPOURRI needs its rule in the data, not in somebody's head** — it survives
four-options-from-the-same-family only because every answer is secretly an
ordinary household object. The column breaks the night somebody adds a clue
whose answer is a person.

### 9.1 What exists: `buzzer-clues-arena.json`

Ten of the twelve arena categories, fifty clues, each with three same-family
decoys and a `source` giving the `file:line` that proves the answer.

**These are FIRST DRAFTS and the verification pass never ran** — it died on a
session limit. Treat every answer as unconfirmed until checked against the
code. I had started spot-checking and got through none of it.

Three I already consider suspect and would check first:

1. **TOKENS & ARSENALS row 4** says six battleship tokens carry no `max`.
   Separate reconnaissance of the same file said **four**. One is wrong.
2. **THE KART GARAGE row 1** answers "Formula" for `DEFAULT_KART = "f1"` —
   confirm the display name, and confirm Saloon / Taxi / Estate are real karts
   rather than invented decoys.
3. **BATTLESHIP row 5** gives the Submarine Torpedo an unrounded price of
   "143", which looks like a misread of a line number or an array index.

Two arena categories were never written at all: **BELTS & BRASS** and
**THE BOUNTY OFFICE**.

The remaining 92 categories are named but unwritten — that is 460 clues, and it
is the long pole of the whole project. The full list of 104 names by section is
in `buzzer-categories.json`.

Worth knowing from the first drafting round: four sample answers came back
factually wrong, and two of them were wrong because **a literal in the source
disagrees with what the code does**. `src/casino-core.js` declares `pays: 50`
for the Long bet and `pays: 3.5` for the 1st-or-2nd bet, and a `PRICES` loop
twelve lines later overwrites both — the game actually pays 100 and 4. Any
clue written from that file must be written from the loop, not the literal.
(That array is worth tidying on its own account, game or no game.)

### 9.2 The three categories that write their own clues

The Grand Prix's engines already generate and scale by level, cost nothing to
write and never repeat: **Memory** (tiles light in order; row 1 is four tiles,
row 5 is eight), **Mental Arithmetic** (a sum on a number pad, grade 1 to grade
11), **Scrambled** (letters dealt out of order with a clue).

They break the buzzer, and deliberately: a sequence has to be watched by
everybody before anybody can answer. So a generated row is played by the whole
table at once, and the first correct answer takes the value while a wrong one
costs it. **At most one generated category on a board**, marked as such before
it is picked. A change of pace once a game is a pleasure; three is a different
game. These sit alongside the 104 rather than among them.

---

## 10. Tests: `scripts/buzzer-test.mjs`

No framework. A standalone ESM script run by `node`, chained with `&&` in
`package.json`. Copy `FakeSocket` and `makeState()` **verbatim** from
`scripts/prix-test.mjs:94-136` — they are copy-pasted into 20+ scripts and
there is deliberately no helpers module.

```js
let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };
// ... sections, each opened with a bare console.log("\nthe buzzer")
console.log(bad ? `\n${bad} failing\n` : "\nall buzzer checks passed\n");
process.exit(bad ? 1 : 0);
```

Conventions: `await state._init` immediately after `new BuzzerRoom(state, env)`
or `this.g` is still undefined when the first message lands. Use the
**array-aware** `storage.get` flavour. Rig state by reaching inside the DO
(`room.g.cell.openAt = Date.now() - 400`) and then call the real handler — time
is controlled by rewriting timestamps, never by faking `Date.now` or sleeping.
Assertion labels are prose, lowercase, no trailing period.
**Error message strings are a test contract** — refusals are asserted with
regexes on fragments, so write them as short human sentences and then leave
them alone.

The buzzer wants adversarial tests specifically, because the clamp is the whole
of the security:

- a buzz stamped before `openAt` is refused and locks that player out for 250ms
- a buzz stamped zero is clamped to arrival and loses to an honest quick one
- a buzz stamped in the future is clamped to arrival
- a slow connection with a genuinely quick reaction **beats** a fast connection
  with a slow one — this is the entire point of the design
- two buzzes inside the window resolve on reaction, not arrival order
- a wrong answer reopens the clue and the same player cannot buzz again
- ten seconds with no answer costs the value, same as a wrong one
- a player at or below zero can still buzz and still win

---

## 11. Build order

From the design doc, so there is something playable as early as possible:

1. **The room, the board, the buzzer and scoring** — one round, no Daily
   Doubles. Playable. *(This is the step that was in progress.)*
2. The computer players and the solo toggle, so it can be tested without three
   other people. *(I was folding this into step 1, because without it there is
   no way to prove the buzzer works.)*
3. Double Jeopardy, Daily Doubles, Final Jeopardy.
4. Money, banking and the score mapping.
5. Avatars, chat, feed.
6. The arsenal, the rule book, What's New.

The clues run alongside all of it and start on day one.

---

## 12. House rules for this repo

- **Deploy with `npm run deploy`** (it stamps the build first), then commit the
  build stamp and `git push origin master` after **every** deploy.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **No real-money purchases anywhere in the game.** Casino money is its own
  economy.
- Don't tally the total wallets into one lump sum.
- Comment voice: plain English prose explaining **why**, usually naming the
  concrete failure that forced the decision, often three or four lines above
  the code. Never describe what a line does. Section dividers are
  `// ── name ─────────` box-drawing rules. Numbers in `src/` carry underscore
  separators (`900_000`). Unicode in string literals is escaped.
- Error voice: short human sentences. "Only the host starts the board.",
  "The buzzers aren't open yet.", "You've had your go at this one."
- `registry-test.mjs` also asserts that `index.html`'s `<meta name="build">`
  matches `public/version.json` — run `npm run stamp` before running the tests.
