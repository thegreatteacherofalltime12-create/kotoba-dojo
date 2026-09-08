#!/usr/bin/env node
// Uploads dist/puzzles/ to KV. Works the same on Windows, macOS and Linux —
// no shell required.
//
//   npm run kv:upload         → the deployed Worker's namespace
//   npm run kv:upload:local   → the store wrangler dev keeps on this machine

import { readdirSync, existsSync } from "node:fs";
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
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function put(key, file) {
  const r = spawnSync(
    npx,
    ["wrangler", "kv", "key", "put", key, "--binding=PUZZLES", scope, "--path", join(dir, file)],
    {
      stdio: "inherit",
      cwd: root,
      // Node 20+ refuses to execute .cmd shims without a shell, so on Windows
      // the spawn fails before wrangler ever runs.
      shell: process.platform === "win32",
    }
  );
  if (r.error) console.error(`Could not run wrangler: ${r.error.message}`);
  return r.status === 0;
}

let done = 0;
for (const file of files) {
  const key = file === "index.json" ? "index" : `puzzle:${file.replace(/\.json$/, "")}`;
  if (put(key, file)) done++;
  else {
    console.error(`\nFailed on ${key}. The wrangler output above says why.`);
    console.error(`Run this by hand to see it in full:\n  npx wrangler kv key put ${key} --binding=PUZZLES ${scope} --path dist/puzzles/${file}`);
    process.exit(1);
  }
}

console.log(`\nUploaded ${done} keys ${scope === "--local" ? "to the local dev store" : "to your KV namespace"}.`);
