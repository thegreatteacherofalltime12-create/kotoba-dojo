// The offline shell.
//
// One rule decides everything here: code is fetched from the network first,
// and the cache is only a fallback for when there is no network. A cache-first
// worker will happily serve a month-old app.js to someone who just deployed,
// and the deploy looks like it did nothing — which is exactly the failure this
// file is written to avoid.
//
// Bump CACHE whenever you want every installed copy to drop what it holds.

const CACHE = "dojo-shell-v23";

// Enough to open the app with no signal. Everything else is cached as it is
// used, so this list never needs maintaining.
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  // Take over straight away rather than waiting for every tab to close.
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/** Anything that is code, or the page itself. Never served stale by choice. */
function isCode(url, request) {
  if (request.mode === "navigate") return true;
  return /\.(js|mjs|css|webmanifest)$/i.test(new URL(url).pathname);
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // The API is live data and the WebSocket is not cacheable at all.
  if (url.pathname.startsWith("/api/")) return;
  // The update check has to reach the real server every time, or the app ends
  // up comparing its own build against a cached copy of itself.
  if (url.pathname.endsWith("/version.json")) return;
  // Other origins — fonts, the QR library — look after themselves.
  if (url.origin !== self.location.origin) return;

  if (isCode(request.url, request)) {
    // Network first. A fresh copy is cached on the way past, so the fallback
    // is always the last version that actually loaded.
    e.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
          const copy = fresh.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return fresh;
      } catch {
        const hit = await caches.match(request);
        if (hit) return hit;
        // A navigation with nothing cached still needs a page to land on.
        if (request.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        throw new Error("offline and nothing cached");
      }
    })());
    return;
  }

  // Images, icons and fonts don't change under the same name, so they come
  // from the cache when they're there and are filled in when they're not.
  e.respondWith((async () => {
    const hit = await caches.match(request);
    if (hit) return hit;
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const copy = fresh.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
    }
    return fresh;
  })());
});
