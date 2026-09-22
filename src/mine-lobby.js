import {
  LEVELS, levelById, makeBoard, reveal, openingFor, progressOf,
  mineScore, isMine, ROUND_CAP_MS,
  MINE_ARSENAL, CLEAR_SPAN, SHIELD_MS, BUSTER_LEVELS, bustBoard, areaCells,
  GLOVES_DIGS, DRONE_PICKS, FLAG_PICKS, DEMO_PICKS, RECON_SPAN, WATCH_MS, HAZARD_LIFT, NEXT_LEVEL,
  minesIn, around, lineCells, quadrants, frontierMines, safeSquares, nearestMines, chordCells, bestOpening,
} from "./minesweeper.js";
import { recordMatch, readRatings } from "./firestore.js";
import { boosted } from "./mmr.js";
import { tokensReply, heldTokens } from "./boost.js";
import { announceRoom } from "./rooms.js";
import { applyBounty } from "./report-bounty.js";
import { sessionGain, fieldMmrFor, beltFor } from "./mmr.js";

const IDLE_SHUTDOWN_MS = 30 * 60_000;
// Sweeping is click-heavy and a fast player on a big board is legitimate, so
// the ceiling is generous — it exists to stop a script hammering the object,
// not to pace anyone.
const CLICKS_PER_SECOND = 25;
const CLICK_BURST = 60;

// One instance per field. Everyone races the same layout independently, which
// is the crossword's shape rather than Battleship's — nobody takes turns.
export class MineField {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.buckets = new Map();
    state.blockConcurrencyWhile(async () => {
      const got = await state.storage.get(["game", "board"]);
      this.g = got.get("game") || null;
      this.board = got.get("board") || null;
    });
  }

  persist() { return this.state.storage.put({ game: this.g, board: this.board }); }
  sockets() { return this.state.getWebSockets(); }

  send(ws, type, payload = {}) {
    try { ws.send(JSON.stringify({ type, ...payload })); } catch { /* gone */ }
  }

  broadcast(type, payload = {}) {
    const msg = JSON.stringify({ type, ...payload });
    for (const ws of this.sockets()) { try { ws.send(msg); } catch { /* gone */ } }
  }


  /** Register this room so a code entered on the home screen can find it. */
  /**
   * Keeps this room on the open board while it waits.
   *
   * The directory drops any row it hasn't heard from in ninety seconds, and a
   * lobby sitting empty announces nothing — so a room that nobody had joined
   * yet quietly fell off the list, which is exactly when being listed matters.
   * Throttled, because every connected client sends one of these.
   */
  beat() {
    const now = Date.now();
    if (now - (this.lastBeat || 0) < 20_000) return;
    this.lastBeat = now;
    this.announce();
  }

  announce() {
    if (!this.g) return;
    announceRoom(this.env, this.state, {
      game: "minesweeper",
      code: this.g.code,
      host: this.g.players[this.g.hostUid]?.name || "Someone",
      players: this.connected().size,
      phase: this.g.phase,
      label: this.g.solo ? "Solo" : levelById(this.g.level).name,
      round: this.g.round,
    });
  }

  connected() {
    const out = new Set();
    for (const ws of this.sockets()) {
      try { const a = ws.deserializeAttachment(); if (a?.uid) out.add(a.uid); } catch { /* gone */ }
    }
    return out;
  }

  // ------------------------------------------------------------- connections

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("This endpoint speaks WebSocket only.", { status: 426 });

    const uid = request.headers.get("X-Dojo-Uid");
    const name = request.headers.get("X-Dojo-Name") || "Sweeper";
    const code = request.headers.get("X-Dojo-Code") || "mines";
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
        code, phase: "LOBBY", hostUid: uid,
        solo: false, level: "beginner",
        players: {}, startedAt: null, endsAt: null, round: 0,
      };
    }

    const p = this.g.players[uid];
    if (p) p.name = name;
    else {
      this.g.players[uid] = {
        uid, name, joinedAt: Date.now(),
        // Someone arriving mid-race watches this one out, as in the dojo.
        watching: this.g.phase === "ACTIVE",
        revealed: {}, flags: [], done: false, won: false, score: 0, finishedAt: null,
        ars: this.freshArs(),
      };
    }

    await this.persist();
    this.announce();
    this.send(ws, "MINE_WELCOME", { you: uid, isHost: this.g.hostUid === uid, levels: LEVELS });
    this.pushState();

    // Reconnecting mid-race gets the board back exactly as it was left.
    const me = this.g.players[uid];
    if (this.g.phase === "ACTIVE" && !me.watching && !me.done) {
      this.send(ws, "MINE_RESUME", {
        shape: this.shape(), revealed: me.revealed, flags: me.flags,
        craters: this.arsOf(me).busted, endsAt: this.g.endsAt, serverNow: Date.now(),
      });
      this.send(ws, "MINE_ARSENAL_STATE", { arsenal: this.arsenalView(me) });
    }

    await this.state.storage.deleteAlarm().catch(() => {});
    if (this.g.phase === "ACTIVE" && this.g.endsAt) await this.state.storage.setAlarm(this.g.endsAt);
  }

  /** Size and mine count only — never where anything is. */
  shape() {
    const l = levelById(this.g.level);
    return { level: l.id, name: l.name, rows: l.rows, cols: l.cols, mines: l.mines };
  }

  publicState() {
    const online = this.connected();
    const total = this.board?.safeTotal || 1;
    return {
      code: this.g.code, phase: this.g.phase, hostUid: this.g.hostUid,
      solo: !!this.g.solo, level: this.g.level, levels: LEVELS,
      shape: this.shape(), endsAt: this.g.endsAt, round: this.g.round,
      players: Object.values(this.g.players).map((p) => ({
        uid: p.uid, name: p.name, online: online.has(p.uid),
        watching: !!p.watching, done: !!p.done, won: !!p.won,
        score: p.score,
        // Progress is public; which squares they opened is not, or the board
        // could be reconstructed by watching someone else play it.
        progress: Math.round((Object.values(p.revealed).filter((v) => v >= 0).length / total) * 100),
      })),
    };
  }

  pushState() { this.broadcast("MINE_STATE", { game: this.publicState() }); }

  // ---------------------------------------------------------------- messages

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const who = ws.deserializeAttachment();
    if (!who?.uid || !this.g) return;

    try {
      switch (msg.type) {
        case "PING": return this.beat();
        case "MINE_SOLO":  return await this.setSolo(ws, who.uid, msg);
        case "MINE_LEVEL": return await this.setLevel(ws, who.uid, msg);
        case "MINE_START": return await this.start(ws, who.uid);
        case "MINE_DIG":   return await this.dig(ws, who.uid, msg);
        case "MINE_FLAG":  return await this.flag(ws, who.uid, msg);
        case "TOKENS":
        case "APPLY_TOKEN":  return await this.sendTokens(ws, who.uid, msg.type === "APPLY_TOKEN");
        case "ARM_TOKEN":    return await this.arm(ws, who.uid, msg);
        case "DISARM_TOKEN": return await this.disarm(ws, who.uid, msg);
        case "MINE_ARSENAL": return await this.arsenal(ws, who.uid, msg);
        case "MINE_END_MATCH": {
          // finish() already pays everyone still sweeping on the ground they
          // uncovered, so ending early needs no scoring of its own.
          if (who.uid !== this.g.hostUid)
            return this.send(ws, "MINE_ERROR", { message: "Only the host can end the match." });
          if (this.g.phase !== "ACTIVE")
            return this.send(ws, "MINE_ERROR", { message: "No round is running." });
          return await this.finish();
        }
        default: return this.send(ws, "MINE_ERROR", { message: "Unrecognised message." });
      }
    } catch (err) {
      this.send(ws, "MINE_ERROR", { message: String(err?.message || err) });
    }
  }

  hostOnly(ws, uid) {
    if (uid !== this.g.hostUid) { this.send(ws, "MINE_ERROR", { message: "Only the host sets this." }); return false; }
    if (this.g.phase === "ACTIVE") { this.send(ws, "MINE_ERROR", { message: "A round is already running." }); return false; }
    return true;
  }

  async setSolo(ws, uid, msg) {
    if (!this.hostOnly(ws, uid)) return;
    this.g.solo = !!msg.on;
    await this.persist();
    this.pushState();
  }

  async setLevel(ws, uid, msg) {
    if (!this.hostOnly(ws, uid)) return;
    if (LEVELS.some((l) => l.id === msg.level)) this.g.level = msg.level;
    await this.persist();
    this.pushState();
  }

  async start(ws, uid) {
    if (uid !== this.g.hostUid)
      return this.send(ws, "MINE_ERROR", { message: "Only the host starts the round." });
    if (this.g.phase === "ACTIVE")
      return this.send(ws, "MINE_ERROR", { message: "A round is already running." });

    const online = this.connected();
    if (!this.g.solo && online.size < 2)
      return this.send(ws, "MINE_ERROR", { message: "Wait for at least one more sweeper." });
    if (!online.size)
      return this.send(ws, "MINE_ERROR", { message: "Nobody is here." });

    this.board = makeBoard(this.g.level);
    if (!this.board) return this.send(ws, "MINE_ERROR", { message: "Couldn't lay a fair board. Try again." });

    const opening = openingFor(this.board);
    const uids = [...online];

    let ratings = Object.fromEntries(uids.map((u) => [u, 0]));
    try { ratings = await readRatings(this.env, uids); } catch { /* unranked */ }
    const seeded = [...uids].sort((a, b) => (ratings[b] || 0) - (ratings[a] || 0));

    for (const p of Object.values(this.g.players)) {
      const playing = online.has(p.uid);
      p.watching = !playing;
      p.revealed = playing ? { ...opening } : {};
      p.flags = [];
      p.done = false; p.won = false; p.score = 0; p.finishedAt = null;
      const a = this.arsOf(p);
      a.used = {}; a.busted = []; a.invincibleUntil = 0; a.digs = 0;
      a.gloves = 0; a.second = false; a.watch = 0; a.hazard = 0; a.promo = false; a.intel = [];
      p.mmrAtStart = ratings[p.uid] || 0;
      if (this.g.applied?.[p.uid] && !((ratings.boosts?.[p.uid]?.minesweeper || 0) > 0)) delete this.g.applied[p.uid];
      p.seed = seeded.indexOf(p.uid) + 1 || null;
    }

    const now = Date.now();
    this.g.phase = "ACTIVE";
    this.g.round += 1;
    this.g.startedAt = now;
    this.g.endsAt = now + ROUND_CAP_MS;

    await this.persist();
    await this.state.storage.setAlarm(this.g.endsAt);

    this.announce();
    this.broadcast("MINE_START", {
      shape: this.shape(), opening, endsAt: this.g.endsAt, serverNow: now, round: this.g.round,
    });
    for (const ws2 of this.sockets()) {
      let u = null;
      try { u = ws2.deserializeAttachment()?.uid; } catch { /* gone */ }
      const p = u && this.g.players[u];
      if (p) this.send(ws2, "MINE_ARSENAL_STATE", { arsenal: this.arsenalView(p) });
    }
    this.pushState();
  }

  // ── the arsenal ──────────────────────────────────────────────────
  //
  // Mine Reveal shows two mines; Mine Buster makes a square safe, mine or
  // not; Clear Map opens a 5x5 before you have dug anything, and is a gamble;
  // Invincibility makes the next ten seconds free of explosions. Each is
  // limited per round, only what is used is spent, and a busted mine is
  // gone for that player only — the shared board never changes.
  freshArs() {
    return {
      armed: {}, used: {}, busted: [], invincibleUntil: 0, digs: 0,
      gloves: 0,        // mines the gloves will still defuse
      second: false,    // a sweep that carries on past one mine
      watch: 0,         // seconds off the clock when the round is scored
      hazard: 0,        // what a lost sweep is lifted by
      promo: false,     // scored one level up
      intel: [],        // what the scouts have reported, newest first
    };
  }
  arsOf(p) { return p.ars || (p.ars = this.freshArs()); }
  armedLeft(p, key) { const a = this.arsOf(p); return (a.armed[key] || 0) - (a.used[key] || 0); }
  useToken(p, key) { const a = this.arsOf(p); a.used[key] = (a.used[key] || 0) + 1; }
  invincible(p) { return Date.now() < (this.arsOf(p).invincibleUntil || 0); }
  boardOf(p) {
    const a = this.arsOf(p);
    if (!a.busted.length) return this.board;
    this.boards = this.boards || new Map();
    const hit = this.boards.get(p.uid);
    if (hit && hit.n === a.busted.length && hit.base === this.board) return hit.board;
    const board = bustBoard(this.board, a.busted);
    this.boards.set(p.uid, { n: a.busted.length, base: this.board, board });
    return board;
  }
  arsenalView(p) {
    const a = this.arsOf(p);
    return {
      on: true, armed: a.armed, used: a.used,
      max: Object.fromEntries(Object.entries(MINE_ARSENAL).map(([k, v]) => [k, v.max || 99])),
      level: this.g.level, canBust: BUSTER_LEVELS.includes(this.g.level),
      digs: a.digs, invincibleUntil: a.invincibleUntil || 0, serverNow: Date.now(),
      clearSpan: CLEAR_SPAN, shieldMs: SHIELD_MS, reconSpan: RECON_SPAN,
      gloves: a.gloves || 0, second: !!a.second, watch: a.watch || 0,
      hazard: a.hazard || 0, promo: !!a.promo, intel: (a.intel || []).slice(0, 4),
      rows: this.board?.rows || 0, cols: this.board?.cols || 0,
    };
  }

  async sendTokens(ws, uid, apply, error = null) {
    this.g.applied = this.g.applied || {};
    const reply = await tokensReply(this.env, uid, "minesweeper", {
      applied: this.g.applied, over: false, apply,
    });
    if (reply.changed) await this.persist();
    const p = this.g.players[uid];
    this.send(ws, "MINE_TOKENS", { ...reply, error: error || reply.error, arsenal: p ? this.arsenalView(p) : null });
  }

  async arm(ws, uid, msg) {
    const p = this.g.players[uid];
    if (!p) return;
    const key = String(msg.key || "");
    const spec = MINE_ARSENAL[key];
    if (!spec) return this.sendTokens(ws, uid, false, "No such token.");
    const a = this.arsOf(p);
    if (spec.max && (a.armed[key] || 0) >= spec.max) return this.sendTokens(ws, uid, false, `${spec.max} ${spec.name} is the limit for one round.`);
    if (key === "ms_buster" && !BUSTER_LEVELS.includes(this.g.level)) return this.sendTokens(ws, uid, false, "Mine Buster works on Intermediate and Expert fields only.");
    const held = (await heldTokens(this.env, uid))[key] || 0;
    if (held <= (a.armed[key] || 0)) return this.sendTokens(ws, uid, false, `You hold no more ${spec.name} tokens. The Token shop sells them.`);
    a.armed[key] = (a.armed[key] || 0) + 1;
    await this.persist();
    await this.sendTokens(ws, uid, false);
  }

  async disarm(ws, uid, msg) {
    const p = this.g.players[uid];
    if (!p) return;
    const key = String(msg.key || "");
    const a = this.arsOf(p);
    if (this.armedLeft(p, key) <= 0) return this.sendTokens(ws, uid, false, "Nothing to put back.");
    a.armed[key] -= 1;
    if (!a.armed[key]) delete a.armed[key];
    await this.persist();
    await this.sendTokens(ws, uid, false);
  }

  /** The player's sweep ends on a mine. Shared by a dig and a Clear Map that finds one. */
  /** The level a player's round is scored at — a promotion lifts it one. */
  levelFor(p) { return this.arsOf(p).promo ? NEXT_LEVEL[this.g.level] || this.g.level : this.g.level; }

  /** A clear time, with whatever the stopwatches took off it. */
  clockFor(p, ms) { return Math.max(0, ms - (this.arsOf(p).watch || 0)); }

  boom(ws, p, cell) {
    const a = this.arsOf(p);
    // A Second Sweep spends itself here: the mine is defused under you and
    // the sweep goes on from where it stood.
    if (a.second) {
      a.second = false;
      a.busted.push(cell);
      const board = this.boardOf(p);
      const res = reveal(board, p.revealed, cell);
      this.opened(p, res);
      this.send(ws, "MINE_DUG", { cells: res.cells, craters: [cell] });
      this.send(ws, "MINE_NOTE", { text: "Second Sweep: that one is defused. Carry on." });
      return;
    }
    p.revealed[cell] = -1;
    p.done = true;
    p.won = false;
    p.finishedAt = Date.now() - this.g.startedAt;
    const progress = Math.min(1, progressOf(this.boardOf(p), p.revealed) + (a.hazard || 0));
    p.score = mineScore({ won: false, progress, level: this.levelFor(p) });
    this.send(ws, "MINE_BOOM", { cell, mines: this.boardOf(p).mineList, score: p.score });
    this.broadcast("MINE_OUT", { uid: p.uid, name: p.name, score: p.score });
  }

  /** A clean reveal that may finish the round for the player. */
  opened(p, res) {
    Object.assign(p.revealed, res.cells);
    if (res.won) {
      p.done = true; p.won = true;
      p.finishedAt = Date.now() - this.g.startedAt;
      p.score = mineScore({ won: true, progress: 1, elapsedMs: this.clockFor(p, p.finishedAt), level: this.levelFor(p) });
      this.broadcast("MINE_CLEARED", { uid: p.uid, name: p.name, elapsedMs: p.finishedAt, score: p.score });
    }
  }

  async arsenal(ws, uid, msg) {
    if (this.g.phase !== "ACTIVE" || !this.board) return this.send(ws, "MINE_ERROR", { message: "No round is running." });
    const p = this.g.players[uid];
    if (!p || p.watching || p.done) return;
    const action = String(msg.action || "");
    const key = {
      reveal: "ms_reveal", buster: "ms_buster", clear: "ms_clear", shield: "ms_shield",
      detect: "ms_detect", radar: "ms_radar", quad: "ms_quad", drone: "ms_drone", flags: "ms_flags",
      gloves: "ms_gloves", second: "ms_second", recon: "ms_recon", demo: "ms_demo",
      opening: "ms_opening", chord: "ms_chord", watch: "ms_watch", hazard: "ms_hazard", promo: "ms_promo",
    }[action];
    if (!key) return this.send(ws, "MINE_ERROR", { message: "Unrecognised action." });
    if (this.armedLeft(p, key) <= 0) return this.send(ws, "MINE_ERROR", { message: `No ${MINE_ARSENAL[key].name} armed. Arm one under Apply Token.` });
    const a = this.arsOf(p);
    const board = this.boardOf(p);
    const cell = String(msg.cell || "");
    const onBoard = (x) => board.counts[x] !== undefined || isMine(board, x);

    // ── the scouts ──────────────────────────────────────────────
    const note = (text) => { a.intel = [{ text, at: Date.now() }, ...(a.intel || [])].slice(0, 8); this.send(ws, "MINE_NOTE", { text }); };
    const onBoardCell = (x) => board.counts[x] !== undefined || isMine(board, x);

    if (action === "detect") {
      if (!onBoardCell(cell)) return this.send(ws, "MINE_ERROR", { message: "That square isn't on the board." });
      const area = [cell, ...around(board, cell)];
      const n = minesIn(board, area);
      this.useToken(p, key);
      note(`Metal Detector at ${cell}: ${n} mine${n === 1 ? "" : "s"} in those nine squares.`);
    } else if (action === "radar") {
      const line = lineCells(board, msg.line);
      if (!line.length) return this.send(ws, "MINE_ERROR", { message: "Pick a row or a column." });
      const n = minesIn(board, line);
      this.useToken(p, key);
      const label = String(msg.line)[0] === "r" ? `Row ${Number(String(msg.line).slice(1)) + 1}` : `Column ${Number(String(msg.line).slice(1)) + 1}`;
      note(`Radar Sweep \u2014 ${label}: ${n} mine${n === 1 ? "" : "s"}.`);
    } else if (action === "quad") {
      this.useToken(p, key);
      note("Quadrant Scan \u2014 " + quadrants(board).map((q) => `${q.name} ${q.mines}`).join(", ") + ".");
    } else if (action === "drone") {
      const picks = safeSquares(board, p.revealed, p.flags).slice(0, DRONE_PICKS);
      if (!picks.length) return this.send(ws, "MINE_ERROR", { message: "Nothing left for the drone to find." });
      this.useToken(p, key);
      a.digs += 1;
      const cells = {};
      for (const x of picks) { cells[x] = board.counts[x]; p.revealed[x] = board.counts[x]; }
      this.opened(p, { cells: {}, won: Object.values(p.revealed).filter((v) => v >= 0).length >= board.safeTotal });
      p.flags = p.flags.filter((f) => !picks.includes(f));
      this.send(ws, "MINE_DUG", { cells });
      note(`Spotter Drone: ${picks.length} safe square${picks.length === 1 ? "" : "s"} opened.`);
    } else if (action === "flags") {
      const picks = frontierMines(board, p.revealed).filter((m) => !p.flags.includes(m)).slice(0, FLAG_PICKS);
      if (!picks.length) return this.send(ws, "MINE_ERROR", { message: "No mine touches ground you have opened yet." });
      this.useToken(p, key);
      p.flags.push(...picks);
      this.send(ws, "MINE_FLAGS", { cells: picks });
      note(`Frontier Flags: ${picks.length} mine${picks.length === 1 ? "" : "s"} flagged.`);
    } else if (action === "gloves") {
      a.gloves = (a.gloves || 0) + GLOVES_DIGS;
      this.useToken(p, key);
      note(`Sapper's Gloves: the next ${a.gloves} mines you dig are defused.`);
    } else if (action === "second") {
      if (a.second) return this.send(ws, "MINE_ERROR", { message: "A Second Sweep is already lined up." });
      a.second = true;
      this.useToken(p, key);
      note("Second Sweep: one mine will not end you.");
    } else if (action === "recon") {
      if (!onBoardCell(cell)) return this.send(ws, "MINE_ERROR", { message: "That square isn't on the board." });
      const area = areaCells(cell, RECON_SPAN, board.rows, board.cols);
      const mines = area.filter((x) => isMine(board, x) && !p.flags.includes(x));
      this.useToken(p, key);
      a.digs += 1;
      p.flags.push(...mines);
      const cells = {};
      for (const x of area) {
        if (p.revealed[x] !== undefined || isMine(board, x)) continue;
        const res = reveal(board, p.revealed, x);
        Object.assign(cells, res.cells);
        Object.assign(p.revealed, res.cells);
      }
      this.opened(p, { cells: {}, won: Object.values(p.revealed).filter((v) => v >= 0).length >= board.safeTotal });
      if (mines.length) this.send(ws, "MINE_FLAGS", { cells: mines });
      this.send(ws, "MINE_DUG", { cells });
      note(`Recon Patrol: ${Object.keys(cells).length} squares opened, ${mines.length} mine${mines.length === 1 ? "" : "s"} flagged.`);
    } else if (action === "demo") {
      if (!onBoardCell(cell)) return this.send(ws, "MINE_ERROR", { message: "That square isn't on the board." });
      const picks = nearestMines(board, cell, DEMO_PICKS);
      if (!picks.length) return this.send(ws, "MINE_ERROR", { message: "No mines left to destroy." });
      this.useToken(p, key);
      a.busted.push(...picks);
      p.flags = p.flags.filter((f) => !picks.includes(f));
      const b2 = this.boardOf(p);
      const cells = {};
      for (const x of picks) { cells[x] = b2.counts[x]; p.revealed[x] = b2.counts[x]; }
      this.opened(p, { cells: {}, won: Object.values(p.revealed).filter((v) => v >= 0).length >= b2.safeTotal });
      this.send(ws, "MINE_DUG", { cells, craters: picks });
      note(`Demolition Charge: ${picks.length} mines destroyed.`);
    } else if (action === "opening") {
      if (a.digs > 0) return this.send(ws, "MINE_ERROR", { message: "Lucky Opening only works before you have dug anything." });
      const start = bestOpening(board);
      const res = reveal(board, p.revealed, start);
      this.useToken(p, key);
      Object.assign(p.revealed, res.cells);
      this.opened(p, { cells: {}, won: res.won });
      this.send(ws, "MINE_DUG", { cells: res.cells });
      note(`Lucky Opening: ${Object.keys(res.cells).length} squares from the biggest clearing on the field.`);
    } else if (action === "chord") {
      const picks = chordCells(board, p.revealed, p.flags, cell);
      if (!picks.length) {
        // Two different noes: the flags do not add up, or they do and there
        // is simply nothing left around that number to open.
        const n = p.revealed[cell];
        const near = around(board, cell);
        const matched = n > 0 && near.filter((x) => p.flags.includes(x)).length === n;
        return this.send(ws, "MINE_ERROR", { message: matched
          ? "Nothing left to open around that number."
          : "That number’s flags don’t match it yet." });
      }
      this.useToken(p, key);
      a.digs += 1;
      const cells = {};
      let hit = null;
      for (const x of picks) {
        if (isMine(board, x)) { hit = x; break; }
        const res = reveal(board, p.revealed, x);
        Object.assign(cells, res.cells);
        Object.assign(p.revealed, res.cells);
      }
      if (Object.keys(cells).length) this.send(ws, "MINE_DUG", { cells });
      if (hit) {
        if (a.gloves > 0) {
          a.gloves -= 1;
          a.busted.push(hit);
          const b2 = this.boardOf(p);
          p.revealed[hit] = b2.counts[hit];
          this.send(ws, "MINE_DUG", { cells: { [hit]: b2.counts[hit] }, craters: [hit] });
          note("Chord found a mine \u2014 the gloves took it.");
        } else if (this.invincible(p)) {
          a.busted.push(hit);
          const b2 = this.boardOf(p);
          p.revealed[hit] = b2.counts[hit];
          this.send(ws, "MINE_DUG", { cells: { [hit]: b2.counts[hit] }, craters: [hit] });
          note("Chord found a mine \u2014 defused.");
        } else {
          this.boom(ws, p, hit);
        }
      } else {
        this.opened(p, { cells: {}, won: Object.values(p.revealed).filter((v) => v >= 0).length >= board.safeTotal });
        note(`Chord: ${Object.keys(cells).length} squares opened.`);
      }
    } else if (action === "watch") {
      a.watch = (a.watch || 0) + WATCH_MS;
      this.useToken(p, key);
      note(`Stopwatch: ${Math.round(a.watch / 1000)} seconds off your clear time when this round is scored.`);
    } else if (action === "hazard") {
      a.hazard = Math.min(0.5, (a.hazard || 0) + HAZARD_LIFT);
      this.useToken(p, key);
      note(`Hazard Pay: a sweep ended by a mine scores as ${Math.round(a.hazard * 100)}% more ground uncovered.`);
    } else if (action === "promo") {
      if (a.promo) return this.send(ws, "MINE_ERROR", { message: "You are already playing up a level." });
      a.promo = true;
      this.useToken(p, key);
      note(`Field Promotion: this round is scored as ${NEXT_LEVEL[this.g.level]}.`);
    } else if (action === "shield") {
      a.invincibleUntil = Date.now() + SHIELD_MS;
      this.useToken(p, key);
      this.send(ws, "MINE_SHIELD", { until: a.invincibleUntil, serverNow: Date.now() });
      this.send(ws, "MINE_NOTE", { text: "Invincible for ten seconds. Dig anything." });
    } else if (action === "reveal") {
      const unknown = board.mineList.filter((m) => p.revealed[m] === undefined);
      const pool = unknown.filter((m) => !p.flags.includes(m));
      const from = pool.length >= 2 ? pool : unknown;
      const picks = [...from].sort(() => Math.random() - 0.5).slice(0, 2);
      if (!picks.length) return this.send(ws, "MINE_ERROR", { message: "Every mine is already known." });
      const cells = {};
      for (const m of picks) { p.revealed[m] = -3; cells[m] = -3; }
      this.useToken(p, key);
      this.send(ws, "MINE_DUG", { cells });
      this.send(ws, "MINE_NOTE", { text: `Mine Reveal: ${picks.length} mine${picks.length === 1 ? "" : "s"} shown.` });
    } else if (action === "buster") {
      if (!BUSTER_LEVELS.includes(this.g.level)) return this.send(ws, "MINE_ERROR", { message: "Mine Buster works on Intermediate and Expert fields only." });
      if (!onBoard(cell)) return this.send(ws, "MINE_ERROR", { message: "That square isn't on the board." });
      if (p.revealed[cell] !== undefined) return this.send(ws, "MINE_ERROR", { message: "That square is already open." });
      p.flags = p.flags.filter((f) => f !== cell);
      this.useToken(p, key);
      a.digs += 1;
      let craters = [];
      if (isMine(board, cell)) { a.busted.push(cell); craters = [cell]; }
      const b2 = this.boardOf(p);
      const res = reveal(b2, p.revealed, cell);
      this.opened(p, res);
      this.send(ws, "MINE_DUG", { cells: res.cells, craters });
      this.send(ws, "MINE_NOTE", { text: craters.length ? "Mine Buster: a mine was there. It's gone." : "Mine Buster: no mine there. The square is open." });
    } else if (action === "clear") {
      if (a.digs > 0) return this.send(ws, "MINE_ERROR", { message: "Clear Map only works before you have dug anything." });
      if (!onBoard(cell)) return this.send(ws, "MINE_ERROR", { message: "That square isn't on the board." });
      const area = areaCells(cell, CLEAR_SPAN, board.rows, board.cols);
      const mines = area.filter((x) => isMine(board, x));
      this.useToken(p, key);
      a.digs += 1;
      if (mines.length && !this.invincible(p)) {
        this.boom(ws, p, mines[0]);
        this.send(ws, "MINE_NOTE", { text: `Clear Map found a mine at ${mines[0]}.` });
      } else {
        let craters = [];
        if (mines.length) { a.busted.push(...mines); craters = mines; }
        const b2 = this.boardOf(p);
        const cells = {};
        let won = false;
        for (const x of area) {
          if (p.revealed[x] !== undefined) continue;
          const res = reveal(b2, p.revealed, x);
          Object.assign(cells, res.cells);
          Object.assign(p.revealed, res.cells);
          won = won || res.won;
        }
        this.opened(p, { cells: {}, won });
        this.send(ws, "MINE_DUG", { cells, craters });
        this.send(ws, "MINE_NOTE", { text: craters.length ? `Clear Map: ${Object.keys(cells).length} squares open, ${craters.length} mine${craters.length === 1 ? "" : "s"} defused.` : `Clear Map: ${Object.keys(cells).length} squares open.` });
      }
    }

    await this.persist();
    this.send(ws, "MINE_ARSENAL_STATE", { arsenal: this.arsenalView(p) });
    const live = Object.values(this.g.players).filter((x) => !x.watching && !x.done);
    if (!live.length) { await this.finish(); return; }
    this.pushState();
  }

  allow(uid) {
    const now = Date.now();
    const b = this.buckets.get(uid) || { tokens: CLICK_BURST, last: now };
    b.tokens = Math.min(CLICK_BURST, b.tokens + ((now - b.last) / 1000) * CLICKS_PER_SECOND);
    b.last = now;
    if (b.tokens < 1) { this.buckets.set(uid, b); return false; }
    b.tokens -= 1;
    this.buckets.set(uid, b);
    return true;
  }

  async dig(ws, uid, msg) {
    if (this.g.phase !== "ACTIVE" || !this.board) return;
    const p = this.g.players[uid];
    if (!p || p.watching || p.done) return;
    if (!this.allow(uid)) return this.send(ws, "MINE_ERROR", { message: "Slow down." });

    const cell = String(msg.cell || "");
    let board = this.boardOf(p);
    if (board.counts[cell] === undefined && !isMine(board, cell))
      return this.send(ws, "MINE_ERROR", { message: "That square isn't on the board." });
    if (p.flags.includes(cell)) return;
    if (p.revealed[cell] !== undefined) return;
    const a = this.arsOf(p);
    a.digs += 1;

    let craters = [];
    if (isMine(board, cell) && (this.invincible(p) || a.gloves > 0)) {
      // Defused under your feet, by the shield or by the gloves, and the
      // ground opens. The shield goes first: it is running either way.
      if (!this.invincible(p)) a.gloves -= 1;
      a.busted.push(cell);
      craters = [cell];
      board = this.boardOf(p);
    }
    const res = reveal(board, p.revealed, cell);
    if (res.hitMine) {
      this.boom(ws, p, cell);
    } else {
      this.opened(p, res);
      this.send(ws, "MINE_DUG", { cells: res.cells, craters });
      if (craters.length) this.send(ws, "MINE_NOTE", { text: this.invincible(p) ? "Defused. Invincibility held." : "Defused. The gloves took it." });
    }

    await this.persist();
    const live = Object.values(this.g.players).filter((x) => !x.watching && !x.done);
    if (!live.length) { await this.finish(); return; }
    this.pushState();
  }

  async flag(ws, uid, msg) {
    if (this.g.phase !== "ACTIVE") return;
    const p = this.g.players[uid];
    if (!p || p.watching || p.done) return;
    const cell = String(msg.cell || "");
    if (p.revealed[cell] !== undefined) return;
    const at = p.flags.indexOf(cell);
    if (at === -1) p.flags.push(cell); else p.flags.splice(at, 1);
    await this.persist();
    this.send(ws, "MINE_FLAGGED", { cell, on: at === -1 });
  }

  /**
   * Best clear times, kept per difficulty. These live in KV rather than
   * Firestore because they need no account and no service key — and they're
   * written here, from the object that timed the round, not from a client.
   *
   * KV is eventually consistent and last-write-wins, which is fine for a
   * board of ten: a simultaneous finish elsewhere might cost one entry, and
   * nothing else depends on it.
   */
  async recordHighScores(cleared) {
    if (!this.env.PUZZLES || !cleared.length) return;
    const key = `scores:mines:${this.g.level}`;
    let list = [];
    try { list = (await this.env.PUZZLES.get(key, "json")) || []; } catch { return; }

    for (const p of cleared) {
      list.push({
        uid: p.uid, name: p.name, ms: p.finishedAt, at: Date.now(),
        // A reveal, a buster or a stopwatch makes a fast clear easier, so
        // the row carries the fact rather than the board pretending.
        assisted: Object.values(p.ars?.used || {}).some((n) => n > 0),
      });
    }
    // One entry per player: their best, not every run they ever made.
    const best = new Map();
    for (const row of list) {
      const held = best.get(row.uid);
      if (!held || row.ms < held.ms) best.set(row.uid, row);
    }
    const top = [...best.values()].sort((a, b) => a.ms - b.ms).slice(0, 10);
    try { await this.env.PUZZLES.put(key, JSON.stringify(top)); } catch { /* not fatal */ }
  }

  async finish() {
    if (this.g.phase !== "ACTIVE") return;
    this.g.phase = "RESULTS";
    await this.state.storage.deleteAlarm().catch(() => {});

    for (const p of Object.values(this.g.players)) {
      if (p.watching || p.done) continue;
      p.done = true; p.won = false;
      p.score = mineScore({ won: false, progress: progressOf(this.board, p.revealed), level: this.g.level });
    }

    const field = Object.values(this.g.players).filter((p) => !p.watching);
    const ordered = [...field].sort((a, z) =>
      (z.won ? 1 : 0) - (a.won ? 1 : 0) ||
      z.score - a.score ||
      (a.finishedAt ?? Infinity) - (z.finishedAt ?? Infinity));

    const ratings = Object.fromEntries(field.map((p) => [p.uid, p.mmrAtStart || 0]));
    const mode = field.length >= 3 ? "rumble" : "match";

    const results = ordered.map((p, i) => {
      const placement = i + 1;
      const gain = sessionGain({
        score: p.score, completed: !!p.won,
        playerMmr: p.mmrAtStart || 0, fieldMmr: fieldMmrFor(p.uid, ratings),
        mode, seed: p.seed, placement,
      });
      p.boost = !!this.g.applied?.[p.uid];
      if (p.boost) gain.total = boosted(gain.total);
      const after = (p.mmrAtStart || 0) + gain.total;
      return {
        uid: p.uid, name: p.name, score: p.score, placement, seed: p.seed || null,
        status: p.won ? "cleared" : "sunk", elapsedMs: p.finishedAt,
        spent: p.ars?.used && Object.keys(p.ars.used).length ? { ...p.ars.used } : undefined,
        mmrBefore: p.mmrAtStart || 0, gain: gain.total, boost: !!p.boost,
        breakdown: { base: gain.base, challenge: gain.challenge, completion: gain.completion, seed: gain.seed },
        mmrAfter: after, belt: beltFor(after).name,
        promoted: beltFor(after).name !== beltFor(p.mmrAtStart || 0).name,
      };
    });

    this.g.applied = {};
    const bounty = await applyBounty(this.env, this.state, {
      mode, durationMs: Date.now() - (this.g.startedAt || Date.now() - 60_000), results,
    });

    // Used tokens are spent by the record; what was armed and unused stays armed.
    for (const p of field) {
      const a = this.arsOf(p);
      for (const [k, n] of Object.entries(a.used)) { a.armed[k] = Math.max(0, (a.armed[k] || 0) - n); if (!a.armed[k]) delete a.armed[k]; }
      a.used = {};
    }
    await this.persist();
    this.broadcast("MINE_OVER", { results, mode, bounty, mines: this.board.mineList });
    this.pushState();

    const cleared = field.filter((p) => p.won && p.finishedAt != null);
    this.state.waitUntil?.(
      this.recordHighScores(cleared)
        .then(() => this.broadcast("MINE_SCORES_STALE", {}))
        .catch(() => {})
    );

    this.state.waitUntil?.(
      recordMatch(this.env, {
        code: this.g.code, roundNo: this.g.round, puzzleId: `mines:${this.g.level}`,
        game: "minesweeper", mode,
        finishedAt: Date.now(), results,
      }).then((ok) => { if (!ok) console.error(`[minesweeper] results were not saved`); }).catch((e) => console.error(`[minesweeper] ${e.message}`))
    );
  }

  async alarm() {
    if (this.g?.phase === "ACTIVE" && Date.now() >= (this.g.endsAt || 0)) { await this.finish(); return; }
    if (this.sockets().length === 0) {
      await this.state.storage.deleteAll();
      this.g = null; this.board = null;
    }
  }

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
        .filter((p) => online.has(p.uid))
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (heir) this.g.hostUid = heir.uid;
    }

    await this.persist();
    this.pushState();
    this.announce();

    if (online.size === 0 && this.g.phase !== "ACTIVE")
      await this.state.storage.setAlarm(Date.now() + IDLE_SHUTDOWN_MS);
  }
}
