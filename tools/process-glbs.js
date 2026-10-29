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

function loadGLB(filePath) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    const data = fs.readFileSync(filePath);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    loader.parse(buf, '', (gltf) => resolve(gltf), reject);
  });
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

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of worldVerts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) return [];
  const gridPadding = cellSize * 0.1;
  minX -= gridPadding; maxX += gridPadding; minZ -= gridPadding; maxZ += gridPadding;

  const cols = Math.ceil((maxX - minX) / cellSize);
  const rows = Math.ceil((maxZ - minZ) / cellSize);
  if (cols <= 0 || rows <= 0 || cols * rows > 50000) return [];

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
    const c0 = Math.max(0, Math.min(cols - 1, Math.floor((txMin - minX) / cellSize)));
    const c1 = Math.max(0, Math.min(cols - 1, Math.floor((txMax - minX) / cellSize)));
    const r0 = Math.max(0, Math.min(rows - 1, Math.floor((tzMin - minZ) / cellSize)));
    const r1 = Math.max(0, Math.min(rows - 1, Math.floor((tzMax - minZ) / cellSize)));
    const yMin = Math.min(a.y, b.y, c.y);
    const yMax = Math.max(a.y, b.y, c.y);

    for (let ci = c0; ci <= c1; ci++) {
      const cellMinX = minX + ci * cellSize;
      const cellMaxX = cellMinX + cellSize;
      for (let ri = r0; ri <= r1; ri++) {
        const cellMinZ = minZ + ri * cellSize;
        const cellMaxZ = cellMinZ + cellSize;
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

      const w = spanX * cellSize, d = spanZ * cellSize;
      const x = minX + ci * cellSize + w / 2;
      const z = minZ + ri * cellSize + d / 2;
      const h = Math.max(0, layer.yMax - layer.yMin) + thickness;
      if (h < minCellHeight) continue;
      const cy = layer.yMin + h / 2 - thickness / 6;
      boxes.push([x, cy, z, w, h, d]);
    }
  }
  return boxes;
}

function meshNeedsSubdivision(mesh) {
  const geo = mesh.geometry;
  if (!geo || !geo.attributes.position) return false;
  const verts = geo.attributes.position.count;
  if (verts > 50) return true;
  mesh.updateWorldMatrix(true, false);
  geo.computeBoundingBox();
  const lb = geo.boundingBox;
  if (!lb) return false;
  const s = new THREE.Vector3().subVectors(lb.max, lb.min);
  return s.x * s.y * s.z > 8 || Math.max(s.x, s.y, s.z) / (Math.min(s.x, s.y, s.z) + 0.01) > 4;
}

function shouldSkip(name) {
  const n = (name || '').toLowerCase();
  return n.startsWith('col_') || n.startsWith('trim_') || n.startsWith('window_')
    || n.startsWith('roof_detail') || n.startsWith('sign') || n.startsWith('awning')
    || n.startsWith('door_') || /^room_\d+_marker$/.test(n);
}

// ─── Main ───

async function processGLB(inputPath) {
  const baseName = path.basename(inputPath, '.glb');
  const dir = path.dirname(inputPath);
  const outputPath = path.join(dir, `${baseName}_col.json`);

  console.log(`\n=== ${path.basename(inputPath)} ===`);

  const gltf = await loadGLB(inputPath);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const sceneBounds = new THREE.Box3().setFromObject(scene);
  const sceneHeight = sceneBounds.max.y - sceneBounds.min.y;
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

  scene.traverse((obj) => {
    if (!obj.isMesh || shouldSkip(obj.name)) return;
    obj.updateWorldMatrix(true, false);
    const geo = obj.geometry;
    if (!geo || !geo.attributes.position) return;
    geo.computeBoundingBox();
    const lb = geo.boundingBox;
    if (!lb) return;

    const min = lb.min.clone().applyMatrix4(obj.matrixWorld);
    const max = lb.max.clone().applyMatrix4(obj.matrixWorld);
    const s = new THREE.Vector3().subVectors(max, min);
    const minExtent = sceneHeight * 0.0005;
    if (s.x < minExtent || s.z < minExtent || s.y < minExtent) return;

    if (meshNeedsSubdivision(obj)) {
      const cellSize = modelCellSize;
      const sub = subdivideMeshCollision(
        obj, cellSize, verticalQuantum, modelThickness, minCellHeight, mergeGap,
      );
      if (sub.length > 0) {
        boxes.push(...sub);
        subdivCount++;
        console.log(`  [SUBDIVIDED] "${obj.name}" → ${sub.length} cells`);
        return;
      }
    }

    const center = [min.x + s.x / 2, min.y + s.y / 2, min.z + s.z / 2];
    boxes.push([...center, s.x, s.y, s.z]);
    console.log(`  [BOX] "${obj.name}"`);
  });

  const manifest = {
    schemaVersion: 1,
    source: path.basename(inputPath),
    generated: new Date().toISOString(),
    // Centers/dimensions are in model-local coordinates after GLTF node transforms.
    // The runtime applies the world entry's targetH/scale, x/z, elevation and ry.
    coordinateSpace: 'model-local',
    cellSize: modelCellSize,
    collisionThickness: modelThickness,
    boxes,
  };

  fs.writeFileSync(outputPath, JSON.stringify(manifest));
  const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(0);
  console.log(`  ✅ ${path.basename(outputPath)} (${boxes.length} boxes, ${subdivCount} subdivided, ${sizeKB}KB)`);
}

// ─── CLI ───

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log('Usage: node tools/process-glbs.js <file.glb> [...]');
  process.exit(1);
}

(async () => {
  for (const file of files) {
    try { await processGLB(file); } catch (e) { console.error(`  ❌ ${e.message}`); }
  }
  console.log('\nDone!');
})();
