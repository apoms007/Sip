// Bump CACHE alongside the ?v= query in index.html whenever app.js or style.css
// change: activate() drops every cache that is not this one, which is what
// evicts the previous build instead of leaving a stale copy to be served.
const CACHE = "sip-shell-v3";
const SHELL = ["./", "index.html", "style.css?v=3", "app.js?v=3", "manifest.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== "sip-state").map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Code (HTML/JS/CSS) is network-first so a redeploy reaches the phone on the next
// load instead of being pinned to a stale cached copy; icons stay cache-first.
// Either way the cache answers when the network is gone.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  const isCode = req.mode === "navigate" || /\.(js|css|json)(\?|$)/.test(req.url);
  if (isCode) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then(c => c || caches.match("index.html")))
    );
  } else {
    e.respondWith(caches.match(req).then(c => c || fetch(req)));
  }
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then(clients => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow("./index.html");
    })
  );
});

// Best-effort: only fires on Chromium browsers that grant Periodic Background
// Sync to an installed PWA. iOS Safari has no equivalent yet — on iOS,
// reminders only fire while Sip is open/foregrounded (see app.js).
self.addEventListener("periodicsync", event => {
  if (event.tag !== "hydration-check") return;
  event.waitUntil(checkAndNotify());
});

async function checkAndNotify() {
  const cache = await caches.open("sip-state");
  const res = await cache.match("/state.json");
  if (!res) return;
  const s = await res.json();
  const hour = new Date().getHours();
  if (hour < s.activeStart || hour >= s.activeEnd) return;
  if (s.todayTotal >= s.goalMl) return;
  const sinceLog = Date.now() - (s.lastLogTs || 0);
  if (sinceLog < 90 * 60 * 1000) return;
  const tier = Math.min(2, Math.floor(sinceLog / (90 * 60 * 1000)) - 1);
  const n = s.name || "cutie";
  const body = [
    n + ", sippy sip time? 🎀",
    "Mochi is getting vewy thirsty... 🥺",
    "Hewwo " + n + "?? Watew?? Pwease?? 😭",
  ][Math.max(0, tier)];
  await self.registration.showNotification("Mochi says 🎀", {
    body,
    icon: "icons/icon-192.png",
    tag: "sip-reminder",
    renotify: true,
  });
}
