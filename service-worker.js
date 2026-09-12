const CACHE_NAME = "cnmi-donor-v15-17";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=15.17",
  "./app.js?v=15.17",
  "./config.js?v=15.5",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache) {
    return cache.addAll(APP_SHELL).catch(function() { return Promise.resolve(); });
  }).then(function() { return self.skipWaiting(); }));
});

self.addEventListener("activate", function(event) {
  event.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.map(function(key) {
      if (key !== CACHE_NAME && key.indexOf("cnmi-donor-") === 0) return caches.delete(key);
      return Promise.resolve();
    }));
  }).then(function() { return self.clients.claim(); }));
});

self.addEventListener("fetch", function(event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(fetch(request).then(function(response) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(function(cache) { cache.put(request, copy).catch(function() {}); });
    return response;
  }).catch(function() {
    return caches.match(request).then(function(cached) {
      if (cached) return cached;
      if (request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    });
  }));
});

self.addEventListener("push", function(event) {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = { body:event.data ? event.data.text() : "" }; }
  const title = payload.title || "CNMI Donor";
  const options = {
    body: payload.body || "มีรายการใหม่ในระบบ",
    icon: payload.icon || "./icons/icon-192.png",
    badge: payload.badge || "./icons/icon-192.png",
    tag: payload.tag || "cnmi-donor-notification",
    data: { url:payload.url || "./#/staff/questions", extra:payload.data || {} },
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "./#/staff/questions";
  event.waitUntil(clients.matchAll({ type:"window", includeUncontrolled:true }).then(function(list) {
    for (const client of list) {
      if ("focus" in client) {
        try { client.navigate(targetUrl); } catch (e) {}
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
  }));
});
