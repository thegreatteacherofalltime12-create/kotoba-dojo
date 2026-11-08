import { recordMatch, readRatings } from "./firestore.js";
import { sessionGain, fieldMmrFor, beltFor } from "./mmr.js";
import { moderate } from "./moderation.js";
import { announceRoom } from "./rooms.js";

const GAME_NAME = "Arrow Puzzle Tap Away";

// ── puzzle sizes ───────────────────────────────────────────────────────
const SIZE_2D = 5;   // 5×5 flat grid
const SIZE_3D = 4;   // 4×4×4 cube

// ── direction helpers ──────────────────────────────────────────────────
const DIRS_2D = ["up", "down", "left", "right"];
const DIRS_3D = ["+x", "-x", "+y", "-y", "+z", "-z"];

function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Is the path from (r,c) in dir to the grid edge clear of occupied cells? */
function pathClear2D(occ, r, c, dir, size) {
  if (dir === "up")    for (let i = r - 1; i >= 0; i--)    { if (occ.has(`${i},${c}`)) return false; }
  if (dir === "down")  for (let i = r + 1; i < size; i++)  { if (occ.has(`${i},${c}`)) return false; }
  if (dir === "left")  for (let j = c - 1; j >= 0; j--)    { if (occ.has(`${r},${j}`)) return false; }
  if (dir === "right") for (let j = c + 1; j < size; j++)  { if (occ.has(`${r},${j}`)) return false; }
  return true;
}

function pathClear3D(occ, x, y, z, dir, size) {
  const key = (a, b, c) => `${a},${b},${c}`;
  if (dir === "+x") for (let i = x + 1; i < size; i++) { if (occ.has(key(i, y, z))) return false; }
  if (dir === "-x") for (let i = x - 1; i >= 0; i--)  { if (occ.has(key(i, y, z))) return false; }
  if (dir === "+y") for (let i = y + 1; i < size; i++) { if (occ.has(key(x, i, z))) return false; }
  if (dir === "-y") for (let i = y - 1; i >= 0; i--)  { if (occ.has(key(x, i, z))) return false; }
  if (dir === "+z") for (let i = z + 1; i < size; i++) { if (occ.has(key(x, y, i))) return false; }
  if (dir === "-z") for (let i = z - 1; i >= 0; i--)  { if (occ.has(key(x, y, i))) return false; }
  return true;
}

/** Generate a solvable 2D puzzle by reverse construction. */
function gen2D(size = SIZE_2D) {
  const occ = new Set();
  const blocks = [];
  const cells = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) cells.push([r, c]);
  shuffle(cells);
  for (const [r, c] of cells) {
    const dirs = shuffle([...DIRS_2D]);
    for (const dir of dirs) {
      if (pathClear2D(occ, r, c, dir, size)) {
        const id = blocks.length;
        blocks.push({ id, row: r, col: c, dir });
        occ.add(`${r},${c}`);
        break;
      }
    }
  }
  return blocks;
}

/** Generate a solvable 3D puzzle by reverse construction. */
function gen3D(size = SIZE_3D) {
  const occ = new Set();
  const blocks = [];
  const cells = [];
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++)
      for (let z = 0; z < size; z++) cells.push([x, y, z]);
  shuffle(cells);
  for (const [x, y, z] of cells) {
    const dirs = shuffle([...DIRS_3D]);
    for (const dir of dirs) {
      if (pathClear3D(occ, x, y, z, dir, size)) {
        const id = blocks.length;
        blocks.push({ id, x, y, z, dir });
        occ.add(`${x},${y},${z}`);
        break;
      }
    }
  }
  return blocks;
}

/** Can this block be tapped right now? */
function canTap(blocks, blockId, dim, size) {
  const block = blocks.find((b) => b.id === blockId);
  if (!block) return false;
  if (dim === 2) {
    const occ = new Set(blocks.filter((b) => b.id !== blockId).map((b) => `${b.row},${b.col}`));
    return pathClear2D(occ, block.row, block.col, block.dir, size);
  }
  const occ = new Set(blocks.filter((b) => b.id !== blockId).map((b) => `${b.x},${b.y},${b.z}`));
  return pathClear3D(occ, block.x, block.y, block.z, block.dir, size);
}

// ── Durable Object ─────────────────────────────────────────────────────
export class ArrowPuzzle {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      this.g = (await state.storage.get("arrow")) || null;
    });
  }

  blank(code) {
    return {
      code, phase: "LOBBY",
      dim: 2,            // 2 = 2D puzzle, 3 = 3D puzzle (host sets in lobby)
      visual: "2d",      // default visual mode (each client can override)
      mode: "race",      // "race" | "turns" | "collab" | "solo"
      level: "easy",     // how many free blocks are shown glowing: easy all, medium 45%, hard none
      hostUid: null,
      roundNo: 0,
      players: {},       // uid → { uid, name, done, score, board (race) }
      order: [],
      shared: null,      // current blocks for turns/collab/solo
      initialBlocks: [], // the seed puzzle sent to all clients
      turn: null,        // whose turn (turns mode)
      scores: {},        // uid → number
      feed: [],
      chat: [],
      startedAt: 0,
    };
  }

  liveUids() {
    const out = new Set();
    for (const ws of this.state.getWebSockets()) {
      try { const a = ws.deserializeAttachment(); if (a?.uid) out.add(a.uid); } catch { /* gone */ }
    }
    return out;
  }

  humans() { return this.g.order.map((u) => this.g.players[u]).filter(Boolean); }

  canStart(uid) {
    const g = this.g;
    if (!g || !g.players[uid]) return false;
    if (!g.hostUid || g.hostUid === uid) return true;
    return !this.liveUids().has(g.hostUid);
  }

  // ── start ──────────────────────────────────────────────────────────
  async start(ws, uid, msg = {}) {
    const g = this.g;
    if (!g || g.phase === "PLAYING") return;
    if (!this.canStart(uid)) return this.send(ws, "AP_REJECT", { why: "Only the host can start." });
    if (this.humans().length === 0) return this.send(ws, "AP_REJECT", { why: "No players." });

    // Apply lobby settings from the host
    if (msg.mode && ["race", "turns", "collab", "solo"].includes(msg.mode)) g.mode = msg.mode;
    if (msg.dim && [2, 3].includes(Number(msg.dim))) g.dim = Number(msg.dim);
    if (msg.visual && ["2d", "3d"].includes(msg.visual)) g.visual = msg.visual;
    if (msg.level && ["easy", "medium", "hard"].includes(msg.level)) g.level = msg.level;

    if (g.mode === "solo" && this.humans().length !== 1)
      return this.send(ws, "AP_REJECT", { why: "Solo is a one-player mode." });
    if (g.mode === "race" && this.humans().length < 2)
      g.mode = "solo"; // graceful fallback if alone

    const size = g.dim === 3 ? SIZE_3D : SIZE_2D;
    const blocks = g.dim === 3 ? gen3D(size) : gen2D(size);
    g.initialBlocks = blocks;

    g.scores = {};
    for (const p of this.humans()) {
      g.scores[p.uid] = 0;
      if (g.mode === "race") {
        // Each player gets their own copy of the puzzle
        g.players[p.uid].board = blocks.map((b) => ({ ...b }));
        g.players[p.uid].done = false;
      }
    }

    if (g.mode !== "race") {
      g.shared = blocks.map((b) => ({ ...b }));
    } else {
      g.shared = null;
    }

    if (g.mode === "turns") {
      g.turn = g.order.find((u) => g.players[u]);
    }

    g.phase = "PLAYING";
    g.startedAt = Date.now();
    g.roundNo += 1;
    g.feed = [];

    this.logEvent(
      g.mode === "race" ? "Race! Same puzzle for each player — first to clear all blocks wins." :
      g.mode === "turns" ? "Turn-based: alternate taps, one point per block cleared." :
      g.mode === "collab" ? "Collaborative: work together to clear the board." :
      "Solo puzzle. Tap to clear all blocks."
    );

    await this.save();
    this.pushAll();
    this.broadcast("AP_START", {});
  }

  // ── tap ────────────────────────────────────────────────────────────
  async onTap(ws, uid, msg) {
    const g = this.g;
    if (!g || g.phase !== "PLAYING") return;
    const p = g.players[uid];
    if (!p) return;

    const blockId = Number(msg.id);
    const size = g.dim === 3 ? SIZE_3D : SIZE_2D;

    if (g.mode === "race") {
      if (p.done) return;
      const board = p.board;
      if (!canTap(board, blockId, g.dim, size))
        return this.send(ws, "AP_REJECT", { why: "That block cannot be tapped yet." });
      const idx = board.findIndex((b) => b.id === blockId);
      board.splice(idx, 1);
      g.scores[uid] = (g.scores[uid] || 0) + 1;
      this.send(ws, "AP_TAPPED", { id: blockId, board });
      if (board.length === 0) {
        p.done = true;
        this.logEvent(`${p.name} cleared the board!`);
        await this.save();
        this.pushAll();
        // If all players done, finish
        if (this.humans().every((h) => h.done)) return void await this.finish("all-done");
        return;
      }
    } else if (g.mode === "turns") {
      if (g.turn !== uid)
        return this.send(ws, "AP_REJECT", { why: "It's not your turn." });
      if (!canTap(g.shared, blockId, g.dim, size))
        return this.send(ws, "AP_REJECT", { why: "That block cannot be tapped yet." });
      const idx = g.shared.findIndex((b) => b.id === blockId);
      g.shared.splice(idx, 1);
      g.scores[uid] = (g.scores[uid] || 0) + 1;
      // Advance turn
      const living = g.order.filter((u) => g.players[u]);
      const ti = living.indexOf(uid);
      g.turn = living[(ti + 1) % living.length];
      this.broadcast("AP_TAPPED", { id: blockId, by: uid });
      if (g.shared.length === 0) {
        this.logEvent("Board cleared!");
        await this.save();
        this.pushAll();
        return void await this.finish("all-done");
      }
    } else {
      // collab or solo
      if (!canTap(g.shared, blockId, g.dim, size))
        return this.send(ws, "AP_REJECT", { why: "That block cannot be tapped yet." });
      const idx = g.shared.findIndex((b) => b.id === blockId);
      g.shared.splice(idx, 1);
      g.scores[uid] = (g.scores[uid] || 0) + 1;
      this.broadcast("AP_TAPPED", { id: blockId, by: uid });
      if (g.shared.length === 0) {
        const name = g.players[uid]?.name || "Someone";
        this.logEvent(g.mode === "solo" ? "Puzzle cleared!" : `${name} cleared the last block!`);
        await this.save();
        this.pushAll();
        return void await this.finish("all-done");
      }
    }

    await this.save();
    this.pushAll();
  }

  // ── finish ─────────────────────────────────────────────────────────
  async finish(reason) {
    const g = this.g;
    if (!g || g.phase === "OVER") return;
    g.phase = "OVER";

    const people = this.humans();
    const sortedScores = [...people].sort((a, b) => (g.scores[b.uid] || 0) - (g.scores[a.uid] || 0));
    let ratings = {};
    try { ratings = await readRatings(this.env, people.map((p) => p.uid)); } catch { /* unranked */ }

    const results = sortedScores.map((p, i) => {
      const score = g.scores[p.uid] || 0;
      const placement = i + 1;
      const gain = sessionGain({
        score: score * 10,
        completed: true,
        playerMmr: ratings[p.uid] || 0,
        fieldMmr: fieldMmrFor(p.uid, ratings),
        mode: "match", seed: 1, placement,
      });
      const after = (ratings[p.uid] || 0) + gain.total;
      return {
        uid: p.uid, name: p.name,
        score, placement,
        mmrBefore: ratings[p.uid] || 0,
        gain: gain.total,
        mmrAfter: after,
        belt: beltFor(after).name,
        promoted: beltFor(after).name !== beltFor(ratings[p.uid] || 0).name,
        done: !!p.done,
      };
    });

    if (g.mode === "race" && results[0]) this.logEvent(`${results[0].name} wins the race!`);
    if (g.mode === "turns" && results[0]) this.logEvent(`${results[0].name} wins with ${results[0].score} blocks!`);

    await this.save();
    this.pushAll();
    this.broadcast("AP_OVER", { results, reason });

    this.state.waitUntil(recordMatch(this.env, {
      code: g.code,
      game: "arrow-puzzle",
      mode: g.mode,
      roundNo: g.roundNo,
      finishedAt: Date.now(),
      durationMs: Date.now() - g.startedAt,
      results: results.map((r) => ({ uid: r.uid, name: r.name, score: r.score, gain: r.gain, status: "finished", elapsedMs: Date.now() - g.startedAt })),
    }).catch(() => {}));
  }

  // ── chat ───────────────────────────────────────────────────────────
  async onSay(ws, uid, msg, name) {
    const g = this.g;
    const text = String(msg.text || "").trim().slice(0, 200);
    if (!text) return;
    const who = g.players[uid]?.name || name || "Someone";
    const verdict = await moderate(this.env, text);
    if (!verdict.ok) {
      return this.send(ws, "AP_REJECT", { why: `That doesn't belong here (${verdict.reason}).` });
    }
    const line = { uid, name: who, text, at: Date.now() };
    g.chat = [...(g.chat || []), line].slice(-60);
    await this.save();
    this.broadcast("AP_CHAT", { line });
  }

  // ── view ───────────────────────────────────────────────────────────
  viewFor(uid) {
    const g = this.g;
    if (!g) return null;
    const p = g.players[uid];
    const size = g.dim === 3 ? SIZE_3D : SIZE_2D;
    return {
      code: g.code, game: GAME_NAME, phase: g.phase,
      you: uid, isHost: this.canStart(uid),
      mode: g.mode, level: g.level || "easy", dim: g.dim, visual: g.visual, size,
      people: this.humans().map((h) => ({ uid: h.uid, name: h.name, score: g.scores[h.uid] || 0, done: !!h.done })),
      turn: g.turn || null,
      feed: g.feed || [],
      // Race: send the player their own board
      board: g.mode === "race" && p ? (p.board || []) : (g.shared || []),
      initialCount: g.initialBlocks?.length || 0,
      scores: g.scores || {},
      roundNo: g.roundNo,
    };
  }

  pushAll() {
    for (const ws of this.state.getWebSockets()) {
      let who = null;
      try { who = ws.deserializeAttachment()?.uid; } catch { /* gone */ }
      this.send(ws, "AP_STATE", { state: this.viewFor(who) });
    }
    this.announce();
  }

  announce() {
    const g = this.g;
    if (!g) return;
    announceRoom(this.env, this.state, {
      game: "arrow-puzzle", code: g.code,
      host: this.humans()[0]?.name || "Someone",
      players: [...this.liveUids()].filter((u) => g.players[u]).length,
      phase: g.phase,
      label: g.mode,
      round: g.roundNo,
    });
  }

  logEvent(text) {
    this.g.feed = [...(this.g.feed || []), { at: Date.now(), text }].slice(-8);
  }

  send(ws, type, body) {
    if (!ws) return;
    try { ws.send(JSON.stringify({ type, ...body })); } catch { /* gone */ }
  }

  broadcast(type, body) {
    for (const ws of this.state.getWebSockets()) this.send(ws, type, body);
  }

  save() { return this.state.storage.put({ arrow: this.g }); }

  // ── WebSocket handshake ────────────────────────────────────────────
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("This endpoint speaks WebSocket only.", { status: 426 });
    const uid = request.headers.get("X-Dojo-Uid");
    const name = request.headers.get("X-Dojo-Name") || "Player";
    const code = (request.headers.get("X-Dojo-Code") || "ARROW").toUpperCase();
    if (!uid) return new Response("Unauthenticated.", { status: 401 });

    if (!this.g) this.g = this.blank(code);

    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ uid, name });
    await this.onJoin(uid, name, pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async onJoin(uid, name, ws) {
    const g = this.g;
    if (!g.players[uid]) {
      g.players[uid] = { uid, name, done: false, board: null };
      g.order.push(uid);
    }
    if (!g.hostUid) g.hostUid = uid;
    g.players[uid].name = name;
    await this.save();
    this.send(ws, "AP_WELCOME", { you: uid, isHost: this.canStart(uid) });
    for (const line of (g.chat || []).slice(-30)) this.send(ws, "AP_CHAT", { line });
    this.pushAll();
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    let who = null;
    try { who = ws.deserializeAttachment(); } catch { /* gone */ }
    const uid = who?.uid;
    if (!uid || !this.g) return;

    switch (msg.type) {
      case "AP_START": return void await this.start(ws, uid, msg);
      case "AP_TAP":   return void await this.onTap(ws, uid, msg);
      case "AP_SAY":   return void await this.onSay(ws, uid, msg, who?.name);
      case "PING": this.announce(); return;
    }
  }

  async webSocketClose() { this.announce(); }
  async webSocketError() { this.announce(); }
}
