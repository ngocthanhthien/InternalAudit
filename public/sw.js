const CACHE='ild-audit-shell-v1';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['./','./index.html']))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ild-audit-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('./index.html')));
});
