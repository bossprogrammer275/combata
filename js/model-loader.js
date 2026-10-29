// model-loader.js — central GLB/FBX loading with Web Worker prefetch,
// Draco/Meshopt decoding, geometry optimization, and aggressive caching.
import * as THREE from 'three';
import { GLTFLoader } from './lib/GLTFLoader.js';

const REGISTRY_BASE = './data/models';
const _cache = new Map();
const _rawBufferCache = new Map();  // url -> ArrayBuffer (prefetched)
let _registry = null;
let _loading = false;

// ---- GLTFLoader with Draco + Meshopt decoder registration ----
const loader = new GLTFLoader();
let _decodersReady = false;

async function ensureDecoders() {
  if (_decodersReady) return;
  _decodersReady = true;

  try {
    const mod = await import('three/addons/loaders/DRACOLoader.js');
    if (mod.DRACOLoader) {
      const draco = new mod.DRACOLoader();
      draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
      loader.setDRACOLoader(draco);
      console.log('[Loader] Draco decoder registered');
    }
  } catch { /* Draco not available */ }

  try {
    const mod = await import('three/addons/libs/meshopt_decoder.module.js');
    if (mod.MeshoptDecoder) {
      loader.setMeshoptDecoder(mod.MeshoptDecoder);
      console.log('[Loader] Meshopt decoder registered');
    }
  } catch { /* Meshopt not available */ }
}

// ---- Web Worker pool for binary prefetch ----
const HAS_BROWSER_WORKERS = typeof Worker !== 'undefined'
  && typeof navigator !== 'undefined'
  && typeof window !== 'undefined';
const WORKER_COUNT = HAS_BROWSER_WORKERS
  ? Math.min(navigator.hardwareConcurrency || 4, 6)
  : 0;
let _workers = [];
let _workerId = 0;
let _pendingFetches = new Map();
let _workersInited = false;

function initWorkers() {
  if (_workersInited) return;
  _workersInited = true;
  if (!HAS_BROWSER_WORKERS) return;
  for (let i = 0; i < WORKER_COUNT; i++) {
    const w = new Worker(new URL('./workers/asset-loader.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, ok, data, error, size } = e.data;
      const p = _pendingFetches.get(id);
      if (p) {
        _pendingFetches.delete(id);
        if (ok) p.resolve({ buffer: data, size });
        else p.reject(new Error(error));
      }
    };
    _workers.push(w);
  }
}

function fetchViaWorker(url, opts) {
  initWorkers();
  const id = _workerId++;
  const w = _workers[id % _workers.length];
  return new Promise((resolve, reject) => {
    _pendingFetches.set(id, { resolve, reject });
    w.postMessage({ id, url, type: 'glb', opts });
  });
}

// ---- Prefetch: fetch binary data off main thread in background ----
export function prefetch(urls) {
  if (!HAS_BROWSER_WORKERS) return; // Node/tests: loading happens on demand
  initWorkers();
  for (const url of urls) {
    if (_rawBufferCache.has(url) || _cache.has(url)) continue;
    fetchViaWorker(url, {}).then(({ buffer, size }) => {
      _rawBufferCache.set(url, buffer);
      console.log(`[Loader] Prefetched ${url.split('/').pop()} (${(size / 1024).toFixed(0)}KB)`);
    }).catch(() => {});
  }
}

// ---- Registry ----
export async function loadRegistry() {
  if (_registry) return _registry;
  if (_loading) {
    while (_loading) await new Promise(r => setTimeout(r, 50));
    return _registry;
  }
  _loading = true;
  try {
    const resp = await fetch(`${REGISTRY_BASE}/projects.json`);
    const projects = await resp.json();
    const collections = [];
    for (const p of projects) {
      let assets = [];
      try {
        const aResp = await fetch(`${REGISTRY_BASE}/${p.asset_data_file}`);
        assets = await aResp.json();
      } catch (e) { console.warn(`Failed to load assets for ${p.id}:`, e); }
      collections.push({ ...p, assets });
    }
    _registry = collections;
    return _registry;
  } finally {
    _loading = false;
  }
}

export function getRegistry() { return _registry; }

export function getCollections() {
  return _registry ? _registry.map(c => ({
    id: c.id, name: c.name, description: c.description,
    license: c.license, assetCount: c.assets.length
  })) : [];
}

export function getAssets(collectionId) {
  if (!_registry) return [];
  const col = _registry.find(c => c.id === collectionId);
  return col ? col.assets : [];
}

export function searchAssets(query) {
  if (!_registry) return [];
  const q = query.toLowerCase();
  const results = [];
  for (const col of _registry) {
    for (const a of col.assets) {
      const name = (a.name || '').toLowerCase();
      const type = (a.type || '').toLowerCase();
      const category = (a.category || '').toLowerCase();
      if (name.includes(q) || type.includes(q) || category.includes(q)) {
        results.push({ ...a, collectionId: col.id, collectionName: col.name });
      }
    }
  }
  return results;
}

export function getCategories() {
  if (!_registry) return [];
  const cats = new Set();
  for (const col of _registry) {
    for (const a of col.assets) {
      if (a.metadata?.attributes?.Category) cats.add(a.metadata.attributes.Category);
      if (a.metadata?.attributes?.Type) cats.add(a.metadata.attributes.Type);
    }
  }
  return [...cats].sort();
}

// ---- Core model loading with optimization ----
export async function loadModel(url, opts = {}) {
  if (_cache.has(url)) return _cache.get(url);

  await ensureDecoders();

  // Use prefetched buffer if available (avoids extra network request)
  const rawBuffer = _rawBufferCache.get(url);
  let result;

  if (rawBuffer) {
    _rawBufferCache.delete(url); // free memory
    result = await _decodeFromBuffer(rawBuffer, url);
  } else {
    result = await _decodeFromUrl(url);
  }

  const scene = result.scene;
  const cloned = scene.clone();

  // Apply geometry optimizations
  _optimizeGeometry(cloned, opts);

  if (opts.tint) {
    cloned.traverse(child => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.color.multiplyScalar(opts.tint);
      }
    });
  }

  if (opts.scale) {
    cloned.scale.setScalar(opts.scale);
  }

  _cache.set(url, cloned);
  return cloned;
}

function _decodeFromBuffer(buffer, url) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);
    loader.load(blobUrl, (gltf) => {
      URL.revokeObjectURL(blobUrl);
      resolve(gltf);
    }, undefined, (e) => {
      URL.revokeObjectURL(blobUrl);
      reject(e);
    });
  });
}

function _decodeFromUrl(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

// Strip unnecessary geometry attributes, ensure normals, flag frustum culling
function _optimizeGeometry(scene, opts) {
  scene.traverse(child => {
    if (!child.isMesh) return;
    const geo = child.geometry;
    if (!geo) return;

    // Remove non-essential attributes (tangent2, color2, etc.)
    const essential = new Set(['position', 'normal', 'uv', 'uv1', 'color', 'tangent']);
    for (const name of Object.keys(geo.attributes)) {
      if (!essential.has(name)) geo.deleteAttribute(name);
    }

    // Ensure normals
    if (!geo.attributes.normal) geo.computeVertexNormals();

    // Frustum culling + shadows
    child.frustumCulled = true;
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

// ---- Dispose ----
export function disposeModel(url) {
  const m = _cache.get(url);
  if (m) {
    m.traverse(child => {
      if (child.isMesh) {
        child.geometry?.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of mats) {
            if (mat.map) mat.map.dispose();
            mat.dispose();
          }
        }
      }
    });
    _cache.delete(url);
  }
}

export function clearCache() {
  for (const [url] of _cache) disposeModel(url);
  _cache.clear();
  _rawBufferCache.clear();
}

export function getModelUrl(asset) {
  return asset?.model_file_url || null;
}

export function getThumbnailUrl(asset) {
  return asset?.thumbnail_url || null;
}

// Expose stats for debugging
export function getLoaderStats() {
  return {
    cachedModels: _cache.size,
    prefetchedBuffers: _rawBufferCache.size,
    workers: _workers.length,
    decodersReady: _decodersReady,
  };
}
