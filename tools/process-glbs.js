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

const CELL_SIZE = 1.0;
const THICKNESS = 0.3;
const MIN_CELL_H = 0.1;

// ─── Polyfill FileReader for Node.js ───
class FileReaderPolyfill {
  constructor() { this.result = null; this.onload = null; }
  readAsArrayBuffer(blob) {
    this.result = blob.buffer || new ArrayBuffer(0);
    if (this.onload) this.onload({ target: this });
  }
  readAsDataURL(blob) {
    const buf = Buffer.from(blob.buffer || blob);
    this.result = 'data:application/octet-stream;base64,' + buf.toString('base64');
    if (this.onload) this.onload({ target: this });
  }
}
if (typeof globalThis.FileReader === 'undefined') globalThis.FileReader = FileReaderPolyfill;

function loadGLB(filePath) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    const data = fs.readFileSync(filePath);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    loader.parse(buf, '', (gltf) => resolve(gltf), reject);
  });
}

// ─── Surface subdivision ───

function subdivideMeshCollision(mesh, cellSize) {
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
  minX -= 0.1; maxX += 0.1; minZ -= 0.1; maxZ += 0.1;

  const cols = Math.ceil((maxX - minX) / cellSize);
  const rows = Math.ceil((maxZ - minZ) / cellSize);
  if (cols <= 0 || rows <= 0 || cols * rows > 5000) return [];

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
      for (let ri = r0; ri <= r1; ri++) {
        const key = ci * rows + ri;
        let cell = cells.get(key);
        if (!cell) {
          cell = { ci, ri, yMin, yMax };
          cells.set(key, cell);
        } else {
          cell.yMin = Math.min(cell.yMin, yMin);
          cell.yMax = Math.max(cell.yMax, yMax);
        }
      }
    }
  }

  const boxes = [];
  for (const cell of cells.values()) {
    const h = cell.yMax - cell.yMin + THICKNESS;
    if (h < MIN_CELL_H) continue;
    const x = minX + cell.ci * cellSize + cellSize / 2;
    const z = minZ + cell.ri * cellSize + cellSize / 2;
    const cy = cell.yMin + h / 2 - 0.05;
    boxes.push([x, cy, z, cellSize, h, cellSize]);
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
    if (s.x < 0.05 || s.z < 0.05 || s.y < 0.05) return;

    if (meshNeedsSubdivision(obj)) {
      const cellSize = Math.max(0.8, Math.min(s.x, s.z) * 0.15);
      const sub = subdivideMeshCollision(obj, cellSize);
      if (sub.length > 2) {
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
    cellSize: CELL_SIZE,
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
