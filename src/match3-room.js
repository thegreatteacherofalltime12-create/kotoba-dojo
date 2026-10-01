import {
  GAME_NAME, ROWS, COLS, MATCH_MS, RISE_START_MS, MAX_LAND, LAND_MS, MAX_CHARGE,
  makeBoard, swap, resolve, hasMove, reshuffle, height, rise, dropRubble, launchSize, nextRiseMs,
  aiMove, aiLevelById, AI_LEVELS, AI_NAMES, matchScore, standings, rngFrom,
  PRESSURE_START_MS, nextPressureMs, pressureSize, survivalScore,
} from "./match3.js";
import { poolFor, scramble } from "./links.js";
import { recordMatch, readRatings, strikePlayer } from "./firestore.js";
import { sessionGain, fieldMmrFor, beltFor, boostedBy, multFor } from "./mmr.js";
import { tokensReply, dropUnheld } from "./boost.js";
import { moderate } from "./moderation.js";
import { announceRoom } from "./rooms.js";

/** Quickest a person may swap, so one finger cannot flood the room. */
const SWAP_GAP_MS = 180;
/** What a wrong answer costs: a moment, so it is not a way to try every word. */
const WRONG_LOCK_MS = 1_200;
/** A launch buys the launcher a breather before the next row rises. */
const SOLVE_BREATH_MS = 1_500;
const MAX_HUMANS = 2;
/** Anyone past the two players may watch, up to a crowd the room can send to. */
const MAX_WATCHERS = 24;

/**
 * A match of Match-3 Attack Arena.
 *
 * Two wells side by side. Clearing tiles builds charge, and charge is worth
 * nothing until its owner solves the word on their screen — then it leaves as
 * rubble on the other well. The room runs every rule and sends the finished
 * result of each move; the browser draws it and never works anything out, and
 * neither player is ever sent the other's word.
 */
export class MatchArena {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      this.g = (await state.storage.get("match")) || null;
    });
  }

  blank(code) {
    return {
      code, phase: "LOBBY", solo: false, mode: "versus", hostUid: null, aiLevel: "medium",
      pressureAt: 0, pressureMs: PRESSURE_START_MS,
      roundNo: 0, startedAt: 0, endsAt: 0, seed: 0, players: {}, order: [], feed: [],
      applied: {},          // the boost or multiplier each player put on this match
      chat: [],             // what the room has said to each other
    };
  }

  fresh(uid, name, ai = null) {
    return {
      uid, name, ai, board: null,
      charge: 0, incoming: 0, landAt: 0,
      riseAt: 0, riseMs: RISE_START_MS,
      word: null, used: [], lockUntil: 0, swapAt: 0,
      sent: 0, solved: 0, skipped: 0, cleared: 0, maxChain: 0, swaps: 0,
      over: false, overAt: 0,
      aiMoveAt: 0, aiSolveAt: 0,
      mmrAtStart: 0, seed: null, lastSeen: Date.now(),
    };
  }

  list() { return this.g.order.map((u) => this.g.players[u]).filter(Boolean); }
  humans() { return this.list().filter((p) => !p.ai); }
  foeOf(uid) { return this.list().find((p) => p.uid !== uid && !p.over) || this.list().find((p) => p.uid !== uid) || null; }

  /* ── words ─────────────────────────────────────────────────────── */

  /**
   * The next word to unscramble. Longer ones as the match wears on, none twice
   * in one match, and the answer stays here: the browser is sent the letters
   * and the clue, never the word.
   */
  newWord(p) {
    const elapsed = Date.now() - (this.g.startedAt || Date.now());
    const len = elapsed < 90_000 ? 4 : elapsed < 180_000 ? 5 : 6;
    let pool = poolFor("modern", len, "medium").filter(([w]) => !p.used.includes(w));
    if (!pool.length) pool = poolFor("modern", len, "medium");
    const [answer, clue] = pool[Math.floor(Math.random() * pool.length)];
    p.used.push(answer);
    p.word = { answer, clue, scrambled: scramble(answer), len: answer.length };
  }

  /* ── starting ──────────────────────────────────────────────────── */

  canStart(uid) {
    const g = this.g;
    if (!g || !g.players[uid]) return false;      // somebody watching does not run the match
    if (!g.hostUid || g.hostUid === uid) return true;
    return !this.liveUids().has(g.hostUid);
  }

  /** How many are watching rather than playing. */
  watchers() {
    return [...this.liveUids()].filter((u) => !this.g.players[u]).length;
  }

  liveUids() {
    const out = new Set();
    for (const ws of this.state.getWebSockets()) {
      try { const a = ws.deserializeAttachment(); if (a?.uid) out.add(a.uid); } catch { /* gone */ }
    }
    return out;
  }

  async start(ws, uid, msg = {}) {
    const g = this.g;
    if (!g || g.phase === "PLAYING") return;
    if (!this.canStart(uid)) return this.send(ws, "M3_REJECT", { why: "The player who opened this room calls the start." });

    if (msg.level && aiLevelById(msg.level).id === msg.level) g.aiLevel = msg.level;
    // Computers come and go with the setting rather than piling up.
    for (const u of Object.keys(g.players)) if (g.players[u].ai) delete g.players[u];
    const people = Object.values(g.players).filter((p) => !p.ai);
    g.mode = msg.mode === "survival" ? "survival" : "versus";
    if (g.mode === "survival") {
      // Survival is one person against the game. With two at the table it would
      // be a race to nowhere, so the room says so rather than picking one of them.
      if (people.length !== 1) return this.send(ws, "M3_REJECT", { why: "Survival is a one-player mode." });
      g.solo = true;
    } else {
      g.solo = people.length < 2 && msg.solo !== false;
      if (people.length < 2 && !g.solo) return this.send(ws, "M3_REJECT", { why: "Waiting for an opponent." });
      if (g.solo) g.players.ai = this.fresh("ai", AI_NAMES[0], g.aiLevel);
    }
    g.order = Object.keys(g.players);

    g.seed = (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;
    const now = Date.now();
    g.order.forEach((u, i) => {
      const p = g.players[u];
      Object.assign(p, this.fresh(p.uid, p.name, p.ai), { seed: i + 1 });
      p.board = makeBoard(rngFrom(g.seed + i * 977));
      p.riseAt = now + RISE_START_MS;
      p.aiMoveAt = now + 2_500;
      p.aiSolveAt = now + 9_000;
      this.newWord(p);
    });
    g.phase = "PLAYING";
    g.startedAt = now;
    g.endsAt = now + MATCH_MS;
    g.pressureMs = PRESSURE_START_MS;
    g.pressureAt = g.mode === "survival" ? now + PRESSURE_START_MS : 0;
    g.roundNo += 1;
    g.feed = [];

    // Ratings are read once, at the off, so the curve is scored against where
    // everybody stood before a tile moved.
    let ratings = {};
    try { ratings = await readRatings(this.env, this.humans().map((p) => p.uid)); } catch { /* unranked */ }
    const seeded = this.humans().map((p) => p.uid).sort((a, b) => (ratings[b] || 0) - (ratings[a] || 0));
    for (const p of this.list()) {
      p.mmrAtStart = ratings[p.uid] || 0;
      if (!p.ai) p.seed = seeded.indexOf(p.uid) + 1;
      if (!p.ai) dropUnheld(g.applied, p.uid, "match3", ratings.boosts);
    }

    this.logEvent(g.mode === "survival" ? "Survival: last as long as you can." : g.solo ? `Solo match against ${AI_NAMES[0]} (${aiLevelById(g.aiLevel).name}).` : "Match begins.");
    await this.save();
    await this.rearm();
    this.pushAll();
    this.broadcast("M3_START", { at: now, endsAt: g.endsAt });
  }

  /* ── what a move does ──────────────────────────────────────────── */

  /** Charge, chain and bookkeeping for a finished cascade. */
  credit(p, out) {
    p.swaps += 1;
    p.cleared += out.cleared;
    p.charge = Math.min(MAX_CHARGE, p.charge + out.charge);
    p.maxChain = Math.max(p.maxChain, out.chain);
  }

  /** Rubble waiting for this well lands now, up to the most one landing may carry. */
  landRubble(p, now) {
    if (p.over || p.incoming <= 0) return { placed: [] };
    const n = Math.min(MAX_LAND, p.incoming);
    p.incoming -= n;
    p.landAt = p.incoming > 0 ? now + LAND_MS / 2 : 0;
    const d = dropRubble(p.board, n, Math.random);
    if (d.over) this.knockOut(p, now);
    return { placed: d.placed };
  }

  knockOut(p, now) {
    if (p.over) return;
    p.over = true;
    p.overAt = now;
    this.logEvent(`${p.name}'s stack has nowhere left to go.`);
  }

  /** No move left on a well would be a soft-lock, so it is shaken up. */
  keepPlayable(p) {
    if (!p.over && !hasMove(p.board)) { reshuffle(p.board, Math.random); return true; }
    return false;
  }

  /**
   * One swap, start to finish. Used for a person and for the computer, so the
   * two can never disagree about what a move does.
   */
  applySwap(p, a, b, now) {
    const out = swap(p.board, a, b);
    if (!out.ok) return out;
    this.credit(p, out);
    // Clearing stalls the rise a little, so a good chain buys time to use it.
    p.riseAt = Math.min(p.riseAt + Math.min(1_800, 350 * out.steps.length), now + p.riseMs * 1.5);
    const landed = this.landRubble(p, now);
    const shuffled = this.keepPlayable(p);
    return { ...out, landed: landed.placed, shuffled };
  }

  /**
   * A solved word sends the stored charge across, cancelling rubble already on
   * its way here before any of it reaches the other well.
   */
  launch(p, len, now) {
    const send = launchSize(p.charge, len);
    p.charge = 0;
    p.sent += send;
    p.riseAt += SOLVE_BREATH_MS;
    const foe = this.foeOf(p.uid);
    const cancel = Math.min(p.incoming, send);
    p.incoming -= cancel;
    if (!p.incoming) p.landAt = 0;
    const rest = send - cancel;
    if (rest > 0 && foe && !foe.over) {
      if (foe.incoming === 0) foe.landAt = now + LAND_MS;
      foe.incoming += rest;
    }
    if (send > 0) this.logEvent(`${p.name} unscrambled a word and sent ${send}${cancel ? ` (${cancel} cancelled incoming)` : ""}.`);
    return { send, cancel, rest };
  }

  /* ── the alarm: rises, landings, the computer, the clock ───────── */

  nextDeadline() {
    const g = this.g;
    if (!g || g.phase !== "PLAYING") return null;
    const t = [g.endsAt];
    if (g.mode === "survival" && g.pressureAt) t.push(g.pressureAt);
    for (const p of this.list()) {
      if (p.over) continue;
      t.push(p.riseAt);
      if (p.incoming > 0 && p.landAt) t.push(p.landAt);
      if (p.ai) t.push(p.aiMoveAt, p.aiSolveAt);
    }
    return Math.min(...t.filter(Boolean));
  }

  async rearm() {
    const at = this.nextDeadline();
    if (at) await this.state.storage.setAlarm(Math.max(at, Date.now() + 25));
  }

  async alarm() {
    const g = this.g;
    if (!g || g.phase !== "PLAYING") return;
    const now = Date.now();

    // Alone, the game is the other player: a wave of rubble is aimed at you on
    // a schedule, to be cancelled by launching before it lands.
    if (g.mode === "survival" && g.pressureAt && now >= g.pressureAt) {
      const me = this.list()[0];
      if (me && !me.over) {
        const n = pressureSize(now - g.startedAt);
        if (me.incoming === 0) me.landAt = now + LAND_MS;
        me.incoming = Math.min(60, me.incoming + n);
        this.logEvent(`${n} rubble on its way.`);
      }
      g.pressureMs = nextPressureMs(g.pressureMs);
      g.pressureAt = now + g.pressureMs;
    }

    for (const p of this.list()) {
      if (p.over || g.phase !== "PLAYING") continue;

      // The stack rises. A rise can also finish a match by itself, so what it
      // makes is cleared on the spot and the well kept playable.
      for (let k = 0; k < 4 && now >= p.riseAt && !p.over; k++) {
        const r = rise(p.board, Math.random);
        if (r.over) { this.knockOut(p, now); break; }
        p.riseMs = nextRiseMs(p.riseMs);
        p.riseAt = Math.max(p.riseAt, now - 1) + p.riseMs;
        const out = resolve(p.board);
        if (out.steps.length) {
          // What a rise happens to make is cleared and credited like anything
          // else, but it is not a move the player made.
          p.cleared += out.cleared;
          p.charge = Math.min(MAX_CHARGE, p.charge + out.charge);
          p.maxChain = Math.max(p.maxChain, out.chain);
        }
        this.keepPlayable(p);
      }

      if (!p.over && p.incoming > 0 && p.landAt && now >= p.landAt) { this.landRubble(p, now); this.keepPlayable(p); }

      if (p.ai && !p.over) {
        const lvl = aiLevelById(p.ai);
        if (now >= p.aiMoveAt) {
          const m = aiMove(p.board, lvl.id, Math.random);
          if (m) this.applySwap(p, m[0], m[1], now); else this.keepPlayable(p);
          p.aiMoveAt = now + lvl.moveMs * (0.8 + Math.random() * 0.4);
        }
        if (now >= p.aiSolveAt) {
          // It has to solve a word like anybody else; it just takes a while.
          if (p.charge >= 2) this.launch(p, 4 + Math.floor(Math.random() * 3), now);
          p.aiSolveAt = now + lvl.solveMs * (0.8 + Math.random() * 0.5);
        }
      }
    }

    if (this.list().some((p) => p.over)) return void await this.finish("overflow");
    if (now >= g.endsAt) return void await this.finish("time");

    await this.save();
    this.pushAll();
    await this.rearm();
  }

  /* ── what players say ──────────────────────────────────────────── */

  async onSwap(ws, uid, msg) {
    const g = this.g;
    const p = g?.players?.[uid];
    if (!g || g.phase !== "PLAYING" || !p || p.over) return;
    const now = Date.now();
    if (now - p.swapAt < SWAP_GAP_MS) return;
    p.swapAt = now;

    const a = Array.isArray(msg.a) ? msg.a.map(Number) : [];
    const b = Array.isArray(msg.b) ? msg.b.map(Number) : [];
    const out = this.applySwap(p, a, b, now);
    if (!out.ok) return this.send(ws, "M3_REJECT", { why: out.why });

    this.send(ws, "M3_RESULT", {
      steps: out.steps.map((s) => ({ chain: s.chain, cells: s.cells, rubble: s.rubble, after: s.after })),
      landed: out.landed, shuffled: !!out.shuffled,
      board: p.board, charge: p.charge,
    });
    if (p.over) return void await this.finish("overflow");
    await this.save();
    this.pushAll();
    await this.rearm();
  }

  async onGuess(ws, uid, msg) {
    const g = this.g;
    const p = g?.players?.[uid];
    if (!g || g.phase !== "PLAYING" || !p || p.over || !p.word) return;
    const now = Date.now();
    if (now < p.lockUntil) return this.send(ws, "M3_WRONG", { wait: p.lockUntil - now });

    const guess = String(msg.word || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (!guess) return;
    if (guess !== p.word.answer) {
      p.lockUntil = now + WRONG_LOCK_MS;
      return this.send(ws, "M3_WRONG", { wait: WRONG_LOCK_MS });
    }
    const solved = p.word;
    p.solved += 1;
    const out = this.launch(p, solved.len, now);
    this.newWord(p);
    this.send(ws, "M3_SOLVED", { word: solved.answer, ...out });
    await this.save();
    this.pushAll();
    await this.rearm();
  }

  /**
   * The match's chat. Open throughout, to the players and to anyone watching,
   * and moderated on the same screen as the arena chat: a refused line costs a
   * strike, because the room a thing is said in does not change what may be said.
   */
  async onSay(ws, uid, msg, name) {
    const g = this.g;
    const text = String(msg.text || "").trim().slice(0, 200);
    if (!text) return;
    const who = g.players[uid]?.name || name || "Someone";
    const verdict = await moderate(this.env, text);
    if (!verdict.ok) {
      const strikes = await strikePlayer(this.env, uid, who, { text, reason: verdict.reason, where: "match-3 chat" });
      return this.send(ws, "M3_REJECT", { why: `That doesn't belong here (${verdict.reason}). Strike ${strikes ?? "?"} of 3.` });
    }
    const line = { uid, name: who, text, at: Date.now(), watching: !g.players[uid] };
    g.chat = [...(g.chat || []), line].slice(-60);
    await this.save();
    this.broadcast("M3_CHAT", { line });
  }

  /** The Apply Token tab: what is held, and putting one on this match. */
  async sendTokens(ws, uid, apply, key) {
    const g = this.g;
    if (!g.players[uid] || g.players[uid].ai) return;
    g.applied = g.applied || {};
    const reply = await tokensReply(this.env, uid, "match3", {
      applied: g.applied, over: g.phase === "OVER", apply, key,
    });
    if (reply.changed) await this.save();
    this.send(ws, "M3_TOKENS", reply);
  }

  async onSkip(ws, uid) {
    const g = this.g;
    const p = g?.players?.[uid];
    if (!g || g.phase !== "PLAYING" || !p || p.over) return;
    // A word you cannot get is not a prison, but it is not free either.
    p.charge = Math.floor(p.charge * 0.75);
    p.skipped += 1;
    this.newWord(p);
    await this.save();
    this.pushAll();
  }

  /* ── the end ───────────────────────────────────────────────────── */

  async finish(reason) {
    const g = this.g;
    if (!g || g.phase === "OVER") return;
    g.phase = "OVER";
    await this.state.storage.deleteAlarm().catch(() => {});

    const field = this.list().map((p) => ({ ...p, h: height(p.board) }));
    const ordered = standings(field, reason === "time");
    const people = this.humans();
    const ratings = Object.fromEntries(people.map((p) => [p.uid, p.mmrAtStart || 0]));

    const results = ordered.map((row, i) => {
      const p = g.players[row.uid];
      const placement = i + 1;
      const score = g.mode === "survival"
        ? survivalScore({
          seconds: (Math.min(Date.now(), p.over ? p.overAt : Date.now()) - g.startedAt) / 1000,
          sent: p.sent, solved: p.solved, maxChain: p.maxChain, survived: !p.over,
        })
        : matchScore({
          placement, field: field.length, sent: p.sent, solved: p.solved, maxChain: p.maxChain, survived: !p.over,
        });
      const gain = sessionGain({
        score, completed: true,
        playerMmr: p.mmrAtStart || 0,
        fieldMmr: fieldMmrFor(p.uid, ratings),
        mode: "match", seed: p.seed, placement,
      });
      // What was applied to this match: a multiplier by its own key, or the
      // game's boost by the name of the game. One token either way, and the
      // record write spends whichever it was.
      const boostKey = p.ai ? null : (g.applied?.[p.uid] || null);
      if (boostKey) gain.total = boostedBy(gain.total, boostKey);
      const after = (p.mmrAtStart || 0) + gain.total;
      return {
        boost: !!boostKey, boostKey: boostKey || undefined, mult: boostKey ? multFor(boostKey) : undefined,
        uid: p.uid, name: p.name, ai: p.ai || undefined,
        score, placement, seed: p.seed || null,
        sent: p.sent, solved: p.solved, skipped: p.skipped, cleared: p.cleared, maxChain: p.maxChain, swaps: p.swaps,
        status: p.over ? "overflowed" : "standing",
        elapsedMs: Date.now() - g.startedAt,
        mmrBefore: p.mmrAtStart || 0,
        gain: gain.total,
        breakdown: { base: gain.base, challenge: gain.challenge, completion: gain.completion, seed: gain.seed },
        mmrAfter: after,
        belt: beltFor(after).name,
        promoted: beltFor(after).name !== beltFor(p.mmrAtStart || 0).name,
      };
    });

    g.applied = {};
    this.logEvent(g.mode === "survival"
      ? (reason === "time" ? "Five minutes: you survived." : "Your stack has nowhere left to go.")
      : reason === "time"
        ? `Time. ${ordered[0].name} wins on the harder hits.`
        : `${ordered[0].name} wins: the other stack overflowed.`);
    await this.save();
    this.pushAll();
    this.broadcast("M3_OVER", { results, reason });

    // The computer is not on the ladder, so it is not in the record.
    this.state.waitUntil(recordMatch(this.env, {
      code: g.code,
      game: "match3",
      mode: g.mode === "survival" ? "Survival" : g.solo ? `Solo · ${aiLevelById(g.aiLevel).name}` : "Head to head",
      roundNo: g.roundNo,
      finishedAt: Date.now(),
      durationMs: Date.now() - g.startedAt,
      results: results.filter((r) => !r.ai),
    }).catch(() => {}));
  }

  /* ── plumbing ──────────────────────────────────────────────────── */

  logEvent(text) {
    this.g.feed = [...(this.g.feed || []), { at: Date.now(), text }].slice(-8);
  }

  viewFor(uid) {
    const g = this.g;
    if (!g) return null;
    const player = g.players[uid];
    // Somebody watching is shown the first two wells as a pair, read-only, and
    // neither word: they see exactly what the other player sees.
    const watching = !player;
    const [first, second] = this.list();
    const me = watching ? first : player;
    const foe = watching ? second : this.foeOf(uid);
    const board = (p) => (p?.board ? p.board : null);
    return {
      code: g.code, game: GAME_NAME, phase: g.phase, you: uid, solo: !!g.solo,
      watching, watchers: this.watchers(), mode: g.mode,
      pressure: g.mode === "survival" ? { at: g.pressureAt, ms: g.pressureMs } : null,
      hostUid: g.hostUid, isHost: this.canStart(uid),
      aiLevel: g.aiLevel, levels: AI_LEVELS,
      now: Date.now(), endsAt: g.endsAt, roundNo: g.roundNo,
      cols: COLS, rows: ROWS,
      people: this.humans().map((p) => ({ uid: p.uid, name: p.name })),
      feed: g.feed || [],
      me: me ? {
        uid: me.uid, name: me.name, board: board(me),
        charge: me.charge, maxCharge: MAX_CHARGE, incoming: me.incoming, landAt: me.landAt,
        riseAt: me.riseAt, riseMs: me.riseMs, lockUntil: me.lockUntil,
        sent: me.sent, solved: me.solved, over: me.over,
        // The letters and the clue, never the word — and only to the player.
        word: !watching && me.word ? { clue: me.word.clue, scrambled: me.word.scrambled, len: me.word.len } : null,
      } : null,
      foe: foe ? {
        uid: foe.uid, name: foe.name, ai: foe.ai || null, board: board(foe),
        charge: foe.charge, incoming: foe.incoming, riseAt: foe.riseAt, riseMs: foe.riseMs,
        sent: foe.sent, solved: foe.solved, over: foe.over,
      } : null,
    };
  }

  pushAll() {
    for (const ws of this.state.getWebSockets()) {
      let who = null;
      try { who = ws.deserializeAttachment()?.uid; } catch { /* gone */ }
      this.send(ws, "M3_STATE", { state: this.viewFor(who) });
    }
    this.announce();
  }

  announce() {
    const g = this.g;
    if (!g) return;
    announceRoom(this.env, this.state, {
      game: "match3", code: g.code,
      host: this.humans()[0]?.name || "Someone",
      players: g.solo ? 0 : [...this.liveUids()].filter((u) => g.players[u]).length,
      phase: g.phase,
      label: g.mode === "survival" ? "Survival" : g.solo ? `Solo · ${aiLevelById(g.aiLevel).name}` : "Head to head",
      round: g.roundNo,
    });
  }

  send(ws, type, body) {
    if (!ws) return;
    try { ws.send(JSON.stringify({ type, ...body })); } catch { /* gone */ }
  }

  broadcast(type, body) {
    for (const ws of this.state.getWebSockets()) this.send(ws, type, body);
  }

  save() { return this.state.storage.put({ match: this.g }); }

  /**
   * Where somebody coming in sits: a player if there is a seat, a watcher if
   * there is not, or turned away.
   *
   * A seat is only ever taken in the lobby; once a match is under way, or
   * finished, anybody new is watching. A solo match is private, as it is
   * everywhere else — the room can still be typed at, and a private match a
   * stranger can walk into is not private.
   */
  admit(uid) {
    const g = this.g;
    const known = !!g.players[uid];
    const watching = !known && !(g.phase === "LOBBY" && this.humans().length < MAX_HUMANS);
    if (watching && g.solo && g.hostUid !== uid) return { refuse: "This is a solo match." };
    if (watching && this.watchers() >= MAX_WATCHERS) return { refuse: "This match has all the watchers it can take." };
    return { watching };
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("This endpoint speaks WebSocket only.", { status: 426 });
    const uid = request.headers.get("X-Dojo-Uid");
    const name = request.headers.get("X-Dojo-Name") || "Player";
    const code = (request.headers.get("X-Dojo-Code") || "MATCH").toUpperCase();
    if (!uid) return new Response("Unauthenticated.", { status: 401 });

    if (!this.g) this.g = this.blank(code);
    const entry = this.admit(uid);
    if (entry.refuse) return new Response(entry.refuse, { status: 403 });
    const watching = entry.watching;

    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ uid, name, watching });
    await this.onJoin(uid, name, pair[1], watching);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async onJoin(uid, name, ws, watching = false) {
    const g = this.g;
    if (!watching) {
      if (!g.players[uid]) {
        g.players[uid] = this.fresh(uid, name);
        g.order.push(uid);
      }
      if (!g.hostUid) g.hostUid = uid;
      g.players[uid].name = name;
      g.players[uid].lastSeen = Date.now();
    }
    await this.save();
    this.send(ws, "M3_WELCOME", { you: uid, isHost: this.canStart(uid), watching });
    // What was said before you got here, so a reload does not empty the room.
    for (const line of (g.chat || []).slice(-30)) this.send(ws, "M3_CHAT", { line });
    this.pushAll();
    if (g.phase === "PLAYING") await this.rearm();
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    let who = null;
    try { who = ws.deserializeAttachment(); } catch { /* gone */ }
    const uid = who?.uid;
    if (!uid || !this.g) return;

    switch (msg.type) {
      case "M3_SAY": return void await this.onSay(ws, uid, msg, who?.name);
      case "TOKENS": return void await this.sendTokens(ws, uid, false);
      case "APPLY_TOKEN": return void await this.sendTokens(ws, uid, true, msg.key);
      case "M3_START": return void await this.start(ws, uid, msg);
      case "M3_SWAP": return void await this.onSwap(ws, uid, msg);
      case "M3_GUESS": return void await this.onGuess(ws, uid, msg);
      case "M3_SKIP": return void await this.onSkip(ws, uid);
      case "M3_END": return void (this.canStart(uid) && await this.finish("ended"));
      case "PING": this.announce(); return;
    }
  }

  async webSocketClose() { this.announce(); }
  async webSocketError() { this.announce(); }
}
