// Server-authoritative writes to Firestore.
//
// Anything a client writes about its own score is spoofable, so match history
// and the leaderboard are written here instead, from the Durable Object that
// actually timed the round. The Admin SDK doesn't run on Workers, so this
// mints an OAuth token from the service account by hand and talks to the
// Firestore REST API.
//
// If FIREBASE_SERVICE_ACCOUNT isn't set, every function here quietly no-ops
// and the game still works — you just lose ranked history.

import { tellCommons } from "./commons-notify.js";

let tokenCache = { token: null, expiresAt: 0 };

function pemToPkcs8(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function b64url(bytes) {
  let s = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Every failure here used to be silent, which meant a broken leaderboard
// looked exactly like a working one with no games played. It now says why.
export let lastFirestoreError = null;
const fail = (why) => { lastFirestoreError = why; console.error(`[firestore] ${why}`); return null; };

function account(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT)
    return fail("FIREBASE_SERVICE_ACCOUNT is not set");
  try {
    const sa = typeof env.FIREBASE_SERVICE_ACCOUNT === "string"
      ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
      : env.FIREBASE_SERVICE_ACCOUNT;
    if (!sa.client_email) return fail("the service account JSON has no client_email");
    if (!sa.private_key) return fail("the service account JSON has no private_key");
    return sa;
  } catch (err) {
    return fail(`the service account secret isn't valid JSON (${err.message})`);
  }
}

async function accessToken(env) {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt) return tokenCache.token;

  const sa = account(env);
  if (!sa) return null;

  const iat = Math.floor(now / 1000);
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  };
  const header = { alg: "RS256", typ: "JWT" };
  const enc = new TextEncoder();
  const unsigned =
    b64url(enc.encode(JSON.stringify(header))) + "." + b64url(enc.encode(JSON.stringify(claims)));

  let assertion;
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(sa.private_key.replace(/\\n/g, "\n")),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
    assertion = `${unsigned}.${b64url(sig)}`;
  } catch (err) {
    return fail(`the private key could not be read (${err.message}). Paste the whole JSON file, unedited.`);
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) return fail(`Google refused the service account (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  if (!body.access_token) return fail("Google returned no access token");
  tokenCache = { token: body.access_token, expiresAt: now + (body.expires_in - 300) * 1000 };
  lastFirestoreError = null;
  return tokenCache.token;
}

const S = (v) => ({ stringValue: String(v) });
const I = (v) => ({ integerValue: String(Math.round(v)) });

/**
 * The numbers a commit hands back for one write's transforms, in the order
 * the transforms were given. Null when any of them is missing or not a
 * number — the caller then tells the room it is dirty rather than pushing a
 * guess onto every home screen.
 */
export function transformNumbers(body, index, count) {
  const out = body?.writeResults?.[index]?.transformResults;
  if (!Array.isArray(out) || out.length < count) return null;
  const nums = out.slice(0, count).map((v) => Number(v?.integerValue ?? v?.doubleValue));
  return nums.every((n) => Number.isFinite(n)) ? nums : null;
}

/** One leaderboard document as the room keeps it. */
function boardRow(doc) {
  const f = doc.fields || {};
  const n = (k) => Number(f[k]?.integerValue || 0);
  return {
    uid: doc.name.split("/").pop(),
    name: f.name?.stringValue || "Someone",
    totalPoints: n("totalPoints"),
    roundsPlayed: n("roundsPlayed"),
    bestScore: n("bestScore"),
    lastRate: n("lastRate"),
    prestige: n("prestige"),
    insignia: f.insignia?.stringValue || "",
  };
}

function base(env) {
  return `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

/**
 * Current MMR for a set of players, so the round can be scored against real
 * ratings rather than whatever a client claims. Missing players read as 0.
 */
export async function readRatings(env, uids) {
  const out = Object.fromEntries(uids.map((u) => [u, 0]));
  const token = await accessToken(env);
  if (!token || !uids.length) return out;

  const res = await fetch(
    `https://firestore.googleapis.com/v1/${base(env)}:batchGet`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ documents: uids.map((u) => `${base(env)}/leaderboard/${u}`) }),
    }
  );
  if (!res.ok) { fail(`Firestore refused the ratings read (${res.status})`); return out; }

  for (const row of await res.json()) {
    if (!row.found) continue;
    const uid = row.found.name.split("/").pop();
    out[uid] = Number(row.found.fields?.totalPoints?.integerValue || 0);
  }
  return out;
}

/**
 * Prestige: spending MMR for rank, and only ever driven from here, because a
 * client that could reset its own MMR could also set it to anything else.
 *
 * The cost is taken off the total rather than wiping it, so what a player
 * earned above the price stays theirs and carries toward the next one.
 */
export async function prestigePlayer(env, uid, name) {
  const token = await accessToken(env);
  if (!token) return { ok: false, error: "Ranked scoring isn't switched on for this arena yet." };

  const path = `${base(env)}/leaderboard/${uid}`;
  const read = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const doc = read.ok ? await read.json() : null;
  const mmr = Number(doc?.fields?.totalPoints?.integerValue || 0);
  const already = Number(doc?.fields?.prestige?.integerValue || 0);

  const { canPrestige, prestigeInsignia, PRESTIGE_COST } = await import("./mmr.js");
  if (!canPrestige(mmr)) {
    return {
      ok: false,
      error: `Prestige costs ${PRESTIGE_COST.toLocaleString()} MMR. You're at ${mmr.toLocaleString()}.`,
    };
  }

  const rank = prestigeInsignia(already + 1);
  // One write: the fields and the increments land on the document together,
  // which is one write billed rather than two.
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{
        update: {
          name: path,
          fields: { uid: S(uid), name: S(name || "Unknown"), insignia: S(rank) },
        },
        updateMask: { fieldPaths: ["uid", "name", "insignia"] },
        updateTransforms: [
          // Negative increments are how Firestore spends a balance.
          { fieldPath: "totalPoints", increment: I(-PRESTIGE_COST) },
          { fieldPath: "prestige", increment: I(1) },
        ],
      }],
    }),
  });
  if (!res.ok) return { ok: false, error: "Firestore refused the write." };

  const got = transformNumbers(await res.json().catch(() => null), 0, 2);
  await (got
    ? tellCommons(env, "/board/upsert", {
      rows: [{ uid, name: name || "Unknown", insignia: rank, totalPoints: got[0], prestige: got[1] }],
    })
    : tellCommons(env, "/dirty", {}));

  postFeed(env, {
    kind: "prestige", name: name || "Someone",
    text: `${name || "Someone"} was promoted to ${rank}`,
    detail: `Prestige ${already + 1} \u00b7 ${PRESTIGE_COST.toLocaleString()} MMR spent`,
  }).catch(() => {});

  return { ok: true, insignia: rank, spent: PRESTIGE_COST, remaining: mmr - PRESTIGE_COST };
}

/**
 * The top of the leaderboard by MMR. The room reads this once to fill its
 * copy; the bounty office reads the room. Null when the query was refused,
 * so a refusal is never mistaken for an empty board.
 */
export async function topPlayers(env, limit = 10) {
  return boardQuery(env, {
    orderBy: [{ field: { fieldPath: "totalPoints" }, direction: "DESCENDING" }],
    limit,
  }, "top-player");
}

/** Everyone holding prestige, highest first — the other half of the strip. */
export async function topOfficers(env, limit = 60) {
  return boardQuery(env, {
    where: {
      fieldFilter: { field: { fieldPath: "prestige" }, op: "GREATER_THAN", value: I(0) },
    },
    orderBy: [{ field: { fieldPath: "prestige" }, direction: "DESCENDING" }],
    limit,
  }, "officer");
}

async function boardQuery(env, structuredQuery, what) {
  const token = await accessToken(env);
  if (!token) return null;
  const res = await fetch(
    `https://firestore.googleapis.com/v1/${base(env)}:runQuery`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: { from: [{ collectionId: "leaderboard" }], ...structuredQuery },
      }),
    }
  );
  if (!res.ok) { fail(`Firestore refused the ${what} query (${res.status})`); return null; }
  const rows = await res.json();
  return rows.filter((r) => r.document).map((r) => boardRow(r.document));
}

/**
 * Banks casino winnings into one player's own wallet.
 *
 * Every player has their own document, keyed by their uid, and this only ever
 * touches that one. There is no shared pot to draw from — the increment is
 * applied to their balance and nobody else's.
 */
export async function bankWallet(env, uid, amount, name = "Player") {
  const token = await accessToken(env);
  if (!token) return !!fail("Ranked scoring isn't switched on, so wallets can't be written.");
  if (!(amount > 0)) return false;

  const path = `${base(env)}/users/${uid}`;
  // The same amount lands twice, in one commit: on the player's own document,
  // which stays private, and on a small public row carrying nothing but a name
  // and a total. That row is what the showcase reads, so no one has to be able
  // to see anyone else's account to see who is up.
  const board = `${base(env)}/wallets/${uid}`;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: walletWrites(path, board, uid, name, amount) }),
  });
  if (!res.ok) return !!fail(`Firestore refused the wallet write (${res.status}): ${(await res.text()).slice(0, 200)}`);
  console.log(`[firestore] banked ${amount} to ${uid}`);
  await tellWallet(env, uid, name, await res.json().catch(() => null));
  return true;
}

/**
 * The two wallet writes, as one commit. The private document takes its
 * increments alone, as it always did — nothing else on it is touched. The
 * public row takes its fields and its increment in a single write, so a bank
 * or a withdrawal is two writes billed rather than three.
 *
 * A withdrawal knows the exact figure it leaves behind and writes the public
 * row to that rather than nudging it. The row can be off: the private wallet
 * is older than the public rows, so a balance banked before they existed was
 * never on the board, and a withdrawal against it drove the row below zero.
 */
export function walletWrites(path, board, uid, name, delta, settle = null) {
  const who = { uid: S(uid), name: S(name || "Player") };
  return [
    {
      transform: {
        document: path,
        fieldTransforms: [
          { fieldPath: "casino.wallet", increment: I(delta) },
          ...(delta > 0 ? [{ fieldPath: "casino.banked", increment: I(delta) }] : []),
        ],
      },
    },
    settle == null
      ? {
        update: { name: board, fields: who },
        updateMask: { fieldPaths: ["uid", "name"] },
        updateTransforms: [{ fieldPath: "wallet", increment: I(delta) }],
      }
      : {
        update: { name: board, fields: { ...who, wallet: I(settle) } },
        updateMask: { fieldPaths: ["uid", "name", "wallet"] },
      },
  ];
}

/** What the commit says the two totals are now. */
export function walletTotals(body, settle = null) {
  const mine = transformNumbers(body, 0, 1);
  if (!mine) return null;
  const pub = settle == null ? transformNumbers(body, 1, 1) : [settle];
  return pub ? { mine: mine[0], wallet: pub[0] } : null;
}

/** Sets the public row to the private figure. One write; only when they differ. */
export async function alignWallet(env, uid, name, wallet) {
  const token = await accessToken(env);
  if (!token) return false;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{
        update: {
          name: `${base(env)}/wallets/${uid}`,
          fields: { uid: S(uid), name: S(name || "Player"), wallet: I(wallet) },
        },
        updateMask: { fieldPaths: ["uid", "name", "wallet"] },
      }],
    }),
  });
  if (!res.ok) return !!fail(`Firestore refused to align a wallet (${res.status})`);
  console.log(`[firestore] aligned the public wallet of ${uid} to ${wallet}`);
  return true;
}

/**
 * The totals, told to the room. The public row is meant to equal the
 * private one; if the commit shows them apart, the row is put right first.
 */
async function tellWallet(env, uid, name, body, settle = null) {
  const got = walletTotals(body, settle);
  if (!got) return tellCommons(env, "/dirty", {});
  if (got.wallet !== got.mine && await alignWallet(env, uid, name, got.mine)) got.wallet = got.mine;
  return tellCommons(env, "/wallets/upsert", { uid, name: name || "Player", wallet: got.wallet, mine: got.mine });
}

/**
 * A single row in one player's own history.
 *
 * The casino needs this without recordMatch, because recordMatch also moves
 * the leaderboard and the casino pays no MMR. A session on the floor is a
 * game played; it is not a rung on the ladder.
 */
export async function writeHistory(env, uid, row) {
  const token = await accessToken(env);
  if (!token) return false;
  const id = `${row.game}-${row.finishedAt}`;
  const fields = {
    at: { timestampValue: new Date(row.finishedAt).toISOString() },
    game: S(row.game),
    mode: S(row.mode || "match"),
    solo: { booleanValue: !!row.solo },
    score: I(row.score || 0),
    gain: I(row.gain || 0),
    placement: row.placement == null ? { nullValue: null } : I(row.placement),
    field: I(row.field || 1),
    elapsedMs: row.elapsedMs == null ? { nullValue: null } : I(row.elapsedMs),
    solved: { nullValue: null },
    status: S(row.status || "played"),
    belt: S(""),
  };
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{ update: { name: `${base(env)}/users/${uid}/history/${id}`, fields } }],
    }),
  });
  if (!res.ok) return !!fail(`Firestore refused a history row (${res.status})`);
  return true;
}

/* ── the scroll library ──────────────────────────────────────────────────
 *
 * Scrolls used to live under their author and nobody else could reach them.
 * They are published now, so a scroll is written once and anyone can open a
 * dojo on it — which also means the grid has to be fetched by whoever runs the
 * round rather than sent up by their browser.
 */

export async function publishScroll(env, { uid, name, puzzle }) {
  const token = await accessToken(env);
  if (!token) return null;
  const id = `${uid.slice(0, 8)}-${Date.now().toString(36)}`;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{
        update: {
          name: `${base(env)}/scrolls/${id}`,
          fields: {
            id: S(id),
            uid: S(uid),
            author: S(name || "Someone"),
            title: S(puzzle.title || "Untitled scroll"),
            at: { timestampValue: new Date().toISOString() },
            // The grid itself, kept whole so the round can be built from it.
            body: S(JSON.stringify(puzzle)),
            plays: I(0), wins: I(0), losses: I(0),
          },
        },
      }],
    }),
  });
  if (!res.ok) return !!fail(`Firestore refused a scroll (${res.status})`) && null;
  return id;
}

const scrollRow = (doc) => {
  const f = doc.fields || {};
  return {
    id: f.id?.stringValue || doc.name.split("/").pop(),
    uid: f.uid?.stringValue || "",
    author: f.author?.stringValue || "Someone",
    title: f.title?.stringValue || "Untitled scroll",
    at: f.at?.timestampValue || null,
    plays: Number(f.plays?.integerValue || 0),
    wins: Number(f.wins?.integerValue || 0),
    losses: Number(f.losses?.integerValue || 0),
  };
};

/** Every published scroll, newest first. Bodies are left behind. */
export async function listScrolls(env, limit = 60) {
  const token = await accessToken(env);
  if (!token) return [];
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "scrolls" }],
        orderBy: [{ field: { fieldPath: "at" }, direction: "DESCENDING" }],
        limit,
      },
    }),
  });
  if (!res.ok) { fail(`Firestore refused the scroll list (${res.status})`); return []; }
  const rows = await res.json();
  return rows.filter((r) => r.document).map((r) => scrollRow(r.document));
}

/** One scroll, grid and all, for the round that is about to run on it. */
export async function getScroll(env, id) {
  const token = await accessToken(env);
  if (!token) return null;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}/scrolls/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const doc = await res.json();
  try {
    const meta = scrollRow(doc);
    return { ...meta, puzzle: JSON.parse(doc.fields?.body?.stringValue || "null") };
  } catch { return null; }
}

/**
 * Adds a finished round to a scroll's record.
 *
 * One play per player who sat the round, counted as a win if they completed
 * the grid and a loss if they did not — which is what the author wants to
 * know: not how popular it is, but how hard it turned out to be.
 */
export async function bumpScroll(env, id, { plays = 0, wins = 0, losses = 0 }) {
  const token = await accessToken(env);
  if (!token || !id || !plays) return false;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{
        transform: {
          document: `${base(env)}/scrolls/${id}`,
          fieldTransforms: [
            { fieldPath: "plays", increment: I(plays) },
            { fieldPath: "wins", increment: I(wins) },
            { fieldPath: "losses", increment: I(losses) },
          ],
        },
      }],
    }),
  });
  return res.ok;
}

/* ── the commons: one feed, one chat ─────────────────────────────────── */

/**
 * Posts a line to the arena feed.
 *
 * Anything worth announcing calls this: a finished game, a prestige, an award.
 * Adding a new kind of event later means one more call here and nothing else,
 * which is the point of having a feed rather than deriving one from matches.
 *
 * @param {object} entry
 * @param {string} entry.kind  "game" | "prestige" | "award" | anything later
 * @param {string} entry.text  the line as it should read
 * @param {string} [entry.name]  who it concerns
 * @param {string} [entry.detail]  a smaller second line
 */
export async function postFeed(env, entry) {
  const token = await accessToken(env);
  if (!token) return false;
  const at = entry.at || Date.now();
  const id = `${at}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{
        update: {
          name: `${base(env)}/feed/${id}`,
          fields: {
            at: { timestampValue: new Date(at).toISOString() },
            kind: S(entry.kind || "note"),
            text: S(entry.text || ""),
            name: S(entry.name || ""),
            detail: S(entry.detail || ""),
          },
        },
      }],
    }),
  });
  if (!res.ok) return !!fail(`Firestore refused a feed row (${res.status})`);
  await tellCommons(env, "/feed/append", {
    id, at: new Date(at).toISOString(), kind: entry.kind || "note",
    text: entry.text || "", name: entry.name || "", detail: entry.detail || "",
  });
  return true;
}

/** Everything that happened in the last day, newest first. */
export async function readFeed(env, hours = 24) {
  const token = await accessToken(env);
  if (!token) return null;
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "feed" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "at" }, op: "GREATER_THAN",
            value: { timestampValue: since },
          },
        },
        orderBy: [{ field: { fieldPath: "at" }, direction: "DESCENDING" }],
        limit: 80,
      },
    }),
  });
  if (!res.ok) { fail(`Firestore refused the feed (${res.status})`); return null; }
  const rows = await res.json();
  return rows.filter((r) => r.document).map((r) => ({
    id: r.document.name.split("/").pop(),
    at: r.document.fields?.at?.timestampValue || null,
    kind: r.document.fields?.kind?.stringValue || "note",
    text: r.document.fields?.text?.stringValue || "",
    name: r.document.fields?.name?.stringValue || "",
    detail: r.document.fields?.detail?.stringValue || "",
  }));
}

/**
 * Chat goes through here rather than straight from the browser, so a client
 * can neither post as somebody else nor be stopped by security rules.
 */
export async function postChat(env, { uid, name, text }) {
  const token = await accessToken(env);
  if (!token) return false;
  const clean = String(text || "").slice(0, 300).trim();
  if (!clean) return false;
  const at = Date.now();
  const id = `${at}-${uid.slice(0, 8)}`;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{
        update: {
          name: `${base(env)}/chat/${id}`,
          fields: {
            at: { timestampValue: new Date(at).toISOString() },
            uid: S(uid), name: S(name || "Someone"), text: S(clean),
          },
        },
      }],
    }),
  });
  if (!res.ok) return !!fail(`Firestore refused a chat line (${res.status})`);
  await tellCommons(env, "/chat/append", {
    id, at: new Date(at).toISOString(), uid, name: name || "Someone", text: clean,
  });
  return true;
}

export async function readChat(env, limit = 60) {
  const token = await accessToken(env);
  if (!token) return null;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "chat" }],
        orderBy: [{ field: { fieldPath: "at" }, direction: "DESCENDING" }],
        limit,
      },
    }),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.filter((r) => r.document).map((r) => ({
    id: r.document.name.split("/").pop(),
    at: r.document.fields?.at?.timestampValue || null,
    uid: r.document.fields?.uid?.stringValue || "",
    name: r.document.fields?.name?.stringValue || "Someone",
    text: r.document.fields?.text?.stringValue || "",
  })).reverse();
}

/**
 * Moves money the other way: out of the wallet and onto the table.
 *
 * Read first, then decrement, so a request for more than is there is refused
 * rather than driving the balance negative. The public showcase row moves by
 * the same amount in the same commit, or the board would show money that has
 * already gone back into play.
 */
export async function withdrawWallet(env, uid, amount, name = "Player") {
  const token = await accessToken(env);
  if (!token) return { ok: false, error: "Wallets aren't switched on for this arena." };

  const want = Math.max(0, Math.round(Number(amount) || 0));
  if (!want) return { ok: false, error: "Choose an amount first." };

  // Read live, always: this is the overdraft check, and the room's copy is
  // for showing a figure, not for moving money on.
  const held = (await readWallet(env, uid)) ?? 0;
  if (want > held) {
    return { ok: false, error: `Your wallet holds $${held.toLocaleString()}.` };
  }

  const path = `${base(env)}/users/${uid}`;
  const board = `${base(env)}/wallets/${uid}`;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: walletWrites(path, board, uid, name, -want, held - want) }),
  });
  if (!res.ok) return { ok: false, error: "Firestore refused the withdrawal." };
  await tellWallet(env, uid, name, await res.json().catch(() => null), held - want);
  return { ok: true, amount: want, remaining: held - want };
}

/** Puts a refused withdrawal back, when the floor couldn't take the money. */
export async function refundWallet(env, uid, amount, name) {
  return bankWallet(env, uid, amount, name);
}

/** One player's banked total, for their own eyes. */
export async function readWallet(env, uid) {
  const token = await accessToken(env);
  if (!token) return null;
  const res = await fetch(
    `https://firestore.googleapis.com/v1/${base(env)}/users/${uid}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 404) return 0;
  if (!res.ok) return null;
  const doc = await res.json();
  return Number(doc.fields?.casino?.mapValue?.fields?.wallet?.integerValue || 0);
}

/**
 * The biggest wallets on the floor, for the showcase.
 *
 * Reads the public rows, which hold a name and a total and nothing else, so
 * this can never expose anyone's account.
 */
export async function topWallets(env, limit = 10) {
  const token = await accessToken(env);
  if (!token) return null;
  const res = await fetch(
    `https://firestore.googleapis.com/v1/${base(env)}:runQuery`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "wallets" }],
          orderBy: [{ field: { fieldPath: "wallet" }, direction: "DESCENDING" }],
          limit,
        },
      }),
    }
  );
  if (!res.ok) { fail(`Firestore refused the wallet board (${res.status})`); return null; }
  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => ({
      uid: r.document.name.split("/").pop(),
      name: r.document.fields?.name?.stringValue || "Someone",
      wallet: Number(r.document.fields?.wallet?.integerValue || 0),
    }));
}

export async function recordMatch(env, match) {
  const token = await accessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) return !!fail("FIREBASE_PROJECT_ID is not set");
  if (!token) return false;

  const base = `projects/${projectId}/databases/(default)/documents`;
  const matchId = `${match.code}-${match.roundNo}-${match.finishedAt}`;

  // The arcade and the diagnostic are deliberately absent from the logs —
  // one would flood them a sum at a time, the other isn't a game. Nothing
  // reads the match record itself, so those two skip it as well.
  const logged = match.code !== "ARCADE" && match.code !== "DIAG";
  const { writes, tags } = matchWrites(base, matchId, match, logged);

  const res = await fetch(
    `https://firestore.googleapis.com/v1/${base}:commit`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ writes }),
    }
  );
  if (!res.ok) return !!fail(`Firestore refused the write (${res.status}): ${(await res.text()).slice(0, 300)}`);
  lastFirestoreError = null;
  console.log(`[firestore] recorded ${match.results.length} results for ${match.puzzleId}`);

  // The room hears the totals the commit came back with — the exact numbers
  // on the board now, not what this side thinks they should be.
  const rows = boardRowsFromCommit(tags, await res.json().catch(() => null));
  await (rows ? tellCommons(env, "/board/upsert", { rows }) : tellCommons(env, "/dirty", {}));

  // The feed hears about it, unless it was the arcade or a diagnostic.
  if (logged && match.results.length) {
    // Every game that reaches here, by name. An id that is not listed is
    // announced as itself rather than as some other game: a fallback to
    // "Word-Cross" is how every round of golf read as a crossword.
    const names = {
      crossword: "Word-Cross", battleship: "Battleship", minesweeper: "Minesweeper",
      links: "Multiverse Golf", casino: "Casino",
    };
    const game = names[match.game] || String(match.game || "a game");
    const ranked = [...match.results].sort((a, b) => (b.score || 0) - (a.score || 0));
    const winner = ranked[0];
    const field = match.results.length;
    const gain = winner.gain ?? winner.score ?? 0;

    // Who else was in it. A feed line that names only the winner answers
    // "who won" and not "who played", and the second is the one people ask.
    const others = ranked.slice(1).map((r) => r.name).filter(Boolean);
    const shown = others.slice(0, 4);
    const rest = others.length - shown.length;
    const against = shown.length
      ? ` \u00b7 vs ${shown.join(", ")}${rest > 0 ? ` +${rest} more` : ""}`
      : "";

    // A round where nobody scored is a round nobody played — somebody opened a
    // dojo and left. Announcing "won, 0 points, 0 MMR" reads like a bug and
    // buries the rounds that did happen, so it isn't announced at all.
    if ((winner.score || 0) > 0 || gain > 0) {
      postFeed(env, {
        kind: "game", at: match.finishedAt, name: winner.name,
        // Solo has nobody to beat, so it is finished rather than won.
        text: field > 1 ? `${winner.name} won ${game}` : `${winner.name} finished ${game}`,
        detail: field > 1
          ? `${winner.score} points \u00b7 +${gain} MMR${against}`
          : `${winner.score} points \u00b7 +${gain} MMR \u00b7 solo`,
      }).catch(() => {});
    }
  }
  return true;
}

/**
 * Every write a finished match makes, each carrying a tag that says what it
 * is. The commit's results come back in the same order, and the tags are how
 * the leaderboard totals are found in them — by name, never by counting.
 *
 * A player's leaderboard row is one write: the fields and the increments
 * together, rather than a transform and an update billed separately.
 */
export function matchWrites(base, matchId, match, logged) {
  const writes = [];
  const tags = [];
  const field = match.results.length;
  const at = { timestampValue: new Date(match.finishedAt).toISOString() };

  if (logged) {
    writes.push({
      update: {
        name: `${base}/matches/${matchId}`,
        fields: {
          dojoCode: S(match.code),
          puzzleId: S(match.puzzleId),
          roundNo: I(match.roundNo),
          finishedAt: at,
          results: {
            arrayValue: {
              values: match.results.map((r) => ({
                mapValue: {
                  fields: {
                    uid: S(r.uid),
                    name: S(r.name),
                    score: I(r.score),
                    gain: I(r.gain ?? r.score),
                    status: S(r.status),
                    elapsedMs: r.elapsedMs == null ? { nullValue: null } : I(r.elapsedMs),
                  },
                },
              })),
            },
          },
        },
      },
    });
    tags.push({ kind: "match" });

    // The player's own log. Written here rather than from the browser: the
    // client write was silently swallowed by a catch, and three of the four
    // games never wrote one at all. The document id is the match id, so a
    // retry updates the row instead of doubling it.
    for (const r of match.results) {
      writes.push({
        update: {
          name: `${base}/users/${r.uid}/history/${matchId}`,
          fields: {
            at,
            game: S(match.game || "crossword"),
            mode: S(match.mode || "match"),
            solo: { booleanValue: field === 1 },
            score: I(r.score),
            gain: I(r.gain ?? r.score),
            placement: r.placement == null ? { nullValue: null } : I(r.placement),
            field: I(field),
            elapsedMs: r.elapsedMs == null ? { nullValue: null } : I(r.elapsedMs),
            solved: r.solved == null ? { nullValue: null } : I(r.solved),
            status: S(r.status),
            belt: S(r.belt || ""),
          },
        },
      });
      tags.push({ kind: "history", uid: r.uid });
    }
  }

  for (const r of match.results) {
    writes.push({
      update: {
        name: `${base}/leaderboard/${r.uid}`,
        fields: r.rate
          ? { uid: S(r.uid), name: S(r.name), lastRate: I(r.rate) }
          : { uid: S(r.uid), name: S(r.name) },
      },
      updateMask: { fieldPaths: r.rate ? ["uid", "name", "lastRate"] : ["uid", "name"] },
      updateTransforms: [
        { fieldPath: "totalPoints", increment: I(r.gain ?? r.score) },
        { fieldPath: "roundsPlayed", increment: I(1) },
        { fieldPath: "bestScore", maximum: I(r.score) },
      ],
    });
    tags.push({ kind: "board", uid: r.uid, name: r.name, rate: r.rate || null });
  }
  return { writes, tags };
}

/**
 * The board rows a commit produced, read from its results by tag. Null if
 * any number is missing, so the caller can say the room is dirty instead.
 */
export function boardRowsFromCommit(tags, body) {
  const rows = [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.kind !== "board") continue;
    const got = transformNumbers(body, i, 3);
    if (!got) return null;
    rows.push({
      uid: t.uid, name: t.name,
      totalPoints: got[0], roundsPlayed: got[1], bestScore: got[2],
      ...(t.rate ? { lastRate: t.rate } : {}),
    });
  }
  return rows;
}
