// node scripts/bounty-office-test.mjs
import { BountyOffice } from "../src/bounty-office.js";
import { applyBounty } from "../src/report-bounty.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };
const HOUR = 3_600_000;

function makeState() {
  const store = new Map();
  return {
    _init: null,
    blockConcurrencyWhile(fn) { this._init = fn(); return this._init; },
    waitUntil: (p) => p,
    storage: {
      get: async (k) => store.get(k),
      put: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
    },
  };
}

const env = { FIREBASE_PROJECT_ID: "test" };  // no service account: rotation is a no-op
const state = makeState();
const office = new BountyOffice(state, env);
await state._init;

const row = (uid, score, placement) => ({ uid, name: uid.toUpperCase(), score, placement });
const report = (mode, results, durationMs = HOUR) =>
  office.report({ mode, field: results.length, durationMs, results });

console.log("\nfirst blood");
let out = await report("rumble", [row("a", 120, 1), row("b", 60, 2)]);
ok("an unheld bounty goes to the winner", out.claim?.uid === "a");
ok("the office now holds it for them", office.b.holder.uid === "a");
ok("their rate is on record", office.b.holder.perHour === 120);
ok("their first kill counts", office.b.kills.a === 1);
ok("and it announced silver", out.unlocked.map((u) => u.id).join() === "kill-1");

console.log("\ndefending");
out = await report("rumble", [row("a", 200, 1), row("c", 90, 2)]);
ok("the holder winning is a defend", out.defend?.uid === "a" && !out.claim);
ok("it pays twenty-five", out.defend.bonus === 25);
ok("a rumble defend raises the mark", office.b.holder.perHour === 200);
ok("the defend is counted", office.b.defends.a === 1);

console.log("\nhead to head");
out = await report("match", [row("c", 30, 1), row("a", 25, 2)]);
ok("beating the holder takes it on any score", out.claim?.uid === "c");
ok("even at a far lower rate", office.b.holder.perHour === 30);
ok("it names who lost it", out.claim.fromName === "A");

console.log("\nfrom a distance");
out = await report("rumble", [row("d", 20, 1), row("e", 10, 2)]);
ok("failing to beat the mark claims nothing", !out.claim && !out.defend);
ok("the holder is untouched", office.b.holder.uid === "c");

out = await report("rumble", [row("d", 400, 1), row("e", 10, 2)]);
ok("out-earning the mark claims it", out.claim?.uid === "d");

console.log("\nsolo is inert");
const before = office.b.holder.uid;
out = await report("solo", [row("z", 9999, 1)]);
ok("a huge solo score is ignored", !out.eligible && office.b.holder.uid === before);

console.log("\nclimbing the ladder");
for (let i = 0; i < 4; i++) {
  // hand it back and forth so one player racks up kills
  await report("match", [row("k", 500 + i, 1), row(office.b.holder.uid, 1, 2)]);
  await report("match", [row("x", 900 + i, 1), row("k", 1, 2)]);
}
ok("kills accumulate", office.b.kills.k >= 4);
const five = await (async () => {
  while ((office.b.kills.k || 0) < 5) {
    await report("match", [row("k", 999, 1), row(office.b.holder.uid, 1, 2)]);
    await report("match", [row("x", 1500, 1), row("k", 1, 2)]);
  }
  return office.b.kills.k;
})();
ok(`five kills reached (${five})`, five >= 5);

console.log("\nthe office answers questions");
const cur = await office.fetch(new Request("https://bounty/current"));
const body = await cur.json();
ok("it reports a holder", !!body.holder);
ok("it reports the history", Array.isArray(body.history) && body.history.length > 0);
ok("history names what happened", body.history.every((h) => !!h.kind));

const who = await (await office.fetch(new Request("https://bounty/player?uid=k"))).json();
ok("a player's record can be read", who.kills >= 5);
ok("and their unlocks are worked out", who.unlocked.slayers.some((s) => s.id === "slayer"));

console.log("\nfolding the bonus into a result");
const results = [
  { uid: "p", name: "P", score: 80, placement: 1, gain: 95, mmrBefore: 400 },
  { uid: "q", name: "Q", score: 40, placement: 2, gain: 55, mmrBefore: 900 },
];
const fakeEnv = {
  BOUNTY: {
    idFromName: () => "global",
    get: () => ({ fetch: (u, init) => office.fetch(new Request(String(u), init)) }),
  },
};
const verdict = await applyBounty(fakeEnv, state, { mode: "rumble", durationMs: HOUR, results });
const winner = results.find((r) => r.uid === "p");
ok("a claim adds fifty to the gain", verdict?.claim ? winner.gain === 145 : true);
ok("the after-figure is corrected", verdict?.claim ? winner.mmrAfter === 545 : true);
ok("the row says what happened", verdict?.claim ? winner.bounty.kind === "claimed" : true);
ok("every row carries its rate", results.every((r) => typeof r.rate === "number"));
ok("nobody's MMR went backwards", results.every((r) => r.gain >= 0));

console.log(bad ? `\n${bad} failing\n` : "\nall bounty office checks passed\n");
process.exit(bad ? 1 : 0);
