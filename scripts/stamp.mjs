// node scripts/stamp.mjs
//
// Stamps the build into the two places that must agree.
//
// The page carries the build it was built from in <meta name="build">, and
// the update check asks version.json what the current build is. When they
// differ, the app tells the player a new version is ready. They therefore
// have to be written together, by one hand: a deploy that bumped one and not
// the other left every player seeing "a new version is ready" on every load,
// reload or not, for as long as the two disagreed.
//
// Runs as part of `npm run deploy`. Run it on its own to re-stamp without
// deploying.
import { readFileSync, writeFileSync } from "node:fs";

const now = new Date();
const stamp = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";

const html = "public/index.html";
const src = readFileSync(html, "utf8");
const re = /(<meta name="build" content=")[^"]*(")/;
if (!re.test(src)) {
  console.error(`${html}: no <meta name="build"> to stamp`);
  process.exit(1);
}
writeFileSync(html, src.replace(re, `$1${stamp}$2`));

const json = "public/version.json";
const eol = readFileSync(json, "utf8").includes("\r\n") ? "\r\n" : "\n";
writeFileSync(json, `{"build": "${stamp}"}${eol}`);

console.log(`stamped ${stamp} into ${html} and ${json}`);

// ── image versioning ─────────────────────────────────────────────────
//
// Pictures are cached for an hour by name, which is right for a picture that
// does not change. It is wrong the moment one is replaced under the same
// name: the browser keeps the old one until the hour is up, and a deploy
// that swapped the background looks like it did nothing. So every local
// image the stylesheet points at carries a query of its own content hash —
// a changed picture is a new URL, an unchanged one stays cached.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

const seen = new Map();
// The stylesheet links pictures as ./file; the golf page links them as /file.
for (const sheetPath of ["public/styles.css", "public/links.html"]) {
  let sheet = readFileSync(sheetPath, "utf8");
  sheet = sheet.replace(/url\("(\.?\/)([^"?]+\.(?:jpe?g|png|webp))(?:\?v=[^"]*)?"\)/g, (m, lead, file) => {
    const path = `public/${file}`;
    if (!existsSync(path)) return m;                 // not ours to version
    if (!seen.has(file)) seen.set(file, createHash("md5").update(readFileSync(path)).digest("hex").slice(0, 8));
    return `url("${lead}${file}?v=${seen.get(file)}")`;
  });
  writeFileSync(sheetPath, sheet);
}
console.log(`versioned ${seen.size} image link(s): ${[...seen.entries()].map(([f, h]) => `${f}@${h}`).join(", ")}`);
