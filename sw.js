const CACHE='dpg-2026-v15';
const ASSETS=['./','./index.html','./manifest.webmanifest',
 './icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png',
 './icons/apple-touch-icon.png','./icons/favicon-64.png'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==location.origin)return; // bỏ qua Firebase/CDN -> để trình duyệt tự tải
  if(req.mode==='navigate'||req.destination==='document'){
    // HTML: ưu tiên mạng (luôn mới), offline mới dùng bản lưu
    e.respondWith(fetch(req).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put(req,cp)).catch(()=>{});return res;})
      .catch(()=>caches.match(req).then(r=>r||caches.match('./index.html'))));
    return;
  }
  // tài nguyên khác: dùng bản lưu cho nhanh
  e.respondWith(caches.match(req).then(r=>r||fetch(req).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put(req,cp)).catch(()=>{});return res;})));
});
