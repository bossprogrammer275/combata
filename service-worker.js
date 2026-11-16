// Persistent vehicle asset cache. GLTF/GLB source files and their referenced
// buffers/textures are cached across launches; normal page fetches are cache-first.
const VEHICLE_CACHE = 'open-world-vehicle-assets-v1';
const VEHICLE_PATH = '/data/models/cars/';
const pendingAssetFetches = new Map();

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('open-world-vehicle-assets-') && name !== VEHICLE_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isVehicleAsset(url) {
  return url.origin === self.location.origin && url.pathname.includes(VEHICLE_PATH);
}

async function fetchAndCache(url) {
  const cache = await caches.open(VEHICLE_CACHE);
  const request = new Request(url.href, { method: 'GET', credentials: 'same-origin' });
  const cached = await cache.match(request);
  if (cached) return cached;

  // Share one request between background preloading and GLTFLoader fetches.
  const key = request.url;
  let pending = pendingAssetFetches.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(request);
      if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url.pathname);
      try { await cache.put(request, response.clone()); } catch { /* quota/private mode */ }
      return response;
    })();
    pendingAssetFetches.set(key, pending);
    pending.finally(() => {
      if (pendingAssetFetches.get(key) === pending) pendingAssetFetches.delete(key);
    }).catch(() => {});
  }
  return (await pending).clone();
}

async function runLimited(items, limit, task) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await task(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function cacheModelAndDependencies(modelUrl) {
  const url = new URL(modelUrl, self.registration.scope);
  if (!isVehicleAsset(url)) throw new Error('Refusing non-vehicle asset: ' + url.href);
  const response = await fetchAndCache(url);
  if (!/\.gltf$/i.test(url.pathname)) return 1;

  const document = await response.clone().json();
  const references = [
    ...(document.buffers || []).map(item => item.uri),
    ...(document.images || []).map(item => item.uri),
  ].filter(uri => typeof uri === 'string' && uri && !/^data:/i.test(uri));

  const dependencies = [...new Set(references.map(uri => new URL(uri, url.href).href))]
    .map(value => new URL(value))
    .filter(dependency => dependency.origin === self.location.origin);

  let completed = 1;
  await runLimited(dependencies, 2, async dependency => {
    await fetchAndCache(dependency);
    completed++;
  });
  return completed;
}

self.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type !== 'PREFETCH_VEHICLE_ASSETS' || !Array.isArray(message.urls)) return;

  const source = event.source;
  event.waitUntil((async () => {
    const urls = [...new Set(message.urls.filter(value => typeof value === 'string'))];
    let finished = 0;
    let cachedFiles = 0;
    const errors = [];
    await runLimited(urls, 2, async url => {
      try {
        cachedFiles += await cacheModelAndDependencies(url);
      } catch (error) {
        errors.push({ url, message: String(error?.message || error) });
      }
      finished++;
      source?.postMessage({
        type: 'VEHICLE_ASSET_CACHE_PROGRESS',
        finished,
        total: urls.length,
        cachedFiles,
      });
    });
    source?.postMessage({
      type: 'VEHICLE_ASSET_CACHE_COMPLETE',
      total: urls.length,
      cachedFiles,
      errors,
    });
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isVehicleAsset(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(VEHICLE_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
