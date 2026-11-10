// node scripts/wallet-race-test.mjs
//
// Ten withdrawals fired at once against a wallet that can pay for one. Read
// on its own and then written, every one of them saw the whole wallet and
// every one paid it out. The read and the spend now share a transaction, and
// this fakes Firestore closely enough to prove only one gets through: a
// commit is aborted when the wallet moved after its transaction read it.
import { withdrawWallet, buyToken } from "../src/firestore.js";

let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };

// A throwaway signing key, made here and gone with the process.
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
const env = { FIREBASE_PROJECT_ID: "t", FIREBASE_SERVICE_ACCOUNT: { client_email: "test@t.iam", private_key: pem } };

// The fake: one wallet, a version that moves on every write, transactions
// that remember what they read.
let wallet = 0, version = 0, nextTx = 0, aborted = 0;
const txs = new Map();
const jitter = () => new Promise((r) => setTimeout(r, Math.random() * 15));
const reply = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  await jitter();
  if (url.startsWith("https://oauth2.googleapis.com/token")) return reply(200, { access_token: "fake", expires_in: 3600 });
  if (url.endsWith(":beginTransaction")) { const id = `tx${++nextTx}`; txs.set(id, { read: null }); return reply(200, { transaction: id }); }
  if (url.endsWith(":rollback")) { txs.delete(JSON.parse(init.body).transaction); return reply(200); }
  if (url.includes("/users/") && (!init.method || init.method === "GET")) {
    const tx = new URL(url).searchParams.get("transaction");
    if (tx && txs.has(tx)) txs.get(tx).read = version;
    return reply(200, { fields: { casino: { mapValue: { fields: { wallet: { integerValue: String(wallet) } } } } } });
  }
  if (url.endsWith(":commit")) {
    const body = JSON.parse(init.body);
    if (body.transaction) {
      const tx = txs.get(body.transaction);
      txs.delete(body.transaction);
      if (!tx || tx.read !== version) { aborted++; return reply(409, { error: { status: "ABORTED" } }); }
    }
    for (const w of body.writes) {
      for (const t of w.transform?.fieldTransforms || []) {
        if (t.fieldPath === "casino.wallet") wallet += Number(t.increment.integerValue);
      }
    }
    version++;
    return reply(200, { writeResults: [] });
  }
  return reply(404);
};

console.log("\nten withdrawals at once, money for one");
wallet = 1000; version = 0;
const outs = await Promise.all(Array.from({ length: 10 }, () => withdrawWallet(env, "u1", 1000, "Ana")));
ok("exactly one is paid", outs.filter((o) => o.ok).length === 1);
ok("the other nine are refused", outs.filter((o) => !o.ok).length === 9);
ok("the wallet ends at nothing, not below it", wallet === 0);
ok("the race was really run: some commits were aborted and retried", aborted > 0);

console.log("\na wallet that can pay twice, five asking");
wallet = 500; version = 0; aborted = 0;
const halves = await Promise.all(Array.from({ length: 5 }, () => withdrawWallet(env, "u1", 250, "Ana")));
ok("two are paid", halves.filter((o) => o.ok).length === 2);
ok("the wallet ends at nothing", wallet === 0);

console.log("\na burst of purchases");
wallet = 1000; version = 0; aborted = 0;
const buys = await Promise.all(Array.from({ length: 8 }, () => buyToken(env, "u1", "Ana", "crossword", 1)));
const paid = buys.filter((o) => o.ok).length;
const price = paid ? (1000 - wallet) / paid : 0;
ok("never more bought than the wallet holds", wallet >= 0 && paid > 0);
ok("every token the money could buy was sold, and no more", paid === Math.floor(1000 / price) && wallet < price);

console.log("\nan honest single withdrawal still works");
wallet = 300; version = 0;
const one = await withdrawWallet(env, "u1", 100, "Ana");
ok("it is paid", one.ok === true && one.amount === 100);
ok("and leaves the rest", one.remaining === 200 && wallet === 200);
const over = await withdrawWallet(env, "u1", 500, "Ana");
ok("asking for more than is there is refused with the balance", !over.ok && /200/.test(over.error));

console.log(bad ? `\n${bad} wallet race check(s) FAILED` : "\nall wallet race checks passed");
process.exit(bad ? 1 : 0);
