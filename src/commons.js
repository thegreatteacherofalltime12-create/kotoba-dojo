import {
  readChat, readFeed, topOfficers, topPlayers, topWallets, readWallet,
} from "./firestore.js";

// One instance for the whole arena: the reading room.
//
// Every home screen polls the chat, the feed, the rankings and the wallet
// board every fifteen to thirty seconds. Each of those used to be a Firestore
// query per browser — sixty documents a poll for the chat alone — so a
// handful of players sitting on the home screen cost the database tens of
// thousands of reads an hour. Now the queries run once, here, and the
// writers tell this object what they wrote as they write it. Polls read
// memory and cost Firestore nothing.
//
// Firestore stays the record. This is a copy, kept exact by the write-through
// and reconciled against the record on a slow alarm in case a message was
// lost on the way. Nothing here is a scoring input: rounds still read the
// leaderboard directly when they start, and a withdrawal still reads the
// wallet before it moves money.

const CHAT_KEEP = 60;              // what the chat query served
const FEED_KEEP = 200;             // kept; served as the last day, newest 80
const FEED_SERVE = 80;
const FEED_WINDOW_MS = 24 * 3600_000;
const OFFICERS_KEEP = 60;          // every prestige row, as the client's old query did
const TOP_KEEP = 100;              // plus the top of the board by MMR
const BOARD_CAP = 200;
const RANKINGS_SHOWN = 24;
const WALLETS_KEEP = 50;
const WALLETS_SHOWN = 10;
const MINE_TTL_MS = 3600_000;      // a player's own figure, between live reads
const RECONCILE_MS = 30 * 60_000;  // re-read the record this often while in use
const RETRY_MS = 60_000;           // after a hydration that failed
const DIRTY_MS = 5_000;            // a writer could not say what it wrote
const CHAT_LINES_PER_MIN = 12;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export class Commons {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.hydrating = null;
    this.said = {};                // uid -> recent chat timestamps; memory only
    state.blockConcurrencyWhile(async () => {
      const s = state.storage;
      const [chat, feed, board, wallets, mine, meta] = await Promise.all(
        ["chat", "feed", "board", "wallets", "mine", "meta"].map((k) => s.get(k))
      );
      this.chat = chat || [];        // oldest first, as the client draws it
      this.feed = feed || [];        // newest first
      this.board = board || {};      // uid -> leaderboard row
      this.wallets = wallets || {};  // uid -> { uid, name, wallet }
      this.mine = mine || {};        // uid -> { wallet, at }
      this.meta = meta || { hydratedAt: 0, nextHydrateAt: 0, lastReadAt: 0 };
    });
  }

  save() {
    return this.state.storage.put({
      chat: this.chat, feed: this.feed, board: this.board,
      wallets: this.wallets, mine: this.mine, meta: this.meta,
    });
  }

  // ── keeping the copy honest ────────────────────────────────────────

  /**
   * Reads the record when it is due. The first time it blocks, so the first
   * poll after a cold start has something to show; after that a due
   * hydration runs behind the request and the poll is answered from what is
   * already here. Never inside the constructor: a slow Firestore call there
   * would freeze every poll behind it.
   */
  async ready() {
    if (Date.now() < this.meta.nextHydrateAt) return;
    if (!this.hydrating) {
      this.hydrating = this.hydrate().catch((err) => {
        console.error(`[commons] hydrate: ${err.message}`);
      }).finally(() => { this.hydrating = null; });
    }
    if (!this.meta.hydratedAt) await this.hydrating;
  }

  async hydrate() {
    const now = Date.now();
    // Nobody else starts one while this runs.
    this.meta.nextHydrateAt = now + RETRY_MS;
    const quiet = (p) => p.catch(() => null);
    const [chat, feed, officers, top, wallets] = await Promise.all([
      quiet(readChat(this.env, CHAT_KEEP)),
      quiet(readFeed(this.env, 24)),
      quiet(topOfficers(this.env, OFFICERS_KEEP)),
      quiet(topPlayers(this.env, TOP_KEEP)),
      quiet(topWallets(this.env, WALLETS_KEEP)),
    ]);

    // A slice is replaced only by a read that succeeded. A refused query
    // returns null, never an empty list, so an outage cannot wipe the copy.
    let whole = true;
    if (chat) this.chat = chat.slice(-CHAT_KEEP); else whole = false;
    if (feed) this.feed = [...feed].sort((a, b) => b.at.localeCompare(a.at)).slice(0, FEED_KEEP);
    else whole = false;
    if (officers && top) {
      for (const row of [...officers, ...top]) this.board[row.uid] = { ...this.board[row.uid], ...row };
      this.pruneBoard();
    } else whole = false;
    if (wallets) {
      this.wallets = Object.fromEntries(wallets.map((w) => [w.uid, w]));
    } else whole = false;

    if (whole) this.meta.hydratedAt = now;
    this.meta.nextHydrateAt = now + (whole ? RECONCILE_MS : RETRY_MS);
    await this.save();
    // Reconcile again later only while someone is actually reading.
    if (whole && now - this.meta.lastReadAt < RECONCILE_MS) {
      await this.state.storage.setAlarm(this.meta.nextHydrateAt);
    }
  }

  async alarm() {
    this.meta.nextHydrateAt = 0;
    await this.ready();
  }

  /** Every officer stays, then the top of the board, then whoever is newest. */
  pruneBoard() {
    const rows = Object.values(this.board);
    if (rows.length <= BOARD_CAP) return;
    const keep = new Set();
    rows.filter((r) => r.prestige > 0)
      .sort((a, b) => b.prestige - a.prestige).slice(0, OFFICERS_KEEP)
      .forEach((r) => keep.add(r.uid));
    [...rows].sort((a, b) => num(b.totalPoints) - num(a.totalPoints)).slice(0, TOP_KEEP)
      .forEach((r) => keep.add(r.uid));
    [...rows].sort((a, b) => num(b.touchedAt) - num(a.touchedAt))
      .forEach((r) => { if (keep.size < BOARD_CAP) keep.add(r.uid); });
    for (const r of rows) if (!keep.has(r.uid)) delete this.board[r.uid];
  }

  // ── what the home screen reads ─────────────────────────────────────

  /** The strip, exactly as the client used to assemble it from two queries. */
  rankings() {
    const rows = Object.values(this.board).map((r) => ({
      uid: r.uid,
      name: r.name || "Unknown",
      mmr: num(r.totalPoints),
      best: num(r.bestScore),
      rounds: num(r.roundsPlayed),
      prestige: num(r.prestige),
    }));
    const officers = rows.filter((r) => r.prestige > 0)
      .sort((a, b) => b.prestige - a.prestige).slice(0, OFFICERS_KEEP);
    const byMmr = [...rows].sort((a, b) => b.mmr - a.mmr).slice(0, RANKINGS_SHOWN);
    const seen = new Map();
    for (const r of [...officers, ...byMmr]) seen.set(r.uid, r);
    return [...seen.values()]
      .sort((a, b) => (b.prestige - a.prestige) || (b.mmr - a.mmr) || a.name.localeCompare(b.name))
      .slice(0, RANKINGS_SHOWN);
  }

  /** For the bounty office: the top of the board by MMR. */
  top(limit) {
    return Object.values(this.board)
      .sort((a, b) => num(b.totalPoints) - num(a.totalPoints))
      .slice(0, limit)
      .map((r) => ({
        uid: r.uid, name: r.name || "Someone",
        bestScore: num(r.bestScore), lastRate: num(r.lastRate),
      }));
  }

  feedNow() {
    const since = new Date(Date.now() - FEED_WINDOW_MS).toISOString();
    return this.feed.filter((r) => r.at > since).slice(0, FEED_SERVE);
  }

  walletBoard() {
    return Object.values(this.wallets)
      .sort((a, b) => num(b.wallet) - num(a.wallet))
      .slice(0, WALLETS_SHOWN);
  }

  /** A player's own figure: from the copy while it is fresh, else one live read. */
  async wallet(uid) {
    const have = this.mine[uid];
    if (have && Date.now() - have.at < MINE_TTL_MS) return have.wallet;
    let live = null;
    try { live = await readWallet(this.env, uid); } catch { live = null; }
    if (live == null) return have ? have.wallet : 0;
    this.mine[uid] = { wallet: live, at: Date.now() };
    await this.save();
    return live;
  }

  // ── what the writers tell it ───────────────────────────────────────

  /** Placed by time rather than appended: writers run in more than one place. */
  appendChat(row) {
    if (!row?.id || this.chat.some((r) => r.id === row.id)) return;
    this.chat.push({ id: row.id, at: row.at, uid: row.uid, name: row.name, text: row.text });
    this.chat.sort((a, b) => a.at.localeCompare(b.at));
    this.chat = this.chat.slice(-CHAT_KEEP);
  }

  appendFeed(row) {
    if (!row?.id || this.feed.some((r) => r.id === row.id)) return;
    this.feed.push({
      id: row.id, at: row.at, kind: row.kind || "note",
      text: row.text || "", name: row.name || "", detail: row.detail || "",
    });
    this.feed.sort((a, b) => b.at.localeCompare(a.at));
    this.feed = this.feed.slice(0, FEED_KEEP);
  }

  /**
   * Fields present on a row overwrite; fields absent are kept, so a match
   * result that says nothing about prestige never demotes an officer.
   */
  upsertBoard(rows) {
    const now = Date.now();
    for (const row of rows || []) {
      if (!row?.uid) continue;
      const clean = {};
      for (const [k, v] of Object.entries(row)) if (v != null) clean[k] = v;
      this.board[row.uid] = { ...this.board[row.uid], ...clean, uid: row.uid, touchedAt: now };
    }
    this.pruneBoard();
  }

  upsertWallet({ uid, name, wallet, mine }) {
    if (!uid) return;
    if (Number.isFinite(Number(wallet))) {
      this.wallets[uid] = { uid, name: name || this.wallets[uid]?.name || "Someone", wallet: Number(wallet) };
      const top = Object.values(this.wallets).sort((a, b) => num(b.wallet) - num(a.wallet)).slice(0, WALLETS_KEEP);
      this.wallets = Object.fromEntries(top.map((w) => [w.uid, w]));
    }
    if (Number.isFinite(Number(mine))) this.mine[uid] = { wallet: Number(mine), at: Date.now() };
  }

  /** A writer could not say what it wrote, so the record is read again soon. */
  async markDirty() {
    const at = Date.now() + DIRTY_MS;
    this.meta.nextHydrateAt = Math.min(this.meta.nextHydrateAt || at, at);
    await this.state.storage.setAlarm(at);
  }

  /** So many lines a minute from one person, and no more. */
  allowChat(uid) {
    const now = Date.now();
    const recent = (this.said[uid] || []).filter((t) => now - t < 60_000);
    if (recent.length >= CHAT_LINES_PER_MIN) { this.said[uid] = recent; return false; }
    recent.push(now);
    this.said[uid] = recent;
    return true;
  }

  // ── the door ───────────────────────────────────────────────────────

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (path === "/chat/allow") return Response.json({ ok: this.allowChat(String(body.uid || "")) });
      if (path === "/chat/append") this.appendChat(body);
      else if (path === "/feed/append") this.appendFeed(body);
      else if (path === "/board/upsert") this.upsertBoard(body.rows);
      else if (path === "/wallets/upsert") this.upsertWallet(body);
      else if (path === "/dirty") { await this.markDirty(); return Response.json({ ok: true }); }
      else if (path === "/rehydrate") { this.meta.nextHydrateAt = 0; }
      else return Response.json({ error: "no such door" }, { status: 404 });
      await this.save();
      return Response.json({ ok: true });
    }

    this.meta.lastReadAt = Date.now();
    await this.ready();

    if (path === "/chat") return Response.json({ chat: this.chat });
    if (path === "/feed") return Response.json({ feed: this.feedNow() });
    if (path === "/rankings") return Response.json({ standings: this.rankings() });
    if (path === "/wallets/top") return Response.json({ wallets: this.walletBoard() });
    if (path === "/top") return Response.json({ top: this.top(Number(url.searchParams.get("limit")) || 10) });
    if (path === "/wallet") {
      const uid = url.searchParams.get("uid") || "";
      return Response.json({ wallet: uid ? await this.wallet(uid) : 0 });
    }
    return Response.json({ error: "no such door" }, { status: 404 });
  }
}
