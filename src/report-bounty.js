// One way in, for every game that can move the bounty.
//
// A game hands over its finished results; this converts them into the shape
// the office expects, folds any bonus back into each player's MMR gain, and
// hands back what to announce. Games do not reach into the office directly,
// so the rules for who may claim live in exactly one place.

export async function applyBounty(env, state, { mode, durationMs, results }) {
  if (!env?.BOUNTY) return null;

  const field = results.filter((r) => r.status !== "watching").length;
  const payload = {
    mode, field, durationMs,
    results: results.map((r) => ({
      uid: r.uid, name: r.name, score: r.score, placement: r.placement,
    })),
  };

  let verdict;
  try {
    const stub = env.BOUNTY.get(env.BOUNTY.idFromName("global"));
    const res = await stub.fetch("https://bounty/report", {
      method: "POST", body: JSON.stringify(payload),
    });
    verdict = await res.json();
  } catch {
    return null;    // the office being unreachable must never stop a result
  }

  // The rate each player set is banked with their result, so a bounty that
  // rotates to them later has a real mark rather than a guess.
  for (const r of results) r.rate = verdict.rates?.[r.uid] ?? r.rate ?? 0;

  if (verdict.claim) {
    const row = results.find((r) => r.uid === verdict.claim.uid);
    if (row) {
      row.gain += verdict.claim.bonus;
      row.mmrAfter = (row.mmrBefore || 0) + row.gain;
      row.bounty = { kind: "claimed", bonus: verdict.claim.bonus, from: verdict.claim.fromName, kills: verdict.claim.kills };
    }
  }
  if (verdict.defend) {
    const row = results.find((r) => r.uid === verdict.defend.uid);
    if (row) {
      row.gain += verdict.defend.bonus;
      row.mmrAfter = (row.mmrBefore || 0) + row.gain;
      row.bounty = { kind: "defended", bonus: verdict.defend.bonus, defends: verdict.defend.defends };
    }
  }

  return verdict;
}
