#!/usr/bin/env node
// Builds the puzzle archive: every theme, eight puzzles at each difficulty.
//
// Grids are generated here rather than at round start, because the interlock
// search has a real failure rate and doesn't belong on the hot path.
//
//   node scripts/seed-puzzles.js
//   node scripts/seed-puzzles.js --per 8

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLayout } from "../public/layout.js";
import { STARTER_PUZZLES } from "../src/starter-puzzles.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const WORDS_PER_PUZZLE = 10;
const LEVELS = ["easy", "medium", "hard"];

const args = process.argv.slice(2);
const perArg = args.indexOf("--per");
const PER_LEVEL = perArg !== -1 ? Number(args[perArg + 1]) : 8;

const bank = JSON.parse(readFileSync(join(here, "word-bank.json"), "utf8"));

function pick(list, n) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const puzzles = [];

for (const theme of bank.themes) {
  for (const level of LEVELS) {
    const pool = theme.levels[level] || [];
    const seen = new Set();
    let made = 0;
    let attempts = 0;

    while (made < PER_LEVEL && attempts < PER_LEVEL * 400) {
      attempts++;
      const chosen = pick(pool, WORDS_PER_PUZZLE);
      const signature = chosen.map((w) => w.answer).sort().join("|");
      if (seen.has(signature)) continue;

      const res = buildLayout(chosen, 250);
      if (!res.ok) continue;

      seen.add(signature);
      made++;
      puzzles.push({
        id: `${theme.id}-${level[0]}${String(made).padStart(2, "0")}`,
        theme: theme.id,
        themeName: theme.name,
        difficulty: level,
        title: `${theme.name} ${level[0].toUpperCase()}${level.slice(1)} ${made}`,
        rows: res.grid.rows,
        cols: res.grid.cols,
        entries: res.grid.entries,
      });
    }

    if (made < PER_LEVEL)
      console.warn(`Only built ${made}/${PER_LEVEL} for ${theme.name} ${level}. Add more words to that pool.`);
  }
}

// Scrolls written by hand rather than seeded from the bank — America, St.
// Louis City — live only in starter-puzzles.js. KV replaces the built-in
// archive wholesale once it has content, so they ride along here or they
// vanish from the picker the moment KV takes over.
const banked = new Set(bank.themes.map((t) => t.id));
let carried = 0;
for (const p of Object.values(STARTER_PUZZLES)) {
  if (banked.has(p.theme)) continue;
  puzzles.push(p);
  carried++;
}
if (carried) console.log(`Carried ${carried} hand-made scroll(s) from starter-puzzles.js.`);

const outDir = join(root, "dist", "puzzles");
mkdirSync(outDir, { recursive: true });

const index = puzzles.map((p) => ({
  id: p.id, theme: p.theme, themeName: p.themeName,
  difficulty: p.difficulty, title: p.title, rows: p.rows, cols: p.cols,
}));

writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2));
for (const p of puzzles) writeFileSync(join(outDir, `${p.id}.json`), JSON.stringify(p, null, 2));

const byTheme = {};
for (const p of puzzles) {
  byTheme[p.themeName] = byTheme[p.themeName] || {};
  byTheme[p.themeName][p.difficulty] = (byTheme[p.themeName][p.difficulty] || 0) + 1;
}
for (const [name, levels] of Object.entries(byTheme)) {
  console.log(`${name}: ` + LEVELS.map((l) => `${l} ${levels[l] || 0}`).join(", "));
}
console.log(`\n${puzzles.length} puzzles in dist/puzzles/.`);
console.log("Upload to the dev store with:  npm run kv:upload:local");
console.log("Upload to your KV namespace with:  npm run kv:upload");
