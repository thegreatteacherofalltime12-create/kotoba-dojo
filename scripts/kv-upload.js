#!/usr/bin/env node
// Uploads dist/puzzles/ to KV in one bulk put. Works the same on Windows,
// macOS and Linux — no shell required.
//
//   npm run kv:upload         → the deployed Worker's namespace
//   npm run kv:upload:local   → the store wrangler dev keeps on this machine
//
// One process per key was fine for fifty puzzles and unbearable for six
// hundred; wrangler's bulk put takes the whole archive as one JSON file.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "dist", "puzzles");
const scope = process.argv.includes("--local") ? "--local" : "--remote";

if (!existsSync(dir)) {
  console.error("dist/puzzles/ doesn't exist yet. Run: npm run seed");
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const entries = files.map((file) => ({
  key: file === "index.json" ? "index" : `puzzle:${file.replace(/\.json$/, "")}`,
  value: readFileSync(join(dir, file), "utf8"),
}));

const bulkDir = join(root, "dist");
mkdirSync(bulkDir, { recursive: true });
const bulk = join(bulkDir, "kv-bulk.json");
writeFileSync(bulk, JSON.stringify(entries));

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const r = spawnSync(
  npx,
  ["wrangler", "kv", "bulk", "put", bulk, "--binding=PUZZLES", scope],
  { stdio: "inherit", cwd: root, shell: process.platform === "win32" },
);
if (r.error) { console.error(`Could not run wrangler: ${r.error.message}`); process.exit(1); }
if (r.status !== 0) {
  console.error(`\nBulk put failed. The wrangler output above says why. To retry by hand:\n  npx wrangler kv bulk put dist/kv-bulk.json --binding=PUZZLES ${scope}`);
  process.exit(1);
}
console.log(`\nUploaded ${entries.length} keys ${scope === "--local" ? "to the local dev store" : "to your KV namespace"}.`);
