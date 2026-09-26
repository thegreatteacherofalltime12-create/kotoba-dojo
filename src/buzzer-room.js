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
  judgeBuzz, winningBuzz, shuffle, rngFrom, optionsFor, MIN_REACTION_MS,
  boardScore, standings, bankable,
  AI_LEVELS, AI_MAX, AI_NAMES, aiLevelById, aiIntent,
  AVATARS, avatarById, freeAvatar, plantDoubles, wagerLimit, finalLimit, playsFinal, finalOrder,
} from "./buzzer.js";
import { CATEGORIES, SECTIONS, categoryById, poolFor } from "./buzzer-bank.js";
import { moderate } from "./moderation.js";
import { recordMatch, readRatings, bankWallet, strikePlayer } from "./firestore.js";
import { announceRoom } from "./rooms.js";
import { ARSENALS } from "./arsenals.js";
import { tokensReply, heldTokens } from "./boost.js";
import { applyBounty } from "./report-bounty.js";
import { sessionGain, fieldMmrFor, beltFor, boosted } from "./mmr.js";

const IDLE_SHUTDOWN_MS = 30 * 60_000;
// Pressing a buzzer is one event, and a person leaning on it is a handful.
// This is here to stop a script hammering the object, not to pace anybody —
// an early buzz is already punished by the lockout, which is the real rule.
const BUZZES_PER_SECOND = 6;
const BUZZ_BURST = 15;

// A Daily Double is a decision rather than a reflex, so it gets longer than
// a clue does — but not forever, because the rest of the table is watching
// somebody think.
const WAGER_MS = 20_000;
const FINAL_WAGER_MS = 30_000;
const FINAL_THINK_MS = 30_000;
const FINAL_REVEAL_MS = 12_000;

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
        // Where the Daily Doubles hide. Never leaves this object, and neither
        // does the seed it was drawn from — a seed a browser can read is a
        // board a browser can solve.
        doubles: [], turnUid: null, pickAt: null, cell: null,
        final: null, applied: {},
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
      // What the arsenal turned into for this board. Every one is applied by
      // the room at the first moment it can be, so an armed token is a token
      // spent rather than a button somebody has to remember to press.
      answerMs: ANSWER_MS, freeWrong: 0, deepPockets: false, insured: false,
      fastFinger: 0, twoFewer: 0, openBook: 0, cards: 0, nudges: 0,
      polish: 0, pointsFinish: false,
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
      avatars: AVATARS,
      taken: Object.values(this.g.players).map((p) => p.avatar).filter(Boolean),
      final: this.finalView(open),
      cell: c ? {
        col: c.col, row: c.row, value: c.value, stage: c.stage,
        catId: c.catId, q: c.q, dd: !!c.dd, wager: c.wager ?? null,
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
   * Final, as far as anyone is allowed to see it.
   *
   * The wagers are secret until they are all in — that is the whole shape of
   * the round — so what goes out is who has wagered rather than what they
   * wagered. The clue follows once everybody has committed, and the amounts
   * only at the reveal.
   */
  finalView(open = false) {
    const f = this.g.final;
    if (!f) return null;
    const showing = f.stage === "REVEAL" || open;
    return {
      stage: f.stage, catName: f.catName, scope: f.scope,
      q: f.stage === "CLUE" || showing ? f.q : null,
      answer: showing ? f.a : null,
      options: f.stage === "CLUE" || showing ? f.options : null,
      deadline: f.deadline,
      in: Object.keys(f.wagers || {}),
      answered: Object.keys(f.answers || {}),
      playing: f.playing || [],
      reveal: showing ? (f.reveal || []) : null,
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
    const p = this.g.players[uid];
    let options = c.options;
    // Two Fewer takes two of the wrong ones away, which turns one chance in
    // four into a coin toss. It is spent on the first clue it can be.
    if (p && p.twoFewer > 0) {
      p.twoFewer -= 1;
      const wrong = options.filter((o) => o !== c.a);
      options = shuffle([c.a, wrong[0]], rngFrom(this.g.seed ^ (c.col * 17) ^ c.row));
    }
    this.send(ws, "BZ_OPTIONS", {
      options, until: c.deadline, value: c.dd ? c.wager : c.value, dd: !!c.dd,
    });
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
        case "BZ_WAGER": return await this.wager(ws, who.uid, msg);
        case "BZ_AVATAR": return await this.setAvatar(ws, who.uid, msg);
        case "BZ_FINAL_WAGER": return await this.finalWager(ws, who.uid, msg);
        case "BZ_FINAL_ANSWER": return await this.finalAnswer(ws, who.uid, msg);
        case "TOKENS":
        case "APPLY_TOKEN": return await this.sendTokens(ws, who.uid, msg.type === "APPLY_TOKEN");
        case "ARM_TOKEN": return await this.arm(ws, who.uid, msg);
        case "DISARM_TOKEN": return await this.disarm(ws, who.uid, msg);
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

  /**
   * An avatar, taken before the lights go up. Two people cannot wear the
   * same one — the whole purpose is telling each other apart at a glance on
   * a shared screen, and two Oracles defeats it.
   */
  async setAvatar(ws, uid, msg) {
    if (this.g.phase === "PLAYING")
      return this.send(ws, "BZ_ERROR", { message: "Not once the board is up." });
    const want = String(msg.id || "");
    if (!avatarById(want)) return this.send(ws, "BZ_ERROR", { message: "No such avatar." });
    const taken = Object.values(this.g.players).some((p) => p.uid !== uid && p.avatar === want);
    if (taken) return this.send(ws, "BZ_ERROR", { message: "Somebody has that one already." });
    this.g.players[uid].avatar = want;
    await this.persist();
    this.pushState();
  }

  // ---------------------------------------------------------------- tokens

  arsOf(p) { p.ars = p.ars || { armed: {}, used: {} }; return p.ars; }

  arsenalView(p) {
    const armed = this.arsOf(p).armed || {};
    return Object.entries(ARSENALS.buzzer).map(([key, spec]) => ({
      key, name: spec.name, icon: spec.icon, max: spec.max || 99,
      armed: armed[key] || 0, on: true,
    }));
  }

  async sendTokens(ws, uid, apply, error = null) {
    const p = this.g.players[uid];
    const reply = await tokensReply(this.env, uid, "buzzer", {
      applied: this.g.applied || {}, over: this.g.phase !== "LOBBY", apply,
    });
    if (reply.changed) { this.g.applied = this.g.applied || {}; this.g.applied[uid] = true; await this.persist(); }
    this.send(ws, "BZ_TOKENS", { ...reply, error: error || reply.error, arsenal: this.arsenalView(p) });
  }

  async arm(ws, uid, msg) {
    const p = this.g.players[uid];
    if (this.g.phase !== "LOBBY")
      return this.sendTokens(ws, uid, false, "Tokens are armed before the board goes up.");
    const key = String(msg.key || "");
    const spec = ARSENALS.buzzer[key];
    if (!spec) return this.sendTokens(ws, uid, false, "No such token.");
    const held = await heldTokens(this.env, uid);
    const a = this.arsOf(p);
    const on = a.armed[key] || 0;
    if (on >= (spec.max || 99)) return this.sendTokens(ws, uid, false, `${spec.name} is capped at ${spec.max} a board.`);
    if ((held[key] || 0) <= on) return this.sendTokens(ws, uid, false, `You don't hold another ${spec.name}.`);
    a.armed[key] = on + 1;
    await this.persist();
    await this.sendTokens(ws, uid, false);
    this.pushState();
  }

  async disarm(ws, uid, msg) {
    const p = this.g.players[uid];
    if (this.g.phase !== "LOBBY")
      return this.sendTokens(ws, uid, false, "The board is already up.");
    const key = String(msg.key || "");
    const a = this.arsOf(p);
    if (!a.armed[key]) return this.sendTokens(ws, uid, false);
    a.armed[key] -= 1;
    if (!a.armed[key]) delete a.armed[key];
    await this.persist();
    await this.sendTokens(ws, uid, false);
    this.pushState();
  }

  /**
   * What the arsenal turns into, at the moment the board goes up.
   *
   * Every one is applied here rather than left as a button, because a token
   * you have to remember to press is a token half the table forgets. Only
   * what actually took hold is recorded as spent — a token that could not
   * bite stays armed and is not charged.
   */
  fitPlayer(p) {
    const a = this.arsOf(p);
    const used = {};
    const spend = (key, n = 1) => { used[key] = (used[key] || 0) + n; };
    const n = (key) => a.armed[key] || 0;

    if (n("bz_house")) { p.money = 2_500; spend("bz_house"); }
    if (n("bz_long")) { p.answerMs = 15_000; spend("bz_long", n("bz_long")); }
    if (n("bz_second")) { p.freeWrong = n("bz_second"); spend("bz_second", n("bz_second")); }
    if (n("bz_pockets")) { p.deepPockets = true; spend("bz_pockets", n("bz_pockets")); }
    if (n("bz_insure")) { p.insured = true; spend("bz_insure", n("bz_insure")); }
    if (n("bz_finger")) { p.fastFinger = 3 * n("bz_finger"); spend("bz_finger", n("bz_finger")); }
    if (n("bz_fewer")) { p.twoFewer = n("bz_fewer"); spend("bz_fewer", n("bz_fewer")); }
    if (n("bz_book")) { p.openBook = n("bz_book"); spend("bz_book", n("bz_book")); }
    if (n("bz_card")) { p.cards = n("bz_card"); spend("bz_card", n("bz_card")); }
    if (n("bz_nudge")) { p.nudges = n("bz_nudge"); spend("bz_nudge", n("bz_nudge")); }
    if (n("bz_polish")) { p.polish = 8 * n("bz_polish"); spend("bz_polish", n("bz_polish")); }
    if (n("bz_points")) { p.pointsFinish = true; spend("bz_points"); }

    a.used = used;
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
      p.answerMs = ANSWER_MS; p.freeWrong = 0; p.deepPockets = false; p.insured = false;
      p.fastFinger = 0; p.twoFewer = 0; p.openBook = 0; p.cards = 0; p.nudges = 0;
      p.polish = 0; p.pointsFinish = false;
      this.fitPlayer(p);
      // Anybody who never chose gets whatever is going, so nobody is a blank.
      if (!p.avatar) {
        p.avatar = freeAvatar(field.map((q) => q.avatar).filter(Boolean));
      }
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
    this.g.doubles = plantDoubles(1, this.g.seed);
    this.g.final = null;
    this.g.cell = null;
    this.g.used = [...new Set([...this.g.used, ...this.g.cats.map((c) => c.id)])];
    // Whoever the host is picks first; after that it is whoever answered last.
    this.g.turnUid = field.find((p) => !p.ai)?.uid || field[0]?.uid || null;
    this.schedulePick();

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

  /**
   * Hand the pick to somebody, and put a clock on it if that somebody is a
   * computer.
   *
   * A person is waited for indefinitely: it is their turn and the board is
   * theirs to take as long over as they like. A computer has to be woken up,
   * because nothing else will ever do it.
   */
  schedulePick() {
    this.g.pickAt = null;
    const p = this.g.players[this.g.turnUid];
    // Nobody has the pick, or whoever had it has gone: give it to anyone who
    // is actually here, or the board stops on an empty podium.
    if (!p || p.watching || (!p.ai && !this.connected().has(p.uid))) {
      const heir = Object.values(this.g.players).find((q) =>
        !q.watching && (q.ai || this.connected().has(q.uid)));
      this.g.turnUid = heir?.uid || null;
    }
    const who = this.g.players[this.g.turnUid];
    if (!who?.ai) return;
    // Long enough to read the board, short enough not to feel like a hang.
    const lvl = aiLevelById(who.aiLevel);
    this.g.pickAt = Date.now() + 900 + Math.round(1_600 * (1 - lvl.knows));
  }

  /**
   * A computer choosing a cell.
   *
   * It works down a column the way a person does rather than jumping about
   * the board, and it starts at the cheap end — which is both how the game is
   * usually played and how a board gets cleared without leaving awkward gaps.
   */
  async aiPick() {
    this.g.pickAt = null;
    const p = this.g.players[this.g.turnUid];
    if (!p?.ai || this.g.cell) return;

    const free = [];
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) if (!this.g.spent[col][row]) free.push({ col, row });
    }
    if (!free.length) return;

    const rnd = rngFrom(this.g.seed ^ hashUid(p.uid) ^ free.length);
    const stay = free.filter((f) => f.col === p.lastCol);
    const pool = stay.length && rnd() < 0.65 ? stay : free;
    const cheapest = Math.min(...pool.map((f) => f.row));
    const row = rnd() < 0.8 ? cheapest : pool[Math.floor(rnd() * pool.length)].row;
    const cell = shuffle(pool.filter((f) => f.row === row), rnd)[0] || pool[0];

    p.lastCol = cell.col;
    this.g.spent[cell.col][cell.row] = true;
    this.openCell(cell.col, cell.row, p.uid);
    await this.persist();
    this.pushState();
  }

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
    const dd = (this.g.doubles || []).some((d) => d.col === col && d.row === row);
    const picker = this.g.players[byUid];

    this.g.cell = {
      col, row, value, catId: cat.id,
      // A Daily Double belongs to whoever found it. Nobody buzzes, so it
      // opens on the wager rather than on a reading — the clue is not read
      // until the money is committed, which is what makes committing hard.
      dd, stage: dd ? "WAGER" : "READING",
      q: clue.q, a: clue.a,
      options: optionsFor(clue, poolFor(cat), rnd),
      shownAt: now, openAt: dd ? null : openAt,
      deadline: dd ? now + WAGER_MS : openAt + NOBODY_MS,
      holder: dd ? byUid : null, wager: null,
      wrongUids: [], buzzes: [], locked: {},
      aiBuzz: {}, aiKnew: {}, aiAnswerAt: null,
    };

    if (dd) {
      this.g.doubles = this.g.doubles.filter((d) => !(d.col === col && d.row === row));
      this.log(`${picker?.name || "Somebody"} has found a Daily Double.`);
      this.broadcast("BZ_DOUBLE", { uid: byUid, name: picker?.name || "Somebody", col, row });
      if (picker?.ai) {
        // A computer wagers what it is worth: a Rookie hedges, a Pro swings.
        const lvl = aiLevelById(picker.aiLevel);
        const cap = wagerLimit(picker.money, this.g.round, picker.deepPockets);
        const want = Math.round(cap * (0.25 + lvl.knows * 0.6));
        this.setWager(picker, want);
      }
      return;
    }

    // Every computer decides now what it will do with this clue, and its
    // decision is a reaction time — the same number a thumb produces — so it
    // goes through exactly the same judging as a person's buzz, with no
    // branch anywhere asking which is which.
    const bots = Object.values(this.g.players).filter((q) => q.ai && !q.watching).length;
    for (const p of Object.values(this.g.players)) {
      if (!p.ai || p.watching) continue;
      const intent = aiIntent(p.aiLevel, rngFrom(this.g.seed ^ (col * 977) ^ (row * 131) ^ hashUid(p.uid)), bots);
      if (!intent.buzz) continue;
      this.g.cell.aiBuzz[p.uid] = intent.reaction;
      this.g.cell.aiKnew[p.uid] = intent.knows;
    }

    // Open Book shows one clue's options before anybody may buzz, and the
    // Nudge says which category still hides a Daily Double. Both are
    // information rather than force, which is the only kind of token this
    // arsenal is allowed to sell.
    for (const q of Object.values(this.g.players)) {
      if (q.ai || q.watching) continue;
      const sock = this.socketFor(q.uid);
      if (!sock) continue;
      if (q.openBook > 0) {
        q.openBook -= 1;
        this.send(sock, "BZ_PEEK", { options: this.g.cell.options });
      }
      if (q.nudges > 0 && (this.g.doubles || []).length) {
        q.nudges -= 1;
        this.send(sock, "BZ_NUDGE", { catName: this.g.cats[this.g.doubles[0].col]?.name || "" });
      }
    }

    const who = this.g.players[byUid]?.name || "Someone";
    this.log(`${who} takes ${this.g.cats[col].name} for $${value.toLocaleString()}.`);
  }

  /**
   * A wager on a Daily Double, clamped to the ceiling.
   *
   * The ceiling is the larger of your own money and the top value on the
   * board, so a player who is behind — or under water — can still swing at
   * it. That is the entire function of the rule: it is the one thing on the
   * board that gets somebody out of a hole in a single clue.
   */
  async wager(ws, uid, msg) {
    const c = this.g.cell;
    if (!c || c.stage !== "WAGER" || c.holder !== uid)
      return this.send(ws, "BZ_ERROR", { message: "There's no wager to make." });
    this.setWager(this.g.players[uid], msg.amount);
    await this.persist();
    this.pushState();
    this.sendOptions(uid);
    await this.armAlarm();
  }

  setWager(p, amount) {
    const c = this.g.cell;
    const cap = wagerLimit(p.money, this.g.round, p.deepPockets);
    c.wager = Math.max(0, Math.min(cap, Math.round(Number(amount) || 0)));
    c.stage = "ANSWERING";
    c.openAt = Date.now();
    c.deadline = Date.now() + (p.ai ? 2_000 : p.answerMs || ANSWER_MS) + readingMs(c.q);
    if (p.ai) {
      const intent = aiIntent(p.aiLevel, rngFrom(this.g.seed ^ hashUid(p.uid) ^ c.col));
      c.aiKnew[p.uid] = intent.knows;
      c.aiAnswerAt = Date.now() + readingMs(c.q) + (intent.thinkMs || 1_200);
    }
    this.log(`${p.name} wagers $${c.wager.toLocaleString()}.`);
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

    // Fast Finger shaves a fraction off, and never below the floor: it buys
    // a sharper thumb, not a reaction no human could have had.
    let reaction = verdict.reaction;
    if (p.fastFinger > 0) { p.fastFinger -= 1; reaction = Math.max(MIN_REACTION_MS, reaction - 60); }
    c.buzzes.push({ uid, reaction, arrivedAt, ok: true });
    p.buzzes += 1;
    if (p.bestReaction == null || reaction < p.bestReaction) p.bestReaction = reaction;

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
    // A Daily Double is worth what was wagered on it, not what the cell said.
    const stake = c.dd ? (c.wager ?? 0) : c.value;

    if (right) {
      p.money += stake;
      p.right += 1;
      // Whoever answered last picks, exactly as on television.
      this.g.turnUid = uid;
      this.log(`${p.name} has it. $${stake.toLocaleString()} — ${c.a}.`);
      this.broadcast("BZ_VERDICT", { uid, right: true, picked, answer: c.a, value: stake, money: p.money });
      return this.reveal();
    }

    // Second Look eats the first wrong answer of a round outright; Insurance
    // halves a Daily Double that goes against you. Neither is a way to hurt
    // anybody else, which is the rule this arsenal is held to.
    let cost = stake;
    if (p.freeWrong > 0) { p.freeWrong -= 1; cost = 0; }
    else if (c.dd && p.insured) cost = Math.round(stake / 2);

    p.money -= cost;
    p.wrong += 1;
    c.wrongUids.push(uid);
    c.holder = null;
    c.aiAnswerAt = null;
    this.log(cost === 0
      ? `${p.name} was wrong, and a Second Look covers it.`
      : picked == null
        ? `${p.name} ran out of time. That's $${cost.toLocaleString()}.`
        : `${p.name} said ${picked}. That's $${cost.toLocaleString()}.`);
    this.broadcast("BZ_VERDICT", { uid, right: false, picked, answer: null, value: cost, money: p.money });

    // A Daily Double belongs to one player and nobody else may have it, so a
    // wrong one ends the clue there rather than reopening it.
    if (c.dd) return this.reveal();

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
    if (this.boardDone()) { await this.advanceRound(); return; }
    // Whoever answered last picks; if nobody did, it stays where it was. Then
    // the clock, because a computer will not pick unless it is woken.
    this.schedulePick();
    await this.persist();
    this.pushState();
    await this.armAlarm();
  }

  boardDone() {
    return this.g.spent.every((col) => col.every(Boolean));
  }

  /**
   * The first board is finished. The second doubles every value and brings
   * six categories nobody has seen; after that there is only Final.
   *
   * The round is kept a number and the phase carries Final, rather than
   * writing "FINAL" into the round. Values are worked out from the round, so
   * a round that is not a number is a board where every clue is worth NaN.
   */
  async advanceRound() {
    if (this.g.round === 1) {
      this.g.round = 2;
      this.g.spent = freshBoard();
      this.g.cats = this.drawCats(COLS);
      this.g.used = [...new Set([...this.g.used, ...this.g.cats.map((c) => c.id)])];
      this.g.doubles = plantDoubles(2, this.g.seed ^ 0x5eed);
      this.g.turnUid = standings(Object.values(this.g.players).filter((p) => !p.watching))
        .slice(-1)[0]?.uid || this.g.turnUid;
      // The second board hands the pick to whoever is last, which with three
      // computers on the podiums is nearly always a computer.
      this.schedulePick();
      await this.persist();
      this.log("The Double Board. Every value is twice what it was.");
      this.broadcast("BZ_ROUND", { round: 2, name: "The Double Board", cats: this.g.cats });
      this.announce();
      this.pushState();
      await this.armAlarm();
      return;
    }
    await this.startFinal();
  }

  /** Six categories this room has not played, or the freshest it can find. */
  drawCats(n) {
    const rnd = rngFrom((this.g.seed ^ 0xbeef) + this.g.round);
    const fresh = CATEGORIES.filter((c) => !this.g.used.includes(c.id));
    const draw = shuffle(fresh.length >= n ? fresh : CATEGORIES, rnd).slice(0, n);
    return draw.map((c) => ({ id: c.id, name: c.name }));
  }

  // ------------------------------------------------------------------ final

  /**
   * Final. The category is announced, everybody wagers in secret, then one
   * clue and the same four options for all of them at once.
   *
   * A player at or below zero sits it out. That is the real rule and the only
   * door that going under actually shuts — you may buzz, answer and claw your
   * way back all night, but if you are still under when the second board ends
   * the others play Final without you.
   */
  async startFinal() {
    const cat = this.drawCats(1)[0];
    const full = categoryById(cat.id);
    const clue = full.clues[ROWS - 1];
    const rnd = rngFrom(this.g.seed ^ 0xf1a1);
    const playing = Object.values(this.g.players).filter(playsFinal).map((p) => p.uid);

    this.g.phase = "FINAL";
    this.g.cell = null;
    this.g.final = {
      stage: "WAGER", catId: cat.id, catName: cat.name, scope: full.scope,
      q: clue.q, a: clue.a, options: optionsFor(clue, poolFor(full), rnd),
      wagers: {}, answers: {}, playing, reveal: [],
      deadline: Date.now() + FINAL_WAGER_MS,
    };
    this.g.used = [...new Set([...this.g.used, cat.id])];

    for (const uid of playing) {
      const p = this.g.players[uid];
      if (!p.ai) continue;
      // A computer wagers by how much of the board it knows, and never more
      // than it is holding.
      const lvl = aiLevelById(p.aiLevel);
      this.g.final.wagers[uid] = Math.round(finalLimit(p.money) * (0.3 + lvl.knows * 0.5));
    }

    await this.persist();
    this.log(`Final: ${cat.name}. Wagers, please.`);
    this.broadcast("BZ_FINAL", { stage: "WAGER", catName: cat.name, scope: full.scope, playing });
    this.announce();
    this.pushState();
    await this.armAlarm();
  }

  async finalWager(ws, uid, msg) {
    const f = this.g.final;
    if (!f || f.stage !== "WAGER")
      return this.send(ws, "BZ_ERROR", { message: "There's no wager to make." });
    if (!f.playing.includes(uid))
      return this.send(ws, "BZ_ERROR", { message: "You finished at or below zero, so Final isn't yours." });
    const p = this.g.players[uid];
    f.wagers[uid] = Math.max(0, Math.min(finalLimit(p.money), Math.round(Number(msg.amount) || 0)));
    await this.persist();
    this.pushState();
    if (f.playing.every((u) => f.wagers[u] != null)) await this.finalClue();
    else await this.armAlarm();
  }

  async finalClue() {
    const f = this.g.final;
    if (!f || f.stage !== "WAGER") return;
    for (const uid of f.playing) if (f.wagers[uid] == null) f.wagers[uid] = 0;
    f.stage = "CLUE";
    f.deadline = Date.now() + readingMs(f.q) + FINAL_THINK_MS;
    for (const uid of f.playing) {
      const p = this.g.players[uid];
      if (!p.ai) continue;
      const intent = aiIntent(p.aiLevel, rngFrom(this.g.seed ^ hashUid(uid) ^ 0xfaded));
      f.answers[uid] = intent.knows ? f.a : f.options[Math.floor(rngFrom(hashUid(uid))() * f.options.length)];
    }
    await this.persist();
    this.log("Wagers are in. Here is the clue.");
    this.broadcast("BZ_FINAL", { stage: "CLUE", q: f.q, options: f.options, until: f.deadline });
    this.pushState();
    await this.armAlarm();
  }

  async finalAnswer(ws, uid, msg) {
    const f = this.g.final;
    if (!f || f.stage !== "CLUE")
      return this.send(ws, "BZ_ERROR", { message: "There's nothing to answer." });
    if (!f.playing.includes(uid))
      return this.send(ws, "BZ_ERROR", { message: "Final isn't yours this time." });
    const picked = f.options.includes(msg.choice) ? msg.choice : null;
    if (picked == null) return this.send(ws, "BZ_ERROR", { message: "That isn't one of the four." });
    f.answers[uid] = picked;
    await this.persist();
    this.pushState();
    if (f.playing.every((u) => f.answers[u] != null)) await this.revealFinal();
    else await this.armAlarm();
  }

  /**
   * Answers revealed lowest score first, exactly as the show does it. It puts
   * the person who can still win last, so the game is decided on the final
   * card rather than three cards ago.
   */
  async revealFinal() {
    const f = this.g.final;
    if (!f || f.stage === "REVEAL") return;
    f.stage = "REVEAL";

    const order = finalOrder(f.playing.map((uid) => this.g.players[uid]));
    f.reveal = order.map((p) => {
      const wager = f.wagers[p.uid] || 0;
      const picked = f.answers[p.uid] || null;
      const right = picked != null && String(picked) === String(f.a);
      p.money += right ? wager : -wager;
      if (right) p.right += 1; else p.wrong += 1;
      return { uid: p.uid, name: p.name, wager, picked, right, money: p.money };
    });

    f.deadline = Date.now() + FINAL_REVEAL_MS;
    await this.persist();
    this.log(`The answer was ${f.a}. ${f.reveal.filter((r) => r.right).length} of ${f.reveal.length} had it.`);
    this.broadcast("BZ_FINAL", { stage: "REVEAL", answer: f.a, reveal: f.reveal });
    this.pushState();
    await this.armAlarm();
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

  /** When a computer is due to choose its cell, if one is. */
  nextPickAt() { return this.g.cell ? null : (this.g.pickAt || null); }

  async armAlarm() {
    if (!this.g) return;
    const when = [this.cellDeadline(), this.nextAiAt(), this.nextPickAt(), this.g.final?.deadline].filter(Boolean);
    if (!when.length) {
      if (this.g.phase === "LOBBY" && this.connected().size === 0)
        await this.state.storage.setAlarm(Date.now() + IDLE_SHUTDOWN_MS);
      return;
    }
    await this.state.storage.setAlarm(Math.max(Math.min(...when), Date.now() + 200));
  }

  async alarm() {
    if (!this.g) return;
    if (this.g.phase === "FINAL") { await this.finalTick(); return; }
    if (this.g.phase !== "PLAYING") {
      if (this.sockets().length === 0) {
        await this.state.storage.deleteAll();
        this.g = null;
      }
      return;
    }
    await this.tick();
  }

  /** Final runs on its own three deadlines: wager, think, then the reveal. */
  async finalTick() {
    const f = this.g.final;
    if (!f || Date.now() < f.deadline) { await this.armAlarm(); return; }
    if (f.stage === "WAGER") return await this.finalClue();
    if (f.stage === "CLUE") return await this.revealFinal();
    if (f.stage === "REVEAL") return await this.finish();
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
      const now = Date.now();
      if (!c) {
        // No clue on the board. The only thing that can be owed is a
        // computer's pick.
        if (this.g.pickAt && now >= this.g.pickAt) { await this.aiPick(); moved = true; continue; }
        break;
      }
      this.stageNow();

      // A wager nobody makes is the clue's own value, which is what the show
      // does with a contestant who freezes.
      if (c.stage === "WAGER" && now >= c.deadline) {
        this.setWager(this.g.players[c.holder], c.value);
        moved = true;
        continue;
      }
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
      // Points Finish scores a board you left as though you had stayed;
      // Podium Polish is eight points on top of whatever it came to.
      p.score = Math.min(100, Math.round(boardScore({
        placement, field: field.length, right: p.right, wrong: p.wrong,
        finished: !p.gone || !!p.pointsFinish,
      }) + (p.polish || 0)));

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
    // A board does not stop because the player whose turn it was closed the
    // tab. The pick moves to somebody who is still here.
    if (this.g.phase === "PLAYING" && who?.uid === this.g.turnUid && !this.g.cell) {
      this.schedulePick();
      await this.armAlarm();
    }

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
