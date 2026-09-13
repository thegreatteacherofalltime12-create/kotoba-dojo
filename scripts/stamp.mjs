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
