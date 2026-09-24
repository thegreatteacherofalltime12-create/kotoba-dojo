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
  paceScale,
} from "./prix.js";
import { ENGINES, engineById, engineList, defaultLevel, MEM_MAX, nominalAllowance } from "./prix-engines.js";
import { ARSENALS } from "./arsenals.js";
import { tokensReply, heldTokens } from "./boost.js";
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
      holding: null, holding2: null, deflector: 0, fogUntil: 0, slowUntil: 0, boxes: 0, fired: 0, owed: 0,
      ars: { armed: {}, used: {} },
      // What the arsenal turned into for this race.
      fuel: false, warmup: 0, tyres: false, guards: false, visor: false, radio: false,
      skips: 0, spares: 0, spareLeft: 0, spareLap: 0, tele: false, twin: false, magnet: 0,
      polish: 0, pointsFinish: false, tow: 0,
      solved: 0, spins: 0, ratioSum: 0,
      done: false, finishedAt: null, score: 0, mmrAtStart: 0, seed: null,
    };
  }

  // ------------------------------------------------------------------ state

  /**
   * The room as a viewer is allowed to see it. The open view is the
   * gallery's, which holds nothing back.
   */
  publicState(open = false) {
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
        // Fog and a flare are public: they land with an announcement and
        // you can see them on the road. What is in somebody's hands is not.
        fogged: (p.fogUntil || 0) > Date.now(), slowed: (p.slowUntil || 0) > Date.now(),
        place: p.watching ? null : order.indexOf(p.uid) + 1,
        finishedAt: p.finishedAt,
        ...(open ? this.handOf(p) : {}),
      })),
    };
  }

  /**
   * What only a racer themself may know, and what the gallery may know
   * about everybody.
   *
   * Reading the whole grid's hands turns every decision into arithmetic —
   * whether to aim a comet at the leader is only a question while you do
   * not know they are holding a Deflector — and it would mean Telemetry
   * sold information the browser already had.
   */
  handOf(p) {
    return {
      holding: p.holding || null,
      holding2: p.holding2 || null,
      deflector: p.deflector || 0,
      // Whether what is in hand can be fired from where they are: the rule
      // about flares lives here, so the browser never has to know it. It is
      // private too, or it would say plainly that a hand is full.
      canFire: !!p.holding && this.mayFire(p, p.holding),
    };
  }

  /**
   * One grid, sent as many ways as there are kinds of viewer: every racer
   * sees their own hand and nobody else's, and anybody watching rather than
   * racing sees the lot, because that is what makes a race worth watching.
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
        this.send(ws, "PRIX_STATE", { game: gallery });
        continue;
      }
      if (!me) { this.send(ws, "PRIX_STATE", { game: shut }); continue; }
      const hand = this.handOf(me);
      this.send(ws, "PRIX_STATE", {
        game: { ...shut, players: shut.players.map((r) => (r.uid === uid ? { ...r, ...hand } : r)) },
      });
    }
  }

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
      // Telemetry: you can see what the car in front is carrying.
      ahead: p.tele ? (this.ahead(p)?.holding || null) : undefined,
      engine: engine.id,
      kind: engine.kind,
      allowanceMs: it.allowance,
      // How much of the allowance goes on showing the item rather than
      // answering it, so the bar on screen agrees with the measurement.
      leadMs: it.leadMs || 0,
      // A Spotter's skips, because the only moment they are worth having
      // is before the allowance runs out.
      skips: p.skips || 0,
      dealtAt: it.dealtAt,
      serverNow: Date.now(),
      klass: p.klass,
    };
  }

  /**
   * The face again. The browser asks when the clock passes something the
   * deal promised for later — the Pro class's clue — because the room is
   * the only thing that knows whether it is time.
   */
  peek(ws, uid) {
    const p = this.g?.players?.[uid];
    if (!p?.item || this.g.phase !== "RACING" || p.done) return;
    this.send(ws, "PRIX_ITEM", this.itemView(p));
  }

  /** The next item for a racer, from whichever engine is running. */
  deal(p) {
    const engine = engineById(this.g.engine);
    const item = engine.deal(p.klass, p, Math.random, this.g.theme);
    // Long Fuel buys time on every item; Pit Radio means a clue that would
    // be withheld never is.
    if (p.fuel) item.allowance = Math.round(item.allowance * 1.2);
    if (p.radio) item.hideClueMs = 0;
    p.item = { ...item, dealtAt: Date.now() };
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
        case "PRIX_PEEK": return this.peek(ws, who.uid);
        case "PRIX_DROP": return await this.drop(ws, who.uid);
        case "PRIX_SOLO": return await this.setSolo(ws, who.uid, msg);
        case "PRIX_VOTE": return await this.vote(ws, who.uid, msg);
        case "PRIX_AI": return await this.setAi(ws, who.uid, msg);
        case "PRIX_ENGINE": return await this.setEngine(ws, who.uid, msg);
        case "TOKENS":
        case "APPLY_TOKEN": return await this.sendTokens(ws, who.uid, msg.type === "APPLY_TOKEN");
        case "ARM_TOKEN": return await this.arm(ws, who.uid, msg);
        case "DISARM_TOKEN": return await this.disarm(ws, who.uid, msg);
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
      p.at = 0; p.lap = 1; p.item = null; p.deck = []; p.owed = 0;
      p.holding = null; p.deflector = 0; p.fogUntil = 0; p.slowUntil = 0;
      p.memLen = 0;
      p.boxes = 0; p.fired = 0;
      p.solved = 0; p.spins = 0; p.ratioSum = 0;
      p.done = false; p.finishedAt = null; p.score = 0;
      p.mmrAtStart = ratings[p.uid] || 0;
      p.seed = seeded.indexOf(p.uid) + 1 || null;
      // Last race's fit-out goes before this one's is bolted on.
      p.fuel = false; p.warmup = 0; p.tyres = false; p.guards = false; p.visor = false;
      p.radio = false; p.skips = 0; p.spares = 0; p.spareLeft = 0; p.spareLap = 0; p.tele = false;
      p.twin = false; p.magnet = 0; p.polish = 0; p.pointsFinish = false; p.tow = 0;
      p.holding2 = null;
      if (racing && !p.ai) this.fitCar(p);
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
      // A Spare Word covers a mistake, and each one armed covers another
      // on the same lap. The lap's allowance is refilled when it turns.
      if (p.spareLap !== p.lap) { p.spareLap = p.lap; p.spareLeft = p.spares || 0; }
      const covered = (p.spareLeft || 0) > 0;
      if (covered) p.spareLeft -= 1;
      else p.spins += 1;
      const cost = covered ? 0 : Math.round((p.tyres ? 5 : SPIN_COST) * this.scaleOf(p));
      p.at = Math.max(0, p.at - cost);
      // Some engines make you look again: the words shuffle their letters,
      // and a memory sequence shortens so nobody is stuck on one they
      // cannot hold in their head.
      engine.onWrong(it);
      if (engine.id === "memory") { p.memLen = Math.max(3, (p.memLen || 4) - 1); this.deal(p); }
      await this.persist();
      this.send(ws, "PRIX_RESULT", {
        ok: false, spare: covered,
        delta: -cost,
        at: Math.round(p.at), lap: p.lap,
      });
      this.send(ws, "PRIX_ITEM", this.itemView(p));
      this.pushState();
      return;
    }

    // Time spent watching is not time spent answering, so it comes off
    // both the clock and the allowance before either is measured.
    const lead = it.leadMs || 0;
    const took = Math.max(0, Date.now() - it.dealtAt - lead);
    const allowance = Math.max(1, it.allowance - lead);
    // A sequence you can hold gets one longer, up to the point where
    // nobody can.
    if (engine.id === "memory") p.memLen = Math.min(MEM_MAX, (p.memLen || 4) + 1);
    p.solved += 1;
    p.ratioSum += Math.min(1, took / allowance);
    // A Warm-Up Lap pays a full boost for the first three whatever the
    // clock said; a Tow Rope adds to every answer while it lasts.
    let metres = p.warmup > 0 ? distanceFor(0, allowance) : distanceFor(took, allowance);
    if (p.warmup > 0) p.warmup -= 1;
    if (p.tow > 0) { metres += 20; p.tow -= 1; }
    const moved = this.advance(ws, p, metres);

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
    // Reference metres in, track metres out. Everything that reaches a kart
    // comes through here, so converting once is enough.
    const gained = Math.round((slowed ? flared(metres) : metres) * this.scaleOf(p));
    const from = p.at;
    p.at += gained;

    // Somebody's oil slick, driven over. The dropper is already past it.
    let slick = false;
    const lying = this.g.slicks || [];
    const hit = lying.find((sl) => sl.by !== p.uid && sl.at > from && sl.at <= p.at);
    if (hit) {
      this.g.slicks = lying.filter((sl) => sl !== hit);
      if (p.guards) {
        // Mudguards: the oil goes under the car and nothing else.
        this.send(ws, "PRIX_HIT", { item: "slick", shrugged: true });
      } else if (p.deflector > 0) {
        p.deflector -= 1;
        this.send(ws, "PRIX_HIT", { item: "slick", deflected: true });
      } else {
        const cost = Math.round(SLICK_M * this.scaleOf(p));
        p.at = Math.max(0, p.at - cost);
        slick = true;
        this.send(ws, "PRIX_HIT", { item: "slick", metres: cost });
      }
    }

    // A box, if your hands are empty. Holding one means the next goes by.
    let box = null;
    const crossed = boxesBetween(from, p.at, this.g.marks || []);
    if (crossed.length) {
      box = this.takeBox(p);
      // Hands full. A Box Magnet does not throw away what you are carrying
      // to make room for a box: it saves the box, and the box waits for a
      // hand. That is what "collected even when your hands are full" means,
      // and it is never a second hand — only a Twin Box is that.
      if (!box && p.magnet > 0) {
        p.magnet -= 1;
        p.owed = Math.min(2, (p.owed || 0) + 1);
      }
      // A racer on a slow clock covers more ground for one answer and can
      // clear several boxes in a single stride. The first behaves as it
      // always did; the rest wait for a hand rather than being thrown away,
      // because nobody should collect fewer items for the clock they were
      // given. A box crossed with full hands and no magnet is still a box
      // gone by.
      if (crossed.length > 1) p.owed = Math.min(2, (p.owed || 0) + crossed.length - 1);
    }
    while ((p.owed || 0) > 0) {
      const got = this.takeBox(p);
      if (!got) break;
      p.owed -= 1;
      box = got;
    }

    const lapM = circuitById(this.g.circuit).lapM;
    p.lap = Math.min(lapsFor(this.g.circuit, this.g.length), Math.floor(p.at / lapM) + 1);
    return { gained, slowed, box, slick };
  }

  /**
   * The rate this racer's metres convert at: the clock their current work
   * is measured against, over the reference clock. A computer driver is
   * judged against the reference itself, so it converts at one.
   */
  scaleOf(p) {
    if (!p || p.ai) return 1;
    const it = p.item;
    const a = it
      ? Math.max(1, it.allowance - (it.leadMs || 0))
      : nominalAllowance(this.g.engine, p.klass);
    return paceScale(a);
  }

  /**
   * One box into a free hand, or nothing.
   *
   * Nothing you are already carrying is thrown away to make room, and a
   * hand you do not have is never invented — a Twin Box is the only thing
   * that gives you a second one.
   */
  takeBox(p) {
    const hand = !p.holding ? "holding" : (p.twin && !p.holding2) ? "holding2" : null;
    if (!hand) return null;
    const field = Object.values(this.g.players).filter((x) => !x.watching);
    const place = standings(field).findIndex((x) => x.uid === p.uid) + 1;
    p[hand] = rollItem(place || 1, field.length);
    p.boxes += 1;
    return p[hand];
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
    // A Sun Visor does not stop fog or a flare, it shortens them.
    if (target.visor && (what === "fog" || what === "flare" || what === "scrambler")) extra = { ...extra, ms: Math.round((extra.ms || 0) / 2) };
    if (target.deflector > 0) {
      target.deflector -= 1;
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
  /**
   * Throwing away an item you are not allowed to fire.
   *
   * Only that one. An item you could fire is a decision, and letting anyone
   * discard any roll would turn every box into a re-roll. But a flare you
   * climbed above is a dead hand: you cannot fire it, and full hands wave
   * every later box straight past, so without this the rest of the race is
   * spent carrying a brick.
   */
  async drop(ws, uid) {
    const p = this.racer(ws, uid);
    if (!p) return;
    if (!p.holding) return this.send(ws, "PRIX_ERROR", { message: "Nothing in your hands." });
    if (this.mayFire(p, p.holding))
      return this.send(ws, "PRIX_ERROR", { message: "That one you can fire." });
    const gone = p.holding;
    p.holding = p.holding2 || null;
    p.holding2 = null;
    this.send(ws, "PRIX_USED", { note: `${itemById(gone)?.name || gone} thrown away.` });
    await this.persist();
    this.pushState();
  }

  async use(ws, uid) {
    const p = this.racer(ws, uid);
    if (!p) return;
    if (!p.holding) return this.send(ws, "PRIX_ERROR", { message: "Nothing in your hands." });
    if (!this.mayFire(p, p.holding))
      return this.send(ws, "PRIX_ERROR", { message: "A flare is fired from fourth or worse." });
    await this.fire(p, p.holding);
  }

  arsOf(p) { p.ars = p.ars || { armed: {}, used: {} }; return p.ars; }

  arsenalView(p) {
    const a = this.arsOf(p);
    return {
      on: true,
      armed: { ...a.armed }, used: { ...a.used },
      max: Object.fromEntries(Object.entries(ARSENALS.prix).map(([k, v]) => [k, v.max || 99])),
      locked: this.g.phase === "RACING",
    };
  }

  async sendTokens(ws, uid, apply, error = null) {
    this.g.applied = this.g.applied || {};
    const reply = await tokensReply(this.env, uid, "prix", {
      applied: this.g.applied, over: this.g.phase === "RESULTS", apply,
    });
    if (reply.changed) await this.persist();
    const p = this.g.players[uid];
    this.send(ws, "PRIX_TOKENS", { ...reply, error: error || reply.error, arsenal: p ? this.arsenalView(p) : null });
  }

  /**
   * Arming one. Everything here takes hold at the lights, so nothing can be
   * armed once a race is running.
   */
  async arm(ws, uid, msg) {
    const p = this.g.players[uid];
    if (!p) return;
    if (this.g.phase === "RACING") return this.sendTokens(ws, uid, false, "Not once the lights are out.");
    const key = String(msg.key || "");
    const spec = ARSENALS.prix[key];
    if (!spec) return this.sendTokens(ws, uid, false, "No such token.");
    const a = this.arsOf(p);
    if (spec.max && (a.armed[key] || 0) >= spec.max)
      return this.sendTokens(ws, uid, false, `${spec.max} ${spec.name} is the limit for one race.`);
    const held = (await heldTokens(this.env, uid))[key] || 0;
    if (held <= (a.armed[key] || 0))
      return this.sendTokens(ws, uid, false, `You hold no more ${spec.name} tokens. The Token shop sells them.`);
    a.armed[key] = (a.armed[key] || 0) + 1;
    await this.persist();
    await this.sendTokens(ws, uid, false);
    this.pushState();
  }

  async disarm(ws, uid, msg) {
    const p = this.g.players[uid];
    if (!p) return;
    if (this.g.phase === "RACING") return this.sendTokens(ws, uid, false, "Not once the lights are out.");
    const a = this.arsOf(p);
    const key = String(msg.key || "");
    if (!a.armed[key]) return this.sendTokens(ws, uid, false, "That is not armed.");
    a.armed[key] -= 1;
    if (!a.armed[key]) delete a.armed[key];
    await this.persist();
    await this.sendTokens(ws, uid, false);
    this.pushState();
  }

  /**
   * The lights, for one racer's arsenal. Every token bites here, which is
   * why every token armed is a token spent.
   */
  /**
   * The lights, where every armed token takes hold.
   *
   * What is written down as used is built here, one effect at a time,
   * rather than copied wholesale from what was armed: a token that cannot
   * take hold must not be charged for. A second Mudguard has nothing left
   * to do, and a second canister needs a second hand to sit in. Anything
   * that does not fit stays in the bag, because it is only spent by
   * working.
   */
  fitCar(p) {
    const a = this.arsOf(p);
    a.used = {};
    const n = (k) => a.armed[k] || 0;
    /** Take up to that many of a token, and write down what was taken. */
    const spend = (k, count = 1) => {
      const got = Math.max(0, Math.min(count, n(k)));
      if (got > 0) a.used[k] = got;
      return got;
    };
    /** Take every one armed, for the tokens that stack. */
    const take = (k) => spend(k, n(k));

    // One of each is all a car can carry: a second changes nothing, so a
    // second is never taken.
    if (spend("gp_fuel")) p.fuel = true;
    if (spend("gp_tyres")) p.tyres = true;
    if (spend("gp_guards")) p.guards = true;
    if (spend("gp_visor")) p.visor = true;
    if (spend("gp_radio")) p.radio = true;
    if (spend("gp_tele")) p.tele = true;
    if (spend("gp_twin")) p.twin = true;
    if (spend("gp_points")) p.pointsFinish = true;

    // These count, so every one armed is another of the thing.
    p.deflector = (p.deflector || 0) + take("gp_seal");
    p.spares = take("gp_spare");
    p.warmup = take("gp_warmup") * 3;
    p.skips = take("gp_spotter") * 3;
    p.magnet = take("gp_magnet") * 3;
    p.polish = take("gp_polish") * 8;
    p.tow = take("gp_tow") * 5;

    // A canister needs a hand to start in, and a Twin Box is the only way
    // to have a second one. Whatever there is no hand for is left alone.
    const hands = p.twin ? 2 : 1;
    for (const [key, item] of [["gp_slip", "slipstream"], ["gp_nitro", "nitro"]]) {
      const free = hands - (p.holding ? 1 : 0) - (p.holding2 ? 1 : 0);
      const got = spend(key, Math.min(n(key), free));
      for (let i = 0; i < got; i++) {
        if (!p.holding) p.holding = item;
        else p.holding2 = item;
      }
    }

    // The start boost is distance, not an item, so it lands before the flag.
    const starts = take("gp_start");
    if (starts) p.at += Math.round(200 * starts * this.scaleOf(p));
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
    // Twin Box: whatever was in the other hand moves across.
    p.holding = p.holding2 || null;
    p.holding2 = null;
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
        p.deflector = (p.deflector || 0) + 1;
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
        const bite = Math.round(COMET_M * this.scaleOf(target));
        if (this.land(target, "comet", { metres: bite })) {
          target.at = Math.max(0, target.at - bite);
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
          target.fogUntil = Date.now() + (target.visor ? SCRAMBLE_FOG_MS / 2 : SCRAMBLE_FOG_MS);
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
          t.fogUntil = Math.max(t.fogUntil || 0, Date.now() + (t.visor ? FOG_MS / 2 : FOG_MS));
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
          t.slowUntil = Math.max(t.slowUntil || 0, Date.now() + (t.visor ? FLARE_MS / 2 : FLARE_MS));
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
    const spotted = p.skips > 0;
    if (!spotted && Date.now() - it.dealtAt < it.allowance)
      return this.send(ws, "PRIX_ERROR", { message: "Not until the allowance is gone." });
    if (spotted && Date.now() - it.dealtAt < it.allowance) p.skips -= 1;
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
      // A Points Finish is scored as though the flag had been taken.
      const finished = p.at >= total || !!p.pointsFinish;
      p.score = Math.round((raceScore({
        placement, field: field.length, avgRatio, spins: p.spins, finished,
      }) + (p.polish || 0)) * levelMult(this.g.engine, p.klass));
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
        spent: p.ars?.used && Object.keys(p.ars.used).length ? { ...p.ars.used } : undefined,
        mmrBefore: p.mmrAtStart || 0, gain: gain.total, boost: !!p.boost,
        breakdown: { base: gain.base, challenge: gain.challenge, completion: gain.completion, seed: gain.seed },
        mmrAfter: after, belt: beltFor(after).name,
        promoted: beltFor(after).name !== beltFor(p.mmrAtStart || 0).name,
      };
    });

    this.g.applied = {};
    // Every token bit at the lights, so every token armed is gone. Nothing
    // is left armed for a race that has not been set up yet.
    for (const p of field) { const a = this.arsOf(p); a.armed = {}; a.used = {}; }
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
