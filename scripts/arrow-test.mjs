// Arrow Puzzle Tap Away: every puzzle the room deals can be cleared, and the
// Easy cube is a whole cube.
import { gen2D, gen3D, canTap, SIZE_2D, SIZE_3D } from "../src/arrow-puzzle.js";

let failed = 0;
const check = (ok, what) => { console.log(`  ${ok ? "pass" : "FAIL"}  ${what}`); if (!ok) failed++; };

/** Clears the puzzle by tapping any free block until none is left, or gets stuck. */
function solvable(blocks, dim, size) {
  let left = blocks.map((b) => ({ ...b }));
  while (left.length) {
    const free = left.find((b) => canTap(left, b.id, dim, size));
    if (!free) return false;
    left = left.filter((b) => b.id !== free.id);
  }
  return true;
}

console.log("\nthe 2D grid");
for (let i = 0; i < 50; i++) {
  const p = gen2D(SIZE_2D);
  if (!solvable(p, 2, SIZE_2D)) { check(false, `puzzle ${i} cannot be cleared`); break; }
  if (i === 49) check(true, "fifty puzzles in a row can all be cleared");
}
check(gen2D(SIZE_2D).length >= SIZE_2D * SIZE_2D * 0.6, "and most of the grid is filled");

console.log("\nthe loose 3D cube (medium and hard)");
for (let i = 0; i < 50; i++) {
  const p = gen3D(SIZE_3D, false);
  if (!solvable(p, 3, SIZE_3D)) { check(false, `puzzle ${i} cannot be cleared`); break; }
  if (i === 49) check(true, "fifty puzzles in a row can all be cleared");
}

console.log("\nthe solid 3D cube (easy)");
let whole = true, clear = true;
for (let i = 0; i < 50; i++) {
  const p = gen3D(SIZE_3D, true);
  if (p.length !== SIZE_3D ** 3) whole = false;
  if (!solvable(p, 3, SIZE_3D)) clear = false;
}
check(whole, `every cell of the ${SIZE_3D}x${SIZE_3D}x${SIZE_3D} cube holds a block, fifty times over`);
check(clear, "and every one of those cubes can still be cleared");
const solid = gen3D(SIZE_3D, true);
const freeAtStart = solid.filter((b) => canTap(solid, b.id, 3, SIZE_3D)).length;
check(freeAtStart > 0, `a fresh solid cube has something to tap (${freeAtStart} free blocks)`);

if (failed) { console.log(`\n${failed} arrow puzzle check(s) FAILED`); process.exit(1); }
console.log("\nall arrow puzzle checks passed");
