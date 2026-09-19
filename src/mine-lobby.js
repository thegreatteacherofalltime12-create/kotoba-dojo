import {
  LEVELS, levelById, makeBoard, reveal, openingFor, progressOf,
  mineScore, isMine, ROUND_CAP_MS,
} from "./minesweeper.js";
import { recordMatch, readRatings } from "./firestore.js";
import { boosted } from "./mmr.js";
import { tokensReply } from "./boost.js";
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
        endsAt: this.g.endsAt, serverNow: Date.now(),
      });
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
        progress: Math.round((Object.keys(p.revealed).length / total) * 100),
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
        case "APPLY_TOKEN": {
          this.g.applied = this.g.applied || {};
          const reply = await tokensReply(this.env, who.uid, "minesweeper", {
            applied: this.g.applied, over: false, apply: msg.type === "APPLY_TOKEN",
          });
          if (reply.changed) await this.persist();
          return this.send(ws, "MINE_TOKENS", reply);
        }
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
    if (this.board.counts[cell] === undefined && !isMine(this.board, cell))
      return this.send(ws, "MINE_ERROR", { message: "That square isn't on the board." });
    if (p.flags.includes(cell)) return;

    const res = reveal(this.board, p.revealed, cell);
    if (res.hitMine) {
      p.revealed[cell] = -1;
      p.done = true;
      p.won = false;
      p.finishedAt = Date.now() - this.g.startedAt;
      p.score = mineScore({ won: false, progress: progressOf(this.board, p.revealed), level: this.g.level });
      this.send(ws, "MINE_BOOM", { cell, mines: this.board.mineList, score: p.score });
      this.broadcast("MINE_OUT", { uid, name: p.name, score: p.score });
    } else {
      Object.assign(p.revealed, res.cells);
      this.send(ws, "MINE_DUG", { cells: res.cells });
      if (res.won) {
        p.done = true; p.won = true;
        p.finishedAt = Date.now() - this.g.startedAt;
        p.score = mineScore({ won: true, progress: 1, elapsedMs: p.finishedAt, level: this.g.level });
        this.broadcast("MINE_CLEARED", { uid, name: p.name, elapsedMs: p.finishedAt, score: p.score });
      }
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
      list.push({ uid: p.uid, name: p.name, ms: p.finishedAt, at: Date.now() });
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
