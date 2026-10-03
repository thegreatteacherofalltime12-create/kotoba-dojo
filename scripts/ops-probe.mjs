// node scripts/ops-probe.mjs [baseUrl]
//
// The weekly look at the deployed game from the outside, with no sign-in:
//
//   lag            how fast the live site answers, and how heavy the page is
//   missing data   every file the page names is really there and is what we
//                  deployed; the public boards and lists have something in them
//   players        the arena chat, kept in an archive so a busy week is not
//                  lost to the 60 lines the server remembers, with the lines
//                  that sound like trouble marked
//
// It prints a short report and writes the full one to ops/reports/. Exit code
// is 1 only when something is down (a page or file that will not load, a 5xx);
// slow and odd are warnings, because one machine's network is one opinion.
//
// What it cannot see: anything behind a sign-in. That means the live
// WebSocket round trip inside a room, and what the server writes to its own log.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const BASE = (process.argv[2] || "https://kotoba-dojo.prior-mixed-theme.workers.dev").replace(/\/$/, "");

const SAMPLES = 7;
const WARN = { staticMedian: 600, apiMedian: 1000, p95: 2500, max: 5000, bigFile: 400_000, bigScript: 300_000 };
const DAY = 86_400_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => (Number.isFinite(n) ? Math.round(n) : null);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);
const text = (buf) => buf.toString("utf8").replace(/\r/g, "");

async function hit(path) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const body = Buffer.from(await res.arrayBuffer());
    return { ok: true, status: res.status, ms: performance.now() - t0, bytes: body.length, type: res.headers.get("content-type") || "", body };
  } catch (e) {
    return { ok: false, status: 0, ms: performance.now() - t0, bytes: 0, type: "", error: String(e.message || e) };
  }
}

/** The same address a few times: the first answer is often the slow one (a room waking up), so it is kept apart. */
async function timeIt(path, kind) {
  const runs = [];
  for (let i = 0; i < SAMPLES; i++) { runs.push(await hit(path)); await sleep(150); }
  const ms = runs.filter((r) => r.ok).map((r) => r.ms);
  const row = {
    path, kind, statuses: [...new Set(runs.map((r) => r.status))], first: round(runs[0].ms),
    median: round(pct(ms, 0.5)), p95: round(pct(ms, 0.95)), max: round(ms.length ? Math.max(...ms) : NaN),
    failed: runs.filter((r) => !r.ok || r.status >= 500).length, bytes: runs[0].bytes,
  };
  const limit = kind === "static" ? WARN.staticMedian : WARN.apiMedian;
  row.flags = [];
  if (row.failed) row.flags.push(`${row.failed} of ${SAMPLES} failed`);
  if (row.median > limit) row.flags.push(`median ${row.median}ms is over ${limit}ms`);
  if (row.p95 > WARN.p95) row.flags.push(`p95 ${row.p95}ms is over ${WARN.p95}ms`);
  if (row.max > WARN.max) row.flags.push(`worst ${row.max}ms is over ${WARN.max}ms`);
  return row;
}

const json = async (path) => {
  const r = await hit(path);
  if (!r.ok || r.status !== 200) return { ok: false, status: r.status, error: r.error, ms: round(r.ms) };
  try { return { ok: true, status: 200, ms: round(r.ms), data: JSON.parse(r.body.toString("utf8")) }; }
  catch { return { ok: false, status: 200, error: "not JSON", ms: round(r.ms) }; }
};

/* ── lag: how fast it answers ─────────────────────────────────────────── */

const timings = [];
for (const p of ["/", "/app.js", "/match3.js", "/styles.css", "/version.json"]) timings.push(await timeIt(p, "static"));
for (const p of ["/api/chat", "/api/feed", "/api/records", "/api/config", "/api/shop", "/api/room/ZZZZ", "/api/rankings"]) timings.push(await timeIt(p, "api"));
// /api/rankings is signed-in only: a 401 is the right answer, and proves the Worker is routing.

/* ── missing data: is every file there, and is it the one we deployed? ── */

const localFiles = new Set(readdirSync(PUBLIC));
const wanted = new Set(["/index.html"]);
const scan = (name) => {
  if (!localFiles.has(name)) return;
  const src = text(readFileSync(join(PUBLIC, name)));
  const found = new Set();
  for (const m of src.matchAll(/(?:src|href)="(?:\.\/|\/)?([\w.-]+\.(?:js|css|webp|jpg|jpeg|png|webmanifest|json))"/g)) found.add(m[1]);
  for (const m of src.matchAll(/from\s+["']\.\/([\w.-]+\.js)["']/g)) found.add(m[1]);
  for (const m of src.matchAll(/import\(\s*["']\.\/([\w.-]+\.js)["']\s*\)/g)) found.add(m[1]);
  // Pictures are named with a ?v= tag on the end, which is what makes a changed one reload.
  for (const m of src.matchAll(/["'`(\/]([\w-]+\.(?:webp|jpg|jpeg|png))(?:\?[^"'`)\s]*)?["'`)]/g)) found.add(m[1]);
  return found;
};
const named = new Map();            // file -> who names it
const queue = ["index.html"];
const seen = new Set();
while (queue.length) {
  const f = queue.shift();
  if (seen.has(f)) continue;
  seen.add(f);
  for (const g of scan(f) || []) {
    if (!named.has(g)) named.set(g, new Set());
    named.get(g).add(f);
    if (/\.(js|css|html)$/.test(g)) queue.push(g);
  }
}
for (const g of named.keys()) wanted.add("/" + g);

const files = [];
for (const p of [...wanted].sort()) {
  const name = p.slice(1);
  const live = await hit(p === "/index.html" ? "/" : p);
  const onDisk = localFiles.has(name) ? readFileSync(join(PUBLIC, name)) : null;
  const isText = /\.(js|css|html|json|webmanifest)$/.test(name);
  const same = onDisk && live.ok && live.status === 200
    ? (isText ? sha(Buffer.from(text(onDisk))) === sha(Buffer.from(text(live.body))) : sha(onDisk) === sha(live.body))
    : null;
  files.push({
    file: name, status: live.status, bytes: live.bytes, type: live.type.split(";")[0],
    namedBy: [...(named.get(name) || [])].slice(0, 3), inRepo: !!onDisk, matchesRepo: same,
  });
}
const gone = files.filter((f) => f.status !== 200 || f.bytes === 0);
const unknown = files.filter((f) => !f.inRepo && f.status === 200 && f.file !== "index.html");
const notInRepo = files.filter((f) => !f.inRepo);
const stale = files.filter((f) => f.inRepo && f.status === 200 && f.matchesRepo === false);

let repoBuild = null, liveBuild = null;
try { repoBuild = JSON.parse(readFileSync(join(PUBLIC, "version.json"), "utf8")).build; } catch { /* not there */ }
const v = await json("/version.json");
if (v.ok) liveBuild = v.data.build;

const weight = { js: 0, css: 0, images: 0, html: 0 };
for (const f of files) {
  if (f.status !== 200) continue;
  if (/\.js$/.test(f.file)) weight.js += f.bytes;
  else if (/\.css$/.test(f.file)) weight.css += f.bytes;
  else if (/\.html$/.test(f.file)) weight.html += f.bytes;
  else if (/\.(webp|jpg|jpeg|png)$/.test(f.file)) weight.images += f.bytes;
}
const heaviest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 6).map((f) => ({ file: f.file, kb: round(f.bytes / 1024) }));
const heavy = files.filter((f) => f.status === 200 && (/\.js$/.test(f.file) ? f.bytes > WARN.bigScript : f.bytes > WARN.bigFile))
  .map((f) => ({ file: f.file, kb: round(f.bytes / 1024) }));

/* ── missing data: do the public boards have anything in them? ─────────── */

const lists = [];
const check = async (path, pick, expect) => {
  const r = await json(path);
  const n = r.ok ? pick(r.data) : null;
  lists.push({ path, ok: r.ok, status: r.status, ms: r.ms, count: n, flag: !r.ok ? `did not load (${r.status || r.error})` : expect && n < expect ? `only ${n}, expected at least ${expect}` : null });
  return r;
};
const chatRes = await check("/api/chat", (d) => d.chat.length);
const feedRes = await check("/api/feed", (d) => d.feed.length);
await check("/api/records", (d) => Object.keys(d).length, 3);
await check("/api/wallets/top", (d) => d.wallets.length, 1);
await check("/api/puzzles", (d) => d.puzzles.length, 100);
await check("/api/links/courses", (d) => d.courses.length, 1);
await check("/api/bounty", (d) => d.history?.length ?? 0);
await check("/api/mines/scores", (d) => Object.keys(d.scores || {}).length);
const newest = (rows) => rows.reduce((a, r) => Math.max(a, Date.parse(r.at) || 0), 0);
const age = (t) => (t ? round((Date.now() - t) / DAY * 10) / 10 : null);
const freshness = {
  newestChatDaysAgo: chatRes.ok ? age(newest(chatRes.data.chat)) : null,
  feedLinesLastDay: feedRes.ok ? feedRes.data.feed.length : null,
};

/* ── players: the chat, kept ───────────────────────────────────────────── */

const ARCHIVE = join(ROOT, "ops", "archive");
mkdirSync(ARCHIVE, { recursive: true });
const archiveFile = join(ARCHIVE, "chat.jsonl");
const had = new Map();
if (existsSync(archiveFile)) {
  for (const line of readFileSync(archiveFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); had.set(r.id, r); } catch { /* a torn line */ }
  }
}
let added = 0;
if (chatRes.ok) {
  for (const r of chatRes.data.chat) {
    if (had.has(r.id)) continue;
    had.set(r.id, r); added++;
    appendFileSync(archiveFile, JSON.stringify({ id: r.id, at: r.at, uid: r.uid, name: r.name, text: r.text }) + "\n");
  }
}
const TAGS = {
  lag: /\blag(gy|ging|s)?\b|slow|freez|froze|frozen|stutter|delay|hang|hung|stuck/i,
  bug: /\bbug|glitch|broken|crash|error|not working|doesn'?t work|won'?t (load|work|start)|can'?t (see|read|join|click|scroll|move|play)|missing|disappear|vanish|lost (my|the)|didn'?t (get|save|count|pay)/i,
  dropped: /disconnect|kicked|dropped|logged out|booted|reconnect/i,
  ui: /hard to (read|see)|too (small|big|dark|light)|scroll|colou?r|font|layout|phone|screen/i,
  idea: /would be (fun|nice|cool|great)|please add|add (more|a)|suggest|wish|more topics|new (game|mode)/i,
  fairness: /unfair|cheat|hack|exploit|rigged/i,
};
const week = [...had.values()].filter((r) => Date.now() - Date.parse(r.at) <= 7 * DAY).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
const tag = (r) => Object.entries(TAGS).filter(([, re]) => re.test(r.text)).map(([k]) => k);
const chatWeek = week.map((r) => ({ at: r.at, name: r.name, text: r.text, tags: tag(r) }));
const everyone = [...had.values()];
const chatSummary = {
  archived: everyone.length, newThisRun: added,
  oldestServerLine: chatRes.ok && chatRes.data.chat.length ? chatRes.data.chat[0].at : null,
  serverHolds: chatRes.ok ? chatRes.data.chat.length : null,
  serverLimit: 60,
  speakersThisWeek: [...new Set(week.map((r) => r.name))],
};

/* ── the report ─────────────────────────────────────────────────────── */

const warnings = [];
for (const t of timings) for (const f of t.flags) warnings.push(`LAG ${t.path}: ${f}`);
for (const f of heavy) warnings.push(`LAG heavy file ${f.file} is ${f.kb} KB`);
for (const f of gone) warnings.push(`DOWN ${f.file}: status ${f.status}, ${f.bytes} bytes (named by ${f.namedBy.join(", ") || "index.html"})`);
for (const f of unknown) warnings.push(`CHECK ${f.file} loads live but is not in public/ (named by ${f.namedBy.join(", ")})`);
for (const f of stale) warnings.push(`DRIFT ${f.file} differs from the copy in public/`);
if (repoBuild && liveBuild && repoBuild !== liveBuild) warnings.push(`DRIFT live build is ${liveBuild}; public/version.json says ${repoBuild}`);
for (const l of lists) if (l.flag) warnings.push(`DATA ${l.path}: ${l.flag}`);
if (chatSummary.serverHolds >= chatSummary.serverLimit) warnings.push(`CHAT the server keeps only ${chatSummary.serverLimit} lines and is full; older ones are gone unless archived`);

const report = {
  at: new Date().toISOString(), base: BASE, samplesEach: SAMPLES,
  vantage: "this computer's network, one place, not a player's phone",
  timings, files: { total: files.length, gone, notInRepo: notInRepo.map((f) => f.file), stale: stale.map((f) => f.file), heaviest, heavy },
  build: { live: liveBuild, repo: repoBuild }, weightKB: Object.fromEntries(Object.entries(weight).map(([k, b]) => [k, round(b / 1024)])),
  lists, freshness, chat: chatSummary, chatThisWeek: chatWeek, warnings,
  notChecked: [
    "the WebSocket round trip inside a room (needs a signed-in player)",
    "what the server logs when a save fails (no log is kept: observability is off)",
    "the moderation Reports desk (admin sign-in)",
    "how it feels on a phone",
  ],
};

const outDir = join(ROOT, "ops", "reports");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
writeFileSync(join(outDir, `probe-${stamp}.json`), JSON.stringify(report, null, 2));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nOps probe of ${BASE}  (${report.at})`);
console.log(`\nLag, ${SAMPLES} requests each, milliseconds`);
console.log(`  ${pad("address", 22)}${pad("first", 8)}${pad("median", 8)}${pad("p95", 8)}${pad("max", 8)}status`);
for (const t of timings) console.log(`  ${pad(t.path, 22)}${pad(t.first, 8)}${pad(t.median, 8)}${pad(t.p95, 8)}${pad(t.max, 8)}${t.statuses.join("/")}${t.flags.length ? "  !" : ""}`);
console.log(`\nPage weight (decoded KB): js ${report.weightKB.js}, css ${report.weightKB.css}, images ${report.weightKB.images}, html ${report.weightKB.html}`);
console.log(`  heaviest: ${heaviest.map((h) => `${h.file} ${h.kb}`).join(", ")}`);
console.log(`\nFiles: ${files.length} named by the page, ${gone.length} not loading, ${stale.length} differ from public/, build live ${liveBuild} / repo ${repoBuild}`);
console.log(`\nLists: ${lists.map((l) => `${l.path.replace("/api/", "")} ${l.count ?? "x"}`).join(", ")}`);
console.log(`\nChat: ${chatSummary.archived} lines archived (${added} new), ${chatWeek.length} this week from ${chatSummary.speakersThisWeek.join(", ") || "nobody"}`);
for (const c of chatWeek) console.log(`  ${c.at.slice(0, 16)} ${c.name}: ${c.text}${c.tags.length ? `   [${c.tags.join(",")}]` : ""}`);
console.log(`\n${warnings.length ? `${warnings.length} warning(s):\n  ${warnings.join("\n  ")}` : "No warnings."}`);
console.log(`\nNot checked: ${report.notChecked.join("; ")}\nFull report: ops/reports/probe-${stamp}.json\n`);

process.exit(gone.length || timings.some((t) => t.statuses.some((s) => s >= 500 || s === 0)) ? 1 : 0);
