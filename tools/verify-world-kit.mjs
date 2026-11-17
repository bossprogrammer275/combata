import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WORLD_KIT_ASSET_DEFINITIONS,
  WORLD_KIT_PROCEDURAL_RULES,
  WORLD_KIT_ROAD_PACK_SCALE,
  WORLD_KIT_ROAD_PACK_PARTS,
  WORLD_KIT_SIDEWALK_COMPONENTS,
  WORLD_KIT_DOOR_GROUPS,
  annotateWorldKitInstance,
  classifyWorldKitMesh,
  getWorldKitDefinition,
  getWorldKitPlacementOffset,
  getWorldKitScalePlan,
  getWorldKitDoorMarkers,
  getWorldKitDoorGroups,
  getWorldKitCollisionManifest,
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

const cmPlan = getWorldKitScalePlan(2000, { unitScale: 0.01, targetH: 10 });
assert.equal(cmPlan.mode, 'target-height-metres');
assert.equal(cmPlan.sourceHeightMetres, 20);
assert.equal(cmPlan.targetHeightMetres, 10);
assert.equal(cmPlan.totalScale, 0.005,
  'a 2000-unit centimetre-authored model must finish exactly 10 metres tall');
const metrePlan = getWorldKitScalePlan(4, { targetH: 12 });
assert.equal(metrePlan.totalScale, 3);
const rawUnitPlan = getWorldKitScalePlan(250, { unitScale: 0.01 });
assert.equal(rawUnitPlan.totalScale, 0.01,
  'explicit source-unit conversion must apply when no targetH fit is authored');

assert.ok(getWorldKitDoorMarkers('nigeria-duplex').length > 0,
  'downloaded residential assets without door_* names need authored door metadata');
assert.ok(getWorldKitDoorGroups('ilorin-innovation-hub').includes('entrance-doors-portal'),
  'the Innovation Hub entrance hierarchy must resolve as one imported door group');
assert.ok(WORLD_KIT_DOOR_GROUPS['american-style-house'].includes('Door'),
  'the American house imported door assembly must be recognized');
assert.equal(getWorldKitCollisionManifest('./data/models/assets/kwara_revenue_house.glb'),
  './data/models/assets/kwara_revenue_house_col.json');
assert.equal(getWorldKitCollisionManifest('./data/models/assets/residential/nigeria_duplex/scene.gltf'), null,
  'models without a generated sidecar must use the authored building-wall fallback, not request a 404');
assert.deepEqual(
  getWorldKitPlacementOffset(
    { min: { x: -11, z: -7 }, max: { x: 9, z: 13 } },
    { building: true },
  ),
  { x: 1, z: -3 },
  'building placements must centre off-origin imported models on authored x/z coordinates',
);
assert.deepEqual(
  getWorldKitPlacementOffset(
    { min: { x: -11, z: -7 }, max: { x: 9, z: 13 } },
    { building: false },
  ),
  { x: 0, z: 0 },
  'non-building assets retain their authored pivot unless centreXZ is requested',
);
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
assert.equal(WORLD_KIT_ROAD_PACK_SCALE, 10, 'road pack source geometry needs the measured 10× horizontal scale');
assert.equal(WORLD_KIT_ROAD_PACK_PARTS.Object_8.id, 'road-straight-long-01');
assert.equal(WORLD_KIT_ROAD_PACK_PARTS.Object_10.id, 'road-straight-long-02');
assert.equal(WORLD_KIT_ROAD_PACK_PARTS.Object_12.role, 'road-corner-module');
assert.equal(WORLD_KIT_ROAD_PACK_PARTS.Object_14.role, 'road-corner-module');

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
const revenueDoorRoot = new THREE.Group();
const revenueDoor = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), new THREE.MeshBasicMaterial());
revenueDoor.name = 'door_main_left_leaf__door_glass';
revenueDoorRoot.add(revenueDoor);
assert.equal(classifyWorldKitMesh(revenueDoor, revenueDoorRoot), 'door');
const handleRoot = new THREE.Group();
const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), new THREE.MeshBasicMaterial());
handle.name = 'door_handle_1_2';
handleRoot.add(handle);
assert.equal(classifyWorldKitMesh(handle, handleRoot), 'door-hardware',
  'door handles must not become independent walk-through portals');
const plainDoorGroup = new THREE.Group();
plainDoorGroup.name = 'Door';
const doorDetail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial());
doorDetail.name = 'Cylinder_1';
plainDoorGroup.add(doorDetail);
assert.equal(classifyWorldKitMesh(doorDetail, plainDoorGroup), 'static-visual',
  'unmarked imported door groups should be handled once by aggregate group metadata');

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


assert.equal(Object.keys(WORLD_KIT_ROAD_PACK_PARTS).length, 6, 'all six road pack meshes must have explicit component definitions');
assert.equal(WORLD_KIT_ROAD_PACK_PARTS.Object_12.role, 'road-corner-module');
assert.equal(WORLD_KIT_ROAD_PACK_PARTS.Object_8.role, 'road-straight-module');

assert.equal(Object.keys(WORLD_KIT_SIDEWALK_COMPONENTS).length, 17, 'all imported sidewalk surface pieces must be catalogued');
assert.equal(WORLD_KIT_SIDEWALK_COMPONENTS.SidewalkCornerLarge_SidewalkMat_0.kind, 'corner');
assert.equal(WORLD_KIT_SIDEWALK_COMPONENTS.SidewalkDrivewayLeft_SidewalkMat_0.kind, 'driveway');
assert.equal(WORLD_KIT_SIDEWALK_COMPONENTS.SidewalkBroken_SidewalkMat_0.kind, 'worn-pavement');
assert.ok(!Object.keys(WORLD_KIT_SIDEWALK_COMPONENTS).some(name => /curb/i.test(name)), 'curb strips remain outside pavement surface prefabs');

const sidewalkAssetRoot = new THREE.Group();
const drivewaySurface = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 2), new THREE.MeshBasicMaterial());
drivewaySurface.name = 'SidewalkDrivewayLeft_SidewalkMat_0';
sidewalkAssetRoot.add(drivewaySurface);
annotateWorldKitInstance(sidewalkAssetRoot, { url: 'data/models/assets/roads/sidewalks/scene.gltf' });
assert.equal(drivewaySurface.userData.worldKit.componentId, 'sidewalk-driveway-left');
assert.equal(drivewaySurface.userData.worldKit.componentKind, 'driveway');

const proceduralIds = new Set(WORLD_KIT_PROCEDURAL_RULES.map(rule => rule.id));
for (const required of ['curved-road-surfaces', 'lane-markings', 'collision-proxies']) {
  assert.ok(proceduralIds.has(required), 'missing procedural support rule: ' + required);
}

console.log(
  '[world-kit] PASS: ' + Object.keys(WORLD_KIT_ASSET_DEFINITIONS).length +
  ' registered assets; semantic mesh roles and non-destructive annotation verified.',
);
