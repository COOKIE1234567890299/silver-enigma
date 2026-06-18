// 极简 Service Worker：满足 PWA 可安装条件（带动态缓存处理）
const CACHE = 'yyjs-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  // 只拦截 http 和 https 请求（避免拓展程序的协议等报错）
  if (!e.request.url.startsWith('http')) return;
  
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // 请求成功时，动态将资源写入缓存（让 PWA 真正具备离线能力）
        const resClone = res.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});