import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAssetType,
  classifyComponent,
  isCollisionProxyComponent,
  isDecorativeAssetPath,
  isPlausibleWheelGeometry,
  aggregateVehicleWheelGroups,
  aggregateVehicleDoorPanelCandidates,
  aggregateLadderGroups,
  aggregateNamedAssetSeat,
  isNativeCollisionProxy,
  buildNativeCollisionProxyRecords,
  localConnection,
  makeComponent,
  buildRoadProfiles,
  preserveReviewedCalibration,
} from './asset-calibrator.mjs';
import { hasAnchor, isRuntimeSurfaceRole } from './validate-asset-calibration.mjs';
import { compareCollisionSidecars } from './compare-asset-calibrations.mjs';

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

test('interaction validation accepts two-value door ranges and structured transforms', () => {
  assert.equal(hasAnchor([0, 95]), true);
  assert.equal(hasAnchor([0.4, 1.2, -0.3]), true);
  assert.equal(hasAnchor({ position: [0.4, 1.2, -0.3] }), true);
  assert.equal(hasAnchor({ position: { x: 0.4, y: 1.2, z: -0.3 } }), true);
  assert.equal(hasAnchor([]), false);
});

test('runtime surface allow-list includes trusted imported street-road surfaces', () => {
  assert.equal(isRuntimeSurfaceRole('road-surface'), true);
  assert.equal(isRuntimeSurfaceRole('bridge-deck'), true);
  assert.equal(isRuntimeSurfaceRole('road-straight-module'), true);
  assert.equal(isRuntimeSurfaceRole('road-corner-module'), true);
  assert.equal(isRuntimeSurfaceRole('walkable-surface'), true);
  assert.equal(isRuntimeSurfaceRole('road-surface-candidate'), false);
  assert.equal(isRuntimeSurfaceRole('unclassified'), false);
});


test('collision proxy meshes do not become climbable walls, while semantic doors remain detectable', () => {
  const proxy = mesh('col_wall_01', [2, 1.8, 0.2], { collisionProxy: true });
  const door = mesh('door_front', [1.2, 2.1, 0.12], { collisionProxy: true });
  const doorTrim = mesh('trim_01', [0.2, 0.1, 0.05], {
    collisionProxy: true,
    nodePath: 'building / door_front / trim_01',
  });
  assert.equal(isCollisionProxyComponent(proxy), true);
  assert.equal(classifyComponent(proxy, 'world-prop', 'data/models/assets/buildings/shop.glb'), null);
  assert.equal(isCollisionProxyComponent(door), false);
  assert.equal(classifyComponent(door, 'world-prop', 'data/models/assets/buildings/shop.glb').kind, 'door');
  assert.equal(isCollisionProxyComponent(doorTrim), true);
  assert.equal(classifyComponent(doorTrim, 'world-prop', 'data/models/assets/buildings/shop.glb'), null);
});

test('ordinary trim, seatbelts and structural walls do not become vehicle wheels or traversal obstacles', () => {
  assert.equal(classifyComponent(mesh('trim_01', [0.5, 0.1, 0.1]), 'world-prop', 'data/models/assets/buildings/store.glb'), null);
  assert.equal(classifyComponent(mesh('SeatBelt_Geo', [0.01, 0.008, 0.004]), 'vehicle', 'data/models/cars/car/scene.gltf'), null);
  assert.equal(classifyComponent(mesh('wall_01', [4, 5, 0.2]), 'world-prop', 'data/models/assets/buildings/store.glb').kind, 'wall');
  assert.equal(classifyComponent(mesh('Wheel_FL', [0.3, 0.7, 0.7]), 'vehicle', 'data/models/cars/car/scene.gltf').kind, 'wheel');
});

test('wheel geometry fragments are aggregated into one real vehicle wheel group', () => {
  const parent = 'Root[0]/WheelRoot[0]/Combined3DWheel_3DWheel_front_L_Instance1_Src4[0]';
  const items = [
    {
      ...mesh('polySurface1_Wheel1A', [0.012, 0.007, 0.02]),
      nodeKey: parent + '/polySurface1[0]',
      nodePath: 'Root / WheelRoot / Combined3DWheel_3DWheel_front_L_Instance1_Src4 / polySurface1',
      boundsMin: [-0.01, 0, -0.017], boundsMax: [0.01, 0.007, 0.017],
    },
    {
      ...mesh('polySurface2_Wheel1A', [0.012, 0.007, 0.02]),
      nodeKey: parent + '/polySurface2[0]',
      nodePath: 'Root / WheelRoot / Combined3DWheel_3DWheel_front_L_Instance1_Src4 / polySurface2',
      boundsMin: [-0.0105, 0, -0.017], boundsMax: [0.0105, 0.007, 0.017],
    },
  ];
  assert.equal(isPlausibleWheelGeometry(items[0]), true);
  const groups = aggregateVehicleWheelGroups(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].item.nodeKey, parent);
  assert.equal(groups[0].role.role, 'vehicle-wheel');
});

test('multi-mesh ladders are collapsed into one climbable parent profile', () => {
  const parent = 'Root[0]/Ladder_State_01_0[0]';
  const items = [0, 1, 2].map(index => ({
    ...mesh('Object_' + index, [0.12, 2.2, 0.16]),
    nodeKey: parent + '/Object_' + index + '[' + index + ']',
    nodePath: 'Root / Ladder_State_01_0 / Object_' + index,
  }));
  const groups = aggregateLadderGroups(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].nodeKey, parent);
  assert.equal(groups[0].dimensions[1], 2.2);
  assert.equal(classifyComponent(mesh('Object_4'), 'world-prop', 'data/models/assets/others/stair.glb').kind, 'stairs');
});

test('only real climbable prop roles make traversal candidates; collision proxies and building walls are excluded', () => {
  const fence = classifyComponent(mesh('Fence_Panel_01', [2.1, 1.2, 0.12]), 'world-prop', 'data/models/assets/others/fence.glb');
  const wall = classifyComponent(mesh('wall_01', [4, 5, 0.2]), 'world-prop', 'data/models/assets/buildings/store.glb');
  assert.equal(fence.kind, 'obstacle');
  assert.equal(wall.kind, 'wall');
  const proxy = classifyComponent(mesh('col_wall_01', [2, 1.2, 0.2], { collisionProxy: true }), 'world-prop', 'data/models/assets/others/fence.glb');
  assert.equal(proxy, null);
});


test('an explicitly named plastic chair is aggregated as one review-only seat', () => {
  const items = [
    {
      ...mesh('SeatMesh', [0.4, 0.35, 0.4]),
      nodeKey: 'Root[0]/ChairGroup[0]/SeatMesh[0]',
      nodePath: 'Root / ChairGroup / SeatMesh',
      boundsMin: [-0.3, 0.4, -0.3],
      boundsMax: [0.3, 0.8, 0.3],
    },
    {
      ...mesh('LegMesh', [0.08, 0.45, 0.08]),
      nodeKey: 'Root[0]/ChairGroup[0]/LegMesh[1]',
      nodePath: 'Root / ChairGroup / LegMesh',
      boundsMin: [-0.25, 0, -0.25],
      boundsMax: [0.25, 0.45, 0.25],
    },
    {
      ...mesh('col_wall_01', [0.6, 0.8, 0.6], { collisionProxy: true }),
      nodeKey: 'Root[0]/collision_proxies[1]/col_wall_01[0]',
      nodePath: 'Root / collision_proxies / col_wall_01',
      collisionProxy: true,
    },
  ];
  const result = aggregateNamedAssetSeat(items, 'data/models/assets/others/plastic_chair.glb');
  assert.ok(result);
  assert.equal(result.item.nodeKey, 'Root[0]/ChairGroup[0]');
  assert.equal(result.role.kind, 'seat');
  assert.deepEqual(result.item.dimensions, [0.6, 0.8, 0.6]);
  const component = makeComponent(result.item, result.role, 0, 'world-prop');
  assert.equal(component.interaction.kind, 'seat');
  assert.deepEqual(component.interaction.requiredAnchors, ['approach', 'pelvis', 'seatFacing', 'exit']);
  assert.equal(component.requiresReview, true);
});


test('authored col_* meshes are recorded as native collision authority, not generated duplicate boxes', () => {
  const items = [
    {
      ...mesh('col_wall_01', [2, 2.5, 0.2], { collisionProxy: true }),
      nodeKey: 'Root[0]/collision_proxies[0]/col_wall_01[0]',
      nodePath: 'Root / collision_proxies / col_wall_01',
      collisionProxy: true,
    },
    {
      ...mesh('window_01', [0.8, 0.8, 0.05], { collisionProxy: true }),
      nodeKey: 'Root[0]/window_01[1]',
      nodePath: 'Root / window_01',
      collisionProxy: true,
    },
    {
      ...mesh('wall_01', [4, 3, 0.2]),
      nodeKey: 'Root[0]/wall_01[2]',
      nodePath: 'Root / wall_01',
      collisionProxy: false,
    },
  ];
  assert.equal(isNativeCollisionProxy(items[0]), true);
  assert.equal(isNativeCollisionProxy(items[1]), false);
  assert.equal(isNativeCollisionProxy(items[2]), false);
  const nestedButNotNative = {
    ...mesh('wall_mesh', [2, 2, 0.2], { collisionProxy: false }),
    nodeKey: 'Root[0]/collision_proxies[0]/wall_mesh[0]',
    nodePath: 'Root / collision_proxies / wall_mesh',
    collisionProxy: false,
  };
  assert.equal(isNativeCollisionProxy(nestedButNotNative), false);
  const proxies = buildNativeCollisionProxyRecords(items);
  assert.equal(proxies.length, 1);
  assert.equal(proxies[0].nodeKey, items[0].nodeKey);
  assert.equal(proxies[0].runtimeAuthority, 'world-native-col-proxy');
  assert.deepEqual(proxies[0].bounds.size, [2, 2.5, 0.2]);
});


test('root-level road asset is classified as a road profile, not a generic prop', () => {
  assert.equal(classifyAssetType('data/models/assets/road.glb'), 'road');
});

test('legacy collision comparison reports identical boxes and rejects stale source hashes', () => {
  const legacy = {
    sourceSha256: 'same-source',
    boxes: [
      [0, 1, 0, 2, 2, 2],
      [3, 1, 0, 2, 2, 2],
    ],
  };
  const calibration = {
    source: { sha256: 'same-source' },
    collision: {
      sourceSha256: 'same-source',
      boxes: [
        [0, 1, 0, 2, 2, 2],
        [3, 1, 0, 2, 2, 2],
      ],
      nativeProxyCount: 4,
    },
  };
  const result = compareCollisionSidecars(legacy, calibration);
  assert.equal(result.status, 'matches');
  assert.equal(result.sameSource, true);
  assert.equal(result.legacy.boxCount, 2);
  assert.equal(result.calibrated.boxCount, 2);
  assert.equal(result.calibrated.nativeProxyCount, 4);
  assert.equal(result.difference.maxBoundsDelta, 0);

  const stale = compareCollisionSidecars(legacy, {
    ...calibration,
    source: { sha256: 'different-source' },
    collision: { ...calibration.collision, sourceSha256: 'different-source' },
  });
  assert.equal(stale.status, 'source-hash-mismatch');
  assert.equal(stale.sameSource, false);
});

test('approved interaction, traversal, road and bridge edits survive an unchanged-source rescan', () => {
  const doorKey = 'Root[0]/Door[0]';
  const ladderKey = 'Root[0]/Ladder[0]';
  const deckKey = 'Root[0]/BridgeDeck[0]';
  const doorAnchors = {
    hinge: [0.9, 0.8, 0],
    hingeAxis: [0, 1, 0],
    handle: [0.35, 0.9, 0.2],
    openAngleDeg: 78,
  };
  const approvedRoadConnection = {
    status: 'approved',
    accepted: true,
    requiresReview: false,
    start: { position: [-4, 2, 0], tangent: [1, 0, 0] },
    end: { position: [4, 3, 0], tangent: [1, 0, 0] },
    centreline: [[-4, 2, 0], [0, 2.5, 0], [4, 3, 0]],
  };
  const approvedBridgeConnection = {
    status: 'approved',
    accepted: true,
    requiresReview: false,
    start: { position: [0, 2, -4], tangent: [0, 0, 1] },
    end: { position: [0, 2, 4], tangent: [0, 0, 1] },
  };
  const previousCalibration = {
    source: { sha256: 'unchanged-source' },
    components: [
      {
        nodeKey: doorKey,
        role: 'vehicle-door',
        kind: 'door',
        manual: true,
        runtimeEnabled: true,
        requiresReview: false,
        interaction: {
          kind: 'vehicle-door',
          accepted: true,
          anchors: doorAnchors,
        },
      },
      {
        nodeKey: deckKey,
        role: 'bridge-deck',
        kind: 'driveable-surface',
        runtimeEnabled: true,
        requiresReview: false,
      },
    ],
    traversal: [
      {
        nodeKey: ladderKey,
        accepted: true,
        runtimeEnabled: true,
        requiresReview: false,
        manual: true,
        anchors: { mountBottom: [0, 0, 0], mountTop: [0, 3, 0], rungSpacing: 0.3 },
        animation: { key: 'ladder-climb', loop: true },
        capabilities: { ladderClimbUpAnimation: true, ladderClimbDown: false },
        coordinateSpace: 'component-local',
      },
    ],
    road: {
      surfaces: [{
        nodeKey: deckKey,
        runtimeEnabled: true,
        requiresReview: false,
        connection: approvedRoadConnection,
      }],
    },
    bridge: {
      sections: [
        { id: 'bridge-main', connection: approvedBridgeConnection },
        { id: 'bridge-abutment', connection: approvedBridgeConnection },
      ],
    },
  };

  const components = [
    {
      nodeKey: doorKey,
      role: 'unclassified',
      kind: 'unknown',
      manual: false,
      runtimeEnabled: false,
      requiresReview: true,
      interaction: { kind: 'vehicle-door', accepted: false },
    },
    {
      nodeKey: deckKey,
      role: 'bridge-deck',
      kind: 'driveable-surface',
      runtimeEnabled: false,
      requiresReview: true,
    },
  ];
  const traversal = [{
    nodeKey: ladderKey,
    accepted: false,
    runtimeEnabled: false,
    requiresReview: true,
    manual: false,
    anchors: {},
    animation: null,
    capabilities: {},
    coordinateSpace: 'component-local',
  }];
  const road = {
    surfaces: [{
      nodeKey: deckKey,
      runtimeEnabled: false,
      requiresReview: true,
      connection: { status: 'estimated', accepted: false, requiresReview: true },
    }],
  };
  const bridge = {
    requiresReview: true,
    sections: [
      {
        id: 'bridge-main',
        deckComponent: { nodeKey: deckKey },
        connection: { status: 'estimated', accepted: false, requiresReview: true },
        requiresReview: true,
      },
      {
        id: 'bridge-abutment',
        connection: { status: 'estimated', accepted: false, requiresReview: true },
        requiresReview: true,
      },
    ],
  };

  assert.equal(preserveReviewedCalibration({
    sourceHash: 'unchanged-source',
    previousCalibration,
    components,
    traversal,
    road,
    bridge,
  }), true);

  assert.equal(components[0].manual, true);
  assert.equal(components[0].runtimeEnabled, true);
  assert.equal(components[0].requiresReview, false);
  assert.deepEqual(components[0].interaction.anchors, doorAnchors);
  assert.equal(traversal[0].accepted, true);
  assert.equal(traversal[0].runtimeEnabled, true);
  assert.deepEqual(traversal[0].anchors, previousCalibration.traversal[0].anchors);
  assert.deepEqual(traversal[0].animation, previousCalibration.traversal[0].animation);
  assert.equal(road.surfaces[0].runtimeEnabled, true);
  assert.deepEqual(road.surfaces[0].connection, approvedRoadConnection);
  assert.equal(components[1].runtimeEnabled, true);
  assert.equal(components[1].requiresReview, false);
  assert.deepEqual(bridge.sections[0].connection, approvedRoadConnection);
  assert.deepEqual(bridge.sections[1].connection, approvedBridgeConnection);
  assert.equal(bridge.requiresReview, false);
});

test('a changed source hash discards all old approvals and leaves new geometry review-only', () => {
  const previousCalibration = {
    source: { sha256: 'old-source' },
    components: [{
      nodeKey: 'Root[0]/Door[0]',
      manual: true,
      runtimeEnabled: true,
      requiresReview: false,
      interaction: { kind: 'vehicle-door', accepted: true, anchors: { hinge: [1, 0, 0] } },
    }],
    traversal: [{
      nodeKey: 'Root[0]/Ladder[0]',
      accepted: true,
      runtimeEnabled: true,
      requiresReview: false,
      manual: true,
      anchors: { mountBottom: [0, 0, 0] },
    }],
    road: { surfaces: [{
      nodeKey: 'Root[0]/Deck[0]',
      runtimeEnabled: true,
      requiresReview: false,
      connection: { accepted: true, requiresReview: false },
    }] },
    bridge: { sections: [{ id: 'main', connection: { accepted: true, requiresReview: false } }] },
  };
  const components = [{
    nodeKey: 'Root[0]/Door[0]',
    role: 'door-panel',
    kind: 'door',
    manual: false,
    runtimeEnabled: false,
    requiresReview: true,
  }];
  const traversal = [{
    nodeKey: 'Root[0]/Ladder[0]',
    accepted: false,
    runtimeEnabled: false,
    requiresReview: true,
    manual: false,
    anchors: {},
  }];
  const road = { surfaces: [{
    nodeKey: 'Root[0]/Deck[0]',
    runtimeEnabled: false,
    requiresReview: true,
    connection: { accepted: false, requiresReview: true },
  }] };
  const bridge = {
    requiresReview: true,
    sections: [{ id: 'main', requiresReview: true, connection: { accepted: false, requiresReview: true } }],
  };

  assert.equal(preserveReviewedCalibration({
    sourceHash: 'new-source',
    previousCalibration,
    components,
    traversal,
    road,
    bridge,
  }), false);

  assert.equal(components[0].manual, false);
  assert.equal(components[0].runtimeEnabled, false);
  assert.equal(components[0].requiresReview, true);
  assert.equal(components[0].interaction, undefined);
  assert.equal(traversal[0].accepted, false);
  assert.equal(traversal[0].runtimeEnabled, false);
  assert.equal(road.surfaces[0].runtimeEnabled, false);
  assert.equal(road.surfaces[0].connection.accepted, false);
  assert.equal(bridge.sections[0].connection.accepted, false);
});


test('visual-only vegetation is excluded from gameplay calibration but tree assets remain physical', () => {
  for (const asset of [
    'data/models/assets/others/low_poly_shrub.glb',
    'data/models/assets/others/real_bush.glb',
    'data/models/assets/others/hedge.glb',
    'data/models/assets/others/grass_patch.glb',
    'data/models/assets/vegetation/fern/scene.gltf',
    'data/models/assets/plants/flowers/scene.gltf',
  ]) assert.equal(isDecorativeAssetPath(asset), true, asset);
  assert.equal(isDecorativeAssetPath('data/models/assets/others/palm_tree.glb'), false);
  assert.equal(isDecorativeAssetPath('data/models/cars/test-car/scene.gltf'), false);
});
test('CamelCase vehicle doors are semantic candidates but not fixed colliders', () => {
  const item = mesh('FrontLeftDoorPanel', [1.1, 1, 0.12], { collisionProxy: true });
  assert.equal(isCollisionProxyComponent(item), false);
  const role = classifyComponent(item, 'vehicle', 'data/models/cars/test-car/scene.gltf');
  assert.equal(role.kind, 'door');
  assert.equal(role.role, 'door-panel');
});

test('anonymous side-panel geometry is detected with an offset asset origin; wheels and body meshes are rejected', () => {
  const width = 2.0096, height = 1.7223, length = 5.2454;
  const boundsMin = [-1.0188, -0.0220, -12.6305];
  const boundsMax = [0.9908, 1.7003, -7.3852];
  const makePanel = (name, x, localZ) => mesh(name, [0.191, 0.852, 1.077], {
    boundsMin: [x - 0.0955, 0.5, -10.0079 + localZ - 0.5385],
    boundsMax: [x + 0.0955, 1.352, -10.0079 + localZ + 0.5385],
  });
  const items = [
    makePanel('Anonymous_Left_Front_Panel', -0.916, 0.805),
    makePanel('Anonymous_Right_Front_Panel', 0.916, 0.805),
    makePanel('Anonymous_Left_Rear_Panel', -0.87, -0.275),
    makePanel('Anonymous_Right_Rear_Panel', 0.87, -0.275),
    mesh('Wheel_FL', [0.30, 0.66, 0.66], {
      boundsMin: [0.65, 0.0, -8.97],
      boundsMax: [0.95, 0.66, -8.31],
    }),
    mesh('Combined_Car_Body', [width, height, length], {
      boundsMin, boundsMax,
    }),
  ];
  const candidates = aggregateVehicleDoorPanelCandidates(items, {
    dimensions: [width, height, length], boundsMin, boundsMax,
  });
  assert.equal(candidates.length, 4);
  assert.deepEqual(candidates.map(item => item.side).sort(), [
    'left-side','left-side','right-side','right-side',
  ]);
  assert.ok(candidates.every(item => item.accepted === false && item.requiresReview));
  assert.ok(candidates.every(item => item.hingeCandidates.length === 2));
});
test('a single combined vehicle body does not become a false door candidate', () => {
  const body = mesh('Lamborghini_Aventador_Body', [2.2, 1.13, 4.7], {
    boundsMin: [-1.1, 0, -7.35],
    boundsMax: [1.1, 1.13, -2.65],
  });
  assert.equal(aggregateVehicleDoorPanelCandidates([body], {
    dimensions: [2.2, 1.13, 4.7],
    boundsMin: [-1.1, 0, -7.35],
    boundsMax: [1.1, 1.13, -2.65],
  }).length, 0);
});
