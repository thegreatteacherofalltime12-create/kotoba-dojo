import { verifyIdToken } from "./jwt.js";
import {
  prestigePlayer, recordMatch, readRatings, readWallet, topWallets,
  readFeed, postChat, readChat, postFeed, withdrawWallet, refundWallet, lastFirestoreError,
} from "./firestore.js";
import { makePuzzle, scoreSolve, cashReward, MAX_AWARD, LIMIT_MS, FAST_MS, FAST_MULTIPLIER } from "./puzzle.js";
import { STARTER_INDEX } from "./starter-puzzles.js";

export { DojoLobby } from "./lobby.js";
export { DojoDirectory } from "./directory.js";
export { BattleRoyale } from "./battle-lobby.js";
export { MineField } from "./mine-lobby.js";
export { BountyOffice } from "./bounty-office.js";
export { CasinoFloor } from "./casino-floor.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
const CODE_LENGTH = 5;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith("/api/")) {
      const res = await env.ASSETS.fetch(request);

      // The page and the version marker must never be answered from a cache.
      // Everything else can be, but if these two go stale the app reports a
      // build it isn't running and a deploy looks like it never happened —
      // which is exactly what it did.
      const live = path === "/" || path === "/index.html" || path === "/version.json";
      if (!live) return res;

      const fresh = new Response(res.body, res);
      fresh.headers.set("Cache-Control", "no-store, must-revalidate");
      fresh.headers.delete("ETag");
      return fresh;
    }

    if (path === "/api/dojo/new") return json({ code: newCode() });

    // The live board of open dojos. Signed-in players only — this lists who
    // is hosting right now, which isn't for anonymous passers-by.
    if (path === "/api/dojos") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      try {
        await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
      } catch {
        return json({ error: "Sign in first." }, 401);
      }
      const stub = env.DIRECTORY.get(env.DIRECTORY.idFromName("global"));
      const res = await stub.fetch("https://directory/list");
      return json(await res.json());
    }

    // The puzzle bank's clues are public; the answers stay in KV under a
    // different key and are never served here.
    // Best clear times per difficulty. Public: it's a scoreboard.
    // Says in plain terms whether ranked scoring is actually working. Without
    // this, a broken leaderboard is indistinguishable from an empty one.
    if (path === "/api/diag/ranked") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try {
        user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
      } catch {
        return json({ error: "Sign in first." }, 401);
      }

      const steps = [];
      steps.push({ step: "Secret present", ok: !!env.FIREBASE_SERVICE_ACCOUNT });
      steps.push({ step: "Project id set", ok: !!env.FIREBASE_PROJECT_ID, detail: env.FIREBASE_PROJECT_ID });

      const before = lastFirestoreError;
      const ratings = await readRatings(env, [user.uid]).catch(() => null);
      const readFailed = ratings === null || (lastFirestoreError && lastFirestoreError !== before);
      steps.push({
        step: "Read your rating",
        ok: !readFailed,
        detail: readFailed
          ? (lastFirestoreError || "could not reach Firestore")
          : `${ratings[user.uid] ?? 0} MMR on record`,
      });

      const wrote = await recordMatch(env, {
        code: "DIAG", roundNo: 0, puzzleId: "diagnostic", finishedAt: Date.now(),
        results: [{ uid: user.uid, name: user.name, score: 0, gain: 0, status: "diagnostic", elapsedMs: null }],
      }).catch(() => false);
      steps.push({ step: "Write a result", ok: wrote === true, detail: wrote ? "written" : lastFirestoreError });

      const ok = steps.every((x) => x.ok);
      return json({
        ok, steps,
        summary: ok
          ? "Ranked scoring is working. Scores from finished games are being saved."
          : `Ranked scoring is not working: ${lastFirestoreError || "see the failing step above"}`,
      });
    }

    // ── the maths arcade ────────────────────────────────────────────
    // Issued here, marked here, timed here. The answer never leaves.
    if (path === "/api/puzzle/new" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID); }
      catch { return json({ error: "Sign in first." }, 401); }

      const puzzle = makePuzzle();
      const id = crypto.randomUUID();
      await env.PUZZLES.put(
        `pz:${user.uid}:${id}`,
        JSON.stringify({ answer: puzzle.answer, at: Date.now() }),
        { expirationTtl: 120 }
      );
      return json({ id, text: puzzle.text, limitMs: LIMIT_MS, fastMs: FAST_MS, max: MAX_AWARD });
    }

    if (path === "/api/puzzle/solve" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID); }
      catch { return json({ error: "Sign in first." }, 401); }

      const body = await request.json().catch(() => ({}));
      const key = `pz:${user.uid}:${body.id}`;
      const held = await env.PUZZLES.get(key, "json");
      if (!held) return json({ error: "That puzzle has expired. Take another." }, 410);
      // Single use, whatever happens next: no second attempt on one clock.
      await env.PUZZLES.delete(key);

      const elapsedMs = Date.now() - held.at;
      const correct = Number(body.answer) === held.answer;
      if (!correct) return json({ correct: false, answer: held.answer, elapsedMs });

      const { award, fast, expired } = scoreSolve(elapsedMs);
      const cash = cashReward();

      if (award > 0) {
        ctx.waitUntil(
          recordMatch(env, {
            code: "ARCADE", roundNo: 0, puzzleId: "arcade",
            finishedAt: Date.now(),
            results: [{
              uid: user.uid, name: user.name, score: award, gain: award,
              status: "solved", elapsedMs,
            }],
          }).catch(() => {})
        );
      }

      // On the table first, banked to the wallet when the session ends
      // properly — the same route every other pound on the floor takes.
      ctx.waitUntil(
        env.FLOOR.get(env.FLOOR.idFromName("global")).fetch("https://floor/credit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: user.uid, name: user.name, cash, tokens: 1, mmr: award }),
        }).catch((e) => console.error(`[arcade] credit failed: ${e.message}`))
      );

      return json({
        correct: true, elapsedMs, mmr: award, fast, expired,
        cash, token: 1, multiplier: fast ? FAST_MULTIPLIER : 1,
      });
    }

    // Who currently wears the target, and the recent history of it moving.
    // Who carries the ribbon, and the week's rotation. Derived from the date,
    // so this answers the same on any machine whether or not the floor is awake.
    if (path === "/api/favourite") {
      const { HORSES, favouriteFor, favouriteEndsAt } = await import("./casino-core.js");
      const now = Date.now();
      const DAY = 86_400_000;
      const week = [];
      for (let d = 0; d < 7; d++) {
        const at = now + d * DAY;
        const id = favouriteFor(at);
        week.push({
          on: new Date(Math.floor(at / DAY) * DAY).toISOString().slice(0, 10),
          horse: HORSES.find((h) => h.id === id).name,
        });
      }
      return json({
        favourite: HORSES.find((h) => h.id === favouriteFor(now)).name,
        id: favouriteFor(now),
        changesAt: new Date(favouriteEndsAt(now)).toISOString(),
        week,
      });
    }

    // Everything that happened in the last day. Public: it is a scoreboard.
    if (path === "/api/feed") return json({ feed: await readFeed(env, 24) });

    if (path === "/api/chat" && request.method === "GET")
      return json({ chat: await readChat(env, 60) });

    // Posting is signed in, and always as yourself: the name on the line comes
    // from the verified token, never from the body.
    if (path === "/api/chat" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID); }
      catch { return json({ error: "Sign in first." }, 401); }
      const body = await request.json().catch(() => ({}));
      const ok = await postChat(env, { uid: user.uid, name: user.name, text: body.text });
      return json({ ok }, ok ? 200 : 400);
    }

    // An award, posted by whatever awards it. Kept open-ended on purpose so a
    // new award needs no new endpoint.
    if (path === "/api/feed/award" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      try { await verifyIdToken(token, env.FIREBASE_PROJECT_ID); }
      catch { return json({ error: "Sign in first." }, 401); }
      const body = await request.json().catch(() => ({}));
      const ok = await postFeed(env, {
        kind: "award", name: body.name, text: body.text, detail: body.detail,
      });
      return json({ ok }, ok ? 200 : 400);
    }

    // Your own banked total. Signed in, and only ever your own.
    if (path === "/api/wallet") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID); }
      catch { return json({ error: "Sign in first." }, 401); }
      return json({ wallet: await readWallet(env, user.uid) });
    }

    // Wallet to table. The money leaves the wallet first and is put straight
    // back if the floor can't take it, so it can never sit in neither place.
    if (path === "/api/wallet/withdraw" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID); }
      catch { return json({ error: "Sign in first." }, 401); }

      const body = await request.json().catch(() => ({}));
      if (!body.understood)
        return json({ error: "Tick the box to say you understand the risk." }, 400);

      const taken = await withdrawWallet(env, user.uid, body.amount, user.name);
      if (!taken.ok) return json({ error: taken.error }, 400);

      try {
        const res = await env.FLOOR.get(env.FLOOR.idFromName("global")).fetch("https://floor/credit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uid: user.uid, name: user.name, cash: taken.amount, tokens: 0, reason: "wallet",
          }),
        });
        if (!res.ok) throw new Error(`floor said ${res.status}`);
      } catch (err) {
        await refundWallet(env, user.uid, taken.amount, user.name);
        return json({ error: "The floor couldn't take it. Nothing was moved." }, 502);
      }

      return json({ ok: true, moved: taken.amount, wallet: taken.remaining });
    }

    // The showcase: names and totals, nothing else, so it needs no sign-in.
    if (path === "/api/wallets/top") {
      return json({ wallets: await topWallets(env, 10) });
    }

    if (path === "/api/bounty") {
      const stub = env.BOUNTY.get(env.BOUNTY.idFromName("global"));
      const res = await stub.fetch("https://bounty/current");
      return json(await res.json());
    }

    if (path === "/api/mines/scores") {
      const out = {};
      for (const level of ["beginner", "intermediate", "expert"]) {
        try { out[level] = (await env.PUZZLES.get(`scores:mines:${level}`, "json")) || []; }
        catch { out[level] = []; }
      }
      return json({ scores: out });
    }

    if (path === "/api/puzzles") {
      let index = null;
      try { index = await env.PUZZLES.get("index", "json"); } catch { /* no KV bound yet */ }
      const usable = Array.isArray(index) && index.length
        && index.every((p) => p && p.theme && p.difficulty);
      return json({ puzzles: usable ? index : STARTER_INDEX, source: usable ? "kv" : "built-in" });
    }

    // Prestige resets a rating, so it can only ever run server-side.
    if (path === "/api/prestige" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try {
        user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
      } catch {
        return json({ error: "Sign in first." }, 401);
      }
      const result = await prestigePlayer(env, user.uid, user.name);
      return json(result, result.ok ? 200 : 400);
    }

    // The casino floor is one shared room, so it has no code in its address.
    if (path === "/api/floor/ws") {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("Expected a WebSocket upgrade.", { status: 426 });
      let user;
      try {
        user = await verifyIdToken(url.searchParams.get("token"), env.FIREBASE_PROJECT_ID);
      } catch (err) {
        return new Response(`Sign-in rejected: ${err.message}`, { status: 401 });
      }
      const stub = env.FLOOR.get(env.FLOOR.idFromName("global"));
      const fwd = new Request(request);
      fwd.headers.set("X-Dojo-Uid", user.uid);
      fwd.headers.set("X-Dojo-Name", user.name);
      return stub.fetch(fwd);
    }

    // Battleship and Minesweeper both hand off the same way.
    const room = /^\/api\/(battle|mines)\/([A-Za-z0-9-]{3,16})\/ws$/.exec(path);
    if (room) {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("Expected a WebSocket upgrade.", { status: 426 });
      let user;
      try {
        user = await verifyIdToken(url.searchParams.get("token"), env.FIREBASE_PROJECT_ID);
      } catch (err) {
        return new Response(`Sign-in rejected: ${err.message}`, { status: 401 });
      }
      const code = room[2].toUpperCase();
      const ns = room[1] === "mines" ? env.MINES : env.BATTLE;
      const stub = ns.get(ns.idFromName(code));
      const fwd = new Request(request);
      fwd.headers.set("X-Dojo-Uid", user.uid);
      fwd.headers.set("X-Dojo-Name", user.name);
      fwd.headers.set("X-Dojo-Code", code);
      return stub.fetch(fwd);
    }

    // Which game does this code belong to? Codes come from one pool, so the
    // client has to ask before it knows which room to open.
    const find = /^\/api\/room\/([A-Za-z0-9-]{3,16})$/.exec(path);
    if (find) {
      const stub = env.DIRECTORY.get(env.DIRECTORY.idFromName("global"));
      const res = await stub.fetch(
        `https://directory/find?code=${encodeURIComponent(find[1].toUpperCase())}`
      );
      return json(await res.json());
    }

    const ws = /^\/api\/dojo\/([A-Za-z0-9-]{3,16})\/ws$/.exec(path);
    if (ws) {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("Expected a WebSocket upgrade.", { status: 426 });

      const token = url.searchParams.get("token");
      let user;
      try {
        user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
      } catch (err) {
        // 1008 would be tidier, but the upgrade hasn't happened yet.
        return new Response(`Sign-in rejected: ${err.message}`, { status: 401 });
      }

      const code = ws[1].toUpperCase();
      const id = env.DOJO.idFromName(code);
      const stub = env.DOJO.get(id);

      const forwarded = new Request(request);
      forwarded.headers.set("X-Dojo-Uid", user.uid);
      forwarded.headers.set("X-Dojo-Name", user.name);
      forwarded.headers.set("X-Dojo-Code", code);
      return stub.fetch(forwarded);
    }

    return json({ error: "No such endpoint." }, 404);
  },
};
