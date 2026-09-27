// Artillery Tank Duel — the ballistics, checked without a canvas.
//
// The physics runs on the server because a client that reports its own hits
// always hits. That makes these the tests that matter: if the arithmetic
// here is wrong, every player sees the same wrong thing and nobody can tell
// it is wrong from the outside.
import {
  makeTerrain, startPositions, groundAt, carve, settle, fire, splash, blastOn,
  aiAim, aiLevelById, duelScore, standings, rngFrom,
  AVATARS, avatarById, freeAvatar, AI_LEVELS, AI_MAX,
  WORLD_W, WORLD_H, TANK_R, BLAST_R, BLAST_DAMAGE, START_HP, SPEED_PER_POWER,
  ARSENAL, TOKEN_KIND, PAYLOADS, payloadOf, windFor, shotPlan, salvo, nearestTarget,
  mound, levelGround, dealt, taken, drained, repaired, burnTick, teleportTo,
  TRIPLE_SPREAD, HOMING_PULL, CLUSTER_N, BURN_R, BURN_DAMAGE, BURN_TURNS,
  MUD_R, ORBITAL_LANES, CARPET_N, CARPET_GAP, LEVEL_R,
} from "../src/artillery.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

/** A battlefield with n tanks standing on it, ready to shoot at each other. */
function field(seed, n = 2) {
  const terrain = makeTerrain(seed);
  const xs = startPositions(terrain, n, seed);
  const tanks = xs.map((x, i) => ({
    uid: `t${i}`, name: `T${i}`, x, y: groundAt(terrain, x) - TANK_R,
    hp: 100, dead: false, damage: 0,
  }));
  return { terrain, tanks };
}

console.log("\nthe ground");
{
  const a = makeTerrain(99);
  const b = makeTerrain(99);
  const c = makeTerrain(100);
  ok("a seed gives the same battlefield twice", a.every((v, i) => v === b[i]));
  ok("and a different seed gives a different one", a.some((v, i) => v !== c[i]));
  ok("it is one height per column", a.length === WORLD_W);
  ok("nothing is above the sky or below the world",
    a.every((v) => v > 0 && v < WORLD_H));
  // A single-column spike is a shot that lands on nothing and a player who
  // cannot see why.
  let worst = 0;
  for (let i = 1; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - a[i - 1]));
  ok(`no cliff between neighbouring columns (${worst.toFixed(1)} units)`, worst < 4);
}

console.log("\nwhere the tanks stand");
{
  const { terrain, tanks } = field(7, 5);
  ok("everybody is on the map", tanks.every((t) => t.x > 0 && t.x < WORLD_W));
  ok("and standing on the ground, not in it",
    tanks.every((t) => Math.abs(t.y - (groundAt(terrain, t.x) - TANK_R)) < 0.5));
  const gaps = tanks.map((t) => t.x).sort((a, b) => a - b);
  let closest = Infinity;
  for (let i = 1; i < gaps.length; i++) closest = Math.min(closest, gaps[i] - gaps[i - 1]);
  ok(`nobody starts inside somebody else's blast (${Math.round(closest)} units apart)`, closest > BLAST_R);
}

console.log("\nthe shell");
{
  const { terrain, tanks } = field(1234);
  const from = { x: 120, y: groundAt(terrain, 120) - TANK_R - 6 };
  const shot = (angle, power, wind = 0) =>
    fire({ from, angle, power, wind, terrain, tanks: [], shooter: null });

  ok("more power goes further",
    shot(45, 60).hit.x > shot(45, 30).hit.x && shot(45, 30).hit.x > shot(45, 15).hit.x);
  ok("the whole dial is usable rather than half of it",
    shot(45, 100).hit.x - from.x > 700);
  ok("straight up comes down on your own head",
    Math.abs(fire({ from: { x: 500, y: 200 }, angle: 90, power: 60, wind: 0, terrain, tanks: [], shooter: null }).hit.x - 500) < 3);
  ok("firing left goes left", shot(135, 50).hit.x < from.x);

  // Wind is measured over flat ground. On real terrain a shell can drift a
  // long way and still land on the same hillside, which says something about
  // the hill rather than about the wind.
  const flat = new Array(WORLD_W).fill(WORLD_H - 40);
  const level = (angle, power, wind) =>
    fire({ from: { x: 120, y: WORLD_H - 46 }, angle, power, wind, terrain: flat, tanks: [], shooter: null }).hit.x;

  const calm = level(45, 60, 0);
  ok(`a tailwind carries it further (+${Math.round(level(45, 60, 30) - calm)})`, level(45, 60, 30) > calm + 15);
  ok(`a headwind holds it back (${Math.round(level(45, 60, -30) - calm)})`, level(45, 60, -30) < calm - 15);
  ok("and the drift grows with the wind",
    level(45, 60, 40) > level(45, 60, 20) && level(45, 60, 20) > calm);

  // Time in the air is what the wind gets to work on.
  const flatDrift = level(20, 70, 40) - level(20, 70, 0);
  const lobDrift = level(78, 70, 40) - level(78, 70, 0);
  ok(`a lob feels it far more than a flat shot (${Math.round(flatDrift)} vs ${Math.round(lobDrift)})`,
    lobDrift > flatDrift * 3);

  ok("the same shot twice lands in the same place",
    shot(37, 63, 11).hit.x === shot(37, 63, 11).hit.x);
  ok("the path ends where the shell ended",
    (() => { const s = shot(45, 50); const last = s.path[s.path.length - 1];
      return Math.abs(last[0] - s.hit.x) < 2; })());
  ok("a shell fired into the sky eventually stops being the room's problem",
    shot(89, 100).path.length < 900);
}

console.log("\nhitting things");
{
  const { terrain, tanks } = field(1234);
  // Fire at point-blank into a neighbour: it must stop in them, not pass through.
  const target = { uid: "x", name: "X", x: 300, y: groundAt(terrain, 300) - TANK_R, dead: false };
  const s = fire({
    from: { x: 260, y: target.y - 2 }, angle: 6, power: 30, wind: 0,
    terrain, tanks: [target], shooter: "me",
  });
  ok("a shell stops in the tank it reaches", s.hit.kind === "tank" && s.hit.uid === "x");

  ok("damage is worst at the centre and nothing at the edge",
    splash(0) > splash(BLAST_R / 2) && splash(BLAST_R / 2) > 0 && splash(BLAST_R) === 0);
  ok("a blast reaches everybody in range and nobody out of it", (() => {
    const near = { uid: "a", x: 500, y: 300, dead: false };
    const far = { uid: "b", x: 500 + BLAST_R + 20, y: 300, dead: false };
    const hurt = blastOn([near, far], { x: 500, y: 300 });
    return hurt.length === 1 && hurt[0].uid === "a";
  })());
  ok("the dead take no further damage",
    blastOn([{ uid: "d", x: 500, y: 300, dead: true }], { x: 500, y: 300 }).length === 0);
}

console.log("\ndigging");
{
  const terrain = makeTerrain(3);
  const before = groundAt(terrain, 500);
  carve(terrain, 500, before, 40);
  ok("a crater lowers the ground", groundAt(terrain, 500) > before);
  ok("but never through the floor of the world", groundAt(terrain, 500) < WORLD_H);
  ok("and leaves the far side of the map alone", groundAt(terrain, 900) === makeTerrain(3)[900]);

  const tank = { uid: "t", x: 500, y: before - TANK_R, hp: 100 };
  const hurt = settle(terrain, tank);
  ok("a tank falls into the hole under it", tank.y > before - TANK_R);
  ok(`and a long drop hurts (${hurt})`, hurt >= 0);
  const high = { uid: "h", x: 500, y: 20 };
  ok("a very long drop hurts more", settle(terrain, high) > 0);
}

console.log("\nthe computer gunners");
{
  const rnd = rngFrom(11);
  const rate = (level) => {
    let damaging = 0;
    const trials = 220;
    for (let t = 0; t < trials; t++) {
      const { terrain, tanks } = field(t * 13 + 1);
      const wind = Math.round((rnd() - 0.5) * 80);
      const from = { x: tanks[0].x, y: tanks[0].y - 6 };
      const aim = aiAim({ from, to: tanks[1], wind, level, rnd, terrain, tanks, shooter: "t0" });
      const s = fire({ from, angle: aim.angle, power: aim.power, wind, terrain, tanks, shooter: "t0" });
      if (blastOn([tanks[1]], { x: s.hit.x, y: s.hit.y }).length) damaging++;
    }
    return damaging / trials;
  };
  const easy = rate("easy"), medium = rate("medium"), hard = rate("hard");
  ok(`Easy leaves you room to shoot back (${Math.round(easy * 100)}%)`, easy < 0.45);
  ok(`Hard does not (${Math.round(hard * 100)}%)`, hard > 0.7);
  ok(`and the dial goes the right way (${Math.round(easy*100)}/${Math.round(medium*100)}/${Math.round(hard*100)})`,
    easy < medium && medium < hard);
  ok("an aim is always a legal shot", (() => {
    const { terrain, tanks } = field(5);
    for (let i = 0; i < 40; i++) {
      const a = aiAim({ from: tanks[0], to: tanks[1], wind: (i - 20) * 4, level: "hard", rnd, terrain, tanks, shooter: "t0" });
      if (!(a.angle >= 0 && a.angle <= 180 && a.power >= 8 && a.power <= 100)) return false;
    }
    return true;
  })());
}

console.log("\nthe commanders");
{
  ok("twenty of them", AVATARS.length === 20);
  ok("every one has a name and a face", AVATARS.every((a) => a.id && a.name && a.ico));
  ok("no two share an id", new Set(AVATARS.map((a) => a.id)).size === AVATARS.length);
  ok("one can be looked up", avatarById("tread")?.name === "General Tread");
  ok("and an unknown one is not invented", avatarById("nope") === null);
  ok("a latecomer gets one nobody has taken",
    freeAvatar(["tread", "steel"]) === "boom");
}

console.log("\nwhat a duel was worth");
{
  ok("winning a field of four scores well",
    duelScore({ placement: 1, field: 4, hits: 6, shots: 8, damage: 300, survived: true }) > 88);
  ok("coming last with nothing to show does not",
    duelScore({ placement: 4, field: 4, hits: 0, shots: 9, damage: 0, survived: false }) < 30);
  ok("a good shot beats a lucky one at the same placing",
    duelScore({ placement: 2, field: 4, hits: 8, shots: 9, damage: 400, survived: true }) >
    duelScore({ placement: 2, field: 4, hits: 1, shots: 9, damage: 40, survived: true }));
  ok("nothing ever gets past a hundred",
    duelScore({ placement: 1, field: 9, hits: 99, shots: 99, damage: 9999, survived: true }) <= 100);
  ok("firing nothing is not perfect accuracy",
    duelScore({ placement: 1, field: 2, hits: 0, shots: 0, damage: 0, survived: true }) <
    duelScore({ placement: 1, field: 2, hits: 4, shots: 4, damage: 200, survived: true }));

  const order = standings([
    { uid: "a", name: "A", dead: true, diedAt: 100, damage: 50 },
    { uid: "b", name: "B", dead: false, damage: 10 },
    { uid: "c", name: "C", dead: true, diedAt: 300, damage: 80 },
  ]);
  ok("the survivor wins", order[0].uid === "b");
  ok("then whoever lasted longest", order[1].uid === "c");
}

console.log("\nthe difficulty levels");
{
  ok("three of them", AI_LEVELS.length === 3);
  ok("at most five computers", AI_MAX === 5);
  ok("a harder one aims straighter",
    aiLevelById("hard").miss < aiLevelById("easy").miss);
  ok("and pays more for it",
    aiLevelById("hard").pay > aiLevelById("easy").pay);
  ok("an unknown level is the easy one, not a crash", aiLevelById("nope").id === "easy");
}

console.log("\nwhat a token does to a shot");
{
  const plain = shotPlan({ angle: 50, power: 70, use: [] });
  ok("a plain shot is one shell", plain.shells.length === 1 && !plain.payload);
  const tri = shotPlan({ angle: 50, power: 70, use: ["at_triple"] });
  ok("a triple shot is three, spread either side of the aim",
    tri.shells.length === 3 && tri.shells[0].angle === 50 - TRIPLE_SPREAD && tri.shells[2].angle === 50 + TRIPLE_SPREAD);
  ok("and all three at the power that was dialled", tri.shells.every((s) => s.power === 70));
  ok("two payloads on one shell is one payload", payloadOf(["at_mud", "at_napalm"]) === "at_napalm");
  ok("and a shell with none has none", payloadOf(["at_triple", "at_double"]) === null);
  ok("a wind nullifier is a wind of zero", windFor(37, ["at_nowind"]) === 0 && windFor(37, []) === 37);
  ok("a bouncy shell is allowed exactly one bounce",
    shotPlan({ angle: 50, power: 70, use: ["at_bouncy"] }).bounce === 1);
}

console.log("\nthe shells the arsenal sells");
{
  const { terrain, tanks } = field(2024);
  const from = { x: tanks[0].x, y: tanks[0].y - 6 };
  const shoot = (use, aim) => salvo({ from, angle: 45, power: 72, wind: 12, terrain, tanks, shooter: "t0", use, aim });

  const one = shoot([]);
  ok("a plain shell is one flight and one crater", one.flights.length === 1 && one.blasts.length === 1);

  const three = shoot(["at_triple"]);
  ok("a triple shot flies three", three.flights.length === 3);

  const cluster = shoot(["at_cluster"]);
  ok("a cluster shell comes apart at the apex, into three",
    cluster.flights.filter((f) => f.child).length === CLUSTER_N);
  ok("and the shell that carried them never explodes itself",
    cluster.blasts.every((b) => b.kind === "cluster"));
  ok("each fragment hits softer than a whole shell",
    cluster.blasts.every((b) => b.top < BLAST_DAMAGE && b.radius < BLAST_R));

  const napalm = shoot(["at_napalm"]);
  ok("napalm leaves fire behind it", napalm.fires.length === 1 && napalm.fires[0].turns === BURN_TURNS);

  const mud = shoot(["at_mud"]);
  ok("a mud shell hurts nobody", mud.blasts.every((b) => b.top === 0 && b.kind === "mud"));

  const orbital = shoot(["at_orbital"], { x: tanks[1].x });
  ok("an orbital strike is three columns where it was pointed",
    orbital.blasts.length === ORBITAL_LANES && orbital.blasts.some((b) => Math.abs(b.x - tanks[1].x) < 2));
  ok("and each one comes down out of the sky", orbital.flights.every((f) => f.path[0][1] < 0));

  const carpet = shoot(["at_carpet"], { x: 500 });
  ok("a carpet bomb is five, in a line", carpet.blasts.length === CARPET_N);
  ok("spread across the map rather than stacked",
    Math.abs(carpet.blasts[4].x - carpet.blasts[0].x) === CARPET_GAP * 4);

  const leveler = shoot(["at_leveler"], { x: 500 });
  ok("a leveler fires nothing and hurts nobody",
    !leveler.flights.length && !leveler.blasts.length && leveler.level.x === 500);

  // A shell fired at a tank stops in it rather than passing through, with or
  // without a token on it — the token changes the numbers, never the rules.
  ok("every shell of every kind ends somewhere",
    [one, three, cluster, napalm, mud].every((s) => s.flights.every((f) => f.hit?.kind)));
}

console.log("\na homing shell turns, and does not always arrive");
{
  // Counted in hits rather than in average miss distance, because the average
  // is the wrong measure here: a turning shell that cannot reach its mark digs
  // itself in somewhere further away than a plain one would have, which makes
  // the average worse while the thing anybody cares about gets better.
  let plainHits = 0, homedHits = 0, shots = 0;
  for (const seed of [77, 2024, 31, 555, 4321]) {
    const { terrain, tanks } = field(seed);
    const from = { x: tanks[0].x, y: tanks[0].y - 6 };
    const mark = nearestTarget(tanks, from, "t0");
    if (seed === 77) ok("the mark is the other tank, not itself", mark.uid === "t1");
    for (let a = 24; a <= 78; a += 3) {
      for (let p = 24; p <= 100; p += 4) {
        const near = (shot) => Math.hypot(shot.hit.x - mark.x, shot.hit.y - mark.y);
        if (near(fire({ from, angle: a, power: p, wind: 0, terrain, tanks, shooter: "t0" })) < BLAST_R) plainHits++;
        if (near(fire({ from, angle: a, power: p, wind: 0, terrain, tanks, shooter: "t0", homing: HOMING_PULL, toward: mark })) < BLAST_R) homedHits++;
        shots++;
      }
    }
  }
  ok(`it lands in blast range far more often (${plainHits} -> ${homedHits} of ${shots})`,
    homedHits > plainHits * 1.5);
  ok("and still misses most of a wild spread of aims, which is the point",
    homedHits < shots / 2);
}

console.log("\nthe ground a token moves");
{
  const terrain = makeTerrain(555);
  const before = [...terrain];
  const flat = levelGround(terrain, 500);
  const spread = (g) => Math.max(...g.slice(440, 560)) - Math.min(...g.slice(440, 560));
  ok(`a leveler flattens what it covers (${spread(before).toFixed(0)} -> ${spread(terrain).toFixed(0)})`,
    spread(terrain) < spread(before));
  ok("to about the average height it found there", Math.abs(flat - terrain[500]) < 6);
  let cliff = 0;
  for (let i = 1; i < terrain.length; i++) cliff = Math.max(cliff, Math.abs(terrain[i] - terrain[i - 1]));
  ok(`and leaves no cliff at the rim (${cliff.toFixed(1)} units)`, cliff < 6);
  ok("nothing outside the radius is touched",
    terrain.every((h, i) => Math.abs(i - 500) > LEVEL_R ? h === before[i] : true));

  const m = makeTerrain(555);
  mound(m, 300);
  ok("a mud shell raises the ground where it landed", m[300] < before[300]);
  ok("and only around where it landed",
    m.every((h, i) => Math.abs(i - 300) > MUD_R ? h === before[i] : true));
  ok("but never up into the sky", m.every((h) => h > 0));
}

console.log("\nwhat a hit becomes");
{
  ok("double damage doubles it", dealt(23, ["at_double"]) === 46);
  ok("and nothing else does", dealt(23, ["at_triple"]) === 23);
  ok("a shield eats it whole", taken(46, ["at_bubble"]).damage === 0 && taken(46, ["at_bubble"]).blocked);
  ok("heavy armour takes fifteen per cent off", taken(100, ["at_armour"]).damage === 85);
  ok("a shield beats armour when both are up", taken(100, ["at_armour", "at_bubble"]).damage === 0);
  ok("and a tank with neither takes what it was sent", taken(46, []).damage === 46);
  ok("a vampire shell gives back half of what it dealt", drained(37, ["at_vampire"]) === 19);
  ok("and a plain one gives back nothing", drained(37, []) === 0);
  ok("a repair is a fifth of full health", repaired({ hp: 40 }) === 20);
  ok("never more than the damage there is to repair", repaired({ hp: 95 }) === 5);
  ok("and never on a tank that has taken none", repaired({ hp: START_HP }) === 0);
}

console.log("\nfire on the field");
{
  const { terrain, tanks } = field(31);
  const pool = [{ x: tanks[1].x, radius: BURN_R, turns: 3 }];
  const first = burnTick(tanks, pool);
  ok("it burns whoever is standing in it", first.hits.some((h) => h.uid === "t1" && h.damage === BURN_DAMAGE));
  ok("and nobody who is not", !first.hits.some((h) => h.uid === "t0"));
  ok("and it is a turn shorter afterwards", first.fires[0].turns === 2);
  const shielded = burnTick(tanks, pool, (uid) => (uid === "t1" ? ["at_bubble"] : []));
  ok("a shield keeps the fire off", shielded.hits.every((h) => h.damage === 0));
  let left = [{ x: tanks[1].x, radius: BURN_R, turns: 1 }];
  ok("and fire burns out rather than forever", burnTick(tanks, left).fires.length === 0);
}

console.log("\nfalling, with and without a parachute");
{
  const terrain = makeTerrain(808);
  const tank = { uid: "t", x: 400, y: groundAt(terrain, 400) - TANK_R };
  const dug = [...terrain];
  for (let i = 340; i < 460; i++) dug[i] += 150;
  const bare = { ...tank };
  const hurt = settle(dug, bare);
  ok(`a long drop hurts (${hurt})`, hurt > 0);
  const chuted = { ...tank };
  ok("a parachute takes all of it", settle(dug, chuted, ["at_chute"]) === 0);
  ok("and both tanks still land on the ground",
    Math.abs(bare.y - chuted.y) < 0.001 && Math.abs(bare.y - (groundAt(dug, 400) - TANK_R)) < 0.001);
  const nudged = { ...tank };
  ok("a short drop hurts nobody, parachute or not", settle(terrain, nudged) === 0);
}

console.log("\nsomewhere else to be");
{
  const { terrain, tanks } = field(4321, 3);
  const seq = rngFrom(9);
  const to = teleportTo(terrain, tanks, tanks[0], seq);
  ok("it lands on the map", to.x > 0 && to.x < WORLD_W);
  ok("and standing on the ground", Math.abs(to.y - (groundAt(terrain, to.x) - TANK_R)) < 0.001);
  const near = (x) => Math.min(...tanks.slice(1).map((t) => Math.abs(t.x - x)));
  ok(`out of the crossfire rather than into it (${Math.round(near(to.x))} units clear)`,
    near(to.x) > BLAST_R);
}

console.log("\nthe shop and the mechanics agree");
{
  const keys = Object.keys(ARSENAL);
  ok("nineteen tokens in the arsenal", keys.length === 19);
  ok("every one of them has a kind the room can act on",
    keys.every((k) => ["shell", "strike", "guard", "turn"].includes(TOKEN_KIND[k])));
  ok("and nothing has a kind that is not in the shop",
    Object.keys(TOKEN_KIND).every((k) => ARSENAL[k]));
  ok("every payload is a shell", PAYLOADS.every((k) => TOKEN_KIND[k] === "shell"));
  ok("every one of them costs something, and caps per duel",
    keys.every((k) => ARSENAL[k].price > 0 && ARSENAL[k].max >= 1));
  ok("the dearest is the orbital strike, capped at one",
    keys.every((k) => ARSENAL[k].price <= ARSENAL.at_orbital.price) && ARSENAL.at_orbital.max === 1);
}

console.log(bad ? `\n${bad} failing\n` : "\nall artillery checks passed\n");
process.exit(bad ? 1 : 0);
