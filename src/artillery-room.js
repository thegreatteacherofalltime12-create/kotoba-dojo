import {
  GAME_NAME, WORLD_W, WORLD_H, TANK_R, START_HP, WIND_MAX, WIND_MODES, windModeById,
  makeTerrain, startPositions, groundAt, carve, settle, blastOn,
  salvo, mound, levelGround, dealt, taken, drained, repaired, burnTick, teleportTo,
  TOKEN_KIND, PAYLOADS,
  AVATARS, freeAvatar, avatarById,
  AI_LEVELS, AI_MAX, AI_NAMES, aiLevelById, aiAim,
  duelScore, standings, rngFrom,
} from "./artillery.js";
import { ARSENALS } from "./arsenals.js";
import { recordMatch, readRatings, strikePlayer } from "./firestore.js";
import { moderate } from "./moderation.js";
import { boosted, sessionGain, fieldMmrFor, beltFor } from "./mmr.js";
import { tokensReply, heldTokens } from "./boost.js";
import { announceRoom } from "./rooms.js";

/** How long the room waits before a computer takes its shot. */
const AI_THINK_MS = 1700;
/** A turn nobody takes is not a stalemate, it is somebody who walked away. */
const TURN_MS = 45_000;

/**
 * A duel of Artillery Tank Duel.
 *
 * Turn by turn: the room tells you the wind, you give it an angle and a power,
 * and it fires the shell. The room integrates the flight, carves the crater,
 * works out who it hurt and sends the finished path to everybody — including
 * to the player who fired it, who therefore watches a shot that has already
 * landed. That is the whole architecture and the reason for it is in
 * src/artillery.js: a client that reports its own hits always hits.
 *
 * The arsenal changes the numbers of a shot and never who decides them. A
 * triple shot is three flights in the same message; an orbital strike is
 * three columns of damage in the same message; a shield is a subtraction the
 * room does. Nothing a token buys is resolved anywhere but here.
 */
export class TankDuel {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      this.g = (await state.storage.get("game")) || null;
    });
  }

  blank(code, solo) {
    return {
      code,
      phase: "LOBBY",           // LOBBY, PLAYING, OVER
      solo: !!solo,
      hostUid: null,
      roundNo: 0,
      startedAt: 0,
      seed: 0,
      wind: 0,
      terrain: [],
      order: [],                // uids, in the order they shoot
      turn: 0,                  // an index into order
      turnNo: 0,
      turnEndsAt: 0,
      fires: [],                // napalm still burning
      tanks: {},                // uid -> tank
      aiLevel: "medium",
      aiCount: 1,
      windMode: "normal",
      applied: {},              // the 1.5x boost, per uid
      chat: [],                 // what the room said to each other
      log: [],                  // what the room did, in the order it did it
    };
  }

  freshTank(uid, name, { ai = null, avatar = null } = {}) {
    return {
      uid, name, ai,
      avatar: avatar || freeAvatar(Object.values(this.g?.tanks || {}).map((t) => t.avatar)),
      x: 0, y: 0,
      hp: START_HP,
      dead: false, diedAt: 0,
      angle: 45, power: 60,
      shots: 0, hits: 0, damage: 0, taken: 0,
      ars: this.freshArs(),
      lastShot: null,           // the flight, for a Tracer Round to read back
      empUntil: 0,              // turns numbered; no aiming help until then
      lastSeen: Date.now(),
    };
  }

  /* ── the arsenal ───────────────────────────────────────────────── */
  //
  // Nineteen tokens. The shell and strike kinds are chosen with the shot and
  // spent when it is fired; the guards are raised and spent by the blast they
  // eat; the rest do their work the moment they are fired and are spent then.
  // What is armed and never used stays armed for the next round in this room.

  freshArs() {
    return {
      armed: {}, used: {},
      guards: [],       // raised, waiting for something to happen to them
      chute: false,     // a parachute is for the whole round, not one blast
      windless: false,
    };
  }
  arsOf(t) { return t.ars || (t.ars = this.freshArs()); }
  armedLeft(t, key) { const a = this.arsOf(t); return (a.armed[key] || 0) - (a.used[key] || 0); }
  useToken(t, key) { const a = this.arsOf(t); a.used[key] = (a.used[key] || 0) + 1; }

  /** What a blast meets when it reaches this tank. */
  guardsOf(uid) {
    const t = this.g?.tanks?.[uid];
    if (!t) return [];
    const a = this.arsOf(t);
    return [...a.guards, ...(a.chute ? ["at_chute"] : [])];
  }

  /**
   * A guard that did its job is gone. A shield blocks one blast and a plate of
   * heavy armour takes one hit; neither is a subscription.
   */
  spendGuard(uid, key) {
    const t = this.g?.tanks?.[uid];
    if (!t) return;
    const a = this.arsOf(t);
    const at = a.guards.indexOf(key);
    if (at >= 0) a.guards.splice(at, 1);
    this.useToken(t, key);
  }

  arsenalView(t) {
    const a = this.arsOf(t);
    return {
      on: true, armed: a.armed, used: a.used,
      max: Object.fromEntries(Object.entries(ARSENALS.artillery).map(([k, v]) => [k, v.max || 99])),
      kinds: TOKEN_KIND,
      payloads: PAYLOADS,
      guards: a.guards,
      chute: !!a.chute,
      yourTurn: this.whoseTurn() === t.uid,
      playing: this.g?.phase === "PLAYING" && !t.dead,
      // What the last shot did, for a Tracer Round to draw again.
      tracer: this.armedLeft(t, "at_tracer") > 0 ? t.lastShot : null,
    };
  }

  async sendTokens(ws, uid, apply, error = null) {
    const g = this.g;
    g.applied = g.applied || {};
    const reply = await tokensReply(this.env, uid, "artillery", {
      applied: g.applied, over: g.phase === "OVER", apply,
    });
    if (reply.changed) await this.save();
    const t = g.tanks[uid];
    this.send(ws, "TANK_TOKENS", {
      ...reply, error: error || reply.error,
      arsenal: t ? this.arsenalView(t) : null,
    });
  }

  async arm(ws, uid, msg) {
    const t = this.g?.tanks?.[uid];
    if (!t) return;
    const key = String(msg.key || "");
    const spec = ARSENALS.artillery[key];
    if (!spec) return this.sendTokens(ws, uid, false, "No such token.");
    const a = this.arsOf(t);
    if (spec.max && (a.armed[key] || 0) >= spec.max)
      return this.sendTokens(ws, uid, false, `${spec.max} ${spec.name} is the limit for one duel.`);
    const held = (await heldTokens(this.env, uid))[key] || 0;
    if (held <= (a.armed[key] || 0))
      return this.sendTokens(ws, uid, false, `You hold no more ${spec.name} tokens. The Token shop sells them.`);
    a.armed[key] = (a.armed[key] || 0) + 1;
    await this.save();
    await this.sendTokens(ws, uid, false);
  }

  async disarm(ws, uid, msg) {
    const t = this.g?.tanks?.[uid];
    if (!t) return;
    const key = String(msg.key || "");
    const a = this.arsOf(t);
    if (this.armedLeft(t, key) <= 0) return this.sendTokens(ws, uid, false, "Nothing to put back.");
    a.armed[key] -= 1;
    if (!a.armed[key]) delete a.armed[key];
    await this.save();
    await this.sendTokens(ws, uid, false);
  }

  /**
   * The tokens that are not fired with a shell: the guards you raise before
   * somebody shoots at you, and the three that act on their own.
   *
   * Raising a guard costs no turn — it is the one thing in the arsenal you may
   * do while somebody else is shooting, which is the only time it is any use.
   * The three that act do take the turn, because a free teleport out of a
   * crossfire every round is not a 4,500 token, it is a different game.
   */
  async useArsenal(ws, uid, msg) {
    const g = this.g;
    const t = g?.tanks?.[uid];
    if (!t) return;
    if (g.phase !== "PLAYING" || t.dead)
      return this.send(ws, "TANK_REJECT", { why: "No duel is running." });
    const key = String(msg.key || "");
    const spec = ARSENALS.artillery[key];
    const kind = TOKEN_KIND[key];
    if (!spec || !kind) return this.send(ws, "TANK_REJECT", { why: "Unrecognised token." });
    if (kind === "shell" || kind === "strike")
      return this.send(ws, "TANK_REJECT", { why: `${spec.name} is fired with a shot. Pick it, then fire.` });
    if (this.armedLeft(t, key) <= 0)
      return this.send(ws, "TANK_REJECT", { why: `No ${spec.name} armed. Arm one under Apply Token.` });

    const a = this.arsOf(t);

    if (kind === "guard") {
      if (key === "at_chute") {
        if (a.chute) return this.send(ws, "TANK_REJECT", { why: "The parachute is already on." });
        a.chute = true;
        this.useToken(t, key);
        this.note(uid, "Parachute on: the ground can go from under you for nothing.");
      } else {
        if (a.guards.includes(key))
          return this.send(ws, "TANK_REJECT", { why: `${spec.name} is already up.` });
        // Raised now, spent by whatever hits it. Nothing is taken off the
        // token count until it does its job.
        a.guards.push(key);
        this.note(uid, key === "at_bubble"
          ? "Shield up: the next blast to reach you does nothing at all."
          : "Heavy armour on: the next hit lands fifteen per cent lighter.");
      }
      this.logEvent("token", `${t.name} ${key === "at_chute" ? "put a parachute on" : key === "at_bubble" ? "raised a shield" : "bolted heavy armour on"}.`);
      await this.save();
      this.pushAll();
      this.send(ws, "TANK_ARSENAL_STATE", { arsenal: this.arsenalView(t) });
      return;
    }

    // The three that act. Each takes the turn, so each needs it to be yours.
    if (this.whoseTurn() !== uid)
      return this.send(ws, "TANK_REJECT", { why: "Wait for your turn." });

    if (key === "at_repair") {
      const back = repaired(t);
      if (back <= 0) return this.send(ws, "TANK_REJECT", { why: "Nothing to repair yet." });
      t.hp += back;
      this.useToken(t, key);
      this.broadcast("TANK_EVENT", { kind: "repair", uid, hp: t.hp, healed: back });
      this.logEvent("token", `${t.name} repaired ${back} of their armour.`);
      this.note(uid, `Armour repaired: ${back} back, at ${t.hp}.`);
    } else if (key === "at_teleport") {
      const to = teleportTo(g.terrain, this.tankList(), t, this.rnd());
      t.x = to.x;
      t.y = to.y;
      // Arriving somewhere is not falling into it.
      settle(g.terrain, t, ["at_chute"]);
      this.useToken(t, key);
      this.broadcast("TANK_EVENT", { kind: "teleport", uid, x: t.x, y: t.y });
      this.logEvent("token", `${t.name} teleported clear.`);
      this.note(uid, "Teleported clear.");
    } else if (key === "at_emp") {
      const mark = g.tanks[String(msg.at || "")];
      if (!mark || mark.dead || mark.uid === uid)
        return this.send(ws, "TANK_REJECT", { why: "Point the EMP at somebody who is still shooting." });
      // Two turns, not one: numbered from the next turn, so the tank it was
      // fired at actually loses a turn of aiming rather than the tail of this
      // one, which was never theirs.
      mark.empUntil = g.turnNo + 2;
      this.useToken(t, key);
      this.broadcast("TANK_EVENT", { kind: "emp", uid, at: mark.uid });
      this.logEvent("token", `${t.name} hit ${mark.name} with an EMP.`);
      this.note(mark.uid, "EMP: your aiming line is down for a turn.");
      this.note(uid, `EMP away: ${mark.name} is shooting blind.`);
    }

    await this.endTurn();
  }

  /* ── what was said, and what happened ──────────────────────────── */

  /**
   * The duel's chat.
   *
   * Open the whole way through, unlike the race's, which shuts at the lights.
   * A race is a clock you are losing to; a duel is turns, and most of a turn
   * is watching somebody else take theirs. Talking is what that time is for.
   *
   * Moderated on the same screen as the arena chat, and a refused line is a
   * strike — the room a thing is said in does not change what may be said.
   */
  async say(ws, uid, msg) {
    const t = this.g?.tanks?.[uid];
    const text = String(msg.text || "").trim().slice(0, 200);
    if (!text) return;
    const verdict = await moderate(this.env, text);
    if (!verdict.ok) {
      const strikes = await strikePlayer(this.env, uid, t?.name || "Commander", {
        text, reason: verdict.reason, where: "tank duel chat",
      });
      return this.send(ws, "TANK_REJECT", {
        why: `That doesn't belong here (${verdict.reason}). Strike ${strikes ?? "?"} of 3.`,
      });
    }
    const entry = { uid, name: t?.name || "Commander", text, at: Date.now() };
    this.g.chat = [...(this.g.chat || []), entry].slice(-60);
    await this.save();
    this.broadcast("TANK_CHAT", { line: entry });
  }

  /**
   * The event feed: what the duel did, in the order it did it.
   *
   * Kept by the room rather than assembled in the browser from the messages
   * it happened to be awake for, so somebody who reloads mid-duel, or walks
   * in halfway through, reads the same account as everybody else.
   */
  logEvent(kind, text) {
    if (!this.g) return;
    const entry = { at: Date.now(), turn: this.g.turnNo, kind, text };
    this.g.log = [...(this.g.log || []), entry].slice(-80);
    this.broadcast("TANK_LOG", { line: entry });
  }

  /* ── the duel ──────────────────────────────────────────────────── */

  rnd() { return rngFrom((this.g?.seed || 1) + this.g?.turnNo * 977 + 13); }

  /** The strength the host set, or the usual one for a duel saved before it. */
  windMax() { return windModeById(this.g?.windMode).max; }

  rollWind() {
    const r = this.rnd();
    return Math.round((r() * 2 - 1) * this.windMax());
  }

  tankList() { return this.g.order.map((uid) => this.g.tanks[uid]).filter(Boolean); }
  whoseTurn() { return this.g?.order?.[this.g.turn] || null; }

  canStart(uid) {
    const g = this.g;
    if (!g) return false;
    if (!g.hostUid || g.hostUid === uid) return true;
    return !this.liveUids().has(g.hostUid);
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
    if (!this.canStart(uid))
      return this.send(ws, "TANK_REJECT", { why: "The player who opened this room calls the start." });

    if (msg.level && aiLevelById(msg.level).id === msg.level) g.aiLevel = msg.level;
    if (msg.wind && windModeById(msg.wind).id === msg.wind) g.windMode = msg.wind;
    if (msg.ai != null) g.aiCount = Math.max(0, Math.min(AI_MAX, Number(msg.ai) || 0));

    // The computers come and go with the setting rather than piling up: a
    // rematch with one computer is a rematch with one computer.
    for (const t of Object.values(g.tanks)) if (t.ai) delete g.tanks[t.uid];
    const people = Object.keys(g.tanks);
    for (let i = 0; i < g.aiCount; i++) {
      const id = `ai:${i}`;
      g.tanks[id] = this.freshTank(id, AI_NAMES[i] || `Computer ${i + 1}`, { ai: g.aiLevel });
    }
    if (people.length + g.aiCount < 2)
      return this.send(ws, "TANK_REJECT", { why: "A duel takes two. Add a computer, or wait for somebody." });

    g.seed = (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;
    g.terrain = makeTerrain(g.seed);
    g.order = [...people, ...Array.from({ length: g.aiCount }, (_, i) => `ai:${i}`)];
    const xs = startPositions(g.terrain, g.order.length, g.seed);
    g.order.forEach((id, i) => {
      const t = g.tanks[id];
      const armed = { ...this.arsOf(t).armed };
      Object.assign(t, this.freshTank(t.uid, t.name, { ai: t.ai, avatar: t.avatar }));
      t.ars.armed = armed;
      t.x = xs[i];
      t.y = groundAt(g.terrain, xs[i]) - TANK_R;
    });
    g.fires = [];
    g.turn = 0;
    g.turnNo = 1;
    g.wind = this.rollWind();
    g.phase = "PLAYING";
    g.startedAt = Date.now();
    g.roundNo += 1;
    g.turnEndsAt = Date.now() + TURN_MS;

    // Ratings are read once, at the off: how strong the field is and where
    // each player was seeded in it has to be the picture before a shot.
    const uids = people;
    let ratings = {};
    try { ratings = await readRatings(this.env, uids); } catch { /* unranked */ }
    const seeded = [...uids].sort((a, b) => (ratings[b] || 0) - (ratings[a] || 0));
    for (const t of Object.values(g.tanks)) {
      t.mmrAtStart = ratings[t.uid] || 0;
      if (g.applied?.[t.uid] && !((ratings.boosts?.[t.uid]?.artillery || 0) > 0)) delete g.applied[t.uid];
      t.seed = seeded.indexOf(t.uid) + 1 || null;
    }

    await this.save();
    this.pushAll();
    this.logEvent("start", `Duel begins \u2014 ${g.order.length} tanks, ${windModeById(g.windMode).name.toLowerCase()} wind${g.aiCount ? `, ${aiLevelById(g.aiLevel).name.toLowerCase()} computers` : ""}.`);
    this.broadcast("TANK_START", { at: g.startedAt, wind: g.wind, seed: g.seed, terrain: this.groundOut() });
    await this.maybeAI();
  }

  /** The ground, as whole numbers, which is all a canvas can draw anyway. */
  groundOut() { return this.g.terrain.map((h) => Math.round(h)); }

  /**
   * One turn's shooting, start to finish.
   *
   * The order matters and is the same every time: the shells fly against the
   * ground as it was, then the ground changes, then the tanks fall into what
   * is left of it, then the fires burn. Put the fall before the craters and a
   * tank drops into a hole that is not there yet.
   */
  async fire(ws, uid, msg) {
    const g = this.g;
    const t = g?.tanks?.[uid];
    if (!g || g.phase !== "PLAYING" || !t) return;
    if (this.whoseTurn() !== uid) return this.send(ws, "TANK_REJECT", { why: "Not your turn." });
    if (t.dead) return;

    const angle = Math.max(0, Math.min(180, Number(msg.angle) || 0));
    const power = Math.max(1, Math.min(100, Number(msg.power) || 1));
    t.angle = angle;
    t.power = power;

    // What was picked to fire with, minus anything not armed, not a shooting
    // token, or a second payload. Filtered here rather than refused, so a
    // stale button on a reconnected client costs a plain shell and not a turn.
    const picked = Array.isArray(msg.use) ? msg.use.map(String) : [];
    const use = [];
    let payload = null;
    for (const key of picked) {
      const kind = TOKEN_KIND[key];
      if (kind !== "shell" && kind !== "strike") continue;
      if (this.armedLeft(t, key) <= 0) continue;
      if (PAYLOADS.includes(key)) {
        if (payload) continue;
        payload = key;
      }
      if (use.includes(key)) continue;
      use.push(key);
    }
    // A strike replaces the shot, so one of them and nothing else with it.
    const strike = use.find((k) => TOKEN_KIND[k] === "strike");
    const firing = strike ? [strike] : use;

    const aim = { x: Math.max(0, Math.min(WORLD_W - 1, Number(msg.aimX ?? t.x) || 0)) };
    const shot = salvo({
      from: { x: t.x, y: t.y - 6 },
      angle, power, wind: g.wind,
      terrain: g.terrain, tanks: this.tankList(), shooter: uid,
      use: firing, aim,
    });
    for (const key of firing) this.useToken(t, key);
    t.shots += 1;

    const hits = [];
    let total = 0;

    // A terrain leveler does nothing to anybody. It changes the shape of the
    // argument instead, which is often worth more than a hit.
    if (shot.level) {
      levelGround(g.terrain, shot.level.x, shot.level.radius);
    }

    for (const b of shot.blasts) {
      for (const raw of blastOn(this.tankList(), b, b.radius, b.top)) {
        const scaled = dealt(raw.damage, firing);
        const guard = this.guardsOf(raw.uid);
        const { damage, blocked, armoured } = taken(scaled, guard);
        if (blocked) this.spendGuard(raw.uid, "at_bubble");
        else if (armoured) this.spendGuard(raw.uid, "at_armour");
        if (damage > 0) {
          const mark = g.tanks[raw.uid];
          mark.hp -= damage;
          mark.taken += damage;
          // Damage to somebody else. A shell fired close enough to catch you
          // in your own blast does not feed a vampire shell, or standing in
          // your own crater would be a way to heal.
          if (raw.uid !== uid) { total += damage; t.damage += damage; }
        }
        hits.push({ uid: raw.uid, damage, blocked, from: b.kind, dist: raw.dist });
      }
      // The crater, or the mound a mud shell leaves in place of one.
      if (b.kind === "mud") mound(g.terrain, b.x, b.radius);
      else carve(g.terrain, b.x, b.y, b.radius);
    }
    // A hit is a shell that reached somebody, however little it did — that is
    // what the accuracy on the scorecard means.
    if (hits.some((h) => h.uid !== uid)) t.hits += 1;

    const heal = drained(total, firing);
    if (heal > 0) {
      t.hp = Math.min(START_HP, t.hp + heal);
      hits.push({ uid, damage: -heal, from: "vampire" });
    }

    // The ground moved, so everybody standing on it comes down with it.
    const falls = [];
    for (const other of this.tankList()) {
      if (other.dead) continue;
      const hurt = settle(g.terrain, other, this.guardsOf(other.uid));
      if (hurt > 0) {
        other.hp -= hurt;
        other.taken += hurt;
        if (other.uid !== uid) t.damage += hurt;
        falls.push({ uid: other.uid, damage: hurt });
      }
    }

    if (shot.fires.length) g.fires.push(...shot.fires);
    const burn = burnTick(this.tankList(), g.fires, (id) => this.guardsOf(id));
    for (const h of burn.hits) {
      if (h.blocked) { this.spendGuard(h.uid, "at_bubble"); continue; }
      const mark = g.tanks[h.uid];
      if (!mark || mark.dead) continue;
      mark.hp -= h.damage;
      mark.taken += h.damage;
      if (h.uid !== uid) t.damage += h.damage;
    }
    g.fires = burn.fires;

    const dead = [];
    for (const other of this.tankList()) {
      if (other.dead || other.hp > 0) continue;
      other.hp = 0;
      other.dead = true;
      other.diedAt = Date.now();
      dead.push(other.uid);
    }

    t.lastShot = { angle, power, wind: shot.wind, path: shot.flights[0]?.path || [] };

    // One line an onlooker could follow: what was fired, what it cost whom,
    // and who stopped it. Names rather than uids, because the feed is read.
    const named = (id) => g.tanks[id]?.name || "somebody";
    const hurt = hits.filter((h) => h.uid !== uid && h.damage > 0);
    const stopped = hits.filter((h) => h.blocked);
    const fired = strike
      ? `called down ${ARSENALS.artillery[strike].name}`
      : `fired${firing.length ? ` with ${firing.map((k) => ARSENALS.artillery[k].name).join(" and ")}` : ""} at ${angle}\u00b0, power ${power}`;
    const did = hurt.length
      ? hurt.map((h) => `${named(h.uid)} for ${h.damage}`).join(", ")
      : stopped.length ? `${named(stopped[0].uid)} blocked it` : "and missed";
    this.logEvent("shot", `${t.name} ${fired} \u2014 ${hurt.length ? `hit ${did}` : did}.`);
    for (const f of falls) this.logEvent("fall", `${named(f.uid)} fell with the ground, ${f.damage}.`);
    for (const b of burn.hits.filter((h) => h.damage > 0)) this.logEvent("burn", `${named(b.uid)} is burning, ${b.damage}.`);
    for (const id of dead) this.logEvent("dead", `${named(id)} is destroyed.`);

    await this.save();
    // The whole turn in one message: every flight, every crater, everything
    // it cost. A client that misses this message asks for the state and gets
    // the field as it is — it never has to work out what happened.
    this.broadcast("TANK_SHOT", {
      uid,
      angle, power,
      wind: shot.wind,
      plan: { shells: shot.plan.shells.length, payload: shot.plan.payload, tokens: firing },
      flights: shot.flights,
      blasts: shot.blasts,
      level: shot.level || null,
      hits: [...hits, ...falls.map((f) => ({ ...f, from: "fall" }))],
      burns: burn.hits,
      dead,
      terrain: this.groundOut(),
      tanks: this.tanksOut(),
    });

    await this.endTurn();
  }

  /**
   * Whose turn it is next, or whether there is a next turn at all.
   *
   * A duel is over when one tank is left standing, and also when none is —
   * two tanks killed by the same blast is a draw, not a hung room.
   */
  async endTurn() {
    const g = this.g;
    const alive = this.tankList().filter((t) => !t.dead);
    if (alive.length <= 1) return void await this.finish(alive.length === 1 ? "won" : "mutual");

    for (let i = 0; i < g.order.length; i++) {
      g.turn = (g.turn + 1) % g.order.length;
      if (!g.tanks[this.whoseTurn()]?.dead) break;
    }
    g.turnNo += 1;
    g.wind = this.rollWind();
    g.turnEndsAt = Date.now() + TURN_MS;
    await this.save();
    this.pushAll();
    this.broadcast("TANK_TURN", { uid: this.whoseTurn(), wind: g.wind, turnNo: g.turnNo, endsAt: g.turnEndsAt });
    await this.maybeAI();
  }

  /** A computer's turn, taken after a pause long enough to look like thought. */
  async maybeAI() {
    const t = this.g?.tanks?.[this.whoseTurn()];
    if (!t?.ai) return;
    await this.state.storage.setAlarm(Date.now() + AI_THINK_MS);
  }

  async alarm() {
    const g = this.g;
    if (!g || g.phase !== "PLAYING") return;
    const t = g.tanks[this.whoseTurn()];
    if (!t) return;
    if (!t.ai) {
      // A human who has not fired inside the turn clock has walked away, and
      // the duel carries on without them rather than waiting all night.
      if (g.turnEndsAt && Date.now() >= g.turnEndsAt) await this.endTurn();
      else await this.state.storage.setAlarm(g.turnEndsAt || Date.now() + TURN_MS);
      return;
    }
    const mark = this.tankList()
      .filter((o) => !o.dead && o.uid !== t.uid)
      .sort((a, b) => Math.abs(a.x - t.x) - Math.abs(b.x - t.x))[0];
    if (!mark) return void await this.endTurn();
    const rnd = this.rnd();
    const shot = aiAim({
      from: { x: t.x, y: t.y - 6 },
      to: { x: mark.x, y: mark.y },
      wind: g.wind, level: t.ai, rnd,
      terrain: g.terrain, tanks: this.tankList(), shooter: t.uid,
    });
    await this.fire(null, t.uid, { angle: shot.angle, power: shot.power });
  }

  /* ── what it was worth ─────────────────────────────────────────── */

  async finish(status) {
    const g = this.g;
    if (!g || g.phase === "OVER") return;
    g.phase = "OVER";

    const field = this.tankList();
    const people = field.filter((t) => !t.ai);
    const ordered = standings(field);
    const ratings = Object.fromEntries(people.map((t) => [t.uid, t.mmrAtStart || 0]));
    const mode = field.length >= 3 ? "rumble" : "match";

    const results = ordered.map((t, i) => {
      const placement = i + 1;
      const score = duelScore({
        placement, field: field.length,
        hits: t.hits, shots: t.shots, damage: t.damage, survived: !t.dead,
      });
      const gain = sessionGain({
        score,
        completed: true,
        playerMmr: t.mmrAtStart || 0,
        fieldMmr: fieldMmrFor(t.uid, ratings),
        mode, seed: t.seed, placement,
      });
      t.boost = !!g.applied?.[t.uid];
      if (t.boost) gain.total = boosted(gain.total);
      const after = (t.mmrAtStart || 0) + gain.total;
      return {
        uid: t.uid,
        name: t.name,
        ai: t.ai || undefined,
        score,
        placement,
        seed: t.seed || null,
        hp: Math.max(0, t.hp),
        shots: t.shots, hits: t.hits,
        damage: t.damage, taken: t.taken,
        spent: t.ars?.used && Object.keys(t.ars.used).length ? { ...t.ars.used } : undefined,
        status: t.dead ? "destroyed" : "standing",
        elapsedMs: Date.now() - g.startedAt,
        mmrBefore: t.mmrAtStart || 0,
        gain: gain.total, boost: !!t.boost,
        breakdown: { base: gain.base, challenge: gain.challenge, completion: gain.completion, seed: gain.seed },
        mmrAfter: after,
        belt: beltFor(after).name,
        promoted: beltFor(after).name !== beltFor(t.mmrAtStart || 0).name,
      };
    });

    g.applied = {};
    // What the arsenal used is spent by the record write; what was armed and
    // never fired stays armed for the next duel in this room. Saved before
    // anything is broadcast, so a sleeping object cannot lose the spend.
    for (const t of field) {
      const a = this.arsOf(t);
      for (const [k, n] of Object.entries(a.used)) {
        a.armed[k] = Math.max(0, (a.armed[k] || 0) - n);
        if (!a.armed[k]) delete a.armed[k];
      }
      a.used = {};
      a.guards = [];
      a.chute = false;
    }
    await this.save();
    this.pushAll();
    this.logEvent("over", status === "mutual"
      ? "Everybody lost: the last two went together."
      : `${ordered[0]?.name || "Nobody"} is the last tank standing.`);
    this.broadcast("TANK_OVER", { results, status, mode });

    // The computers are not on the ladder, so they are not in the record —
    // but the field they made is, which is what the curve is scored against.
    this.state.waitUntil(recordMatch(this.env, {
      code: g.code,
      game: "artillery",
      mode: `${g.order.length} tanks · ${windModeById(g.windMode).name.toLowerCase()}${g.aiCount ? ` · ${aiLevelById(g.aiLevel).name} computers` : ""}`,
      roundNo: g.roundNo,
      finishedAt: Date.now(),
      durationMs: Date.now() - g.startedAt,
      results: results.filter((r) => !r.ai),
    }).catch(() => {}));
  }

  /* ── plumbing ──────────────────────────────────────────────────── */

  tanksOut() {
    return this.tankList().map((t) => ({
      uid: t.uid, name: t.name, ai: t.ai || null,
      avatar: t.avatar, ico: avatarById(t.avatar)?.ico || null,
      x: Math.round(t.x), y: Math.round(t.y),
      hp: Math.max(0, t.hp), dead: !!t.dead,
      angle: t.angle, power: t.power,
      shots: t.shots, hits: t.hits, damage: t.damage,
      // What is up is public: a shield nobody can see is a shot wasted by
      // accident rather than a shot spent on purpose.
      guards: this.guardsOf(t.uid),
    }));
  }

  view(uid) {
    const g = this.g;
    if (!g) return null;
    const me = g.tanks[uid];
    return {
      code: g.code,
      game: GAME_NAME,
      phase: g.phase,
      you: uid,
      solo: !!g.solo,
      hostUid: g.hostUid || null,
      isHost: this.canStart(uid),
      world: { w: WORLD_W, h: WORLD_H, r: TANK_R },
      wind: g.wind,
      windMax: this.windMax(),
      windMode: g.windMode || "normal",
      windModes: WIND_MODES,
      terrain: g.phase === "LOBBY" ? [] : this.groundOut(),
      fires: g.fires,
      turn: this.whoseTurn(),
      turnNo: g.turnNo,
      turnEndsAt: g.turnEndsAt,
      aiLevel: g.aiLevel,
      aiCount: g.aiCount,
      levels: AI_LEVELS,
      avatars: AVATARS,
      roundNo: g.roundNo,
      tanks: this.tanksOut(),
      // Aiming help is withheld from a tank an EMP has just hit, and from
      // nobody else. Withheld here, not hidden in the client, or it is not
      // withheld at all.
      aim: me && me.empUntil > g.turnNo ? null : { angle: me?.angle ?? 45, power: me?.power ?? 60 },
      emp: me ? Math.max(0, (me.empUntil || 0) - g.turnNo) : 0,
      arsenal: me ? this.arsenalView(me) : null,
      log: (g.log || []).slice(-60),
    };
  }

  note(uid, text) {
    for (const ws of this.state.getWebSockets()) {
      let who = null;
      try { who = ws.deserializeAttachment()?.uid; } catch { /* gone */ }
      if (who === uid) this.send(ws, "TANK_NOTE", { text });
    }
  }

  pushAll() {
    for (const ws of this.state.getWebSockets()) {
      let who = null;
      try { who = ws.deserializeAttachment()?.uid; } catch { /* gone */ }
      this.send(ws, "TANK_STATE", { state: this.view(who) });
    }
    this.announce();
  }

  announce() {
    const g = this.g;
    if (!g) return;
    announceRoom(this.env, this.state, {
      game: "artillery",
      code: g.code,
      host: Object.values(g.tanks).find((t) => !t.ai)?.name || "Someone",
      players: g.solo ? 0 : this.liveUids().size,
      phase: g.phase,
      label: g.solo
        ? `Solo · ${aiLevelById(g.aiLevel).name}`
        : `${g.order.length || Object.keys(g.tanks).length} tanks · ${windModeById(g.windMode).name.toLowerCase()}`,
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

  save() { return this.state.storage.put({ game: this.g }); }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("This endpoint speaks WebSocket only.", { status: 426 });
    const uid = request.headers.get("X-Dojo-Uid");
    const name = request.headers.get("X-Dojo-Name") || "Commander";
    const code = (request.headers.get("X-Dojo-Code") || "TANK").toUpperCase();
    if (!uid) return new Response("Unauthenticated.", { status: 401 });

    const url = new URL(request.url);
    if (!this.g) this.g = this.blank(code, url.searchParams.get("solo") === "1");
    // Solo means solo: the room is unlisted, but a code can still be typed at
    // it, and a private duel a stranger can walk into is not private.
    if (this.g.solo && this.g.hostUid && this.g.hostUid !== uid)
      return new Response("This is a solo duel.", { status: 403 });

    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ uid, name });
    await this.onJoin(uid, name, pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async onJoin(uid, name, ws) {
    const g = this.g;
    if (!g.tanks[uid]) g.tanks[uid] = this.freshTank(uid, name);
    if (!g.hostUid) g.hostUid = uid;
    g.tanks[uid].name = name;
    g.tanks[uid].lastSeen = Date.now();
    // A tank that joins mid-duel stands somewhere rather than at the origin,
    // and shoots from the back of the order when the next duel starts.
    if (g.phase === "PLAYING" && !g.order.includes(uid)) {
      const spare = startPositions(g.terrain, g.order.length + 2, g.seed).pop();
      g.tanks[uid].x = spare;
      g.tanks[uid].y = groundAt(g.terrain, spare) - TANK_R;
      g.tanks[uid].dead = true;   // watching, until the next duel
    }
    await this.save();
    this.send(ws, "TANK_WELCOME", { you: uid, isHost: this.canStart(uid), arsenal: ARSENALS.artillery });
    // What was said before you got here, so a reload does not empty the room.
    for (const line of (g.chat || []).slice(-30)) this.send(ws, "TANK_CHAT", { line });
    this.pushAll();
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    let who = null;
    try { who = ws.deserializeAttachment(); } catch { /* gone */ }
    const uid = who?.uid;
    if (!uid || !this.g) return;
    const t = this.g.tanks[uid];
    if (t) t.lastSeen = Date.now();

    switch (msg.type) {
      case "TANK_START": return void await this.start(ws, uid, msg);
      case "TANK_FIRE": return void await this.fire(ws, uid, msg);
      case "TANK_AIM": {
        // Kept so a reload does not lose the dial, and so the room can show
        // the barrel turning. It decides nothing.
        if (!t) return;
        t.angle = Math.max(0, Math.min(180, Number(msg.angle) || 0));
        t.power = Math.max(1, Math.min(100, Number(msg.power) || 1));
        await this.save();
        this.broadcast("TANK_BARREL", { uid, angle: t.angle, power: t.power });
        return;
      }
      case "TANK_ARSENAL": return void await this.useArsenal(ws, uid, msg);
      case "TANK_SAY": return void await this.say(ws, uid, msg);
      case "TANK_END": return void await this.finish("ended");
      case "TOKENS": return void await this.sendTokens(ws, uid, false);
      case "APPLY_TOKEN": return void await this.sendTokens(ws, uid, true);
      case "ARM_TOKEN": return void await this.arm(ws, uid, msg);
      case "DISARM_TOKEN": return void await this.disarm(ws, uid, msg);
      case "PING": this.announce(); return;
    }
  }

  async webSocketClose(ws) { await this.onGone(ws); }
  async webSocketError(ws) { await this.onGone(ws); }

  async onGone() {
    // The tank stays on the field: a player who reloads walks back into the
    // same duel, on the same hill, holding the same tokens.
    this.announce();
  }
}
