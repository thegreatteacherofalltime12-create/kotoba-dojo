#!/usr/bin/env node
// Brings a zip from a Claude chat into the project without losing anything.
//
//   npm run import -- D:\Appbuilder\omni-battle-charts.zip
//
// A chat builds its zip from whatever version was uploaded to it, which is
// days old by the time it comes back. Dropping the whole zip over the folder
// puts every file back to that version, and work done since — in this
// project, on the same files — is gone. That happened on the tenth and again
// on the thirteenth, twenty-four files at a time.
//
// This reads the zip and, for each file, works out what actually changed in
// the chat and merges only that onto the current code:
//
//   identical to what is here    → nothing to do
//   a plain old copy             → the chat did not touch it; kept current
//   new, not in the project      → added
//   edited in the chat           → found the version the chat started from,
//                                  three-way merged against the current file
//   older than anything on record → kept current, and named — see below
//
// That last case is the dangerous one. A chat can hold a copy of a file from
// before it was ever committed here, and git has no version to anchor it to;
// the nearest commit is newer, so the difference reads as an edit that undoes
// the newer commit. Left alone, that reintroduced a fixed bug on the first
// try. So a copy is merged only when it clearly adds — more lines in than
// out, and at least a handful. A copy that mostly takes away is treated as
// old and kept current, and the summary says so. If you did edit one of
// those, run again with --take <file> and it is merged regardless.
//
// The merge is git's own. A clean merge is written in place; a conflict is
// written with the usual <<<<<<< markers and named in the summary, for a
// person to settle. Nothing is committed, nothing is deployed, and no file
// that the zip does not carry is ever removed.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const take = new Set();
for (let i = 0; i < args.length; i++) if (args[i] === "--take" && args[i + 1]) take.add(args[++i].split("\\").join("/"));
const zip = args.find((a) => a !== "--take" && !take.has(a.split("\\").join("/")));
if (!zip || !existsSync(zip)) {
  console.error("Usage: npm run import -- <path-to-zip>");
  process.exit(1);
}

const SKIP = new Set(["node_modules", ".git", ".wrangler", "dist"]);
const win = process.platform === "win32";
const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
const lf = (s) => s.replace(/\r\n/g, "\n");

// ── 1. unpack ────────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), "omni-import-"));
const unpack = win
  ? spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`], { encoding: "utf8" })
  : spawnSync("unzip", ["-q", zip, "-d", tmp], { encoding: "utf8" });
if (unpack.status !== 0) {
  console.error("Could not unpack the zip:\n" + (unpack.stderr || unpack.stdout));
  process.exit(1);
}

// The project may sit at the top of the zip or one folder down.
function findRoot(dir) {
  if (existsSync(join(dir, "package.json")) || existsSync(join(dir, "src"))) return dir;
  const kids = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
  for (const k of kids) { const r = findRoot(join(dir, k)); if (r) return r; }
  return null;
}
const zroot = findRoot(tmp);
if (!zroot) { console.error("The zip does not look like this project (no package.json or src/)."); process.exit(1); }

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// ── 2. per file ──────────────────────────────────────────────────────────
const report = { same: [], stale: [], added: [], merged: [], conflict: [], binary: [], old: [] };
const GENERATED = new Set(["public/version.json"]);
const isText = (buf) => !buf.subarray(0, 8000).includes(0);

for (const abs of walk(zroot)) {
  const rel = relative(zroot, abs).split(sep).join("/");
  if (GENERATED.has(rel)) continue;
  const zbuf = readFileSync(abs);
  const here = join(root, rel);
  const inHead = git("cat-file", "-e", `HEAD:${rel}`).status === 0;

  if (!isText(zbuf)) {
    // Pictures and the like: bring in if new, otherwise leave alone —
    // a picture the chat did not make is a picture it did not change.
    if (!existsSync(here)) { mkdirSync(dirname(here), { recursive: true }); writeFileSync(here, zbuf); report.added.push(rel); }
    else report.binary.push(rel);
    continue;
  }
  let theirs = lf(zbuf.toString("utf8"));
  if (rel === "public/index.html" && existsSync(here)) {
    const mine = lf(readFileSync(here, "utf8")).match(/<meta name="build" content="[^"]*">/);
    if (mine) theirs = theirs.replace(/<meta name="build" content="[^"]*">/, mine[0]);
  }

  if (existsSync(here) && lf(readFileSync(here, "utf8")) === theirs) { report.same.push(rel); continue; }
  if (!inHead) {
    mkdirSync(dirname(here), { recursive: true });
    writeFileSync(here, theirs);
    report.added.push(rel);
    continue;
  }

  // Which version did the chat start from? Every commit that touched the
  // file, newest first. An exact match means the chat never edited it.
  const commits = git("log", "--format=%H", "--", rel).stdout.trim().split("\n").filter(Boolean);
  let base = null, fewest = Infinity, baseAdded = 0, baseRemoved = 0;
  for (const c of commits) {
    const then = lf(git("show", `${c}:${rel}`).stdout);
    if (then === theirs) { base = "same"; break; }
    // Lines the chat's copy lacks relative to this commit. The true base
    // is the commit it lacks the fewest of.
    const a = join(tmp, "a.txt"), b = join(tmp, "b.txt");
    writeFileSync(a, then); writeFileSync(b, theirs);
    const num = spawnSync("git", ["diff", "--no-index", "--numstat", a, b], { encoding: "utf8" }).stdout;
    const mm = num.match(/^(\d+)\t(\d+)/m) || [0, 0, 0];
    const added = Number(mm[1]), removed = Number(mm[2]);
    if (removed < fewest) { fewest = removed; base = c; baseAdded = added; baseRemoved = removed; }
  }
  if (base === "same") { report.stale.push(rel); continue; }

  // The guard. A copy that takes away more than it adds, or adds next to
  // nothing, is more likely older than any version on record than an edit.
  const clearlyAnEdit = baseAdded >= 5 && baseAdded > baseRemoved;
  if (!clearlyAnEdit && !take.has(rel)) {
    report.old.push(`${rel}  (+${baseAdded} −${baseRemoved} against ${base.slice(0, 7)})`);
    continue;
  }

  // Three-way: ours is what is here now, theirs is the chat's, base is
  // what the chat started from.
  const ours = lf(git("show", `HEAD:${rel}`).stdout);
  const pO = join(tmp, "ours.txt"), pB = join(tmp, "base.txt"), pT = join(tmp, "theirs.txt");
  writeFileSync(pO, ours); writeFileSync(pB, lf(git("show", `${base}:${rel}`).stdout)); writeFileSync(pT, theirs);
  const m = spawnSync("git", ["merge-file", "-L", "current", "-L", "chat started from", "-L", "chat", pO, pB, pT], { encoding: "utf8" });
  const result = readFileSync(pO, "utf8");
  const crlf = existsSync(here) && readFileSync(here, "utf8").includes("\r\n");
  writeFileSync(here, crlf ? result.replace(/\n/g, "\r\n") : result);
  (m.status === 0 ? report.merged : report.conflict).push(`${rel}${m.status > 0 ? ` (${m.status} conflict${m.status === 1 ? "" : "s"})` : ""}  ← from ${base.slice(0, 7)}`);
}

rmSync(tmp, { recursive: true, force: true });

// ── 3. say what happened ─────────────────────────────────────────────────
const line = (label, list) => { if (list.length) console.log(`\n${label} (${list.length})\n  ` + list.join("\n  ")); };
console.log(`Imported ${zip}`);
line("Merged onto the current code", report.merged);
line("CONFLICTS — open these and settle the <<<<<<< blocks", report.conflict);
line("Added (new to the project)", report.added);
line("Kept current — the chat's copy was an older version, not an edit", report.stale);
line("Kept current — looked older than any version on record (mostly takes away). If you DID edit one, re-run with --take <file>", report.old);
if (report.binary.length) console.log(`\nPictures left as they are (${report.binary.length})`);
console.log(`\nUnchanged: ${report.same.length}`);
console.log(`\nNothing is committed. Next: npm test, look over the changes, then commit and npm run deploy.`);
process.exit(report.conflict.length ? 2 : 0);

