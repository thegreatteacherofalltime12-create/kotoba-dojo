/**
 * The Buzzer — one Durable Object per board.
 *
 * Six categories across, five rows down. A clue is picked, read, and then
 * contested: the buzzers open and the quickest reaction takes it. That last
 * part is the only genuinely new machinery in the arena — every other game
 * here is turn-based or everyone-at-once, so nothing was ever in a hurry to
 * arrive first. See `buzz()` and `resolveWindow()` for how a contest is
 * settled, and src/buzzer.js for why it is settled on reaction time rather
 * than on whose packet reached Cloudflare first.
 *
 * The answers never leave this object until they are spent. The clue text is
 * public the moment it is picked; the four options go to exactly one player;
 * the answer itself is private until the cell closes.
 */
import {
  GAME_NAME, COLS, ROWS, START_MONEY, valueAt, readingMs,
  ANSWER_MS, NOBODY_MS, REVEAL_MS, BUZZ_WINDOW_MS,
  judgeBuzz, winningBuzz, shuffle, rngFrom, optionsFor,
  boardScore, standings, bankable,
  AI_LEVELS, AI_MAX, AI_NAMES, aiLevelById, aiIntent,
} from "./buzzer.js";
import { CATEGORIES, SECTIONS, categoryById, poolFor } from "./buzzer-bank.js";
import { moderate } from "./moderation.js";
import { recordMatch, readRatings, bankWallet, strikePlayer } from "./firestore.js";
import { announceRoom } from "./rooms.js";
import { applyBounty } from "./report-bounty.js";
import { sessionGain, fieldMmrFor, beltFor, boosted } from "./mmr.js";

const IDLE_SHUTDOWN_MS = 30 * 60_000;
// Pressing a buzzer is one event, and a person leaning on it is a handful.
// This is here to stop a script hammering the object, not to pace anybody —
// an early buzz is already punished by the lockout, which is the real rule.
const BUZZES_PER_SECOND = 6;
const BUZZ_BURST = 15;

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

  socketFor(uid) {
    return this.sockets().find((ws) => {
      try { return ws.deserializeAttachment()?.uid === uid; } catch { return false; }
    });
  }

  /** A buzz budget per player, refilled steadily. */
  allow(uid) {
    const now = Date.now();
    const b = this.buckets.get(uid) || { tokens: BUZZ_BURST, at: now };
    b.tokens = Math.min(BUZZ_BURST, b.tokens + ((now - b.at) / 1000) * BUZZES_PER_SECOND);
    b.at = now;
    if (b.tokens < 1) { this.buckets.set(uid, b); return false; }
    b.tokens -= 1;
    this.buckets.set(uid, b);
    return true;
  }

  beat() {
    const now = Date.now();
    if (now - (this.lastBeat || 0) < 20_000) return;
    this.lastBeat = now;
    this.announce();
  }

  announce() {
    if (!this.g) return;
    announceRoom(this.env, this.state, {
      game: "buzzer",
      code: this.g.code,
      host: this.g.players[this.g.hostUid]?.name || "Someone",
      players: this.connected().size,
      phase: this.g.phase,
      label: this.g.solo ? "Solo" : GAME_NAME,
      round: this.g.round,
    });
  }

  // ------------------------------------------------------------- connections

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

  async onJoin(uid, name, code, ws) {
    if (!this.g) {
      this.g = {
        // The code comes off the header and nowhere else. A room that names
        // itself cannot be found: the directory maps one code pool onto seven
        // games, so a board announcing a made-up code is a board nobody can
        // join by typing the code they were given.
        code, phase: "LOBBY", hostUid: uid,
        solo: false, aiCount: 3, aiLevel: "club",
        round: 1, roundNo: 0,
        cats: [], used: [],
        spent: freshBoard(),
        turnUid: null, cell: null,
        players: {}, chat: [], feed: [],
        startedAt: null, seed: 1,
      };
    }

    const p = this.g.players[uid];
    if (p) { p.name = name; p.gone = false; }
    else this.g.players[uid] = this.freshPlayer(uid, name);

    await this.persist();
    this.announce();
    this.send(ws, "BZ_WELCOME", {
      you: uid, isHost: this.g.hostUid === uid,
      serverNow: Date.now(),
      sections: SECTIONS,
      catalogue: CATEGORIES.map((c) => ({ id: c.id, name: c.name, section: c.section, scope: c.scope })),
      aiLevels: AI_LEVELS.map((l) => ({ id: l.id, name: l.name })),
      aiMax: AI_MAX, cols: COLS, rows: ROWS, start: START_MONEY,
    });

    // The feed is newest-first in storage, so it is replayed reversed and the
    // browser's prepend lands it the right way up.
    for (const e of [...(this.g.feed || [])].reverse()) this.send(ws, "BZ_FEED", { entry: e });
    for (const m of (this.g.chat || []).slice(-30)) this.send(ws, "BZ_CHAT", m);
    this.pushState();

    // Back mid-clue: the options come with it, if they were theirs.
    if (this.g.cell?.holder === uid) this.sendOptions(uid);

    await this.state.storage.deleteAlarm().catch(() => {});
    await this.armAlarm();
  }

  freshPlayer(uid, name) {
    return {
      uid, name, joinedAt: Date.now(),
      watching: this.g.phase === "PLAYING",
      money: START_MONEY,
      right: 0, wrong: 0, buzzes: 0, bestReaction: null,
      ai: false, aiLevel: null, avatar: null,
      ars: { armed: {}, used: {} },
      score: 0, mmrAtStart: 0, seed: null, gone: false,
    };
  }

  // ------------------------------------------------------------------ state

  /**
   * The board as a viewer is allowed to see it. The open view is the
   * gallery's, which holds nothing back — a game with nothing to watch is
   * not worth watching.
   */
  publicState(open = false) {
    const online = this.connected();
    const field = Object.values(this.g.players).filter((p) => !p.watching);
    const order = standings(field).map((p) => p.uid);
    const c = this.g.cell;
    return {
      code: this.g.code, phase: this.g.phase, hostUid: this.g.hostUid,
      solo: !!this.g.solo, aiCount: this.g.aiCount, aiLevel: this.g.aiLevel,
      round: this.g.round, turnUid: this.g.turnUid,
      cats: this.g.cats, spent: this.g.spent, used: this.g.used,
      values: Array.from({ length: ROWS }, (_, r) => valueAt(r, this.g.round)),
      serverNow: Date.now(),
      cell: c ? {
        col: c.col, row: c.row, value: c.value, stage: c.stage,
        catId: c.catId, q: c.q,
        // When the buzzers opened, not when they will: the browser opens them
        // on its own clock against this, and every buzz is judged against it
        // afterwards. Sending it is what makes a reaction time mean anything.
        openAt: c.openAt, deadline: c.deadline,
        holder: c.holder, wrongUids: c.wrongUids,
        // The answer is the room's until the cell closes, and the four options
        // belong to whoever is answering. Neither travels with the board.
        answer: c.stage === "REVEAL" || open ? c.a : null,
        ...(open ? { options: c.options } : {}),
      } : null,
      players: Object.values(this.g.players).map((p) => ({
        uid: p.uid, name: p.name, online: online.has(p.uid) || !!p.ai,
        watching: !!p.watching, money: p.money,
        right: p.right, wrong: p.wrong, buzzes: p.buzzes,
        bestReaction: p.bestReaction,
        ai: !!p.ai, aiLevel: p.aiLevel || null, avatar: p.avatar || null,
        place: p.watching ? null : order.indexOf(p.uid) + 1,
        ...(open ? this.handOf(p) : {}),
      })),
    };
  }

  /**
   * What only one player may know: the four options, and only while the clue
   * is actually theirs. Everything else about a player is on the scoreboard
   * already, because money in this game is public and that is most of the
   * tension in it.
   */
  handOf(p) {
    const c = this.g.cell;
    if (c && c.holder === p.uid && c.stage === "ANSWERING") {
      return { options: c.options, answerUntil: c.deadline };
    }
    return { options: null, answerUntil: null };
  }

  /**
   * One board, sent as many ways as there are kinds of viewer: every player
   * sees their own options and nobody else's, and anybody watching rather
   * than playing sees the lot.
   */
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

  sendOptions(uid) {
    const ws = this.socketFor(uid);
    const c = this.g.cell;
    if (!ws || !c || c.holder !== uid) return;
    this.send(ws, "BZ_OPTIONS", { options: c.options, until: c.deadline, value: c.value });
  }

  // ------------------------------------------------------------------ chat

  log(text) {
    this.g.feed.unshift({ at: Date.now(), text });
    this.g.feed = this.g.feed.slice(0, 80);
    this.broadcast("BZ_FEED", { entry: this.g.feed[0] });
  }

  /**
   * Chat stays open the whole way through, unlike the race, which shuts its
   * own because nobody can type and answer at the same time. There are real
   * gaps between clues here and people should be talking in them.
   */
  async say(ws, uid, msg) {
    const p = this.g.players[uid];
    const text = String(msg.text || "").trim().slice(0, 200);
    if (!text) return;
    // The same screen as the arena chat; a refused line is a strike.
    const verdict = await moderate(this.env, text);
    if (!verdict.ok) {
      const strikes = await strikePlayer(this.env, uid, p?.name || "Player", { text, reason: verdict.reason, where: "buzzer chat" });
      return this.send(ws, "BZ_ERROR", { message: `That doesn't belong here (${verdict.reason}). Strike ${strikes ?? "?"} of 3.` });
    }
    const entry = { uid, name: p?.name || "Player", text, at: Date.now() };
    this.g.chat = [...(this.g.chat || []), entry].slice(-60);
    await this.persist();
    this.broadcast("BZ_CHAT", entry);
  }

  // ----------------------------------------------------------- the messages

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const who = ws.deserializeAttachment();
    if (!who?.uid || !this.g) return;

    try {
      switch (msg.type) {
        case "PING": return this.beat();
        // A round trip, not a one-way stamp. The race measures skew from a
        // single serverNow, which bakes one way of latency into the answer —
        // harmless in a race, and here it would hand a player on bad wifi a
        // head start proportional to how bad their wifi is.
        case "BZ_SKEW": return this.send(ws, "BZ_PONG", { t0: msg.t0, serverNow: Date.now() });
        case "BZ_SOLO": return await this.setSolo(ws, who.uid, msg);
        case "BZ_AI": return await this.setAi(ws, who.uid, msg);
        case "BZ_CATS": return await this.setCats(ws, who.uid, msg);
        case "BZ_RANDOM": return await this.randomCats(ws, who.uid, msg);
        case "BZ_START": return await this.start(ws, who.uid);
        case "BZ_PICK": return await this.pick(ws, who.uid, msg);
        case "BZ_BUZZ": return await this.buzz(ws, who.uid, msg);
        case "BZ_ANSWER": return await this.answer(ws, who.uid, msg);
        case "BZ_SAY": return await this.say(ws, who.uid, msg);
        case "BZ_END_MATCH": {
          if (who.uid !== this.g.hostUid)
            return this.send(ws, "BZ_ERROR", { message: "Only the host can end the board." });
          if (this.g.phase !== "PLAYING")
            return this.send(ws, "BZ_ERROR", { message: "No board is running." });
          return await this.finish();
        }
        default: return this.send(ws, "BZ_ERROR", { message: "Unrecognised message." });
      }
    } catch (err) {
      this.send(ws, "BZ_ERROR", { message: String(err?.message || err) });
    }
  }

  hostOnly(ws, uid) {
    if (uid !== this.g.hostUid) { this.send(ws, "BZ_ERROR", { message: "Only the host sets this." }); return false; }
    if (this.g.phase === "PLAYING") { this.send(ws, "BZ_ERROR", { message: "A board is already running." }); return false; }
    return true;
  }

  // ------------------------------------------------------------- the lobby

  async setSolo(ws, uid, msg) {
    if (!this.hostOnly(ws, uid)) return;
    this.g.solo = !!msg.on;
    await this.persist();
    this.pushState();
  }

  async setAi(ws, uid, msg) {
    if (!this.hostOnly(ws, uid)) return;
    if (msg.count != null) this.g.aiCount = Math.max(1, Math.min(AI_MAX, Number(msg.count) || 1));
    if (msg.level && AI_LEVELS.some((l) => l.id === msg.level)) this.g.aiLevel = msg.level;
    await this.persist();
    this.pushState();
  }

  async setCats(ws, uid, msg) {
    if (!this.hostOnly(ws, uid)) return;
    const ids = [...new Set((msg.ids || []).map(String))].filter((id) => categoryById(id));
    if (ids.length !== COLS)
      return this.send(ws, "BZ_ERROR", { message: `Pick exactly ${COLS} categories.` });
    this.g.cats = ids.map((id) => ({ id, name: categoryById(id).name }));
    await this.persist();
    this.pushState();
  }

  /**
   * Surprise me, optionally from named sections only. Categories this room
   * has already played are avoided while there are still fresh ones, so a
   * long session does not keep serving the same six.
   */
  async randomCats(ws, uid, msg) {
    if (!this.hostOnly(ws, uid)) return;
    const wanted = Array.isArray(msg.sections) && msg.sections.length
      ? CATEGORIES.filter((c) => msg.sections.includes(c.section))
      : CATEGORIES;
    const rnd = rngFrom(Date.now() & 0xffffffff);
    const fresh = wanted.filter((c) => !this.g.used.includes(c.id));
    const draw = shuffle(fresh.length >= COLS ? fresh : wanted, rnd).slice(0, COLS);
    if (draw.length < COLS)
      return this.send(ws, "BZ_ERROR", { message: `There aren't ${COLS} categories to draw from there.` });
    this.g.cats = draw.map((c) => ({ id: c.id, name: c.name }));
    await this.persist();
    this.pushState();
  }

  async start(ws, uid) {
    if (uid !== this.g.hostUid)
      return this.send(ws, "BZ_ERROR", { message: "Only the host starts the board." });
    if (this.g.phase === "PLAYING")
      return this.send(ws, "BZ_ERROR", { message: "A board is already running." });
    if (this.g.cats.length !== COLS)
      return this.send(ws, "BZ_ERROR", { message: `Pick ${COLS} categories first.` });

    if (this.g.solo) this.seatComputers();
    else for (const uid2 of Object.keys(this.g.players)) {
      if (this.g.players[uid2].ai) delete this.g.players[uid2];
    }

    const field = Object.values(this.g.players);
    for (const p of field) {
      p.watching = false;
      p.money = START_MONEY;
      p.right = 0; p.wrong = 0; p.buzzes = 0; p.bestReaction = null;
      p.score = 0;
    }

    // Ratings once, at the lights, so a slow board read cannot hold up a clue.
    const humans = field.filter((p) => !p.ai).map((p) => p.uid);
    let ratings = {};
    try { ratings = await readRatings(this.env, humans); } catch { ratings = {}; }
    const seeded = Object.entries(ratings).sort((a, b) => b[1] - a[1]).map(([u]) => u);
    for (const p of field) {
      p.mmrAtStart = ratings[p.uid] || 0;
      p.seed = seeded.indexOf(p.uid) + 1 || null;
    }

    this.g.phase = "PLAYING";
    this.g.startedAt = Date.now();
    this.g.roundNo = (this.g.roundNo || 0) + 1;
    this.g.seed = (Date.now() & 0xffffff) ^ (this.g.roundNo * 7919);
    this.g.spent = freshBoard();
    this.g.cell = null;
    this.g.used = [...new Set([...this.g.used, ...this.g.cats.map((c) => c.id)])];
    // Whoever the host is picks first; after that it is whoever answered last.
    this.g.turnUid = field.find((p) => !p.ai)?.uid || field[0]?.uid || null;

    await this.persist();
    this.log(`The board is up: ${this.g.cats.map((c) => c.name).join(" · ")}.`);
    this.broadcast("BZ_GO", { round: this.g.round, cats: this.g.cats, serverNow: Date.now() });
    this.announce();
    this.pushState();
    await this.armAlarm();
  }

  seatComputers() {
    const level = aiLevelById(this.g.aiLevel);
    const n = Math.max(1, Math.min(AI_MAX, this.g.aiCount || 3));
    for (const uid of Object.keys(this.g.players)) {
      if (this.g.players[uid].ai) delete this.g.players[uid];
    }
    for (let i = 0; i < n; i++) {
      const uid = `ai${i}`;
      this.g.players[uid] = {
        ...this.freshPlayer(uid, `${AI_NAMES[i] || "Player"} (${level.name})`),
        ai: true, aiLevel: level.id, watching: false, seed: 2 + i,
      };
    }
  }

  isAi(uid) { return typeof uid === "string" && /^ai\d+$/.test(uid); }

  // -------------------------------------------------------------- the board

  /**
   * A cell, picked. The clue goes out to everybody at once with no options on
   * it, and the buzzers stay shut for as long as it takes to read aloud —
   * which is the whole reason buzzing well is a skill rather than a reflex.
   */
  async pick(ws, uid, msg) {
    if (this.g.phase !== "PLAYING")
      return this.send(ws, "BZ_ERROR", { message: "No board is running." });
    if (this.g.cell)
      return this.send(ws, "BZ_ERROR", { message: "There's a clue on the board already." });
    const p = this.g.players[uid];
    if (!p || p.watching)
      return this.send(ws, "BZ_ERROR", { message: "You're watching this one." });
    if (this.g.turnUid && this.g.turnUid !== uid)
      return this.send(ws, "BZ_ERROR", { message: "It's not your pick." });

    const col = Number(msg.col), row = Number(msg.row);
    if (!(col >= 0 && col < COLS && row >= 0 && row < ROWS))
      return this.send(ws, "BZ_ERROR", { message: "That isn't a cell on the board." });
    if (this.g.spent[col][row])
      return this.send(ws, "BZ_ERROR", { message: "That one's been played." });

    this.g.spent[col][row] = true;
    this.openCell(col, row, uid);
    await this.persist();
    this.pushState();
    await this.armAlarm();
  }

  openCell(col, row, byUid) {
    const cat = categoryById(this.g.cats[col].id);
    const clue = cat.clues[row];
    const value = valueAt(row, this.g.round);
    const rnd = rngFrom(this.g.seed + col * 31 + row * 7);
    const now = Date.now();
    const openAt = now + readingMs(clue.q);

    this.g.cell = {
      col, row, value, catId: cat.id, stage: "READING",
      q: clue.q, a: clue.a,
      options: optionsFor(clue, poolFor(cat), rnd),
      shownAt: now, openAt,
      deadline: openAt + NOBODY_MS,
      holder: null, wrongUids: [], buzzes: [], locked: {},
      aiBuzz: {}, aiKnew: {}, aiAnswerAt: null,
    };

    // Every computer decides now what it will do with this clue, and its
    // decision is a reaction time — the same number a thumb produces — so it
    // goes through exactly the same judging as a person's buzz, with no
    // branch anywhere asking which is which.
    for (const p of Object.values(this.g.players)) {
      if (!p.ai || p.watching) continue;
      const intent = aiIntent(p.aiLevel, rngFrom(this.g.seed ^ (col * 977) ^ (row * 131) ^ hashUid(p.uid)));
      if (!intent.buzz) continue;
      this.g.cell.aiBuzz[p.uid] = intent.reaction;
      this.g.cell.aiKnew[p.uid] = intent.knows;
    }

    const who = this.g.players[byUid]?.name || "Someone";
    this.log(`${who} takes ${this.g.cats[col].name} for $${value.toLocaleString()}.`);
  }

  /** The reading is over. Nothing wakes the room for this; it is a fact about a timestamp. */
  stageNow() {
    const c = this.g.cell;
    if (!c) return null;
    if (c.stage === "READING" && Date.now() >= c.openAt) {
      c.stage = "OPEN";
      c.deadline = c.openAt + NOBODY_MS;
    }
    return c.stage;
  }

  // -------------------------------------------------------------- the buzzer

  /**
   * A buzz.
   *
   * `msg.at` is when the browser says the button went down, already converted
   * to this room's clock by the skew the two of them measured. It is not
   * trusted — `judgeBuzz` clamps it to the moment the message actually
   * arrived, so the worst a modified client can do is be judged the way
   * arrival order would have judged it anyway, which is the whole of the
   * security here.
   *
   * The first buzz does not win. It opens a window, and the lowest reaction
   * inside that window wins — otherwise the clock stamp would be decoration
   * and the short cable would take every close call, which is the thing this
   * design exists to stop.
   */
  async buzz(ws, uid, msg) {
    if (this.g.phase !== "PLAYING" || !this.g.cell)
      return this.send(ws, "BZ_ERROR", { message: "There's nothing to buzz at." });
    const p = this.g.players[uid];
    if (!p || p.watching)
      return this.send(ws, "BZ_ERROR", { message: "You're watching this one." });
    if (!this.allow(uid))
      return this.send(ws, "BZ_ERROR", { message: "Slow down." });

    const c = this.g.cell;
    const arrivedAt = Date.now();
    const stage = this.stageNow();

    if (stage === "ANSWERING" || stage === "REVEAL")
      return this.send(ws, "BZ_ERROR", { message: "Too late — somebody has it." });
    if (c.wrongUids.includes(uid))
      return this.send(ws, "BZ_ERROR", { message: "You've had your go at this one." });
    if ((c.locked[uid] || 0) > arrivedAt)
      return this.send(ws, "BZ_ERROR", { message: "Locked out. Wait for the buzzers." });
    if (c.buzzes.some((b) => b.uid === uid)) return;

    const verdict = judgeBuzz({ stamp: msg.at, arrivedAt, openAt: c.openAt });
    if (!verdict.ok) {
      // The real rule, and worth having: a quarter of a second is exactly
      // long enough to lose the clue to somebody who waited.
      c.locked[uid] = verdict.lockedUntil;
      await this.persist();
      this.pushState();
      return this.send(ws, "BZ_ERROR", { message: verdict.why });
    }

    c.buzzes.push({ uid, reaction: verdict.reaction, arrivedAt, ok: true });
    p.buzzes += 1;
    if (p.bestReaction == null || verdict.reaction < p.bestReaction) p.bestReaction = verdict.reaction;

    if (c.stage !== "WINDOW") {
      c.stage = "WINDOW";
      c.deadline = arrivedAt + BUZZ_WINDOW_MS;
    }
    await this.persist();
    this.pushState();
    await this.armAlarm();
  }

  /**
   * The window shuts and the clue goes to the quickest reaction in it.
   *
   * Computers are folded in here rather than sending messages of their own:
   * one whose reaction landed inside this window was, as far as the board is
   * concerned, holding the button down at that moment.
   */
  async resolveWindow() {
    const c = this.g.cell;
    if (!c || c.stage !== "WINDOW") return;
    const cutoff = c.deadline;

    for (const [uid, reaction] of Object.entries(c.aiBuzz)) {
      const p = this.g.players[uid];
      if (!p || p.watching || c.wrongUids.includes(uid)) continue;
      if (c.buzzes.some((b) => b.uid === uid)) continue;
      const at = c.openAt + reaction;
      if (at > cutoff) continue;
      c.buzzes.push({ uid, reaction, arrivedAt: at, ok: true });
      p.buzzes += 1;
      if (p.bestReaction == null || reaction < p.bestReaction) p.bestReaction = reaction;
    }

    const win = winningBuzz(c.buzzes);
    if (!win) { c.stage = "OPEN"; c.deadline = c.openAt + NOBODY_MS; return; }

    c.holder = win.uid;
    c.reaction = win.reaction;
    c.buzzes = [];
    c.stage = "ANSWERING";
    c.deadline = Date.now() + ANSWER_MS;

    const p = this.g.players[win.uid];
    this.log(`${p?.name || "Somebody"} buzzed in at ${(win.reaction / 1000).toFixed(2)} seconds.`);

    if (p?.ai) {
      // A computer takes a moment to answer, because one that answered the
      // instant it buzzed would read as a lookup rather than a player.
      const think = aiIntent(p.aiLevel, rngFrom(this.g.seed ^ hashUid(p.uid) ^ c.col ^ (c.row << 4))).thinkMs || 1200;
      c.aiAnswerAt = Math.min(Date.now() + think, c.deadline - 200);
    } else {
      this.sendOptions(win.uid);
    }
  }

  // ------------------------------------------------------------- the answer

  /**
   * An answer, right or wrong.
   *
   * A wrong one costs what a right one pays and puts the clue back up for
   * whoever is left — which is what makes a blind buzz worth minus half the
   * value, and why guessing needs no special rule to punish it.
   */
  async answer(ws, uid, msg) {
    if (this.g.phase !== "PLAYING" || !this.g.cell)
      return this.send(ws, "BZ_ERROR", { message: "There's nothing to answer." });
    const c = this.g.cell;
    if (c.stage !== "ANSWERING" || c.holder !== uid)
      return this.send(ws, "BZ_ERROR", { message: "The clue isn't yours." });

    const choice = String(msg.choice ?? "");
    const picked = c.options.includes(choice) ? choice : c.options[Number(msg.choice)] ?? null;
    if (picked == null)
      return this.send(ws, "BZ_ERROR", { message: "That isn't one of the four." });

    await this.settle(uid, picked);
    await this.persist();
    this.pushState();
    await this.armAlarm();
  }

  async settle(uid, picked) {
    const c = this.g.cell;
    const p = this.g.players[uid];
    const right = picked != null && String(picked) === String(c.a);

    if (right) {
      p.money += c.value;
      p.right += 1;
      // Whoever answered last picks, exactly as on television.
      this.g.turnUid = uid;
      this.log(`${p.name} has it. $${c.value.toLocaleString()} — ${c.a}.`);
      this.broadcast("BZ_VERDICT", { uid, right: true, picked, answer: c.a, value: c.value, money: p.money });
      return this.reveal();
    }

    p.money -= c.value;
    p.wrong += 1;
    c.wrongUids.push(uid);
    c.holder = null;
    c.aiAnswerAt = null;
    this.log(picked == null
      ? `${p.name} ran out of time. That's $${c.value.toLocaleString()}.`
      : `${p.name} said ${picked}. That's $${c.value.toLocaleString()}.`);
    this.broadcast("BZ_VERDICT", { uid, right: false, picked, answer: null, value: c.value, money: p.money });

    // Anybody left who has not had a go? The buzzers reopen for them, and the
    // clock starts again from now — a reaction is measured from the moment
    // the buzzers opened, and they have just opened again.
    const left = Object.values(this.g.players).filter((q) =>
      !q.watching && !c.wrongUids.includes(q.uid));
    if (!left.length) return this.reveal();

    c.stage = "OPEN";
    c.openAt = Date.now();
    c.deadline = c.openAt + NOBODY_MS;
    c.buzzes = [];
    c.locked = {};
    // Fresh intentions for the reopened clue, from whoever is still eligible.
    const next = {};
    const knew = {};
    for (const [aiUid, reaction] of Object.entries(c.aiBuzz)) {
      if (c.wrongUids.includes(aiUid)) continue;
      next[aiUid] = reaction;
      knew[aiUid] = c.aiKnew[aiUid];
    }
    c.aiBuzz = next;
    c.aiKnew = knew;
  }

  reveal() {
    const c = this.g.cell;
    c.stage = "REVEAL";
    c.holder = null;
    c.aiAnswerAt = null;
    c.deadline = Date.now() + REVEAL_MS;
  }

  async closeCell() {
    const c = this.g.cell;
    if (!c) return;
    this.g.cell = null;
    if (this.boardDone()) { await this.finish(); return; }
    // Nobody got it, so the pick stays where it was.
    await this.persist();
    this.pushState();
  }

  boardDone() {
    return this.g.spent.every((col) => col.every(Boolean));
  }

  // -------------------------------------------------------------- the clock

  nextAiAt() {
    const c = this.g.cell;
    if (!c) return null;
    if (c.stage === "ANSWERING") return c.aiAnswerAt || null;
    if (c.stage !== "OPEN" && c.stage !== "READING") return null;
    const due = Object.entries(c.aiBuzz)
      .filter(([uid]) => !c.wrongUids.includes(uid) && !c.buzzes.some((b) => b.uid === uid))
      .map(([, reaction]) => c.openAt + reaction);
    return due.length ? Math.min(...due) : null;
  }

  cellDeadline() { return this.g.cell?.deadline || null; }

  async armAlarm() {
    if (!this.g) return;
    const when = [this.cellDeadline(), this.nextAiAt()].filter(Boolean);
    if (!when.length) {
      if (this.g.phase !== "PLAYING" && this.connected().size === 0)
        await this.state.storage.setAlarm(Date.now() + IDLE_SHUTDOWN_MS);
      return;
    }
    await this.state.storage.setAlarm(Math.max(Math.min(...when), Date.now() + 200));
  }

  async alarm() {
    if (!this.g) return;
    if (this.g.phase !== "PLAYING") {
      if (this.sockets().length === 0) {
        await this.state.storage.deleteAll();
        this.g = null;
      }
      return;
    }
    await this.tick();
  }

  /**
   * Everything the clock owes the board, in order, until nothing is overdue.
   * One alarm serves the whole room, so this has to be able to run several
   * stages in one wake-up — a window can shut and a computer can answer
   * inside the same quarter of a second.
   */
  async tick() {
    let guard = 0;
    let moved = false;
    while (this.g?.phase === "PLAYING" && guard++ < 8) {
      const c = this.g.cell;
      if (!c) break;
      const now = Date.now();
      this.stageNow();

      if (c.stage === "OPEN" && this.aiDue(now)) { await this.injectAi(now); moved = true; continue; }
      if (c.stage === "WINDOW" && now >= c.deadline) { await this.resolveWindow(); moved = true; continue; }
      if (c.stage === "ANSWERING" && c.aiAnswerAt && now >= c.aiAnswerAt) { await this.aiAnswers(); moved = true; continue; }
      if (c.stage === "ANSWERING" && now >= c.deadline) {
        // Ten seconds gone is a wrong answer. It has to be, or a player who
        // does not know simply never chooses and the clue never closes.
        await this.settle(c.holder, null);
        moved = true;
        continue;
      }
      if (c.stage === "OPEN" && now >= c.deadline) {
        this.log(`Nobody had it. The answer was ${c.a}.`);
        this.broadcast("BZ_VERDICT", { uid: null, right: false, picked: null, answer: c.a, value: c.value });
        this.reveal();
        moved = true;
        continue;
      }
      if (c.stage === "REVEAL" && now >= c.deadline) { await this.closeCell(); moved = true; continue; }
      break;
    }
    if (moved && this.g) { await this.persist(); this.pushState(); }
    if (this.g?.phase === "PLAYING") await this.armAlarm();
  }

  aiDue(now) {
    const c = this.g.cell;
    return Object.entries(c.aiBuzz).some(([uid, reaction]) =>
      !c.wrongUids.includes(uid) &&
      !c.buzzes.some((b) => b.uid === uid) &&
      now >= c.openAt + reaction);
  }

  /** A computer reaching the buzzer opens a window like anybody else. */
  async injectAi(now) {
    const c = this.g.cell;
    let first = null;
    for (const [uid, reaction] of Object.entries(c.aiBuzz)) {
      if (c.wrongUids.includes(uid)) continue;
      if (c.buzzes.some((b) => b.uid === uid)) continue;
      const at = c.openAt + reaction;
      if (at > now) continue;
      if (!first || at < first.at) first = { uid, reaction, at };
    }
    if (!first) return;
    const p = this.g.players[first.uid];
    c.buzzes.push({ uid: first.uid, reaction: first.reaction, arrivedAt: first.at, ok: true });
    p.buzzes += 1;
    if (p.bestReaction == null || first.reaction < p.bestReaction) p.bestReaction = first.reaction;
    c.stage = "WINDOW";
    c.deadline = now + BUZZ_WINDOW_MS;
  }

  async aiAnswers() {
    const c = this.g.cell;
    const p = this.g.players[c.holder];
    if (!p) return;
    const rnd = rngFrom(this.g.seed ^ hashUid(p.uid) ^ (c.col * 61) ^ (c.row * 17) ^ c.wrongUids.length);
    // A computer that gambled still answers, and can still be wrong — which
    // is most of what makes one feel like a person rather than a lookup.
    const picked = c.aiKnew[p.uid] ? c.a : c.options[Math.floor(rnd() * c.options.length)];
    await this.settle(p.uid, picked);
  }

  // ------------------------------------------------------------- the finish

  async finish() {
    if (this.g.phase !== "PLAYING") return;
    this.g.phase = "RESULTS";
    this.g.cell = null;
    await this.state.storage.deleteAlarm().catch(() => {});

    const field = Object.values(this.g.players).filter((p) => !p.watching);
    const ordered = standings(field);
    const ratings = Object.fromEntries(field.map((p) => [p.uid, p.mmrAtStart || 0]));
    const mode = field.length >= 3 ? "rumble" : "match";

    const results = ordered.map((p, i) => {
      const placement = i + 1;
      p.score = Math.min(100, Math.round(boardScore({
        placement, field: field.length, right: p.right, wrong: p.wrong, finished: true,
      })));

      const gain = sessionGain({
        score: p.score, completed: true,
        playerMmr: p.mmrAtStart || 0, fieldMmr: fieldMmrFor(p.uid, ratings),
        mode, seed: p.seed, placement,
      });
      p.boost = !!this.g.applied?.[p.uid];
      if (p.boost) gain.total = boosted(gain.total);
      const after = (p.mmrAtStart || 0) + gain.total;

      return {
        uid: p.uid, name: p.name, score: p.score, placement, seed: p.seed || null,
        status: "finished",
        elapsedMs: this.g.startedAt ? Date.now() - this.g.startedAt : null,
        solved: p.right,
        money: p.money, banked: bankable(p.money),
        right: p.right, wrong: p.wrong, buzzes: p.buzzes, bestReaction: p.bestReaction,
        spent: p.ars?.used && Object.keys(p.ars.used).length ? { ...p.ars.used } : undefined,
        mmrBefore: p.mmrAtStart || 0, gain: gain.total, boost: !!p.boost,
        breakdown: { base: gain.base, challenge: gain.challenge, completion: gain.completion, seed: gain.seed },
        mmrAfter: after, belt: beltFor(after).name,
        promoted: beltFor(after).name !== beltFor(p.mmrAtStart || 0).name,
      };
    });

    this.g.applied = {};
    for (const p of field) { p.ars = p.ars || { armed: {}, used: {} }; p.ars.used = {}; }

    // Before the broadcast and before the record, because it rewrites the
    // numbers in place and the two must not disagree.
    const bounty = await applyBounty(this.env, this.state, {
      mode, durationMs: Date.now() - (this.g.startedAt || Date.now() - 60_000), results,
    });

    await this.persist();
    this.log(`${ordered[0]?.name || "Nobody"} takes the board.`);
    this.broadcast("BZ_OVER", { results, mode, bounty });
    this.announce();
    this.pushState();

    const human = results.filter((r) => !this.isAi(r.uid));
    if (!human.length) return;

    // The two thousand floats: it is a stake, not a gift, so only what was
    // won above it ever reaches a wallet. A flat board banks nothing and a
    // bad one banks nothing rather than costing anybody.
    for (const r of human) {
      if (r.banked <= 0) continue;
      this.state.waitUntil?.(
        bankWallet(this.env, r.uid, r.banked, r.name)
          .then((ok) => { if (!ok) console.error("[buzzer] a wallet did not take its winnings"); })
          .catch((e) => console.error(`[buzzer] ${e.message}`))
      );
    }

    this.state.waitUntil?.(
      recordMatch(this.env, {
        code: this.g.code, roundNo: this.g.roundNo,
        puzzleId: `buzzer:${this.g.cats.map((c) => c.id).join(",")}`,
        game: "buzzer", mode,
        // The people are the rows, but the computers were at the podiums and
        // the placements already count them, so the field is the field.
        field: results.length,
        finishedAt: Date.now(), results: human,
      }).then((ok) => { if (!ok) console.error("[buzzer] results were not saved"); })
        .catch((e) => console.error(`[buzzer] ${e.message}`))
    );
  }

  // ------------------------------------------------------------------ leave

  async webSocketClose(ws) { await this.onGone(ws); }
  async webSocketError(ws) { await this.onGone(ws); }

  async onGone(ws) {
    if (!this.g) return;
    let who = null;
    try { who = ws.deserializeAttachment(); } catch { /* gone */ }

    const online = this.connected();
    if (who?.uid) online.delete(who.uid);

    if (who?.uid === this.g.hostUid && online.size > 0) {
      const heir = Object.values(this.g.players)
        .filter((p) => !p.ai && online.has(p.uid))
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (heir) this.g.hostUid = heir.uid;
    }

    // A board is not lost because somebody's phone went to sleep. The clue in
    // front of them keeps its clock, and if it was theirs the ten seconds run
    // out on it like anybody else's.
    if (online.size === 0 && this.g.phase !== "PLAYING") {
      await this.state.storage.setAlarm(Date.now() + IDLE_SHUTDOWN_MS);
    }
    await this.persist();
    this.announce();
    this.pushState();
  }
}

/**
 * Six columns of five, and each column its own array.
 *
 * `Array(6).fill(Array(5).fill(false))` puts the same array in all six slots,
 * so spending one cell spends that row in every category at once. It is worth
 * a named function purely so nobody writes that line again.
 */
function freshBoard() {
  return Array.from({ length: COLS }, () => Array(ROWS).fill(false));
}

/** A stable number from a uid, so a computer's draws differ from its neighbour's. */
function hashUid(uid) {
  let h = 0;
  for (let i = 0; i < String(uid).length; i++) h = (Math.imul(h, 31) + String(uid).charCodeAt(i)) | 0;
  return h >>> 0;
}
