// Membership: who gets through the gate.
//
// The game is sold on Etsy. A buyer's order number is their key: entered once
// at register, it is locked to that account and can never open another. The
// same number resets a forgotten pin. Accounts that existed before the keys
// went in are grandfathered — the first time one is seen it is marked as such
// off the Firebase Auth record, so nobody who was already playing is asked
// for anything.
//
// What is stored:
//   users/{uid}.access     { via: "etsy"|"grandfathered"|"admin", order, at, revoked? }
//   keys/{order}           { uid, name, at, revoked? }   — one document per number
//
// Every authenticated request asks `membership`; the answer is cached in the
// isolate so the gate costs one Firestore read per player per ten minutes,
// not one per click.
import { accessToken, base, S, I } from "./firestore.js";

const ORDER_RE = /^\d{8,12}$/;
const UNLOCKED_TTL = 10 * 60_000;
const LOCKED_TTL = 30_000;
const TRIES_PER_HOUR = 6;

const cache = new Map();   // uid -> { value, until }
const tries = new Map();   // key -> [timestamps]

const admins = (env) => String(env.ADMIN_UIDS || "").split(",").map((x) => x.trim()).filter(Boolean);
export const epochOf = (env) => Date.parse(env.KEY_EPOCH || "") || 0;
export const cleanOrder = (raw) => String(raw || "").replace(/[^\d]/g, "");
export const validOrder = (order) => ORDER_RE.test(order);

/** True while a key has been tried too often. */
function throttled(key) {
  const now = Date.now();
  const list = (tries.get(key) || []).filter((t) => now - t < 3_600_000);
  if (list.length >= TRIES_PER_HOUR) { tries.set(key, list); return true; }
  list.push(now);
  tries.set(key, list);
  return false;
}

// ── Firebase Auth ────────────────────────────────────────────────────

const toolkit = (env) => `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts`;

/** One account by uid or email: { uid, email, createdAt } or null. Throws when Auth cannot be asked. */
export async function lookupAccount(env, { uid, email }) {
  const token = await accessToken(env);
  if (!token) throw new Error("no service account");
  const res = await fetch(`${toolkit(env)}:lookup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(uid ? { localId: [uid] } : { email: [email] }),
  });
  if (!res.ok) throw new Error(`Auth lookup refused (${res.status})`);
  const u = (await res.json()).users?.[0];
  return u ? { uid: u.localId, email: u.email || "", createdAt: Number(u.createdAt || 0) } : null;
}

/** Sets an account's password — the pin in the client's own derivation. */
export async function setPin(env, uid, pin) {
  const token = await accessToken(env);
  if (!token) return false;
  const res = await fetch(`${toolkit(env)}:update`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: uid, password: `${pin}#kd` }),
  });
  return res.ok;
}

// ── Firestore ────────────────────────────────────────────────────────

const mapOf = (doc, field) => {
  const m = doc?.fields?.[field]?.mapValue?.fields;
  if (!m) return null;
  const out = {};
  for (const [k, v] of Object.entries(m)) out[k] = v.stringValue ?? (v.integerValue != null ? Number(v.integerValue) : v.booleanValue);
  return out;
};

async function readDoc(env, path) {
  const token = await accessToken(env);
  if (!token) return undefined;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) return undefined;
  return res.json();
}

const accessFields = (a) => ({
  mapValue: { fields: {
    via: S(a.via), at: I(a.at), ...(a.order ? { order: S(a.order) } : {}),
    ...(a.revoked ? { revoked: { booleanValue: true } } : {}),
  } },
});

async function writeAccess(env, uid, name, a) {
  const token = await accessToken(env);
  if (!token) return false;
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: [{
      update: { name: `${base(env)}/users/${uid}`, fields: { access: accessFields(a), ...(name ? { name: S(name) } : {}) } },
      updateMask: { fieldPaths: ["access", ...(name ? ["name"] : [])] },
    }] }),
  });
  return res.ok;
}

// ── the gate ─────────────────────────────────────────────────────────

/**
 * Where an account stands: { unlocked, via, order, reason }.
 *
 * Admins are always in. Without a service account (local play) everyone is
 * in, because nothing could be checked. A failure to reach Firestore or Auth
 * comes back as `unknown: true` and is not cached, so the client can say
 * "try again" rather than "buy a key".
 */
export async function membership(env, user) {
  const uid = user.uid;
  if (admins(env).includes(uid)) return { unlocked: true, via: "admin" };
  const hit = cache.get(uid);
  if (hit && Date.now() < hit.until) return hit.value;

  const doc = await readDoc(env, `users/${uid}`);
  if (doc === undefined) {
    if (!env.FIREBASE_SERVICE_ACCOUNT) return { unlocked: true, via: "local" };
    return { unlocked: false, unknown: true, reason: "The arena couldn't check your key. Try again in a moment." };
  }
  const a = mapOf(doc, "access");
  let value;
  if (a && !a.revoked) value = { unlocked: true, via: a.via, order: a.order || null };
  else if (a?.revoked) value = { unlocked: false, reason: "revoked", order: a.order || null };
  else {
    // No record at all: an account from before the keys, or a new one.
    let created = 0;
    try { created = (await lookupAccount(env, { uid }))?.createdAt || 0; }
    catch { return { unlocked: false, unknown: true, reason: "The arena couldn't check your key. Try again in a moment." }; }
    if (created && created < epochOf(env)) {
      await writeAccess(env, uid, user.name, { via: "grandfathered", at: Date.now() });
      value = { unlocked: true, via: "grandfathered" };
    } else value = { unlocked: false, reason: "key" };
  }
  cache.set(uid, { value, until: Date.now() + (value.unlocked ? UNLOCKED_TTL : LOCKED_TTL) });
  return value;
}

export const forget = (uid) => cache.delete(uid);

/**
 * Locks an order number to this account. One commit: the key document may
 * not already exist (that is the whole check), and the account's access
 * record is written beside it.
 */
export async function redeem(env, user, raw) {
  const order = cleanOrder(raw);
  if (!validOrder(order)) return { ok: false, error: "An Etsy order number is 8 to 12 digits." };
  if (throttled(`r:${user.uid}`)) return { ok: false, error: "Too many tries. Wait an hour." };
  const token = await accessToken(env);
  if (!token) return { ok: false, error: "The arena can't take keys right now." };
  const at = Date.now();
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: [
      {
        update: { name: `${base(env)}/keys/${order}`, fields: { uid: S(user.uid), name: S(user.name || "Player"), at: I(at) } },
        currentDocument: { exists: false },
      },
      {
        update: { name: `${base(env)}/users/${user.uid}`, fields: { access: accessFields({ via: "etsy", order, at }), name: S(user.name || "Player") } },
        updateMask: { fieldPaths: ["access", "name"] },
      },
    ] }),
  });
  if (res.status === 400 || res.status === 409) {
    return { ok: false, error: "That order number has already been used. If it's yours, the pin reset on the sign-in page takes it." };
  }
  if (!res.ok) return { ok: false, error: "Firestore refused the key. Try again." };
  forget(user.uid);
  return { ok: true, order };
}

/**
 * A forgotten pin, reset against the key: the name's account must be the one
 * the order number unlocked. Throttled by name and by number.
 */
export async function recover(env, { name, order: raw, pin, address }) {
  const order = cleanOrder(raw);
  if (!validOrder(order)) return { ok: false, error: "An Etsy order number is 8 to 12 digits." };
  if (!/^\d{6}$/.test(pin)) return { ok: false, error: "The new pin is exactly six digits." };
  if (throttled(`n:${name.toLowerCase()}`) || throttled(`o:${order}`)) return { ok: false, error: "Too many tries. Wait an hour." };
  const key = await readDoc(env, `keys/${order}`);
  if (!key) return { ok: false, error: "That name and order number don't go together." };
  const k = { uid: key.fields?.uid?.stringValue, revoked: key.fields?.revoked?.booleanValue };
  let acct = null;
  try { acct = await lookupAccount(env, { email: address }); } catch { return { ok: false, error: "The arena couldn't reach sign-in. Try again in a moment." }; }
  if (!acct || acct.uid !== k.uid || k.revoked) return { ok: false, error: "That name and order number don't go together." };
  if (!await setPin(env, acct.uid, pin)) return { ok: false, error: "The pin could not be set. Try again." };
  return { ok: true };
}

// ── the admin's desk ─────────────────────────────────────────────────

/** Every key, newest first. */
export async function listKeys(env, limit = 200) {
  const token = await accessToken(env);
  if (!token) return [];
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "keys" }],
      orderBy: [{ field: { fieldPath: "at" }, direction: "DESCENDING" }],
      limit,
    } }),
  });
  if (!res.ok) return [];
  const rows = [];
  for (const r of await res.json()) {
    const d = r.document;
    if (!d) continue;
    rows.push({
      order: d.name.split("/").pop(),
      uid: d.fields?.uid?.stringValue || "",
      name: d.fields?.name?.stringValue || "",
      at: Number(d.fields?.at?.integerValue || 0),
      revoked: !!d.fields?.revoked?.booleanValue,
    });
  }
  return rows;
}

/** Revokes (or restores) a key and the account it opened. */
export async function revokeKey(env, order, revoked) {
  const key = await readDoc(env, `keys/${order}`);
  if (!key) return { ok: false, error: "No such key." };
  const uid = key.fields?.uid?.stringValue;
  const token = await accessToken(env);
  const res = await fetch(`https://firestore.googleapis.com/v1/${base(env)}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: [
      { update: { name: `${base(env)}/keys/${order}`, fields: { revoked: { booleanValue: !!revoked } } }, updateMask: { fieldPaths: ["revoked"] } },
      { update: { name: `${base(env)}/users/${uid}`, fields: { "access": accessFields({ via: "etsy", order, at: Number(key.fields?.at?.integerValue || Date.now()), revoked: !!revoked }) } }, updateMask: { fieldPaths: ["access"] } },
    ] }),
  });
  if (!res.ok) return { ok: false, error: "Firestore refused." };
  forget(uid);
  return { ok: true };
}

/** Lets a name in by hand, or resets its pin, after the admin has checked the order on Etsy. */
export async function adminUnlock(env, { name, address, pin }) {
  let acct = null;
  try { acct = await lookupAccount(env, { email: address }); } catch { return { ok: false, error: "Sign-in could not be asked." }; }
  if (!acct) return { ok: false, error: "No account by that name." };
  if (pin) {
    if (!/^\d{6}$/.test(pin)) return { ok: false, error: "A pin is six digits." };
    return (await setPin(env, acct.uid, pin)) ? { ok: true, uid: acct.uid, pin: true } : { ok: false, error: "The pin could not be set." };
  }
  const ok = await writeAccess(env, acct.uid, name, { via: "admin", at: Date.now() });
  forget(acct.uid);
  return ok ? { ok: true, uid: acct.uid } : { ok: false, error: "Firestore refused." };
}
