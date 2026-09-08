import {
  resolve, shouldRotate, perHour, unlockedFor, newlyUnlocked,
  CLAIM_BONUS, DEFEND_BONUS,
} from "./bounty.js";
import { topPlayers } from "./firestore.js";

// One instance for the whole arena.
//
// A bounty can only be held by one person, and two matches can finish in the
// same second. Putting it in a Durable Object means claims are decided one at
// a time, in order — the thing a shared document could not promise.
export class BountyOffice {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      this.b = (await state.storage.get("bounty")) || {
        holder: null,          // { uid, name, perHour, setAt, defends }
        kills: {},             // uid -> total claims
        defends: {},           // uid -> total defends
        history: [],           // most recent first
      };
    });
  }

  save() { return this.state.storage.put({ bounty: this.b }); }

  note(entry) {
    this.b.history.unshift({ at: Date.now(), ...entry });
    this.b.history = this.b.history.slice(0, 40);
  }

  /**
   * Nobody has taken it in two days, so it moves to a random top-ten player.
   * The mark to beat becomes their own last recorded rate.
   */
  async rotate() {
    let top = [];
    try { top = await topPlayers(this.env, 10); } catch { top = []; }
    const pool = top.filter((p) => p.uid && p.uid !== this.b.holder?.uid);
    if (!pool.length) return false;

    const pick = pool[Math.floor(Math.random() * pool.length)];
    const previous = this.b.holder?.name || null;
    this.b.holder = {
      uid: pick.uid,
      name: pick.name || "Someone",
      perHour: pick.lastRate || perHour(pick.bestScore || 0, 3_600_000),
      setAt: Date.now(),
      defends: 0,
      rotated: true,
    };
    this.note({ kind: "rotated", to: this.b.holder.name, from: previous });
    await this.save();
    return true;
  }

  async current() {
    if (shouldRotate(this.b.holder)) await this.rotate();
    return this.b;
  }

  /**
   * A finished match is reported here, and this is where the bounty moves.
   * Returns the bonuses to fold into that match's MMR before it is recorded.
   */
  async report(match) {
    if (shouldRotate(this.b.holder)) await this.rotate();

    const verdict = resolve(this.b.holder, match);
    const out = { eligible: verdict.eligible, claim: null, defend: null, unlocked: [], holder: this.b.holder };
    if (!verdict.eligible) return out;

    if (verdict.defend) {
      const uid = verdict.defend.uid;
      this.b.defends[uid] = (this.b.defends[uid] || 0) + 1;
      this.b.holder.defends = this.b.defends[uid];
      // Defending in a Rumble raises the mark, so the next hunter has more to do.
      if (match.mode === "rumble" && verdict.defend.rate > (this.b.holder.perHour || 0)) {
        this.b.holder.perHour = verdict.defend.rate;
      }
      this.b.holder.setAt = Date.now();
      this.note({ kind: "defended", by: verdict.defend.name, rate: verdict.defend.rate });
      out.defend = { ...verdict.defend, defends: this.b.defends[uid] };
      await this.save();
      return out;
    }

    if (verdict.claim) {
      const uid = verdict.claim.uid;
      const before = this.b.kills[uid] || 0;
      this.b.kills[uid] = before + 1;
      const unlocked = newlyUnlocked(before, this.b.kills[uid]);

      const from = this.b.holder;
      this.b.holder = {
        uid,
        name: verdict.claim.name,
        perHour: verdict.claim.rate,
        setAt: Date.now(),
        defends: 0,
      };
      this.note({ kind: "claimed", by: verdict.claim.name, from: from?.name || null, rate: verdict.claim.rate });

      out.claim = { ...verdict.claim, kills: this.b.kills[uid], fromName: from?.name || null };
      out.unlocked = unlocked;
      out.holder = this.b.holder;
      await this.save();
      return out;
    }

    return out;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/current") {
      const b = await this.current();
      return Response.json({
        holder: b.holder,
        kills: b.kills,
        defends: b.defends,
        history: b.history.slice(0, 12),
      });
    }

    if (url.pathname === "/report") {
      const match = await request.json();
      return Response.json(await this.report(match));
    }

    if (url.pathname === "/player") {
      const uid = url.searchParams.get("uid");
      const kills = this.b.kills[uid] || 0;
      return Response.json({
        uid, kills, defends: this.b.defends[uid] || 0,
        holding: this.b.holder?.uid === uid,
        unlocked: unlockedFor(kills),
      });
    }

    return new Response("not found", { status: 404 });
  }
}

export const bountyBonus = { CLAIM_BONUS, DEFEND_BONUS };
