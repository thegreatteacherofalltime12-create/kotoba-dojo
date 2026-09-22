import { verifyIdToken } from "./jwt.js";
import { membership, redeem, recover, listKeys, revokeKey, adminUnlock, makePass, claimPass, passState, cleanPass } from "./access.js";
import { moderate } from "./moderation.js";
import {
  prestigePlayer, retirePlayer, recordMatch, readRatings, saveCosmetics, strikePlayer, clearStrikes,
  buyToken, TOKEN_PRICE, TOKEN_GAMES,
  postChat, postFeed, withdrawWallet, refundWallet,
  publishScroll, listScrolls, lastFirestoreError,
} from "./firestore.js";
import { makePuzzle, scoreSolve, cashReward, MAX_AWARD, LIMIT_MS, FAST_MS, FAST_MULTIPLIER } from "./puzzle.js";
import { STARTER_INDEX } from "./starter-puzzles.js";

export { DojoLobby } from "./lobby.js";
export { DojoDirectory } from "./directory.js";
export { BattleRoyale } from "./battle-lobby.js";
export { MineField } from "./mine-lobby.js";
export { LinksCourse } from "./links-course.js";
export { BountyOffice } from "./bounty-office.js";
export { CasinoFloor } from "./casino-floor.js";
export { Commons } from "./commons.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
const CODE_LENGTH = 5;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// The reading room: one object that holds what every home screen polls.
// Chat, feed, rankings and the wallet board are answered from its memory,
// so a poll costs Firestore nothing.
const commons = (env) => env.COMMONS.get(env.COMMONS.idFromName("global"));
const fromCommons = (env, path) => commons(env).fetch(`https://commons${path}`);
const toCommons = (env, path, body) => commons(env).fetch(`https://commons${path}`, { method: "POST", body: JSON.stringify(body || {}) });

// Barred players are turned away at the door: no chat, no room.
async function barred(env, uid) {
  try { return await (await fromCommons(env, `/banned?uid=${encodeURIComponent(uid)}`)).json(); }
  catch { return { banned: false }; }
}
/**
 * A verified token whose account is through the gate. A locked account —
 * no key yet, or a revoked one — is refused like a bad token; the client
 * already holds it at the key screen, this is the backstop.
 */
async function verifyMember(token, env) {
  const user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
  const m = await membership(env, user);
  if (!m.unlocked) throw Object.assign(new Error("no key"), { locked: true });
  return user;
}

// Names map to synthetic addresses on the client; a pin reset by key needs
// the same mapping here.
const NAME_DOMAIN = "kotoba-dojo.local";
const addressFor = (name) => `${String(name).toLowerCase()}@${NAME_DOMAIN}`;
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

const isAdmin = (env, uid) => String(env.ADMIN_UIDS || "").split(",").map((x) => x.trim()).includes(uid);

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

      // Nothing that changes on a deploy may be answered from a cache without
      // checking first. The page and the version marker are never stored at
      // all; code and styles may be kept but must be revalidated every time,
      // so a deploy is never invisible. Images and fonts cache normally —
      // they are the reason not to blanket no-store the lot.
      const never = path === "/" || path === "/index.html" || path === "/version.json";
      const revalidate = /\.(js|mjs|css|webmanifest)$/i.test(path);
      if (!never && !revalidate) return res;

      const fresh = new Response(res.body, res);
      fresh.headers.set("Cache-Control", never ? "no-store, must-revalidate" : "no-cache");
      if (never) fresh.headers.delete("ETag");
      return fresh;
    }

    if (path === "/api/dojo/new") return json({ code: newCode() });

    // The live board of open dojos. Signed-in players only — this lists who
    // is hosting right now, which isn't for anonymous passers-by.
    if (path === "/api/dojos") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      try {
        await verifyMember(token, env);
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
        user = await verifyMember(token, env);
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
      try { user = await verifyMember(token, env); }
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
      try { user = await verifyMember(token, env); }
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

      const solved = scoreSolve(elapsedMs);
      const fast = solved.fast;
      const expired = solved.expired;
      // Flashcards and Extra Credit live on the floor, because that is where
      // the session is. Asking spends them.
      let perks = { cash: 1, fullMmr: false };
      try {
        const res = await env.FLOOR.get(env.FLOOR.idFromName("global")).fetch("https://floor/perks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: user.uid }),
        });
        if (res.ok) perks = await res.json();
      } catch { /* the arcade pays its plain rate */ }
      const award = perks.fullMmr ? MAX_AWARD : solved.award;
      const cash = cashReward() * (perks.cash || 1);

      if (award > 0) {
        ctx.waitUntil(
          recordMatch(env, {
            code: "ARCADE", roundNo: 0, puzzleId: "arcade",
            finishedAt: Date.now(),
            results: [{
              uid: user.uid, name: user.name, score: award, gain: award,
              status: "solved", elapsedMs,
              // Extra Credit pays full marks whatever the clock said, so the
              // round it came from is a token-assisted one. Flashcards only
              // doubles the cash, which no record board reads.
              ...(perks.fullMmr ? { assisted: true } : {}),
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
        perks: { cash: perks.cash || 1, fullMmr: !!perks.fullMmr },
      });
    }

    // Who currently wears the target, and the recent history of it moving.
    // The courses on offer. Names and cards only — the words stay on the server.
    if (path === "/api/links/courses") {
      const { COURSES, DIFF } = await import("./links.js");
      return json({
        courses: COURSES.map((c) => ({
          id: c.id, name: c.name, sub: c.sub, loc: c.loc, ico: c.ico,
          pars: c.pars, yards: c.yards, names: c.names,
          par: c.pars.reduce((a, b) => a + b, 0),
        })),
        tees: Object.entries(DIFF).map(([id, d]) => ({ id, label: d.label, words: d.words, mult: d.mult })),
      });
    }

    // Who carries the ribbon, and the week's rotation. Derived from the date,
    // so this answers the same on any machine whether or not the floor is awake.
    if (path === "/api/favourite") {
      const { HORSES, favouriteFor, favouriteEndsAt } = await import("./casino-core.js");
      const now = Date.now();
      const DAY = 86_400_000;
      // The next seven spells, which is a full cycle of the rotation.
      const week = [];
      for (let k = 0; k < 7; k++) {
        const at = now + k * (DAY / 2);
        const id = favouriteFor(at);
        week.push({
          from: new Date(Math.floor(at / (DAY / 2)) * (DAY / 2)).toISOString().slice(0, 16) + "Z",
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

    // Every published scroll. Titles, authors and how they've been getting on —
    // never the grid, which would hand out the answers.
    if (path === "/api/scrolls" && request.method === "GET")
      return json({ scrolls: await listScrolls(env) });

    // Writing one publishes it. The grid is checked here rather than taken on
    // trust, so a malformed scroll can never reach anybody else's dojo.
    if (path === "/api/scrolls" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyMember(token, env); }
      catch { return json({ error: "Sign in first." }, 401); }

      const body = await request.json().catch(() => ({}));
      const { validatePuzzle } = await import("./validate.js");
      const check = validatePuzzle(body.puzzle);
      if (!check.ok) return json({ error: check.error }, 400);

      const id = await publishScroll(env, { uid: user.uid, name: user.name, puzzle: check.puzzle });
      return id ? json({ ok: true, id }) : json({ error: "That couldn't be published." }, 500);
    }

    // Everything that happened in the last day. Public: it is a scoreboard.
    if (path === "/api/feed") return fromCommons(env, "/feed");

    if (path === "/api/chat" && request.method === "GET") return fromCommons(env, "/chat");

    // The record books. Public: names and figures, like the feed.
    if (path === "/api/records") return fromCommons(env, "/records");

    // Where you stand with the arena: barred or not, admin or not.
    if (path === "/api/me") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID); }
      catch { return json({ error: "Sign in first." }, 401); }
      const bar = await barred(env, user.uid);
      const m = await membership(env, user);
      return json({ ...bar, admin: isAdmin(env, user.uid), unlocked: !!m.unlocked, via: m.via || null, order: m.order || null, reason: m.reason || null, unknown: !!m.unknown, etsy: env.ETSY_URL || "" });
    }

    // The gate's public face: where a key comes from.
    if (path === "/api/config") return json({ etsy: env.ETSY_URL || "" });

    // Where a free pass stands. Public, and it names nobody: a link that has
    // been used says so without anyone having to register to find out.
    if (path === "/api/pass") {
      const out = await passState(env, url.searchParams.get("code"));
      return json({ ...out, etsy: env.ETSY_URL || "" });
    }

    // Claiming one. Signed in, because a pass opens an account.
    if (path === "/api/claim" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID); }
      catch { return json({ error: "Sign in first." }, 401); }
      const body = await request.json().catch(() => ({}));
      const result = await claimPass(env, user, body.code);
      return json(result, result.ok ? 200 : 400);
    }

    // An Etsy order number, locked to this account.
    if (path === "/api/redeem" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID); }
      catch { return json({ error: "Sign in first." }, 401); }
      const body = await request.json().catch(() => ({}));
      const result = await redeem(env, user, body.order);
      return json(result, result.ok ? 200 : 400);
    }

    // A forgotten pin, reset against the key. No sign-in — that is the point.
    if (path === "/api/recover" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name || "").trim();
      if (!NAME_RE.test(name)) return json({ error: "Names are 3 to 16 characters: letters, numbers or underscores." }, 400);
      const result = await recover(env, { name, address: addressFor(name), order: body.order, pin: String(body.pin || "") });
      return json(result, result.ok ? 200 : 400);
    }

    // The admin's keys desk: every redemption, revoke, let a name in, reset a pin.
    if (path === "/api/admin/keys") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID); }
      catch { return json({ error: "Sign in first." }, 401); }
      if (!isAdmin(env, user.uid)) return json({ error: "Not your desk." }, 403);
      if (request.method !== "POST") return json({ keys: await listKeys(env), epoch: env.KEY_EPOCH || null, etsy: env.ETSY_URL || "" });
      const body = await request.json().catch(() => ({}));
      const name = String(body.name || "").trim();
      let result;
      if (body.action === "pass") result = await makePass(env, user);
      // A pass code keeps its letters; an order number keeps only its digits.
      else if (body.action === "revoke" || body.action === "restore") {
        const raw = String(body.order || "");
        result = await revokeKey(env, cleanPass(raw) || raw.replace(/[^\d]/g, ""), body.action === "revoke");
      }
      else if (body.action === "unlock" || body.action === "pin") {
        if (!NAME_RE.test(name)) result = { ok: false, error: "That isn't a name." };
        else result = await adminUnlock(env, { name, address: addressFor(name), pin: body.action === "pin" ? String(body.pin || "") : null });
      } else result = { ok: false, error: "Unrecognised action." };
      return json(result, result.ok ? 200 : 400);
    }

    // A barred player asks to be let back in. One request at a time.
    if (path === "/api/appeal" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyMember(token, env); }
      catch { return json({ error: "Sign in first." }, 401); }
      const body = await request.json().catch(() => ({}));
      const res = await toCommons(env, "/appeal", { uid: user.uid, name: user.name, text: body.text });
      return json(res.ok ? { ok: true } : { error: "There is no bar to appeal." }, res.ok ? 200 : 400);
    }

    // The admin's desk: every refused line, who is barred, who is asking.
    if (path === "/api/admin/reports" || path === "/api/admin/act") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyIdToken(token, env.FIREBASE_PROJECT_ID); }
      catch { return json({ error: "Sign in first." }, 401); }
      if (!isAdmin(env, user.uid)) return json({ error: "Not yours to see." }, 403);
      // Is the screen awake? The admin can ask it to judge a line.
      if (path === "/api/admin/reports" && url.searchParams.has("probe")) {
        const verdict = await moderate(env, url.searchParams.get("probe"));
        return json({ probe: url.searchParams.get("probe"), verdict, model: !!env.AI });
      }
      if (path === "/api/admin/reports") {
        if (request.method === "POST") await toCommons(env, "/seen", {});
        return fromCommons(env, "/reports");
      }
      const body = await request.json().catch(() => ({}));
      const res = await toCommons(env, "/act", { uid: body.uid, action: body.action, by: user.name });
      // Letting someone back in wipes their strikes, or the next line bars them again.
      if (res.ok && (body.action === "unbar" || body.action === "clear")) await clearStrikes(env, body.uid).catch(() => {});
      return json({ ok: res.ok }, res.ok ? 200 : 400);
    }

    // The strip. Signed in, as reading the leaderboard always was.
    if (path === "/api/rankings") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      try { await verifyMember(token, env); }
      catch { return json({ error: "Sign in first." }, 401); }
      return fromCommons(env, "/rankings");
    }

    // Posting is signed in, and always as yourself: the name on the line comes
    // from the verified token, never from the body.
    if (path === "/api/chat" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyMember(token, env); }
      catch { return json({ error: "Sign in first." }, 401); }
      const body = await request.json().catch(() => ({}));
      const bar = await barred(env, user.uid);
      if (bar.banned) return json({ error: "You have been removed from the arena.", barred: true }, 403);
      // What may be said. A refused line is a strike, and never posted.
      const verdict = await moderate(env, body.text);
      if (!verdict.ok) {
        const strikes = await strikePlayer(env, user.uid, user.name, { text: body.text, reason: verdict.reason, where: "arena chat" });
        return json({ error: `That doesn't belong here (${verdict.reason}). Strike ${strikes ?? "?"} of 3.`, strike: strikes }, 400);
      }
      // So many lines a minute and no more: each one is a write.
      const gate = await commons(env).fetch("https://commons/chat/allow", {
        method: "POST", body: JSON.stringify({ uid: user.uid }),
      }).then((r) => r.json()).catch(() => ({ ok: true }));
      if (!gate.ok) return json({ error: "Slow down a little." }, 429);
      const ok = await postChat(env, { uid: user.uid, name: user.name, text: body.text });
      return json({ ok }, ok ? 200 : 400);
    }

    // An award, posted by whatever awards it. Kept open-ended on purpose so a
    // new award needs no new endpoint.
    if (path === "/api/feed/award" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      try { await verifyMember(token, env); }
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
      try { user = await verifyMember(token, env); }
      catch { return json({ error: "Sign in first." }, 401); }
      return fromCommons(env, `/wallet?uid=${encodeURIComponent(user.uid)}`);
    }

    // Wallet to table. The money leaves the wallet first and is put straight
    // back if the floor can't take it, so it can never sit in neither place.
    if (path === "/api/wallet/withdraw" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyMember(token, env); }
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
    if (path === "/api/wallets/top") return fromCommons(env, "/wallets/top");

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
    // What you wear on the board. Checked against what you have earned;
    // the answer says what was actually kept.
    if (path === "/api/cosmetics" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyMember(token, env); }
      catch { return json({ error: "Sign in first." }, 401); }
      const body = await request.json().catch(() => ({}));
      const result = await saveCosmetics(env, user.uid, user.name, {
        avatar: String(body.avatar || ""), frame: String(body.frame || ""), title: String(body.title || ""),
        banner: String(body.banner || ""), open: body.open === true,
      });
      return json(result, result.ok ? 200 : 400);
    }

    // The token shop: casino money for a boost on the next ranked round.
    if (path === "/api/shop") return json({ price: TOKEN_PRICE, games: TOKEN_GAMES });
    if (path === "/api/shop/buy" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyMember(token, env); }
      catch { return json({ error: "Sign in first." }, 401); }
      const body = await request.json().catch(() => ({}));
      const result = await buyToken(env, user.uid, user.name, String(body.game || ""));
      return json(result, result.ok ? 200 : 400);
    }

    // Off the top of a ladder and into the next branch, with the medal.
    if (path === "/api/retire" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try { user = await verifyMember(token, env); }
      catch { return json({ error: "Sign in first." }, 401); }
      const result = await retirePlayer(env, user.uid, user.name);
      return json(result, result.ok ? 200 : 400);
    }

    if (path === "/api/prestige" && request.method === "POST") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let user;
      try {
        user = await verifyMember(token, env);
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
        user = await verifyMember(url.searchParams.get("token"), env);
      } catch (err) {
        return new Response(`Sign-in rejected: ${err.message}`, { status: 401 });
      }
      if ((await barred(env, user.uid)).banned) return new Response("Removed from the arena.", { status: 403 });
      const stub = env.FLOOR.get(env.FLOOR.idFromName("global"));
      const fwd = new Request(request);
      fwd.headers.set("X-Dojo-Uid", user.uid);
      fwd.headers.set("X-Dojo-Name", user.name);
      return stub.fetch(fwd);
    }

    // Battleship, Minesweeper and Multiverse Golf all hand off the same way.
    const room = /^\/api\/(battle|mines|links)\/([A-Za-z0-9-]{3,16})\/ws$/.exec(path);
    if (room) {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("Expected a WebSocket upgrade.", { status: 426 });
      let user;
      try {
        user = await verifyMember(url.searchParams.get("token"), env);
      } catch (err) {
        return new Response(`Sign-in rejected: ${err.message}`, { status: 401 });
      }
      if ((await barred(env, user.uid)).banned) return new Response("Removed from the arena.", { status: 403 });
      const code = room[2].toUpperCase();
      const ns = room[1] === "mines" ? env.MINES
        : room[1] === "links" ? env.LINKS
        : env.BATTLE;
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
        user = await verifyMember(token, env);
      } catch (err) {
        // 1008 would be tidier, but the upgrade hasn't happened yet.
        return new Response(`Sign-in rejected: ${err.message}`, { status: 401 });
      }

      if ((await barred(env, user.uid)).banned) return new Response("Removed from the arena.", { status: 403 });
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
