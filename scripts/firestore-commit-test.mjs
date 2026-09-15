// node scripts/firestore-commit-test.mjs
//
// The writes a match makes and how the leaderboard totals are read back out
// of the commit. The order of the writes is load-bearing — the totals are
// found by tag, and a tag that drifts from its write would put the wrong
// number on every home screen — so it is pinned here.
import {
  matchWrites, boardRowsFromCommit, transformNumbers, walletTotals, walletWrites,
} from "../src/firestore.js";
import { tellCommons } from "../src/commons-notify.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

const BASE = "projects/t/databases/(default)/documents";
const match = {
  code: "ABCDE", roundNo: 2, finishedAt: 1_700_000_000_000, puzzleId: "p1", game: "crossword", mode: "rumble",
  results: [
    { uid: "a", name: "Ana", score: 120, gain: 95, status: "solved", placement: 1, rate: 120 },
    { uid: "b", name: "Bo", score: 60, gain: 40, status: "solved", placement: 2 },
    { uid: "c", name: "Cy", score: 0, gain: 0, status: "gave up", placement: 3 },
  ],
};
const N = match.results.length;

console.log("\na logged match");
const { writes, tags } = matchWrites(BASE, "ABCDE-2-1700000000000", match, true);
ok("one match, one history row each, one board row each", writes.length === 1 + N + N);
ok("the tags say which is which",
  tags.map((t) => t.kind).join() === "match,history,history,history,board,board,board");
const board = writes.filter((_, i) => tags[i].kind === "board");
ok("a board row is a single write", board.every((w) => w.update && w.updateMask && w.updateTransforms && !w.transform));
ok("the fields are masked, so prestige is never touched",
  board.every((w) => !w.updateMask.fieldPaths.includes("prestige") && !w.updateMask.fieldPaths.includes("totalPoints")));
ok("the rate is written only when there is one",
  board[0].updateMask.fieldPaths.includes("lastRate") && !board[1].updateMask.fieldPaths.includes("lastRate"));
ok("the three increments, in the order the room expects",
  board.every((w) => w.updateTransforms.map((t) => t.fieldPath).join() === "totalPoints,roundsPlayed,bestScore"));
ok("the private log is written under the player",
  writes[1].update.name === `${BASE}/users/a/history/ABCDE-2-1700000000000`);

// What Firestore hands back: one result per write, transforms where asked.
const iv = (n) => ({ integerValue: String(n) });
const commit = {
  writeResults: [
    {}, {}, {}, {},
    { transformResults: [iv(1095), iv(12), iv(300)] },
    { transformResults: [iv(540), iv(3), iv(60)] },
    { transformResults: [iv(0), iv(1), iv(0)] },
  ],
};
const rows = boardRowsFromCommit(tags, commit);
ok("the totals are read back by tag", rows.length === 3 && rows[0].uid === "a" && rows[0].totalPoints === 1095);
ok("with rounds and best", rows[1].roundsPlayed === 3 && rows[1].bestScore === 60);
ok("and the rate when there was one", rows[0].lastRate === 120 && !("lastRate" in rows[1]));
ok("a missing number makes the whole thing null rather than a guess",
  boardRowsFromCommit(tags, { writeResults: commit.writeResults.slice(0, 5) }) === null);
ok("so does a number that is not one",
  boardRowsFromCommit(tags, { writeResults: [{}, {}, {}, {}, { transformResults: [{ stringValue: "x" }, iv(1), iv(1)] }] }) === null);

console.log("\nthe arcade");
const arcade = matchWrites(BASE, "ARCADE-0-1", { ...match, code: "ARCADE", results: [match.results[0]] }, false);
ok("a solve is one write, not three", arcade.writes.length === 1 && arcade.tags[0].kind === "board");
ok("and its total is at index zero",
  boardRowsFromCommit(arcade.tags, { writeResults: [{ transformResults: [iv(7), iv(1), iv(7)] }] })[0].totalPoints === 7);

console.log("\nreading transforms");
ok("a double is a number too", transformNumbers({ writeResults: [{ transformResults: [{ doubleValue: 2.5 }] }] }, 0, 1)[0] === 2.5);
ok("too few results is null", transformNumbers({ writeResults: [{ transformResults: [iv(1)] }] }, 0, 2) === null);
ok("no body is null", transformNumbers(null, 0, 1) === null);

console.log("\nwallets");
const ww = walletWrites("B/users/u1", "B/wallets/u1", "u1", "Ana", 250);
ok("a bank is two writes", ww.length === 2);
ok("the private document first, increments only, nothing else on it touched",
  ww[0].transform?.document === "B/users/u1" && !ww[0].update
  && ww[0].transform.fieldTransforms.map((t) => t.fieldPath).join() === "casino.wallet,casino.banked");
ok("the public row second, as one write", ww[1].update?.name === "B/wallets/u1" && ww[1].updateMask.fieldPaths.join() === "uid,name"
  && ww[1].updateTransforms.length === 1 && ww[1].updateTransforms[0].fieldPath === "wallet");
const wd = walletWrites("B/users/u1", "B/wallets/u1", "u1", "Ana", -40);
ok("a withdrawal does not count as banked", wd[0].transform.fieldTransforms.length === 1
  && wd[0].transform.fieldTransforms[0].increment.integerValue === "-40");
const walletCommit = { writeResults: [{ transformResults: [iv(950), iv(2000)] }, { transformResults: [iv(950)] }] };
const totals = walletTotals(walletCommit);
ok("the private figure comes from the first write", totals.mine === 950);
ok("the public row from the second", totals.wallet === 950);
ok("half an answer is no answer", walletTotals({ writeResults: [{ transformResults: [iv(1)] }] }) === null);

console.log("\ntelling the room");
ok("a bare env is a no-op", (await tellCommons({}, "/chat/append", {})) === false);
const heard = [];
const fakeRoom = {
  idFromName: () => "global",
  get: () => ({ fetch: async (u, init) => { heard.push({ path: new URL(u).pathname, body: JSON.parse(init.body) }); return new Response("{}"); } }),
};
ok("a bound room hears the message", (await tellCommons({ COMMONS: fakeRoom }, "/board/upsert", { rows })) === true
  && heard[0].path === "/board/upsert" && heard[0].body.rows[0].totalPoints === 1095);
const slowRoom = { idFromName: () => "global", get: () => ({ fetch: () => new Promise(() => {}) }) };
const t0 = Date.now();
ok("a room that never answers is given up on", (await tellCommons({ COMMONS: slowRoom }, "/chat/append", {})) === false
  && Date.now() - t0 < 5000);

console.log(bad ? `\n${bad} failing` : "\nall commit checks passed");
process.exit(bad ? 1 : 0);
