// node scripts/battleship-test.mjs
import {
  FLEET, SIZE, validateFleet, randomFleet, canTarget, targetOptions,
  fireAt, fleetSunk, battleScore, cellsFor, COOLDOWN_TARGETS,
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
ok("two others isn't enough", canTarget(["b", "c", "d"], "b", 6).ok === false);
ok("three others frees them", canTarget(["b", "c", "d", "e"], "b", 6).ok === true);
ok("the same player twice counts once",
  canTarget(["b", "c", "c", "c"], "b", 6).ok === false);
ok("it counts from the LAST time you hit them",
  canTarget(["b", "c", "d", "e", "b", "c"], "b", 6).ok === false);
ok("the message says how many are left",
  canTarget(["b", "c"], "b", 6).remaining === 2);
ok("with three opponents the rule lifts", canTarget(["b"], "b", 3).ok === true);
ok("with four it applies again", canTarget(["b"], "b", 4).ok === false);

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

console.log(bad ? `\n${bad} failing\n` : "\nall battleship checks passed\n");
process.exit(bad ? 1 : 0);
