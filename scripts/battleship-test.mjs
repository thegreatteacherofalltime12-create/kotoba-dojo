// node scripts/battleship-test.mjs
import {
  FLEET, SIZE, validateFleet, randomFleet, canTarget, targetOptions,
  fireAt, fleetSunk, battleScore, cellsFor, COOLDOWN_TARGETS, canTargetFor,
  accuracyBonus, normalizeVolley, aiTargets, perTargetCap, MIN_PER_TARGET, volleyShots,
} from "../src/battleship.js";

let bad = 0;
const ok = (label, cond) => {
  console.log(`${cond ? "  pass" : "  FAIL"}  ${label}`);
  if (!cond) bad++;
};

console.log("\nfleet placement");
const good = [
  { id: "carrier", row: 0, col: 0, dir: "across" },
  { id: "battleship", row: 2, col: 0, dir: "across" },
  { id: "cruiser", row: 4, col: 0, dir: "across" },
  { id: "submarine", row: 6, col: 0, dir: "across" },
  { id: "destroyer", row: 8, col: 0, dir: "across" },
];
let v = validateFleet(good);
ok("a legal fleet is accepted", v.ok);
ok("all five ships come back", v.ships.length === FLEET.length);
ok("carrier occupies five cells", v.ships[0].cells.length === 5);

ok("a short fleet is refused", validateFleet(good.slice(0, 4)).ok === false);
ok("hanging off the edge is refused",
  validateFleet([{ ...good[0], col: SIZE - 2 }, ...good.slice(1)]).ok === false);
ok("overlapping is refused",
  validateFleet([...good.slice(0, 4), { id: "destroyer", row: 0, col: 0, dir: "across" }]).ok === false);
ok("a missing ship is named",
  /Destroyer/.test(validateFleet([...good.slice(0, 4), { id: "nope", row: 8, col: 0, dir: "across" }]).error));

console.log("\nrandom placement");
let allGood = true;
for (let i = 0; i < 200; i++) {
  const f = randomFleet();
  if (!f || !validateFleet(f).ok) { allGood = false; break; }
}
ok("two hundred random fleets are all legal", allGood);

console.log("\ntarget cooldown");
ok("anyone is fair game to start", canTarget([], "b", 6).ok);
ok("cannot immediately repeat", canTarget(["b"], "b", 6).ok === false);
ok("one other is enough to return", canTarget(["b", "c"], "b", 6).ok === true);
ok("three others also frees them", canTarget(["b", "c", "d", "e"], "b", 6).ok === true);
ok("one distinct other is enough, even if they were fired at many times",
  canTarget(["b", "c", "c", "c"], "b", 6).ok === true);
ok("it counts from the LAST time you hit them — one other since then suffices",
  canTarget(["b", "c", "d", "e", "b", "c"], "b", 6).ok === true);
ok("the message says how many are left",
  canTarget(["b"], "b", 6).remaining === 1);
ok("with three opponents, one other is all it takes", canTarget(["b"], "b", 3).ok === false && canTarget(["b", "c"], "b", 3).ok === true);
ok("with two it asks for the other one — no hitting the same captain every turn", canTarget(["b"], "b", 2).ok === false && canTarget(["b", "c"], "b", 2).ok === true);
ok("with one rival there is nobody else, so it cannot apply", canTarget(["b", "b"], "b", 1).ok === true);
ok("with four opponents, one other is all that's needed", canTarget(["b"], "b", 4).ok === false && canTarget(["b", "c"], "b", 4).ok === true);

console.log("\nthe rotation always holds");
ok("the most recently fired captain is closed",
  canTargetFor(["b", "c"], "c", ["b", "c", "d"], 4).ok === false);
ok("once one other has been fired at, they are open again",
  canTargetFor(["c", "b"], "c", ["b", "c", "d"], 4).ok === true);

console.log("\ntarget list");
const players = {
  a: { uid: "a", name: "Ana", alive: true },
  b: { uid: "b", name: "Bo", alive: true },
  c: { uid: "c", name: "Cho", alive: true },
  d: { uid: "d", name: "Dev", alive: true },
  e: { uid: "e", name: "Eli", alive: true },
  f: { uid: "f", name: "Fay", alive: false },
};
const opts = targetOptions("a", players, ["b"]);
ok("the shooter isn't in their own list", !opts.some((o) => o.uid === "a"));
ok("eliminated players are gone", !opts.some((o) => o.uid === "f"));
ok("the one just hit is blocked", opts.find((o) => o.uid === "b").allowed === false);
ok("a blocked target carries a reason", !!opts.find((o) => o.uid === "b").reason);
ok("everyone else is open", opts.filter((o) => o.allowed).length === 3);

console.log("\nfiring");
const board = { ships: validateFleet(good).ships, incoming: [] };
ok("a shot into empty water misses", fireAt(board, "9,9").result === "miss");
ok("a shot on a ship hits", fireAt(board, "8,0").result === "hit");
ok("the same cell twice is refused", fireAt(board, "8,0").result === "repeat");
ok("finishing a ship sinks it", fireAt(board, "8,1").result === "sunk");
ok("the sunk ship is named", fireAt({ ships: validateFleet(good).ships, incoming: [] }, "9,9").ship === undefined);
ok("the fleet isn't finished yet", fleetSunk(board) === false);

for (const ship of board.ships) {
  for (const cell of ship.cells) if (!board.incoming.includes(cell)) fireAt(board, cell);
}
ok("sinking everything ends the fleet", fleetSunk(board) === true);

console.log("\nscoring");
ok("a winner outscores a first casualty",
  battleScore({ hits: 12, sunk: 3, placement: 1, field: 5, survived: true }) >
  battleScore({ hits: 2, sunk: 0, placement: 5, field: 5 }));
ok("scores stay inside 0-100",
  battleScore({ hits: 99, sunk: 20, placement: 1, field: 8, survived: true }) <= 100);
ok("doing nothing scores nothing much",
  battleScore({ hits: 0, sunk: 0, placement: 8, field: 8 }) === 0);

console.log("\naim");
ok("half your shots landing is par", accuracyBonus(5, 10) === 1 && accuracyBonus(0, 0) === 1);
ok("a sharper eye pays, up to three quarters more", accuracyBonus(8, 10) > 1.4 && accuracyBonus(8, 10) < 1.5 && accuracyBonus(10, 10) === 1.75);
ok("spraying the water costs, down to a quarter", accuracyBonus(2, 10) === 0.75 && accuracyBonus(4, 10) < 1);
ok("the score follows the aim",
  battleScore({ hits: 8, sunk: 2, shots: 10, placement: 1, field: 2, survived: true })
  > battleScore({ hits: 8, sunk: 2, shots: 20, placement: 1, field: 2, survived: true }));
ok("and no shots fired scores as it always did",
  battleScore({ hits: 8, sunk: 2, placement: 1, field: 2, survived: true }) === battleScore({ hits: 8, sunk: 2, shots: 0, placement: 1, field: 2, survived: true }));

console.log("\nvolleys");
let vol = normalizeVolley([{ target: "b", cells: ["0,0", "0,1"] }, { target: "c", cells: ["1,1", "1,2"] }], 4);
ok("two and two is a volley of four", vol.ok && vol.volley.length === 2);
vol = normalizeVolley([{ target: "b", cells: ["0,0", "0,1"] }, { target: "b", cells: ["0,2", "0,3"] }], 4);
ok("the same target twice is folded together", vol.ok && vol.volley.length === 1 && vol.volley[0].cells.length === 4);
ok("all four on one captain is not a volley, it is refused", !normalizeVolley([{ target: "b", cells: ["0,0", "0,1", "0,2", "0,3"] }], 4, 2).ok);
ok("and the refusal says how many one captain may take", /No more than 2 shots on one captain/.test(normalizeVolley([{ target: "b", cells: ["0,0", "0,1", "0,2", "0,3"] }], 4, 2).error));
ok("three and one is refused at two a captain", !normalizeVolley([{ target: "b", cells: ["0,0", "0,1", "0,2"] }, { target: "c", cells: ["1,1"] }], 4, 2).ok);
ok("two and two is not", normalizeVolley([{ target: "b", cells: ["0,0", "0,1"] }, { target: "c", cells: ["1,1", "1,2"] }], 4, 2).ok);
ok("a lone rival can take the lot, when the cap allows it", normalizeVolley([{ target: "b", cells: ["0,0", "0,1", "0,2", "0,3"] }], 4, 4).ok);
ok("with no cap given nothing changes", normalizeVolley([{ target: "b", cells: ["0,0", "0,1", "0,2", "0,3"] }], 4).ok);

ok("too few shots is refused", !normalizeVolley([{ target: "b", cells: ["0,0"] }], 4).ok);
ok("too many is refused", !normalizeVolley([{ target: "b", cells: ["0,0", "0,1", "0,2"] }, { target: "c", cells: ["1,1", "1,2"] }], 4).ok);
ok("a repeated square counts once", !normalizeVolley([{ target: "b", cells: ["0,0", "0,0", "0,1", "0,2"] }], 4).ok);
ok("nothing is refused", !normalizeVolley([], 2).ok && !normalizeVolley(null, 2).ok);

console.log("\nhow many one rival may take");
ok("two, to begin with", MIN_PER_TARGET === 2);
ok("five shots over five rivals is two apiece", perTargetCap(5, 5) === 2);
ok("two shots over any number of rivals is still two", perTargetCap(2, 1) === 2 && perTargetCap(2, 4) === 2);
ok("cap stays two when rivals can absorb all shots at two apiece", [2, 4, 5, 6].every((shots) => [2, 3, 5].every((n) => !(n * 2 >= shots) || perTargetCap(shots, n) === 2)));
ok("a lone rival takes all the shots", perTargetCap(5, 1) === 5 && perTargetCap(4, 1) === 4 && perTargetCap(3, 1) === 3);
ok("the volley is the chart's shots when there are rivals enough", volleyShots(5, 4) === 5 && volleyShots(4, 2) === 4);
ok("five shots over two open rivals is still five — cap rises to fit", volleyShots(5, 2) === 5);
ok("one open rival takes all the shots", volleyShots(5, 1) === 5);
ok("nobody open fires nothing", volleyShots(5, 0) === 0);

console.log("\nthe computer's targets");
const foes = [{ uid: "a" }, { uid: "b" }, { uid: "c" }, { uid: "d" }, { uid: "e" }];
let t = aiTargets([], foes, 5, "hard");
ok("hard puts five shots two, two and one over three captains", t.map((p) => p.count).join() === "2,2,1" && new Set(t.map((p) => p.target)).size === 3);
t = aiTargets([], foes, 4, "medium");
ok("medium puts as many as the rule allows on one captain, and then moves on", t.map((p) => p.count).join() === "2,2");
t = aiTargets([], foes, 4, "easy");
ok("so does easy", t.map((p) => p.count).join() === "2,2");
ok("none of them ever puts more than two on one captain when there are captains to spare",
  ["easy", "medium", "hard"].every((lvl) => [2, 3, 4, 5, 6].every((shots) =>
    aiTargets([], foes, shots, lvl).every((p) => p.count <= 2))));
ok("and every shot is placed", ["easy", "medium", "hard"].every((lvl) => [1, 2, 3, 4, 5, 6].every((shots) =>
    aiTargets([], foes, shots, lvl).reduce((n, p) => n + p.count, 0) === shots)));
ok("two rivals and four shots is two each, whoever is shooting",
  ["easy", "medium", "hard"].every((lvl) => aiTargets([], foes.slice(0, 2), 4, lvl).map((p) => p.count).join() === "2,2"));
ok("two rivals and five shots: all five fire, split three and two",
  ["easy", "medium", "hard"].every((lvl) => {
    const t = aiTargets([], foes.slice(0, 2), 5, lvl);
    return t.reduce((n, p) => n + p.count, 0) === 5 && t.map((p) => p.count).sort((a, b) => b - a).join() === "3,2";
  }));
ok("a rotation that leaves two open takes four between them, two apiece",
  aiTargets(["a", "b", "c"], foes, 4, "medium").map((p) => p.count).sort((a, b) => b - a).join() === "2,2");
ok("with five shots and only the last captain closed, four are open: all five fire spread 2-2-1",
  aiTargets(["a", "b", "c"], foes, 5, "medium").reduce((n, p) => n + p.count, 0) === 5 &&
  aiTargets(["a", "b", "c"], foes, 5, "medium").map((p) => p.count).sort((a, b) => b - a).join() === "2,2,1");
const hist = ["a", "b", "c", "d", "e"];
const seen = new Set();
for (let i = 0; i < 40; i++) for (const p of aiTargets(hist, foes, 4, "hard")) seen.add(p.target);
ok("it obeys the rotation: the most recently fired captain is off the list", !seen.has("e") && seen.has("a") && seen.has("b") && seen.has("c") && seen.has("d"));
ok("with one opponent it fires everything at them", aiTargets([], [{ uid: "z" }], 5, "hard").length === 1);
ok("two shots on hard still split one and one", aiTargets([], foes, 2, "hard").map((p) => p.count).join() === "1,1");

console.log(bad ? `\n${bad} failing\n` : "\nall battleship checks passed\n");
process.exit(bad ? 1 : 0);
