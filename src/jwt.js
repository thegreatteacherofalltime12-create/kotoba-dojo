// Verifies Firebase Auth ID tokens inside a Worker.
//
// The Firebase Admin SDK does not run on Workers, so we verify the RS256
// signature ourselves against Google's published JWK set and then check the
// claims by hand. Keys are cached in the isolate for as long as Google's
// Cache-Control header allows.

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let keyCache = { keys: null, expiresAt: 0 };

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function fetchKeys() {
  const now = Date.now();
  if (keyCache.keys && now < keyCache.expiresAt) return keyCache.keys;

  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`could not load Google signing keys (${res.status})`);
  const body = await res.json();

  const cc = res.headers.get("cache-control") || "";
  const m = /max-age=(\d+)/i.exec(cc);
  const ttl = m ? Number(m[1]) * 1000 : 3600_000;

  const keys = {};
  for (const jwk of body.keys || []) keys[jwk.kid] = jwk;
  keyCache = { keys, expiresAt: now + ttl };
  return keys;
}

/**
 * @returns {Promise<{uid: string, name: string, picture: string|null}>}
 * @throws  {Error} on any verification failure
 */
export async function verifyIdToken(token, projectId) {
  if (!token || typeof token !== "string") throw new Error("missing token");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [rawHeader, rawPayload, rawSig] = parts;

  const header = b64urlToJson(rawHeader);
  if (header.alg !== "RS256") throw new Error("unexpected token algorithm");
  if (!header.kid) throw new Error("token has no key id");

  const keys = await fetchKeys();
  const jwk = keys[header.kid];
  if (!jwk) throw new Error("token signed by an unknown key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(rawSig),
    signed
  );
  if (!ok) throw new Error("bad token signature");

  const claims = b64urlToJson(rawPayload);
  const now = Math.floor(Date.now() / 1000);
  const skew = 60;

  if (claims.aud !== projectId) throw new Error("token was issued for another project");
  if (claims.iss !== `https://securetoken.google.com/${projectId}`)
    throw new Error("unexpected token issuer");
  if (typeof claims.exp !== "number" || claims.exp < now - skew)
    throw new Error("token expired");
  if (typeof claims.iat !== "number" || claims.iat > now + skew)
    throw new Error("token issued in the future");
  if (typeof claims.auth_time === "number" && claims.auth_time > now + skew)
    throw new Error("token auth_time is in the future");
  if (!claims.sub || typeof claims.sub !== "string")
    throw new Error("token has no subject");
  // Guest play is over: only a registered name gets through any door.
  if (claims.firebase?.sign_in_provider === "anonymous")
    throw new Error("guest play has ended");

  const fallback = claims.email ? String(claims.email).split("@")[0] : "";
  return {
    uid: claims.sub,
    name: cleanName(claims.name, fallback || "Student"),
    picture: claims.picture || null,
  };
}

// Characters that hide or turn text around: controls, zero-widths, the
// direction marks that can make one name read as another, and the blank
// fillers some scripts provide.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;
// The arena's own voices. A player can't take one, whatever the spacing.
const STAFF = /^(admin|administrator|moderator|mod|system|arena|staff|official)$/i;

/**
 * The name a player shows. It is their own choice (the profile lets them
 * rename) and comes from the token, which they can set to anything, so it is
 * cleaned here: nothing hidden or reversed, no staff titles, two to
 * twenty-four characters. Anything that fails stands down to the name they
 * signed up with.
 */
export function cleanName(raw, fallback) {
  const s = String(raw ?? "").normalize("NFKC").replace(HIDDEN, "").replace(/\s+/g, " ").trim().slice(0, 24).trim();
  if (s.length < 2 || STAFF.test(s.replace(/[^a-z]/gi, ""))) return fallback;
  return s;
}
