import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildObstacleClimbPath,
  buildLadderTraversalPath,
  sampleTimedPath,
  validateTraversalPath,
  normalizeTimedPath,
  validateReviewedTraversalProfile,
} from '../js/traversal-physics.js';

const clear = () => true;

test('obstacle climb builds a staged root path from ground contact to a supported top', () => {
  const plan = buildObstacleClimbPath({
    start: [0, 0, 2],
    bounds: { min: [-1, 0, -1], max: [1, 1.25, 1] },
    normal: [0, 0, 1],
    radius: 0.42,
    height: 1.8,
  });
  assert.ok(plan);
  assert.equal(plan.animation, 'obstacle_climb');
  assert.equal(plan.path[0].position.z, 2);
  assert.ok(plan.path.at(-1).position.y >= 1.25);
  assert.equal(plan.path.at(-1).position.y, plan.landing.y);
  assert.equal(validateTraversalPath(plan.path, clear), true);
});

test('obstacle climb rejects thin tops and obstacles beyond the supported climb height', () => {
  assert.equal(buildObstacleClimbPath({
    start: [0, 0, 2],
    bounds: { min: [-1, 0, -0.2], max: [1, 1.2, 0.2] },
    normal: [0, 0, 1],
  }), null);
  assert.equal(buildObstacleClimbPath({
    start: [0, 0, 2],
    bounds: { min: [-1, 0, -1], max: [1, 2.6, 1] },
    normal: [0, 0, 1],
  }), null);
});

test('manual root paths retain authored times and landing anchor', () => {
  const rootPath = [
    { t: 0, position: [0, 0, 2] },
    { t: 0.18, position: [0, 0, 1.55] },
    { t: 0.72, position: [0, 1.4, 1.55] },
    { t: 1, position: [0, 1.25, 0] },
  ];
  const plan = buildObstacleClimbPath({
    start: [0, 0, 2],
    bounds: { min: [-0.2, 0, -0.2], max: [0.2, 1.25, 0.2] },
    normal: [0, 0, 1],
    rootPath,
    landing: [0, 1.25, 0],
  });
  // The authored path can climb a narrow obstacle only when its custom
  // landing route has been measured and independently clearance-tested.
  assert.ok(plan);
  assert.equal(plan.path.length, 4);
  assert.deepEqual(plan.landing, { x: 0, y: 1.25, z: 0 });
});

test('ladder traversal maps rung spacing to the downloaded repeating climb cycle', () => {
  const plan = buildLadderTraversalPath({
    start: [0, 0, 1],
    approach: [0, 0, 1],
    mountBottom: [0, 0.2, 0.55],
    mountTop: [0, 2.8, 0.55],
    climbPath: [[0, 0.2, 0.55], [0, 1, 0.55], [0, 2, 0.55], [0, 3, 0.55]],
    topOut: [0, 3, 0],
    rungSpacing: 0.3,
  });
  assert.ok(plan);
  assert.equal(plan.animation, 'ladder_climb_up');
  assert.ok(plan.duration > 7);
  assert.equal(plan.path[0].t, 0);
  assert.equal(plan.path.at(-1).t, 1);
});

test('timed path rejects unordered/non-normalized anchors and samples endpoints exactly', () => {
  assert.equal(normalizeTimedPath([{ t: 0.1, position: [0, 0, 0] }, { t: 1, position: [0, 1, 0] }]), null);
  const path = normalizeTimedPath([
    { t: 0, position: [0, 0, 0] },
    { t: 1, position: [1, 2, 3] },
  ]);
  assert.ok(path);
  assert.deepEqual(sampleTimedPath(path, 0), { x: 0, y: 0, z: 0 });
  assert.deepEqual(sampleTimedPath(path, 1), { x: 1, y: 2, z: 3 });
});

test('capsule path validation samples the full movement and stops at the first blocked segment', () => {
  const path = [
    { t: 0, position: { x: 0, y: 0, z: 0 } },
    { t: 1, position: { x: 2, y: 0, z: 0 } },
  ];
  assert.equal(validateTraversalPath(path, point => point.x < 1.1, { sampleSpacing: 0.1 }), false);
  assert.equal(validateTraversalPath(path, clear, { sampleSpacing: 0.1 }), true);
});


const limbContacts = [
  { bone: 'LeftHand', t: 0.18, position: [-0.25, 1.35, 0.4] },
  { bone: 'RightHand', t: 0.22, position: [0.25, 1.35, 0.4] },
  { bone: 'LeftFoot', t: 0.72, position: [-0.18, 1.15, -0.2] },
  { bone: 'RightFoot', t: 0.78, position: [0.18, 1.15, -0.2] },
];

test('only manually reviewed obstacle profiles with a full timed limb-contact contract can be enabled', () => {
  const anchors = {
    approach: [0, 0, 2],
    handContact: [0, 1.35, 0.4],
    topOut: [0, 1.37, 0],
    landing: [0, 1.25, 0],
    rootPath: [
      { t: 0, position: [0, 0, 2] },
      { t: 0.2, position: [0, 0, 1.4] },
      { t: 0.7, position: [0, 1.35, 0.4] },
      { t: 1, position: [0, 1.25, 0] },
    ],
    boneContacts: limbContacts,
  };
  const candidate = {
    nodeKey: 'Obstacle[0]', actionCandidate: 'obstacle-climb',
    coordinateSpace: 'component-local', accepted: true, runtimeEnabled: true,
    requiresReview: false, manual: true, anchors,
    animation: { key: 'obstacle_climb', durationSeconds: 3.833 },
    capabilities: { obstacleClimbAnimation: true, vaultAnimation: false, mantleAnimation: false },
  };
  const component = { nodeKey: 'Obstacle[0]', kind: 'obstacle', manual: true, requiresReview: false };
  assert.equal(validateReviewedTraversalProfile(candidate, component), null);
  assert.match(validateReviewedTraversalProfile({ ...candidate, runtimeEnabled: false }, component), /runtime-enabled/);
  assert.match(validateReviewedTraversalProfile({
    ...candidate, anchors: { ...anchors, boneContacts: limbContacts.slice(0, 2) },
  }, component), /hand and foot bone contacts/);
});

test('ladder profiles are upward-only and require rung, mount, dismount and four limb contacts', () => {
  const candidate = {
    nodeKey: 'Ladder[0]', actionCandidate: 'ladder-climb',
    coordinateSpace: 'component-local', accepted: true, runtimeEnabled: true,
    requiresReview: false, manual: true,
    anchors: {
      approach: [0, 0, 1],
      mountBottom: [0, 0, 0.4],
      mountTop: [0, 2.8, 0],
      topOut: [0, 3, -0.35],
      bottomDismount: [0, 0, 0.8],
      planeNormal: [0, 0, 1],
      rungSpacing: 0.28,
      climbPath: [[0, 0.2, 0], [0, 1, 0], [0, 2, 0], [0, 2.8, 0]],
      boneContacts: limbContacts,
    },
    animation: { key: 'ladder_climb_up', cycleSeconds: 0.767 },
    capabilities: { ladderClimbUpAnimation: true, ladderClimbDown: false },
  };
  const component = { nodeKey: 'Ladder[0]', kind: 'ladder', manual: true, requiresReview: false };
  assert.equal(validateReviewedTraversalProfile(candidate, component), null);
  assert.match(validateReviewedTraversalProfile({
    ...candidate, capabilities: { ladderClimbUpAnimation: true, ladderClimbDown: 'experimental-reverse-clip' },
  }, component), /upward ladder climbing/);
});
