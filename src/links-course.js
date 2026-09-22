import {
  COURSES, DIFF, PAR_LEN, courseById, poolFor, evaluate,
  pointsFor, scoreName, maxGuesses, scramble, sameLetters, placed,
} from "./links.js";
import { ARSENALS } from "./arsenals.js";
import { recordMatch, readRatings } from "./firestore.js";
import { boosted } from "./mmr.js";
import { tokensReply, heldTokens } from "./boost.js";
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
      ars: this.freshArs(),
      hints: {},            // "hole:word" -> positions already shown
      swapped: {},          // "hole:word" -> a word put in place of the drawn one
      ball: 0,              // 0 at the tee, 1 in the cup
      done: false,
      lastSeen: Date.now(),
    };
  }

  /* ── the arsenal ───────────────────────────────────────────────── */
  //
  // Eighteen tokens, each capped per round. Some fire at once (a mulligan,
  // a hint), some arm a promise the hole pays off later (Lucky Bounce,
  // Double Down, Ace Chaser). Only what is used is spent; what is armed and
  // unused stays armed for the next round in this room.

  freshArs() {
    return {
      armed: {}, used: {},
      relief: false,        // the next word lost costs one stroke, not two
      practice: false,      // the next guess is not a stroke
      extra: 0,             // guesses added to the word in play
      bounce: false,        // this hole scores no worse than par
      double: false,        // this hole doubles, or halves
      eagle: false,         // the next hole under par pays double
      ace: false,           // an ace pays 150
      pencil: false,        // the worst hole comes off the card
      finder: {},           // "hole:word" -> the clue is shown early
      easyHole: null,       // the hole to be played from one tee forward
      book: [],             // clues read ahead
    };
  }
  arsOf(p) { return p.ars || (p.ars = this.freshArs()); }
  armedLeft(p, key) { const a = this.arsOf(p); return (a.armed[key] || 0) - (a.used[key] || 0); }
  useToken(p, key) { const a = this.arsOf(p); a.used[key] = (a.used[key] || 0) + 1; }

  /** How many words this player must solve on the hole they are standing on. */
  wordsFor(room, p, hole = p.hole) {
    const words = DIFF[room.diff].words;
    if (this.arsOf(p).easyHole === hole) return words === 8 ? 5 : words === 5 ? 1 : 1;
    return words;
  }
  /** The par the hole is scored against for this player. */
  parFor(room, p, holeIndex = p.hole) {
    const w = this.wordsFor(room, p, holeIndex);
    return w > 1 ? w : room.board[holeIndex]?.par ?? 4;
  }
  /** The word in play, which a Club Fitting may have replaced. */
  wordAt(room, p, holeIndex = p.hole, wordIndex = p.wordIndex) {
    const swapped = p.swapped?.[`${holeIndex}:${wordIndex}`];
    return swapped || room.board[holeIndex]?.words[wordIndex];
  }

  arsenalView(room, p) {
    const a = this.arsOf(p);
    const key = `${p.hole}:${p.wordIndex}`;
    return {
      on: true, armed: a.armed, used: a.used,
      max: Object.fromEntries(Object.entries(ARSENALS.links).map(([k, v]) => [k, v.max || 99])),
      playing: room.phase === "PLAYING" && !p.done,
      atTee: p.strokes === 0 && p.wordIndex === 0 && !(p.guesses || []).length,
      hints: p.hints?.[key] || [],
      relief: !!a.relief, practice: !!a.practice, extra: a.extra || 0,
      bounce: !!a.bounce, double: !!a.double, eagle: !!a.eagle, ace: !!a.ace, pencil: !!a.pencil,
      easyHole: a.easyHole, book: a.book || [], finder: !!a.finder?.[key],
      words: this.wordsFor(room, p), diff: room.diff,
    };
  }

  async sendTokens(ws, uid, apply, error = null) {
    const room = this.room;
    room.applied = room.applied || {};
    const reply = await tokensReply(this.env, uid, "links", {
      applied: room.applied, over: room.phase === "OVER", apply,
    });
    if (reply.changed) await this.save();
    const p = room.players[uid];
    this.send(ws, "LINKS_TOKENS", {
      ...reply, error: error || reply.error,
      arsenal: p ? this.arsenalView(room, p) : null,
    });
  }

  async arm(ws, uid, msg) {
    const room = this.room;
    const p = room?.players?.[uid];
    if (!p) return;
    const key = String(msg.key || "");
    const spec = ARSENALS.links[key];
    if (!spec) return this.sendTokens(ws, uid, false, "No such token.");
    const a = this.arsOf(p);
    if (spec.max && (a.armed[key] || 0) >= spec.max) return this.sendTokens(ws, uid, false, `${spec.max} ${spec.name} is the limit for one round.`);
    const held = (await heldTokens(this.env, uid))[key] || 0;
    if (held <= (a.armed[key] || 0)) return this.sendTokens(ws, uid, false, `You hold no more ${spec.name} tokens. The Token shop sells them.`);
    a.armed[key] = (a.armed[key] || 0) + 1;
    await this.save();
    await this.sendTokens(ws, uid, false);
  }

  async disarm(ws, uid, msg) {
    const p = this.room?.players?.[uid];
    if (!p) return;
    const key = String(msg.key || "");
    const a = this.arsOf(p);
    if (this.armedLeft(p, key) <= 0) return this.sendTokens(ws, uid, false, "Nothing to put back.");
    a.armed[key] -= 1;
    if (!a.armed[key]) delete a.armed[key];
    await this.save();
    await this.sendTokens(ws, uid, false);
  }

  /** Firing one. Everything that changes the hole in play happens here. */
  async useArsenal(ws, uid, msg) {
    const room = this.room;
    const p = room?.players?.[uid];
    if (!p) return;
    if (room.phase !== "PLAYING" || p.done) return this.send(ws, "LINKS_REJECT", { why: "No round is running." });
    const action = String(msg.action || "");
    const key = {
      mulligan: "gf_mulligan", hint: "gf_hint", finder: "gf_finder", relief: "gf_relief",
      gimme: "gf_gimme", practice: "gf_practice", fitting: "gf_fitting", bounce: "gf_bounce",
      local: "gf_local", club: "gf_club", drop: "gf_drop", tees: "gf_tees",
      double: "gf_double", eagle: "gf_eagle", pencil: "gf_pencil", wind: "gf_wind",
      book: "gf_book", ace: "gf_ace",
    }[action];
    if (!key) return this.send(ws, "LINKS_REJECT", { why: "Unrecognised action." });
    if (this.armedLeft(p, key) <= 0) return this.send(ws, "LINKS_REJECT", { why: `No ${ARSENALS.links[key].name} armed. Arm one under Apply Token.` });

    const a = this.arsOf(p);
    const hole = room.board[p.hole];
    const word = this.wordAt(room, p);
    const multi = this.wordsFor(room, p) > 1;
    const par = this.parFor(room, p);
    const wkey = `${p.hole}:${p.wordIndex}`;
    const atTee = p.strokes === 0 && p.wordIndex === 0 && !(p.guesses || []).length;
    const out = {};
    let note = "";

    if (action === "mulligan") {
      if (p.strokes <= 0) return this.send(ws, "LINKS_REJECT", { why: "No stroke to take back yet." });
      p.strokes -= 1;
      note = "Mulligan: one stroke back.";
    } else if (action === "hint" || action === "local") {
      const shown = new Set(p.hints[wkey] || []);
      const pick = [];
      if (action === "local") {
        for (const i of [0, word.answer.length - 1]) if (!shown.has(i)) pick.push(i);
      } else {
        const free = [...word.answer].map((_, i) => i).filter((i) => !shown.has(i));
        if (free.length) pick.push(free[Math.floor(Math.random() * free.length)]);
      }
      if (!pick.length) return this.send(ws, "LINKS_REJECT", { why: "Nothing left to show on this word." });
      p.hints[wkey] = [...shown, ...pick];
      note = action === "local" ? "Local Knowledge: the first and last letters." : "Caddie's Hint: one letter placed.";
    } else if (action === "finder") {
      if (room.diff !== "hard" || p.wordIndex >= 2) return this.send(ws, "LINKS_REJECT", { why: "The clue is already yours on this word." });
      a.finder[wkey] = true;
      note = "Range Finder: the clue, early.";
    } else if (action === "relief") {
      if (a.relief) return this.send(ws, "LINKS_REJECT", { why: "Relief is already taken on this hole." });
      a.relief = true;
      note = "Ground Under Repair: the next word you lose costs one stroke, not two.";
    } else if (action === "gimme") {
      p.strokes = par;
      p.guesses = [];
      this.useToken(p, key);
      await this.holeOut(p, room, out);
      await this.save();
      this.send(ws, "LINKS_MARK", { ...out, marks: [], solved: false, ball: 1, strokes: par, gimme: true });
      this.send(ws, "LINKS_NOTE", { text: "Gimme: the hole is conceded at par." });
      this.send(ws, "LINKS_ARSENAL_STATE", { arsenal: this.arsenalView(room, p) });
      this.pushAll();
      return;
    } else if (action === "practice") {
      if (a.practice) return this.send(ws, "LINKS_REJECT", { why: "A practice swing is already lined up." });
      a.practice = true;
      note = "Practice Swing: your next guess is not a stroke.";
    } else if (action === "fitting") {
      const pool = poolFor(room.dict, hole.len, room.diff);
      const taken = new Set([word.answer]);
      let pick = null;
      for (let i = 0; i < 80 && !pick; i++) {
        const c = pool[Math.floor(Math.random() * pool.length)];
        if (!taken.has(c[0])) pick = c;
      }
      if (!pick) return this.send(ws, "LINKS_REJECT", { why: "No other word of that length to hand." });
      p.swapped[wkey] = { answer: pick[0], clue: pick[1], scrambled: scramble(pick[0]) };
      p.guesses = [];
      delete p.hints[wkey];
      note = "Club Fitting: a new word, same length.";
    } else if (action === "bounce") {
      if (a.bounce) return this.send(ws, "LINKS_REJECT", { why: "This hole is already covered." });
      a.bounce = true;
      note = "Lucky Bounce: this hole will score no worse than par.";
    } else if (action === "club") {
      a.extra += 2;
      note = "Extra Club: two more guesses on this word.";
    } else if (action === "drop") {
      if (!multi) p.strokes = Math.max(0, p.strokes - (p.guesses || []).length);
      p.guesses = [];
      a.extra = 0;
      note = "Drop Zone: the word starts again, and the strokes it cost are gone.";
    } else if (action === "tees") {
      if (p.hole + 1 >= room.holes) return this.send(ws, "LINKS_REJECT", { why: "There is no next hole." });
      if (DIFF[room.diff].words === 1) return this.send(ws, "LINKS_REJECT", { why: "These are already the forward tees." });
      a.easyHole = p.hole + 1;
      note = `Preferred Lies: hole ${p.hole + 2} is played from one tee forward.`;
    } else if (action === "double") {
      if (!atTee) return this.send(ws, "LINKS_REJECT", { why: "Double Down is declared on the tee, before you swing." });
      if (a.double) return this.send(ws, "LINKS_REJECT", { why: "This hole is already doubled." });
      a.double = true;
      note = "Double Down: par or better doubles this hole, worse halves it.";
    } else if (action === "eagle") {
      if (a.eagle) return this.send(ws, "LINKS_REJECT", { why: "Eagle Eye is already watching." });
      a.eagle = true;
      note = "Eagle Eye: your next hole under par pays double.";
    } else if (action === "pencil") {
      if (a.pencil) return this.send(ws, "LINKS_REJECT", { why: "The pencil is already out." });
      a.pencil = true;
      note = "Scorecard Pencil: your worst hole comes off the card at the end.";
    } else if (action === "wind") {
      out.reveal = word.answer;
      note = "Wind Gauge: the letters, in order, for two seconds.";
    } else if (action === "book") {
      const ahead = [];
      for (let h = p.hole + 1; h < Math.min(room.holes, p.hole + 4); h++) {
        const w = room.board[h]?.words[0];
        if (w) ahead.push({ no: h + 1, clue: w.clue, len: room.board[h].len });
      }
      if (!ahead.length) return this.send(ws, "LINKS_REJECT", { why: "There is nothing left to read ahead." });
      a.book = ahead;
      note = "Caddie's Book: the next holes, read ahead.";
    } else if (action === "ace") {
      if (a.ace) return this.send(ws, "LINKS_REJECT", { why: "Ace Chaser is already on." });
      a.ace = true;
      note = "Ace Chaser: your next ace pays 150.";
    }

    this.useToken(p, key);
    await this.save();
    if (Object.keys(out).length) this.send(ws, "LINKS_MARK", { marks: [], solved: false, ball: p.ball, strokes: p.strokes, ...out });
    this.send(ws, "LINKS_NOTE", { text: note });
    this.send(ws, "LINKS_ARSENAL_STATE", { arsenal: this.arsenalView(room, p) });
    this.pushAll();
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
      const armed = { ...this.arsOf(p).armed };
      Object.assign(p, this.freshPlayer(p.uid, p.name));
      p.ars.armed = armed;
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
      if (room.applied?.[p.uid] && !((ratings.boosts?.[p.uid]?.links || 0) > 0)) delete room.applied[p.uid];
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
    const words = this.wordsFor(room, p);
    const multi = words > 1;
    const a = this.arsOf(p);
    const wkey = `${p.hole}:${p.wordIndex}`;
    const word = this.wordAt(room, p);
    // A hint is a position and the letter standing in it — never the word.
    const hints = (p.hints?.[wkey] || []).map((i) => ({ i, ch: word?.answer[i] })).filter((h) => h.ch);
    return {
      no: p.hole + 1,
      name: course.names?.[p.hole] || null,
      yards: course.yards[p.hole],
      cardPar: hole.par,
      par: multi ? words : hole.par,
      len: hole.len,
      hazard: course.haz?.[p.hole] || null,
      // The clue, but never the word. On the hard tee it is withheld until
      // two words are behind you, unless a Range Finder bought it early.
      clue: (room.diff === "hard" && p.wordIndex < 2 && !a.finder?.[wkey]) ? null : word?.clue,
      // The letters, in the order they were dealt. The answer is these
      // letters put right, and it is the one thing this view never carries.
      scrambled: word?.scrambled || null,
      wordIndex: p.wordIndex,
      wordsTotal: words,
      maxGuesses: maxGuesses(hole.par, room.diff) + (a.extra || 0),
      guesses: p.guesses,
      strokes: p.strokes,
      ball: p.ball,
      hints,
      forward: a.easyHole === p.hole,
    };
  }

  async guess(ws, uid, msg) {
    const room = this.room;
    const p = room?.players?.[uid];
    if (!room || room.phase !== "PLAYING" || !p || p.done) return;

    const hole = room.board[p.hole];
    if (!hole) return;
    const word = this.wordAt(room, p);
    const a = this.arsOf(p);
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
    const words = this.wordsFor(room, p);
    const multi = words > 1;

    // A practice swing costs nothing: no stroke, and it does not eat a guess.
    const practice = !!a.practice;
    if (practice) a.practice = false;
    if (!practice) p.guesses.push({ word: g, marks });

    // Easy counts every guess as a stroke. The multi-word tees count each word
    // solved as one shot down the fairway, so the ball only moves on a solve.
    if (!multi && !practice) p.strokes += 1;
    p.ball = multi
      ? (p.wordIndex + (solved ? 1 : 0)) / words
      : Math.max(p.ball, q);

    const out = { marks, solved, ball: p.ball, strokes: p.strokes, practice };

    if (solved) {
      if (multi) {
        p.strokes += 1;
        p.wordIndex += 1;
        p.guesses = [];
        a.extra = 0;
        if (p.wordIndex >= words) await this.holeOut(p, room, out);
        else out.nextWord = true;
      } else {
        await this.holeOut(p, room, out);
      }
    } else if (p.guesses.length >= maxGuesses(hole.par, room.diff) + (a.extra || 0)) {
      // Out of guesses on this word. In the single-word game that is the hole
      // conceded; in the multi-word tees it costs a shot and moves you on.
      // Relief, if it was taken, softens whichever of the two lands.
      const relief = a.relief;
      if (relief) { a.relief = false; out.relief = true; }
      if (multi) {
        p.strokes += relief ? 1 : 2;          // a penalty, not a free pass
        p.wordIndex += 1;
        p.guesses = [];
        a.extra = 0;
        out.conceded = word.answer;
        if (p.wordIndex >= words) await this.holeOut(p, room, out);
        else out.nextWord = true;
      } else {
        p.strokes = hole.par + (relief ? 1 : 3);
        out.conceded = word.answer;
        await this.holeOut(p, room, out);
      }
    }

    await this.save();
    this.send(ws, "LINKS_MARK", out);
    this.send(ws, "LINKS_ARSENAL_STATE", { arsenal: this.arsenalView(room, p) });
    this.pushAll();
  }

  async holeOut(p, room, out) {
    const hole = room.board[p.hole];
    const a = this.arsOf(p);
    const par = this.parFor(room, p);
    // Lucky Bounce first: it changes the score the hole is judged on, and
    // everything after reads that. An ace is an ace whatever else is on.
    let strokes = p.strokes;
    const marks = [];
    if (a.bounce && strokes > par) { strokes = par; marks.push("bounce"); }
    let raw = strokes === 1 && a.ace ? 150 : pointsFor(strokes, par);
    if (strokes === 1 && a.ace) { a.ace = false; marks.push("ace"); }
    if (a.eagle && strokes < par) { raw *= 2; a.eagle = false; marks.push("eagle"); }
    if (a.double) { raw = strokes <= par ? raw * 2 : Math.round(raw / 2); a.double = false; marks.push(strokes <= par ? "double" : "halved"); }
    const gained = Math.round(raw * DIFF[room.diff].mult);

    p.card.push({ hole: p.hole + 1, par, strokes, points: gained, ...(marks.length ? { marks } : {}) });
    p.points += gained;
    out.holed = { par, strokes, name: scoreName(strokes, par), points: gained, marks };

    a.bounce = false;
    a.relief = false;
    a.practice = false;
    a.extra = 0;
    a.book = [];
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
    const card = this.cardOf(p);
    const parPoints = card.reduce((a, h) => a + pointsFor(h.par, h.par), 0);
    if (parPoints <= 0) return 0;
    const points = card.reduce((a, h) => a + h.points, 0);
    return Math.max(0, Math.min(100, Math.round((points / parPoints) * 50)));
  }

  /**
   * The card a round is scored on. A Scorecard Pencil strikes the worst hole
   * from it — the hole itself and the par it was played against, so what is
   * left still reads as a round of golf.
   */
  cardOf(p) {
    const card = p.card || [];
    if (!this.arsOf(p).pencil || card.length < 2) return card;
    let worst = 0;
    for (let i = 1; i < card.length; i++) {
      const w = card[worst], h = card[i];
      if (h.points < w.points || (h.points === w.points && (h.strokes - h.par) > (w.strokes - w.par))) worst = i;
    }
    return card.filter((_, i) => i !== worst);
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
      p.boost = !!room.applied?.[p.uid];
      if (p.boost) gain.total = boosted(gain.total);
      const after = (p.mmrAtStart || 0) + gain.total;
      return {
        uid: p.uid,
        name: p.name,
        score,
        placement,
        seed: p.seed || null,
        // The golf card stays on the result: it is what the player wants to
        // read, even though the ladder only ever sees `score`.
        points: this.cardOf(p).reduce((n, h) => n + h.points, 0),
        spent: p.ars?.used && Object.keys(p.ars.used).length ? { ...p.ars.used } : undefined,
        status: p.done ? "finished" : "ended",
        elapsedMs: Date.now() - room.startedAt,
        toPar: this.cardOf(p).reduce((a, h) => a + (h.strokes - h.par), 0),
        holes: this.cardOf(p).length,
        aces: this.cardOf(p).filter((h) => h.strokes === 1).length,
        mmrBefore: p.mmrAtStart || 0,
        gain: gain.total, boost: !!p.boost,
        breakdown: { base: gain.base, challenge: gain.challenge, completion: gain.completion, seed: gain.seed },
        mmrAfter: after,
        belt: beltFor(after).name,
        promoted: beltFor(after).name !== beltFor(p.mmrAtStart || 0).name,
      };
    });

    room.applied = {};
    // What the arsenal used is spent by the record write; what was armed and
    // never fired stays armed for the next round in this room. Saved before
    // anything is broadcast, so a sleeping object cannot lose the spend.
    for (const p of field) {
      const ars = this.arsOf(p);
      for (const [k, n] of Object.entries(ars.used)) {
        ars.armed[k] = Math.max(0, (ars.armed[k] || 0) - n);
        if (!ars.armed[k]) delete ars.armed[k];
      }
      ars.used = {};
    }
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
      if (msg.type === "TOKENS" || msg.type === "APPLY_TOKEN")
        return void await this.sendTokens(server, uid, msg.type === "APPLY_TOKEN");
      if (msg.type === "ARM_TOKEN") return void await this.arm(server, uid, msg);
      if (msg.type === "DISARM_TOKEN") return void await this.disarm(server, uid, msg);
      if (msg.type === "LINKS_ARSENAL") return void await this.useArsenal(server, uid, msg);
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
