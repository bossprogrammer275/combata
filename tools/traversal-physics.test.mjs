import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildObstacleClimbPath,
  buildLadderTraversalPath,
  sampleTimedPath,
  validateTraversalPath,
  normalizeTimedPath,
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
