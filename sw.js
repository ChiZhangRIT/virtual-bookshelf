// 离线缓存：有网时取最新版本（网页 3 秒内没响应就先用缓存），没网时用缓存
const CACHE = 'vshelf-v2';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  let stored = Promise.resolve();
  const net = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) {
      const copy = res.clone();
      stored = caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  });
  e.waitUntil(net.then(() => stored, () => {}).catch(() => {}));
  if (req.mode !== 'navigate') {
    e.respondWith(net.catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || Response.error())));
    return;
  }
  const cached = () => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'));
  e.respondWith(new Promise(resolve => {
    let settled = false;
    const finish = r => { if (!settled && r) { settled = true; resolve(r); } };
    const timer = setTimeout(() => cached().then(finish), 3000);
    net.then(res => { clearTimeout(timer); finish(res); })
      .catch(() => { clearTimeout(timer); cached().then(r => finish(r || Response.error())); });
  }));
});
