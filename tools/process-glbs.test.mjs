import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { subdivideMeshCollision } from './process-glbs.js';

function makeIndexedMesh(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

test('long thin speed-bump geometry adapts the grid instead of being skipped at the 50k cell cap', () => {
  const positions = [];
  const indices = [];
  const segments = 10;
  const heightAt = z => 0.31 * Math.max(0, 1 - Math.abs(z) / 5);
  for (let index = 0; index < segments; index++) {
    const z0 = -5 + index;
    const z1 = z0 + 1;
    const y0 = heightAt(z0), y1 = heightAt(z1);
    const base = positions.length / 3;
    positions.push(-1, y0, z0, 1, y0, z0, -1, y1, z1, 1, y1, z1);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const mesh = makeIndexedMesh(positions, indices);
  const nominalCellSize = 0.0062;
  const boxes = subdivideMeshCollision(mesh, nominalCellSize, 0.000078, 0.0023, 0.00031, 0.00062);
  assert.ok(boxes.length > 0, 'speed bump must produce collision boxes');
  assert.ok(boxes.effectiveCellSize > nominalCellSize,
    'the mesh-specific grid must adapt upward when the nominal grid exceeds the cap');
  assert.ok(boxes.every(box => box.length === 6 && box.every(Number.isFinite)),
    'adaptive output must contain finite six-value collision boxes');
  assert.ok(boxes.every(box => box[0] >= -1.2 && box[0] <= 1.2 && box[2] >= -5.2 && box[2] <= 5.2),
    'collision boxes must stay inside the speed-bump footprint');
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('triangle rasterisation keeps a doorway opening clear between wall sections', () => {
  const positions = [];
  const indices = [];
  const addWallSection = (minX, maxX) => {
    const base = positions.length / 3;
    positions.push(minX, 0, 0, maxX, 0, 0, minX, 3, 0, maxX, 3, 0);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  addWallSection(-2, -0.5);
  addWallSection(0.5, 2);
  const mesh = makeIndexedMesh(positions, indices);
  const boxes = subdivideMeshCollision(mesh, 0.1, 0.01, 0.05, 0.03, 0.02);
  assert.ok(boxes.length > 0, 'both wall sections must produce solid colliders');
  const doorwayBlocked = boxes.some(box => {
    const halfWidth = box[3] * 0.5, halfDepth = box[5] * 0.5;
    return box[0] + halfWidth > -0.35 && box[0] - halfWidth < 0.35
      && box[2] + halfDepth > -0.15 && box[2] - halfDepth < 0.15;
  });
  assert.equal(doorwayBlocked, false, 'no collision box may fill the clear doorway gap');
  mesh.geometry.dispose();
  mesh.material.dispose();
});
