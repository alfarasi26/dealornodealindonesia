"use strict";

const cachePrefix = "deal-or-no-deal:" + self.registration.scope + ":";
const cacheName = cachePrefix + "v3";
const gamePage = new URL("./index.html", self.registration.scope).href;
const gameRoot = self.registration.scope;
const assetPaths = [
  "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "./music/mainmenu.mp3", "./music/ladiesintro.mp3", "./music/thinking.mp3",
  "./music/bankerring.mp3", "./music/deal.mp3", "./music/nodeal.mp3"
];
const assets = new Set(assetPaths.map(path => new URL(path, gameRoot).href));
const audioAssets = Array.from(assets).filter(url => url.endsWith(".mp3"));

async function cacheAudio(cache, url) {
  const response = await fetch(url, { cache: "reload" });
  if (response.status !== 200) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) return null;
  const audio = new Response(bytes, {
    headers: { "Content-Type": "audio/mpeg", "Content-Length": String(bytes.byteLength), "Accept-Ranges": "bytes" }
  });
  await cache.put(url, audio.clone());
  return audio;
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const appShell = Array.from(assets).filter(url => !audioAssets.includes(url));
    await cache.addAll(appShell.map(url => new Request(url, { cache: "reload" })));
    await Promise.allSettled(audioAssets.map(url => cacheAudio(cache, url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function audioRange(response, startText, endText) {
  const bytes = await response.arrayBuffer();
  const length = bytes.byteLength;
  const start = startText ? Number(startText) : Math.max(0, length - Number(endText));
  const end = startText && endText ? Math.min(Number(endText), length - 1) : length - 1;
  if (!Number.isSafeInteger(start) || start > end || start >= length) {
    return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + length } });
  }
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": "bytes " + start + "-" + end + "/" + length,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes"
    }
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  url.search = "";
  const key = url.href === gameRoot && request.mode === "navigate" ? gamePage : url.href;
  if (!assets.has(key)) return;
  const range = request.headers.get("Range");
  const bounds = range?.match(/^bytes=([0-9]*)-([0-9]*)$/i);
  if (range && (!bounds || (!bounds[1] && !bounds[2]))) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    let cached = await cache.match(key);
    if (request.mode === "navigate") {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) return fresh;
      } catch {
        // The precached page is available when offline.
      }
      return cached || Response.error();
    }
    if (!cached && audioAssets.includes(key)) {
      try {
        cached = await cacheAudio(cache, key);
      } catch {
        // A temporarily unavailable track can be fetched again later.
      }
    }
    if (!cached) return fetch(request);
    if (bounds) return audioRange(cached, bounds[1], bounds[2]);
    return cached;
  }));
});
