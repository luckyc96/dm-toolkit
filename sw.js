/* DM Toolkit offline helper.
   Keeps a copy of the app on this device so it opens without a connection.
   The page itself is fetched fresh whenever the network answers within a few seconds,
   so updates you push to GitHub show up on the next open. Google sign-in and Drive
   requests are never touched; the app already queues Drive changes while offline. */
const VERSION = 'dmt-v1';
const PAGE = './index.html';
const SHELL = [PAGE, './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'
];
const CACHE_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    // Word/Markdown helpers: nice to have offline, but don't fail the install over them.
    await Promise.all(LIBS.map(u => c.add(new Request(u, {mode: 'cors'})).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isPage = url => url.origin === location.origin &&
  (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.searchParams.has('sandbox')) return;           // the test page always gets the real file
  if (req.mode === 'navigate' && isPage(url)) { e.respondWith(pageFirst(req)); return; }
  if (url.origin === location.origin && SHELL.some(p => url.pathname.endsWith(p.slice(1)))) { e.respondWith(cacheFirst(req)); return; }
  if (CACHE_HOSTS.includes(url.hostname)) { e.respondWith(cacheFirst(req)); return; }
  // Everything else (Google sign-in, Drive, test.html) goes straight to the network.
});

async function pageFirst(req) {
  const c = await caches.open(VERSION);
  const net = fetch(req, {cache: 'no-cache'}).then(r => { if (r.ok) c.put(PAGE, r.clone()); return r; });
  const slow = new Promise(res => setTimeout(res, 3500));
  try {
    const r = await Promise.race([net, slow.then(() => null)]);
    if (r && r.ok) return r;
  } catch (err) { /* offline: fall through to the saved copy */ }
  const saved = await c.match(PAGE);
  if (saved) { net.catch(() => {}); return saved; }
  return net;                                               // first visit with no saved copy yet
}

async function cacheFirst(req) {
  const c = await caches.open(VERSION);
  const hit = await c.match(req, {ignoreSearch: req.url.startsWith(self.location.origin)});
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') c.put(req, r.clone());
  return r;
}
