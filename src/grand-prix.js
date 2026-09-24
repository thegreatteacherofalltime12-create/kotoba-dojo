/**
 * Multiverse Grand Prix — one Durable Object per race.
 *
 * Everyone runs the same circuit at the same time and moves by answering
 * items. This first slice is the track itself: distance, laps, the live
 * order and the flag, on the words engine. Item boxes and computer drivers
 * come next, and the arsenal after that.
 *
 * Distance is a step, not a drift: a kart moves when its racer answers. The
 * design has karts coasting between answers, which would mean waking the
 * object several times a second for every race — not worth the burn until
 * the rest of it is proven. The browser slides the karts between positions,
 * so it reads as movement either way.
 */
import {
  CIRCUITS, LENGTHS, circuitById, lengthById, lapsFor, metresFor, capFor,
  distanceFor, raceScore, standings, levelMult,
  SPIN_COST, ITEMS, itemById, boxMarks, boxesBetween, rollItem, flared,
  SLIPSTREAM_M, COMET_M, SLICK_M, FOG_MS, SCRAMBLE_FOG_MS, FLARE_MS,
  AI_LEVELS, AI_MAX, AI_NAMES, AI_ALLOWANCE, aiPace, aiShouldFire,
} from "./prix.js";
import { ENGINES, engineById, engineList, defaultLevel, MEM_MAX } from "./prix-engines.js";
import { recordMatch, readRatings } from "./firestore.js";
import { moderate } from "./moderation.js";
import { strikePlayer } from "./firestore.js";
import { announceRoom } from "./rooms.js";
import { applyBounty } from "./report-bounty.js";
import { sessionGain, fieldMmrFor, beltFor, boosted } from "./mmr.js";

const IDLE_SHUTDOWN_MS = 30 * 60_000;
// Typing an answer is a handful of events; this is here to stop a script
// hammering the object, not to pace anybody.
const GUESSES_PER_SECOND = 8;
const GUESS_BURST = 20;
// Once the winner is home, the rest of the field has this long to get there.
// Without it a quick racer waits out the slowest Rookie on the grid, which
// is a worse way to spend a Saturday than any of this is meant to be.
const FLAG_GRACE_MS = 60_000;

export class GrandPrix {
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

  /** A guess budget per racer, refilled steadily. */
  allow(uid) {
    const now = Date.now();
    const b = this.buckets.get(uid) || { tokens: GUESS_BURST, at: now };
    b.tokens = Math.min(GUESS_BURST, b.tokens + ((now - b.at) / 1000) * GUESSES_PER_SECOND);
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
      game: "prix",
      code: this.g.code,
      host: this.g.players[this.g.hostUid]?.name || "Someone",
      players: this.connected().size,
      phase: this.g.phase,
      label: this.g.solo ? "Solo" : circuitById(this.g.circuit).name,
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
    const name = request.headers.get("X-Dojo-Name") || "Racer";
    const code = request.headers.get("X-Dojo-Code") || "prix";
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
        solo: false, circuit: "cinder", length: "gp",
        engine: "words", theme: "mixed",
        aiCount: 3, aiLevel: "medium",
        players: {}, startedAt: null, endsAt: null, round: 0, applied: {},
        votes: {}, chat: [], slicks: [], marks: [], flagAt: null,
      };
    }

    const p = this.g.players[uid];
    if (p) p.name = name;
    else this.g.players[uid] = this.freshRacer(uid, name);

    await this.persist();
    this.announce();
    this.send(ws, "PRIX_WELCOME", {
      you: uid, isHost: this.g.hostUid === uid,
      circuits: CIRCUITS, lengths: LENGTHS, engines: engineList(), aiLevels: AI_LEVELS, aiMax: AI_MAX,
    });
    for (const m of (this.g.chat || []).slice(-30)) this.send(ws, "PRIX_CHAT", m);
    this.pushState();

    // Back mid-race: the item in hand comes with it, minus the answer.
    const me = this.g.players[uid];
    if (this.g.phase === "RACING" && !me.watching && !me.done && me.item) {
      this.send(ws, "PRIX_ITEM", this.itemView(me));
    }

    await this.state.storage.deleteAlarm().catch(() => {});
    if (this.g.phase === "RACING" && this.g.endsAt) await this.state.storage.setAlarm(this.g.endsAt);
  }

  freshRacer(uid, name) {
    return {
      uid, name, joinedAt: Date.now(),
      watching: this.g.phase === "RACING",
      klass: defaultLevel(this.g.engine),
      at: 0, lap: 1, item: null, deck: [], seen: 0,
      // What is in your hands, and what somebody put on you. `item` is the
      // word you are answering; `holding` is the item box you picked up.
      holding: null, deflector: false, fogUntil: 0, slowUntil: 0, boxes: 0, fired: 0,
      solved: 0, spins: 0, ratioSum: 0,
      done: false, finishedAt: null, score: 0, mmrAtStart: 0, seed: null,
    };
  }

  // ------------------------------------------------------------------ state

  publicState() {
    const online = this.connected();
    const total = metresFor(this.g.circuit, this.g.length);
    const field = Object.values(this.g.players).filter((p) => !p.watching);
    const order = standings(field).map((p) => p.uid);
    return {
      code: this.g.code, phase: this.g.phase, hostUid: this.g.hostUid,
      solo: !!this.g.solo, circuit: this.g.circuit, length: this.g.length,
      aiCount: this.g.aiCount, aiLevel: this.g.aiLevel, aiLevels: AI_LEVELS, aiMax: AI_MAX,
      circuits: CIRCUITS, lengths: LENGTHS, engines: engineList(),
      engine: this.g.engine, theme: this.g.theme,
      laps: lapsFor(this.g.circuit, this.g.length),
      lapM: circuitById(this.g.circuit).lapM,
      total, endsAt: this.g.endsAt, round: this.g.round,
      items: ITEMS, marks: this.g.marks || [],
      slicks: (this.g.slicks || []).map((sl) => sl.at),
      votes: this.tally(),
      myVotes: this.g.votes || {},
      chatOpen: this.g.phase !== "RACING",
      players: Object.values(this.g.players).map((p) => ({
        uid: p.uid, name: p.name, online: online.has(p.uid),
        watching: !!p.watching, done: !!p.done,
        klass: p.klass, at: Math.round(p.at), lap: p.lap,
        solved: p.solved, spins: p.spins,
        ai: !!p.ai, aiLevel: p.aiLevel || null,
        holding: p.holding || null, deflector: !!p.deflector,
        fogged: (p.fogUntil || 0) > Date.now(), slowed: (p.slowUntil || 0) > Date.now(),
        place: p.watching ? null : order.indexOf(p.uid) + 1,
        finishedAt: p.finishedAt,
      })),
    };
  }

  pushState() { this.broadcast("PRIX_STATE", { game: this.publicState() }); }

  /**
   * What the grid voted for. Every circuit with a vote, most first.
   *
   * Only racers who are actually here count: a vote left behind by someone
   * who has gone home should not keep choosing the track.
   */
  tally() {
    const online = this.connected();
    const counts = {};
    for (const [uid, id] of Object.entries(this.g.votes || {})) {
      if (!online.has(uid)) continue;
      if (!CIRCUITS.some((c) => c.id === id)) continue;
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }

  /**
   * The circuit the vote settles on. Most votes wins; a tie is broken by
   * whichever of the leaders is already selected, so the track does not
   * flicker while people are still voting, and otherwise by track order.
   * No votes at all leaves whatever stands.
   */
  votedCircuit() {
    const counts = this.tally();
    const top = Math.max(0, ...Object.values(counts));
    if (!top) return this.g.circuit;
    const leaders = Object.keys(counts).filter((id) => counts[id] === top);
    if (leaders.includes(this.g.circuit)) return this.g.circuit;
    return CIRCUITS.find((c) => leaders.includes(c.id))?.id || this.g.circuit;
  }

  /** Settles the vote and says so, if it moved the track. */
  async settleVote() {
    const won = this.votedCircuit();
    if (won !== this.g.circuit) this.g.circuit = won;
    await this.persist();
    this.pushState();
  }

  /** What a racer may see of the item in their hands. Never the answer. */
  itemView(p) {
    const engine = engineById(this.g.engine);
    const it = p.item;
    // Somebody else's fog counts the same as an engine's own held clue.
    const hideFor = Math.max(engine.hideFor(it, it.dealtAt), Math.max(0, (p.fogUntil || 0) - Date.now()));
    return {
      ...engine.face(it, hideFor),
      engine: engine.id,
      kind: engine.kind,
      allowanceMs: it.allowance,
      dealtAt: it.dealtAt,
      serverNow: Date.now(),
      klass: p.klass,
    };
  }

  /** The next item for a racer, from whichever engine is running. */
  deal(p) {
    const engine = engineById(this.g.engine);
    p.item = {
      ...engine.deal(p.klass, p, Math.random, this.g.theme),
      dealtAt: Date.now(),
    };
    return p.item;
  }

  // ---------------------------------------------------------------- messages

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const who = ws.deserializeAttachment();
    if (!who?.uid || !this.g) return;

    try {
      switch (msg.type) {
        case "PING": return this.beat();
        case "PRIX_SOLO": return await this.setSolo(ws, who.uid, msg);
        case "PRIX_VOTE": return await this.vote(ws, who.uid, msg);
        case "PRIX_AI": return await this.setAi(ws, who.uid, msg);
        case "PRIX_ENGINE": return await this.setEngine(ws, who.uid, msg);
        case "PRIX_THEME": return await this.setTheme(ws, who.uid, msg);
        case "PRIX_SAY": return await this.say(ws, who.uid, msg);
        case "PRIX_LENGTH": return await this.setLength(ws, who.uid, msg);
        case "PRIX_CLASS": return await this.setClass(ws, who.uid, msg);
        case "PRIX_START": return await this.start(ws, who.uid);
        case "PRIX_GUESS": return await this.guess(ws, who.uid, msg);
        case "PRIX_SKIP": return await this.skip(ws, who.uid);
        case "PRIX_USE": return await this.use(ws, who.uid);
        case "PRIX_END_MATCH": {
          if (who.uid !== this.g.hostUid)
            return this.send(ws, "PRIX_ERROR", { message: "Only the host can end the race." });
          if (this.g.phase !== "RACING")
            return this.send(ws, "PRIX_ERROR", { message: "No race is running." });
          return await this.finish();
        }
        default: return this.send(ws, "PRIX_ERROR", { message: "Unrecognised message." });
      }
    } catch (err) {
      this.send(ws, "PRIX_ERROR", { message: String(err?.message || err) });
    }
  }

  hostOnly(ws, uid) {
    if (uid !== this.g.hostUid) { this.send(ws, "PRIX_ERROR", { message: "Only the host sets this." }); return false; }
    if (this.g.phase === "RACING") { this.send(ws, "PRIX_ERROR", { message: "A race is already running." }); return false; }
    return true;
  }

  async setSolo(ws, uid, msg) {
    if (!this.hostOnly(ws, uid)) return;
    this.g.solo = !!msg.on;
    await this.persist();
    this.pushState();
  }

  /**
   * Which engine the race runs on. Everyone's level goes back to that
   * engine's middle, because a word class means nothing to a maths race.
   */
  async setEngine(ws, uid, msg) {
    if (!this.hostOnly(ws, uid)) return;
    if (!ENGINES.some((e) => e.id === msg.engine)) return;
    this.g.engine = msg.engine;
    for (const p of Object.values(this.g.players)) { p.klass = defaultLevel(msg.engine); p.chose = false; p.deck = []; }
    await this.persist();
    this.pushState();
  }

  /** Which theme the trivia comes from, when trivia is what is running. */
  async setTheme(ws, uid, msg) {
    if (!this.hostOnly(ws, uid)) return;
    const themes = engineById("trivia").themes || [];
    if (msg.theme !== "mixed" && !themes.some((t) => t.id === msg.theme)) return;
    this.g.theme = msg.theme;
    for (const p of Object.values(this.g.players)) p.deck = [];
    await this.persist();
    this.pushState();
  }

  /** How many computers line up, and how quick they are. */
  async setAi(ws, uid, msg) {
    if (!this.hostOnly(ws, uid)) return;
    if (Number.isFinite(msg.count)) this.g.aiCount = Math.max(1, Math.min(AI_MAX, Math.round(msg.count)));
    if (AI_LEVELS.some((l) => l.id === msg.level)) this.g.aiLevel = msg.level;
    await this.persist();
    this.pushState();
  }

  /**
   * A racer's vote for the track. Anyone may vote, one each, changeable
   * until the lights go out — and the tally decides, so nobody has to be
   * the one who chose.
   */
  async vote(ws, uid, msg) {
    if (this.g.phase === "RACING")
      return this.send(ws, "PRIX_ERROR", { message: "The track is set." });
    if (!CIRCUITS.some((c) => c.id === msg.circuit))
      return this.send(ws, "PRIX_ERROR", { message: "No such circuit." });
    this.g.votes = this.g.votes || {};
    // Voting for what you already voted for takes it back.
    if (this.g.votes[uid] === msg.circuit) delete this.g.votes[uid];
    else this.g.votes[uid] = msg.circuit;
    await this.settleVote();
  }

  /**
   * The lobby's chat. It closes when the race starts: nobody is typing to
   * their friends while a clock is running, and a chat box in the middle of
   * a race is one more thing to read when you have no time to read it.
   */
  async say(ws, uid, msg) {
    if (this.g.phase === "RACING")
      return this.send(ws, "PRIX_ERROR", { message: "Chat is shut while the race is on." });
    const p = this.g.players[uid];
    const text = String(msg.text || "").trim().slice(0, 200);
    if (!text) return;
    // The same screen as the arena chat; a refused line is a strike.
    const verdict = await moderate(this.env, text);
    if (!verdict.ok) {
      const strikes = await strikePlayer(this.env, uid, p?.name || "Racer", { text, reason: verdict.reason, where: "grand prix chat" });
      return this.send(ws, "PRIX_ERROR", { message: `That doesn't belong here (${verdict.reason}). Strike ${strikes ?? "?"} of 3.` });
    }
    const entry = { uid, name: p?.name || "Racer", text, at: Date.now() };
    this.g.chat = [...(this.g.chat || []), entry].slice(-60);
    await this.persist();
    this.broadcast("PRIX_CHAT", entry);
  }

  async setLength(ws, uid, msg) {
    if (!this.hostOnly(ws, uid)) return;
    if (!LENGTHS.some((l) => l.id === msg.length)) return;
    this.g.length = msg.length;
    await this.persist();
    this.pushState();
  }

  /** A racer's own level. Theirs to set, not the host's. */
  async setClass(ws, uid, msg) {
    if (this.g.phase === "RACING")
      return this.send(ws, "PRIX_ERROR", { message: "Not once the lights are out." });
    const p = this.g.players[uid];
    if (!p || !engineById(this.g.engine).levels.some((c) => c.id === msg.klass)) return;
    p.klass = msg.klass;
    p.chose = true;
    await this.persist();
    this.pushState();
  }

  async start(ws, uid) {
    if (uid !== this.g.hostUid)
      return this.send(ws, "PRIX_ERROR", { message: "Only the host starts the race." });
    if (this.g.phase === "RACING")
      return this.send(ws, "PRIX_ERROR", { message: "A race is already running." });

    const online = this.connected();
    if (!this.g.solo && online.size < 2)
      return this.send(ws, "PRIX_ERROR", { message: "Wait for at least one more racer." });
    if (!online.size)
      return this.send(ws, "PRIX_ERROR", { message: "Nobody is here." });

    const uids = [...online];
    let ratings = Object.fromEntries(uids.map((u) => [u, 0]));
    try { ratings = await readRatings(this.env, uids); } catch { /* unranked */ }
    const seeded = [...uids].sort((a, b) => (ratings[b] || 0) - (ratings[a] || 0));

    for (const p of Object.values(this.g.players)) {
      const racing = online.has(p.uid);
      p.watching = !racing;
      p.at = 0; p.lap = 1; p.item = null; p.deck = [];
      p.holding = null; p.deflector = false; p.fogUntil = 0; p.slowUntil = 0;
      p.memLen = 0;
      p.boxes = 0; p.fired = 0;
      p.solved = 0; p.spins = 0; p.ratioSum = 0;
      p.done = false; p.finishedAt = null; p.score = 0;
      p.mmrAtStart = ratings[p.uid] || 0;
      p.seed = seeded.indexOf(p.uid) + 1 || null;
    }

    // Last race's computers go; the ones asked for now come.
    for (const id of Object.keys(this.g.players)) if (this.isAi(id)) delete this.g.players[id];
    if (this.g.solo) this.seatDrivers();

    this.g.marks = boxMarks(this.g.circuit, this.g.length);
    this.g.slicks = [];
    this.g.flagAt = null;

    const now = Date.now();
    this.g.phase = "RACING";
    this.g.round += 1;
    this.g.startedAt = now;
    this.g.endsAt = now + capFor(this.g.circuit, this.g.length);

    await this.persist();
    await this.armAlarm();
    this.announce();

    this.broadcast("PRIX_START", {
      circuit: circuitById(this.g.circuit),
      laps: lapsFor(this.g.circuit, this.g.length),
      total: metresFor(this.g.circuit, this.g.length),
      endsAt: this.g.endsAt, serverNow: now, round: this.g.round,
      chatOpen: false,
    });

    // Everyone gets their first item at the same moment.
    for (const ws2 of this.sockets()) {
      let u = null;
      try { u = ws2.deserializeAttachment()?.uid; } catch { /* gone */ }
      const p = u && this.g.players[u];
      if (p && !p.watching) { this.deal(p); this.send(ws2, "PRIX_ITEM", this.itemView(p)); }
    }
    await this.persist();
    this.pushState();
  }

  // ------------------------------------------------------------- the drivers
  //
  // A computer driver does not read a clue or unscramble anything. It
  // answers on a timer, and the room moves it exactly as it moves anybody
  // else — over the same boxes, through the same oil, under the same flare.

  isAi(uid) { return typeof uid === "string" && /^ai\d+$/.test(uid); }

  seatDrivers() {
    const level = AI_LEVELS.find((l) => l.id === this.g.aiLevel) || AI_LEVELS[1];
    const n = Math.max(1, Math.min(AI_MAX, this.g.aiCount || 3));
    for (let i = 0; i < n; i++) {
      const uid = `ai${i}`;
      this.g.players[uid] = {
        ...this.freshRacer(uid, `${AI_NAMES[i] || "Driver"} (${level.name})`),
        ai: true, aiLevel: level.id, watching: false,
        // A driver's first word is due one pace after the lights.
        nextAt: Date.now() + aiPace(level.id),
        seed: 2 + i,
      };
    }
  }

  /** When the room next has to wake up for a driver, or nothing. */
  nextDriverAt() {
    const due = Object.values(this.g.players)
      .filter((p) => p.ai && !p.done && !p.watching)
      .map((p) => Math.max(p.nextAt || 0, (p.fogUntil || 0)));
    return due.length ? Math.min(...due) : null;
  }

  /** The alarm is whichever comes first: a driver's next word, or the flag. */
  async armAlarm() {
    const when = [this.nextDriverAt(), this.g.endsAt, this.g.flagAt].filter(Boolean);
    if (when.length) await this.state.storage.setAlarm(Math.max(Math.min(...when), Date.now() + 250));
  }

  /** One driver taking one word. */
  async driveOne(p) {
    const level = p.aiLevel || "medium";
    const laps = lapsFor(this.g.circuit, this.g.length);

    // Fog and a scrambler cost a driver the same thing they cost a person:
    // the time it takes to see the word again.
    const fogged = (p.fogUntil || 0) > Date.now();
    if (fogged) { p.nextAt = p.fogUntil + 200; return; }

    const took = aiPace(level);
    const moved = this.advance(null, p, distanceFor(took, AI_ALLOWANCE));
    p.solved += 1;
    p.ratioSum += Math.min(1, took / AI_ALLOWANCE);
    p.nextAt = Date.now() + aiPace(level);

    // What it does with a box it picked up.
    if (p.holding) {
      const fire = aiShouldFire({
        item: p.holding, hasTargetAhead: !!this.ahead(p),
        lap: p.lap, laps, level,
      });
      if (fire) await this.fire(p, p.holding);
    }

    if (p.at >= metresFor(this.g.circuit, this.g.length)) await this.cross(p);
    return moved;
  }

  /** Every driver that is due, then the alarm for the next one. */
  async driveDue() {
    if (this.g.phase !== "RACING") return;
    const now = Date.now();
    let moved = false;
    for (const p of Object.values(this.g.players)) {
      if (!p.ai || p.done || p.watching) continue;
      let guard = 0;
      while ((p.nextAt || 0) <= now && !p.done && guard++ < 4) {
        await this.driveOne(p);
        moved = true;
      }
    }
    if (this.g.phase !== "RACING") return;   // the flag fell while they drove
    if (moved) { await this.persist(); this.pushState(); }
    await this.armAlarm();
  }

  // ------------------------------------------------------------------ racing

  racer(ws, uid) {
    if (this.g.phase !== "RACING") { this.send(ws, "PRIX_ERROR", { message: "No race is running." }); return null; }
    const p = this.g.players[uid];
    if (!p || p.watching) { this.send(ws, "PRIX_ERROR", { message: "You are in the stands." }); return null; }
    if (p.done) { this.send(ws, "PRIX_ERROR", { message: "Your race is over." }); return null; }
    if (!p.item) { this.deal(p); this.send(ws, "PRIX_ITEM", this.itemView(p)); return null; }
    return p;
  }

  async guess(ws, uid, msg) {
    const p = this.racer(ws, uid);
    if (!p) return;
    if (!this.allow(uid)) return this.send(ws, "PRIX_ERROR", { message: "Slow down." });

    const said = String(msg.guess ?? "").trim();
    if (!said) return;
    const it = p.item;
    const engine = engineById(this.g.engine);
    const verdict = engine.check(it, said);

    if (verdict === "near") {
      // The other word from the same letters. No spin, no reshuffle: the
      // clue is what separates them, and the racer has not done anything
      // wrong.
      return this.send(ws, "PRIX_RESULT", { ok: false, near: true, delta: 0, at: Math.round(p.at), lap: p.lap });
    }

    if (verdict !== "right") {
      p.spins += 1;
      p.at = Math.max(0, p.at - SPIN_COST);
      // Some engines make you look again: the words shuffle their letters,
      // and a memory sequence shortens so nobody is stuck on one they
      // cannot hold in their head.
      engine.onWrong(it);
      if (engine.id === "memory") { p.memLen = Math.max(3, (p.memLen || 4) - 1); this.deal(p); }
      await this.persist();
      this.send(ws, "PRIX_RESULT", { ok: false, delta: -SPIN_COST, at: Math.round(p.at), lap: p.lap });
      this.send(ws, "PRIX_ITEM", this.itemView(p));
      this.pushState();
      return;
    }

    const took = Date.now() - it.dealtAt;
    // A sequence you can hold gets one longer, up to the point where
    // nobody can.
    if (engine.id === "memory") p.memLen = Math.min(MEM_MAX, (p.memLen || 4) + 1);
    p.solved += 1;
    p.ratioSum += Math.min(1, took / it.allowance);
    const moved = this.advance(ws, p, distanceFor(took, it.allowance));

    this.send(ws, "PRIX_RESULT", {
      ok: true, delta: moved.gained, at: Math.round(p.at), lap: p.lap,
      word: engine.kind === "type" ? it.answer : null, tookMs: took, allowanceMs: it.allowance,
      slowed: moved.slowed, box: moved.box || null, slick: moved.slick || false,
    });

    if (p.at >= metresFor(this.g.circuit, this.g.length)) {
      await this.cross(p);
      return;
    }

    this.deal(p);
    await this.persist();
    this.send(ws, "PRIX_ITEM", this.itemView(p));
    this.pushState();
  }

  /**
   * A kart moving forward. Everything that happens along the way happens
   * here — a flare overhead taking its cut, an oil slick underneath, a box
   * picked up — so no route into the track can skip any of it.
   */
  advance(ws, p, metres) {
    const slowed = (p.slowUntil || 0) > Date.now();
    const gained = slowed ? flared(metres) : metres;
    const from = p.at;
    p.at += gained;

    // Somebody's oil slick, driven over. The dropper is already past it.
    let slick = false;
    const lying = this.g.slicks || [];
    const hit = lying.find((sl) => sl.by !== p.uid && sl.at > from && sl.at <= p.at);
    if (hit) {
      this.g.slicks = lying.filter((sl) => sl !== hit);
      if (p.deflector) {
        p.deflector = false;
        this.send(ws, "PRIX_HIT", { item: "slick", deflected: true });
      } else {
        p.at = Math.max(0, p.at - SLICK_M);
        slick = true;
        this.send(ws, "PRIX_HIT", { item: "slick", metres: SLICK_M });
      }
    }

    // A box, if your hands are empty. Holding one means the next goes by.
    let box = null;
    const crossed = boxesBetween(from, p.at, this.g.marks || []);
    if (crossed.length && !p.holding) {
      const field = Object.values(this.g.players).filter((x) => !x.watching);
      const place = standings(field).findIndex((x) => x.uid === p.uid) + 1;
      p.holding = rollItem(place || 1, field.length);
      p.boxes += 1;
      box = p.holding;
    }

    const lapM = circuitById(this.g.circuit).lapM;
    p.lap = Math.min(lapsFor(this.g.circuit, this.g.length), Math.floor(p.at / lapM) + 1);
    return { gained, slowed, box, slick };
  }

  /** Whoever is directly ahead of this racer, or nobody. */
  ahead(p) {
    const field = Object.values(this.g.players).filter((x) => !x.watching && !x.done);
    const order = standings(field);
    const i = order.findIndex((x) => x.uid === p.uid);
    return i > 0 ? order[i - 1] : null;
  }

  /** Everyone in front, for the items that sweep the road. */
  allAhead(p) {
    const field = Object.values(this.g.players).filter((x) => !x.watching && !x.done);
    return standings(field).filter((x) => (x.at || 0) > (p.at || 0) && x.uid !== p.uid);
  }

  socketFor(uid) {
    for (const ws of this.sockets()) {
      try { if (ws.deserializeAttachment()?.uid === uid) return ws; } catch { /* gone */ }
    }
    return null;
  }

  /** An item landing on somebody. A deflector eats it and says so. */
  land(target, what, extra = {}) {
    const ws = this.socketFor(target.uid);
    if (target.deflector) {
      target.deflector = false;
      if (ws) this.send(ws, "PRIX_HIT", { item: what, deflected: true });
      return false;
    }
    if (ws) this.send(ws, "PRIX_HIT", { item: what, ...extra });
    return true;
  }

  /**
   * Firing what you hold. Every item is spent whether or not it finds
   * anybody: aiming at an empty road is a decision too.
   */
  async use(ws, uid) {
    const p = this.racer(ws, uid);
    if (!p) return;
    if (!p.holding) return this.send(ws, "PRIX_ERROR", { message: "Nothing in your hands." });
    if (!this.mayFire(p, p.holding))
      return this.send(ws, "PRIX_ERROR", { message: "A flare is fired from fourth or worse." });
    await this.fire(p, p.holding);
  }

  /** Whether this racer may fire that. The flare belongs to the back. */
  mayFire(p, what) {
    if (what !== "flare") return true;
    const field = Object.values(this.g.players).filter((x) => !x.watching);
    return (standings(field).findIndex((x) => x.uid === p.uid) + 1) >= 4;
  }

  /**
   * Firing what is held. Every item is spent whether or not it finds
   * anybody: aiming at an empty road is a decision too. A person arrives
   * here through use(); a computer driver arrives on its own.
   */
  async fire(p, what) {
    const ws = this.socketFor(p.uid);
    p.holding = null;
    p.fired += 1;
    let note = "";

    switch (what) {
      case "slipstream": {
        const moved = this.advance(ws, p, SLIPSTREAM_M);
        note = `Slipstream: +${moved.gained} m`;
        break;
      }
      case "nitro": {
        // The word answers itself, at the boost a quick answer would have paid.
        const answer = engineById(this.g.engine).kind === "type" ? p.item?.answer : "that one";
        p.solved += 1;
        p.ratioSum += 1 / 3;
        const moved = this.advance(ws, p, distanceFor(0, p.item?.allowance || 15_000));
        note = `Nitro: ${answer} \u00b7 +${moved.gained} m`;
        if (p.at >= metresFor(this.g.circuit, this.g.length)) {
          await this.cross(p);
          return;
        }
        this.deal(p);
        this.send(ws, "PRIX_ITEM", this.itemView(p));
        break;
      }
      case "deflector":
        p.deflector = true;
        note = "Deflector up";
        break;
      case "slick":
        // Dropped a little behind, so you cannot drive over your own.
        this.g.slicks = [...(this.g.slicks || []), { at: Math.max(0, p.at - 5), by: p.uid }].slice(-24);
        note = "Oil slick down";
        break;
      case "comet": {
        const target = this.ahead(p);
        if (!target) { note = "Nobody ahead. The comet goes wide."; break; }
        if (this.land(target, "comet", { metres: COMET_M })) {
          target.at = Math.max(0, target.at - COMET_M);
          this.deal(target);
          const tws = this.socketFor(target.uid);
          if (tws) this.send(tws, "PRIX_ITEM", this.itemView(target));
          note = `Comet away at ${target.name}`;
        } else note = `${target.name} deflected it`;
        break;
      }
      case "scrambler": {
        const target = this.ahead(p);
        if (!target) { note = "Nobody ahead to scramble."; break; }
        if (this.land(target, "scrambler", { ms: SCRAMBLE_FOG_MS })) {
          if (target.item) engineById(this.g.engine).onWrong(target.item);
          target.fogUntil = Date.now() + SCRAMBLE_FOG_MS;
          const tws = this.socketFor(target.uid);
          if (tws) this.send(tws, "PRIX_ITEM", this.itemView(target));
          note = `Scrambled ${target.name}`;
        } else note = `${target.name} deflected it`;
        break;
      }
      case "fog": {
        const targets = this.allAhead(p);
        let hit = 0;
        for (const t of targets) {
          if (!this.land(t, "fog", { ms: FOG_MS })) continue;
          t.fogUntil = Math.max(t.fogUntil || 0, Date.now() + FOG_MS);
          const tws = this.socketFor(t.uid);
          if (tws) this.send(tws, "PRIX_ITEM", this.itemView(t));
          hit += 1;
        }
        note = hit ? `Fog over ${hit} ahead` : "Clear road ahead. The fog drifts.";
        break;
      }
      case "flare": {
        const targets = this.allAhead(p);
        let hit = 0;
        for (const t of targets) {
          if (!this.land(t, "flare", { ms: FLARE_MS })) continue;
          t.slowUntil = Math.max(t.slowUntil || 0, Date.now() + FLARE_MS);
          hit += 1;
        }
        note = hit ? `Flare over ${hit} ahead` : "Nobody ahead to blind.";
        break;
      }
      default:
        note = "That item is not in the boot.";
    }

    await this.persist();
    if (ws) this.send(ws, "PRIX_USED", { item: what, note });
    this.broadcast("PRIX_FIRED", { uid: p.uid, name: p.name, item: what, note });
    this.pushState();
  }

  /** Nothing is lost by moving on, but nothing is gained either. */
  async skip(ws, uid) {
    const p = this.racer(ws, uid);
    if (!p) return;
    const it = p.item;
    if (Date.now() - it.dealtAt < it.allowance)
      return this.send(ws, "PRIX_ERROR", { message: "Not until the allowance is gone." });
    p.ratioSum += 1;
    this.deal(p);
    await this.persist();
    this.send(ws, "PRIX_ITEM", this.itemView(p));
    this.pushState();
  }

  async cross(p) {
    p.done = true;
    p.item = null;
    p.finishedAt = Date.now() - (this.g.startedAt || Date.now());

    // The winner starts the clock on everybody else.
    const first = !this.g.flagAt;
    if (first) this.g.flagAt = Date.now() + FLAG_GRACE_MS;

    await this.persist();
    this.broadcast("PRIX_FLAG", {
      uid: p.uid, name: p.name, ms: p.finishedAt,
      graceMs: first ? FLAG_GRACE_MS : Math.max(0, this.g.flagAt - Date.now()),
    });
    this.pushState();

    const field = Object.values(this.g.players).filter((x) => !x.watching);
    if (field.every((x) => x.done)) { await this.finish(); return; }
    await this.armAlarm();
  }

  // ----------------------------------------------------------------- the flag

  async finish() {
    if (this.g.phase !== "RACING") return;
    this.g.phase = "RESULTS";
    await this.state.storage.deleteAlarm().catch(() => {});

    const field = Object.values(this.g.players).filter((p) => !p.watching);
    for (const p of field) { p.item = null; if (!p.done) p.done = true; }

    const ordered = standings(field);
    const ratings = Object.fromEntries(field.map((p) => [p.uid, p.mmrAtStart || 0]));
    const mode = field.length >= 3 ? "rumble" : "match";
    const total = metresFor(this.g.circuit, this.g.length);

    const results = ordered.map((p, i) => {
      const placement = i + 1;
      const answered = p.solved + p.spins;
      const avgRatio = p.solved > 0 ? p.ratioSum / Math.max(1, p.solved) : 1;
      const finished = p.at >= total;
      p.score = Math.round(raceScore({
        placement, field: field.length, avgRatio, spins: p.spins, finished,
      }) * levelMult(this.g.engine, p.klass));
      p.score = Math.min(100, p.score);

      const gain = sessionGain({
        score: p.score, completed: finished,
        playerMmr: p.mmrAtStart || 0, fieldMmr: fieldMmrFor(p.uid, ratings),
        mode, seed: p.seed, placement,
      });
      p.boost = !!this.g.applied?.[p.uid];
      if (p.boost) gain.total = boosted(gain.total);
      const after = (p.mmrAtStart || 0) + gain.total;

      return {
        uid: p.uid, name: p.name, score: p.score, placement, seed: p.seed || null,
        status: finished ? "finished" : "flagged",
        elapsedMs: p.finishedAt, metres: Math.round(p.at), laps: p.lap,
        solved: p.solved, spins: p.spins, klass: p.klass, answered,
        boxes: p.boxes || 0, fired: p.fired || 0,
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
    this.broadcast("PRIX_OVER", { results, mode, bounty });
    this.pushState();

    const human = results.filter((r) => !this.isAi(r.uid));
    if (!human.length) return;
    this.state.waitUntil?.(
      recordMatch(this.env, {
        code: this.g.code, roundNo: this.g.round,
        puzzleId: `prix:${this.g.engine}:${this.g.circuit}`,
        game: "prix", mode, courseId: this.g.circuit,
        finishedAt: Date.now(), results: human,
      }).then((ok) => { if (!ok) console.error("[prix] results were not saved"); })
        .catch((e) => console.error(`[prix] ${e.message}`))
    );
  }

  async alarm() {
    if (this.g?.phase === "RACING") {
      if (Date.now() >= (this.g.endsAt || 0)) { await this.finish(); return; }
      if (this.g.flagAt && Date.now() >= this.g.flagAt) { await this.finish(); return; }
      await this.driveDue();
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

    if (who?.uid && this.g.phase !== "RACING" && this.g.votes?.[who.uid]) {
      delete this.g.votes[who.uid];
      this.g.circuit = this.votedCircuit();
    }
    if (online.size === 0 && this.g.phase !== "RACING") {
      await this.state.storage.setAlarm(Date.now() + IDLE_SHUTDOWN_MS);
    }
    await this.persist();
    this.announce();
    this.pushState();
  }
}
