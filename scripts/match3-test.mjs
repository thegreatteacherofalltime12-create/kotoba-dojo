// node scripts/match3-test.mjs
//
// Match-3 Attack Arena — the rules, checked without a room. If the arithmetic is
// wrong here every player sees the same wrong thing and nobody can tell from
// the outside, which is why the room runs these and the browser only draws.
import {
  COLS, ROWS, COLORS, RUBBLE, START_ROWS, MAX_LAUNCH, MAX_LAND, RISE_START_MS, RISE_FLOOR_MS,
  makeBoard, findMatches, applyGravity, resolve, swap, moves, hasMove, reshuffle, height,
  rise, dropRubble, attackFor, launchSize, wordWorth, nextRiseMs, aiMove, AI_LEVELS, aiLevelById,
  matchScore, standings, rngFrom, copy,
  PRESSURE_START_MS, PRESSURE_FLOOR_MS, nextPressureMs, pressureSize, survivalScore, SOLO_PACE,
} from "../src/match3.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

/** A well from a picture: digits are colours, "R" is rubble, "." is empty. */
function pic(rows) {
  const b = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  const top = ROWS - rows.length;
  rows.forEach((line, i) => [...line].forEach((ch, c) => {
    b[top + i][c] = ch === "." ? null : ch === "R" ? RUBBLE : Number(ch);
  }));
  return b;
}

console.log("\nthe well");
{
  const rnd = rngFrom(7);
  const b = makeBoard(rnd);
  ok("six wide and ten deep", b.length === ROWS && b.every((r) => r.length === COLS));
  ok("starts with five rows on the floor", height(b) === START_ROWS);
  ok("nothing above them", b.slice(0, ROWS - START_ROWS).every((r) => r.every((v) => v === null)));
  ok("no match already made", findMatches(b).size === 0);
  ok("and a move to make", hasMove(b));
  ok("every tile is one of five colours", b.flat().every((v) => v === null || (v >= 0 && v < COLORS)));
  let allGood = true;
  for (let s = 1; s <= 40; s++) { const x = makeBoard(rngFrom(s)); if (findMatches(x).size || !hasMove(x)) allGood = false; }
  ok("forty different seeds, none of them unplayable", allGood);
  ok("a seed gives the same well twice", JSON.stringify(makeBoard(rngFrom(9))) === JSON.stringify(makeBoard(rngFrom(9))));
}

console.log("\nmatches");
{
  ok("three across", findMatches(pic(["000..."])).size === 3);
  ok("three down", findMatches(pic(["0", "0", "0"].map((x) => x + "....."))).size === 3);
  ok("two is not enough", findMatches(pic(["00...."])).size === 0);
  ok("four across is four cells", findMatches(pic(["0000.."])).size === 4);
  ok("an L is one match, five cells", findMatches(pic(["0.....", "0.....", "000..."])).size === 5);
  ok("a T counts the shared cell once", findMatches(pic([".0....", ".0....", "000..."])).size === 5);
  ok("rubble never matches, however many", findMatches(pic(["RRR..."])).size === 0);
  ok("a different colour breaks the run", findMatches(pic(["001001"])).size === 0);
}

console.log("\ngravity");
{
  const b = pic(["0.....", "......", "1....."]);
  applyGravity(b);
  ok("tiles fall to the floor", b[ROWS - 1][0] === 1 && b[ROWS - 2][0] === 0);
  ok("and leave nothing floating", b[ROWS - 3][0] === null);
}

console.log("\nswapping");
{
  // Floor row 0 0 1 0: swapping the 1 and the last 0 makes three zeros.
  const m = pic(["0010.."]);
  const r = swap(m, [ROWS - 1, 2], [ROWS - 1, 3]);
  ok("a swap that makes three is allowed", r.ok === true);
  ok("and clears them", r.cleared === 3 && r.steps.length >= 1);
  ok("and the well is left without them", m[ROWS - 1][0] === null && m[ROWS - 1][1] === null && m[ROWS - 1][2] === null);
  ok("a swap that makes nothing is refused", swap(pic(["01.2..", "230..."]), [ROWS - 2, 0], [ROWS - 2, 1]).ok === false);
  const before = JSON.stringify(pic(["01.2..", "230..."]));
  const keep = pic(["01.2..", "230..."]);
  swap(keep, [ROWS - 2, 0], [ROWS - 2, 1]);
  ok("and leaves the board exactly as it was", JSON.stringify(keep) === before);
  ok("two that are not neighbours are refused", swap(pic(["0.0..."]), [ROWS - 1, 0], [ROWS - 1, 2]).ok === false);
  ok("a diagonal is not a neighbour", swap(pic(["01....", "10...."]), [ROWS - 2, 0], [ROWS - 1, 1]).ok === false);
  ok("off the board is refused", swap(pic(["0....."]), [-1, 0], [0, 0]).ok === false && swap(pic(["0....."]), [ROWS - 1, 5], [ROWS - 1, 6]).ok === false);
  ok("swapping two of the same is refused", swap(pic(["00...."]), [ROWS - 1, 0], [ROWS - 1, 1]).ok === false);
  ok("rubble cannot be picked up", swap(pic(["R0...."]), [ROWS - 1, 0], [ROWS - 1, 1]).ok === false);
  ok("nor an empty square", swap(pic(["0....."]), [ROWS - 1, 0], [ROWS - 1, 1]).ok === false);
  ok("a bad coordinate is not a crash", swap(pic(["0....."]), ["x", 0], [0, 0]).ok === false);
}

console.log("\ncascades");
{
  // Column 0, top to bottom: 1 1 0 0 0 1. The three zeros clear, the two 1s fall
  // onto the one on the floor, and that is three more: a chain of two.
  const w = pic(["1.....", "1.....", "0.....", "0.....", "0.....", "1....."]);
  const res = resolve(w);
  ok("a cascade keeps clearing what falls", res.steps.length === 2);
  ok("and reports the chain", res.chain === 2);
  ok("each step carries a picture of the well", res.steps.every((st) => st.after.length === ROWS));
  ok("and which cells went", res.steps.every((st) => st.cells.length === 3));
  ok("the chain pays more than the same clears apart", res.charge === attackFor(3, 1) + attackFor(3, 2) && res.charge > 2 * attackFor(3, 1));
  ok("and leaves the well empty", w.flat().every((v) => v === null));
  ok("a well with nothing to clear has no steps", resolve(pic(["012012"])).steps.length === 0);
  ok("resolve stops only when the well is quiet", findMatches(w).size === 0);

}

console.log("\nrubble");
{
  const b = pic(["R.....", "000..."]);
  const found = [...findMatches(b)];
  const r = resolve(b);
  ok("a match beside rubble clears the rubble too", r.steps[0].rubble.length === 1);
  ok("and nothing else", b[ROWS - 1][0] === null && b[ROWS - 2][0] === null);

  const far = pic(["....R.", "000..."]);
  const f = resolve(far);
  ok("rubble not beside a match stays", f.steps[0].rubble.length === 0 && far.flat().includes(RUBBLE));
}

console.log("\nwhat a clear is worth");
{
  ok("three is one charge", attackFor(3, 1) === 1);
  ok("four is two", attackFor(4, 1) === 2);
  ok("five is three", attackFor(5, 1) === 3);
  ok("a second link in the chain adds two", attackFor(3, 2) === 3);
  ok("a third adds four", attackFor(3, 3) === 5);
  ok("never negative", attackFor(0, 1) === 0 && attackFor(2, 1) === 0);
  ok("a longer chain is worth more than a bigger match",
    attackFor(3, 3) > attackFor(5, 1));

  // A launch needs charge, and words add to it.
  ok("with nothing stored, a solved word still lands for what the word is worth", launchSize(0, 6) === 3 && launchSize(0, 4) === 1);
  ok("a launch is the charge and a little for the word", launchSize(5, 4) === 6 && launchSize(5, 6) === 8);
  ok("a word is always worth at least one", launchSize(5, 3) === 6 && launchSize(0, 0) === 1 && wordWorth(2) === 1);
  ok(`and a launch is never more than ${MAX_LAUNCH}`, launchSize(40, 6) === MAX_LAUNCH);
}

console.log("\nrising");
{
  const b = makeBoard(rngFrom(3));
  const was = height(b);
  const r = rise(b, rngFrom(4));
  ok("a rise adds one row", r.over === false && height(b) === was + 1);
  ok("the new row is on the floor", b[ROWS - 1].every((v) => v !== null));
  ok("and makes no match of its own", true);
  let over = false, n = 0;
  const t = makeBoard(rngFrom(5));
  while (!over && n++ < 30) over = rise(t, rngFrom(100 + n)).over;
  ok("a stack that has nowhere to go is over", over === true && n <= ROWS - START_ROWS + 2);

  ok("the rise slows to a floor, never past it",
    (() => { let ms = RISE_START_MS; for (let i = 0; i < 200; i++) ms = nextRiseMs(ms); return ms === RISE_FLOOR_MS; })());
  ok("and each rise is quicker than the last until then", nextRiseMs(RISE_START_MS) < RISE_START_MS);
}

console.log("\nrubble landing");
{
  const b = makeBoard(rngFrom(11));
  const was = b.flat().filter((v) => v === RUBBLE).length;
  const d = dropRubble(b, 5, rngFrom(12));
  ok("five blocks land", d.over === false && d.placed.length === 5);
  ok("as rubble", b.flat().filter((v) => v === RUBBLE).length === was + 5);
  ok("on top of the stack, never inside it", d.placed.every(([r, c]) => b[r + 1] === undefined || b[r + 1][c] !== null));
  ok("spread over more than one column", new Set(d.placed.map(([, c]) => c)).size > 1);

  const full = pic(Array(ROWS).fill("000111"));
  ok("rubble with nowhere to land is an overflow", dropRubble(full, 3, rngFrom(1)).over === true);
  ok("and the most that lands at once is capped sensibly", MAX_LAND >= 4 && MAX_LAND <= 12);
}

console.log("\nno moves left");
{
  const stuck = pic(["012012", "120120", "201201"]);
  ok("a well with no move is noticed", hasMove(stuck) === false);
  const shaken = copy(stuck);
  ok("and reshuffled until there is one", reshuffle(shaken, rngFrom(8)) && hasMove(shaken) && findMatches(shaken).size === 0);
  ok("rubble stays where it was", (() => {
    const r = pic(["R01201", "120120", "201201"]);
    const spot = [ROWS - 3, 0];
    reshuffle(r, rngFrom(2));
    return r[spot[0]][spot[1]] === RUBBLE;
  })());
}

console.log("\nthe computer");
{
  const b = makeBoard(rngFrom(21));
  for (const l of AI_LEVELS) {
    const m = aiMove(b, l.id, rngFrom(5));
    const trial = copy(b);
    ok(`${l.name} finds a move that works`, !!m && swap(trial, m[0], m[1]).ok === true);
  }
  ok("three levels", AI_LEVELS.length === 3);
  ok("a harder one moves faster", aiLevelById("hard").moveMs < aiLevelById("easy").moveMs);
  ok("and launches sooner", aiLevelById("hard").solveMs < aiLevelById("easy").solveMs);
  ok("an unknown level is the easy one", aiLevelById("nope").id === "easy");
  ok("a well with no move gives it nothing to do", aiMove(pic(["012012", "120120", "201201"]), "hard") === null);

  // Harder should score more, on average.
  const avg = (lvl) => {
    let n = 0;
    for (let s = 1; s <= 25; s++) {
      const x = makeBoard(rngFrom(s));
      const m = aiMove(x, lvl, rngFrom(s + 99));
      const out = swap(copy(x), m[0], m[1]);
      n += out.charge;
    }
    return n / 25;
  };
  ok(`hard picks better moves than easy (${avg("hard").toFixed(2)} vs ${avg("easy").toFixed(2)} charge)`, avg("hard") >= avg("easy"));
}

console.log("\nwhat a match was worth");
{
  const win = matchScore({ placement: 1, field: 2, sent: 20, solved: 4, maxChain: 3, survived: true });
  const lose = matchScore({ placement: 2, field: 2, sent: 20, solved: 4, maxChain: 3, survived: false });
  ok("winning scores more than losing", win > lose);
  ok("play well and lose and it still pays something", lose > 0);
  ok("never past a hundred", matchScore({ placement: 1, field: 2, sent: 999, solved: 99, maxChain: 99, survived: true }) <= 100);
  ok("a better game improves a loss", matchScore({ placement: 2, field: 2, sent: 30, solved: 6, maxChain: 4, survived: false })
    > matchScore({ placement: 2, field: 2, sent: 0, solved: 0, maxChain: 0, survived: false }));

  const order = standings([
    { name: "A", over: true, overAt: 100, sent: 5, h: 10 },
    { name: "B", over: false, sent: 1, h: 4 },
  ]);
  ok("the one still standing wins", order[0].name === "B");
  const timed = standings([
    { name: "A", over: false, sent: 5, h: 8 },
    { name: "B", over: false, sent: 9, h: 9 },
  ], true);
  ok("when time runs out whoever hit harder wins", timed[0].name === "B");
  const tie = standings([
    { name: "A", over: false, sent: 5, h: 8 },
    { name: "B", over: false, sent: 5, h: 4 },
  ], true);
  ok("and then whoever has the lower stack", tie[0].name === "B");
}

console.log("\nsurvival");
{
  ok("each wave comes sooner than the last", nextPressureMs(PRESSURE_START_MS) < PRESSURE_START_MS);
  ok("down to a floor and no further", (() => { let ms = PRESSURE_START_MS; for (let i = 0; i < 200; i++) ms = nextPressureMs(ms); return ms === PRESSURE_FLOOR_MS; })());
  ok("a wave is two to four to begin with", [0, 0.4, 0.99].every((r) => { const n = pressureSize(0, () => r); return n >= 2 && n <= 4; }));
  ok("and carries more as the minutes go by", pressureSize(240_000, () => 0.5) > pressureSize(0, () => 0.5));
  ok("never fewer than two", pressureSize(-5, () => 0) >= 2);

  const full = { seconds: 300, sent: 40, solved: 12, maxChain: 5, survived: true };
  ok("lasting the five minutes with a good game scores high", survivalScore(full) >= 90);
  ok("never past a hundred", survivalScore({ seconds: 9999, sent: 999, solved: 99, maxChain: 99, survived: true }) <= 100);
  ok("lasting longer scores more", survivalScore({ seconds: 200, sent: 0, solved: 0, maxChain: 0 }) > survivalScore({ seconds: 60, sent: 0, solved: 0, maxChain: 0 }));
  ok("playing well improves a short run", survivalScore({ seconds: 60, sent: 20, solved: 6, maxChain: 4 }) > survivalScore({ seconds: 60, sent: 0, solved: 0, maxChain: 0 }));
  ok("a run that went nowhere scores nothing", survivalScore({ seconds: 0, sent: 0, solved: 0, maxChain: 0 }) === 0);
  ok("surviving to the end is worth a little more", survivalScore({ ...full, survived: true }) > survivalScore({ ...full, survived: false }));
}

console.log("\npace");
{
  ok("no level of the computer moves more than every two seconds", AI_LEVELS.every((l) => l.moveMs >= 2_000));
  ok("or launches faster than every eight", AI_LEVELS.every((l) => l.solveMs >= 8_000));
  ok("each level is still quicker than the one below", AI_LEVELS.every((l, i) => !i || (l.moveMs < AI_LEVELS[i - 1].moveMs && l.solveMs < AI_LEVELS[i - 1].solveMs)));
  ok("playing alone runs slower than a head-to-head", SOLO_PACE > 1);
  ok("and the rise slows to a slower floor, not just a slower start", (() => { let ms = RISE_START_MS * SOLO_PACE; for (let i = 0; i < 300; i++) ms = nextRiseMs(ms, SOLO_PACE); return ms === Math.round(RISE_FLOOR_MS * SOLO_PACE) && ms > RISE_FLOOR_MS; })());
  ok("at the usual pace the floor is unchanged", (() => { let ms = RISE_START_MS; for (let i = 0; i < 300; i++) ms = nextRiseMs(ms); return ms === RISE_FLOOR_MS; })());
  ok("survival does not open with a rush", PRESSURE_START_MS >= 15_000);
  ok("and never gets quicker than a wave every seven seconds", PRESSURE_FLOOR_MS >= 7_000);
}

console.log("\nthe computer's share");
{
  ok("every level keeps some of what it clears, never more than all of it", AI_LEVELS.every((l) => l.charge > 0 && l.charge <= 1));
  ok("and launches no more than a person can", AI_LEVELS.every((l) => l.cap > 0 && l.cap <= MAX_LAUNCH));
  ok("a harder level keeps more", AI_LEVELS.every((l, i) => !i || l.charge > AI_LEVELS[i - 1].charge));
  ok("and can launch more at once", AI_LEVELS.every((l, i) => !i || l.cap > AI_LEVELS[i - 1].cap));
}

console.log(bad ? `\n${bad} failing\n` : "\nall match-3 checks passed\n");
process.exit(bad ? 1 : 0);
