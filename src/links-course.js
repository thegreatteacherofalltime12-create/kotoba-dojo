import {
  COURSES, DIFF, PAR_LEN, courseById, poolFor, evaluate,
  pointsFor, scoreName, maxGuesses, scramble, sameLetters, placed,
} from "./links.js";
import { recordMatch, readRatings } from "./firestore.js";
import { announceRoom } from "./rooms.js";
import { sessionGain, fieldMmrFor, beltFor } from "./mmr.js";

const TICK = 1000;

/**
 * A round of Multiverse Golf.
 *
 * Everyone in the room plays the same eighteen holes with the same words, at
 * their own pace, and the lowest total wins — stroke play rather than a race,
 * because a race would reward whoever types fastest rather than whoever guesses
 * best.
 *
 * The answers live here and are never sent to the browser. A guess comes in,
 * hit/near/miss goes back, and the ball's position is derived from that here
 * too — the client draws what it is told rather than working anything out.
 */
export class LinksCourse {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.socks = new Map();       // ws -> uid
    state.blockConcurrencyWhile(async () => {
      this.room = (await state.storage.get("room")) || null;
    });
  }

  /** A course at random, for the room that asked not to choose. */
  rollCourse() {
    return COURSES[Math.floor(Math.random() * COURSES.length)].id;
  }

  blank(code, courseId, diff, dict, solo) {
    // "random" is remembered rather than resolved once: a room that asked for
    // a random course gets a fresh one every round, not the same one twice.
    const random = courseId === "random";
    const course = courseById(random ? this.rollCourse() : courseId);
    return {
      code,
      phase: "LOBBY",
      solo: !!solo,
      hostUid: null,
      randomCourse: random,
      courseId: course.id,
      diff: DIFF[diff] ? diff : "medium",
      dict: dict === "modern" ? "modern" : "classic",
      holes: 18,
      players: {},           // uid -> player
      startedAt: 0,
      roundNo: 0,
      board: null,           // the words, once the round starts
    };
  }

  /**
   * The words for every hole, drawn once when the round starts.
   *
   * Drawn here rather than per player so the field is playing the same course:
   * a scorecard only means something if everybody faced the same holes.
   */
  drawBoard(room) {
    const course = courseById(room.courseId);
    const perHole = DIFF[room.diff].words;
    const used = new Set();
    const board = [];

    for (let h = 0; h < room.holes; h++) {
      const par = course.pars[h];
      const len = PAR_LEN[par] || 5;
      const pool = poolFor(room.dict, len, room.diff);
      const words = [];
      for (let w = 0; w < perHole; w++) {
        let pick, tries = 0;
        do { pick = pool[Math.floor(Math.random() * pool.length)]; tries++; }
        while (used.has(pick[0]) && tries < 80);
        used.add(pick[0]);
        // Scrambled here, once, so everyone in the room is handed the same
        // letters in the same order. A per-player shuffle would make two
        // players’ cards on the same hole not quite the same hole.
        words.push({ answer: pick[0], clue: pick[1], scrambled: scramble(pick[0]) });
      }
      board.push({ par, len, words });
    }
    return board;
  }

  freshPlayer(uid, name) {
    return {
      uid, name,
      hole: 0,
      wordIndex: 0,
      strokes: 0,
      guesses: [],          // marks for the word in play, for redraw on reload
      card: [],             // strokes per finished hole
      points: 0,
      ball: 0,              // 0 at the tee, 1 in the cup
      done: false,
      lastSeen: Date.now(),
    };
  }

  /* ── the round ─────────────────────────────────────────────────── */

  /**
   * Whose call it is to tee off.
   *
   * The first player through the door holds it, so a round cannot begin under
   * someone who is still picking a course. If they have gone, it falls to
   * whoever is actually connected — a room that no longer has its host is
   * still a room, and it must not be left unable to start.
   */
  canStart(uid) {
    const room = this.room;
    if (!room) return false;
    if (!room.hostUid || room.hostUid === uid) return true;
    return !new Set(this.socks.values()).has(room.hostUid);
  }

  async start(ws, uid) {
    const room = this.room;
    if (!room || room.phase === "PLAYING") return;
    if (!this.canStart(uid)) {
      this.send(ws, "LINKS_REJECT", { why: "The player who opened this room calls the start." });
      return;
    }
    // A random room draws a new course each round, so a rematch is a new one.
    if (room.randomCourse) room.courseId = this.rollCourse();
    room.board = this.drawBoard(room);
    room.phase = "PLAYING";
    room.startedAt = Date.now();
    room.roundNo += 1;
    for (const p of Object.values(room.players)) {
      Object.assign(p, this.freshPlayer(p.uid, p.name));
    }

    // Ratings are read once, at the off. Everything the curve needs — how
    // strong the field is, where each player was seeded in it — has to be the
    // picture before anyone swung, not after.
    const uids = Object.keys(room.players);
    let ratings = {};
    try { ratings = await readRatings(this.env, uids); } catch { /* unranked */ }
    const seeded = [...uids].sort((a, b) => (ratings[b] || 0) - (ratings[a] || 0));
    for (const p of Object.values(room.players)) {
      p.mmrAtStart = ratings[p.uid] || 0;
      p.seed = seeded.indexOf(p.uid) + 1 || null;
    }

    await this.save();
    this.pushAll();
    this.broadcast("LINKS_START", { at: room.startedAt, holes: room.holes });
  }

  /** What the player may see of the hole they are standing on. */
  holeView(room, p) {
    if (!room.board) return null;
    const hole = room.board[p.hole];
    if (!hole) return null;
    const course = courseById(room.courseId);
    const multi = DIFF[room.diff].words > 1;
    return {
      no: p.hole + 1,
      name: course.names?.[p.hole] || null,
      yards: course.yards[p.hole],
      cardPar: hole.par,
      par: multi ? DIFF[room.diff].words : hole.par,
      len: hole.len,
      hazard: course.haz?.[p.hole] || null,
      // The clue, but never the word. On the hard tee it is withheld until
      // two words are behind you, exactly as the single-player game had it.
      clue: (room.diff === "hard" && p.wordIndex < 2) ? null : hole.words[p.wordIndex]?.clue,
      // The letters, in the order they were dealt. The answer is these
      // letters put right, and it is the one thing this view never carries.
      scrambled: hole.words[p.wordIndex]?.scrambled || null,
      wordIndex: p.wordIndex,
      wordsTotal: DIFF[room.diff].words,
      maxGuesses: maxGuesses(hole.par, room.diff),
      guesses: p.guesses,
      strokes: p.strokes,
      ball: p.ball,
    };
  }

  async guess(ws, uid, msg) {
    const room = this.room;
    const p = room?.players?.[uid];
    if (!room || room.phase !== "PLAYING" || !p || p.done) return;

    const hole = room.board[p.hole];
    if (!hole) return;
    const word = hole.words[p.wordIndex];
    const g = String(msg.word || "").toUpperCase().replace(/[^A-Z]/g, "");

    if (g.length !== hole.len) return this.send(ws, "LINKS_REJECT", { why: "wrong length" });
    if (!sameLetters(g, word.answer))
      return this.send(ws, "LINKS_REJECT", { why: "use the letters you were dealt" });

    // Every letter is in hand, so the ball goes as far as the letters that
    // landed in the right place — not the half-credit the guessing game gave
    // for a right letter in the wrong spot, which here would be every letter.
    const marks = evaluate(g, word.answer);
    const q = placed(marks);
    const solved = g === word.answer;
    const multi = DIFF[room.diff].words > 1;

    p.guesses.push({ word: g, marks });

    // Easy counts every guess as a stroke. The multi-word tees count each word
    // solved as one shot down the fairway, so the ball only moves on a solve.
    if (!multi) p.strokes += 1;
    p.ball = multi
      ? (p.wordIndex + (solved ? 1 : 0)) / DIFF[room.diff].words
      : Math.max(p.ball, q);

    const out = { marks, solved, ball: p.ball, strokes: p.strokes };

    if (solved) {
      if (multi) {
        p.strokes += 1;
        p.wordIndex += 1;
        p.guesses = [];
        if (p.wordIndex >= DIFF[room.diff].words) await this.holeOut(p, room, out);
        else out.nextWord = true;
      } else {
        await this.holeOut(p, room, out);
      }
    } else if (p.guesses.length >= maxGuesses(hole.par, room.diff)) {
      // Out of guesses on this word. In the single-word game that is the hole
      // conceded; in the multi-word tees it costs a shot and moves you on.
      if (multi) {
        p.strokes += 2;                       // a penalty, not a free pass
        p.wordIndex += 1;
        p.guesses = [];
        out.conceded = word.answer;
        if (p.wordIndex >= DIFF[room.diff].words) await this.holeOut(p, room, out);
        else out.nextWord = true;
      } else {
        p.strokes = (multi ? DIFF[room.diff].words : hole.par) + 3;
        out.conceded = word.answer;
        await this.holeOut(p, room, out);
      }
    }

    await this.save();
    this.send(ws, "LINKS_MARK", out);
    this.pushAll();
  }

  async holeOut(p, room, out) {
    const hole = room.board[p.hole];
    const par = DIFF[room.diff].words > 1 ? DIFF[room.diff].words : hole.par;
    const gained = Math.round(pointsFor(p.strokes, par) * DIFF[room.diff].mult);

    p.card.push({ hole: p.hole + 1, par, strokes: p.strokes, points: gained });
    p.points += gained;
    out.holed = { par, strokes: p.strokes, name: scoreName(p.strokes, par), points: gained };

    p.hole += 1;
    p.wordIndex = 0;
    p.strokes = 0;
    p.guesses = [];
    p.ball = 0;

    if (p.hole >= room.holes) {
      p.done = true;
      out.roundOver = true;
      await this.maybeFinish(room);
    }
  }

  /** When the last card is in, the round is over and the arena hears about it. */
  async maybeFinish(room) {
    const all = Object.values(room.players);
    if (!all.length || !all.every((p) => p.done)) return;
    await this.finish(room, "finished");
  }

  /**
   * Golf points are not MMR, and handing them over as if they were is how a
   * single round paid three times what a perfect round of anything else does.
   *
   * A round is worth what it is worth against par: level par is a competent
   * round and scores 50, and it climbs from there. That 50 is a guess in the
   * same way the crossword's forty-five second floor is a guess — once there
   * are real cards to look at, move it so a good round sits high but rare.
   */
  scoreOf(room, p) {
    const parPoints = p.card.reduce((a, h) => a + pointsFor(h.par, h.par), 0);
    if (parPoints <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((p.points / parPoints) * 50)));
  }

  async finish(room, status) {
    if (room.phase === "OVER") return;
    room.phase = "OVER";

    const field = Object.values(room.players);
    // Most points first; a shorter card cannot outrank a full one on a tie.
    const ordered = [...field].sort((a, z) =>
      z.points - a.points || z.card.length - a.card.length);

    const ratings = Object.fromEntries(field.map((p) => [p.uid, p.mmrAtStart || 0]));
    const mode = field.length >= 3 ? "rumble" : "match";

    const results = ordered.map((p, i) => {
      const placement = i + 1;
      const score = this.scoreOf(room, p);
      const gain = sessionGain({
        score,
        completed: !!p.done,
        playerMmr: p.mmrAtStart || 0,
        fieldMmr: fieldMmrFor(p.uid, ratings),
        mode, seed: p.seed, placement,
      });
      const after = (p.mmrAtStart || 0) + gain.total;
      return {
        uid: p.uid,
        name: p.name,
        score,
        placement,
        seed: p.seed || null,
        // The golf card stays on the result: it is what the player wants to
        // read, even though the ladder only ever sees `score`.
        points: p.points,
        status: p.done ? "finished" : "ended",
        elapsedMs: Date.now() - room.startedAt,
        toPar: p.card.reduce((a, h) => a + (h.strokes - h.par), 0),
        holes: p.card.length,
        aces: p.card.filter((h) => h.strokes === 1).length,
        mmrBefore: p.mmrAtStart || 0,
        gain: gain.total,
        breakdown: { base: gain.base, challenge: gain.challenge, completion: gain.completion, seed: gain.seed },
        mmrAfter: after,
        belt: beltFor(after).name,
        promoted: beltFor(after).name !== beltFor(p.mmrAtStart || 0).name,
      };
    });

    await this.save();
    this.pushAll();
    this.broadcast("LINKS_OVER", { results, status, mode });

    // Straight through the same pipe as every other game: MMR, the belt
    // ladder, Past Games and the feed all come from this one call.
    this.state.waitUntil(recordMatch(this.env, {
      code: room.code,
      game: "links",
      courseId: room.courseId,
      mode: `${courseById(room.courseId).name} \u00b7 ${DIFF[room.diff].label}`,
      roundNo: room.roundNo,
      finishedAt: Date.now(),
      durationMs: Date.now() - room.startedAt,
      results,
    }).catch(() => {}));
  }

  /* ── plumbing ──────────────────────────────────────────────────── */

  view(uid) {
    const room = this.room;
    if (!room) return null;
    const course = courseById(room.courseId);
    const me = room.players[uid];
    return {
      code: room.code,
      phase: room.phase,
      course: { id: course.id, name: course.name, sub: course.sub, loc: course.loc, ico: course.ico },
      pars: course.pars,
      diff: room.diff,
      dict: room.dict,
      holes: room.holes,
      you: uid,
      solo: !!room.solo,
      hostUid: room.hostUid || null,
      isHost: this.canStart(uid),
      randomCourse: !!room.randomCourse,
      hole: me ? this.holeView(room, me) : null,
      // The card, so everyone can see the field without seeing the words.
      field: Object.values(room.players)
        .map((p) => ({
          uid: p.uid, name: p.name, points: p.points, hole: p.hole,
          done: p.done,
          toPar: p.card.reduce((a, h) => a + (h.strokes - h.par), 0),
        }))
        .sort((a, b) => b.points - a.points),
    };
  }

  pushAll() {
    for (const [ws, uid] of this.socks) {
      try { ws.send(JSON.stringify({ type: "LINKS_STATE", state: this.view(uid) })); }
      catch { /* it will catch up when it reconnects */ }
    }
    this.announce();
  }

  announce() {
    const room = this.room;
    if (!room) return;
    announceRoom(this.env, this.state, {
      game: "links",
      code: room.code,
      host: Object.values(room.players)[0]?.name || "Someone",
      // Announced as empty rather than left un-announced: a round that turns
      // solo may have been listed a moment ago, and the row would linger.
      players: room.solo ? 0 : Object.keys(room.players).length,
      phase: room.phase,
      label: room.solo
        ? `Solo · ${courseById(room.courseId).name}`
        : `${courseById(room.courseId).name} \u00b7 ${DIFF[room.diff].label}`,
      round: room.roundNo,
    });
  }

  send(ws, type, body) {
    try { ws.send(JSON.stringify({ type, ...body })); } catch { /* gone */ }
  }

  broadcast(type, body) {
    for (const ws of this.socks.keys()) this.send(ws, type, body);
  }

  save() { return this.state.storage.put({ room: this.room }); }

  async fetch(request) {
    const url = new URL(request.url);
    const uid = request.headers.get("X-Dojo-Uid");
    const name = request.headers.get("X-Dojo-Name") || "Someone";
    const code = (request.headers.get("X-Dojo-Code") || "").toUpperCase();

    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Expected a WebSocket upgrade.", { status: 426 });

    if (!this.room) {
      this.room = this.blank(
        code,
        url.searchParams.get("course"),
        url.searchParams.get("diff"),
        url.searchParams.get("dict"),
        url.searchParams.get("solo") === "1",
      );
    }
    // Solo means solo. The room is unlisted, but a code can still be typed at
    // it, and a private round that a stranger can walk into is not private.
    // The owner is the host, so anyone else is turned away — including on a
    // reconnect, which is why this is keyed on uid rather than on the socket.
    if (this.room.solo && this.room.hostUid && this.room.hostUid !== uid)
      return new Response("This is a solo round.", { status: 403 });

    if (!this.room.players[uid]) this.room.players[uid] = this.freshPlayer(uid, name);
    // Whoever opens the room holds the start. Recorded on arrival rather than
    // read off the player list later, so it survives people coming and going.
    if (!this.room.hostUid) this.room.hostUid = uid;
    this.room.players[uid].name = name;
    this.room.players[uid].lastSeen = Date.now();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.socks.set(server, uid);

    server.addEventListener("message", async (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      const p = this.room?.players?.[uid];
      if (p) p.lastSeen = Date.now();

      if (msg.type === "LINKS_START") return void await this.start(server, uid);
      if (msg.type === "LINKS_GUESS") return void await this.guess(server, uid, msg);
      if (msg.type === "LINKS_END") return void await this.finish(this.room, "ended");
      if (msg.type === "PING") { this.announce(); return; }
    });

    const drop = async () => {
      this.socks.delete(server);
      // The card stays: a player who reloads walks back onto the same hole.
      this.announce();
    };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);

    await this.save();
    this.pushAll();
    return new Response(null, { status: 101, webSocket: client });
  }
}
