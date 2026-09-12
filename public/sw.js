/* 言の葉 KOTONOHA — offline-first service worker.
   静态资源 cache-first；页面导航 network-first 回退缓存；API GET network-first 并缓存最新数据供离线读取。 */
const CACHE = 'kotonoha-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

function put(request, response) {
  if (!response || !response.ok) return
  const copy = response.clone()
  caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // 跨域（如 Google Fonts）：cache-first，后台填充。
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const network = fetch(request).then((response) => { put(request, response); return response })
        return hit || network.catch(() => hit)
      }),
    )
    return
  }

  // API：network-first，成功的 GET 缓存起来，离线时回退缓存数据。
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => { put(request, response); return response })
        .catch(async () => {
          const hit = await caches.match(request)
          return hit || new Response(JSON.stringify({ error: '当前离线，且没有缓存数据。' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        }),
    )
    return
  }

  // 页面导航：network-first，离线回退到缓存的 index.html（SPA）。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => { put('/index.html', response); return response })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  // 同源静态资源（hash 过的 JS/CSS/图标）：cache-first。
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((response) => { put(request, response); return response })
    }),
  )
})
