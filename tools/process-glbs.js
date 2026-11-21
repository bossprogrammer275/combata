#!/usr/bin/env node
/**
 * process-glbs.js — Generate collision manifests for GLB models.
 *
 * Usage: node tools/process-glbs.js <file.glb> [...]
 *
 * For each GLB, generates a <name>_col.json file containing box collision
 * data. The game loader reads this alongside the GLB — no GLB modification needed.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Collision cell dimensions/thickness are derived from each source model's height
// so they remain sensible after the game's targetH normalization.

// ─── Browser API shims for Node.js GLTFLoader ───
// Some Sketchfab GLBs embed image textures. Collision preprocessing only needs
// geometry, but GLTFLoader still runs its image callbacks while parsing them.
class FileReaderPolyfill {
  constructor() {
    this.result = null;
    this.onload = null;
    this.onerror = null;
  }
  _arrayBuffer(blob) {
    if (blob instanceof ArrayBuffer) return Promise.resolve(blob);
    if (ArrayBuffer.isView(blob)) {
      return Promise.resolve(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
    }
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    if (blob && blob.buffer instanceof ArrayBuffer) return Promise.resolve(blob.buffer);
    return Promise.reject(new Error('FileReader received an unsupported buffer type'));
  }
  readAsArrayBuffer(blob) {
    this._arrayBuffer(blob).then((buffer) => {
      this.result = buffer;
      this.onload?.({ target: this });
    }).catch((error) => this.onerror?.({ target: this, error }));
  }
  readAsDataURL(blob) {
    this._arrayBuffer(blob).then((buffer) => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(buffer).toString('base64');
      this.onload?.({ target: this });
    }).catch((error) => this.onerror?.({ target: this, error }));
  }
}
if (typeof globalThis.FileReader === 'undefined') globalThis.FileReader = FileReaderPolyfill;
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  };
}
if (typeof globalThis.document === 'undefined') {
  class FakeImage {
    constructor() {
      this._listeners = new Map();
      this.width = 1;
      this.height = 1;
      this.complete = false;
      this.crossOrigin = undefined;
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
      const listeners = this._listeners.get(type) || [];
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    }
    set src(value) {
      this._src = value;
      // No pixel decoding is needed to extract collision geometry.
      queueMicrotask(() => {
        this.complete = true;
        for (const fn of this._listeners.get('load') || []) fn.call(this);
      });
    }
    get src() { return this._src; }
  }
  globalThis.document = {
    createElementNS: () => new FakeImage(),
    createElement: () => new FakeImage(),
  };
}

function nodeKey(root, node) {
  const parts = [];
  let current = node;
  while (current && current !== root) {
    const parent = current.parent;
    const index = parent ? parent.children.indexOf(current) : 0;
    parts.unshift(`${current.name || current.type || 'node'}[${index}]`);
    current = parent;
  }
  return parts.join('/');
}

function nodePath(root, node) {
  const parts = [];
  for (let current = node; current && current !== root; current = current.parent) {
    if (current.name) parts.unshift(current.name);
  }
  return parts.join(' / ');
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.ktx2': 'image/ktx2',
    '.bin': 'application/octet-stream',
  })[ext] || 'application/octet-stream';
}

async function inlineGltfResources(json, filePath) {
  const baseDir = path.dirname(path.resolve(filePath));
  const inlineUri = async (uri, fallbackMime) => {
    if (!uri || /^data:/i.test(uri)) return uri;
    if (/^(https?:|blob:|\/\/)/i.test(uri)) {
      throw new Error(`External network resource is not supported by offline calibration: ${uri}`);
    }
    const decoded = decodeURIComponent(uri.split(/[?#]/, 1)[0]);
    const absolute = path.resolve(baseDir, decoded);
    const bytes = fs.readFileSync(absolute);
    return `data:${fallbackMime || mimeType(absolute)};base64,${bytes.toString('base64')}`;
  };

  for (const buffer of json.buffers || []) {
    if (buffer.uri) buffer.uri = await inlineUri(buffer.uri, 'application/octet-stream');
  }
  for (const image of json.images || []) {
    if (image.uri) image.uri = await inlineUri(image.uri, image.mimeType || null);
  }
  return json;
}

async function loadGLB(filePath) {
  const loader = new GLTFLoader();
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.gltf') {
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const hydrated = await inlineGltfResources(json, filePath);
    return new Promise((resolve, reject) => {
      loader.parse(JSON.stringify(hydrated), '', resolve, reject);
    });
  }
  const data = fs.readFileSync(filePath);
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return new Promise((resolve, reject) => loader.parse(buf, '', resolve, reject));
}

// ─── Surface subdivision ───

// Test triangle coverage in XZ with the separating-axis theorem. A raw triangle
// bounding box covers large empty regions around diagonal walls and door frames,
// which were then converted into invisible solid collision cells.
function triangleIntersectsRectXZ(a, b, c, minX, maxX, minZ, maxZ) {
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const hx = (maxX - minX) / 2, hz = (maxZ - minZ) / 2;
  const tri = [
    [a.x - cx, a.z - cz],
    [b.x - cx, b.z - cz],
    [c.x - cx, c.z - cz],
  ];
  const axes = [[1, 0], [0, 1]];
  for (let i = 0; i < 3; i++) {
    const p = tri[i], q = tri[(i + 1) % 3];
    const ex = q[0] - p[0], ez = q[1] - p[1];
    axes.push([-ez, ex]);
  }
  for (const [ax, az] of axes) {
    const axisLengthSq = ax * ax + az * az;
    if (axisLengthSq < 1e-12) continue;
    const p0 = tri[0][0] * ax + tri[0][1] * az;
    const p1 = tri[1][0] * ax + tri[1][1] * az;
    const p2 = tri[2][0] * ax + tri[2][1] * az;
    const triMin = Math.min(p0, p1, p2), triMax = Math.max(p0, p1, p2);
    const rectRadius = hx * Math.abs(ax) + hz * Math.abs(az);
    if (triMin > rectRadius || triMax < -rectRadius) return false;
  }
  return true;
}

function subdivideMeshCollision(mesh, cellSize, verticalQuantum, thickness, minCellHeight, mergeGap) {
  const geo = mesh.geometry;
  if (!geo || !geo.attributes.position) return [];

  const posAttr = geo.attributes.position;
  const idx = geo.index;
  const wm = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const worldVerts = [];
  for (let i = 0; i < posAttr.count; i++) {
    v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    v.applyMatrix4(wm);
    worldVerts.push(v.clone());
  }

  const tris = [];
  if (idx) {
    for (let i = 0; i + 2 < idx.count; i += 3) {
      tris.push([idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)]);
    }
  } else {
    for (let i = 0; i + 2 < posAttr.count; i += 3) tris.push([i, i + 1, i + 2]);
  }

  let rawMinX = Infinity, rawMaxX = -Infinity, rawMinZ = Infinity, rawMaxZ = -Infinity;
  for (const point of worldVerts) {
    rawMinX = Math.min(rawMinX, point.x); rawMaxX = Math.max(rawMaxX, point.x);
    rawMinZ = Math.min(rawMinZ, point.z); rawMaxZ = Math.max(rawMaxZ, point.z);
  }
  if (![rawMinX, rawMaxX, rawMinZ, rawMaxZ].every(Number.isFinite)) return [];

  // Keep the nominal 2%-of-height resolution for ordinary meshes. Very long,
  // thin assets (speed bumps, rails, kerbs) can otherwise exceed the 50k cell
  // safety cap solely because their XZ aspect ratio is extreme. Coarsen only
  // that mesh's grid enough to stay below the cap; triangle coverage still
  // determines occupied cells, so this never falls back to a broad AABB.
  const maxGridCells = 50000;
  let gridCellSize = cellSize;
  const makeGrid = value => {
    const padding = value * 0.1;
    const minX = rawMinX - padding, maxX = rawMaxX + padding;
    const minZ = rawMinZ - padding, maxZ = rawMaxZ + padding;
    return {
      minX, maxX, minZ, maxZ,
      cols: Math.ceil((maxX - minX) / value),
      rows: Math.ceil((maxZ - minZ) / value),
    };
  };
  let grid = makeGrid(gridCellSize);
  if (grid.cols * grid.rows > maxGridCells) {
    const footprint = Math.max(0, rawMaxX - rawMinX) * Math.max(0, rawMaxZ - rawMinZ);
    gridCellSize = Math.max(gridCellSize, Math.sqrt(footprint / (maxGridCells * 0.8)));
    grid = makeGrid(gridCellSize);
    for (let attempt = 0; grid.cols * grid.rows > maxGridCells && attempt < 12; attempt++) {
      gridCellSize *= 1.12;
      grid = makeGrid(gridCellSize);
    }
  }
  if (grid.cols <= 0 || grid.rows <= 0 || grid.cols * grid.rows > maxGridCells) return [];
  const { minX, maxX, minZ, maxZ, cols, rows } = grid;

  // Triangle-first accumulation. The old implementation scanned every triangle
  // for every cell (O(cells * triangles)), freezing on detailed building meshes.
  // This visits only cells overlapped by each triangle's XZ bounds.
  const cells = new Map();
  for (const tri of tris) {
    const a = worldVerts[tri[0]], b = worldVerts[tri[1]], c = worldVerts[tri[2]];
    if (!a || !b || !c) continue;
    const txMin = Math.min(a.x, b.x, c.x);
    const txMax = Math.max(a.x, b.x, c.x);
    const tzMin = Math.min(a.z, b.z, c.z);
    const tzMax = Math.max(a.z, b.z, c.z);
    const c0 = Math.max(0, Math.min(cols - 1, Math.floor((txMin - minX) / gridCellSize)));
    const c1 = Math.max(0, Math.min(cols - 1, Math.floor((txMax - minX) / gridCellSize)));
    const r0 = Math.max(0, Math.min(rows - 1, Math.floor((tzMin - minZ) / gridCellSize)));
    const r1 = Math.max(0, Math.min(rows - 1, Math.floor((tzMax - minZ) / gridCellSize)));
    const yMin = Math.min(a.y, b.y, c.y);
    const yMax = Math.max(a.y, b.y, c.y);

    for (let ci = c0; ci <= c1; ci++) {
      const cellMinX = minX + ci * gridCellSize;
      const cellMaxX = cellMinX + cellSize;
      for (let ri = r0; ri <= r1; ri++) {
        const cellMinZ = minZ + ri * gridCellSize;
        const cellMaxZ = cellMinZ + gridCellSize;
        if (!triangleIntersectsRectXZ(a, b, c, cellMinX, cellMaxX, cellMinZ, cellMaxZ)) continue;
        const key = ci * rows + ri;
        let cell = cells.get(key);
        if (!cell) {
          cell = { ci, ri, intervals: [] };
          cells.set(key, cell);
        }
        cell.intervals.push([yMin, yMax]);
      }
    }
  }

  // Merge only touching vertical intervals. Keeping gaps between these
  // intervals prevents floor decks at different heights from filling the whole
  // building interior with an invisible solid column.
  const layers = new Map();
  for (const cell of cells.values()) {
    const sorted = cell.intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of sorted) {
      const last = merged[merged.length - 1];
      if (last && interval[0] <= last[1] + mergeGap) {
        last[1] = Math.max(last[1], interval[1]);
      } else {
        merged.push(interval.slice());
      }
    }
    for (const [yMin, yMax] of merged) {
      const key = Math.round(yMin / verticalQuantum) + ':' + Math.round(yMax / verticalQuantum);
      let layer = layers.get(key);
      if (!layer) {
        layer = { yMin, yMax, cells: new Set() };
        layers.set(key, layer);
      } else {
        layer.yMin = Math.min(layer.yMin, yMin);
        layer.yMax = Math.max(layer.yMax, yMax);
      }
      layer.cells.add(cell.ci + ',' + cell.ri);
    }
  }

  // Merge horizontally adjacent cells with the same vertical interval into
  // larger rectangles. This reduces several thousand floor/wall cells to a
  // manageable number of collision cuboids without filling holes in the mesh.
  const boxes = [];
  for (const layer of layers.values()) {
    const remaining = new Set(layer.cells);
    while (remaining.size) {
      const first = remaining.values().next().value;
      const [ci, ri] = first.split(',').map(Number);
      let spanX = 1;
      while (remaining.has((ci + spanX) + ',' + ri)) spanX++;
      let spanZ = 1;
      while (true) {
        const nextZ = ri + spanZ;
        let fullRow = true;
        for (let x = ci; x < ci + spanX; x++) {
          if (!remaining.has(x + ',' + nextZ)) { fullRow = false; break; }
        }
        if (!fullRow) break;
        spanZ++;
      }
      for (let x = ci; x < ci + spanX; x++) {
        for (let z = ri; z < ri + spanZ; z++) remaining.delete(x + ',' + z);
      }

      const w = spanX * gridCellSize, d = spanZ * gridCellSize;
      const x = minX + ci * gridCellSize + w / 2;
      const z = minZ + ri * gridCellSize + d / 2;
      const h = Math.max(0, layer.yMax - layer.yMin) + thickness;
      if (h < minCellHeight) continue;
      const cy = layer.yMin + h / 2 - thickness / 6;
      boxes.push([x, cy, z, w, h, d]);
    }
  }
  boxes.effectiveCellSize = gridCellSize;
  return boxes;
}

function meshNeedsSubdivision(mesh) {
  const geo = mesh.geometry;
  if (!geo || !geo.attributes.position) return false;
  const vertices = geo.attributes.position.count;
  const triangles = Math.floor((geo.index?.count ?? vertices) / 3);
  // Multi-face meshes are rasterised from real triangles. Their enclosing
  // AABBs can fill gaps in hollow doors, windows, frames and diagonal walls.
  if (vertices > 50 || triangles > 8) return true;
  mesh.updateWorldMatrix(true, false);
  geo.computeBoundingBox();
  const bounds = geo.boundingBox;
  if (!bounds) return false;
  const size = new THREE.Vector3().subVectors(bounds.max, bounds.min);
  const sorted = [size.x, size.y, size.z].sort((a, b) => a - b);
  return size.x * size.y * size.z > 8 || sorted[2] / (sorted[0] + 0.01) > 4;
}
function semanticTokens(value) {
  return String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function isDecorativeNodeName(value) {
  return semanticTokens(value).some(token =>
    /^(?:leaf|leaves|foliage|grass|shrub|bush|hedge|flower|flowers|weed|fern|petal|frond|plant)$/.test(token));
}
function isDoorOrGlassNodeName(value) {
  return semanticTokens(value).some(token =>
    /^(?:door|doors|doorpanel|hatch|tailgate|trunk|boot|window|windows|glazing|glass|glasspane|windshield|windscreen)$/.test(token));
}
function shouldSkip(object) {
  // Semantic exclusions may live on a parent collection, not the mesh.
  // Doors/glass move or remain transparent; decorative foliage is visual-only.
  let current = object;
  while (current) {
    const name = current.name || '';
    const lower = name.toLowerCase();
    if (
      lower.startsWith('col_') || lower.startsWith('trim_') || lower.startsWith('window_') ||
      lower.startsWith('roof_detail') || lower.startsWith('sign') || lower.startsWith('awning') ||
      /^room_\d+_marker$/.test(lower)
      || isDecorativeNodeName(name) || isDoorOrGlassNodeName(name)
    ) return true;
    current = current.parent;
  }
  return false;
}

// ─── Main ───

async function processGLB(inputPath, options = {}) {
  const baseName = path.parse(inputPath).name;
  const dir = path.dirname(inputPath);
  const outputPath = options.outputPath || path.join(dir, `${baseName}_col.json`);
  const excludedNodeKeys = new Set(options.excludeNodeKeys || []);
  const meshDetails = [];

  console.log(`\n=== ${path.basename(inputPath)} ===`);

  const gltf = await loadGLB(inputPath);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const sceneBounds = new THREE.Box3().setFromObject(scene);
  const sceneHeight = sceneBounds.max.y - sceneBounds.min.y;
  const sceneSize = sceneBounds.getSize(new THREE.Vector3());
  if (!(sceneHeight > 1e-6)) throw new Error('Model has no measurable vertical bounds');
  // The world loader later normalizes the GLB to targetH. Keep collision cell
  // size proportional to the raw model height so a 0.01-unit Sketchfab model
  // and a 50-unit Blender model both end up with ~2%-of-height cells in-game.
  const modelCellSize = sceneHeight * 0.02;
  const modelThickness = sceneHeight * 0.0075;
  const verticalQuantum = Math.max(sceneHeight * 0.00025, 1e-9);
  const minCellHeight = sceneHeight * 0.001;
  const mergeGap = sceneHeight * 0.002;

  const boxes = [];
  let subdivCount = 0;
  let skippedUnrasterizableMeshes = 0;
  let skippedBySemanticPolicy = 0;
  let adaptiveSubdividedMeshes = 0;
  let largestAdaptiveCellSize = modelCellSize;

  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.updateWorldMatrix(true, false);
    const geo = obj.geometry;
    if (!geo || !geo.attributes.position) return;
    geo.computeBoundingBox();
    const lb = geo.boundingBox;
    if (!lb) return;

    const worldBox = new THREE.Box3().copy(lb).applyMatrix4(obj.matrixWorld);
    const meshSize = worldBox.getSize(new THREE.Vector3());
    const meshCenter = worldBox.getCenter(new THREE.Vector3());
    const key = nodeKey(scene, obj);
    const names = nodePath(scene, obj);
    meshDetails.push({
      index: meshDetails.length,
      nodeKey: key,
      nodePath: names,
      name: obj.name || names.split(' / ').at(-1) || 'unnamed',
      dimensions: meshSize.toArray(),
      center: meshCenter.toArray(),
      boundsMin: worldBox.min.toArray(),
      boundsMax: worldBox.max.toArray(),
      vertexCount: geo.attributes.position.count,
      triangleCount: Math.floor((geo.index?.count ?? geo.attributes.position.count) / 3),
      collisionProxy: shouldSkip(obj),
      skinned: !!obj.isSkinnedMesh,
    });
    const excludedByRule = typeof options.excludeMesh === 'function'
      && options.excludeMesh({
        object: obj,
        nodeKey: key,
        nodePath: names,
        name: obj.name || names.split(' / ').at(-1) || 'unnamed',
        dimensions: meshSize.toArray(),
        center: meshCenter.toArray(),
        boundsMin: worldBox.min.toArray(),
        boundsMax: worldBox.max.toArray(),
      });
    if (shouldSkip(obj) || excludedNodeKeys.has(key) || excludedByRule) {
      skippedBySemanticPolicy++;
      return;
    }

    const min = lb.min.clone().applyMatrix4(obj.matrixWorld);
    const max = lb.max.clone().applyMatrix4(obj.matrixWorld);
    const s = new THREE.Vector3().subVectors(max, min);
    const minExtent = sceneHeight * 0.0005;
    // A facade, window opening or floor is often a zero-thickness plane. Do not
    // discard it just because one AABB axis is tiny; give fallback boxes a thin
    // physical thickness instead.
    if (Math.max(s.x, s.y, s.z) < minExtent) return;

    if (meshNeedsSubdivision(obj)) {
      const cellSize = modelCellSize;
      const sub = subdivideMeshCollision(
        obj, cellSize, verticalQuantum, modelThickness, minCellHeight, mergeGap,
      );
      if (sub.length > 0) {
        boxes.push(...sub);
        subdivCount++;
        if (sub.effectiveCellSize > modelCellSize * 1.000001) {
          adaptiveSubdividedMeshes++;
          largestAdaptiveCellSize = Math.max(largestAdaptiveCellSize, sub.effectiveCellSize);
        }
        console.log(`  [SUBDIVIDED] "${obj.name}" → ${sub.length} cells`);
        return;
      }
      // Never turn an open/complex mesh into a broad AABB when triangle
      // coverage is empty. A missing collider is safer than an invisible wall.
      skippedUnrasterizableMeshes++;
      console.warn(`  [SKIP] "${obj.name}" has no stable triangle coverage; no AABB fallback`);
      return;
    }

    const center = [min.x + s.x / 2, min.y + s.y / 2, min.z + s.z / 2];
    boxes.push([
      ...center,
      Math.max(s.x, modelThickness),
      Math.max(s.y, modelThickness),
      Math.max(s.z, modelThickness),
    ]);
    console.log(`  [BOX] "${obj.name}"`);
  });

  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(inputPath))
    .digest('hex');
  const manifest = {
    schemaVersion: 1,
    source: path.basename(inputPath),
    sourceSha256,
    generatorVersion: 2,
    generated: new Date().toISOString(),
    // Centers/dimensions are in model-local coordinates after GLTF node transforms.
    // The runtime applies the world entry's targetH/scale, x/z, elevation and ry.
    coordinateSpace: 'model-local',
    boundsMin: sceneBounds.min.toArray(),
    boundsMax: sceneBounds.max.toArray(),
    dimensions: sceneSize.toArray(),
    cellSize: modelCellSize,
    collisionThickness: modelThickness,
    boxes,
  };

  if (options.write !== false) {
    fs.writeFileSync(outputPath, JSON.stringify(manifest));
    const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(0);
    if (options.log !== false) {
      console.log(`  ✅ ${path.basename(outputPath)} (${boxes.length} boxes, ${subdivCount} subdivided, ${sizeKB}KB)`);
    }
  }
  if (options.log !== false) {
    console.log(`  Scanned ${meshDetails.length} mesh components; excluded ${excludedNodeKeys.size} calibrated components`);
  }
  return {
    manifest, meshDetails,
    collisionStats: {
      boxes: boxes.length, subdividedMeshes: subdivCount,
      skippedUnrasterizableMeshes, skippedBySemanticPolicy,
      adaptiveSubdividedMeshes, largestAdaptiveCellSize,
    },
  };
}

// ─── CLI ───

export { loadGLB, nodeKey, nodePath, processGLB, subdivideMeshCollision };

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isDirectRun = invokedPath && import.meta.url === pathToFileURL(invokedPath).href;
if (isDirectRun) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log('Usage: node tools/process-glbs.js <file.glb|file.gltf> [...]');
    process.exit(1);
  }
  (async () => {
    for (const file of files) {
      try { await processGLB(file); } catch (e) { console.error(`  ❌ ${e.message}`); }
    }
    console.log('\nDone!');
  })();
}
