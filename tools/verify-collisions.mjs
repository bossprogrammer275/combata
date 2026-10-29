// verify-collisions.mjs — smoke tests for the GLB collision pipeline.
// Run with: node tools/verify-collisions.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../js/world.js';
import { BVHWorld } from '../js/bvh-collision.js';

function worldHarness() {
  const world = Object.create(World.prototype);
  world.colliders = [];
  world.climbables = [];
  world.bvhWorld = new BVHWorld();
  world._physics = null;
  return world;
}

function hasXZOverlap(c, xMin, xMax, zMin, zMax) {
  return c.max.x > xMin && c.min.x < xMax && c.max.z > zMin && c.min.z < zMax;
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  PASS ' + name);
  } catch (error) {
    failures++;
    console.error('  FAIL ' + name + ': ' + (error?.stack || error));
  }
}

console.log('[collision verify] GLB collision contract');

check('nested col_* proxy is excluded from render-mesh BVH', () => {
  const root = new THREE.Group();
  root.name = 'col_building_walls';
  const child = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.2), new THREE.MeshBasicMaterial());
  child.name = 'Cube';
  root.add(child);
  const bvh = new BVHWorld();
  bvh.registerModel(root);
  assert.equal(bvh.bvhMeshes.length, 0, 'hidden collision-only child must not be raycasted');
});

check('nested window_* visual is excluded from render-mesh BVH', () => {
  const root = new THREE.Group();
  root.name = 'window_glazing';
  const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05), new THREE.MeshBasicMaterial());
  child.name = 'Cube.001';
  root.add(child);
  const bvh = new BVHWorld();
  bvh.registerModel(root);
  assert.equal(bvh.bvhMeshes.length, 0, 'visual-only child must not be raycasted as a solid');
});

check('climbable collider is also a solid movement collider', () => {
  const world = worldHarness();
  const c = world.addCollider(0, 0, 0, 2, 2, 0.25, true, 'fence');
  assert.ok(world.colliders.includes(c), 'fence missing from solid colliders');
  assert.ok(world.climbables.includes(c), 'fence missing from climb registry');
  assert.ok(world.bvhWorld.aabbColliders.includes(c), 'fence missing from movement query index');
  assert.ok(world.bvhWorld._climbables.includes(c), 'fence missing from climb query index');
  world._removeWorldCollider(c);
  assert.ok(!world.colliders.includes(c), 'removed fence remains in world colliders');
  assert.ok(!world.climbables.includes(c), 'removed fence remains in climb registry');
  assert.ok(!world.bvhWorld.aabbColliders.includes(c), 'removed fence remains in movement index');
  assert.ok(!world.bvhWorld._climbables.includes(c), 'removed fence remains in climb index');
});

check('spatial grid limits movement queries to nearby collider cells', () => {
  const world = worldHarness();
  const nearby = world.addCollider(2, 0, 3, 1, 2, 1);
  world.addCollider(700, 0, 700, 2, 2, 2);
  world.addCollider(-800, 0, 950, 2, 2, 2);
  const byRadius = world.bvhWorld.queryRadius(2, 3, 2);
  assert.ok(byRadius.includes(nearby), 'nearby collider was omitted by the grid');
  assert.equal(byRadius.length, 1, 'nearby query scanned or returned distant cells');
  const byBox = world.bvhWorld.queryAABB(1.4, 2.4, 2.6, 3.6);
  assert.deepEqual(byBox, [nearby], 'AABB query did not resolve the correct spatial cell');
});

check('raycasts query nearby AABB cells instead of scanning all colliders', () => {
  const world = worldHarness();
  const near = world.addCollider(2, 0, 3, 1, 2, 1);
  world.addCollider(700, 0, 700, 2, 2, 2);
  world.addCollider(-800, 0, 950, 2, 2, 2);
  const query = world.bvhWorld._queryAABBCandidates.bind(world.bvhWorld);
  let candidatesSeen = 0;
  world.bvhWorld._queryAABBCandidates = (...args) => {
    const result = query(...args);
    candidatesSeen = result.size ?? result.length;
    return result;
  };
  const hit = world.bvhWorld.raycast(
    new THREE.Vector3(2, 1, 0),
    new THREE.Vector3(0, 0, 1),
    10,
  );
  assert.ok(hit, 'ray failed to hit the nearby wall');
  assert.ok(Math.abs(hit.dist - 2.5) < 1e-5, 'ray did not hit the correct wall face');
  assert.equal(candidatesSeen, 1, 'raycast considered colliders outside its spatial cells');
  assert.ok(world.bvhWorld.aabbColliders.includes(near));
});

check('removed collider disappears from the spatial grid', () => {
  const world = worldHarness();
  const c = world.addCollider(0, 0, 0, 1, 2, 1);
  assert.ok(world.bvhWorld.queryRadius(0, 0, 2).includes(c));
  world._removeWorldCollider(c);
  assert.ok(!world.bvhWorld.queryRadius(0, 0, 2).includes(c), 'removed collider remained in cell buckets');
});

check('collision sidecar applies scale, yaw, translation and ground offset', () => {
  const world = worldHarness();
  const count = world._injectManifestColliders(
    { boxes: [[2, 1, 3, 2, 2, 1]] },
    { x: 10, z: 20, ry: Math.PI / 2 },
    2,
    1,
  );
  assert.equal(count, 1);
  const c = world.colliders[0];
  assert.ok(Math.abs(c.min.x - 15) < 1e-5 && Math.abs(c.max.x - 17) < 1e-5,
    `rotated X bounds unexpected: ${c.min.x},${c.max.x}`);
  assert.ok(Math.abs(c.min.z - 14) < 1e-5 && Math.abs(c.max.z - 18) < 1e-5,
    `rotated Z bounds unexpected: ${c.min.z},${c.max.z}`);
  assert.ok(Math.abs(c.min.y - 1) < 1e-5 && Math.abs(c.max.y - 5) < 1e-5,
    `scaled vertical bounds unexpected: ${c.min.y},${c.max.y}`);
});

check('small sidecar cells do not seal a door_* opening', () => {
  const world = worldHarness();
  const doorCenter = new THREE.Vector3(16, 1, 16);
  const door = {
    center: doorCenter,
    min: new THREE.Vector3(15.4, 0, 15.9),
    max: new THREE.Vector3(16.6, 2.1, 16.1),
    size: new THREE.Vector3(1.2, 2.1, 0.2),
  };
  const count = world._injectManifestColliders(
    { boxes: [[16, 0.9, 16, 1, 1.8, 1]] },
    { x: 0, z: 0, ry: 0, building: true },
    1,
    0,
    [door],
    new THREE.Box3(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 12, 20)),
  );
  assert.equal(count, 0, 'manifest inserted a solid cell across the entrance');
});

check('rotated fallback wall colliders leave the doorway passable', () => {
  const world = worldHarness();
  const yaw = Math.PI / 4;
  const origin = { x: 30, z: -20 };
  const localDoorX = 0, localDoorZ = -5;
  const doorCenter = new THREE.Vector3(
    origin.x + localDoorX * Math.cos(yaw) + localDoorZ * Math.sin(yaw),
    1.0,
    origin.z - localDoorX * Math.sin(yaw) + localDoorZ * Math.cos(yaw),
  );
  const door = {
    name: 'door_main',
    center: doorCenter,
    size: new THREE.Vector3(1.0, 2.1, 0.2),
    min: doorCenter.clone().add(new THREE.Vector3(-0.7, -1.05, -0.7)),
    max: doorCenter.clone().add(new THREE.Vector3(0.7, 1.05, 0.7)),
  };
  const localBBox = new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 8, 5));
  world._addBuildingWallColliders(new THREE.Box3(), [door], {
    localBBox, x: origin.x, z: origin.z, yOffset: 0, yaw,
  });
  assert.ok(world.colliders.length > 12, 'fallback did not create segmented wall colliders');
  const blockedInDoor = world.colliders.some(c =>
    c.min.y < 1.9 && c.max.y > 0.1 &&
    hasXZOverlap(c, doorCenter.x - 0.15, doorCenter.x + 0.15, doorCenter.z - 0.15, doorCenter.z + 0.15)
  );
  assert.ok(!blockedInDoor, 'wall AABB still blocks the center of the doorway');
});

check('lane markings stop at road junctions', () => {
  const world = Object.create(World.prototype);
  world.ribbons = [];
  world._mat = (key) => ({ key });
  world._strokeMitered = function (pts, width, y, mat, closed) {
    this.ribbons.push({ pts, width, y, mat, closed });
  };
  const chains = [
    { pts: [{ x: -20, z: 0 }, { x: 20, z: 0 }], W: 18, roadY: 0.06, sidewalk: true },
    { pts: [{ x: 0, z: -20 }, { x: 0, z: 20 }], W: 8, roadY: 0.08, sidewalk: true },
  ];
  world._buildRoadMarkings(chains);
  const yellow = world.ribbons.filter(r => r.mat.key === 'lane-center-mark');
  assert.ok(yellow.length > 0, 'no center-line geometry was generated');
  for (const line of yellow) {
    for (const p of line.pts) {
      assert.ok(Math.hypot(p.x, p.z) > 5, 'yellow center-line leaks into the junction');
    }
  }
  const crossings = world.ribbons.filter(r => r.mat.key === 'crosswalk-mark');
  assert.ok(crossings.length >= 10, 'junctions did not generate pedestrian crossings');
  for (const stripe of crossings) {
    assert.ok(stripe.width <= 0.15, 'crosswalk stripe thickness is too large');
    assert.ok(stripe.pts.some(p => Math.hypot(p.x, p.z) > 5), 'crosswalk unexpectedly painted inside junction center');
  }
});

console.log(failures ? `[collision verify] ${failures} FAILURES` : '[collision verify] ALL CHECKS PASSED');
process.exitCode = failures ? 1 : 0;
