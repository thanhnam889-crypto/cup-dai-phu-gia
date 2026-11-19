const CACHE='ld-11190945';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./qr-lien-doan.png','./logo-ldc-256.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('ld-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  if(u.origin!==location.origin||!u.pathname.startsWith('/lien-doan/'))return;
  if(u.pathname.endsWith('.json')){e.respondWith(fetch(r).then(res=>{const c=res.clone();caches.open(CACHE).then(x=>x.put(r,c)).catch(()=>{});return res}).catch(()=>caches.match(r,{ignoreSearch:true})));return;}
  if(r.mode==='navigate'){e.respondWith(fetch(r).then(res=>{const c=res.clone();caches.open(CACHE).then(x=>x.put(r,c)).catch(()=>{});return res}).catch(()=>caches.match(r).then(x=>x||caches.match('./index.html'))));return;}
  e.respondWith(caches.match(r).then(x=>x||fetch(r).then(res=>{const c=res.clone();caches.open(CACHE).then(y=>y.put(r,c)).catch(()=>{});return res})));});
