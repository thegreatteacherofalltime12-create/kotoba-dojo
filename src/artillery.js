/**
 * Artillery Tank Duel — the parts that are arithmetic rather than room.
 *
 * Everything here is pure, so the whole of the ballistics can be tested
 * without standing a Durable Object up, and so the room and the browser can
 * never disagree about where a shell went.
 *
 * That last point is the reason the physics lives on the server at all. In a
 * game where the client says "I hit you", the client always hits you. So the
 * room fires the shell, integrates every step of it, and sends the finished
 * flight path back; the browser's job is to draw a thing that has already
 * happened. It costs a few hundred bytes a shot and it makes the game
 * unriggable from a console, which is worth a great deal more.
 */

import { ARSENALS } from "./arsenals.js";

export const GAME_NAME = "Artillery Tank Duel";

// The world is a fixed size in its own units and the canvas scales to it, so
// a phone and a desktop are playing the identical map rather than two maps
// that happen to look alike.
export const WORLD_W = 1000;
export const WORLD_H = 600;

export const GRAVITY = 0.32;
/** Wind blows between these, and is redrawn every round. */
export const WIND_MAX = 40;

/**
 * How hard it is allowed to blow, as the host's choice rather than a constant.
 *
 * Wind is the whole difficulty dial of an artillery game: dead calm is a game
 * of geometry you can learn, and a gale is a game of reading the gauge every
 * turn. Both are worth playing, and which one you are playing should not be a
 * surprise — so it is picked before the duel and shown on the field.
 */
export const WIND_MODES = [
  { id: "calm", name: "Dead calm", max: 0, blurb: "No wind at all. Pure geometry." },
  { id: "light", name: "Light airs", max: 14, blurb: "Enough to matter at long range." },
  { id: "normal", name: "Normal", max: WIND_MAX, blurb: "The usual: read the gauge every turn." },
  { id: "wild", name: "Wild", max: 85, blurb: "A gale that can carry a shell half the map." },
];

export function windModeById(id) {
  return WIND_MODES.find((w) => w.id === id) || WIND_MODES[2];
}
export const MAX_STEPS = 2600;

/** Power 1..100 becomes a muzzle speed. 100 crosses most of the map at 45°. */
export const SPEED_PER_POWER = 0.17;

export const TANK_R = 11;          // how big a tank is to a shell
export const START_HP = 100;
export const BLAST_R = 58;         // a plain shell's crater and kill radius
export const BLAST_DAMAGE = 46;    // at dead centre
export const FALL_SAFE = 60;       // a drop shorter than this never hurts

// ── the ground ───────────────────────────────────────────────────────

/** mulberry32, so a seed gives the same battlefield to everybody in it. */
export function rngFrom(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A battlefield, as one ground height per column.
 *
 * Three sine waves of different lengths laid over each other, which gives
 * hills worth hiding behind without the spikes that midpoint displacement
 * leaves — a spike one column wide is a shot that lands on nothing and a
 * player who cannot tell why.
 */
export function makeTerrain(seed) {
  const rnd = rngFrom(seed);
  const base = WORLD_H * (0.62 + rnd() * 0.12);
  const waves = [
    { len: 520 + rnd() * 260, amp: 54 + rnd() * 46, at: rnd() * Math.PI * 2 },
    { len: 210 + rnd() * 120, amp: 26 + rnd() * 24, at: rnd() * Math.PI * 2 },
    { len: 95 + rnd() * 55, amp: 9 + rnd() * 9, at: rnd() * Math.PI * 2 },
  ];
  const g = new Array(WORLD_W);
  for (let x = 0; x < WORLD_W; x++) {
    let y = base;
    for (const w of waves) y += Math.sin((x / w.len) * Math.PI * 2 + w.at) * w.amp;
    // Nothing may be so high there is no shot over it, and nothing so low
    // that a tank is standing in the sea.
    g[x] = Math.max(WORLD_H * 0.28, Math.min(WORLD_H - 24, y));
  }
  return g;
}

export function groundAt(terrain, x) {
  const i = Math.max(0, Math.min(WORLD_W - 1, Math.round(x)));
  return terrain[i];
}

/**
 * Where the tanks start.
 *
 * Spread evenly across the map with a margin, then nudged off any slope too
 * steep to sit on. Two tanks are never placed within a blast radius of each
 * other, or the first shot of the game is a coin toss.
 */
export function startPositions(terrain, n, seed) {
  const rnd = rngFrom(seed ^ 0x7a17);
  const margin = 70;
  const span = WORLD_W - margin * 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const slot = margin + (span * (i + 0.5)) / n;
    const jitter = (rnd() - 0.5) * Math.min(90, span / n * 0.5);
    out.push(Math.round(Math.max(margin, Math.min(WORLD_W - margin, slot + jitter))));
  }
  return out;
}

/** A crater, carved into the ground and never below the floor of the world. */
export function carve(terrain, x, y, radius) {
  const from = Math.max(0, Math.round(x - radius));
  const to = Math.min(WORLD_W - 1, Math.round(x + radius));
  for (let i = from; i <= to; i++) {
    const dx = i - x;
    const half = Math.sqrt(Math.max(0, radius * radius - dx * dx));
    const bottom = y + half;
    // Only ground inside the circle goes. Ground below the crater stays,
    // which is what stops a shell tunnelling to the bottom of the map.
    if (terrain[i] < bottom && terrain[i] > y - half) {
      terrain[i] = Math.min(WORLD_H - 2, bottom);
    }
  }
}

// ── the shell ────────────────────────────────────────────────────────

/**
 * Fire one shell and find out what it hit.
 *
 * `angle` is degrees from east, so 90 is straight up and 135 is up and to
 * the left. `power` is 1 to 100. Everything else about the shot — where it
 * started, what the wind is doing, who else is on the field — is handed in,
 * so this function has no memory and always answers the same way twice.
 *
 * The returned path is sampled rather than complete: two thousand steps is
 * more than any browser needs to draw a smooth arc, and the last point is
 * always the point of impact so the explosion lands where it should.
 */
export function fire({
  from, angle, power, wind, terrain, tanks, shooter,
  gravity = GRAVITY, bounce = 0, vel = null, homing = 0, toward = null, apex = false,
}) {
  const rad = (Number(angle) || 0) * Math.PI / 180;
  const v = Math.max(1, Math.min(100, Number(power) || 1)) * SPEED_PER_POWER;
  let x = from.x;
  let y = from.y;
  // A shell handed a velocity was already in the air — a cluster fragment
  // leaving the shell that carried it — so the angle and power are ignored.
  let vx = vel ? Number(vel.vx) || 0 : Math.cos(rad) * v;
  let vy = vel ? Number(vel.vy) || 0 : -Math.sin(rad) * v;
  const ax = (Number(wind) || 0) / 1400;

  const path = [[Math.round(x), Math.round(y)]];
  let left = bounce;

  for (let step = 0; step < MAX_STEPS; step++) {
    vx += ax;
    vy += gravity;
    // A homing shell turns toward its mark: the velocity is rotated a little
    // way toward the bearing of the target each step, at the same speed. A
    // sideways shove was the first version of this and it was worse than
    // nothing — it pushed a shell that was already going to land on somebody
    // straight past them. Turning converges instead.
    //
    // The turn rate is the whole of the balance. It is enough to pull a shot
    // that was nearly right onto the tank, and nowhere near enough to rescue
    // a bad one: the mark has to be ahead of the shell, the shell keeps its
    // speed, and a hill in the way still stops it dead.
    if (homing && toward) {
      const dx = toward.x - x, dy = toward.y - y;
      const want = Math.hypot(dx, dy);
      const speed = Math.hypot(vx, vy);
      if (want > 1 && speed > 0.01 && (vx * dx + vy * dy) > 0) {
        const turn = Math.min(homing, 1);
        const nx = vx / speed + ((dx / want) - vx / speed) * turn;
        const ny = vy / speed + ((dy / want) - vy / speed) * turn;
        const len = Math.hypot(nx, ny) || 1;
        vx = (nx / len) * speed;
        vy = (ny / len) * speed;
      }
    }
    x += vx;
    y += vy;

    if (step % 4 === 0) path.push([Math.round(x), Math.round(y)]);

    // The top of the arc, where a cluster shell stops being one shell. The
    // velocity goes back with it so the fragments carry on from here.
    if (apex && vy >= 0 && step > 1) {
      path.push([Math.round(x), Math.round(y)]);
      return { path, hit: { kind: "apex", x, y, vx, vy } };
    }

    // Off the side of the world, or so far up it will not be coming back
    // inside the step budget.
    if (x < -40 || x > WORLD_W + 40) {
      path.push([Math.round(x), Math.round(y)]);
      return { path, hit: { kind: "away", x, y } };
    }
    if (y > WORLD_H + 60) {
      path.push([Math.round(x), Math.round(y)]);
      return { path, hit: { kind: "away", x, y } };
    }

    // A tank first: a shell that would pass through one stops in it.
    for (const t of tanks) {
      if (t.dead || t.uid === shooter && step < 6) continue;
      const dx = x - t.x, dy = y - t.y;
      if (dx * dx + dy * dy <= TANK_R * TANK_R) {
        path.push([Math.round(x), Math.round(y)]);
        return { path, hit: { kind: "tank", uid: t.uid, x, y } };
      }
    }

    if (y >= groundAt(terrain, x) && y > 0) {
      if (left > 0) {
        // A bouncy shell takes the slope into account rather than simply
        // flipping, or it comes straight back at whoever fired it.
        left -= 1;
        const slope = groundAt(terrain, x + 3) - groundAt(terrain, x - 3);
        y = groundAt(terrain, x) - 1;
        vy = -Math.abs(vy) * 0.62;
        vx = (vx - slope * 0.18) * 0.82;
        path.push([Math.round(x), Math.round(y)]);
        continue;
      }
      path.push([Math.round(x), Math.round(y)]);
      return { path, hit: { kind: "ground", x, y } };
    }
  }
  return { path, hit: { kind: "away", x, y } };
}

/**
 * What a blast does to a tank at a given distance.
 *
 * Linear falloff to nothing at the edge, which is easier to aim around than
 * an inverse square and much easier to explain when somebody asks why they
 * took eleven damage.
 */
export function splash(dist, radius = BLAST_R, top = BLAST_DAMAGE) {
  if (dist >= radius) return 0;
  return Math.max(0, Math.round(top * (1 - dist / radius)));
}

/** Everything one blast does, to everybody, in one place. */
export function blastOn(tanks, at, radius = BLAST_R, top = BLAST_DAMAGE) {
  const out = [];
  for (const t of tanks) {
    if (t.dead) continue;
    const d = Math.hypot(t.x - at.x, t.y - at.y);
    const hurt = splash(d, radius, top);
    if (hurt > 0) out.push({ uid: t.uid, damage: hurt, dist: Math.round(d) });
  }
  return out;
}

/** A tank stands on the ground under it, and falls when the ground goes. */
export function settle(terrain, tank, guard = []) {
  const ground = groundAt(terrain, tank.x) - TANK_R;
  const fell = Math.max(0, ground - tank.y);
  tank.y = ground;
  // A long drop hurts, which is what makes digging the ground out from under
  // somebody a real tactic rather than a way of making them comfortable.
  if ((guard || []).includes("at_chute")) return 0;
  return fell > FALL_SAFE ? Math.min(35, Math.round((fell - FALL_SAFE) / 6)) : 0;
}

// ── the arsenal ──────────────────────────────────────────────────────

/**
 * The tank arsenal, and what each token does to a turn.
 *
 * Everything here is arithmetic on the same terms the plain shot uses, for
 * the same reason the plain shot lives here: a paid weapon the client worked
 * out for itself is a paid weapon a console can aim for free. So a token
 * changes the numbers handed to `fire`, or it changes the blasts that come
 * back, and nothing else.
 *
 * Four kinds, and the room only ever needs to know which kind it holds:
 *
 *   shell   changes the shot being taken — spread, payload, bounce, damage
 *   strike  replaces the shot with something called down on a column
 *   guard   changes what a blast does to the tank holding it
 *   sight   shows you something, and costs you no turn to look
 *   turn    does something to a tank on its own, without firing
 */
export const ARSENAL = ARSENALS.artillery;

export const TOKEN_KIND = {
  at_triple: "shell", at_homing: "shell", at_cluster: "shell", at_bouncy: "shell",
  at_napalm: "shell", at_mud: "shell", at_vampire: "shell", at_double: "shell",
  at_nowind: "shell", at_tracer: "sight",
  at_orbital: "strike", at_carpet: "strike", at_leveler: "strike",
  at_bubble: "guard", at_armour: "guard", at_chute: "guard",
  at_teleport: "turn", at_repair: "turn", at_emp: "turn",
};

/**
 * What the shell is, as opposed to what is done to it.
 *
 * One of these at a time: a shell cannot be a mud shell and a napalm shell
 * both, and letting two stack would mean deciding whose crater wins in the
 * room, at the one moment there is no good answer.
 */
export const PAYLOADS = ["at_homing", "at_cluster", "at_napalm", "at_mud"];

export const TRIPLE_SPREAD = 6;    // degrees between the three shells
export const HOMING_PULL = 0.05;   // how far it turns toward the mark each step
export const CLUSTER_N = 3;
export const CLUSTER_SPREAD = 0.85;
export const CLUSTER_R = 38;
export const CLUSTER_DAMAGE = 22;
export const NAPALM_R = 34;
export const NAPALM_DAMAGE = 20;
export const BURN_R = 46;          // the pool of fire it leaves
export const BURN_DAMAGE = 12;     // a turn, to anybody standing in it
export const BURN_TURNS = 3;
export const MUD_R = 62;           // the mound it raises, in place of a crater
export const ORBITAL_LANES = 3;
export const ORBITAL_GAP = 72;
export const ORBITAL_R = 44;
export const ORBITAL_DAMAGE = 38;
export const CARPET_N = 5;
export const CARPET_GAP = 62;
export const CARPET_R = 40;
export const CARPET_DAMAGE = 30;
export const LEVEL_R = 180;
export const DOUBLE_MULT = 2;
export const VAMPIRE_SHARE = 0.5;
export const ARMOUR_CUT = 0.15;
export const REPAIR_SHARE = 0.2;

const holds = (use, key) => (use || []).includes(key);

/** The one payload on a shot, or null for a plain shell. */
export function payloadOf(use) {
  return PAYLOADS.find((k) => holds(use, k)) || null;
}

/** Wind, as this shot will feel it. */
export function windFor(wind, use) {
  return holds(use, "at_nowind") ? 0 : (Number(wind) || 0);
}

/**
 * The shot a turn actually takes, once the tokens on it are read.
 *
 * Returned rather than applied so the room can show it — a player who paid
 * 2,500 for three shells should be able to see that three are coming.
 */
export function shotPlan({ angle, power, use = [] }) {
  const a = Number(angle) || 0;
  const payload = payloadOf(use);
  const shells = holds(use, "at_triple")
    ? [a - TRIPLE_SPREAD, a, a + TRIPLE_SPREAD]
    : [a];
  return {
    shells: shells.map((deg) => ({ angle: deg, power })),
    payload,
    bounce: holds(use, "at_bouncy") ? 1 : 0,
    homing: payload === "at_homing" ? HOMING_PULL : 0,
    split: payload === "at_cluster" ? CLUSTER_N : 0,
    mound: payload === "at_mud",
    burn: payload === "at_napalm",
    double: holds(use, "at_double"),
    vampire: holds(use, "at_vampire"),
    windless: holds(use, "at_nowind"),
  };
}

/** The blast one landed shell leaves, by what kind of shell it was. */
function blastFor(hit, plan, child = false) {
  if (child) return { x: hit.x, y: hit.y, radius: CLUSTER_R, top: CLUSTER_DAMAGE, kind: "cluster" };
  if (plan.mound) return { x: hit.x, y: hit.y, radius: MUD_R, top: 0, kind: "mud" };
  if (plan.burn) return { x: hit.x, y: hit.y, radius: NAPALM_R, top: NAPALM_DAMAGE, kind: "napalm" };
  return { x: hit.x, y: hit.y, radius: BLAST_R, top: BLAST_DAMAGE, kind: "shell" };
}

/** Whoever a homing shell leans toward: the nearest tank that is not you. */
export function nearestTarget(tanks, from, shooter) {
  let best = null;
  for (const t of tanks || []) {
    if (t.dead || t.uid === shooter) continue;
    const d = Math.hypot(t.x - from.x, t.y - from.y);
    if (!best || d < best.d) best = { d, x: t.x, y: t.y, uid: t.uid };
  }
  return best;
}

/**
 * A whole turn's worth of shooting, flown and finished.
 *
 * Every shell of it is integrated against the battlefield as it stood when
 * the turn began — the crater the first shell of a triple shot digs does not
 * move the second one. That is a simplification, and it is the honest kind:
 * all three were in the air together.
 *
 * `aim` is where a strike is called down, which is the only thing in the
 * arsenal pointed at a place rather than fired from a barrel.
 */
export function salvo({ from, angle, power, wind, terrain, tanks, shooter, use = [], aim = null }) {
  const plan = shotPlan({ angle, power, use });
  const w = windFor(wind, use);
  const flights = [];
  const blasts = [];
  const fires = [];

  // A strike is not a shot: it is called down on a column and the barrel
  // never moves. It takes the turn all the same.
  if (holds(use, "at_leveler")) {
    const x = Math.max(0, Math.min(WORLD_W - 1, Math.round(aim?.x ?? from.x)));
    return { plan, wind: w, flights, blasts, fires, level: { x, radius: LEVEL_R } };
  }
  if (holds(use, "at_orbital") || holds(use, "at_carpet")) {
    const orbital = holds(use, "at_orbital");
    const n = orbital ? ORBITAL_LANES : CARPET_N;
    const gap = orbital ? ORBITAL_GAP : CARPET_GAP;
    const x0 = Math.round(aim?.x ?? from.x);
    for (let i = 0; i < n; i++) {
      const x = Math.round(x0 + (i - (n - 1) / 2) * gap);
      if (x < 0 || x > WORLD_W - 1) continue;
      const y = groundAt(terrain, x);
      blasts.push({
        x, y,
        radius: orbital ? ORBITAL_R : CARPET_R,
        top: orbital ? ORBITAL_DAMAGE : CARPET_DAMAGE,
        kind: orbital ? "orbital" : "carpet",
      });
      // Handed over as a flight so the client has one thing to animate either
      // way: straight down out of the sky, which is what it looks like.
      flights.push({
        path: [[x, -20], [x, Math.round(y)]],
        hit: { kind: "ground", x, y },
      });
    }
    return { plan, wind: w, flights, blasts, fires };
  }

  const mark = nearestTarget(tanks, from, shooter);

  for (const shell of plan.shells) {
    const shot = fire({
      from, angle: shell.angle, power: shell.power, wind: w, terrain, tanks, shooter,
      bounce: plan.bounce,
      homing: plan.homing && mark ? plan.homing : 0,
      toward: mark,
      apex: plan.split > 0,
    });
    flights.push({ path: shot.path, hit: shot.hit });

    // A cluster shell never lands: it comes apart at the top of its arc and
    // three smaller ones finish the flight.
    if (plan.split && shot.hit.kind === "apex") {
      for (let i = 0; i < plan.split; i++) {
        const spread = (i - (plan.split - 1) / 2) * CLUSTER_SPREAD;
        const child = fire({
          from: { x: shot.hit.x, y: shot.hit.y },
          vel: { vx: shot.hit.vx + spread, vy: shot.hit.vy },
          wind: w, terrain, tanks, shooter,
        });
        flights.push({ path: child.path, hit: child.hit, child: true });
        if (child.hit.kind !== "away") blasts.push(blastFor(child.hit, plan, true));
      }
      continue;
    }
    if (shot.hit.kind === "away") continue;
    blasts.push(blastFor(shot.hit, plan));
    if (plan.burn) fires.push({ x: Math.round(shot.hit.x), radius: BURN_R, turns: BURN_TURNS });
  }

  return { plan, wind: w, flights, blasts, fires };
}

/** A mud shell's mound: ground raised rather than taken away. */
export function mound(terrain, x, radius = MUD_R) {
  const from = Math.max(0, Math.round(x - radius));
  const to = Math.min(WORLD_W - 1, Math.round(x + radius));
  for (let i = from; i <= to; i++) {
    const dx = i - x;
    const lift = Math.sqrt(Math.max(0, radius * radius - dx * dx)) * 0.55;
    terrain[i] = Math.max(WORLD_H * 0.16, terrain[i] - lift);
  }
}

/**
 * A terrain leveler: everything inside the radius pulled toward the average
 * height of it, with the rim eased so the new flat does not meet the old hill
 * in a cliff no shell can be fired over.
 */
export function levelGround(terrain, x, radius = LEVEL_R) {
  const from = Math.max(0, Math.round(x - radius));
  const to = Math.min(WORLD_W - 1, Math.round(x + radius));
  let sum = 0;
  for (let i = from; i <= to; i++) sum += terrain[i];
  const flat = sum / (to - from + 1);
  for (let i = from; i <= to; i++) {
    // 1 in the middle, 0 at the rim: the flat wins where it was aimed and the
    // hill keeps its shape where it was not.
    const ease = Math.max(0, Math.min(1, (1 - Math.abs(i - x) / radius) * 1.4));
    terrain[i] = terrain[i] + (flat - terrain[i]) * ease;
  }
  return Math.round(flat);
}

/** What the shooter's own tokens do to the damage a blast deals. */
export function dealt(raw, use) {
  return holds(use, "at_double") ? Math.round(raw * DOUBLE_MULT) : raw;
}

/**
 * What the tank being hit makes of it. A shield eats the shot whole; heavy
 * armour takes a seventh off. Both are spent by taking the hit, which is why
 * this says whether it was used rather than doing it quietly.
 */
export function taken(raw, guard = []) {
  if (raw <= 0) return { damage: 0, blocked: false, armoured: false };
  if (holds(guard, "at_bubble")) return { damage: 0, blocked: true, armoured: false };
  if (holds(guard, "at_armour"))
    return { damage: Math.max(0, Math.round(raw * (1 - ARMOUR_CUT))), blocked: false, armoured: true };
  return { damage: raw, blocked: false, armoured: false };
}

/** What a vampire shell gives back to whoever fired it. */
export function drained(total, use) {
  return holds(use, "at_vampire") ? Math.round(Math.max(0, total) * VAMPIRE_SHARE) : 0;
}

/** Armor Repair, as a number of hit points rather than a promise. */
export function repaired(tank, max = START_HP) {
  const want = Math.round(max * REPAIR_SHARE);
  return Math.max(0, Math.min(want, max - (tank.hp || 0)));
}

/**
 * Fire left on the field, and what it does to whoever stands in it.
 *
 * Burns tick at the end of the turn, so a tank that drives — teleports — out
 * of a pool of fire is out of it, and one that sits in it pays for sitting. A
 * parachute is no help here; only a shield is.
 */
export function burnTick(tanks, fires, guardOf = () => []) {
  const hits = [];
  for (const f of fires || []) {
    for (const t of tanks) {
      if (t.dead) continue;
      if (Math.abs(t.x - f.x) > f.radius) continue;
      const { damage, blocked } = taken(BURN_DAMAGE, guardOf(t.uid));
      if (damage > 0) hits.push({ uid: t.uid, damage, from: "burn" });
      else if (blocked) hits.push({ uid: t.uid, damage: 0, from: "burn", blocked: true });
    }
  }
  const left = (fires || [])
    .map((f) => ({ ...f, turns: f.turns - 1 }))
    .filter((f) => f.turns > 0);
  return { hits, fires: left };
}

/**
 * Somewhere else to be.
 *
 * A teleport is only worth 4,500 if it is actually safe, so it looks for the
 * spot furthest from everybody else rather than any spot at all — out of a
 * crossfire, not into a different one.
 */
export function teleportTo(terrain, tanks, tank, rnd = Math.random) {
  const margin = 60;
  const others = (tanks || []).filter((t) => !t.dead && t.uid !== tank.uid);
  let best = null;
  for (let i = 0; i < 24; i++) {
    const x = Math.round(margin + rnd() * (WORLD_W - margin * 2));
    const near = others.length ? Math.min(...others.map((t) => Math.abs(t.x - x))) : WORLD_W;
    // A slope you cannot sit on is not a safe place to arrive.
    const slope = Math.abs(groundAt(terrain, x + 4) - groundAt(terrain, x - 4));
    const worth = near - slope * 6;
    if (!best || worth > best.worth) best = { x, worth };
  }
  const x = best ? best.x : Math.round(WORLD_W / 2);
  return { x, y: groundAt(terrain, x) - TANK_R };
}

// ── the commanders ───────────────────────────────────────────────────

export const AVATARS = [
  { id: "tread", name: "General Tread", ico: "\u{1F396}️" },
  { id: "steel", name: "Sergeant Steel", ico: "⚔️" },
  { id: "boom", name: "Boomstick", ico: "\u{1F9E8}" },
  { id: "iron", name: "Ironclad", ico: "\u{1F6E1}️" },
  { id: "bomb", name: "The Bombardier", ico: "\u{1F4A3}" },
  { id: "rocket", name: "Rocket", ico: "\u{1F680}" },
  { id: "camo", name: "Camo Commander", ico: "\u{1F33F}" },
  { id: "metal", name: "Heavy Metal", ico: "\u{1F918}" },
  { id: "blast", name: "Blast Radius", ico: "\u{1F4A5}" },
  { id: "shrap", name: "Shrapnel", ico: "⚙️" },
  { id: "tankg", name: "Tank Girl", ico: "\u{1F469}‍\u{1F527}" },
  { id: "command", name: "Commando", ico: "\u{1FA96}" },
  { id: "shell", name: "Shellshock", ico: "⚡" },
  { id: "gunner", name: "The Gunner", ico: "\u{1F3AF}" },
  { id: "ammo", name: "Ammo Pack", ico: "\u{1F4E6}" },
  { id: "flak", name: "Flak Jacket", ico: "\u{1F9BA}" },
  { id: "mav", name: "Maverick", ico: "\u{1F985}" },
  { id: "demo", name: "Demolition Dan", ico: "\u{1F6A7}" },
  { id: "wreck", name: "Wrecking Ball", ico: "\u{1F3D7}️" },
  { id: "cross", name: "Crosshairs", ico: "\u{1F52D}" },
];

export function avatarById(id) { return AVATARS.find((a) => a.id === id) || null; }

export function freeAvatar(taken) {
  const used = new Set(taken || []);
  return (AVATARS.find((a) => !used.has(a.id)) || AVATARS[0]).id;
}

// ── the computer gunners ─────────────────────────────────────────────

/**
 * Three levels, and the dial that matters is `miss`: how far off the perfect
 * shot the computer aims, in degrees and in power.
 *
 * A computer that can solve the ballistic equation exactly is not a
 * difficulty setting, it is a wall. So it solves it exactly and then throws
 * the answer away by a measured amount, which is what a person does too.
 */
export const AI_LEVELS = [
  { id: "easy", name: "Easy", miss: 9.5, powerMiss: 16, pay: 1.0 },
  { id: "medium", name: "Medium", miss: 4.5, powerMiss: 8, pay: 1.5 },
  { id: "hard", name: "Hard", miss: 1.8, powerMiss: 3.5, pay: 2.0 },
];

export const AI_MAX = 5;
export const AI_NAMES = ["Rustbucket", "Vulture", "Hammerhead", "Cinder", "Warthog"];

export function aiLevelById(id) {
  return AI_LEVELS.find((l) => l.id === id) || AI_LEVELS[0];
}

/**
 * Where a computer aims.
 *
 * It fires the shot in its head before it fires it for real — a coarse sweep
 * of angles and powers through the actual physics, then a finer sweep around
 * whichever came closest — and then throws the answer away by however much
 * its level is allowed to be wrong.
 *
 * The first version of this solved the ballistic equation in closed form,
 * which is tidy, quick, and could not see the wind, the hill in the way, or
 * the tank standing between it and the target. It hit about a tenth of the
 * time at every difficulty, which is to say the difficulty dial did nothing.
 * Simulating is slower and knows about all three, and the room can easily
 * afford a couple of hundred flights once a turn.
 */
export function aiAim({ from, to, wind, level, rnd, terrain, tanks = [], shooter = null }) {
  const l = aiLevelById(level);
  const right = to.x >= from.x;
  const at = (a) => (right ? a : 180 - a);
  const miss = (shot) => Math.hypot(shot.hit.x - to.x, shot.hit.y - to.y);

  const tryShot = (angle, power) =>
    fire({ from, angle, power, wind, terrain, tanks, shooter });

  let best = null;
  const keep = (angle, power) => {
    const d = miss(tryShot(angle, power));
    if (!best || d < best.d) best = { d, angle, power };
  };

  // Coarse first: the whole useful envelope, in big steps.
  for (let p = 16; p <= 100; p += 7) {
    for (let a = 12; a <= 84; a += 6) keep(at(a), p);
  }
  // Then close in on whatever came nearest.
  if (best) {
    const a0 = right ? best.angle : 180 - best.angle;
    for (let p = Math.max(8, best.power - 8); p <= Math.min(100, best.power + 8); p += 2) {
      for (let a = a0 - 5; a <= a0 + 5; a += 1) keep(at(Math.max(4, Math.min(88, a))), p);
    }
  }
  if (!best) return { angle: right ? 50 : 130, power: 55 };

  // And now be wrong about it, on purpose and by a measured amount.
  const angle = best.angle + (rnd() - 0.5) * 2 * l.miss;
  const power = best.power + (rnd() - 0.5) * 2 * l.powerMiss;
  return {
    angle: Math.max(0, Math.min(180, Math.round(angle * 10) / 10)),
    power: Math.max(8, Math.min(100, Math.round(power))),
  };
}

// ── what a duel was worth ────────────────────────────────────────────

/**
 * A finished duel on the arena's hundred-point scale, the same shape as the
 * race's raceScore and the Buzzer's boardScore: where you finished carries
 * most of it, and how well you shot carries the rest.
 */
export function duelScore({ placement, field, hits, shots, damage, survived }) {
  const place = field > 1 ? 80 - 50 * ((placement - 1) / (field - 1)) : 70;
  // Accuracy is worth having but cannot carry a loss on its own.
  const fired = Math.max(0, shots || 0);
  const aim = fired ? 14 * Math.min(1, (hits || 0) / fired) : 0;
  const hurt = Math.min(6, (damage || 0) / 120);
  const got = place * (survived ? 1 : 0.85) + aim + hurt;
  return Math.max(0, Math.min(100, Math.round(got)));
}

/** Last tank standing, then whoever did the most damage before they went. */
export function standings(tanks) {
  return [...tanks].sort((a, b) =>
    (a.dead ? 1 : 0) - (b.dead ? 1 : 0) ||
    (b.diedAt || Infinity) - (a.diedAt || Infinity) ||
    (b.damage || 0) - (a.damage || 0) ||
    String(a.name).localeCompare(String(b.name)));
}
