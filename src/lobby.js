import { ROUND_MS, scoreFor } from "./scoring.js";
import { validatePuzzle, stripAnswers, answerKey, WORD_COUNT } from "./validate.js";
import { recordMatch, readRatings, getScroll, bumpScroll } from "./firestore.js";
import { sessionGain, fieldMmrFor, beltFor } from "./mmr.js";
import { STARTER_PUZZLES } from "./starter-puzzles.js";
import { announceRoom } from "./rooms.js";
import { applyBounty } from "./report-bounty.js";

const IDLE_SHUTDOWN_MS = 30 * 60_000;
// Sustained rate that stops brute-forcing short entries, with enough burst
// that a fast solver completing several crossings at once is never throttled.
const CHECK_REFILL_PER_SECOND = 8;
const CHECK_BURST = 20;

// One instance per dojo code. Authoritative for time, answers and scores.
export class DojoLobby {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.buckets = new Map(); // uid -> { tokens, last } rate limiter

    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get(["lobby", "answers", "clientPuzzle"]);
      this.lobby = stored.get("lobby") || null;
      this.answers = stored.get("answers") || null;
      this.clientPuzzle = stored.get("clientPuzzle") || null;
    });
  }

  // ---------------------------------------------------------------- plumbing

  async persist() {
    await this.state.storage.put({
      lobby: this.lobby,
      answers: this.answers,
      clientPuzzle: this.clientPuzzle,
    });
  }

  sockets() {
    return this.state.getWebSockets();
  }

  /** Report this lobby to the directory so its code can be found. */
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
    if (!this.lobby) return;
    // An unlisted dojo is actively withdrawn, not merely left un-announced:
    // it may have been listed a moment ago and the row would linger. Players
    // of 0 removes it, while the code still works for anyone who has it.
    announceRoom(this.env, this.state, {
      game: "crossword",
      code: this.lobby.code,
      host: this.lobby.members[this.lobby.senseiUid]?.name || "Someone",
      players: this.lobby.listed ? this.connectedUids().size : 0,
      phase: this.lobby.phase,
      label: this.lobby.puzzleMeta?.title || null,
      round: this.lobby.roundNo,
    });
  }

  send(ws, type, payload = {}) {
    try {
      ws.send(JSON.stringify({ type, ...payload }));
    } catch {
      /* socket already gone */
    }
  }

  broadcast(type, payload = {}) {
    const msg = JSON.stringify({ type, ...payload });
    for (const ws of this.sockets()) {
      try { ws.send(msg); } catch { /* ignore */ }
    }
  }

  socketFor(uid) {
    return this.sockets().find((ws) => {
      try { return ws.deserializeAttachment()?.uid === uid; } catch { return false; }
    });
  }

  connectedUids() {
    const out = new Set();
    for (const ws of this.sockets()) {
      try {
        const a = ws.deserializeAttachment();
        if (a?.uid) out.add(a.uid);
      } catch { /* ignore */ }
    }
    return out;
  }

  // ------------------------------------------------------------- connections

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("This endpoint speaks WebSocket only.", { status: 426 });

    const uid = request.headers.get("X-Dojo-Uid");
    const name = request.headers.get("X-Dojo-Name") || "Student";
    const code = request.headers.get("X-Dojo-Code") || "dojo";
    if (!uid) return new Response("Unauthenticated.", { status: 401 });

    const pair = new WebSocketPair();
    // Hibernation: the DO can be evicted while these stay open, so all state
    // that matters lives in storage, not in this object's fields.
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ uid, name });

    await this.onJoin(uid, name, code, pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async onJoin(uid, name, code, ws) {
    if (!this.lobby) {
      this.lobby = {
        code,
        createdAt: Date.now(),
        senseiUid: uid,
        phase: "LOBBY",
        listed: true,
        gameMode: "match",
        members: {},
        puzzleMeta: null,
        roundStartedAt: null,
        roundEndsAt: null,
        players: {},
        lastResults: null,
        roundNo: 0,
      };
    }

    const existing = this.lobby.members[uid];
    if (existing) {
      existing.name = name;
    } else {
      this.lobby.members[uid] = {
        uid,
        name,
        joinedAt: Date.now(),
        // Arriving mid-round means watching this one out. Handing someone a
        // fresh grid with ninety seconds left serves nobody.
        role: this.lobby.phase === "ACTIVE" ? "spectator" : "player",
      };
    }

    await this.state.storage.deleteAlarm().catch(() => {});
    if (this.lobby.phase === "ACTIVE" && this.lobby.roundEndsAt)
      await this.state.storage.setAlarm(this.lobby.roundEndsAt);

    await this.persist();

    this.send(ws, "WELCOME", { you: uid, isSensei: this.lobby.senseiUid === uid });
    this.broadcastLobby();
    this.announce();

    // A player who dropped mid-round gets their grid and their solved entries
    // back, minus the seconds they were away.
    const round = this.lobby.players[uid];
    if (this.lobby.phase === "ACTIVE" && round && round.status === "playing") {
      const solvedLetters = {};
      for (const id of round.solved) solvedLetters[id] = this.answers?.[id] || "";
      this.send(ws, "ROUND_RESUME", {
        puzzle: this.clientPuzzle,
        solved: round.solved,
        solvedLetters,
        startedAt: this.lobby.roundStartedAt,
        durationMs: ROUND_MS,
        endsAt: this.lobby.roundEndsAt,
        serverNow: Date.now(),
      });
    } else if (this.lobby.phase === "RESULTS" && this.lobby.lastResults) {
      this.send(ws, "ROUND_END", {
        results: this.lobby.lastResults,
        puzzle: this.lobby.revealed || null,
      });
    }
  }

  lobbyState() {
    const connected = this.connectedUids();
    return {
      code: this.lobby.code,
      phase: this.lobby.phase,
      senseiUid: this.lobby.senseiUid,
      listed: this.lobby.listed !== false,
      gameMode: this.lobby.gameMode || "match",
      puzzle: this.lobby.puzzleMeta,
      roundNo: this.lobby.roundNo,
      members: Object.values(this.lobby.members).map((m) => ({
        uid: m.uid,
        name: m.name,
        role: m.role,
        online: connected.has(m.uid),
        score: this.lobby.players[m.uid]?.score ?? null,
        status: this.lobby.players[m.uid]?.status ?? null,
        solvedCount: this.lobby.players[m.uid]?.solved?.length ?? 0,
      })),
    };
  }

  broadcastLobby() {
    this.broadcast("LOBBY_STATE", { lobby: this.lobbyState() });
  }

  // ---------------------------------------------------------------- messages

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const who = ws.deserializeAttachment();
    if (!who?.uid || !this.lobby) return;

    const isSensei = this.lobby.senseiUid === who.uid;

    try {
      switch (msg.type) {
        case "SET_PUZZLE":
          if (!isSensei) return this.send(ws, "ERROR", { message: "Only the sensei chooses the scroll." });
          return await this.setPuzzle(ws, msg);
        case "SET_GAME_MODE": {
          if (!isSensei) return this.send(ws, "ERROR", { message: "Only the sensei sets the mode." });
          if (this.lobby.phase === "ACTIVE")
            return this.send(ws, "ERROR", { message: "A round is already running." });
          const wanted = msg.mode === "solo" ? "solo" : "match";
          this.lobby.gameMode = wanted;
          // Solo training is nobody else's business, so it never lists.
          if (wanted === "solo") this.lobby.listed = false;
          await this.persist();
          this.broadcastLobby();
          this.announce();
          return;
        }
        case "SET_VISIBILITY":
          if (!isSensei) return this.send(ws, "ERROR", { message: "Only the sensei sets this." });
          this.lobby.listed = msg.listed !== false;
          await this.persist();
          this.broadcastLobby();
          this.announce();
          return;
        case "PING": return this.beat();
        case "START_ROUND":
          if (!isSensei) return this.send(ws, "ERROR", { message: "Only the sensei can begin." });
          return await this.startRound(ws);
        case "END_MATCH":
          // Same rule as the other games: the match belongs to whoever is
          // running it. Anyone else pressing the button just walks out.
          if (!isSensei) return this.send(ws, "ERROR", { message: "Only the sensei can end the match." });
          if (this.lobby.phase !== "ACTIVE")
            return this.send(ws, "ERROR", { message: "No round is running." });
          return await this.endRound(true);
        case "CHECK_ENTRY":
          return await this.checkEntry(ws, who.uid, msg);
        case "REQUEST_STATE":
          return this.send(ws, "LOBBY_STATE", { lobby: this.lobbyState() });
        default:
          return this.send(ws, "ERROR", { message: "Unrecognised message." });
      }
    } catch (err) {
      this.send(ws, "ERROR", { message: String(err?.message || err) });
    }
  }

  async setPuzzle(ws, msg) {
    if (this.lobby.phase === "ACTIVE")
      return this.send(ws, "ERROR", { message: "A round is already running." });

    let puzzle;
    let source;

    if (msg.source === "bank") {
      let stored = null;
      try { stored = await this.env.PUZZLES.get(`puzzle:${msg.id}`, "json"); } catch { /* no KV bound yet */ }
      if (!stored) stored = STARTER_PUZZLES[msg.id] || null;
      if (!stored) return this.send(ws, "ERROR", { message: "That scroll is missing from the archive." });
      const check = validatePuzzle(stored);
      if (!check.ok) return this.send(ws, "ERROR", { message: `Archive scroll is malformed: ${check.error}` });
      puzzle = check.puzzle;
      source = "bank";
    } else if (msg.source === "published") {
      // Fetched here rather than sent up: the scroll belongs to whoever wrote
      // it, and the sensei running the round may not be that person.
      const row = await getScroll(this.env, msg.id);
      if (!row?.puzzle) return this.send(ws, "ERROR", { message: "That scroll couldn't be fetched." });
      const check = validatePuzzle(row.puzzle);
      if (!check.ok) return this.send(ws, "ERROR", { message: `That scroll is malformed: ${check.error}` });
      puzzle = check.puzzle;
      source = "published";
      this.scrollId = msg.id;
      this.scrollAuthor = row.author;
    } else if (msg.source === "custom") {
      const check = validatePuzzle(msg.puzzle);
      if (!check.ok) return this.send(ws, "ERROR", { message: check.error });
      puzzle = check.puzzle;
      source = "custom";
    } else {
      return this.send(ws, "ERROR", { message: "Unknown scroll source." });
    }

    this.answers = answerKey(puzzle);
    this.clientPuzzle = stripAnswers(puzzle);
    this.lobby.revealed = puzzle;
    this.lobby.puzzleMeta = {
      id: msg.id || `custom:${Date.now()}`,
      title: puzzle.title,
      source,
      // The count comes from the scroll, not a constant: the America grids
      // carry fifty answers and everything else still carries ten.
      words: puzzle.entries.length,
      scrollId: source === "published" ? msg.id : null,
      author: source === "published" ? this.scrollAuthor : null,
      untimed: !!puzzle.untimed,
      perWord: puzzle.perWord ?? null,
      finishBonus: puzzle.finishBonus ?? null,
      bonusWithinMs: puzzle.bonusWithinMs ?? null,
    };
    if (this.lobby.phase === "RESULTS") this.lobby.phase = "LOBBY";

    await this.persist();
    this.broadcastLobby();
    this.announce();
    this.send(ws, "PUZZLE_ACCEPTED", { title: puzzle.title, source });
  }

  /**
   * How this scroll pays.
   *
   * Most score on the clock: finish fast, score high. The America grids score
   * on progress instead — fifty a word, kept whether or not you finish, with a
   * bonus only for completing the lot inside twenty minutes. A speed curve
   * makes no sense without a deadline, and those two have none.
   */
  terms() {
    const m = this.lobby.puzzleMeta || {};
    return {
      untimed: !!m.untimed,
      words: m.words || WORD_COUNT,
      perWord: m.perWord ?? null,
      finishBonus: m.finishBonus ?? 0,
      bonusWithinMs: m.bonusWithinMs ?? 0,
    };
  }

  /** What a player has earned, given how far they got and how long it took. */
  scoreOf(solved, elapsed, finished) {
    const t = this.terms();
    if (!t.untimed || t.perWord === null) {
      // The timed path, unchanged: full marks for finishing, pro rata for
      // stopping part-way.
      return finished
        ? scoreFor(elapsed)
        : Math.round(scoreFor(elapsed) * (solved / t.words));
    }
    let total = solved * t.perWord;
    if (finished && t.finishBonus && (!t.bonusWithinMs || elapsed <= t.bonusWithinMs)) {
      total += t.finishBonus;
    }
    return total;
  }

  async startRound(ws) {
    if (this.lobby.phase === "ACTIVE")
      return this.send(ws, "ERROR", { message: "A round is already running." });
    if (!this.lobby.puzzleMeta || !this.answers)
      return this.send(ws, "ERROR", { message: "Choose a scroll first." });

    const connected = this.connectedUids();
    const solo = this.lobby.gameMode === "solo";
    if (!solo && connected.size < 2)
      return this.send(ws, "ERROR", { message: "Wait for at least one more student." });

    const custom = this.lobby.puzzleMeta.source === "custom" && this.lobby.gameMode !== "solo";
    this.lobby.players = {};

    for (const m of Object.values(this.lobby.members)) {
      if (!connected.has(m.uid)) { m.role = "spectator"; continue; }
      // A sensei who wrote the scroll knows every answer, so they referee it.
      m.role = custom && m.uid === this.lobby.senseiUid ? "referee" : "player";
      if (m.role === "player") {
        this.lobby.players[m.uid] = {
          uid: m.uid,
          solved: [],
          finishedAt: null,
          score: 0,
          status: "playing",
          mmrAtStart: 0,
          seed: null,
        };
      }
    }

    if (Object.keys(this.lobby.players).length === 0)
      return this.send(ws, "ERROR", { message: "No students are ready to solve." });

    // Snapshot ratings now: seeding and the challenge bonus must both reflect
    // where everyone stood entering the round, not where they end up.
    const uids = Object.keys(this.lobby.players);
    let ratings = Object.fromEntries(uids.map((u) => [u, 0]));
    try { ratings = await readRatings(this.env, uids); } catch { /* unranked arena */ }

    const seeded = [...uids].sort((a, b) => (ratings[b] || 0) - (ratings[a] || 0));
    seeded.forEach((uid, i) => {
      this.lobby.players[uid].mmrAtStart = ratings[uid] || 0;
      this.lobby.players[uid].seed = i + 1;
    });
    // Three or more solvers is a rumble: placement carries the reward.
    this.lobby.mode = uids.length >= 3 ? "rumble" : "match";

    const now = Date.now();
    const untimed = this.terms().untimed;
    this.lobby.phase = "ACTIVE";
    this.lobby.roundNo += 1;
    this.lobby.roundStartedAt = now;
    // No deadline on an untimed scroll, so no alarm to cut it short. It ends
    // when somebody finishes it or the sensei calls it.
    this.lobby.roundEndsAt = untimed ? null : now + ROUND_MS;
    this.lobby.lastResults = null;

    await this.persist();
    if (!untimed) await this.state.storage.setAlarm(this.lobby.roundEndsAt);

    this.broadcastLobby();
    this.broadcast("ROUND_START", {
      puzzle: this.clientPuzzle,
      startedAt: now,
      durationMs: untimed ? null : ROUND_MS,
      endsAt: this.lobby.roundEndsAt,
      untimed,
      serverNow: now,
      roundNo: this.lobby.roundNo,
    });
    this.announce();
  }

  allow(uid) {
    const now = Date.now();
    const b = this.buckets.get(uid) || { tokens: CHECK_BURST, last: now };
    b.tokens = Math.min(CHECK_BURST, b.tokens + ((now - b.last) / 1000) * CHECK_REFILL_PER_SECOND);
    b.last = now;
    if (b.tokens < 1) { this.buckets.set(uid, b); return false; }
    b.tokens -= 1;
    this.buckets.set(uid, b);
    return true;
  }

  async checkEntry(ws, uid, msg) {
    if (this.lobby.phase !== "ACTIVE") return;
    const player = this.lobby.players[uid];
    if (!player || player.status !== "playing") return;

    // Cheap defence against grinding short entries by brute force.
    if (!this.allow(uid)) return this.send(ws, "ERROR", { message: "Slow down." });

    const entryId = String(msg.entryId || "");
    const expected = this.answers?.[entryId];
    if (!expected) return this.send(ws, "ERROR", { message: "No such entry." });

    const guess = String(msg.guess || "").toUpperCase().replace(/[^A-Z]/g, "");
    const correct = guess === expected;

    if (correct && !player.solved.includes(entryId)) player.solved.push(entryId);

    this.send(ws, "CHECK_RESULT", { entryId, correct, solved: player.solved.length });

    if (correct) {
      // Everyone sees the pressure build without seeing anyone's letters.
      this.broadcast("PROGRESS", { uid, solved: player.solved.length, total: this.terms().words });
    }

    if (player.solved.length === this.terms().words) {
      const elapsed = Date.now() - this.lobby.roundStartedAt;
      player.finishedAt = elapsed;
      player.score = this.scoreOf(player.solved.length, elapsed, true);
      player.status = "finished";

      await this.persist();
      this.broadcast("PLAYER_FINISHED", {
        uid,
        name: this.lobby.members[uid]?.name || "Student",
        elapsedMs: elapsed,
        score: player.score,
      });

      const stillGoing = Object.values(this.lobby.players).some((p) => p.status === "playing");
      if (!stillGoing) await this.endRound();
      else this.broadcastLobby();
      return;
    }

    await this.persist();
  }

  /**
   * @param {boolean} endedEarly  the sensei called it rather than the clock
   *   running out. Anyone still solving is then paid for the words they did
   *   get, at the pace they were getting them — a player who stops at eight
   *   of ten earns eight tenths of what that finishing time was worth. The
   *   clock expiring still pays nothing, as it always has.
   */
  async endRound(endedEarly = false) {
    if (this.lobby.phase !== "ACTIVE") return;

    for (const p of Object.values(this.lobby.players)) {
      if (p.status !== "playing") continue;
      if (endedEarly && p.solved.length) {
        const elapsed = Date.now() - this.lobby.roundStartedAt;
        p.status = "ended";
        p.finishedAt = elapsed;
        p.score = this.scoreOf(p.solved.length, elapsed, false);
      } else {
        p.status = "dnf"; p.score = 0; p.finishedAt = null;
      }
    }

    const ordered = Object.values(this.lobby.players)
      .sort((a, z) => z.score - a.score || (a.finishedAt ?? Infinity) - (z.finishedAt ?? Infinity));

    const ratings = Object.fromEntries(
      Object.values(this.lobby.players).map((p) => [p.uid, p.mmrAtStart || 0])
    );
    const mode = this.lobby.mode || "match";

    const results = ordered.map((p, i) => {
      const placement = i + 1;
      const gain = sessionGain({
        score: p.score,
        completed: p.status === "finished",
        playerMmr: p.mmrAtStart || 0,
        fieldMmr: fieldMmrFor(p.uid, ratings),
        mode,
        seed: p.seed,
        placement,
      });
      const after = (p.mmrAtStart || 0) + gain.total;
      return {
        uid: p.uid,
        name: this.lobby.members[p.uid]?.name || "Student",
        score: p.score,
        elapsedMs: p.finishedAt,
        status: p.status,
        solved: p.solved.length,
        placement,
        seed: p.seed || null,
        mmrBefore: p.mmrAtStart || 0,
        gain: gain.total,
        breakdown: { base: gain.base, challenge: gain.challenge, completion: gain.completion, seed: gain.seed },
        mmrAfter: after,
        belt: beltFor(after).name,
        promoted: beltFor(after).name !== beltFor(p.mmrAtStart || 0).name,
      };
    });

    this.lobby.phase = "RESULTS";
    this.lobby.lastResults = results;
    // The bounty is settled before the results go out, so the bonus is part
    // of the MMR players are shown rather than an adjustment afterwards.
    const bounty = await applyBounty(this.env, this.state, {
      mode, durationMs: ROUND_MS, results,
    });

    await this.persist();
    await this.state.storage.deleteAlarm().catch(() => {});

    // The author's record: one play per player, a win for each who finished.
    const scrollId = this.lobby.puzzleMeta?.scrollId;
    if (scrollId && results.length) {
      const wins = results.filter((r) => r.status === "finished").length;
      bumpScroll(this.env, scrollId, {
        plays: results.length, wins, losses: results.length - wins,
      }).catch(() => {});
    }

    this.broadcast("ROUND_END", { results, mode, bounty, puzzle: this.lobby.revealed || null });
    this.broadcastLobby();
    this.announce();

    // Only bank puzzles feed the ranked leaderboard. A custom scroll's author
    // can simply tell a friend the answers, so those rounds stay casual.
    if (this.lobby.puzzleMeta?.source === "bank") {
      this.state.waitUntil?.(
        recordMatch(this.env, {
          code: this.lobby.code,
          roundNo: this.lobby.roundNo,
          puzzleId: this.lobby.puzzleMeta.id,
          game: "crossword", mode,
          finishedAt: Date.now(),
          results,
        }).then((ok) => { if (!ok) console.error(`[crossword] results were not saved`); }).catch((e) => console.error(`[crossword] ${e.message}`))
      );
    }
  }

  // ------------------------------------------------------------------ alarms

  async alarm() {
    if (this.lobby?.phase === "ACTIVE" && Date.now() >= (this.lobby.roundEndsAt || 0)) {
      await this.endRound();
      return;
    }
    if (this.sockets().length === 0) {
      await this.state.storage.deleteAll();
      this.lobby = null;
      this.answers = null;
      this.clientPuzzle = null;
    }
  }

  async webSocketClose(ws) { await this.onGone(ws); }
  async webSocketError(ws) { await this.onGone(ws); }

  async onGone(ws) {
    if (!this.lobby) return;
    let who = null;
    try { who = ws.deserializeAttachment(); } catch { /* ignore */ }

    const connected = this.connectedUids();
    if (who?.uid) connected.delete(who.uid);

    // The lobby outlives rounds now, so a vanished sensei would otherwise
    // strand everyone with no start button.
    if (who?.uid === this.lobby.senseiUid && connected.size > 0) {
      const heir = Object.values(this.lobby.members)
        .filter((m) => connected.has(m.uid))
        .sort((a, z) => a.joinedAt - z.joinedAt)[0];
      if (heir) {
        this.lobby.senseiUid = heir.uid;
        const hws = this.socketFor(heir.uid);
        if (hws) this.send(hws, "WELCOME", { you: heir.uid, isSensei: true, promoted: true });
      }
    }

    await this.persist();
    this.broadcastLobby();
    this.announce();

    if (connected.size === 0 && this.lobby.phase !== "ACTIVE") {
      await this.state.storage.setAlarm(Date.now() + IDLE_SHUTDOWN_MS);
    }
  }
}
