// node scripts/firestore-commit-test.mjs
//
// The writes a match makes and how the leaderboard totals are read back out
// of the commit. The order of the writes is load-bearing — the totals are
// found by tag, and a tag that drifts from its write would put the wrong
// number on every home screen — so it is pinned here.
import {
  matchWrites, boardRowsFromCommit, transformNumbers, walletTotals, walletWrites, bankFeats,
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
ok("the three increments first, in the order the room expects",
  board.every((w) => w.updateTransforms.slice(0, 3).map((t) => t.fieldPath).join() === "totalPoints,roundsPlayed,bestScore"));
ok("then the round's feats: the winner's win, everyone's play",
  board[0].updateTransforms.slice(3).map((t) => t.fieldPath).join() === "feats.played_any,feats.played_crossword,feats.won_any,feats.won_crossword"
  && board[1].updateTransforms.slice(3).map((t) => t.fieldPath).join() === "feats.played_any,feats.played_crossword");
ok("the tags carry the feat keys", tags[4].feats.length === 4 && tags[5].feats.length === 2);
ok("the private log is written under the player",
  writes[1].update.name === `${BASE}/users/a/history/ABCDE-2-1700000000000`);

// What Firestore hands back: one result per write, transforms where asked.
const iv = (n) => ({ integerValue: String(n) });
const commit = {
  writeResults: [
    {}, {}, {}, {},
    { transformResults: [iv(1095), iv(12), iv(300), iv(12), iv(9), iv(4), iv(3)] },
    { transformResults: [iv(540), iv(3), iv(60), iv(3), iv(3)] },
    { transformResults: [iv(0), iv(1), iv(0), iv(1), iv(1)] },
  ],
};
const rows = boardRowsFromCommit(tags, commit);
ok("the totals are read back by tag", rows.length === 3 && rows[0].uid === "a" && rows[0].totalPoints === 1095);
ok("with rounds and best", rows[1].roundsPlayed === 3 && rows[1].bestScore === 60);
ok("and the rate when there was one", rows[0].lastRate === 120 && !("lastRate" in rows[1]));
ok("and the feats, by name", rows[0].feats.won_crossword === 3 && rows[0].feats.played_any === 12 && rows[1].feats.played_crossword === 3 && !("won_any" in rows[1].feats));
ok("a short result for a row with feats is null",
  boardRowsFromCommit(tags, { writeResults: [{}, {}, {}, {}, { transformResults: [iv(1), iv(1), iv(1), iv(1)] }] }) === null);
ok("a missing number makes the whole thing null rather than a guess",
  boardRowsFromCommit(tags, { writeResults: commit.writeResults.slice(0, 5) }) === null);
ok("so does a number that is not one",
  boardRowsFromCommit(tags, { writeResults: [{}, {}, {}, {}, { transformResults: [{ stringValue: "x" }, iv(1), iv(1)] }] }) === null);

const golf = matchWrites(BASE, "G-1-1", { code: "GOLF1", roundNo: 1, finishedAt: 1, puzzleId: "links", game: "links", courseId: "pebble",
  results: [{ uid: "g", name: "Gee", score: 80, gain: 60, status: "finished", placement: 1, toPar: -1, holes: 18 }] }, true);
const golfBoard = golf.writes[golf.tags.findIndex((t) => t.kind === "board")];
ok("a course record is written as a minimum, the rest as increments",
  golfBoard.updateTransforms.some((t) => t.fieldPath === "feats.best_links_pebble" && t.minimum?.integerValue === "-1")
  && golfBoard.updateTransforms.filter((t) => t.increment).length >= 4);

console.log("\na boosted round");
const boostedMatch = { ...match, results: [{ ...match.results[0], boost: true }, match.results[1]] };
const bm = matchWrites(BASE, "B-1-1", boostedMatch, true);
const bw = bm.writes[bm.tags.findIndex((t) => t.kind === "board")];
ok("the token is spent last in the round's own write, after the three totals and the feats",
  bw.updateTransforms.at(-1).fieldPath === "tokens.crossword" && bw.updateTransforms.at(-1).increment.integerValue === "-1"
  && bw.updateTransforms.slice(0, 3).map((t) => t.fieldPath).join() === "totalPoints,roundsPlayed,bestScore"
  && !bw.updateTransforms.slice(0, -1).some((t) => t.fieldPath.startsWith("tokens.")));
ok("an unboosted row spends nothing", !bm.writes[bm.tags.findIndex((t) => t.kind === "board") + 1].updateTransforms.some((t) => t.fieldPath.startsWith("tokens.")));
{
  const feats = bm.tags.find((t) => t.kind === "board").feats.length;
  const results = [iv(1), iv(1), iv(1), ...Array.from({ length: feats }, (_, j) => iv(10 + j)), iv(0)];
  const row = boardRowsFromCommit(bm.tags, { writeResults: [{}, {}, {}, { transformResults: results }, { transformResults: [iv(2), iv(2), iv(2), ...Array.from({ length: feats }, () => iv(1))] }] })[0];
  ok("the totals and every feat still read back by position on a boosted row",
    row.totalPoints === 1 && Object.values(row.feats)[0] === 10 && Object.values(row.feats).at(-1) === 10 + feats - 1);
  ok("the token count read back rides along for the room", row.tokens?.crossword === 0);
}
{
  const arsenal = matchWrites(BASE, "B-1-2", { ...match, game: "battleship", results: [{ ...match.results[0], spent: { bs_nuke: 2, bs_torpedo: 1, nonsense: 3 } }] }, true);
  const w = arsenal.writes[arsenal.tags.findIndex((t) => t.kind === "board")];
  const spends = w.updateTransforms.filter((t) => t.fieldPath.startsWith("tokens."));
  ok("the arsenal a battle used is spent, and nothing that isn't a token",
    spends.map((t) => t.fieldPath + t.increment.integerValue).join() === "tokens.bs_nuke-2,tokens.bs_torpedo-1");
}


