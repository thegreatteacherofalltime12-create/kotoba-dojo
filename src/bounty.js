// The bounty, as rules with no I/O.
//
// The whole system rests on one number: points per hour. A fifteen-minute
// crossword and a two-hour Rumble are not comparable on raw score, so every
// result is converted to a rate before anything is decided. That is what lets
// a bounty set in one mode be hunted in another.

export const CLAIM_BONUS = 50;
export const DEFEND_BONUS = 25;
export const ROTATE_AFTER_MS = 48 * 60 * 60 * 1000;

/** Solo play neither claims nor transfers the bounty. */
export const ELIGIBLE_MODES = ["match", "rumble", "putv"];

export function isEligible({ mode, field }) {
  return ELIGIBLE_MODES.includes(mode) && (field || 0) >= 2;
}

/**
 * Score as a rate. Anything under a minute is treated as a minute, so a
 * thirty-second novelty round can't post an absurd hourly figure.
 */
export function perHour(score, durationMs) {
  const hours = Math.max(60_000, Number(durationMs) || 0) / 3_600_000;
  return Math.round((Number(score) || 0) / hours);
}

/* ── achievements ────────────────────────────────────────────────────── */

export const KILL_TIERS = [
  { at: 1, id: "kill-1", name: "Bounty Kill I", tier: "silver", points: 3 },
  { at: 2, id: "kill-2", name: "Bounty Kill II", tier: "gold", points: 4 },
  { at: 3, id: "kill-3", name: "Bounty Kill III", tier: "diamond", points: 5 },
  { at: 4, id: "kill-4", name: "Bounty Kill IV", tier: "platinum", points: 6 },
];

export const SLAYER_TIERS = [
  { at: 5, id: "slayer", name: "Bounty Slayer", tier: "diamond", unlocks: "title and the Bounty Slayer legendary frame" },
  { at: 10, id: "executioner", name: "Bounty Executioner", tier: "platinum", unlocks: "title, avatar and the Bounty Executioner frame" },
  { at: 15, id: "warlord", name: "Bounty Warlord", tier: "legendary", unlocks: "title, avatar, the Warlord diamond frame and a loot drop" },
];

/** Everything a given kill count has earned. Milestones stack. */
export function unlockedFor(kills) {
  const n = Number(kills) || 0;
  return {
    kill: [...KILL_TIERS].reverse().find((t) => n >= t.at) || null,
    slayers: SLAYER_TIERS.filter((t) => n >= t.at),
  };
}

/** What a single kill just unlocked, if anything. */
export function newlyUnlocked(before, after) {
  const was = unlockedFor(before);
  const now = unlockedFor(after);
  const out = [];
  if (now.kill && (!was.kill || was.kill.id !== now.kill.id)) out.push(now.kill);
  for (const s of now.slayers) if (!was.slayers.some((w) => w.id === s.id)) out.push(s);
  return out;
}

/* ── who takes it ────────────────────────────────────────────────────── */

/**
 * Decides what a finished match does to the bounty.
 *
 * Two paths, deliberately different. If the holder is in the match, beating
 * them head to head is the whole test — win it while they don't, and the rate
 * is irrelevant. If they aren't there, the only fair comparison is the rate
 * they set, so a hunter has to out-earn it per hour.
 *
 * @param {object|null} holder  { uid, name, perHour }
 * @param {object} match  { mode, field, durationMs, results: [{uid,name,score,placement}] }
 */
export function resolve(holder, match) {
  const out = { eligible: false, claim: null, defend: null, rates: {} };
  if (!isEligible(match)) return out;
  out.eligible = true;

  const rated = (match.results || []).map((r) => ({
    ...r,
    rate: perHour(r.score, match.durationMs),
  }));
  for (const r of rated) out.rates[r.uid] = r.rate;

  if (!holder) {
    // Nobody holds it: the winner takes it, unclaimed.
    const winner = rated.find((r) => r.placement === 1);
    if (winner) out.claim = { uid: winner.uid, name: winner.name, rate: winner.rate, from: null, bonus: CLAIM_BONUS };
    return out;
  }

  const holderRow = rated.find((r) => r.uid === holder.uid);

  if (holderRow) {
    // Head to head. The holder defends by winning; anyone who beats them to
    // first place takes it, whatever the rate says.
    if (holderRow.placement === 1) {
      out.defend = { uid: holder.uid, name: holder.name, rate: holderRow.rate, bonus: DEFEND_BONUS };
      return out;
    }
    const winner = rated.find((r) => r.placement === 1);
    if (winner) {
      out.claim = { uid: winner.uid, name: winner.name, rate: winner.rate, from: holder.uid, bonus: CLAIM_BONUS };
    }
    return out;
  }

  // The holder wasn't here, so the rate they set is the mark to beat. If
  // several clear it, the fastest earner takes it.
  const beaters = rated
    .filter((r) => r.rate > (holder.perHour || 0))
    .sort((a, b) => b.rate - a.rate);
  if (beaters.length) {
    const best = beaters[0];
    out.claim = { uid: best.uid, name: best.name, rate: best.rate, from: holder.uid, bonus: CLAIM_BONUS };
  }
  return out;
}

/** Has an unclaimed bounty gone stale? */
export function shouldRotate(holder, now = Date.now()) {
  if (!holder) return true;
  return now - (holder.setAt || 0) > ROTATE_AFTER_MS;
}
