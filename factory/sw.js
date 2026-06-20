/**
 * sw.js — Service Worker สำหรับ Sawanbondin WMS
 * - Cache static assets เพื่อเปิดเร็วขึ้น
 * - Offline fallback: แสดงหน้าเตือนเมื่อไม่มีเน็ต
 * - ข้อมูลจริง (Supabase API) ยังต้องใช้อินเทอร์เน็ตอยู่
 */

const CACHE_NAME   = 'swbd-wms-v4';
const CACHE_ASSETS = [
  './',
  './index.html',
  './config.js',
  './app.js',
  './data.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
];

// ── Install: cache static assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // cache ที่ทำได้ ถ้าบางอันล้มเหลวไม่เป็นไร
      return Promise.allSettled(
        CACHE_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

// ── Activate: ลบ cache เก่า ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME)
            .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: Network first, Cache fallback ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API calls — ไม่ cache เด็ดขาด (ข้อมูล realtime)
  if (url.hostname.includes('supabase.co')) {
    return; // ปล่อย fetch ตามปกติ
  }

  // Static assets — Network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // cache response ใหม่
        if (response && response.status === 200 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline fallback
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // ถ้าไม่มี cache ให้ส่ง fallback HTML
          if (event.request.destination === 'document') {
            return new Response(`
              <!DOCTYPE html>
              <html lang="th">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Sawanbondin — ออฟไลน์</title>
                <style>
                  body{font-family:system-ui,sans-serif;display:flex;align-items:center;
                    justify-content:center;min-height:100vh;background:#f0f0ee;margin:0}
                  .card{background:#fff;border-radius:12px;padding:32px;text-align:center;
                    max-width:300px;box-shadow:0 4px 24px rgba(0,0,0,.1)}
                  .icon{font-size:48px;margin-bottom:12px}
                  h2{font-size:18px;margin-bottom:8px;color:#1c1c1e}
                  p{font-size:13px;color:#8e8e93;line-height:1.5}
                  button{margin-top:16px;padding:10px 20px;background:#1c1c1e;border:none;
                    border-radius:8px;color:#fff;font-size:14px;cursor:pointer;width:100%}
                </style>
              </head>
              <body>
                <div class="card">
                  <div class="icon">📶</div>
                  <h2>ไม่มีการเชื่อมต่ออินเทอร์เน็ต</h2>
                  <p>ระบบจัดการคลัง Sawanbondin ต้องการการเชื่อมต่ออินเทอร์เน็ตเพื่อเข้าถึงข้อมูล</p>
                  <button onclick="location.reload()">ลองใหม่อีกครั้ง</button>
                </div>
              </body>
              </html>`,
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          }
        });
      })
  );
});
