import {
  SUITS, START_TABLE, MAX_SEATS, FINISH, HURDLES, TICK_MS,
  HORSES, horseById, favouriteFor, favouriteEndsAt, oddsFor,
  BETS, betById, freshRace, raceTick, placings, betWins,
  shuffled, handValue, isBlackjack, dealerShouldHit, settle,
} from "./casino-core.js";
import {
  deck as freshDeck, rankFive, rankThree, compare, rouletteWins, pocketName,
  ROULETTE_POCKETS, ROULETTE_BETS, BIGSIX, spinBigSix, baccaratCoup,
  BACCARAT_BOARD, baccaratSettle,
  PAIR_PLUS, ANTE_BONUS, dealerQualifies, drawPayout, hiLoResult,
} from "./casino-games.js";
import {
  bestOfSeven, holdemSettle, HOLDEM_BUYIN, BET_STEP, pyGowDeck, houseWay,
  rankFiveWithJoker, rankTwo, playsAceHigh, paiGowSettle, fortuneAward,
  ACE_HIGH_BONUS, crossLine, crossRow, BONUS_PAYS,
  dealerAct, strengthOf, levelById, AI_LEVELS,
} from "./casino-tables.js";
import { compare as compare2 } from "./casino-games.js";
import { bankWallet, writeHistory, postFeed, awardMmr } from "./firestore.js";

// A win at any table or on the track is worth this much MMR, up to the
// day's cap. Small on purpose: a hand takes ten seconds and a ranked round
// of anything else pays a hundred-odd at most.
const WIN_MMR = 5;
const WIN_MMR_DAILY_CAP = 100;

const IDLE_MS = 45 * 60_000;
const SEAT_TURN_MS = 30_000;

/**
 * The floor. One of these for the whole arena, because the point of it is
 * that everybody is watching the same race and reading the same bet board.
 *
 * Two things live here that could not live in a browser: the race itself,
 * so nobody can see the next card, and each player's table money, so a
 * payout is worked out once rather than four times with four answers.
 *
 * Wallets are not here. Money on the table belongs to the floor until a
 * player banks out, and banking writes to that player's own Firestore
 * document — one wallet per account, never a shared pot.
 */
export class CasinoFloor {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      this.f = (await state.storage.get("floor")) || this.blank();
      await this.migrate();
    });
  }

  /**
   * Brings a stored floor up to the current race.
   *
   * The track used to be four suits; it is seven named runners now, and a race
   * saved under the old shape has positions keyed by things that no longer run.
   * Left alone it reads as undefined everywhere: lanes with no horse, a tick
   * that adds one to nothing, and a bet that vanishes on being placed.
   *
   * Open bets are handed back rather than settled, because they were struck on
   * a field that no longer exists.
   */
  async migrate() {
    if (!this.f) return;
    // typeof NaN is "number", which is how the first version of this check let
    // a wrecked race through: the old four-suit race had already been ticked by
    // the new code, so every position had become NaN rather than staying
    // absent. NaN positions never reach the finish, so the race ran for ever.
    const race = this.f.race;
    const stale = !race
      || !race.favourite
      || !HORSES.every((h) => Number.isFinite(race.at?.[h.id]));
    if (!stale) return;

    for (const b of this.f.bets || []) {
      const p = this.f.players?.[b.uid];
      if (p) p.table += b.stake;
    }
    this.f.bets = [];
    this.f.pool = 0;
    this.f.race = freshRace();
    this.f.phase = "BETTING";
    await this.state.storage.put({ floor: this.f });
    console.log("[floor] race migrated to the seven-runner field; open bets returned");
  }

  blank() {
    return {
      players: {},              // uid -> { name, table, tokens, seated }
      race: freshRace(),
      phase: "BETTING",         // BETTING | RUNNING | PAID
      bets: [],                 // { id, uid, name, type, picks, stake }
      pool: 0,
      log: [],
      round: 0,
      table: {                  // the live blackjack table
        phase: "OPEN",          // OPEN | DEALING | ACTING | SETTLED
        shoe: [],
        dealer: [],
        seats: {},              // uid -> { bet, cards, done, result }
        turnEndsAt: null,
      },
    };
  }

  /**
   * A Durable Object has exactly one alarm, and this floor runs three clocks
   * off it: the race tick, the blackjack table, and the idle shutdown. They
   * used to overwrite each other — dealing a hand cancelled the race's next
   * tick, and while a race ran the table's clock was never read at all, so a
   * settled hand never cleared and nobody could sit down again.
   *
   * Deadlines are kept apart and the alarm is always set to the soonest.
   */
  async due(kind, when) {
    this.f.due = this.f.due || {};
    if (when) this.f.due[kind] = when;
    else delete this.f.due[kind];
    await this.rearm();
  }

  async rearm() {
    const times = Object.values(this.f.due || {}).filter(Boolean);
    if (!times.length) { await this.state.storage.deleteAlarm().catch(() => {}); return; }
    await this.state.storage.setAlarm(Math.min(...times));
  }

  save() { return this.state.storage.put({ floor: this.f }); }
  sockets() { return this.state.getWebSockets(); }

  send(ws, type, payload = {}) {
    try { ws.send(JSON.stringify({ type, ...payload })); } catch { /* gone */ }
  }

  broadcast(type, payload = {}) {
    const msg = JSON.stringify({ type, ...payload });
    for (const ws of this.sockets()) { try { ws.send(msg); } catch { /* gone */ } }
  }

  online() {
    const out = new Set();
    for (const ws of this.sockets()) {
      try { const a = ws.deserializeAttachment(); if (a?.uid) out.add(a.uid); } catch { /* gone */ }
    }
    return out;
  }

  /**
   * A line in the game log.
   *
   * This writes as well as broadcasts. Every caller saves before noting, so
   * without the write here a line reached whoever was connected at the time
   * and then disappeared the moment the object hibernated — leaving a log that
   * looked complete live and full of holes on reconnect. The write isn't
   * awaited because the runtime holds outgoing messages until it lands.
   */
  /**
   * The MMR for a win, if the day's cap has room. The tally lives on the
   * floor keyed by uid rather than on the player, so leaving and coming
   * back does not reset it. Returns what was awarded, which may be zero.
   */
  async reward(uid, p) {
    const day = new Date().toISOString().slice(0, 10);
    this.f.mmrDaily = this.f.mmrDaily || {};
    const row = this.f.mmrDaily[uid]?.day === day ? this.f.mmrDaily[uid] : { day, given: 0 };
    const award = Math.min(WIN_MMR, WIN_MMR_DAILY_CAP - row.given);
    if (award <= 0) { this.f.mmrDaily[uid] = row; return 0; }
    row.given += award;
    this.f.mmrDaily[uid] = row;
    p.mmrEarned = (p.mmrEarned || 0) + award;
    // Yesterday's tallies are of no further use.
    for (const [u, r] of Object.entries(this.f.mmrDaily)) if (r.day !== day) delete this.f.mmrDaily[u];
    this.state.waitUntil?.(awardMmr(this.env, uid, p.name, award).catch(() => {}));
    return award;
  }

  /** " (+5 MMR)" or nothing. */
  plus(award) { return award ? ` (+${award} MMR)` : ""; }

  note(text) {
    this.f.log.unshift({ at: Date.now(), text });
    this.f.log = this.f.log.slice(0, 60);
    this.save();
    this.broadcast("FLOOR_LOG", { entry: this.f.log[0] });
  }

  // ------------------------------------------------------------- connections

  async fetch(request) {
    // Arcade winnings arrive here rather than from the browser: the Worker
    // marked the sum and timed it, so it is the only thing allowed to say
    // what a player earned. The floor just adds it to their table money.
    if (new URL(request.url).pathname === "/credit") {
      if (!this.f) this.f = this.blank();
      const { uid, name, cash = 0, tokens = 0, mmr = 0, reason = "arcade" } =
        await request.json().catch(() => ({}));
      if (!uid || !(cash > 0)) return new Response("No.", { status: 400 });

      const p = this.f.players[uid]
        || (this.f.players[uid] = { uid, name: name || "Player", table: 0, tokens: 0, staked: false });
      p.table += Math.round(cash);
      p.tokens += Math.round(tokens);
      // The arcade is the one thing on the floor that pays MMR. It has already
      // gone to the ladder; this is kept so the session's own record can say
      // how much of it was earned here.
      p.mmrEarned = (p.mmrEarned || 0) + Math.max(0, Math.round(mmr));
      await this.save();
      this.note(reason === "wallet"
        ? `${p.name} brought $${Math.round(cash)} in from their wallet.`
        : `${p.name} earned $${Math.round(cash)} in the arcade.`);
      this.push();
      return new Response(JSON.stringify({ ok: true, table: p.table }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("This endpoint speaks WebSocket only.", { status: 426 });

    const uid = request.headers.get("X-Dojo-Uid");
    const name = request.headers.get("X-Dojo-Name") || "Player";
    if (!uid) return new Response("Unauthenticated.", { status: 401 });

    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ uid, name });
    await this.onJoin(uid, name, pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async onJoin(uid, name, ws) {
    if (!this.f) this.f = this.blank();

    const known = this.f.players[uid];
    if (known) known.name = name;
    else {
      // An open lobby: anyone may walk in mid-race and bet on the next one.
      this.f.players[uid] = { uid, name, table: 0, tokens: 1, staked: false };
      this.note(`${name} walked in.`);
    }

    await this.save();
    this.send(ws, "FLOOR_WELCOME", {
      you: uid, bets: BETS, horses: HORSES, suits: SUITS,
      finish: FINISH, hurdles: HURDLES,
    });
    this.push();
    for (const e of [...this.f.log].reverse()) this.send(ws, "FLOOR_LOG", { entry: e });

    // A table left stranded by the old shared alarm — settled, with nothing
    // scheduled to clear it — is released when the next person walks in.
    const t0 = this.f.table;
    if (t0.phase === "SETTLED" && !this.f.due?.table) await this.due("table", Date.now() + 1500);
    else if (t0.phase === "ACTING" && t0.turnEndsAt && !this.f.due?.table)
      await this.due("table", t0.turnEndsAt);

    if (this.f.phase === "RUNNING") await this.due("race", Date.now() + TICK_MS);
    else await this.rearm();
  }

  /** What everyone can see. A player's own figures are sent only to them. */
  view() {
    const on = this.online();
    return {
      phase: this.f.phase,
      round: this.f.round,
      race: {
        at: this.f.race.at,
        favourite: this.f.race.favourite,
        favouriteEndsAt: favouriteEndsAt(),
        // Face-down traps go out as blanks. Sending the rank of a card nobody
        // has turned yet would hand the table the rest of the race.
        traps: (this.f.race.traps || []).map((t) => (t.turned
          ? { at: t.at, turned: true, rank: t.rank, suit: t.suit }
          : { at: t.at, turned: false })),
        hurdles: this.f.race.hurdles,
        finished: this.f.race.finished,
        last: this.f.race.last,
      },
      pool: this.f.pool,
      bets: this.f.bets.map((b) => ({
        id: b.id, uid: b.uid, name: b.name, type: b.type, picks: b.picks, stake: b.stake,
      })),
      players: Object.values(this.f.players)
        .filter((p) => on.has(p.uid))
        .map((p) => ({ uid: p.uid, name: p.name, table: p.table, seated: !!p.seated })),
      table: {
        phase: this.f.table.phase,
        dealer: this.f.table.phase === "ACTING"
          ? [this.f.table.dealer[0], { hidden: true }]
          : this.f.table.dealer,
        turnEndsAt: this.f.table.turnEndsAt,
        seats: Object.entries(this.f.table.seats).map(([uid, s]) => ({
          uid, name: this.f.players[uid]?.name || "Player",
          bet: s.bet, cards: s.cards, total: s.cards?.length ? handValue(s.cards).total : 0,
          done: !!s.done, result: s.result || null,
        })),
      },
    };
  }

  push() {
    const shared = this.view();
    for (const ws of this.sockets()) {
      let uid = null;
      try { uid = ws.deserializeAttachment()?.uid; } catch { /* gone */ }
      const me = uid && this.f.players[uid];
      this.send(ws, "FLOOR_STATE", {
        floor: shared,
        you: me ? { table: me.table, tokens: me.tokens, staked: !!me.staked } : null,
      });
    }
  }

  // ---------------------------------------------------------------- messages

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const who = ws.deserializeAttachment();
    if (!who?.uid || !this.f) return;

    try {
      switch (msg.type) {
        case "FLOOR_STAKE":  return await this.stake(ws, who.uid);
        case "FLOOR_BET":    return await this.placeBet(ws, who.uid, msg);
        case "FLOOR_COPY":   return await this.copyBet(ws, who.uid, msg);
        case "FLOOR_START":  return await this.startRace(ws, who.uid);
        case "SEAT_TAKE":    return await this.takeSeat(ws, who.uid, msg);
        case "SEAT_LEAVE":   return await this.leaveSeat(ws, who.uid);
        case "SEAT_DEAL":    return await this.dealTable(ws, who.uid);
        case "SEAT_HIT":     return await this.hit(ws, who.uid);
        case "SEAT_STAND":   return await this.stand(ws, who.uid);
        case "TABLE_PLAY":   return await this.tablePlay(ws, who.uid, msg);
        case "TABLE_DEAL":   return await this.tableDeal(ws, who.uid, msg);
        case "TABLE_ACT":    return await this.tableAct(ws, who.uid, msg);
        case "TABLE_PEEK":   return this.tablePeek(ws, who.uid, msg);
        case "TABLE_END":    return await this.tableEnd(ws, who.uid);
        case "FLOOR_BANK":   return await this.bankOut(ws, who.uid);
        default: return this.send(ws, "FLOOR_ERROR", { message: "Unrecognised message." });
      }
    } catch (err) {
      this.send(ws, "FLOOR_ERROR", { message: String(err?.message || err) });
    }
  }

  /** A first stake, once, so a new arrival has something to play with. */
  async stake(ws, uid) {
    const p = this.f.players[uid];
    if (p.staked) return this.send(ws, "FLOOR_ERROR", { message: "You've already taken your stake." });
    p.staked = true;
    p.table += START_TABLE;
    await this.save();
    this.note(`${p.name} took a $${START_TABLE} stake.`);
    this.push();
  }

  async placeBet(ws, uid, msg) {
    if (this.f.phase !== "BETTING")
      return this.send(ws, "FLOOR_ERROR", { message: "The race is under way. Wait for the next one." });

    const p = this.f.players[uid];
    const bet = betById(msg.betType);
    const picks = [...new Set(msg.picks || [])].filter((x) => HORSES.some((h) => h.id === x));
    const stake = Math.max(1, Math.round(Number(msg.stake) || 0));

    if (!bet) return this.send(ws, "FLOOR_ERROR", { message: "No such bet." });
    if (picks.length !== bet.picks)
      return this.send(ws, "FLOOR_ERROR", { message: `That bet needs ${bet.picks} horse${bet.picks === 1 ? "" : "s"}.` });
    if (stake > p.table)
      return this.send(ws, "FLOOR_ERROR", { message: "That's more than you have on the table." });

    p.table -= stake;
    this.f.pool += stake;
    this.f.bets.push({
      id: crypto.randomUUID().slice(0, 8),
      uid, name: p.name, type: bet.id, picks, stake,
    });
    await this.save();
    this.note(`${p.name} put $${stake} on ${bet.name}.`);
    this.push();
  }

  /** Back somebody else's slip with your own money. */
  async copyBet(ws, uid, msg) {
    const source = this.f.bets.find((b) => b.id === msg.betId);
    if (!source) return this.send(ws, "FLOOR_ERROR", { message: "That slip is gone." });
    return this.placeBet(ws, uid, {
      betType: source.type, picks: source.picks, stake: msg.stake ?? source.stake,
    });
  }

  async startRace(ws, uid) {
    if (this.f.phase !== "BETTING")
      return this.send(ws, "FLOOR_ERROR", { message: "Already running." });
    if (!this.f.bets.length)
      return this.send(ws, "FLOOR_ERROR", { message: "Place a bet to start." });

    this.f.phase = "RUNNING";
    this.f.round += 1;
    await this.save();
    this.note(`${this.f.players[uid]?.name || "Someone"} started race ${this.f.round}. They're away.`);
    this.push();
    await this.due("race", Date.now() + TICK_MS);
  }

  async runTick() {
    // Belt and braces: a race that has lost its numbers is restarted rather
    // than ticked into a state nothing can finish.
    if (!HORSES.every((h) => Number.isFinite(this.f.race?.at?.[h.id]))) {
      await this.migrate();
      this.push();
      return;
    }
    const out = raceTick(this.f.race);
    if (out.card && !out.crossed) {
      this.note(`${out.card.rank}${out.card.suit} \u2014 ${horseById(out.moved).name} advances.`);
    }
    if (out.hurdle) {
      this.note(`Trap ${out.hurdle.at} turns: ${out.hurdle.rank}${out.hurdle.suit} \u2014 `
        + `${horseById(out.hurdle.horse).name} drops back.`);
    }
    if (out.crossed) {
      const place = ["1st", "2nd", "3rd", "4th"][this.f.race.finished.length - 1];
      this.note(`${horseById(out.crossed).name} home in ${place}.`);
    }

    if (out.done) { await this.payOut(); return; }
    await this.save();
    this.push();
    await this.due("race", Date.now() + TICK_MS);
  }

  async payOut() {
    const order = placings(this.f.race);
    const winners = [];

    for (const b of this.f.bets) {
      const p = this.f.players[b.uid];
      if (!p) continue;
      if (betWins(b.type, b.picks, order, this.f.race)) {
        const paid = Math.round(b.stake + b.stake * oddsFor(b.type));
        p.table += paid;
        winners.push({ name: b.name, paid, type: b.type, uid: b.uid });
      }
    }
    // One award a race however many bets came in: it is the race that was won.
    const rewarded = {};
    for (const w of winners) {
      if (rewarded[w.uid] != null) { w.mmr = 0; continue; }
      rewarded[w.uid] = await this.reward(w.uid, this.f.players[w.uid]);
      w.mmr = rewarded[w.uid];
    }

    this.f.phase = "PAID";
    const names = order.map((id) => horseById(id).name);
    this.note(`Finish: ${names.join(", ")}.`);
    for (const w of winners) this.note(`${w.name} collects ${w.paid} on ${betById(w.type).name}${this.plus(w.mmr)}.`);
    if (!winners.length) this.note("The board is beaten. Nothing collects.");

    await this.save();
    this.broadcast("FLOOR_RESULT", { order, winners, race: this.f.race });
    this.push();

    // A short breath, then a fresh card and the board reopens.
    await this.due("race", Date.now() + 6000);
  }

  async newRace() {
    this.f.race = freshRace();
    this.f.bets = [];
    this.f.pool = 0;
    this.f.phase = "BETTING";
    await this.save();
    this.note("Betting open on the next race.");
    this.push();
  }

  // ------------------------------------------------------------- live tables

  async takeSeat(ws, uid, msg) {
    const t = this.f.table;
    if (t.phase !== "OPEN")
      return this.send(ws, "FLOOR_ERROR", { message: "The hand is in play. Wait for the next." });
    if (Object.keys(t.seats).length >= MAX_SEATS && !t.seats[uid])
      return this.send(ws, "FLOOR_ERROR", { message: `The table is full at ${MAX_SEATS}.` });

    const p = this.f.players[uid];
    if (this.noToken(ws, p)) return;
    const bet = Math.max(1, Math.round(Number(msg.bet) || 0));
    if (bet > p.table) return this.send(ws, "FLOOR_ERROR", { message: "That's more than you have." });

    if (t.seats[uid]) p.table += t.seats[uid].bet;   // changing your mind is free
    p.table -= bet;
    t.seats[uid] = { bet, cards: [], done: false, result: null };
    p.seated = true;
    await this.save();
    this.note(`${p.name} sat down for $${bet}.`);
    this.push();
  }

  async leaveSeat(ws, uid) {
    const t = this.f.table;
    if (t.phase !== "OPEN") return this.send(ws, "FLOOR_ERROR", { message: "Not mid-hand." });
    if (t.seats[uid]) {
      this.f.players[uid].table += t.seats[uid].bet;
      delete t.seats[uid];
      this.f.players[uid].seated = false;
      await this.save();
      this.push();
    }
  }

  async dealTable(ws, uid) {
    const t = this.f.table;
    if (t.phase !== "OPEN") return this.send(ws, "FLOOR_ERROR", { message: "Already dealt." });
    if (!Object.keys(t.seats).length)
      return this.send(ws, "FLOOR_ERROR", { message: "Nobody is seated." });

    if (t.shoe.length < 40) t.shoe = shuffled(6);
    t.dealer = [t.shoe.pop(), t.shoe.pop()];
    for (const seat of Object.values(t.seats)) {
      seat.cards = [t.shoe.pop(), t.shoe.pop()];
      seat.done = isBlackjack(seat.cards);
    }
    t.phase = "ACTING";
    t.turnEndsAt = Date.now() + SEAT_TURN_MS;
    await this.save();
    this.note(`Cards out to ${Object.keys(t.seats).length} at the table.`);
    this.push();
    await this.due("table", t.turnEndsAt);
  }

  async hit(ws, uid) {
    const t = this.f.table;
    const seat = t.seats[uid];
    if (t.phase !== "ACTING" || !seat || seat.done) return;
    seat.cards.push(t.shoe.pop());
    if (handValue(seat.cards).bust) seat.done = true;
    await this.save();
    this.push();
    await this.maybeSettle();
  }

  async stand(ws, uid) {
    const t = this.f.table;
    const seat = t.seats[uid];
    if (t.phase !== "ACTING" || !seat) return;
    seat.done = true;
    await this.save();
    this.push();
    await this.maybeSettle();
  }

  async maybeSettle(force) {
    const t = this.f.table;
    if (t.phase !== "ACTING") return;
    const seats = Object.values(t.seats);
    if (!force && !seats.every((s) => s.done)) return;

    while (dealerShouldHit(t.dealer)) t.dealer.push(t.shoe.pop());

    for (const [uid, seat] of Object.entries(t.seats)) {
      const p = this.f.players[uid];
      const out = settle(seat.cards, t.dealer);
      seat.result = out.result;
      let award = 0;
      if (out.result === "win") { p.table += seat.bet * 2; award = await this.reward(uid, p); }
      else if (out.result === "push") { p.table += seat.bet; }
      else { p.tokens = Math.max(0, p.tokens - 1); }
      this.note(`${p.name} ${out.result === "win" ? "wins" : out.result === "push" ? "pushes" : "loses"} \u2014 ${out.why}${this.plus(award)}.`);
    }

    t.phase = "SETTLED";
    t.turnEndsAt = null;
    await this.save();
    this.push();
    await this.due("table", Date.now() + 6000);
  }

  async clearTable() {
    const t = this.f.table;
    for (const uid of Object.keys(t.seats)) {
      if (this.f.players[uid]) this.f.players[uid].seated = false;
    }
    t.seats = {};
    t.dealer = [];
    t.phase = "OPEN";
    await this.save();
    this.note("Table open. Take a seat.");
    this.push();
  }

  // ------------------------------------------------------------------ wallet

  /**
   * Banking out. The money leaves the floor and is written to this player's
   * own wallet document — never a shared balance.
   */
  /**
   * Every table costs a token to play. Only the horse race is exempt, which is
   * what keeps a broke player earning at the arcade rather than stuck.
   */
  noToken(ws, p) {
    if ((p.tokens || 0) >= 1) return false;
    this.send(ws, "FLOOR_ERROR", {
      message: "You need a token to play. Earn one at the arcade.",
    });
    return true;
  }

  /** Takes a stake off a player, refusing anything they can't cover. */
  take(p, amount) {
    const bet = Math.max(1, Math.round(Number(amount) || 0));
    if (bet > p.table) return null;
    p.table -= bet;
    return bet;
  }

  /**
   * The one-shot tables: stake, spin or deal, settle. Nothing carries between
   * rounds, which is what makes them safe to resolve in a single message.
   */
  /**
   * Baccarat is its own shape: a board of bets settled together off one coup,
   * rather than a single stake on a single outcome.
   */
  async baccaratRound(ws, p, msg) {
    const wanted = {};
    let total = 0;
    for (const row of BACCARAT_BOARD) {
      const amount = Math.max(0, Math.round(Number(msg.bets?.[row.id]) || 0));
      if (!amount) continue;
      wanted[row.id] = amount;
      total += amount;
    }
    if (!total) return this.send(ws, "FLOOR_ERROR", { message: "Put something on the board first." });
    if (total > p.table)
      return this.send(ws, "FLOOR_ERROR", { message: "That's more than you have on the table." });

    p.table -= total;
    const coup = baccaratCoup(freshDeck(8));
    const { returns, total: back } = baccaratSettle(coup, wanted);
    p.table += back;
    if (back < total) p.tokens = Math.max(0, (p.tokens || 0) - 1);
    const award = back > total ? await this.reward(p.uid, p) : 0;

    await this.save();
    const title = `Baccarat \u2014 ${coup.outcome} ${coup.playerTotal}:${coup.bankerTotal}`;
    this.note(back > total ? `${p.name} won ${back - total} at ${title}${this.plus(award)}.`
      : back === total ? `${p.name} pushed at ${title}.`
      : `${p.name} lost $${total - back} at ${title}.`);
    this.send(ws, "TABLE_RESULT", {
      game: "baccarat", title, staked: total, returned: back,
      detail: {
        player: coup.player, banker: coup.banker,
        playerTotal: coup.playerTotal, bankerTotal: coup.bankerTotal,
        outcome: coup.outcome, bets: wanted, returns,
      },
    });
    this.push();
  }

  /**
   * The wheel, settled on a board rather than a single symbol.
   *
   * One spin decides every stake on it, which is the only honest way to take
   * several bets at once — spinning per bet would be several different wheels.
   */
  async bigsixRound(ws, p, msg) {
    const wanted = {};
    let total = 0;
    for (const row of BIGSIX) {
      const amount = Math.max(0, Math.round(Number(msg.bets?.[row.id]) || 0));
      if (!amount) continue;
      wanted[row.id] = amount;
      total += amount;
    }
    if (!total) return this.send(ws, "FLOOR_ERROR", { message: "Put something on the wheel first." });
    if (total > p.table)
      return this.send(ws, "FLOOR_ERROR", { message: "That's more than you have on the table." });

    p.table -= total;
    const landed = spinBigSix();
    const rule = BIGSIX.find((b) => b.id === landed);

    const returns = {};
    let back = 0;
    for (const [id, amount] of Object.entries(wanted)) {
      const won = id === landed ? amount + amount * rule.pays : 0;
      returns[id] = won;
      back += won;
    }

    p.table += back;
    if (back < total) p.tokens = Math.max(0, (p.tokens || 0) - 1);
    const award = back > total ? await this.reward(p.uid, p) : 0;
    await this.save();

    const title = `Big Six \u2014 ${rule.name}`;
    this.note(back > total ? `${p.name} won ${back - total} at ${title}${this.plus(award)}.`
      : back === total ? `${p.name} pushed at ${title}.`
      : `${p.name} lost $${total - back} at ${title}.`);
    this.send(ws, "TABLE_RESULT", {
      game: "bigsix", title, staked: total, returned: back,
      detail: { landed, bet: rule.name, hit: back > 0, bets: wanted, returns },
    });
    this.push();
  }

  async tablePlay(ws, uid, msg) {
    const p = this.f.players[uid];
    if (!p) return;
    if (this.noToken(ws, p)) return;
    if (msg.game === "baccarat") return await this.baccaratRound(ws, p, msg);
    if (msg.game === "bigsix" && msg.bets) return await this.bigsixRound(ws, p, msg);
    const bet = this.take(p, msg.amount);
    if (bet === null)
      return this.send(ws, "FLOOR_ERROR", { message: "That's more than you have on the table." });

    let won = 0, detail = null, title = "";

    if (msg.game === "roulette") {
      const rule = ROULETTE_BETS.find((b) => b.id === msg.pick);
      if (!rule) { p.table += bet; return this.send(ws, "FLOOR_ERROR", { message: "No such bet." }); }
      const n = Math.floor(Math.random() * ROULETTE_POCKETS);
      const hit = rouletteWins(rule.id, msg.number, n);
      if (hit) won = bet + bet * rule.pays;
      title = `Roulette \u2014 ${pocketName(n)}`;
      detail = { pocket: pocketName(n), bet: rule.name, hit };

    } else if (msg.game === "bigsix") {
      const rule = BIGSIX.find((b) => b.id === msg.pick);
      if (!rule) { p.table += bet; return this.send(ws, "FLOOR_ERROR", { message: "No such symbol." }); }
      const landed = spinBigSix();
      const hit = landed === rule.id;
      if (hit) won = bet + bet * rule.pays;
      title = `Big Six \u2014 ${BIGSIX.find((b) => b.id === landed).name}`;
      detail = { landed, bet: rule.name, hit };

    } else {
      p.table += bet;
      return this.send(ws, "FLOOR_ERROR", { message: "That table isn't open." });
    }

    p.table += won;
    // Win or push and the token stays; only a loss spends it.
    if (won < bet) p.tokens = Math.max(0, (p.tokens || 0) - 1);
    const award = won > bet ? await this.reward(uid, p) : 0;
    await this.save();
    this.note(won > bet ? `${p.name} won ${won - bet} at ${title}${this.plus(award)}.`
      : won === bet ? `${p.name} pushed at ${title}.`
      : `${p.name} lost $${bet} at ${title}.`);
    this.send(ws, "TABLE_RESULT", { game: msg.game, title, detail, staked: bet, returned: won, mmr: award });
    this.push();
  }

  /** Opens a hand at one of the two-stage tables. */
  async tableDeal(ws, uid, msg) {
    const p = this.f.players[uid];
    if (!p) return;
    // A hand nobody has touched in five minutes is one the client has lost
    // rather than one being played, so it clears itself and the token goes
    // with it. Below that, an open hand at this table is handed straight back:
    // closing the overlay mid-hand used to strand it, and every later deal was
    // refused by a message that appeared behind the window.
    if (p.hand && Date.now() - (p.hand.dealtAt || 0) > 5 * 60_000) {
      this.note(`${p.name}'s abandoned ${p.hand.game} hand was cleared.`);
      p.hand = null;
      p.tokens = Math.max(0, (p.tokens || 0) - 1);
    }

    if (p.hand && p.hand.game === msg.game) return this.resumeHand(ws, p);
    if (p.hand) {
      // Naming the table isn't enough: from another table there is nothing the
      // player can do about it. The client gets what it needs to offer a way
      // back to that hand, or a way to give it up from here.
      return this.send(ws, "TABLE_BLOCKED", {
        game: p.hand.game,
        wanted: msg.game,
        message: `You still have a hand open at ${p.hand.game}.`,
      });
    }
    if (this.noToken(ws, p)) return;

    const ante = this.take(p, msg.ante);
    if (ante === null)
      return this.send(ws, "FLOOR_ERROR", { message: "That's more than you have on the table." });

    const d = freshDeck(1);

    if (msg.game === "hilo") {
      // One card face up, and the bet is down. The calls come next, once the
      // player has seen what they are calling against — that is the whole
      // difference between this and guessing blind.
      const base = d.pop();
      p.hand = { game: "hilo", ante, base, dealtAt: Date.now() };
      await this.save();
      this.push();
      return this.send(ws, "TABLE_HAND", { game: "hilo", cards: [base], ante, rank: "Call it" });
    }

    if (msg.game === "threecard") {
      let side = 0;
      if (msg.side > 0) {
        side = this.take(p, msg.side);
        if (side === null) {
          p.table += ante;
          return this.send(ws, "FLOOR_ERROR", { message: "Not enough for the side bet too." });
        }
      }
      const mine = [d.pop(), d.pop(), d.pop()];
      const dealer = [d.pop(), d.pop(), d.pop()];
      p.hand = { game: "threecard", ante, side, mine, dealer, dealtAt: Date.now() };
      await this.save();
      this.push();
      return this.send(ws, "TABLE_HAND", {
        game: "threecard", cards: mine, ante, side, rank: rankThree(mine).name,
      });
    }

    if (msg.game === "holdem") {
      // The ante taken above is the buy-in; the rest is bet street by street.
      const level = AI_LEVELS.some((l) => l.id === msg.level) ? msg.level : "medium";
      p.ai = p.ai || { hands: 0, bets: 0, staked: 0 };
      const hole = [d.pop(), d.pop()];
      // Dealt off the top like everything else. Difficulty is about how the
      // dealer bets, never about what it holds.
      const theirs = [d.pop(), d.pop()];
      const board = [d.pop(), d.pop(), d.pop()];
      p.ai.hands += 1;
      p.hand = {
        game: "holdem", hole, dealerHole: theirs, board,
        rest: d.slice(-8), wagers: [ante], street: "flop", level,
        pending: 0, dealerSaid: "waiting on you", dealtAt: Date.now(),
      };
      await this.save();
      this.push();
      return this.send(ws, "TABLE_HAND", {
        game: "holdem", cards: hole, board, ante, street: "flop", level,
        staked: ante, rank: bestOfSeven([...hole, ...board]).name,
      });
    }

    if (msg.game === "paigow") {
      let fortune = 0, aceBonus = 0;
      for (const [key, amount] of [["fortune", msg.fortune], ["aceBonus", msg.aceBonus]]) {
        if (!(amount > 0)) continue;
        const taken = this.take(p, amount);
        if (taken === null) {
          p.table += ante + fortune + aceBonus;
          return this.send(ws, "FLOOR_ERROR", { message: "Not enough for the side bets too." });
        }
        if (key === "fortune") fortune = taken; else aceBonus = taken;
      }
      const pack = pyGowDeck();
      const mine = pack.splice(0, 7);
      const dealer = pack.splice(0, 7);
      p.hand = { game: "paigow", ante, fortune, aceBonus, mine, dealer, dealtAt: Date.now() };
      await this.save();
      this.push();
      const suggestion = houseWay(mine);
      return this.send(ws, "TABLE_HAND", {
        game: "paigow", cards: mine, dealer, ante, fortune, aceBonus,
        houseWay: suggestion ? suggestion.low : [0, 1],
      });
    }

    if (msg.game === "crisscross") {
      // Two equal antes, one for each arm of the cross.
      const second = this.take(p, ante);
      if (second === null) {
        p.table += ante;
        return this.send(ws, "FLOOR_ERROR", { message: "Criss Cross needs two equal antes." });
      }
      let bonus = 0;
      if (msg.bonus > 0) {
        bonus = this.take(p, msg.bonus);
        if (bonus === null) {
          p.table += ante * 2;
          return this.send(ws, "FLOOR_ERROR", { message: "Not enough for the bonus too." });
        }
      }
      const hole = [d.pop(), d.pop()];
      // left, right, top, bottom, middle — the middle belongs to both arms.
      const cross = [d.pop(), d.pop(), d.pop(), d.pop(), d.pop()];
      p.hand = { game: "crisscross", ante, bonus, hole, cross, stage: "across", bets: {}, dealtAt: Date.now() };
      await this.save();
      this.push();
      return this.send(ws, "TABLE_HAND", {
        game: "crisscross", cards: hole, ante, bonus, stage: "across",
      });
    }

    if (msg.game === "fivecard") {
      const mine = [d.pop(), d.pop(), d.pop(), d.pop(), d.pop()];
      p.hand = { game: "fivecard", ante, mine, rest: d.slice(-10), dealtAt: Date.now() };
      await this.save();
      this.push();
      return this.send(ws, "TABLE_HAND", {
        game: "fivecard", cards: mine, ante, rank: rankFive(mine).name,
      });
    }

    p.table += ante;
    return this.send(ws, "FLOOR_ERROR", { message: "That table isn't open." });
  }

  /**
   * The street is over: turn the next card, or turn everything over.
   * Reached after the dealer checks, calls, or has its bet called.
   */
  async holdemNext(ws, p, h) {
    if (h.street === "flop" || h.street === "turn") {
      h.board.push(h.rest.pop());
      h.street = h.street === "flop" ? "turn" : "river";
      await this.save();
      this.push();
      return this.send(ws, "TABLE_HAND", {
        game: "holdem", cards: h.hole, board: h.board, street: h.street, level: h.level,
        staked: h.wagers.reduce((a, b) => a + b, 0), dealerSaid: h.dealerSaid, pending: 0,
        rank: bestOfSeven([...h.hole, ...h.board].slice(0, 7)).name,
      });
    }

    const out = holdemSettle(h.hole, h.dealerHole, h.board, h.wagers);
    const title = `Hold'em \u2014 ${out.outcome === "win" ? `your ${out.mine.name} beats ${out.theirs.name}`
      : out.outcome === "push" ? "split pot"
      : `dealer's ${out.theirs.name} beats your ${out.mine.name}`}`;
    p.hand = null;
    p.table += out.returned;
    if (out.outcome === "loss") p.tokens = Math.max(0, (p.tokens || 0) - 1);
    const award = out.outcome === "win" ? await this.reward(p.uid, p) : 0;
    await this.save();
    this.note(out.outcome === "win" ? `${p.name} won ${out.returned - out.staked} at Hold'em${this.plus(award)}.`
      : out.outcome === "push" ? `${p.name} pushed $${out.staked} at Hold'em.`
      : `${p.name} lost $${out.staked} at Hold'em.`);
    this.send(ws, "TABLE_RESULT", {
      game: "holdem", title, staked: out.staked, returned: out.returned, mmr: award,
      detail: {
        board: h.board, dealer: h.dealerHole, mineRank: out.mine.name,
        dealerRank: out.theirs.name, outcome: out.outcome,
      },
    });
    this.push();
  }

  /** Hands the player back the hand they walked away from. */
  resumeHand(ws, p) {
    const h = p.hand;
    const common = { game: h.game, ante: h.ante, resumed: true };
    if (h.game === "hilo") return this.send(ws, "TABLE_HAND", { ...common, cards: [h.base], rank: "Call it" });
    if (h.game === "holdem") {
      return this.send(ws, "TABLE_HAND", {
        ...common, cards: h.hole, board: h.board, street: h.street,
        staked: h.wagers.reduce((a, b) => a + b, 0), level: h.level,
        pending: h.pending || 0, dealerSaid: h.dealerSaid,
        rank: bestOfSeven([...h.hole, ...h.board].slice(0, 7)).name,
      });
    }
    if (h.game === "paigow") {
      const suggestion = houseWay(h.mine);
      return this.send(ws, "TABLE_HAND", {
        ...common, cards: h.mine, dealer: h.dealer,
        fortune: h.fortune, aceBonus: h.aceBonus,
        houseWay: suggestion ? suggestion.low : [0, 1],
      });
    }
    if (h.game === "crisscross") {
      const seen = h.stage === "down" ? h.cross.slice(0, 2)
        : h.stage === "middle" ? h.cross.slice(0, 4) : [];
      return this.send(ws, "TABLE_HAND", { ...common, cards: h.hole, stage: h.stage, revealed: seen });
    }
    return this.send(ws, "TABLE_HAND", {
      ...common, cards: h.mine, side: h.side,
      rank: h.game === "threecard" ? rankThree(h.mine).name : rankFive(h.mine).name,
    });
  }

  /**
   * Ends the hand where it stands.
   *
   * Everything already staked is forfeit, because the cards are out and there
   * is no honest way to hand a bet back once a player has seen them. It exists
   * so nobody is ever stuck waiting on a hand they no longer want to play.
   */
  async tableEnd(ws, uid) {
    const p = this.f.players[uid];
    const h = p?.hand;
    if (!h) return this.send(ws, "FLOOR_ERROR", { message: "No hand open." });

    const lost = (h.ante || 0) + (h.side || 0) + (h.bonus || 0) + (h.fortune || 0)
      + (h.aceBonus || 0)
      + (h.wagers ? h.wagers.reduce((a, b) => a + b, 0) : 0)
      + Object.values(h.bets || {}).reduce((a, b) => a + b, 0);

    p.hand = null;
    p.tokens = Math.max(0, (p.tokens || 0) - 1);
    await this.save();
    this.note(`${p.name} ended a hand of ${h.game}, forfeiting $${lost}.`);
    this.send(ws, "TABLE_RESULT", {
      game: h.game, title: "Hand ended", staked: lost, returned: 0,
      detail: { ended: true },
    });
    this.push();
  }

  /**
   * What a split would rank as, before it is committed.
   *
   * Pai gow's screen shows the two hands a pick would make as the player taps,
   * and the client cannot rank cards — ranking lives here, with the joker
   * rules, and is not duplicated in the browser. So the client asks. Nothing
   * is staked or settled by this; it is a question, not a move.
   */
  tablePeek(ws, uid, msg) {
    const h = this.f.players[uid]?.hand;
    if (!h || h.game !== "paigow") return;
    const low = Array.isArray(msg.low) && msg.low.length === 2 ? msg.low.map(Number) : null;
    if (!low || low.some((i) => !(i >= 0 && i < 7)) || low[0] === low[1]) return;
    const lowRank = rankTwo(low.map((i) => h.mine[i]));
    const highRank = rankFiveWithJoker(h.mine.filter((_, i) => !low.includes(i)));
    this.send(ws, "TABLE_PEEK", {
      low, high: highRank.name, lowName: lowRank.name,
      valid: compare2(highRank, lowRank) > 0,
    });
  }

  /** The second half: play or fold, draw or stand. */
  async tableAct(ws, uid, msg) {
    const p = this.f.players[uid];
    const h = p?.hand;
    if (!h) return this.send(ws, "FLOOR_ERROR", { message: "No hand open." });

    let won = 0, title = "", detail = null;

    if (h.game === "hilo") {
      // The second card comes off a fresh deck less the one showing, so the
      // same card can never turn up twice.
      const rest = freshDeck(1).filter((c) => !(c.rank === h.base.rank && c.suit === h.base.suit));
      const next = rest.pop();
      const higher = !!msg.higher, eightUp = !!msg.eightUp;
      const r = hiLoResult(h.base, next, higher, eightUp);
      won = r.push ? h.ante : r.won ? h.ante * 2 : 0;
      title = `Hi-Lo \u2014 ${r.push ? "push" : r.won ? "both calls" : r.why}`;
      detail = {
        base: h.base, next, higher, eightUp,
        won: r.won, push: r.push, why: r.why,
        gotDirection: !!r.gotDirection, gotBand: !!r.gotBand,
      };

    } else if (h.game === "threecard") {
      const mine = rankThree(h.mine), dealer = rankThree(h.dealer);

      if (msg.move === "fold") {
        title = "Three-Card Poker \u2014 folded";
        detail = { folded: true, dealer: h.dealer, dealerRank: dealer.name, mineRank: mine.name };
      } else {
        const play = this.take(p, h.ante);
        if (play === null)
          return this.send(ws, "FLOOR_ERROR", { message: "Playing costs the ante again, and you're short." });

        const beat = compare(mine, dealer);
        if (!dealerQualifies(dealer)) {
          won += h.ante * 2 + play;
          title = "Three-Card Poker \u2014 dealer didn't qualify";
        } else if (beat > 0) {
          won += (h.ante + play) * 2;
          title = `Three-Card Poker \u2014 your ${mine.name} beats ${dealer.name}`;
        } else if (beat === 0) {
          won += h.ante + play;
          title = "Three-Card Poker \u2014 push";
        } else {
          title = `Three-Card Poker \u2014 dealer's ${dealer.name} beats your ${mine.name}`;
        }
        const bonus = ANTE_BONUS.find((b) => b.rank === mine.rank);
        if (bonus) won += h.ante * bonus.pays;
        detail = {
          dealer: h.dealer, dealerRank: dealer.name, mineRank: mine.name,
          bonus: bonus ? `${bonus.name} ${bonus.pays}:1` : null,
        };
      }

      if (h.side > 0) {
        const pp = PAIR_PLUS.find((b) => b.rank === mine.rank);
        if (pp) won += h.side + h.side * pp.pays;
        detail = { ...detail, pairPlus: pp ? `${pp.name} ${pp.pays}:1` : "no pair" };
      }

    } else if (h.game === "fivecard") {
      const toss = Array.isArray(msg.discards) ? msg.discards.filter((i) => i >= 0 && i < 5) : [];
      const final = h.mine.filter((_, i) => !toss.includes(i));
      while (final.length < 5) final.push(h.rest.pop());

      const hand = rankFive(final);
      const row = drawPayout(hand);
      if (row) won = h.ante + h.ante * row.pays;
      title = `Five-Card Draw \u2014 ${hand.name}`;
      detail = { cards: final, rank: hand.name, pays: row ? row.pays : 0 };

    } else if (h.game === "holdem") {
      p.ai = p.ai || { hands: 0, bets: 0, staked: 0 };

      // The dealer has bet into you, so the only answers are call or fold.
      if (h.pending > 0) {
        if (msg.move === "fold") {
          const lost = h.wagers.reduce((a, b) => a + b, 0);
          p.hand = null;
          p.tokens = Math.max(0, (p.tokens || 0) - 1);
          await this.save();
          this.note(`${p.name} folded to the dealer at Hold'em, losing $${lost}.`);
          this.send(ws, "TABLE_RESULT", {
            game: "holdem", title: "Hold'em \u2014 you folded",
            detail: { folded: true, dealer: h.dealerHole, board: h.board },
            staked: lost, returned: 0,
          });
          this.push();
          return;
        }
        const call = this.take(p, h.pending);
        if (call === null)
          return this.send(ws, "FLOOR_ERROR", { message: "You can't cover that call." });
        h.wagers.push(call);
        h.pending = 0;
        h.dealerSaid = "you called";
        // A called bet ends the street.
        return await this.holdemNext(ws, p, h);
      }

      if (msg.move === "bet") {
        const raw = Math.round(Number(msg.amount) || 0);
        if (raw < BET_STEP || raw % BET_STEP !== 0)
          return this.send(ws, "FLOOR_ERROR", { message: `Bets go in $${BET_STEP} steps.` });
        const taken = this.take(p, raw);
        if (taken === null)
          return this.send(ws, "FLOOR_ERROR", { message: "That's more than you have." });
        h.wagers.push(taken);
        p.ai.bets += 1;
        p.ai.staked += taken;
        h.facing = taken;
      } else h.facing = 0;

      // Now the dealer answers.
      const strength = strengthOf(h.dealerHole, h.board);
      const act = dealerAct(strength, h.facing || 0, h.level, p.ai);

      if (act.move === "fold") {
        const staked = h.wagers.reduce((a, b) => a + b, 0);
        p.hand = null;
        p.table += staked * 2;
        await this.save();
        this.note(`${p.name} won $${staked} at Hold'em \u2014 the dealer folded.`);
        this.send(ws, "TABLE_RESULT", {
          game: "holdem", title: "Hold'em \u2014 the dealer folded",
          detail: { dealerFolded: true, dealer: h.dealerHole, board: h.board },
          staked, returned: staked * 2,
        });
        this.push();
        return;
      }

      if (act.move === "bet" || act.move === "raise") {
        const pot = h.wagers.reduce((a, b) => a + b, 0);
        const size = act.move === "raise"
          ? Math.max(5, Math.round((act.amount || h.facing * 2) / 5) * 5)
          : Math.max(5, Math.round((pot * 0.5) / 5) * 5);
        h.pending = size;
        h.dealerSaid = act.move === "raise" ? `the dealer raises ${size}` : `the dealer bets ${size}`;
        await this.save();
        this.push();
        return this.send(ws, "TABLE_HAND", {
          game: "holdem", cards: h.hole, board: h.board, street: h.street, level: h.level,
          staked: pot, pending: size, dealerSaid: h.dealerSaid,
          rank: bestOfSeven([...h.hole, ...h.board].slice(0, 7)).name,
        });
      }

      h.dealerSaid = act.move === "call" ? "the dealer calls" : "the dealer checks";
      return await this.holdemNext(ws, p, h);

    } else if (h.game === "paigow") {
      const low = Array.isArray(msg.low) && msg.low.length === 2 ? msg.low : null;
      if (!low) return this.send(ws, "FLOOR_ERROR", { message: "Pick two cards for the low hand." });

      const lowCards = low.map((i) => h.mine[i]);
      const highCards = h.mine.filter((_, i) => !low.includes(i));
      const mineSplit = { lowRank: rankTwo(lowCards), highRank: rankFiveWithJoker(highCards) };
      if (compare2(mineSplit.highRank, mineSplit.lowRank) <= 0)
        return this.send(ws, "FLOOR_ERROR", { message: "Your five-card hand has to outrank your two." });

      const dealerSplit = houseWay(h.dealer);
      const out = paiGowSettle(mineSplit, dealerSplit);
      if (out.outcome === "win") won += h.ante * 2;
      else if (out.outcome === "push") won += h.ante;

      // The side bets are settled on their own terms, win or lose.
      if (h.fortune > 0) {
        const row = fortuneAward(h.mine);
        if (row) won += h.fortune + h.fortune * row.pays;
        detail = { ...detail, fortune: row ? `${row.name} ${row.pays}:1` : "no fortune" };
      }
      if (h.aceBonus > 0 && playsAceHigh(dealerSplit)) {
        const mineAceHigh = mineSplit.highRank.rank === 0 && mineSplit.highRank.tie[0] === 14;
        const joker = h.dealer.some((c) => c.joker);
        const row = ACE_HIGH_BONUS.find((b) =>
          b.id === (mineAceHigh ? "both" : joker ? "joker" : "plain"));
        won += h.aceBonus + h.aceBonus * row.pays;
        detail = { ...detail, aceBonus: `${row.name} ${row.pays}:1` };
      }

      title = `Pai Gow \u2014 ${out.why}`;

      // Everything the result screen lays out: both splits as cards, and a
      // line per bet with what it did and what it was worth.
      const pgNet = out.outcome === "win" ? h.ante : out.outcome === "push" ? 0 : -h.ante;
      const pgText = out.outcome === "win" ? "won both hands"
        : out.outcome === "loss" ? "dealer took both hands"
        : playsAceHigh(dealerSplit) ? "dealer played ace-high \u2192 push"
        : "split \u2014 won one, lost one \u2192 push";
      const lines = [{ name: "Pai Gow", stake: h.ante, text: pgText, net: pgNet, tag: out.outcome }];
      if (h.fortune > 0) {
        const row = fortuneAward(h.mine);
        lines.push({
          name: "Fortune Bonus", stake: h.fortune,
          text: row ? `${row.name} \u00b7 pays ${row.pays}:1` : "no qualifying hand",
          net: row ? h.fortune * row.pays : -h.fortune, tag: row ? "win" : "loss",
        });
      }
      if (h.aceBonus > 0) {
        const played = playsAceHigh(dealerSplit);
        const mineAceHigh = mineSplit.highRank.rank === 0 && mineSplit.highRank.tie[0] === 14;
        const joker = h.dealer.some((c) => c.joker);
        const row = played ? ACE_HIGH_BONUS.find((b) =>
          b.id === (mineAceHigh ? "both" : joker ? "joker" : "plain")) : null;
        lines.push({
          name: "Ace-High Bonus", stake: h.aceBonus,
          text: row ? `${row.name} \u00b7 pays ${row.pays}:1` : "dealer did not play Ace-High",
          net: row ? h.aceBonus * row.pays : -h.aceBonus, tag: row ? "win" : "loss",
        });
      }

      detail = {
        ...detail, dealer: h.dealer, outcome: out.outcome,
        mineHigh: mineSplit.highRank.name, mineLow: mineSplit.lowRank.name,
        dealerHigh: dealerSplit.highRank.name, dealerLow: dealerSplit.lowRank.name,
        mineHighCards: highCards, mineLowCards: lowCards,
        dealerHighCards: dealerSplit.highCards, dealerLowCards: dealerSplit.lowCards,
        lines, net: lines.reduce((a, l) => a + l.net, 0),
      };

    } else if (h.game === "crisscross") {
      const mult = Math.min(3, Math.max(1, Math.round(Number(msg.mult) || 1)));
      const folded = msg.move === "fold";

      if (h.stage === "across" || h.stage === "down") {
        if (!folded) {
          const taken = this.take(p, h.ante * mult);
          if (taken === null)
            return this.send(ws, "FLOOR_ERROR", { message: "That's more than you have." });
          h.bets[h.stage] = taken;
        } else h.bets[h.stage] = 0;

        h.stage = h.stage === "across" ? "down" : "middle";
        await this.save();
        this.push();
        return this.send(ws, "TABLE_HAND", {
          game: "crisscross", cards: h.hole, ante: h.ante, stage: h.stage,
          // The arm just bet on turns over.
          revealed: h.stage === "down" ? h.cross.slice(0, 2)
            : [...h.cross.slice(0, 2), ...h.cross.slice(2, 4)],
        });
      }

      // Middle: the last card turns and both arms settle.
      if (!folded) {
        const taken = this.take(p, h.ante * mult);
        if (taken === null)
          return this.send(ws, "FLOOR_ERROR", { message: "That's more than you have." });
        h.bets.middle = taken;
      } else h.bets.middle = 0;

      const [left, right, top, bottom, middle] = h.cross;
      const acrossHand = bestOfSeven([...h.hole, left, right, middle]);
      const downHand = bestOfSeven([...h.hole, top, bottom, middle]);

      const a = crossLine(acrossHand, h.ante, h.bets.across || 0);
      const dn = crossLine(downHand, h.ante, h.bets.down || 0);
      won += a.paid + dn.paid;

      // The middle rides on whichever arm did better.
      const best = compare2(acrossHand, downHand) >= 0 ? acrossHand : downHand;
      const mid = crossLine(best, 0, h.bets.middle || 0);
      won += mid.paid;

      if (h.bonus > 0) {
        const bonusHand = bestOfSeven([...h.cross, h.cross[0], h.cross[1]].slice(0, 7));
        const row = crossRow(bonusHand, BONUS_PAYS, 6);
        if (row) won += h.bonus + h.bonus * row.pays;
        detail = { ...detail, bonus: row ? `${row.name} ${row.pays}:1` : "no bonus" };
      }

      title = `Criss Cross \u2014 ${a.row ? a.row.name : a.push ? "push" : "no pay"} across, ` +
        `${dn.row ? dn.row.name : dn.push ? "push" : "no pay"} down`;
      detail = {
        ...detail, cross: h.cross, acrossRank: acrossHand.name, downRank: downHand.name,
      };

    } else {
      p.hand = null;
      return this.send(ws, "FLOOR_ERROR", { message: "That hand can't be played." });
    }

    p.hand = null;
    p.table += won;
    const stakedTotal = (h.ante || 0) + (h.side || 0) + (h.bonus || 0) + (h.fortune || 0)
      + (h.aceBonus || 0) + Object.values(h.bets || {}).reduce((a, b) => a + b, 0);
    if (won < stakedTotal) p.tokens = Math.max(0, (p.tokens || 0) - 1);
    const award = won > stakedTotal ? await this.reward(uid, p) : 0;
    await this.save();
    this.note(won > stakedTotal ? `${p.name} won ${won - stakedTotal} at ${title}${this.plus(award)}.`
      : won === stakedTotal ? `${p.name} pushed at ${title}.`
      : `${p.name} lost $${stakedTotal - won} at ${title}.`);
    this.send(ws, "TABLE_RESULT", { game: h.game, title, detail, staked: stakedTotal, returned: won, mmr: award });
    this.push();
  }

  async bankOut(ws, uid) {
    const p = this.f.players[uid];
    const amount = Math.max(0, Math.round(p.table));
    if (!amount) return this.send(ws, "FLOOR_ERROR", { message: "Nothing on the table to bank." });
    if (this.f.table.seats[uid])
      return this.send(ws, "FLOOR_ERROR", { message: "Leave the table first." });
    if (this.f.bets.some((b) => b.uid === uid) && this.f.phase !== "PAID")
      return this.send(ws, "FLOOR_ERROR", { message: "You have money on a race. Wait for it to finish." });

    p.table = 0;
    await this.save();

    let banked = false;
    // Tokens belong to the session, not the wallet: ending the match spends
    // the day's supply and the next one starts fresh from the arcade.
    p.tokens = 0;
    // Only money stacks.
    try { banked = await bankWallet(this.env, uid, amount, p.name); } catch { banked = false; }

    if (!banked) {
      // Nothing was written, so it goes back where it was. Better a delay
      // than a quietly vanished balance.
      p.table = amount;
      await this.save();
      this.push();
      return this.send(ws, "FLOOR_ERROR", { message: "Couldn't reach your wallet. Nothing was moved." });
    }

    await this.save();

    // A finished session is a game played, so it belongs in Past Games with
    // the rest. No MMR moves: the money is the whole result.
    writeHistory(this.env, uid, {
      game: "casino", mode: "floor", solo: false,
      score: amount, gain: p.mmrEarned || 0, field: 1, placement: null,
      elapsedMs: null, status: `banked $${amount}`,
      finishedAt: Date.now(),
    }).catch(() => {});

    // And the feed, which it never reached: the casino wrote its own history
    // rows and nothing else, so a night on the floor left no trace anywhere
    // the rest of the arena could see.
    postFeed(this.env, {
      kind: "game", name: p.name,
      text: `${p.name} left the casino with $${amount.toLocaleString()}`,
      detail: p.mmrEarned
        ? `banked $${amount.toLocaleString()} \u00b7 +${p.mmrEarned} MMR at the arcade`
        : `banked $${amount.toLocaleString()}`,
    }).catch(() => {});

    p.mmrEarned = 0;

    this.note(`${p.name} banked $${amount}.`);
    this.send(ws, "FLOOR_BANKED", { amount });
    this.push();
  }

  // ------------------------------------------------------------------ alarms

  async alarm() {
    if (!this.f) return;
    const now = Date.now();
    const due = this.f.due || {};

    // The race and the table are settled independently, because either can be
    // waiting while the other is what actually came due.
    if (due.race && now >= due.race) {
      await this.due("race", null);
      if (this.f.phase === "RUNNING") await this.runTick();
      else if (this.f.phase === "PAID") await this.newRace();
    }

    const t = this.f.table;
    if (due.table && now >= due.table) {
      await this.due("table", null);
      if (t.phase === "ACTING") {
        this.note("Time. Standing everyone still deciding.");
        for (const s of Object.values(t.seats)) s.done = true;
        await this.maybeSettle(true);
      } else if (t.phase === "SETTLED") {
        await this.clearTable();
      }
    }

    if (due.idle && now >= due.idle) {
      await this.due("idle", null);
      if (this.sockets().length === 0) {
        await this.state.storage.deleteAll();
        this.f = null;
        return;
      }
    }

    await this.rearm();
  }

  async webSocketClose(ws) { await this.onGone(ws); }
  async webSocketError(ws) { await this.onGone(ws); }

  async onGone(ws) {
    if (!this.f) return;
    // A player who walks away keeps their table money for when they return;
    // it is only ever theirs, and only banking moves it to a wallet.
    this.push();
    if (this.online().size === 0 && this.f.phase !== "RUNNING") {
      await this.due("idle", Date.now() + IDLE_MS);
    }
  }
}
