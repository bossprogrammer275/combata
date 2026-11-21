import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { globSync } from 'glob';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const map = await readJson('data/worlds/test.json');
const worldSource = await readFile('js/world.js', 'utf8');
const editorSource = await readFile('map-editor.html', 'utf8');
const mainSource = await readFile('js/main.js', 'utf8');
const vehicleSource = await readFile('js/vehicles.js', 'utf8');
const civilianSource = await readFile('js/civilians.js', 'utf8');

const sourceAssets = globSync('data/models/assets/**/*.{glb,gltf}', { nodir: true })
  .map(path => path.replace(/\\/g, '/').replace(/^data\/models\/assets\//, ''))
  .sort();
const placedAssets = (map.glbAssets || [])
  .map(asset => String(asset.url || '').replace(/^\.\/data\/models\/assets\//, ''))
  .sort();

assert.equal(sourceAssets.length, 61, 'Repository asset inventory changed; update the test map inventory intentionally.');
assert.equal(placedAssets.length, sourceAssets.length, 'Every model asset must be placed exactly once.');
assert.equal(new Set(placedAssets).size, placedAssets.length, 'A model asset appears more than once in test.json.');
assert.deepEqual(placedAssets, sourceAssets, 'Test map must include every source GLB/glTF asset and no unknown path.');

assert.equal(map.id, 'test');
assert.equal(map.streaming?.enabled, false, 'Streaming must be disabled in the test world.');
assert.equal(map.streaming?.assetConcurrency, 1, 'Test world uses one-asset loading concurrency for the low-memory target.');
assert.equal(map.disableAutoSpawns, true, 'Ambient combat spawns must not contaminate the interaction test.');
assert.equal(map.disableHostiles, true, 'The test world must not auto-spawn hostiles.');

assert.equal(map.npcLimit, 4);
assert.equal(map.npcSpawns?.length, 4, 'Four authored NPC roles should spawn initially.');
assert.deepEqual(
  [...new Set(map.npcSpawns.map(spawn => spawn.profile))].sort(),
  ['aggressive', 'civilian', 'police', 'worker'],
);
assert.equal(map.trafficVehicles?.length, 4, 'Traffic loop should contain four authored vehicles.');
assert.equal(map.vehicles?.length, 4, 'The four test vehicles should be parked and enterable.');
assert.ok(map.roads?.length >= 5, 'Street network needs intersections and ramp connections.');

const rampRoads = map.roads.filter(road => /ramp/i.test(road.name || ''));
assert.ok(rampRoads.length >= 3, 'Multiple diagonal hill ramps must be present.');
for (const road of rampRoads) {
  const elevations = road.points.map(point => Number(point[2]) || 0);
  assert.ok(Math.max(...elevations) - Math.min(...elevations) > 1, road.name + ' must have a real height profile.');
}
assert.ok(map.ground?.hills?.length >= 4, 'The test map needs multiple authored hills.');
assert.ok(map.ground?.cellSize > 0, 'Terrain must use a subdivided, measurable grid.');

const obstacles = map.testWorld?.obstacles || [];
for (const expectedHeight of [1, 1.6, 2.7]) {
  assert.ok(obstacles.some(item => Math.abs(item.h - expectedHeight) < 0.001),
    'Missing fence traversal height ' + expectedHeight + 'm.');
}
assert.ok(map.testWorld?.referenceWall?.height >= 5, 'Metre reference wall is missing.');
assert.equal(map.testWorld?.grassPatches?.length > 0, true, 'Decorative grass patches must be present.');
assert.equal(map.testWorld?.rocks?.length > 0, true, 'Rock props must be present.');
assert.equal(map.testWorld?.sandPatches?.length > 0, true, 'Sand test surfaces must be present.');

const nonCollidingFoliage = new Set([
  'others/hedge.glb',
  'others/low_poly_shrub.glb',
  'others/real_bush.glb',
]);
for (const asset of map.glbAssets) {
  const path = String(asset.url).replace(/^\.\/data\/models\/assets\//, '');
  if (nonCollidingFoliage.has(path)) {
    assert.equal(asset.noCollision, true, path + ' must never create collision.');
  }
}
assert.match(worldSource, /isSoftFoliage/);
assert.match(worldSource, /const hasNoCollision = !!a\.noCollision \|\| isSoftFoliage/);
assert.match(worldSource, /test_grass_no_collision/);
assert.match(worldSource, /_terrainHeightAt/);
assert.match(worldSource, /groundHeightAt\(x, z, maxHeight = Infinity\)/);
assert.match(worldSource, /configuredConcurrency/);
assert.match(worldSource, /assetDimensionBase/);
assert.match(worldSource, /dimensions\.widthM/);
assert.match(worldSource, /dimensions\.heightM/);

assert.match(editorSource, /Edit global model size/);
assert.match(editorSource, /applyAeGlobalDimensions/);
assert.match(editorSource, /saveGlobalAssetDimensions/);
assert.match(editorSource, /\/api\/asset-overrides/);
assert.match(editorSource, /Width \(m\)/);
assert.match(editorSource, /Height \(m\)/);
assert.match(mainSource, /'test\.json'/);
assert.match(mainSource, /this\.vehicles\.updateTraffic\(dt\)/);
assert.match(vehicleSource, /_createTrafficRoute/);
assert.match(vehicleSource, /this\._trafficVehicles\.push\(vehicle\)/);
assert.match(civilianSource, /authoredSpawns/);
assert.match(civilianSource, /spawnAt\(selected, spawn\.profile/);

console.log('[TestWorld] PASS — all 61 unique GLB/glTF assets are placed once.');
console.log('[TestWorld] PASS — streaming disabled; 1-model decode concurrency.');
console.log('[TestWorld] PASS — 4 NPC roles, 4 parked vehicles, 4 looping traffic vehicles.');
console.log('[TestWorld] PASS — hills, ramp profiles, traversal height tests, sand, rocks and non-colliding foliage.');
console.log('[TestWorld] PASS — live global model sizing metadata is wired to runtime loading.');
