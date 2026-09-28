// CoderImpact service worker: the app opens offline and starts fast.
// - Page loads: network first, falling back to the cached app page.
// - Built assets, grammars, illustrations, icons: cache first (file names change with content).
// - /api/* (explanations, Git relay) and other sites: never cached here; the app keeps
//   its own caches for repository files in IndexedDB.
const CACHE = "coderimpact-v3";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/config.json"];

/** Caches the app page and the script and stylesheet it references, so the app starts offline. */
async function cacheShell(response) {
  const c = await caches.open(CACHE);
  const res = response ?? (await fetch("/", { cache: "no-cache" }));
  if (!res.ok) return;
  const html = await res.clone().text();
  await c.put("/", res);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await Promise.all(assets.map((a) => c.match(a).then((hit) => hit ?? c.add(a).catch(() => undefined))));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => cacheShell())
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Imprint, privacy and terms are plain pages, not the app: never answer them with the app page.
  if (/^\/(imprint|privacy|terms)(\.html)?$/.test(url.pathname)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) cacheShell(res.clone()).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match("/").then((r) => r ?? Response.error())),
    );
    return;
  }

  const immutable = /^\/(assets|grammars|illustrations)\//.test(url.pathname) || /\.(png|svg|ico|webp|wasm|woff2?)$/.test(url.pathname);
  if (immutable) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Small JSON files (config, models): network first, cached copy when offline.
  if (url.pathname.endsWith(".json")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r ?? Response.error())),
    );
  }
});
