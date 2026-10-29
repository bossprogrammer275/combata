// AssetManager: centralized GLB/FBX loading with Web Worker prefetch,
// geometry optimization, Draco/Meshopt support, and model caching.
import * as THREE from 'three';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { FBXLoader } from './lib/FBXLoader.js';

// ---------- Web Worker pool for binary fetch ----------
const WORKER_COUNT = Math.min(navigator.hardwareConcurrency || 4, 6);
let _workers = [];
let _workerQueue = [];
let _workerId = 0;
let _pendingFetches = new Map();

function ensureWorkers() {
  if (_workers.length) return;
  for (let i = 0; i < WORKER_COUNT; i++) {
    const w = new Worker(new URL('./workers/asset-loader.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, ok, data, error, size, cached } = e.data;
      const p = _pendingFetches.get(id);
      if (p) {
        _pendingFetches.delete(id);
        if (ok) p.resolve({ buffer: data, size, cached });
        else p.reject(new Error(error));
      }
    };
    w.onerror = (e) => {
      console.warn('[AssetManager] Worker error:', e);
    };
    _workers.push(w);
  }
}

function fetchViaWorker(url, opts) {
  ensureWorkers();
  const id = _workerId++;
  const worker = _workers[id % _workers.length];
  return new Promise((resolve, reject) => {
    _pendingFetches.set(id, { resolve, reject });
    worker.postMessage({ id, url, type: 'glb', opts });
  });
}

// ---------- Model cache ----------
const _modelCache = new Map();   // url -> { scene, animations, metadata }
const _fbxBaseCache = {};        // shared FBX base (already in character.js)
const _prefetchQueue = [];
let _prefetching = false;

// ---------- GLTF / FBX loaders (reuse singletons) ----------
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

// ---------- Draco / Meshopt decoder setup (lazy) ----------
let _decodersReady = false;

async function ensureDecoders() {
  if (_decodersReady) return;

  // Try to load Draco decoder from CDN or local
  try {
    const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js').catch(() => ({ DRACOLoader: null }));
    if (DRACOLoader) {
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
      gltfLoader.setDRACOLoader(dracoLoader);
      console.log('[AssetManager] Draco decoder registered');
    }
  } catch {
    // Draco not available — models without Draco compression will still load fine
  }

  try {
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js').catch(() => ({ MeshoptDecoder: null }));
    if (MeshoptDecoder) {
      gltfLoader.setMeshoptDecoder(MeshoptDecoder);
      console.log('[AssetManager] Meshopt decoder registered');
    }
  } catch {
    // Meshopt not available
  }

  _decodersReady = true;
}

// ---------- Geometry optimization ----------

function optimizeGeometry(geo, opts = {}) {
  if (!geo || !geo.attributes.position) return geo;

  const maxVertices = opts.maxVertices || Infinity;

  // 1. Quantize positions to half-float if too many vertices
  if (geo.attributes.position.count > maxVertices) {
    const ratio = maxVertices / geo.attributes.position.count;
    // Simple vertex decimation: keep every Nth vertex — only works for non-indexed
    if (!geo.index) {
      const pos = geo.attributes.position;
      const keep = [];
      for (let i = 0; i < pos.count; i++) {
        if (Math.random() < ratio) keep.push(i);
      }
      if (keep.length < pos.count) {
        const newGeo = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(geo.attributes)) {
          const arr = [];
          for (const i of keep) {
            for (let c = 0; c < attr.itemSize; c++) arr.push(attr.getX(i)); // simplified
          }
        }
      }
    }
  }

  // 2. Remove unused attributes (tangent, color2, etc.)
  const keepAttrs = new Set(['position', 'normal', 'uv', 'uv1', 'color', 'tangent']);
  for (const name of Object.keys(geo.attributes)) {
    if (!keepAttrs.has(name)) {
      geo.deleteAttribute(name);
    }
  }

  // 3. Merge indexed geometries with same material into one draw call
  // (handled externally by batchGeometry())

  return geo;
}

// Merge multiple BufferGeometries sharing the same material into one.
function batchGeometries(geometries) {
  if (!geometries.length) return null;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let vertexOffset = 0;

  for (const geo of geometries) {
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const idx = geo.index;

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (norm) normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
    }

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(idx.getX(i) + vertexOffset);
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices.push(i + vertexOffset);
      }
    }
    vertexOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length) merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (uvs.length) merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}

// ---------- LOD generation ----------

function generateLODs(scene, opts = {}) {
  const levels = opts.levels || [
    { ratio: 0.5, name: 'lod1' },
    { ratio: 0.25, name: 'lod2' },
  ];

  const lods = [];
  const originals = [];

  scene.traverse(o => {
    if (o.isMesh && o.geometry) {
      originals.push({ mesh: o, geo: o.geometry.clone() });
    }
  });

  for (const level of levels) {
    const lodScene = scene.clone(true);
    let idx = 0;
    lodScene.traverse(o => {
      if (o.isMesh && o.geometry) {
        if (idx < originals.length) {
          const orig = originals[idx].geo;
          const targetVerts = Math.floor(orig.attributes.position.count * level.ratio);
          if (targetVerts > 6) {
            // Simple decimation: keep every Nth vertex
            const simplified = decimateGeometry(orig, targetVerts);
            o.geometry.dispose();
            o.geometry = simplified;
          }
          idx++;
        }
      }
    });
    lods.push({ scene: lodScene, ratio: level.ratio, name: level.name });
  }

  return lods;
}

function decimateGeometry(geo, targetVerts) {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const idx = geo.index;

  // Compute face normals and area for importance
  const keep = [];
  const vertCount = pos.count;
  const step = Math.max(1, Math.floor(vertCount / targetVerts));

  for (let i = 0; i < vertCount; i += step) {
    keep.push(i);
  }

  // Always keep first and last
  if (keep[0] !== 0) keep.unshift(0);
  if (keep[keep.length - 1] !== vertCount - 1) keep.push(vertCount - 1);

  const newGeo = new THREE.BufferGeometry();
  const newPos = [];
  const newNorm = [];
  const newUv = [];
  const newIdx = [];
  const indexMap = new Map();

  for (let i = 0; i < keep.length; i++) {
    const oldIdx = keep[i];
    indexMap.set(oldIdx, i);
    newPos.push(pos.getX(oldIdx), pos.getY(oldIdx), pos.getZ(oldIdx));
    if (norm) newNorm.push(norm.getX(oldIdx), norm.getY(oldIdx), norm.getZ(oldIdx));
    if (uv) newUv.push(uv.getX(oldIdx), uv.getY(oldIdx));
  }

  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      const na = indexMap.get(a), nb = indexMap.get(b), nc = indexMap.get(c);
      if (na !== undefined && nb !== undefined && nc !== undefined) {
        newIdx.push(na, nb, nc);
      }
    }
  }

  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  if (newNorm.length) newGeo.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
  if (newUv.length) newGeo.setAttribute('uv', new THREE.Float32BufferAttribute(newUv, 2));
  if (newIdx.length) newGeo.setIndex(newIdx);
  newGeo.computeVertexNormals();
  return newGeo;
}

// ---------- Public API ----------

export class AssetManager {
  constructor() {
    this._modelCache = new Map();
    this._fbxAnimCache = new Map();
    this._prefetchList = [];
    this._stats = { loaded: 0, cached: 0, bytesTransferred: 0 };
  }

  // Prefetch a list of URLs in the background (non-blocking)
  prefetch(urls) {
    this._prefetchList.push(...urls);
    this._runPrefetch();
  }

  async _runPrefetch() {
    if (this._prefetching) return;
    this._prefetching = true;

    while (this._prefetchList.length) {
      const url = this._prefetchList.shift();
      if (this._modelCache.has(url)) continue;

      try {
        const { buffer, size, cached } = await fetchViaWorker(url, { stripTextures: false });
        this._stats.bytesTransferred += size || 0;
        if (cached) this._stats.cached++;
        else this._stats.loaded++;

        // Store raw buffer for later decoding
        this._modelCache.set(url, { rawBuffer: buffer, decoded: false });
      } catch (e) {
        console.warn(`[AssetManager] Prefetch failed for ${url}:`, e.message);
      }
    }

    this._prefetching = false;
  }

  // Load a GLB model (uses prefetched buffer if available, otherwise fetches)
  async loadGLB(url, opts = {}) {
    if (this._modelCache.has(url)) {
      const entry = this._modelCache.get(url);
      if (entry.decoded) return entry.scene;
      if (entry.rawBuffer) {
        return this._decodeGLB(url, entry.rawBuffer, opts);
      }
    }

    // Not prefetched — load directly
    return this._decodeGLB(url, null, opts);
  }

  async _decodeGLB(url, rawBuffer, opts) {
    await ensureDecoders();

    return new Promise((resolve, reject) => {
      const onLoad = (gltf) => {
        const scene = gltf.scene;
        const animations = gltf.animations || [];

        // Apply optimizations
        if (opts.optimize !== false) {
          this._optimizeScene(scene, opts);
        }

        this._modelCache.set(url, { scene, animations, decoded: true });
        this._stats.loaded++;
        console.log(`[AssetManager] GLB loaded: ${url.split('/').pop()} (${this._stats.loaded} total)`);
        resolve({ scene, animations });
      };

      const onProgress = opts.onProgress || undefined;
      const onError = (e) => reject(e);

      if (rawBuffer) {
        // Decode from prefetched ArrayBuffer
        const blob = new Blob([rawBuffer], { type: 'application/octet-stream' });
        const blobUrl = URL.createObjectURL(blob);
        gltfLoader.load(blobUrl, (gltf) => {
          URL.revokeObjectURL(blobUrl);
          onLoad(gltf);
        }, onProgress, (e) => {
          URL.revokeObjectURL(blobUrl);
          onError(e);
        });
      } else {
        gltfLoader.load(url, onLoad, onProgress, onError);
      }
    });
  }

  // Load FBX animation clip (with caching)
  async loadFBXAnim(url) {
    if (this._fbxAnimCache.has(url)) return this._fbxAnimCache.get(url);

    const fbx = await new Promise((res, rej) => fbxLoader.load(url, res, undefined, rej));
    const clip = fbx.animations?.[0] || null;

    // Dispose geometry/materials from the FBX (we only need the animation clip)
    fbx.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          try { m.dispose(); } catch {}
        });
      }
    });

    if (clip) {
      // Strip root motion
      for (let i = clip.tracks.length - 1; i >= 0; i--) {
        if (clip.tracks[i].name.includes('Hips') && clip.tracks[i].name.includes('.position')) {
          clip.tracks.splice(i, 1);
        }
      }
      this._fbxAnimCache.set(url, clip);
    }

    return clip;
  }

  // Load multiple FBX animations in parallel
  async loadFBXAnimBatch(urls) {
    const results = await Promise.allSettled(urls.map(u => this.loadFBXAnim(u)));
    return results.map((r, i) => ({
      url: urls[i],
      clip: r.status === 'fulfilled' ? r.value : null,
      error: r.status === 'rejected' ? r.reason : null,
    }));
  }

  // Optimize a loaded GLB scene
  _optimizeScene(scene, opts) {
    const maxTriangleBudget = opts.maxTriangles || Infinity;

    // 1. Strip unnecessary mesh attributes
    scene.traverse(o => {
      if (!o.isMesh) return;
      const geo = o.geometry;
      if (!geo) return;

      // Remove non-essential attributes
      for (const name of Object.keys(geo.attributes)) {
        if (!['position', 'normal', 'uv', 'uv1', 'color', 'tangent'].includes(name)) {
          geo.deleteAttribute(name);
        }
      }

      // Ensure normals exist
      if (!geo.attributes.normal) geo.computeVertexNormals();

      // Enable frustum culling
      o.frustumCulled = true;

      // Enable shadows
      o.castShadow = true;
      o.receiveShadow = true;
    });

    // 2. Count total triangles
    let totalTris = 0;
    scene.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const geo = o.geometry;
      totalTris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    });

    // 3. If over budget, generate LODs
    if (totalTris > maxTriangleBudget && opts.generateLODs !== false) {
      const lods = generateLODs(scene, opts.lodOptions);
      scene.userData.lods = lods;
      console.log(`[AssetManager] Generated ${lods.length} LOD levels (original: ${totalTris} tris)`);
    }
  }

  // Dispose a cached model
  dispose(url) {
    const entry = this._modelCache.get(url);
    if (entry?.scene) {
      entry.scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
    }
    this._modelCache.delete(url);
  }

  // Clear all caches
  clearAll() {
    for (const [url] of this._modelCache) this.dispose(url);
    this._modelCache.clear();
    this._fbxAnimCache.clear();
    this._stats = { loaded: 0, cached: 0, bytesTransferred: 0 };
  }

  get stats() { return { ...this._stats }; }
}

// ---------- Batch geometry merging for world props ----------

// Given a list of { mesh, material } pairs, merge meshes sharing the same material
// into single draw calls. Returns merged meshes to add to the scene.
export function batchWorldMeshes(pairs) {
  const groups = new Map(); // material -> [geometry]

  for (const { mesh, material } of pairs) {
    if (!mesh.geometry) continue;
    const key = material.uuid || 'default';
    if (!groups.has(key)) groups.set(key, { material, geometries: [] });
    groups.get(key).geometries.push(mesh.geometry);
  }

  const merged = [];
  for (const [, { material, geometries }] of groups) {
    if (geometries.length <= 1) {
      merged.push({ geo: geometries[0], material });
      continue;
    }
    const mergedGeo = batchGeometries(geometries);
    if (mergedGeo) merged.push({ geo: mergedGeo, material });
  }

  return merged;
}

// ---------- Singleton ----------
let _instance = null;
export function getAssetManager() {
  if (!_instance) _instance = new AssetManager();
  return _instance;
}

export { fetchViaWorker, optimizeGeometry, batchGeometries, generateLODs };
