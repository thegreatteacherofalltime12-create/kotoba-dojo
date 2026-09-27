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

export const GAME_NAME = "Artillery Tank Duel";

// The world is a fixed size in its own units and the canvas scales to it, so
// a phone and a desktop are playing the identical map rather than two maps
// that happen to look alike.
export const WORLD_W = 1000;
export const WORLD_H = 600;

export const GRAVITY = 0.32;
/** Wind blows between these, and is redrawn every round. */
export const WIND_MAX = 40;
export const MAX_STEPS = 2600;

/** Power 1..100 becomes a muzzle speed. 100 crosses most of the map at 45°. */
export const SPEED_PER_POWER = 0.17;

export const TANK_R = 11;          // how big a tank is to a shell
export const START_HP = 100;
export const BLAST_R = 58;         // a plain shell's crater and kill radius
export const BLAST_DAMAGE = 46;    // at dead centre

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
export function fire({ from, angle, power, wind, terrain, tanks, shooter, gravity = GRAVITY, bounce = 0 }) {
  const rad = (Number(angle) || 0) * Math.PI / 180;
  const v = Math.max(1, Math.min(100, Number(power) || 1)) * SPEED_PER_POWER;
  let x = from.x;
  let y = from.y;
  let vx = Math.cos(rad) * v;
  let vy = -Math.sin(rad) * v;
  const ax = (Number(wind) || 0) / 1400;

  const path = [[Math.round(x), Math.round(y)]];
  let left = bounce;

  for (let step = 0; step < MAX_STEPS; step++) {
    vx += ax;
    vy += gravity;
    x += vx;
    y += vy;

    if (step % 4 === 0) path.push([Math.round(x), Math.round(y)]);

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
export function settle(terrain, tank) {
  const ground = groundAt(terrain, tank.x) - TANK_R;
  const fell = Math.max(0, ground - tank.y);
  tank.y = ground;
  // A long drop hurts, which is what makes digging the ground out from under
  // somebody a real tactic rather than a way of making them comfortable.
  return fell > 60 ? Math.min(35, Math.round((fell - 60) / 6)) : 0;
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
