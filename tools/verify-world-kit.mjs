import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WORLD_KIT_ASSET_DEFINITIONS,
  WORLD_KIT_PROCEDURAL_RULES,
  annotateWorldKitInstance,
  classifyWorldKitMesh,
  getWorldKitDefinition,
} from '../js/world-kit.js';

assert.ok(Object.keys(WORLD_KIT_ASSET_DEFINITIONS).length >= 50, 'catalogue should cover the imported asset library');
assert.equal(
  getWorldKitDefinition('./data/models/assets/residential/nigeria_duplex/scene.gltf')?.id,
  'nigeria-duplex',
);
assert.equal(
  getWorldKitDefinition('/data/models/assets/roads/sidewalks/scene.gltf')?.meshPolicy,
  'semantic-child-pieces',
);
assert.equal(
  getWorldKitDefinition('data/models/assets/others/traffic_lights/scene.gltf')?.review,
  'licence-restricted',
);
assert.equal(getWorldKitDefinition('data/models/assets/not-in-catalogue.glb'), null);
assert.equal(
  getWorldKitDefinition('data/models/assets/road.glb'),
  null,
  'the standalone road.glb is intentionally excluded from the World Kit',
);
assert.equal(
  getWorldKitDefinition('data/models/assets/roads/road_pack/scene.gltf')?.id,
  'road-pack',
);
assert.equal(
  getWorldKitDefinition('data/models/assets/roads/road_pack/scene.gltf')?.collisionProfile,
  'no-collision',
  'the six thin road-marked panel meshes are visual pieces, not physics road surfaces',
);
assert.equal(
  getWorldKitDefinition('data/models/assets/roads/street_road/scene.gltf')?.role,
  'two-lane-wet-road-source',
);

assert.equal(
  getWorldKitDefinition('data/models/assets/roads/road_block/scene.gltf')?.collisionProfile,
  'solid-prop',
  'road barricades must collide as props, not be mistaken for drivable road surfaces',
);
assert.equal(
  getWorldKitDefinition('data/models/assets/roads/speed_bump.glb')?.collisionProfile,
  'solid-prop',
);
assert.equal(
  getWorldKitDefinition('data/models/assets/others/low_poly_shrub.glb')?.collisionProfile,
  'no-collision',
);

const root = new THREE.Group();
root.name = 'test-building';
const doorGroup = new THREE.Group();
doorGroup.name = 'door_main';
const door = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), new THREE.MeshBasicMaterial());
door.name = 'DoorMesh';
doorGroup.add(door);
root.add(doorGroup);

const windowGroup = new THREE.Group();
windowGroup.name = 'window_front';
const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05), new THREE.MeshBasicMaterial());
windowGroup.add(windowMesh);
root.add(windowGroup);

const collisionGroup = new THREE.Group();
collisionGroup.name = 'col_wall';
const collisionMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.2), new THREE.MeshBasicMaterial());
collisionGroup.add(collisionMesh);
root.add(collisionGroup);

assert.equal(classifyWorldKitMesh(door, root), 'door');
assert.equal(classifyWorldKitMesh(windowMesh, root), 'window-glazing');
assert.equal(classifyWorldKitMesh(collisionMesh, root), 'collision-proxy');

const roadPackRoot = new THREE.Group();
roadPackRoot.userData.worldKit = { id: 'road-pack' };
const roadPanel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
roadPanel.name = 'Object_4';
roadPackRoot.add(roadPanel);
assert.equal(classifyWorldKitMesh(roadPanel, roadPackRoot), 'road-straight-module');

const garageDoorRoot = new THREE.Group();
const garageDoor = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), new THREE.MeshBasicMaterial());
garageDoor.name = 'GarageDoor';
garageDoorRoot.add(garageDoor);
assert.equal(classifyWorldKitMesh(garageDoor, garageDoorRoot), 'door');

const sidewalkRoot = new THREE.Group();
sidewalkRoot.name = 'Sidewwalk_Long';
const sidewalkMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.5), new THREE.MeshBasicMaterial());
sidewalkRoot.add(sidewalkMesh);
assert.equal(classifyWorldKitMesh(sidewalkMesh, new THREE.Group().add(sidewalkRoot)), 'sidewalk-piece');

const poleRoot = new THREE.Group();
poleRoot.name = 'Pole_0';
const poleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 0.1), new THREE.MeshBasicMaterial());
poleRoot.add(poleMesh);
assert.equal(classifyWorldKitMesh(poleMesh, new THREE.Group().add(poleRoot)), 'infrastructure-piece');

const sourceDoorGeometry = door.geometry;
const result = annotateWorldKitInstance(root, {
  url: './data/models/assets/residential/nigeria_duplex/scene.gltf',
});
assert.equal(result.id, 'nigeria-duplex');
assert.equal(result.category, 'residential');
assert.equal(result.meshCount, 3);
assert.equal(result.roleCounts.door, 1);
assert.equal(result.roleCounts['window-glazing'], 1);
assert.equal(result.roleCounts['collision-proxy'], 1);
assert.equal(door.geometry, sourceDoorGeometry, 'annotation must not replace or procedurally rebuild imported geometry');
assert.equal(root.children.length, 3, 'annotation must preserve the imported hierarchy');
assert.equal(root.userData.worldKit.id, 'nigeria-duplex');

const proceduralIds = new Set(WORLD_KIT_PROCEDURAL_RULES.map(rule => rule.id));
for (const required of ['curved-road-surfaces', 'lane-markings', 'collision-proxies']) {
  assert.ok(proceduralIds.has(required), 'missing procedural support rule: ' + required);
}

console.log(
  '[world-kit] PASS: ' + Object.keys(WORLD_KIT_ASSET_DEFINITIONS).length +
  ' registered assets; semantic mesh roles and non-destructive annotation verified.',
);
