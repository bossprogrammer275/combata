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
    for (let i = 0; i < idx.count; i += 3) {
      tris.push([idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)]);
    }
  } else {
    for (let i = 0; i < posAttr.count; i += 3) {
      tris.push([i, i + 1, i + 2]);
    }
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const wv of worldVerts) {
    if (wv.x < minX) minX = wv.x; if (wv.x > maxX) maxX = wv.x;
    if (wv.z < minZ) minZ = wv.z; if (wv.z > maxZ) maxZ = wv.z;
  }
  if (!isFinite(minX)) return [];
  minX -= 0.1; maxX += 0.1; minZ -= 0.1; maxZ += 0.1;

  const cols = Math.ceil((maxX - minX) / cellSize);
  const rows = Math.ceil((maxZ - minZ) / cellSize);
  if (cols * rows > 5000) return [];

  const cells = new Map();
  for (let ci = 0; ci < cols; ci++) {
    for (let ri = 0; ri < rows; ri++) {
      const cxMin = minX + ci * cellSize;
      const cxMax = cxMin + cellSize;
      const czMin = minZ + ri * cellSize;
      const czMax = czMin + cellSize;
      let yMin = Infinity, yMax = -Infinity, hasTri = false;

      for (const tri of tris) {
        const a = worldVerts[tri[0]], b = worldVerts[tri[1]], c = worldVerts[tri[2]];
        if (Math.max(a.x, b.x, c.x) < cxMin || Math.min(a.x, b.x, c.x) > cxMax) continue;
        if (Math.max(a.z, b.z, c.z) < czMin || Math.min(a.z, b.z, c.z) > czMax) continue;
        hasTri = true;
        const y = Math.min(a.y, b.y, c.y), y2 = Math.max(a.y, b.y, c.y);
        if (y < yMin) yMin = y; if (y2 > yMax) yMax = y2;
      }

      if (hasTri && isFinite(yMin)) {
        const h = yMax - yMin + THICKNESS;
        if (h >= MIN_CELL_H) {
          const x = cxMin + cellSize / 2, z = czMin + cellSize / 2;
          const cy = yMin + h / 2 - 0.05;
          cells.set(`${ci},${ri}`, [x, cy, z, cellSize, h, cellSize]);
        }
      }
    }
  }
  return [...cells.values()];
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
    || n.startsWith('door_');
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
    source: path.basename(inputPath),
    generated: new Date().toISOString(),
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
