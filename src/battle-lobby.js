import {
  SIZE, FLEET, SHOTS_PER_TURN, validateFleet, randomFleet, mapOf, fleetFor, MAPS,
  normalizeVolley, aiTargets, accuracyBonus,
  canTarget, targetOptions, fireAt, fleetSunk, battleScore,
} from "./battleship.js";
import { chooseShots, remember, freshMemory, DIFFICULTIES } from "./ai.js";
import { recordMatch, readRatings, strikePlayer } from "./firestore.js";
import { moderate } from "./moderation.js";
import { announceRoom } from "./rooms.js";
import { applyBounty } from "./report-bounty.js";
import { sessionGain, fieldMmrFor, beltFor } from "./mmr.js";

const IDLE_SHUTDOWN_MS = 30 * 60_000;
// Thirty seconds a turn. With eight captains a slow table is a dead table,
// and picking a target and two squares is not a thirty-second problem.
const TURN_MS = 30_000;
const MIN_PLAYERS = 2;
const MAX_AI = 5;              // a solo captain may face up to five computers
// A latecomer gets ten seconds to lay a fleet. Long enough to hit Random,
// short enough that the table is not held up by someone who wandered off.
const LATE_PLACE_MS = 10_000;
// The scoreboard is held for five seconds after the last ship goes down, so
// the closing state does not land on top of the result everyone is reading.
const RESULT_HOLD_MS = 5_000;

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

  /** The board this room is fought on, and what it costs to fire. */
  get map() { return mapOf(this.g?.mapId); }
  get fleet() { return fleetFor(this.g?.mapId); }

  /**
   * A captain's name as this viewer is allowed to see it.
   *
   * With names hidden they become Captain A, B, C \u2014 steady for the whole
   * round, because the cooldown rule asks you to remember who you have already
   * fired at, and that is impossible if the labels move about.
   */
  captainName(p, viewerUid) {
    if (!this.g.hideNames || p.uid === viewerUid) return p.name;
    const order = Object.keys(this.g.players).sort();
    const i = order.indexOf(p.uid);
    return `Captain ${String.fromCharCode(65 + (i % 26))}`;
  }

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
        mapId: "easy",        // which of the three theatres
        hideNames: false,     // captains shown as A, B, C
        useTokens: false,     // reserved: the token economy isn't built yet
        anon: false,
        aliases: {},
        feed: [],
        chat: [],
        round: 0,
        eliminated: [],
      };
    }

    // A room whose host has gone belongs to whoever is standing in it.
    const here = this.connected();
    here.add(uid);
    if (!here.has(this.g.hostUid)) {
      this.g.hostUid = uid;
    }

    const p = this.g.players[uid];
    if (p) p.name = name;
    else {
      const midBattle = this.g.phase === "ACTIVE";

      // The door closes for the endgame. Dropping a fresh fleet in front of
      // two captains who have fought each other down to their last ships
      // would decide their match for them.
      if (midBattle && this.liveCaptains().length <= MIN_PLAYERS) {
        return this.send(ws, "BATTLE_ERROR", {
          message: "This battle is down to the last two captains. Wait for the next one.",
        });
      }

      const now = Date.now();
      this.g.players[uid] = {
        uid, name, joinedAt: now,
        ready: false,
        // A latecomer is in the battle from the moment they arrive; what they
        // lack is a fleet. Everything that rotates or scores keys off having
        // a board, so being alive without one holds their seat and no more.
        alive: true,
        placing: midBattle,
        placingUntil: midBattle ? now + LATE_PLACE_MS : null,
        board: null, history: [], hits: 0, sunk: 0,
      };
      if (midBattle) {
        this.g.players[uid].mmrAtStart = 0;
        // Behind whoever is firing, so they wait one turn rather than
        // jumping the queue or sitting out a whole lap.
        const at = this.g.order.indexOf(this.g.turnUid);
        if (at === -1) this.g.order.push(uid);
        else this.g.order.splice(at + 1, 0, uid);
        this.log(`${name} arrived and is placing a fleet.`);
        this.send(ws, "BATTLE_LATE", { placeBy: now + LATE_PLACE_MS, serverNow: now });
      }
    }

    await this.persist();
    this.send(ws, "BATTLE_WELCOME", {
      you: uid, isHost: this.g.hostUid === uid,
      size: this.map.size, fleet: this.fleet, shots: this.map.shots,
      mapId: this.g.mapId, maps: Object.values(MAPS),
      hideNames: !!this.g.hideNames, useTokens: !!this.g.useTokens,
    });
    this.pushState();
    this.announce();
    for (const entry of [...this.g.feed].reverse()) this.send(ws, "BATTLE_FEED", { entry });
    for (const m of this.g.chat.slice(-30)) this.send(ws, "BATTLE_CHAT", m);

    await this.state.storage.deleteAlarm().catch(() => {});
    await this.armAlarm();
  }

  /** Captains in the fight: alive and with a fleet on the water. */
  liveCaptains() {
    return Object.values(this.g.players).filter((p) => p.alive && p.board);
  }

  /**
   * The next moment this battle needs attention: the turn buzzer, or a
   * latecomer's placement clock, whichever comes first. A Durable Object gets
   * one alarm, so the soonest deadline wins and the rest are re-armed after.
   */
  nextDeadline() {
    const times = [];
    if (this.g.phase === "ACTIVE" && this.g.turnEndsAt) times.push(this.g.turnEndsAt);
    for (const p of Object.values(this.g.players))
      if (p.placing && p.placingUntil != null) times.push(p.placingUntil);
    return times.length ? Math.min(...times) : null;
  }

  async armAlarm() {
    const at = this.nextDeadline();
    if (at) await this.state.storage.setAlarm(at);
  }

  /** Public view. A player's own board is sent only to them. */
  publicState() {
    const online = this.connected();
    return {
      code: this.g.code,
      phase: this.g.phase,
      hostUid: this.g.hostUid,
      mapId: this.g.mapId,
      maps: Object.values(MAPS),
      aiCount: this.aiCount(),
      maxAi: MAX_AI,
      hideNames: !!this.g.hideNames,
      useTokens: !!this.g.useTokens,
      solo: !!this.g.solo,
      aiLevel: this.g.aiLevel,
      difficulties: DIFFICULTIES,
      turnUid: this.g.turnUid,
      turnEndsAt: this.g.turnEndsAt,
      round: this.g.round,
      size: this.map.size,
      shots: this.map.shots,
      fleet: this.fleet,
      anon: !!this.g.anon,
      players: Object.values(this.g.players).map((p) => ({
        uid: p.uid,
        name: this.nameOf(p),
        alive: p.alive,
        ready: p.ready,
        placing: !!p.placing,
        placingUntil: p.placingUntil ?? null,
        online: online.has(p.uid),
        // Where they've been hit is public; where their ships are is not.
        incoming: p.board?.incoming || [],
        struck: p.board ? p.board.ships.flatMap((s) => s.hits) : [],
        sunkShips: p.board ? p.board.ships.filter((s) => s.sunk).map((s) => s.name) : [],
        sunkCells: p.board ? p.board.ships.filter((s) => s.sunk).flatMap((s) => s.cells) : [],
        remaining: p.board ? p.board.ships.filter((s) => !s.sunk).length : this.fleet.length,
        hits: p.hits,
        shots: p.shots || 0,
      })),
    };
  }

  pushState() {
    const base = this.publicState();
    for (const ws of this.sockets()) {
      let uid = null;
      try { uid = ws.deserializeAttachment()?.uid; } catch { /* gone */ }
      const me = uid && this.g.players[uid];

      // Hiding names is per viewer, not per room: you always know your own.
      const game = this.g.hideNames
        ? { ...base, players: base.players.map((p) => ({
            ...p, name: this.captainName(this.g.players[p.uid], uid),
          })) }
        : base;

      this.send(ws, "BATTLE_STATE", {
        game,
        yourFleet: me?.board ? me.board.ships.map((s) => ({
          id: s.id, name: s.name, len: s.len, cells: s.cells, hits: s.hits, sunk: !!s.sunk,
        })) : null,
        targets: me && this.g.phase === "ACTIVE" && this.g.turnUid === uid
          ? targetOptions(uid, this.g.players, me.history).map((t) => ({
            ...t, name: this.captainName(this.g.players[t.uid], uid),
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
        case "BATTLE_RANDOM": return await this.place(ws, uid, { placements: randomFleet(this.g.mapId) });
        case "BATTLE_SOLO":   return await this.setSolo(ws, uid, msg);
        case "BATTLE_ANON":   return await this.setAnon(ws, uid, msg);
        case "BATTLE_MAP":    return await this.setMap(ws, uid, msg);
        case "BATTLE_TOGGLE": return await this.setToggle(ws, uid, msg);
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

    const check = validateFleet(msg.placements, this.g.mapId);
    if (!check.ok) return this.send(ws, "BATTLE_ERROR", { message: check.error });

    const joiningLate = this.g.phase === "ACTIVE" && !p.board;

    p.board = { ships: check.ships, incoming: [] };
    p.ready = true;

    if (joiningLate) {
      p.placing = false;
      p.placingUntil = null;
      p.alive = true;
      // Their slot in the rotation was taken when they walked in.
      if (!this.g.order.includes(uid)) this.g.order.push(uid);
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
    // How many computers, one difficulty for the lot. One is the default.
    if (msg.count != null) this.g.aiCount = Math.max(1, Math.min(MAX_AI, Math.round(Number(msg.count)) || 1));
    await this.persist();
    this.pushState();
  }

  /**
   * The host picks the board, and it has to be before the fleets go down —
   * changing the size underneath a placed fleet would put ships in the sea.
   */
  async setMap(ws, uid, msg) {
    if (uid !== this.g.hostUid)
      return this.send(ws, "BATTLE_ERROR", { message: "Only the host sets this." });
    if (this.g.phase !== "LOBBY")
      return this.send(ws, "BATTLE_ERROR", { message: "The fleets are already at sea." });
    if (!MAPS[msg.mapId])
      return this.send(ws, "BATTLE_ERROR", { message: "No such chart." });

    this.g.mapId = msg.mapId;
    // Any fleet already placed was laid out on the old board, so it goes.
    for (const p of Object.values(this.g.players)) {
      if (p.ai) continue;
      p.board = null;
      p.ready = false;
    }
    this.log(`Chart set: ${MAPS[msg.mapId].name} \u2014 ${MAPS[msg.mapId].size}\u00d7${MAPS[msg.mapId].size}, ${MAPS[msg.mapId].shots} shots a turn.`);
    await this.persist();
    this.pushState();
  }

  /** Both switches the host holds, neither of which changes the rules mid-round. */
  async setToggle(ws, uid, msg) {
    if (uid !== this.g.hostUid)
      return this.send(ws, "BATTLE_ERROR", { message: "Only the host sets this." });
    if (msg.what === "hideNames") {
      this.g.hideNames = !!msg.on;
      this.log(this.g.hideNames ? "Captains' names are hidden." : "Captains' names are shown.");
    }
    if (msg.what === "useTokens") {
      if (this.g.phase !== "LOBBY")
        return this.send(ws, "BATTLE_ERROR", { message: "Set this before the fleets sail." });
      this.g.useTokens = !!msg.on;
      this.log(this.g.useTokens ? "Tokens are on for this battle." : "Tokens are off for this battle.");
    }
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

  /** The computer opponents, added at start and removed with the game. */
  aiUid(i = 0) { return i ? `ai${i + 1}` : "ai"; }

  isAi(uid) { return typeof uid === "string" && /^ai\d*$/.test(uid); }

  aiCount() { return Math.max(1, Math.min(MAX_AI, Number(this.g.aiCount) || 1)); }

  async start(ws, uid) {
    if (uid !== this.g.hostUid)
      return this.send(ws, "BATTLE_ERROR", { message: "Only the host starts the battle." });
    if (this.g.phase !== "LOBBY")
      return this.send(ws, "BATTLE_ERROR", { message: "Already under way." });

    const online = this.connected();

    // Computers from a previous setting go; the ones asked for now come.
    for (const uid of Object.keys(this.g.players)) if (this.isAi(uid)) delete this.g.players[uid];
    if (this.g.solo) {
      const level = DIFFICULTIES.find((d) => d.id === this.g.aiLevel) || DIFFICULTIES[1];
      const n = this.aiCount();
      const ROMAN = ["", " I", " II", " III", " IV", " V"];
      for (let i = 0; i < n; i++) {
        const check = validateFleet(randomFleet(this.g.mapId), this.g.mapId);
        this.g.players[this.aiUid(i)] = {
          uid: this.aiUid(i),
          name: `Sensei${n > 1 ? ROMAN[i + 1] : ""} (${level.name})`,
          joinedAt: Date.now(),
          ready: true, alive: true, ai: true, aiLevel: level.id,
          memories: {},          // one memory per board it fires at
          board: { ships: check.ships, incoming: [] },
          history: [], hits: 0, sunk: 0, shots: 0, mmrAtStart: 0, seed: 2 + i,
        };
      }
    }

    const roster = Object.values(this.g.players).filter((p) => online.has(p.uid) || p.ai);
    if (roster.length < MIN_PLAYERS)
      return this.send(ws, "BATTLE_ERROR", { message: `Needs at least ${MIN_PLAYERS} captains.` });

    // Anyone who never placed gets a random fleet rather than blocking everyone.
    for (const p of roster) {
      p.shots = 0;
      p.eliminated = 0;
      if (!p.board) {
        const check = validateFleet(randomFleet(this.g.mapId), this.g.mapId);
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
      ? (this.aiCount() > 1
        ? `Solo match against ${this.aiCount()} computers (${this.g.players[this.aiUid()].aiLevel}).`
        : `Solo match against ${this.g.players[this.aiUid()].name}.`)
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
      const foes = Object.values(this.g.players).filter((p) => p.alive && p.board && p.uid !== me.uid);
      if (!foes.length) break;

      // The same rotation as a human, and a memory of each board it has
      // fired at rather than one for all of them: a hit on one captain's
      // water says nothing about another's.
      me.memories = me.memories || {};
      const level = me.aiLevel || "medium";
      const parts = aiTargets(me.history, foes, this.map.shots, level);
      let fired = false;
      for (const part of parts) {
        const target = this.g.players[part.target];
        if (!target?.alive || !target.board) continue;
        const memory = me.memories[target.uid] = me.memories[target.uid] || freshMemory();
        const cells = chooseShots(memory, this.map.size, level, part.count)
          .filter((c) => !target.board.incoming.includes(c));
        if (!cells.length) continue;
        this.salvo(me, target, cells, memory);
        fired = true;
      }
      if (!fired) break;
      me.history.push(...parts.map((p) => p.target));

      if (Object.values(this.g.players).filter((p) => p.alive && p.board).length <= 1) { await this.finish(); return; }
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
    // One target with its cells is the old shape; a volley spreads the same
    // shots over several. Both arrive here.
    const clean = normalizeVolley(msg.volley || [{ target: msg.target, cells: msg.cells }], this.map.shots);
    if (!clean.ok) return this.send(ws, "BATTLE_ERROR", { message: clean.error });

    const aliveOpponents = Object.values(this.g.players)
      .filter((p) => p.alive && p.board && p.uid !== uid).length;
    for (const part of clean.volley) {
      const target = this.g.players[part.target];
      if (target && target.uid !== uid && target.placing && !target.board)
        return this.send(ws, "BATTLE_ERROR", {
          message: `${this.nameOf(target)} is still laying their fleet.`,
        });
      if (!target || !target.alive || !target.board || target.uid === uid)
        return this.send(ws, "BATTLE_ERROR", { message: "Pick a live opponent." });
      const verdict = canTarget(me.history, target.uid, aliveOpponents);
      if (!verdict.ok) return this.send(ws, "BATTLE_ERROR", { message: verdict.error });
      for (const cell of part.cells) {
        const [r, c] = cell.split(",").map(Number);
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= this.map.size || c >= this.map.size)
          return this.send(ws, "BATTLE_ERROR", { message: "That square isn't on the board." });
        if (target.board.incoming.includes(cell))
          return this.send(ws, "BATTLE_ERROR", { message: "You've already fired there." });
      }
    }

    for (const part of clean.volley) {
      const target = this.g.players[part.target];
      this.salvo(me, target, part.cells);
    }
    // Everyone fired on this turn goes on the rotation together.
    me.history.push(...clean.volley.map((v) => v.target));

    const left = Object.values(this.g.players).filter((p) => p.alive && p.board);
    if (left.length <= 1) { await this.finish(); return; }

    await this.nextTurn();
    await this.runAi();
  }

  /**
   * One captain's shots at one board: applied, counted, announced, and the
   * board struck from the battle if that was the last of its fleet. Shared
   * by human volleys and the computer's.
   */
  salvo(me, target, cells, memory = null) {
    let hits = 0;
    const sunkNames = [];
    for (const cell of cells) {
      const shot = fireAt(target.board, cell);
      if (memory) remember(memory, cell, shot.result);
      if (shot.result === "hit") { hits++; me.hits++; }
      if (shot.result === "sunk") { hits++; me.hits++; me.sunk++; sunkNames.push(shot.ship); }
    }
    me.shots = (me.shots || 0) + cells.length;

    let line = `${this.nameOf(me)} fired ${cells.length} shot${cells.length === 1 ? "" : "s"} at ${this.nameOf(target)}: ${hits} Hit, ${cells.length - hits} Miss`;
    if (sunkNames.length) line += ` — sank their ${sunkNames.join(" and ")}`;
    this.log(line + ".");

    if (fleetSunk(target.board)) {
      target.alive = false;
      me.eliminated = (me.eliminated || 0) + 1;
      this.g.eliminated.push(target.uid);
      this.log(`${this.nameOf(target)} has been sunk.`);
    }
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
    await this.armAlarm();
    this.pushState();
  }

  async finish() {
    this.g.phase = "OVER";
    this.g.turnUid = null;
    this.g.turnEndsAt = null;
    this.g.closesAt = Date.now() + RESULT_HOLD_MS;
    await this.state.storage.deleteAlarm().catch(() => {});
    await this.state.storage.setAlarm(this.g.closesAt);

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
        hits: p.hits, sunk: p.sunk, shots: p.shots || 0, placement, field, survived: p.alive,
        mapId: this.g.mapId,
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
        hits: p.hits, sunk: p.sunk, shots: p.shots || 0, eliminated: p.eliminated || 0,
        accuracy: p.shots ? Math.round((p.hits / p.shots) * 100) : 0,
        aim: Math.round(accuracyBonus(p.hits, p.shots || 0) * 100) / 100,
        status: p.alive ? "won" : "sunk",
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
      size: this.map.size,
      shots: this.map.shots,
      mapId: this.g.mapId,
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
          code: this.g.code, roundNo: this.g.round, puzzleId: "battleship", mapId: this.g.mapId,
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

  // ------------------------------------------------------------------ alarms

  async alarm() {
    if (this.g?.phase === "ACTIVE") {
      const now = Date.now();

      // Anyone who let the placement clock run out gets a random fleet. The
      // alternative is a permanent empty seat that nobody may fire at.
      let laid = false;
      for (const p of Object.values(this.g.players)) {
        if (!p.placing || p.board || p.placingUntil == null || now < p.placingUntil) continue;
        const check = validateFleet(randomFleet(this.g.mapId), this.g.mapId);
        if (!check.ok) continue;
        p.board = { ships: check.ships, incoming: [] };
        p.placing = false;
        p.placingUntil = null;
        p.ready = true;
        p.alive = true;
        if (!this.g.order.includes(p.uid)) this.g.order.push(p.uid);
        this.log(`${this.nameOf(p)} ran out of time; a fleet was laid for them.`);
        laid = true;
      }
      if (laid) { await this.persist(); this.pushState(); }

      if (now >= (this.g.turnEndsAt || 0)) {
        this.log(`${this.nameOf(this.g.players[this.g.turnUid])} ran out of time.`);
        await this.nextTurn();
        return;
      }

      // A battle in progress is never torn down for being empty: fleets and
      // the turn order have to survive everyone reconnecting.
      await this.armAlarm();
      return;
    }

    if (this.g?.phase === "OVER" && this.g.closesAt != null) {
      if (Date.now() < this.g.closesAt) {
        await this.state.storage.setAlarm(this.g.closesAt);
        return;
      }
      this.g.closesAt = null;
      await this.persist();
      // The table stays readable; it is simply no longer live.
      this.broadcast("BATTLE_CLOSED", {});
      this.pushState();
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
      if (heir && heir.uid !== this.g.hostUid) {
        this.g.hostUid = heir.uid;
        this.log(`${this.nameOf(heir)} is running the match now.`);
      }
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
