import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAssetType,
  classifyComponent,
  localConnection,
  makeComponent,
  buildRoadProfiles,
} from './asset-calibrator.mjs';

const bridgePath = 'data/models/assets/others/modular_bridge__low_poly__game_ready_/scene.gltf';
const roadPackPath = 'data/models/assets/roads/road_pack/scene.gltf';

function mesh(name, dimensions = [20, 0.2, 4], overrides = {}) {
  const boundsMin = overrides.boundsMin || [-10, 0, -2];
  const boundsMax = overrides.boundsMax || [
    boundsMin[0] + dimensions[0],
    boundsMin[1] + dimensions[1],
    boundsMin[2] + dimensions[2],
  ];
  return {
    nodeKey: name + '[0]',
    nodePath: name,
    name,
    dimensions,
    center: dimensions.map((value, i) => (boundsMin[i] + boundsMax[i]) * 0.5),
    boundsMin,
    boundsMax,
  };
}

test('asset type detection keeps bridge and car sources distinct', () => {
  assert.equal(classifyAssetType('/' + bridgePath), 'bridge');
  assert.equal(classifyAssetType('/data/models/cars/test-car/scene.gltf'), 'vehicle');
  assert.equal(classifyAssetType('/data/models/assets/roads/street-road/scene.gltf'), 'road');
});

test('the modular bridge kit resolves its named deck and structure components', () => {
  const deckRole = classifyComponent(mesh('Object_5'), 'bridge', bridgePath);
  const structureRole = classifyComponent(mesh('Object_4'), 'bridge', bridgePath);
  assert.equal(deckRole.role, 'bridge-deck');
  assert.equal(deckRole.sectionId, 'bridge-curve-main');
  assert.equal(structureRole.role, 'bridge-structure');
  assert.equal(structureRole.sectionId, 'bridge-curve-main');

  const deck = makeComponent(mesh('Object_5'), deckRole, 0, 'bridge');
  assert.equal(deck.runtimeEnabled, true);
  assert.equal(deck.requiresReview, false);
});

test('curved and sloped bridge sections never get straight endpoint guesses', () => {
  const item = mesh('deck', [12, 0.2, 4], {
    boundsMin: [0, -2, -2],
    boundsMax: [12, -1.8, 2],
  });
  assert.equal(localConnection(item, 'x', 'curved-span').status, 'review-required');
  assert.equal(localConnection(item, 'x', 'sloped-end-abutment').status, 'review-required');
  const straight = localConnection(item, 'z', 'straight-span');
  assert.equal(straight.status, 'estimated');
  assert.equal(straight.accepted, false);
  assert.equal(straight.requiresReview, true);
  assert.equal(straight.start.elevation, -1.8);
  assert.equal(straight.end.elevation, -1.8);
});

test('known road-pack straight and corner modules get different connection policies', () => {
  const straightRole = classifyComponent(mesh('Object_4'), 'road', roadPackPath);
  const cornerRole = classifyComponent(mesh('Object_12', [4, 0.15, 4]), 'road', roadPackPath);
  const straight = makeComponent(mesh('Object_4'), straightRole, 0, 'road');
  const corner = makeComponent(mesh('Object_12', [4, 0.15, 4]), cornerRole, 1, 'road');
  const profiles = buildRoadProfiles('road', [straight, corner], new Map([
    [straight.nodeKey, mesh('Object_4')],
    [corner.nodeKey, mesh('Object_12', [4, 0.15, 4])],
  ]));

  const straightSurface = profiles.surfaces.find(surface => surface.nodeKey === straight.nodeKey);
  const cornerSurface = profiles.surfaces.find(surface => surface.nodeKey === corner.nodeKey);
  assert.equal(straightSurface.connection.status, 'estimated');
  assert.equal(straightSurface.runtimeEnabled, true);
  assert.equal(cornerSurface.connection.status, 'review-required');
  assert.equal(cornerSurface.sectionKind, 'curved-span');
  assert.equal(cornerSurface.runtimeEnabled, true);
});

test('untrusted geometry remains review-only and does not enter surface physics', () => {
  const candidate = mesh('unnamed_plane', [8, 0.05, 5]);
  const role = classifyComponent(candidate, 'road', 'data/models/assets/roads/incoming/road.glb');
  assert.equal(role.role, 'road-surface-candidate');
  const component = makeComponent(candidate, role, 0, 'road');
  assert.equal(component.requiresReview, true);
  assert.equal(component.runtimeEnabled, false);
});

test('vehicle seat and door candidates require the gameplay anchors runtime consumes', () => {
  const seatItem = mesh('Driver_Seat', [0.6, 0.8, 0.7]);
  const seatRole = classifyComponent(seatItem, 'vehicle', 'data/models/cars/test-car/scene.gltf');
  const seat = makeComponent(seatItem, seatRole, 0, 'vehicle');
  assert.equal(seat.role, 'vehicle-seat');
  assert.equal(seat.interaction.kind, 'vehicle-seat');
  assert.deepEqual(seat.interaction.requiredAnchors, ['occupant', 'entry', 'exit', 'seatFacing']);

  const doorItem = mesh('Front_Door_Panel', [1.1, 1.0, 0.12]);
  const doorRole = classifyComponent(doorItem, 'vehicle', 'data/models/cars/test-car/scene.gltf');
  const door = makeComponent(doorItem, doorRole, 1, 'vehicle');
  assert.equal(door.interaction.kind, 'vehicle-door');
  assert.ok(door.interaction.requiredAnchors.includes('entry'));
  assert.ok(door.interaction.requiredAnchors.includes('exit'));
});

test('NPC seats retain approach, pelvis, facing and exit anchor requirements', () => {
  const chairItem = mesh('Bench_Seat', [1.5, 0.5, 0.5]);
  const chairRole = classifyComponent(chairItem, 'world-prop', 'data/models/assets/others/bench.glb');
  const chair = makeComponent(chairItem, chairRole, 0, 'world-prop');
  assert.equal(chair.interaction.kind, 'seat');
  assert.deepEqual(chair.interaction.requiredAnchors, ['approach', 'pelvis', 'seatFacing', 'exit']);
});


test('known street-road asphalt mesh is detected as an imported driveable surface', () => {
  const streetRoadPath = 'data/models/assets/roads/street_road/scene.gltf';
  const role = classifyComponent(mesh('two_lane_road'), 'road', streetRoadPath);
  const component = makeComponent(mesh('two_lane_road'), role, 0, 'road');
  assert.equal(component.role, 'road-surface');
  assert.equal(component.runtimeEnabled, true);
  assert.equal(component.requiresReview, false);
});
test('unknown road-shaped geometry never gets automatic straight endpoints', () => {
  const item = mesh('unnamed_plane', [8, 0.05, 5]);
  const role = classifyComponent(item, 'road', 'data/models/assets/roads/incoming/road.glb');
  const component = makeComponent(item, role, 0, 'road');
  const profile = buildRoadProfiles('road', [component], new Map([[item.nodeKey, item]]));
  assert.equal(profile.surfaces[0].sectionKind, 'unknown-profile');
  assert.equal(profile.surfaces[0].connection.status, 'review-required');
  assert.equal(profile.surfaces[0].runtimeEnabled, false);
});