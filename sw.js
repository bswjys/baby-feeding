/* 수유 앱 · 오프라인 캐시 (v6)
 * 규칙
 *  - HTML(index.html): 네트워크 우선 → 오프라인일 때만 캐시
 *  - 코드(app.js, styles.css): 네트워크 우선 → 오프라인일 때만 캐시
 *    (예전엔 캐시 우선이라서 새 HTML + 옛 app.js 가 섞여 버튼이 안 먹혔음)
 *  - 아이콘 등 나머지: 캐시 우선
 */
const CACHE = 'baby-feeding-v7';
const VERSION = '7';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=' + VERSION,
  './app.js?v=' + VERSION,
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

// 버전이 붙은 주소/안 붙은 주소를 같은 자산으로 본다
const isCode = (path) => /\/app\.js$/.test(path) || /\/styles\.css$/.test(path);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(
        ASSETS.map((url) => cache.add(url).catch(() => null)) // 하나 실패해도 설치 계속
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('baby-feeding-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/** 네트워크 우선: 성공하면 캐시에 갱신, 실패(오프라인)하면 캐시 */
function networkFirst(req, cacheKey) {
  return fetch(req, { cache: 'no-cache' })
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(cacheKey, copy)).catch(() => {});
      }
      return res;
    })
    .catch(() => caches.match(cacheKey, { ignoreSearch: true })
      .then((hit) => hit || caches.match(req)));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 페이지 이동: 네트워크 우선, 실패하면 캐시된 index.html
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, './index.html'));
    return;
  }

  // 코드 자산: 네트워크 우선 (HTML 과 버전이 엇갈리지 않게)
  if (isCode(url.pathname)) {
    const key = /\/app\.js$/.test(url.pathname) ? './app.js' : './styles.css';
    event.respondWith(networkFirst(req, key));
    return;
  }

  // 그 외(아이콘, manifest 등): 캐시 우선
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
