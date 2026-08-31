import { GLTFLoader } from './lib/GLTFLoader.js';

const REGISTRY_BASE = './data/models';
const _cache = new Map();
const _materialCache = new Map();
let _registry = null;
let _loading = false;

const loader = new GLTFLoader();

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

export async function loadModel(url, opts = {}) {
  if (_cache.has(url)) return _cache.get(url);

  const gltf = await new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });

  const scene = gltf.scene;
  const cloned = scene.clone();

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
}

export function getModelUrl(asset) {
  return asset?.model_file_url || null;
}

export function getThumbnailUrl(asset) {
  return asset?.thumbnail_url || null;
}
