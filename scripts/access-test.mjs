// node scripts/access-test.mjs
//
// The gate without a service account: what can be checked is the shape of
// an order number, the refusals, and that local play is never locked out.
import {
  cleanOrder, validOrder, membership, redeem, recover, epochOf, forget,
  cleanPass, validPass, newPassCode, passVerdict, claimPass, makePass, passState,
} from "../src/access.js";

let bad = 0;
const ok = (label, cond) => {
  console.log(`${cond ? "  pass" : "  FAIL"}  ${label}`);
  if (!cond) bad++;
};

console.log("\norder numbers");
ok("digits only survive", cleanOrder(" #3 456-789 012 ") === "3456789012");
ok("an Etsy receipt number is 8 to 12 digits", validOrder("3456789012") && validOrder("12345678") && validOrder("123456789012"));
ok("too short or too long is refused", !validOrder("1234567") && !validOrder("1234567890123"));
ok("letters never pass", !validOrder("abc4567890"));

console.log("\nfree passes");
ok("a code reads with or without its dashes",
  cleanPass("DOJO-7K2M-4QXB") === "DOJO-7K2M-4QXB" && cleanPass("dojo7k2m4qxb") === "DOJO-7K2M-4QXB");
ok("spaces and stray punctuation come out", cleanPass("  dojo 7k2m-4qxb.  ") === "DOJO-7K2M-4QXB");
ok("anything else is not a pass", !cleanPass("3456789012") && !cleanPass("DOJO-7K2M") && !cleanPass("hello"));
ok("a made code has the right shape", validPass(newPassCode()));
ok("a pass and an order number can never be each other",
  !validOrder(cleanOrder(newPassCode())) && !cleanPass("3456789012") && validOrder("3456789012"));
{
  const codes = new Set();
  let ambiguous = false;
  for (let i = 0; i < 500; i++) {
    const c = newPassCode();
    codes.add(c);
    if (/[01OI]/.test(c.slice(5))) ambiguous = true;
  }
  ok("five hundred codes, no repeats", codes.size === 500);
  ok("no character anybody has to guess at", !ambiguous);
}

const now = 1_000_000;
const passDoc = (extra = {}) => ({ pass: { booleanValue: true }, at: { integerValue: "1" }, expiresAt: { integerValue: String(now + 1000) }, ...extra });
ok("an unclaimed pass in date is open", passVerdict(passDoc(), now) === "open");
ok("one with an account on it is claimed", passVerdict(passDoc({ uid: { stringValue: "u1" } }), now) === "claimed");
ok("one past its day is expired", passVerdict(passDoc({ expiresAt: { integerValue: String(now - 1) } }), now) === "expired");
ok("a withdrawn one says so before anything else",
  passVerdict(passDoc({ revoked: { booleanValue: true }, uid: { stringValue: "u1" } }), now) === "revoked");
ok("an order number's key is not a pass at all", passVerdict({ uid: { stringValue: "u1" } }, now) === "unknown");

const passless = {};
let pr = await claimPass(passless, { uid: "p1", name: "A" }, "not-a-pass");
ok("junk is refused before anything is read", !pr.ok && /isn't a pass code/.test(pr.error));
pr = await claimPass(passless, { uid: "p1", name: "A" }, "DOJO-7K2M-4QXB");
ok("no service account means no passes taken", !pr.ok && /can't take passes/.test(pr.error));
for (let i = 0; i < 6; i++) await claimPass(passless, { uid: "p8", name: "Z" }, "DOJO-7K2M-4QXB");
pr = await claimPass(passless, { uid: "p8", name: "Z" }, "DOJO-7K2M-4QXB");
ok("seven tries in an hour is throttled", !pr.ok && /Too many/.test(pr.error));
pr = await makePass(passless, { uid: "boss", name: "B" });
ok("and none can be made either", !pr.ok && /can't make passes/.test(pr.error));
ok("an unreadable pass is unknown rather than open", (await passState(passless, "DOJO-7K2M-4QXB")).state === "unknown");

console.log("\nthe epoch");
ok("no epoch means nobody is grandfathered by date", epochOf({}) === 0);
ok("an ISO date reads", epochOf({ KEY_EPOCH: "2026-09-20T16:00:00Z" }) === Date.UTC(2026, 8, 20, 16));

console.log("\nmembership");
const local = {};
let m = await membership(local, { uid: "u1", name: "A" });
ok("local play with no account is in", m.unlocked === true && m.via === "local");
m = await membership({ ADMIN_UIDS: "boss" }, { uid: "boss", name: "B" });
ok("an admin is always in", m.unlocked === true && m.via === "admin");
forget("u1");

console.log("\nredeeming");
let r = await redeem(local, { uid: "u1", name: "A" }, "12");
ok("a bad number is refused before anything is read", !r.ok && /8 to 12/.test(r.error));
r = await redeem(local, { uid: "u1", name: "A" }, "3456789012");
ok("no service account means no keys taken", !r.ok && /can't take keys/.test(r.error));
for (let i = 0; i < 6; i++) await redeem(local, { uid: "u9", name: "Z" }, "3456789012");
r = await redeem(local, { uid: "u9", name: "Z" }, "3456789012");
ok("seven tries in an hour is throttled", !r.ok && /Too many/.test(r.error));

console.log("\nrecovering");
r = await recover(local, { name: "A", address: "a@x", order: "3456789012", pin: "12345" });
ok("a five-digit pin is refused", !r.ok && /six digits/.test(r.error));
r = await recover(local, { name: "A", address: "a@x", order: "3456789012", pin: "123456" });
ok("no key on file means no reset", !r.ok && /don't go together/.test(r.error));

console.log(bad ? `\n${bad} failing\n` : "\nall access checks passed\n");
process.exit(bad ? 1 : 0);
