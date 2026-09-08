import {
  SIZE, FLEET, SHOTS_PER_TURN, validateFleet, randomFleet,
  canTarget, targetOptions, fireAt, fleetSunk, battleScore,
} from "./battleship.js";
import { chooseShots, remember, freshMemory, DIFFICULTIES } from "./ai.js";
import { recordMatch, readRatings } from "./firestore.js";
import { announceRoom } from "./rooms.js";
import { applyBounty } from "./report-bounty.js";
import { sessionGain, fieldMmrFor, beltFor } from "./mmr.js";

const IDLE_SHUTDOWN_MS = 30 * 60_000;
// Thirty seconds a turn. With eight captains a slow table is a dead table,
// and picking a target and two squares is not a thirty-second problem.
const TURN_MS = 30_000;
const MIN_PLAYERS = 2;

// One instance per battle. Fleets never leave this object: a client is told
// only what it has hit, never where anything is.
export class BattleRoyale {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      this.g = (await state.storage.get("game")) || null;
    });
  }

  // ---------------------------------------------------------------- plumbing

  persist() { return this.state.storage.put({ game: this.g }); }
  sockets() { return this.state.getWebSockets(); }

  send(ws, type, payload = {}) {
    try { ws.send(JSON.stringify({ type, ...payload })); } catch { /* gone */ }
  }

  broadcast(type, payload = {}) {
    const msg = JSON.stringify({ type, ...payload });
    for (const ws of this.sockets()) { try { ws.send(msg); } catch { /* gone */ } }
  }

  socketFor(uid) {
    return this.sockets().find((ws) => {
      try { return ws.deserializeAttachment()?.uid === uid; } catch { return false; }
    });
  }

  connected() {
    const out = new Set();
    for (const ws of this.sockets()) {
      try { const a = ws.deserializeAttachment(); if (a?.uid) out.add(a.uid); } catch { /* gone */ }
    }
    return out;
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
      game: "battleship",
      code: this.g.code,
      host: this.nameOf(this.g.players[this.g.hostUid]) || "Someone",
      players: this.connected().size,
      phase: this.g.phase,
      label: this.g.solo ? "Solo" : "Battleship Royale",
      round: this.g.round,
    });
  }

  log(text) {
    this.g.feed.unshift({ at: Date.now(), text });
    this.g.feed = this.g.feed.slice(0, 80);
    this.broadcast("BATTLE_FEED", { entry: this.g.feed[0] });
  }

  // ------------------------------------------------------------- connections

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("This endpoint speaks WebSocket only.", { status: 426 });

    const uid = request.headers.get("X-Dojo-Uid");
    const name = request.headers.get("X-Dojo-Name") || "Captain";
    const code = request.headers.get("X-Dojo-Code") || "battle";
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
        code,
        phase: "LOBBY",
        hostUid: uid,
        players: {},
        order: [],
        turnUid: null,
        turnEndsAt: null,
        solo: false,
        aiLevel: "medium",
        anon: false,
        aliases: {},
        feed: [],
        chat: [],
        round: 0,
        eliminated: [],
      };
    }

    const p = this.g.players[uid];
    if (p) p.name = name;
    else {
      const midBattle = this.g.phase === "ACTIVE";
      this.g.players[uid] = {
        uid, name, joinedAt: Date.now(),
        ready: false,
        // Alive means "in the battle with a fleet". A latecomer is neither
        // sunk nor fighting until they have placed one.
        alive: !midBattle,
        placing: midBattle,
        board: null, history: [], hits: 0, sunk: 0,
      };
      if (midBattle) {
        this.g.players[uid].mmrAtStart = 0;
        this.log(`${name} arrived and is placing a fleet.`);
      }
    }

    await this.persist();
    this.send(ws, "BATTLE_WELCOME", { you: uid, isHost: this.g.hostUid === uid, size: SIZE, fleet: FLEET });
    this.pushState();
    this.announce();
    for (const entry of [...this.g.feed].reverse()) this.send(ws, "BATTLE_FEED", { entry });
    for (const m of this.g.chat.slice(-30)) this.send(ws, "BATTLE_CHAT", m);

    await this.state.storage.deleteAlarm().catch(() => {});
    if (this.g.phase === "ACTIVE" && this.g.turnEndsAt)
      await this.state.storage.setAlarm(this.g.turnEndsAt);
  }

  /** Public view. A player's own board is sent only to them. */
  publicState() {
    const online = this.connected();
    return {
      code: this.g.code,
      phase: this.g.phase,
      hostUid: this.g.hostUid,
      solo: !!this.g.solo,
      aiLevel: this.g.aiLevel,
      difficulties: DIFFICULTIES,
      turnUid: this.g.turnUid,
      turnEndsAt: this.g.turnEndsAt,
      round: this.g.round,
      size: SIZE,
      anon: !!this.g.anon,
      players: Object.values(this.g.players).map((p) => ({
        uid: p.uid,
        name: this.nameOf(p),
        alive: p.alive,
        ready: p.ready,
        placing: !!p.placing,
        online: online.has(p.uid),
        // Where they've been hit is public; where their ships are is not.
        incoming: p.board?.incoming || [],
        struck: p.board ? p.board.ships.flatMap((s) => s.hits) : [],
        sunkShips: p.board ? p.board.ships.filter((s) => s.sunk).map((s) => s.name) : [],
        sunkCells: p.board ? p.board.ships.filter((s) => s.sunk).flatMap((s) => s.cells) : [],
        remaining: p.board ? p.board.ships.filter((s) => !s.sunk).length : FLEET.length,
        hits: p.hits,
      })),
    };
  }

  pushState() {
    const base = this.publicState();
    for (const ws of this.sockets()) {
      let uid = null;
      try { uid = ws.deserializeAttachment()?.uid; } catch { /* gone */ }
      const me = uid && this.g.players[uid];
      this.send(ws, "BATTLE_STATE", {
        game: base,
        yourFleet: me?.board ? me.board.ships.map((s) => ({
          id: s.id, name: s.name, len: s.len, cells: s.cells, hits: s.hits, sunk: !!s.sunk,
        })) : null,
        targets: me && this.g.phase === "ACTIVE" && this.g.turnUid === uid
          ? targetOptions(uid, this.g.players, me.history).map((t) => ({
            ...t, name: this.nameOf(this.g.players[t.uid]),
          }))
          : [],
      });
    }
  }

  // ---------------------------------------------------------------- messages

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const who = ws.deserializeAttachment();
    if (!who?.uid || !this.g) return;
    const uid = who.uid;

    try {
      switch (msg.type) {
        case "PING": return this.beat();
        case "BATTLE_PLACE":  return await this.place(ws, uid, msg);
        case "BATTLE_RANDOM": return await this.place(ws, uid, { placements: randomFleet() });
        case "BATTLE_SOLO":   return await this.setSolo(ws, uid, msg);
        case "BATTLE_ANON":   return await this.setAnon(ws, uid, msg);
        case "BATTLE_START":  return await this.start(ws, uid);
        case "BATTLE_END":    return await this.endEarly(ws, uid);
        case "BATTLE_FIRE":   return await this.fire(ws, uid, msg);
        case "BATTLE_SAY":    return await this.say(uid, msg);
        default: return this.send(ws, "BATTLE_ERROR", { message: "Unrecognised message." });
      }
    } catch (err) {
      this.send(ws, "BATTLE_ERROR", { message: String(err?.message || err) });
    }
  }

  async place(ws, uid, msg) {
    if (this.g.phase === "OVER")
      return this.send(ws, "BATTLE_ERROR", { message: "That battle is finished." });
    const p = this.g.players[uid];
    if (!p) return;

    const check = validateFleet(msg.placements);
    if (!check.ok) return this.send(ws, "BATTLE_ERROR", { message: check.error });

    const joiningLate = this.g.phase === "ACTIVE" && !p.board;

    p.board = { ships: check.ships, incoming: [] };
    p.ready = true;

    if (joiningLate) {
      // Into the rotation behind whoever is firing, so they wait one turn
      // rather than jumping the queue or waiting a whole lap.
      p.placing = false;
      p.alive = true;
      const at = this.g.order.indexOf(this.g.turnUid);
      if (at === -1) this.g.order.push(uid);
      else this.g.order.splice(at + 1, 0, uid);
      this.log(`${this.nameOf(p)} joined the battle.`);
    } else {
      this.log(`${this.nameOf(p)} is ready.`);
    }

    await this.persist();
    this.pushState();
  }

  async setSolo(ws, uid, msg) {
    if (uid !== this.g.hostUid)
      return this.send(ws, "BATTLE_ERROR", { message: "Only the host sets this." });
    if (this.g.phase !== "LOBBY")
      return this.send(ws, "BATTLE_ERROR", { message: "The fleets are already at sea." });

    this.g.solo = !!msg.on;
    if (msg.level && DIFFICULTIES.some((d) => d.id === msg.level)) this.g.aiLevel = msg.level;
    await this.persist();
    this.pushState();
  }

  async setAnon(ws, uid, msg) {
    if (uid !== this.g.hostUid)
      return this.send(ws, "BATTLE_ERROR", { message: "Only the host sets this." });
    if (this.g.phase !== "LOBBY")
      return this.send(ws, "BATTLE_ERROR", { message: "The fleets are already at sea." });
    this.g.anon = !!msg.on;
    await this.persist();
    this.pushState();
  }

  /**
   * What everyone else is called. Under anonymous play a captain is a number
   * until the battle ends — you can't gang up on someone you can't identify.
   * Real names come back with the results.
   */
  nameOf(p) {
    if (!p) return "Someone";
    if (!this.g.anon || this.g.phase === "OVER") return p.name;
    return this.g.aliases[p.uid] || "A captain";
  }

  /** The computer opponent, added at start and removed with the game. */
  aiUid() { return "ai"; }

  isAi(uid) { return uid === this.aiUid(); }

  async start(ws, uid) {
    if (uid !== this.g.hostUid)
      return this.send(ws, "BATTLE_ERROR", { message: "Only the host starts the battle." });
    if (this.g.phase !== "LOBBY")
      return this.send(ws, "BATTLE_ERROR", { message: "Already under way." });

    const online = this.connected();

    if (this.g.solo) {
      const level = DIFFICULTIES.find((d) => d.id === this.g.aiLevel) || DIFFICULTIES[1];
      const check = validateFleet(randomFleet());
      this.g.players[this.aiUid()] = {
        uid: this.aiUid(),
        name: `Sensei (${level.name})`,
        joinedAt: Date.now(),
        ready: true, alive: true, ai: true, aiLevel: level.id,
        memory: freshMemory(),
        board: { ships: check.ships, incoming: [] },
        history: [], hits: 0, sunk: 0, mmrAtStart: 0, seed: 2,
      };
    }

    const roster = Object.values(this.g.players).filter((p) => online.has(p.uid) || p.ai);
    if (roster.length < MIN_PLAYERS)
      return this.send(ws, "BATTLE_ERROR", { message: `Needs at least ${MIN_PLAYERS} captains.` });

    // Anyone who never placed gets a random fleet rather than blocking everyone.
    for (const p of roster) {
      if (!p.board) {
        const check = validateFleet(randomFleet());
        p.board = { ships: check.ships, incoming: [] };
        this.log(`${this.nameOf(p)} was given a random fleet.`);
      }
      p.alive = true;
      p.ready = true;
    }

    for (const p of Object.values(this.g.players)) {
      if (!online.has(p.uid) && !p.ai) { p.alive = false; p.board = p.board || null; }
    }

    // Ratings are read once, so seeding reflects where captains stood going in.
    const uids = roster.map((p) => p.uid);
    const human = uids.filter((u) => !this.isAi(u));
    try {
      const ratings = await readRatings(this.env, human);
      const seeded = [...uids].sort((a, b) => (ratings[b] || 0) - (ratings[a] || 0));
      for (const u of uids) if (!(u in ratings)) ratings[u] = 0;
      seeded.forEach((u, i) => {
        this.g.players[u].mmrAtStart = ratings[u] || 0;
        this.g.players[u].seed = i + 1;
      });
    } catch {
      uids.forEach((u, i) => { this.g.players[u].mmrAtStart = 0; this.g.players[u].seed = i + 1; });
    }

    this.g.order = uids.sort(() => Math.random() - 0.5);

    // Aliases are handed out in an order unrelated to seating or seeding, so
    // the numbering itself gives nothing away.
    if (this.g.anon) {
      const shuffled = [...uids].sort(() => Math.random() - 0.5);
      this.g.aliases = {};
      shuffled.forEach((u, i) => { this.g.aliases[u] = `Captain ${i + 1}`; });
    }
    this.g.phase = "ACTIVE";
    this.g.startedAt = Date.now();
    this.g.round = 1;
    this.g.turnUid = this.g.order[0];
    this.g.turnEndsAt = Date.now() + TURN_MS;

    await this.persist();
    await this.state.storage.setAlarm(this.g.turnEndsAt);
    this.log(this.g.solo
      ? `Solo match against ${this.g.players[this.aiUid()].name}.`
      : `Battle begins with ${roster.length} captains.`);
    this.pushState();
    await this.runAi();
  }

  /**
   * Plays out the computer's turn, and any that follow it. The AI shoots from
   * its own memory only — it never reads the fleet it is firing at.
   */
  async runAi() {
    let guard = 0;
    while (this.g.phase === "ACTIVE" && this.isAi(this.g.turnUid) && guard++ < 12) {
      const me = this.g.players[this.g.turnUid];
      const foes = Object.values(this.g.players).filter((p) => p.alive && p.uid !== me.uid);
      if (!foes.length) break;

      const target = foes[Math.floor(Math.random() * foes.length)];
      me.memory = me.memory || freshMemory();
      const cells = chooseShots(me.memory, SIZE, me.aiLevel || "medium", SHOTS_PER_TURN)
        .filter((c) => !target.board.incoming.includes(c));
      if (!cells.length) break;

      let hits = 0;
      const sunkNames = [];
      for (const cell of cells) {
        const shot = fireAt(target.board, cell);
        remember(me.memory, cell, shot.result);
        if (shot.result === "hit") { hits++; me.hits++; }
        if (shot.result === "sunk") { hits++; me.hits++; me.sunk++; sunkNames.push(shot.ship); }
      }
      me.history.push(target.uid);

      let line = `${this.nameOf(me)} fired ${cells.length} shots at ${this.nameOf(target)}: ${hits} Hit, ${cells.length - hits} Miss`;
      if (sunkNames.length) line += ` — sank their ${sunkNames.join(" and ")}`;
      this.log(line + ".");

      if (fleetSunk(target.board)) {
        target.alive = false;
        this.g.eliminated.push(target.uid);
        this.log(`${this.nameOf(target)} has been sunk.`);
      }

      if (Object.values(this.g.players).filter((p) => p.alive).length <= 1) { await this.finish(); return; }
      await this.nextTurn();
    }
  }

  /**
   * Calls the battle before anyone is sunk. Everything still standing is
   * ranked by damage dealt, and MMR is awarded exactly as it would be at a
   * natural finish — stopping early costs nobody their round.
   */
  async endEarly(ws, uid) {
    if (uid !== this.g.hostUid)
      return this.send(ws, "BATTLE_ERROR", { message: "Only the host can end the match." });
    if (this.g.phase !== "ACTIVE")
      return this.send(ws, "BATTLE_ERROR", { message: "No battle is running." });
    this.log("The host called the match.");
    await this.finish();
  }

  async fire(ws, uid, msg) {
    if (this.g.phase !== "ACTIVE") return;
    if (this.g.turnUid !== uid)
      return this.send(ws, "BATTLE_ERROR", { message: "Not your turn." });

    const me = this.g.players[uid];
    const target = this.g.players[msg.target];
    if (!target || !target.alive || !target.board || target.uid === uid)
      return this.send(ws, "BATTLE_ERROR", { message: "Pick a live opponent." });

    const aliveOpponents = Object.values(this.g.players)
      .filter((p) => p.alive && p.board && p.uid !== uid).length;
    const verdict = canTarget(me.history, target.uid, aliveOpponents);
    if (!verdict.ok) return this.send(ws, "BATTLE_ERROR", { message: verdict.error });

    const cells = [...new Set((msg.cells || []).map(String))].slice(0, SHOTS_PER_TURN);
    if (cells.length !== SHOTS_PER_TURN)
      return this.send(ws, "BATTLE_ERROR", { message: `Choose ${SHOTS_PER_TURN} different squares.` });
    for (const cell of cells) {
      const [r, c] = cell.split(",").map(Number);
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= SIZE || c >= SIZE)
        return this.send(ws, "BATTLE_ERROR", { message: "That square isn't on the board." });
      if (target.board.incoming.includes(cell))
        return this.send(ws, "BATTLE_ERROR", { message: "You've already fired there." });
    }

    let hits = 0, sunkNames = [];
    for (const cell of cells) {
      const shot = fireAt(target.board, cell);
      if (shot.result === "hit") { hits++; me.hits++; }
      if (shot.result === "sunk") { hits++; me.hits++; me.sunk++; sunkNames.push(shot.ship); }
    }

    me.history.push(target.uid);

    const misses = cells.length - hits;
    let line = `${this.nameOf(me)} fired ${cells.length} shots at ${this.nameOf(target)}: ${hits} Hit, ${misses} Miss`;
    if (sunkNames.length) line += ` — sank their ${sunkNames.join(" and ")}`;
    this.log(line + ".");

    if (fleetSunk(target.board)) {
      target.alive = false;
      this.g.eliminated.push(target.uid);
      this.log(`${this.nameOf(target)} has been sunk.`);
    }

    const left = Object.values(this.g.players).filter((p) => p.alive && p.board);
    if (left.length <= 1) { await this.finish(); return; }

    await this.nextTurn();
    await this.runAi();
  }

  async nextTurn() {
    const order = this.g.order.filter((u) => {
      const p = this.g.players[u];
      return p?.alive && p.board;
    });
    const at = order.indexOf(this.g.turnUid);
    this.g.turnUid = order[(at + 1) % order.length];
    if (order.indexOf(this.g.turnUid) === 0) this.g.round += 1;
    this.g.turnEndsAt = Date.now() + TURN_MS;

    await this.persist();
    await this.state.storage.setAlarm(this.g.turnEndsAt);
    this.pushState();
  }

  async finish() {
    this.g.phase = "OVER";
    this.g.turnUid = null;
    this.g.turnEndsAt = null;
    await this.state.storage.deleteAlarm().catch(() => {});

    // Last standing first, then reverse order of elimination.
    const survivors = Object.values(this.g.players)
      .filter((p) => p.alive && p.board)
      .sort((a, b) => (b.sunk - a.sunk) || (b.hits - a.hits))
      .map((p) => p.uid);
    const finishOrder = [...survivors, ...[...this.g.eliminated].reverse()];
    const field = finishOrder.length;

    const ratings = Object.fromEntries(
      finishOrder.map((u) => [u, this.g.players[u]?.mmrAtStart || 0])
    );
    const mode = field >= 3 ? "rumble" : "match";

    const results = finishOrder.map((uid, i) => {
      const p = this.g.players[uid];
      const placement = i + 1;
      const score = battleScore({
        hits: p.hits, sunk: p.sunk, placement, field, survived: p.alive,
      });
      const gain = sessionGain({
        score,
        completed: true,
        playerMmr: p.mmrAtStart || 0,
        fieldMmr: fieldMmrFor(uid, ratings),
        mode,
        seed: p.seed,
        placement,
      });
      const after = (p.mmrAtStart || 0) + gain.total;
      return {
        uid, name: p.name, score, placement, seed: p.seed || null,
        hits: p.hits, sunk: p.sunk, status: p.alive ? "won" : "sunk",
        mmrBefore: p.mmrAtStart || 0, gain: gain.total,
        breakdown: { base: gain.base, challenge: gain.challenge, completion: gain.completion, seed: gain.seed },
        mmrAfter: after, belt: beltFor(after).name,
        promoted: beltFor(after).name !== beltFor(p.mmrAtStart || 0).name,
      };
    });

    const bounty = await applyBounty(this.env, this.state, {
      mode, durationMs: Date.now() - (this.g.startedAt || Date.now() - 60_000), results,
    });

    await this.persist();
    this.log(`${results[0]?.name || "Nobody"} takes the sea.`);
    const champ = this.g.players[finishOrder[0]];
    const reveal = champ?.board ? {
      name: this.nameOf(champ),
      size: SIZE,
      ships: champ.board.ships.map((sh) => ({
        name: sh.name, cells: sh.cells, hits: sh.hits, sunk: !!sh.sunk,
      })),
      incoming: champ.board.incoming || [],
    } : null;

    this.broadcast("BATTLE_OVER", { results, mode, bounty, reveal });
    this.pushState();
    this.announce();

    const human = results.filter((r) => !this.isAi(r.uid));
    if (human.length) {
      this.state.waitUntil?.(
        recordMatch(this.env, {
          code: this.g.code, roundNo: this.g.round, puzzleId: "battleship",
          game: "battleship", mode: human.length >= 3 ? "rumble" : "match",
          finishedAt: Date.now(), results: human,
        }).then((ok) => { if (!ok) console.error(`[battleship] results were not saved`); }).catch((e) => console.error(`[battleship] ${e.message}`))
      );
    }
  }

  async say(uid, msg) {
    const p = this.g.players[uid];
    const text = String(msg.text || "").trim().slice(0, 200);
    if (!text) return;
    const entry = { uid, name: this.nameOf(p) || "Captain", text, at: Date.now() };
    this.g.chat.push(entry);
    this.g.chat = this.g.chat.slice(-60);
    await this.persist();
    this.broadcast("BATTLE_CHAT", entry);
  }

  // ------------------------------------------------------------------ alarms

  async alarm() {
    if (this.g?.phase === "ACTIVE" && Date.now() >= (this.g.turnEndsAt || 0)) {
      this.log(`${this.nameOf(this.g.players[this.g.turnUid])} ran out of time.`);
      await this.nextTurn();
      return;
    }
    if (this.sockets().length === 0) {
      await this.state.storage.deleteAll();
      this.g = null;
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

    // A captain who leaves mid-battle keeps their fleet: the turn timer moves
    // play along, and they can reconnect to it.
    await this.persist();
    this.pushState();
    this.announce();

    if (online.size === 0 && this.g.phase !== "ACTIVE")
      await this.state.storage.setAlarm(Date.now() + IDLE_SHUTDOWN_MS);
  }
}
