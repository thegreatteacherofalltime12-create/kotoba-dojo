/**
 * The four engines a Grand Prix can run on.
 *
 * An engine is what you do to move the kart. They share one shape, so the
 * room does not care which is running: it asks for an item, shows the racer
 * what they are allowed to see, and checks what comes back.
 *
 *   levels        what "harder" means here, and what it pays
 *   deal(...)     the next item: its answer, its allowance, and its face
 *   check(...)    "right", "near" or "wrong"
 *   kind          how the browser asks for the answer
 *
 * Every allowance is the time the item ought to take, because distance is
 * measured against that and nothing else. It is what lets a seven-year-old
 * adding 8 and 5 race an adult factoring a quadratic on the same track.
 */
import { DICT, isWord } from "./links.js";
import bank from "../scripts/word-bank.json" with { type: "json" };

const pick = (list, rnd = Math.random) => list[Math.floor(rnd() * list.length)];
const between = (lo, hi, rnd = Math.random) => lo + Math.floor(rnd() * (hi - lo + 1));

/** Fisher-Yates, against a supplied random so a test can pin it. */
export function shuffled(list, rnd = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── words ────────────────────────────────────────────────────────────

const WORD_LEVELS = [
  { id: "junior", name: "Junior", sub: "4 to 5 letters, first letter given", mult: 1 },
  { id: "standard", name: "Standard", sub: "5 to 6 letters", mult: 1.15 },
  { id: "pro", name: "Pro", sub: "6 letters, no clue for 8 seconds", mult: 1.3 },
];
const WORD_SHAPE = {
  junior: { lens: [4, 5], firstLetter: true, hideClueMs: 0 },
  standard: { lens: [5, 6], firstLetter: false, hideClueMs: 0 },
  pro: { lens: [6], firstLetter: false, hideClueMs: 8_000 },
};

export function wordDeck(levelId) {
  const shape = WORD_SHAPE[levelId] || WORD_SHAPE.standard;
  const out = [];
  for (const set of ["classic", "modern"]) {
    for (const n of shape.lens) {
      for (const [word, clue] of DICT[set][n] || []) out.push({ word, clue });
    }
  }
  return out;
}

/** The letters, in an order that is not the answer. */
export function scramble(word, rnd = Math.random) {
  if (word.length < 2) return word;
  for (let tries = 0; tries < 12; tries++) {
    const s = shuffled([...word], rnd).join("");
    if (s !== word) return s;
  }
  return [...word].reverse().join("");
}

/**
 * A real word made of the same letters, but not the one dealt. GIRD and
 * GRID both fit the tiles; spinning somebody for typing the other one would
 * be unfair, and on the class that hides the clue it would be unavoidable.
 */
export function nearMiss(said, answer) {
  if (!said || said === answer || said.length !== answer.length) return false;
  if ([...said].sort().join("") !== [...answer].sort().join("")) return false;
  return isWord(said);
}

const words = {
  id: "words",
  name: "Word Cross",
  sub: "Letters dealt scrambled, with a clue.",
  kind: "type",
  levels: WORD_LEVELS,
  deal(levelId, p, rnd = Math.random) {
    const shape = WORD_SHAPE[levelId] || WORD_SHAPE.standard;
    if (!p.deck?.length) p.deck = shuffled(wordDeck(levelId), rnd).map((w) => `${w.word}\u0000${w.clue}`);
    const [word, clue] = String(p.deck.pop()).split("\u0000");
    const base = { 4: 12_000, 5: 15_000, 6: 18_000 }[word.length] || 15_000;
    return {
      answer: word,
      allowance: shape.hideClueMs ? Math.min(20_000, base + 2_000) : base,
      clue,
      scrambled: scramble(word, rnd),
      hideClueMs: shape.hideClueMs,
      hint: shape.firstLetter ? word[0] : null,
    };
  },
  /** What the racer may see. Never the answer. */
  face(item, hiddenFor) {
    return {
      scrambled: item.scrambled,
      len: item.answer.length,
      clue: hiddenFor > 0 ? null : item.clue,
      clueInMs: hiddenFor,
      hint: item.hint,
    };
  },
  /**
   * What is left of the hold. The room passes the time the item was dealt,
   * so a face asked for again after the eight seconds gives the clue up —
   * which is the whole of what the Pro class promises.
   */
  hideFor(item, dealtAt) {
    const held = item.hideClueMs || 0;
    return dealtAt ? Math.max(0, held - (Date.now() - dealtAt)) : held;
  },
  /** The clock this level works to, before any item has been dealt. */
  pace(levelId) {
    const shape = WORD_SHAPE[levelId] || WORD_SHAPE.standard;
    const bases = shape.lens.map((n) => ({ 4: 12_000, 5: 15_000, 6: 18_000 }[n] || 15_000));
    const mean = bases.reduce((a, b) => a + b, 0) / bases.length;
    return shape.hideClueMs ? Math.min(20_000, mean + 2_000) : mean;
  },
  check(item, said) {
    const up = String(said || "").trim().toUpperCase();
    if (up === item.answer) return "right";
    if (nearMiss(up, item.answer)) return "near";
    return "wrong";
  },
  /** A wrong answer moves the letters, so it costs a moment as well. */
  onWrong(item, rnd = Math.random) { item.scrambled = scramble(item.answer, rnd); },
};

// ── maths ────────────────────────────────────────────────────────────
//
// Every problem is generated rather than drawn from a list, so the supply
// never runs out and no two races repeat. Every answer is a whole number:
// nobody should lose a race to a rounding convention.

const MATHS_LEVELS = [
  { id: "g12", name: "Grades 1-2", sub: "Adding and subtracting inside 20", mult: 0.85, allowance: 8_000 },
  { id: "g34", name: "Grades 3-4", sub: "Times tables, division, bigger sums", mult: 1, allowance: 10_000 },
  { id: "g56", name: "Grades 5-6", sub: "Fractions, decimals, percentages, order of operations", mult: 1.1, allowance: 18_000 },
  { id: "g78", name: "Grades 7-8", sub: "Negatives, powers, ratios, solving for x", mult: 1.2, allowance: 25_000 },
  { id: "g910", name: "Grades 9-10", sub: "Quadratics, two-step equations, Pythagoras, slope", mult: 1.3, allowance: 40_000 },
  { id: "g1112", name: "Grades 11-12", sub: "Logs, trig, sequences, functions", mult: 1.4, allowance: 55_000 },
];

const TRIPLES = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17], [7, 24, 25]];

/** One problem from a band: the words of it, and the number it comes to. */
export function mathsProblem(levelId, rnd = Math.random) {
  const r = rnd;
  switch (levelId) {
    case "g12": {
      const a = between(2, 18, r), b = between(1, 20 - a, r);
      return r() < 0.5
        ? { text: `${a} + ${b}`, answer: a + b }
        : { text: `${a + b} − ${b}`, answer: a };
    }
    case "g34": {
      const kind = between(1, 3, r);
      if (kind === 1) { const a = between(2, 12, r), b = between(2, 12, r); return { text: `${a} × ${b}`, answer: a * b }; }
      if (kind === 2) { const b = between(2, 12, r), q = between(2, 12, r); return { text: `${b * q} ÷ ${b}`, answer: q }; }
      const a = between(120, 899, r), b = between(20, 99, r);
      return r() < 0.5 ? { text: `${a} + ${b}`, answer: a + b } : { text: `${a} − ${b}`, answer: a - b };
    }
    case "g56": {
      const kind = between(1, 4, r);
      if (kind === 1) { const d = pick([2, 4, 5, 10], r), n = between(1, d - 1, r), whole = d * between(2, 12, r); return { text: `${n}/${d} of ${whole}`, answer: (whole / d) * n }; }
      if (kind === 2) { const pc = pick([10, 20, 25, 50, 75], r), of = between(1, 10, r) * 20; return { text: `${pc}% of ${of}`, answer: (of * pc) / 100 }; }
      if (kind === 3) { const a = between(2, 9, r), b = between(2, 9, r), c = between(2, 9, r); return { text: `${a} + ${b} × ${c}`, answer: a + b * c }; }
      const a = (between(1, 9, r) * 2 + 1) / 2, b = between(1, 5, r) * 2;
      return { text: `${a.toFixed(1)} × ${b}`, answer: a * b };
    }
    case "g78": {
      const kind = between(1, 4, r);
      if (kind === 1) { const a = between(2, 20, r), b = between(2, 20, r); return { text: `−${a} + ${b}`, answer: b - a }; }
      if (kind === 2) { const base = between(2, 6, r), p = between(2, 4, r); return { text: `${base}^${p}`, answer: Math.pow(base, p) }; }
      if (kind === 3) { const x = between(2, 12, r), m = between(2, 9, r), c = between(1, 20, r); return { text: `${m}x + ${c} = ${m * x + c}, x = ?`, answer: x }; }
      const part = between(2, 9, r), mult = between(2, 6, r);
      return { text: `${part} : ${part * 2} is ${part * mult} : ?`, answer: part * mult * 2 };
    }
    case "g910": {
      const kind = between(1, 4, r);
      if (kind === 1) { const [a, b, c] = pick(TRIPLES, r); return { text: `Right triangle, legs ${a} and ${b}. Hypotenuse?`, answer: c }; }
      if (kind === 2) { const p = between(1, 9, r), q = between(1, 9, r); return { text: `x² − ${p + q}x + ${p * q} = 0. Larger root?`, answer: Math.max(p, q) }; }
      if (kind === 3) { const m = between(2, 9, r), x1 = between(1, 5, r), x2 = x1 + between(1, 4, r), c = between(0, 9, r); return { text: `Slope through (${x1}, ${m * x1 + c}) and (${x2}, ${m * x2 + c})`, answer: m }; }
      const x = between(2, 12, r), m = between(2, 9, r), c = between(1, 15, r);
      return { text: `${m}x − ${c} = ${m * x - c}, x = ?`, answer: x };
    }
    case "g1112": {
      const kind = between(1, 4, r);
      if (kind === 1) {
        const base = pick([2, 3, 5, 10], r), p = between(2, 4, r);
        const sub = String(base).split("").map((d) => "\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089"[Number(d)]).join("");
        return { text: `log${sub}(${Math.pow(base, p)})`, answer: p };
      }
      if (kind === 2) { const a = between(2, 5, r), ratio = between(2, 4, r); const seq = [a, a * ratio, a * ratio * ratio, a * ratio ** 3]; return { text: `Next: ${seq.join(", ")}`, answer: a * ratio ** 4 }; }
      if (kind === 3) { const a = between(2, 5, r), b = between(1, 9, r), x = between(2, 6, r); return { text: `f(x) = ${a}x² − ${b}, f(${x})`, answer: a * x * x - b }; }
      const k = pick([[30, 2], [90, 1], [0, 0]], r);
      const mult = between(2, 9, r);
      const val = k[0] === 30 ? 0.5 : k[0] === 90 ? 1 : 0;
      return { text: `sin ${k[0]}° × ${mult * (k[0] === 30 ? 2 : 1)}`, answer: Math.round(val * mult * (k[0] === 30 ? 2 : 1)) };
    }
    default:
      return mathsProblem("g34", rnd);
  }
}

const maths = {
  id: "maths",
  name: "Maths",
  sub: "One problem, answered on a number pad.",
  kind: "number",
  levels: MATHS_LEVELS,
  deal(levelId, p, rnd = Math.random) {
    const level = MATHS_LEVELS.find((l) => l.id === levelId) || MATHS_LEVELS[1];
    const q = mathsProblem(level.id, rnd);
    // A harder problem inside a band carries a little more time, which is
    // what the custom timer is for.
    const stretch = Math.abs(q.answer) > 100 ? 1.2 : 1;
    return {
      answer: String(q.answer),
      // A minute is the most any item gets, whatever band it came from.
      allowance: Math.min(60_000, Math.round(level.allowance * stretch)),
      text: q.text,
    };
  },
  face(item) { return { text: item.text }; },
  hideFor() { return 0; },
  pace(levelId) { return (MATHS_LEVELS.find((l) => l.id === levelId) || MATHS_LEVELS[1]).allowance; },
  check(item, said) {
    const got = String(said || "").trim().replace(/\s+/g, "").replace(/^\+/, "").replace(/−/g, "-");
    if (!got) return "wrong";
    return Number(got) === Number(item.answer) ? "right" : "wrong";
  },
  onWrong() { /* the problem stands */ },
};

// ── memory ───────────────────────────────────────────────────────────
//
// No reading and no arithmetic: the engine a five-year-old can race an
// adult on, and the one that works when English is still coming.

const MEM_LEVELS = [
  { id: "short", name: "Short", sub: "Starts at three tiles", mult: 1, start: 3 },
  { id: "standard", name: "Standard", sub: "Starts at four tiles", mult: 1.15, start: 4 },
  { id: "long", name: "Long", sub: "Starts at five tiles", mult: 1.3, start: 5 },
];
export const MEM_TILES = 6;
export const MEM_MAX = 9;
export const MEM_FLASH_MS = 620;

const memory = {
  id: "memory",
  name: "Memory",
  sub: "A row of tiles lights in order. Tap them back.",
  kind: "tiles",
  levels: MEM_LEVELS,
  deal(levelId, p, rnd = Math.random) {
    const level = MEM_LEVELS.find((l) => l.id === levelId) || MEM_LEVELS[1];
    const len = Math.max(3, Math.min(MEM_MAX, p.memLen || level.start));
    const seq = [...Array(len)].map(() => between(0, MEM_TILES - 1, rnd));
    return {
      answer: seq.join(","),
      // Watching it costs time before answering can start, so the allowance
      // carries the flashing as well as the tapping.
      allowance: len * MEM_FLASH_MS + len * 1_200 + 2_000,
      // How much of that allowance was the flashing. Nobody can be judged
      // on time they were not allowed to move in, so the room takes this
      // off the clock and off the allowance before it measures anything —
      // without it a full boost needs the whole sequence tapped inside
      // four hundred milliseconds, and gets harder the better you do.
      leadMs: len * MEM_FLASH_MS + 150,
      seq,
      tiles: MEM_TILES,
      flashMs: MEM_FLASH_MS,
    };
  },
  face(item) { return { seq: item.seq, tiles: item.tiles, flashMs: item.flashMs, len: item.seq.length }; },
  hideFor() { return 0; },
  pace(levelId) {
    const level = MEM_LEVELS.find((l) => l.id === levelId) || MEM_LEVELS[1];
    return level.start * 1_200 + 2_000;
  },
  check(item, said) {
    const got = String(said || "").trim().replace(/\s+/g, "");
    return got === item.answer ? "right" : "wrong";
  },
  onWrong() { /* the sequence stands; the room shortens the next one */ },
};

// ── trivia ───────────────────────────────────────────────────────────
//
// A question and four answers, one tap. The wrong three come from the same
// theme, so a guess is a guess rather than a process of elimination.

const TRIVIA_LEVELS = [
  { id: "easy", name: "Easy", sub: "The gentle end of the bank", mult: 1 },
  { id: "medium", name: "Standard", sub: "The middle of the bank", mult: 1.15 },
  { id: "hard", name: "Hard", sub: "The hard end of the bank", mult: 1.3 },
];

export const THEMES = (bank.themes || []).map((t) => ({ id: t.id, name: t.name }));

/** Every question of a level, from one theme or all of them. */
export function triviaPool(levelId, themeId = "mixed") {
  const out = [];
  for (const theme of bank.themes || []) {
    if (themeId !== "mixed" && theme.id !== themeId) continue;
    for (const q of theme.levels?.[levelId] || []) {
      if (q?.answer && q?.clue) out.push({ ...q, theme: theme.id, themeName: theme.name });
    }
  }
  return out;
}

const trivia = {
  id: "trivia",
  name: "Trivia",
  sub: "A question and four answers, one tap.",
  kind: "choice",
  levels: TRIVIA_LEVELS,
  themes: THEMES,
  deal(levelId, p, rnd = Math.random, themeId = "mixed") {
    if (!p.deck?.length) {
      const pool = triviaPool(levelId, themeId);
      const fallback = pool.length >= 4 ? pool : triviaPool("medium", "mixed");
      p.deck = shuffled(fallback, rnd).slice(0, 200).map((q) => JSON.stringify(q));
    }
    const q = JSON.parse(p.deck.pop());
    // Three wrong answers from the same theme, so nobody wins on register.
    const others = triviaPool(levelId, q.theme).filter((x) => x.answer !== q.answer);
    const wrong = shuffled(others.length >= 3 ? others : triviaPool(levelId, "mixed").filter((x) => x.answer !== q.answer), rnd)
      .slice(0, 3).map((x) => x.answer);
    const options = shuffled([q.answer, ...wrong], rnd);
    return {
      answer: String(options.indexOf(q.answer)),
      allowance: 15_000,
      question: q.clue,
      options,
      themeName: q.themeName,
    };
  },
  face(item) { return { question: item.question, options: item.options, themeName: item.themeName }; },
  hideFor() { return 0; },
  pace() { return 15_000; },
  check(item, said) { return String(said).trim() === item.answer ? "right" : "wrong"; },
  onWrong() { /* the question stands */ },
};

// ── the set ──────────────────────────────────────────────────────────

export const ENGINES = [words, maths, memory, trivia];
export const engineById = (id) => ENGINES.find((e) => e.id === id) || words;
/** What the browser is told about them: never a deal, never an answer. */
export const engineList = () => ENGINES.map((e) => ({
  id: e.id, name: e.name, sub: e.sub, kind: e.kind,
  levels: e.levels.map((l) => ({ id: l.id, name: l.name, sub: l.sub, mult: l.mult })),
  ...(e.themes ? { themes: e.themes } : {}),
}));
/**
 * The clock a racer on this level works to, for the moments before their
 * first item exists — the lights, and anything that moves a kart that has
 * not been dealt to yet.
 */
export const nominalAllowance = (engineId, levelId) => {
  const e = engineById(engineId);
  return (e.pace ? e.pace(levelId) : 15_000) || 15_000;
};

/** The level an engine starts everyone on. */
export const defaultLevel = (engineId) => {
  const e = engineById(engineId);
  return e.levels[Math.min(1, e.levels.length - 1)].id;
};
