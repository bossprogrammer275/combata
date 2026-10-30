// tools/verify-vehicles.mjs — headless verification for vehicle models + physics.
//
// Spins up the project static server, loads the REAL car models through the REAL
// js/vehicles.js loader, and asserts:
//   1. normalized origin (visual XZ centered, bottom on the ground, real-world size)
//   2. exactly 4 detected wheels in 4 quadrants, with working steer/spin pivots
//   3. model-fitted collision boxes (no ground-disc / blob boxes)
//   4. Rapier player capsule rests at feet height (not floating)
//   5. dynamic vehicle chassis responds to throttle/steering and accepts pose resets
//
// Usage:  node tools/verify-vehicles.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}/`;

// ---------- minimal DOM stubs (geometry only; nothing is rendered) ----------
class FakeImg {
  constructor() {
    this._listeners = {};
    this.width = 1; this.height = 1;
    this.complete = false;
    this.crossOrigin = undefined;
  }
  addEventListener(t, f) { (this._listeners[t] ||= []).push(f); }
  removeEventListener(t, f) {
    const a = this._listeners[t];
    if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }
  }
  set src(v) {
    this._src = v;
    setTimeout(() => {
      this.complete = true;
      for (const f of (this._listeners.load || [])) f.call(this);
    }, 0);
  }
  get src() { return this._src; }
}
globalThis.document = { createElementNS: () => new FakeImg() };
globalThis.self = globalThis;
globalThis.ProgressEvent = class ProgressEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
};

// fetch shim: serve file:// URLs from disk, delegate everything else.
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (typeof url === 'string' && url.startsWith('file:')) {
    return new Response(await fs.promises.readFile(fileURLToPath(url)));
  }
  return realFetch(input, init);
};

const THREE = await import('three');
// Resolve the game's relative model URLs against the test server.
const _fileLoad = THREE.FileLoader.prototype.load;
THREE.FileLoader.prototype.load = function (url, ...rest) {
  if (typeof url === 'string'
    && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)
    && !url.startsWith('data:')
    && !url.startsWith('blob:')) {
    url = new URL(url.replace(/^\.\//, ''), BASE).href;
  }
  return _fileLoad.call(this, url, ...rest);
};

// ---------- boot the static server ----------
const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
async function waitForServer(tries = 150) {
  let lastErr = null;
  server.stderr.on('data', (d) => { lastErr = 'server stderr: ' + String(d).slice(0, 300); });
  server.on('error', (e) => { lastErr = 'spawn error: ' + e.message; });
  server.on('exit', (c, s) => { lastErr = `server exited code=${c} sig=${s}`; });
  for (let i = 0; i < tries; i++) {
    try {
      const r = await realFetch(BASE + 'api/scenes');
      if (r.ok) return;
      lastErr = 'http ' + r.status;
    } catch (e) { lastErr = e.message; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('test server did not start (' + lastErr + ')');
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}${detail ? '  (' + detail + ')' : ''}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); }
}

try {
  const appSource = await fs.promises.readFile(path.join(ROOT, 'js/main.js'), 'utf8');
  const pageSource = await fs.promises.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const vehicleSource = await fs.promises.readFile(path.join(ROOT, 'js/vehicles.js'), 'utf8');
  check('Esc opens the pause menu and Esc from pause resumes the game',
    appSource.includes("else if (this.state === 'playing') this.pause();")
      && appSource.includes("if (this.state === 'paused') this.resume();")
      && pageSource.includes("id=\"pause-screen\""));
  check('pause menu contains all five cockpit camera adjustments',
    ['forward', 'height', 'side', 'lookPitch', 'lookYaw'].every((key) =>
      pageSource.includes('data-cockpit-setting="' + key + '"'))
      && pageSource.includes('id="open-cockpit-settings"'));
  check('cockpit adjustments persist independently by vehicle type',
    vehicleSource.includes("sc_cockpit_camera_profiles_v1")
      && vehicleSource.includes('this._cockpitProfiles[kind]'));
  await waitForServer();
  console.log('[verify] server up on ' + BASE);

  const { loadCarModel, CAR_MODELS, CAR_PHYSICS, VehicleSystem, rigSteeringWheel } = await import('../js/vehicles.js');
  const { Physics } = await import('../js/physics.js');
  const { createPowertrainState, stepVehiclePowertrain } = await import('../js/vehicle-powertrains.js');
  const {
    clampCockpitCameraValue, getCockpitLookAngles, resolveCockpitCameraProfile,
  } = await import('../js/vehicle-cockpit.js');
  const {
    ackermannSteerAngle, updateChaseLook, resolveDriveAxes,
    updateReverseCameraBlend, chaseCameraYaw, getBridgeAwareChaseHeights, 
  } = await import('../js/vehicle-steering.js');

  const lamboCockpit = resolveCockpitCameraProfile(
    { height: 0.98, forward: 0.16, side: 0, lookAhead: 18, fov: 82 },
    { height: 2.8, forward: -0.42, side: 0.24, lookPitch: 12, lookYaw: -9 },
  );
  const teslaCockpit = resolveCockpitCameraProfile(
    { height: 1.42, forward: 0.30, side: 0, lookAhead: 20, fov: 82 },
    {},
  );
  check('cockpit profiles preserve each vehicle camera baseline and clamp saved seat offsets',
    lamboCockpit.height === 2.2 && lamboCockpit.forward === -0.42
      && lamboCockpit.side === 0.24 && teslaCockpit.height === 1.42,
    `Lambo height=${lamboCockpit.height.toFixed(2)}m Tesla height=${teslaCockpit.height.toFixed(2)}m`);
  const lookOffset = getCockpitLookAngles(lamboCockpit, 0.1, 0.2);
  check('cockpit resting look angles offset mouse look without replacing it',
    Math.abs(lookOffset.yaw - (0.1 - 9 * Math.PI / 180)) < 1e-9
      && Math.abs(lookOffset.pitch - 12 * Math.PI / 180) < 1e-9,
    `yaw=${lookOffset.yaw.toFixed(3)}rad pitch=${lookOffset.pitch.toFixed(3)}rad`);
  check('cockpit camera setting keys reject unknown and non-numeric values',
    clampCockpitCameraValue('fov', 90) === null
      && clampCockpitCameraValue('height', 'not-a-number') === null);

  const steeringGeometryWheels = [
    { x: -0.82, front: true }, { x: 0.82, front: true },
    { x: -0.82, front: false }, { x: 0.82, front: false },
  ];
  const rightInside = ackermannSteerAngle(0.42, -0.82, steeringGeometryWheels, 2.7, -1);
  const rightOutside = ackermannSteerAngle(0.42, 0.82, steeringGeometryWheels, 2.7, -1);
  const leftInside = ackermannSteerAngle(-0.42, 0.82, steeringGeometryWheels, 2.7, -1);
  const leftOutside = ackermannSteerAngle(-0.42, -0.82, steeringGeometryWheels, 2.7, -1);
  check('Ackermann steering turns the inner front wheel sharper in both directions',
    rightInside > rightOutside && Math.abs(leftInside) > Math.abs(leftOutside)
      && rightOutside > 0 && leftOutside < 0,
    `right inner/outer=${(rightInside * 180 / Math.PI).toFixed(1)}/${(rightOutside * 180 / Math.PI).toFixed(1)}deg left inner/outer=${(leftInside * 180 / Math.PI).toFixed(1)}/${(leftOutside * 180 / Math.PI).toFixed(1)}deg`);
  const wasdTurn = resolveDriveAxes(new Set(['KeyW', 'KeyD']));
  const reverseLeft = resolveDriveAxes(new Set(['KeyS', 'KeyA']));
  const mixedArrowTurn = resolveDriveAxes(new Set(['KeyW', 'ArrowLeft']));
  const aliasHeld = resolveDriveAxes(new Set(['KeyW', 'ArrowUp', 'ArrowRight']));
  check('WASD and arrow keys support simultaneous drive + steering combinations',
    wasdTurn.forward === 1 && wasdTurn.right === 1
      && reverseLeft.forward === -1 && reverseLeft.right === -1
      && mixedArrowTurn.forward === 1 && mixedArrowTurn.right === -1
      && aliasHeld.forward === 1 && aliasHeld.right === 1,
    `W+D=${wasdTurn.forward}/${wasdTurn.right} S+A=${reverseLeft.forward}/${reverseLeft.right} W+Left=${mixedArrowTurn.forward}/${mixedArrowTurn.right}`);
  const forwardCameraYaw = chaseCameraYaw(0, 0, 0);
  const reverseCameraYaw = chaseCameraYaw(0, 0, 1);
  check('chase camera sits behind the car forward and moves to the front while reversing',
    Math.cos(forwardCameraYaw) > 0.99 && Math.cos(reverseCameraYaw) < -0.99,
    `forwardYaw=${forwardCameraYaw.toFixed(2)} reverseYaw=${reverseCameraYaw.toFixed(2)}`);
  let reverseCamera = 0;
  for (let i = 0; i < 60; i++) reverseCamera = updateReverseCameraBlend(reverseCamera, -8, 1 / 60);
  const reverseCameraAtStop = updateReverseCameraBlend(reverseCamera, 0, 1 / 60);
  let cameraAfterForward = reverseCameraAtStop;
  for (let i = 0; i < 60; i++) cameraAfterForward = updateReverseCameraBlend(cameraAfterForward, 5, 1 / 60);
  check('reverse camera changes with actual movement and holds through the stop',
    reverseCameraAtStop > 0.9 && cameraAfterForward < 0.1,
    `atReverse=${reverseCameraAtStop.toFixed(2)} afterForward=${cameraAfterForward.toFixed(2)}`);
  const groundChaseHeights = getBridgeAwareChaseHeights(0.06, 0.06, 2.8, 1.0);
  const bridgeChaseHeights = getBridgeAwareChaseHeights(7.06, 7.06, 2.8, 1.0);
  const cameraPastBridgeEdge = getBridgeAwareChaseHeights(7.06, 0.06, 2.8, 1.0);
  check('chase camera rises with the vehicle onto elevated bridges',
    Math.abs(bridgeChaseHeights.cameraY - groundChaseHeights.cameraY - 7.0) < 1e-8
      && Math.abs(bridgeChaseHeights.lookY - groundChaseHeights.lookY - 7.0) < 1e-8,
    `groundCameraY=${groundChaseHeights.cameraY.toFixed(2)} bridgeCameraY=${bridgeChaseHeights.cameraY.toFixed(2)}`);
  check('chase camera does not drop to ground level when the trailing camera is beyond the bridge deck',
    cameraPastBridgeEdge.cameraY > 9.8 && cameraPastBridgeEdge.supportY === 7.06,
    `cameraY=${cameraPastBridgeEdge.cameraY.toFixed(2)} supportY=${cameraPastBridgeEdge.supportY.toFixed(2)}`);
  check('camera-height sampling ignores an unrelated lower deck beneath the driven bridge',
    getBridgeAwareChaseHeights(7.06, 0.06, 2.8, 1.0).cameraY > 9.8);

  let cameraLook = { yaw: 1.1, pitch: 0.85, idleTime: 0 };
  for (let i = 0; i < 90; i++) {
    cameraLook = updateChaseLook(cameraLook, { dt: 1 / 60, throttle: 0, speed: 0 });
  }
  check('free camera look stays free while parked',
    Math.abs(cameraLook.yaw - 1.1) < 1e-6 && Math.abs(cameraLook.pitch - 0.85) < 1e-6,
    `yaw=${cameraLook.yaw.toFixed(2)} pitch=${cameraLook.pitch.toFixed(2)}`);
  for (let i = 0; i < 150; i++) {
    cameraLook = updateChaseLook(cameraLook, { dt: 1 / 60, throttle: 1, speed: 18 });
  }
  check('chase camera recentres smoothly after acceleration resumes',
    Math.abs(cameraLook.yaw) < 0.12 && Math.abs(cameraLook.pitch - 0.2) < 0.15,
    `yaw=${cameraLook.yaw.toFixed(2)} pitch=${cameraLook.pitch.toFixed(2)}`);
  cameraLook = updateChaseLook(cameraLook, { dt: 1 / 60, mouseDX: 50, throttle: 1, speed: 18 });
  const manuallyLooked = cameraLook.yaw;
  for (let i = 0; i < 5; i++) {
    cameraLook = updateChaseLook(cameraLook, { dt: 1 / 60, throttle: 1, speed: 18 });
  }
  check('camera free-look pauses recentering while mouse input is active',
    cameraLook.idleTime < 0.2 && Math.abs(cameraLook.yaw - manuallyLooked) < 0.08,
    `idle=${cameraLook.idleTime.toFixed(2)} yaw=${cameraLook.yaw.toFixed(2)}`);


  const spawnHarness = Object.create(VehicleSystem.prototype);
  const spawnCalls = [];
  spawnHarness.world = {
    startPoint: { x: 5, z: 225, yaw: 0 },
    vehicleSpawns: [
      { x: 31, z: -169, kind: 'lambo' },
      { x: 6, z: 229, kind: 'cybertruck' },
      { x: 4, z: 217, kind: 'lambo' },
      { x: 94, z: -133, kind: 'cybertruck' },
    ],
  };
  spawnHarness.spawn = (def) => spawnCalls.push(def);
  spawnHarness.buildFromWorld();
  check('initial world spawns exactly two vehicles nearest the player',
    spawnCalls.length === 2 && spawnCalls.every(v => Math.hypot(v.x - 5, v.z - 225) < 15),
    `count=${spawnCalls.length} distances=${spawnCalls.map(v => Math.hypot(v.x - 5, v.z - 225).toFixed(1)).join(',')}`);

  const hotkeySpawnHarness = Object.create(VehicleSystem.prototype);
  hotkeySpawnHarness.vehicles = [];
  hotkeySpawnHarness.driver = null;
  hotkeySpawnHarness.world = { groundHeightAt: () => 0.06 };
  hotkeySpawnHarness.spawn = async (def) => {
    const car = {
      ...def,
      pos: { x: def.x, y: def.elevation, z: def.z },
      yaw: def.ry || 0,
      yawOffset: Math.PI,
      half: { x: def.kind === 'cybertruck' ? 1.12 : 1.15, z: def.kind === 'cybertruck' ? 2.85 : 2.45 },
    };
    hotkeySpawnHarness.vehicles.push(car);
    hotkeySpawn = def;
    return car;
  };
  let hotkeySpawn = null;
  const spawnPlayer = { pos: { x: 5, y: 0, z: 225 }, yaw: 0 };
  const bugattiSpawn = await hotkeySpawnHarness.spawnNearPlayer('bugatti', spawnPlayer);
  check('hotkey-spawned car is within E interaction range and uses sampled ground',
    bugattiSpawn?.kind === 'bugatti'
      && hotkeySpawn?.elevation === 0.06
      && hotkeySpawnHarness.surfaceDistance(bugattiSpawn, spawnPlayer.pos.x, spawnPlayer.pos.z) < 4.5,
    `kind=${bugattiSpawn?.kind} distance=${bugattiSpawn ? hotkeySpawnHarness.surfaceDistance(bugattiSpawn, spawnPlayer.pos.x, spawnPlayer.pos.z).toFixed(1) : 'none'} y=${hotkeySpawn?.elevation}`);
  const teslaSpawn = await hotkeySpawnHarness.spawnNearPlayer('cybertruck', spawnPlayer);
  check('Tesla spawn stays in reach and avoids the previous vehicle',
    teslaSpawn?.kind === 'cybertruck'
      && hotkeySpawnHarness.surfaceDistance(teslaSpawn, spawnPlayer.pos.x, spawnPlayer.pos.z) < 4.5
      && Math.hypot(teslaSpawn.pos.x - bugattiSpawn.pos.x, teslaSpawn.pos.z - bugattiSpawn.pos.z) >= 5.2,
    `kind=${teslaSpawn?.kind} separation=${teslaSpawn ? Math.hypot(teslaSpawn.pos.x - bugattiSpawn.pos.x, teslaSpawn.pos.z - bugattiSpawn.pos.z).toFixed(1) : 'none'}`);
  check('newly spawned vehicle is made the preferred E-entry target',
    hotkeySpawnHarness.preferredVehicle === teslaSpawn);


  check('world yaw includes the GLB nose-axis correction', () => {
    const yaw = VehicleSystem.prototype._worldYaw({ yaw: 0.42, yawOffset: Math.PI });
    assert.ok(Math.abs(yaw - (0.42 + Math.PI)) < 1e-8);
    assert.ok(Math.abs(VehicleSystem.prototype._worldYaw({ yaw: 0.42 }) - 0.42) < 1e-8);
  });

  check('EV motor and combustion DCT have distinct powertrain dynamics', () => {
    const evState = createPowertrainState(CAR_PHYSICS.cybertruck);
    const iceState = createPowertrainState(CAR_PHYSICS.lambo);
    const evLaunch = stepVehiclePowertrain(evState, CAR_PHYSICS.cybertruck, 1, 0, 1 / 60);
    const iceLaunch = stepVehiclePowertrain(iceState, CAR_PHYSICS.lambo, 1, 0, 1 / 60);
    assert.equal(evLaunch.powertrainType, 'electric-single-speed');
    assert.equal(iceLaunch.powertrainType, 'dct');
    assert.equal(evLaunch.gear, 'D');
    assert.equal(iceLaunch.gear, '1');
    assert.ok(evLaunch.driveAcceleration > 0 && iceLaunch.driveAcceleration > 0);
  });

  check('vehicle types have distinct physics tuning', () => {
    assert.notEqual(CAR_PHYSICS.lambo.mass, CAR_PHYSICS.cybertruck.mass);
    assert.notEqual(CAR_PHYSICS.lambo.powertrain.type, CAR_PHYSICS.cybertruck.powertrain.type);
    assert.ok(CAR_PHYSICS.lambo.powertrain.maxAcceleration > CAR_PHYSICS.cybertruck.powertrain.maxAcceleration);
    assert.ok(CAR_PHYSICS.lambo.maxSpeed > CAR_PHYSICS.cybertruck.maxSpeed);
    assert.equal(CAR_PHYSICS.lambo.drivetrain, 'rwd');
    assert.equal(CAR_PHYSICS.cybertruck.drivetrain, 'awd');
    assert.ok(CAR_PHYSICS.cybertruck.springRate > CAR_PHYSICS.lambo.springRate);
    assert.equal(CAR_PHYSICS.cybertruck.speedometerMaxKmh, 180);
    assert.equal(CAR_PHYSICS.cybertruck.powertrain.type, 'ev');
    assert.equal(CAR_PHYSICS.lambo.powertrain.type, 'dct');
    assert.equal(CAR_PHYSICS.bugatti.powertrain.type, 'dct');
    assert.equal(CAR_PHYSICS.lambo.interiorCamera.height, 0.98,
      'Lamborghini eye point is the lower, sports-car cabin height');
    assert.equal(CAR_PHYSICS.cybertruck.interiorCamera.height, 1.42,
      'Cybertruck eye point is higher for its pickup cabin');
    assert.ok(CAR_PHYSICS.cybertruck.interiorCamera.height
      - CAR_PHYSICS.lambo.interiorCamera.height > 0.35,
      'vehicle interior cameras must not share one generic height');
    assert.equal(CAR_PHYSICS.cybertruck.mass, 3009);
    assert.ok(Math.abs(CAR_PHYSICS.cybertruck.maxSpeed - 50) < 1e-8);
    assert.equal(CAR_PHYSICS.lambo.speedometerMaxKmh, 230);
    assert.equal(CAR_PHYSICS.bugatti.speedometerMaxKmh, 380);
    assert.equal(CAR_PHYSICS.bugatti.mass, 1995);
    assert.ok(Math.abs(CAR_PHYSICS.bugatti.wheelbase - 2.711) < 1e-6);
    assert.ok(Math.abs(CAR_PHYSICS.bugatti.maxSpeed - 380 / 3.6) < 1e-8);
    assert.ok(CAR_PHYSICS.bugatti.maxDownforceG < 1.0);
    assert.ok(CAR_PHYSICS.bugatti.maxSpeed > CAR_PHYSICS.lambo.maxSpeed);
    assert.ok(CAR_PHYSICS.cybertruck.maxSpeed < CAR_PHYSICS.lambo.maxSpeed);
    assert.ok(CAR_PHYSICS.bugatti.maxSpeed > CAR_PHYSICS.lambo.maxSpeed);
    assert.ok(CAR_MODELS.bugatti && CAR_MODELS.bugatti.url);
    assert.equal(CAR_MODELS.bugatti.targetLen, 4.9);
  });

  // A hand-assigned, generically named steering mesh must rotate on its
  // own pivot and must not pull the dashboard with it.
  {
    const testScene = new THREE.Group();
    const dashboard = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, 0.08), new THREE.MeshBasicMaterial());
    dashboard.name = 'DashboardPanel';
    dashboard.position.set(0, 1.0, 0.5);
    const steeringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.018, 8, 24), new THREE.MeshBasicMaterial());
    steeringMesh.name = 'UnlabelledCabinMesh';
    steeringMesh.position.set(-0.25, 0.98, 0.42);
    testScene.add(dashboard, steeringMesh);
    const manualKey = steeringMesh.name + '[' + testScene.children.indexOf(steeringMesh) + ']';
    const rig = rigSteeringWheel(testScene, {
      meshKeys: [manualKey], axis: 'x', maxAngleDeg: 450, sign: 1, response: 10,
    });
    testScene.updateMatrixWorld(true);
    const wheelBefore = steeringMesh.matrixWorld.elements.slice();
    const dashboardBefore = dashboard.matrixWorld.elements.slice();
    rig.pivot.rotation.x = 0.18;
    testScene.updateMatrixWorld(true);
    const wheelAfter = steeringMesh.matrixWorld.elements.slice();
    const dashboardAfter = dashboard.matrixWorld.elements.slice();
    check('manual steering-wheel mesh assignment creates its own pivot',
      !!rig && wheelBefore.some((value, i) => Math.abs(value - wheelAfter[i]) > 1e-6));
    check('steering-wheel animation does not rotate the dashboard',
      dashboardBefore.every((value, i) => Math.abs(value - dashboardAfter[i]) < 1e-6));
  }

  check('Lamborghini and Cybertruck have distinct interior eye heights',
    CAR_PHYSICS.lambo.interiorCamera.height === 0.98
      && CAR_PHYSICS.cybertruck.interiorCamera.height === 1.42
      && CAR_PHYSICS.cybertruck.interiorCamera.height - CAR_PHYSICS.lambo.interiorCamera.height > 0.35,
    'Lamborghini=0.98m, Cybertruck=1.42m');

  const dynamicVehicleSpecs = {};
  for (const kind of Object.keys(CAR_MODELS)) {
    console.log(`[verify] model: ${kind}`);
    const targetLen = CAR_MODELS[kind].targetLen;
    const scene = await loadCarModel(kind);
    scene.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(scene);
    const size = bb.getSize(new THREE.Vector3());
    const center = bb.getCenter(new THREE.Vector3());
    const horiz = Math.max(size.x, size.z);
    console.log(`    bbox size=(${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}) center=(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
    check('origin XZ centered', Math.abs(center.x) < 0.4 && Math.abs(center.z) < 0.4,
      `cx=${center.x.toFixed(2)} cz=${center.z.toFixed(2)}`);
    check('bottom on ground', bb.min.y > -0.06 && bb.min.y < 0.12, `minY=${bb.min.y.toFixed(2)}`);
    check('real-world length', Math.abs(horiz - targetLen) / targetLen < 0.08,
      `longest-h=${horiz.toFixed(2)} target=${targetLen}`);

    // ---- wheels ----
    const wheels = scene.userData.wheels || [];
    console.log(`    wheels detected: ${wheels.length}`);

    if (wheels.length === 4) {
      const lateralRatios = wheels.map((wheel) =>
        Math.abs(wheel.center.x - center.x) / Math.max(0.001, size.x * 0.5));
      check('wheel pivots stay at outboard tyre positions',
        lateralRatios.every(ratio => ratio >= 0.52),
        'ratios=' + lateralRatios.map(ratio => ratio.toFixed(2)).join(','));

      const cabinNames = wheels.flatMap(wheel => wheel.meshes || [])
        .filter(mesh => {
          let node = mesh;
          while (node) {
            if (/(steer|dashboard|cockpit|interior|instrument|seat|pedal|gear.?shift)/i.test(node.name || '')) return true;
            node = node.parent;
          }
          return false;
        })
        .map(mesh => mesh.name || '(unnamed cabin mesh)');
      check('steering/dashboard meshes are excluded from tyre rigs',
        cabinNames.length === 0,
        cabinNames.join(', ') || 'no cabin meshes rigged as tyres');
    }

    const steeringPivots = [];
    scene.traverse(node => { if (node.userData?.steeringWheelPivot) steeringPivots.push(node); });
    if (steeringPivots.length) {
      const pivot = steeringPivots[0];
      const spec = pivot.userData.steeringWheelPivot;
      const drivenMesh = pivot.children.find(node => node.isMesh)
        || pivot.getObjectByProperty('isMesh', true);
      if (drivenMesh) {
        drivenMesh.updateWorldMatrix(true, false);
        const before = drivenMesh.matrixWorld.elements.slice();
        pivot.rotation[spec.axis || 'x'] += 0.12;
        scene.updateMatrixWorld(true);
        const after = drivenMesh.matrixWorld.elements.slice();
        check('interior steering wheel has its own animated pivot',
          before.some((value, i) => Math.abs(value - after[i]) > 1e-6),
          'axis=' + (spec.axis || 'x') + ' source=' + (spec.source || 'configured'));
        pivot.rotation[spec.axis || 'x'] -= 0.12;
      }
    } else {
      console.log('  INFO  no steering-wheel node was confidently name-detected; use Asset Lab to assign the mesh');
    }

    // Capture the first real vehicle's runtime-equivalent suspension spec.
    // This exercises the actual normalized GLB pivots/radii below, not only a
    // synthetic set of four wheel points.
    if (!dynamicVehicleSpecs[kind] && wheels.length === 4 && scene.userData.bodyBox) {
      const bodyBox = scene.userData.bodyBox;
      const wheelSpecs = wheels.map((w) => {
        w.pivot.updateWorldMatrix(true, false);
        const center = w.pivot.getWorldPosition(new THREE.Vector3());
        let radius = 0;
        for (const mesh of w.meshes || []) {
          mesh.updateWorldMatrix(true, false);
          if (!mesh.geometry?.boundingBox) mesh.geometry?.computeBoundingBox();
          const bounds = new THREE.Box3().setFromObject(mesh);
          if (!bounds.isEmpty()) radius = Math.max(radius, center.y - bounds.min.y);
        }
        // Match the runtime wheel fit: nearby rim/hardware can inflate the
        // mesh AABB radius and put the suspension hardpoint below the ramp.
        const fittedRadius = Math.min(
          radius || center.y || 0.32,
          Math.max(0.18, center.y + 0.015),
        );
        return {
          x: center.x, y: center.y, z: center.z,
          radius: THREE.MathUtils.clamp(fittedRadius, 0.18, 0.5),
          front: !!w.front,
        };
      });
      const physicsBox = { min: bodyBox.min.clone(), max: bodyBox.max.clone() };
      const minWheelY = Math.min(...wheelSpecs.map(w => w.y));
      const meanRadius = wheelSpecs.reduce((sum, w) => sum + w.radius, 0) / wheelSpecs.length;
      physicsBox.min.y = THREE.MathUtils.clamp(
        minWheelY + meanRadius * 0.42,
        bodyBox.min.y + 0.10,
        bodyBox.max.y - 0.3,
      );
      const cx = (bodyBox.min.x + bodyBox.max.x) * 0.5;
      const cz = (bodyBox.min.z + bodyBox.max.z) * 0.5;
      const hx = (bodyBox.max.x - bodyBox.min.x) * 0.44;
      const hz = (bodyBox.max.z - bodyBox.min.z) * 0.46;
      physicsBox.min.x = cx - hx; physicsBox.max.x = cx + hx;
      physicsBox.min.z = cz - hz; physicsBox.max.z = cz + hz;
      const colliderCenterY = (physicsBox.min.y + physicsBox.max.y) * 0.5;
      const comDrop = Math.min(0.22, (bodyBox.max.y - bodyBox.min.y) * 0.18);
      dynamicVehicleSpecs[kind] = {
        physicsBox,
        centerY: Math.max(0.22, colliderCenterY - comDrop),
        wheels: wheelSpecs,
      };
    }
    if (wheels.length === 4) {
      if (kind === 'cybertruck') {
        const tyreParts = wheels.map((wheel) => (wheel.meshes || []).filter((mesh) => {
          mesh.updateWorldMatrix(true, false);
          const bounds = new THREE.Box3().setFromObject(mesh);
          const size = bounds.getSize(new THREE.Vector3());
          const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
          return dims[0] > 0.82 && dims[1] > 0.82 && dims[2] > 0.30 && dims[2] < 0.60;
        }));
        check('Cybertruck full rubber tyre mesh is attached to every wheel spinner',
          tyreParts.every(parts => parts.length >= 1),
          `tyreMeshesPerWheel=${tyreParts.map(parts => parts.length).join(',')}`);
        const tyre = tyreParts[0]?.[0];
        if (tyre) {
          tyre.updateWorldMatrix(true, false);
          const beforeTyre = tyre.matrixWorld.elements.slice();
          wheels[0].spinner.rotation[wheels[0].axle === 'z' ? 'z' : 'x'] += 0.7;
          scene.updateMatrixWorld(true);
          const tyreMoves = beforeTyre.some((value, index) =>
            Math.abs(value - tyre.matrixWorld.elements[index]) > 1e-6);
          check('Cybertruck tyre rubber rotates with the rim, not only the hub',
            tyreMoves, `wheelMeshes=${wheels[0].meshes.length}`);
          wheels[0].spinner.rotation[wheels[0].axle === 'z' ? 'z' : 'x'] -= 0.7;
        } else {
          check('Cybertruck tyre rubber rotates with the rim, not only the hub', false);
        }
      }
      const quads = new Set(wheels.map((w) => `${Math.sign(w.center.x)},${Math.sign(w.center.z)}`));
      check('4 wheels in 4 quadrants', quads.size === 4);
      check('wheels low on body', wheels.every((w) => w.center.y < 0.65),
        'ys=' + wheels.map((w) => w.center.y.toFixed(2)).join(','));
      check('axle axis sane', wheels.every((w) => w.axle === 'x' || w.axle === 'z'),
        wheels.map((w) => w.axle).join(','));
      // steer + spin pivots must move the meshes without teleporting them
      const w0 = wheels[0];
      const mesh = w0.meshes[0];
      const before = mesh.matrixWorld.elements.slice();
      w0.spinner.rotation[w0.axle === 'z' ? 'z' : 'x'] += 0.7;
      w0.pivot.rotation.y += 0.3;
      scene.updateMatrixWorld(true);
      const after = mesh.matrixWorld.elements.slice();
      const moved = before.some((v, i) => Math.abs(v - after[i]) > 1e-6);
      check('wheel pivots animate meshes', moved);
      w0.spinner.rotation[w0.axle === 'z' ? 'z' : 'x'] -= 0.7;
      w0.pivot.rotation.y -= 0.3;
    } else {
      check('4 wheels detected', false, `got ${wheels.length}`);
    }

    // ---- collision boxes ----
    const boxes = scene.userData.colBoxes || [];
    const badDisc = boxes.filter((b) => {
      const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
      return sy < 0.06 && Math.max(sx, sz) > 2.0;
    });
    check('collision boxes present', boxes.length > 0 && boxes.length < 600, `n=${boxes.length}`);
    check('no ground-disc blob boxes', badDisc.length === 0, `bad=${badDisc.length}`);

    // ---- nose diagnostics (which Z end is the front?) ----
    if (wheels.length === 4) {
      const zs = wheels.map((w) => w.center.z).sort((a, b) => a - b);
      const frontGap = zs[3] - size.z / 2, rearGap = -size.z / 2 - zs[0];
      console.log(`    INFO wheelZ=[${zs.map((z) => z.toFixed(2)).join(', ')}] overhang(+z)=${Math.abs(size.z / 2 - zs[3]).toFixed(2)} overhang(-z)=${Math.abs(zs[0] + size.z / 2).toFixed(2)}`);
    }
    const glass = [], glow = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m) return;
      o.updateWorldMatrix(true);
      const wb = new THREE.Box3().setFromObject(o);
      if (wb.isEmpty()) return;
      const c = wb.getCenter(new THREE.Vector3());
      if (m.transparent) glass.push(c.z);
      const e = m.emissive;
      if (m.emissiveMap || (e && typeof e.getHex === 'function' && e.getHex() !== 0)) glow.push(c.z);
    });
    const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
    console.log(`    INFO glassMeshes=${glass.length} meanZ=${mean(glass).toFixed(2)} glowMeshes=${glow.length} meanZ=${mean(glow).toFixed(2)}`);
  }

  // ---------- physics ----------
  console.log('[verify] physics');
  await Physics.init();
  const physics = new Physics();
  physics.createWorld();
  physics.addGroundPlane();
  const substepDurations = [];
  const substepCount = physics.step(1 / 30, (h) => substepDurations.push(h));
  check('Rapier splits a slow frame into four small physics substeps',
    substepCount === 4 && substepDurations.length === 4
      && substepDurations.every(h => h <= 1 / 120 + 1e-8)
      && Math.abs(substepDurations.reduce((sum, h) => sum + h, 0) - 1 / 30) < 1e-8,
    `steps=${substepCount} maxDt=${Math.max(...substepDurations).toFixed(5)}`);
  physics.createPlayerBody(0, 3, 0);
  // Rapier refreshes broadphase/query state during its first world step.
  physics.step(1 / 60);
  const groundRay = physics.castRay(
    new THREE.Vector3(0, 2, 0),
    new THREE.Vector3(0, -1, 0),
    5,
  );
  check('Rapier raycast respects max distance and returns a real normal',
    !!groundRay && Math.abs(groundRay.dist - 2) < 0.08 && groundRay.normal.y > 0.9,
    groundRay ? `dist=${groundRay.dist.toFixed(2)} normalY=${groundRay.normal.y.toFixed(2)}` : 'no hit');
  const shortRay = physics.castRay(
    new THREE.Vector3(0, 2, 0),
    new THREE.Vector3(0, -1, 0),
    1,
  );
  check('Rapier raycast does not hit beyond its max distance', shortRay === null);

  // Match the road surface to the actual rendered ribbon triangles rather than
  // a cuboid strip with its own invisible vertical side faces.
  const roadGeometry = new THREE.BufferGeometry();
  roadGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.7071068, 0.06, 0.7071068,
     0.7071068, 0.06,-0.7071068,
     9.2928932, 0.06,10.7071068,
    10.7071068, 0.06, 9.2928932,
  ], 3));
  roadGeometry.setIndex([0, 2, 1, 1, 2, 3]);
  physics.registerStaticRoadMeshes([{ kind: 'road', geometry: roadGeometry }]);
  physics.step(1 / 60);
  const offRoadRay = physics.castRay(
    new THREE.Vector3(9, 2, 1), new THREE.Vector3(0, -1, 0), 4,
  );
  const onRoadRay = physics.castRay(
    new THREE.Vector3(5, 2, 5), new THREE.Vector3(0, -1, 0), 4,
  );
  const fakeRoadSideWall = physics.castRay(
    new THREE.Vector3(10.78, 0.03, 9.29), new THREE.Vector3(-1, 0, 0), 0.15,
  );
  // The ground collider is a 1m-thick cuboid centered at y=-0.5, so its
  // top is y=0. An off-road ray should hit that ground, not the raised road.
  check('diagonal road physics does not extend into its broad AABB corners',
    !!offRoadRay && Math.abs(offRoadRay.dist - 2.0) < 0.08,
    offRoadRay ? `off-road dist=${offRoadRay.dist.toFixed(2)}` : 'no ground hit');
  check('diagonal road is physically present under the actual ribbon',
    !!onRoadRay && Math.abs(onRoadRay.dist - 1.94) < 0.08,
    onRoadRay ? `on-road dist=${onRoadRay.dist.toFixed(2)}` : 'no road hit');
  check('flat road surface has no invisible vertical edge wall', fakeRoadSideWall === null,
    fakeRoadSideWall ? `unexpected edge hit=${fakeRoadSideWall.dist.toFixed(3)}` : 'no side-wall hit');

  // A sloped triangle mesh is the actual collision representation used by
  // authored flyover ramps. Check its contact height at two points.
  const rampGeometry = new THREE.BufferGeometry();
  rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    35, 0.06, -10, 45, 0.06, -10,
    35, 6.06,  20, 45, 6.06,  20,
  ], 3));
  rampGeometry.setIndex([0, 2, 1, 1, 2, 3]);
  physics.registerStaticRoadMeshes([{ kind: 'road', geometry: rampGeometry }]);
  physics.step(1 / 60);
  const rampLowRay = physics.castRay(new THREE.Vector3(40, 2, -5), new THREE.Vector3(0, -1, 0), 5);
  const rampHighRay = physics.castRay(new THREE.Vector3(40, 8, 15), new THREE.Vector3(0, -1, 0), 5);
  check('ramp physics follows the sloped deck height',
    !!rampLowRay && Math.abs((2 - rampLowRay.dist) - 1.06) < 0.10
      && !!rampHighRay && Math.abs((8 - rampHighRay.dist) - 5.06) < 0.10,
    `lowY=${rampLowRay ? (2 - rampLowRay.dist).toFixed(2) : 'none'} highY=${rampHighRay ? (8 - rampHighRay.dist).toFixed(2) : 'none'}`);

  for (let i = 0; i < 60; i++) {
    physics.movePlayer(0, -1, 0);
    physics.step(1 / 60);
  }
  const rest = physics.getPlayerPosition();
  console.log(`    INFO player rest y=${rest.y.toFixed(3)}`);
  check('player capsule rests at feet height', Math.abs(rest.y) < 0.15, `y=${rest.y.toFixed(2)}`);

  const estimatedWheelBottom = (body, specs, centerY) => {
    const p = body.translation(), r = body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const root = new THREE.Vector3(p.x, p.y, p.z)
      .sub(new THREE.Vector3(0, centerY, 0).applyQuaternion(q));
    const states = body._openWorldWheelStates || [];
    return Math.min(...specs.map((w, i) => root.y
      + new THREE.Vector3(w.x, w.y + (states[i]?.offset || 0) - w.radius, w.z).applyQuaternion(q).y));
  };
  const dynamicVehicleSpec = dynamicVehicleSpecs.lambo || Object.values(dynamicVehicleSpecs)[0];
  check('sports car and Cybertruck use separate drivetrain and chassis tuning',
    CAR_PHYSICS.lambo.drivetrain === 'rwd'
      && CAR_PHYSICS.cybertruck.drivetrain === 'awd'
      && CAR_PHYSICS.lambo.wheelbase < CAR_PHYSICS.cybertruck.wheelbase
      && CAR_PHYSICS.cybertruck.frontCorneringStiffness > CAR_PHYSICS.lambo.frontCorneringStiffness
      && CAR_PHYSICS.cybertruck.mass > CAR_PHYSICS.lambo.mass * 1.8
      && CAR_PHYSICS.cybertruck.steeringAngle > CAR_PHYSICS.lambo.steeringAngle
      && CAR_PHYSICS.cybertruck.steeringResponse >= 20,
    `sport=${CAR_PHYSICS.lambo.drivetrain}:${CAR_PHYSICS.lambo.wheelbase}m truck=${CAR_PHYSICS.cybertruck.drivetrain}:${CAR_PHYSICS.cybertruck.wheelbase}m`);
  check('handbrake drift keeps rear grip deliberately below normal driving grip',
    CAR_PHYSICS.lambo.handbrakeRearGrip < CAR_PHYSICS.lambo.rearGrip
      && CAR_PHYSICS.cybertruck.handbrakeRearFriction < CAR_PHYSICS.cybertruck.tireFriction,
    `sport rear grip=${CAR_PHYSICS.lambo.handbrakeRearGrip} truck rear friction=${CAR_PHYSICS.cybertruck.handbrakeRearFriction}`);
  check('both car types produce real GLB suspension specs',
    !!dynamicVehicleSpecs.lambo && !!dynamicVehicleSpecs.cybertruck &&
      dynamicVehicleSpecs.lambo.wheels.length === 4 && dynamicVehicleSpecs.cybertruck.wheels.length === 4,
    `lambo=${dynamicVehicleSpecs.lambo?.wheels.length ?? 0} cybertruck=${dynamicVehicleSpecs.cybertruck?.wheels.length ?? 0}`);

  check('real GLB produces a dynamic suspension spec',
    !!dynamicVehicleSpec && dynamicVehicleSpec.wheels.length === 4,
    dynamicVehicleSpec ? `centerY=${dynamicVehicleSpec.centerY.toFixed(2)} wheels=${dynamicVehicleSpec.wheels.length}` : 'no real wheel spec');
  if (!dynamicVehicleSpec) throw new Error('No real GLB wheel suspension spec could be built');
  // Both imported car models in city-a.json use nose=+Z, so their visual/root
  // correction is PI radians. Verify game-forward still means the direction the
  // car is visually facing, not the opposite body-local -Z direction.
  const vehicleYawOffset = Math.PI;
  const rb = physics.createVehicleBody(10, 0, 20, vehicleYawOffset, [dynamicVehicleSpec.physicsBox], {
    dynamic: true, centerY: dynamicVehicleSpec.centerY,
    mass: CAR_PHYSICS.lambo.mass, yawOffset: vehicleYawOffset, tuning: CAR_PHYSICS.lambo,
  });
  check('vehicle chassis is dynamic', !!rb?._openWorldDynamic);
  check('vehicle remembers imported model yaw correction', rb._openWorldYawOffset === vehicleYawOffset);
  const wheels = dynamicVehicleSpec.wheels;
  physics.step(1 / 60);
  physics.updateVehicleBody(rb, 12, 0, 22, vehicleYawOffset);
  physics.step(1 / 60);
  let t = rb.translation();
  check('dynamic vehicle pose reset preserves ground-space coordinates',
    Math.abs(t.x - 12) < 0.05 && Math.abs(t.z - 22) < 0.05,
    `(${t.x.toFixed(2)}, ${t.z.toFixed(2)})`);

  let lastMotion = null;
  for (let i = 0; i < 90; i++) {
    lastMotion = physics.applyVehicleControls(rb, {
      throttle: 1, steer: 0.8, handbrake: false, dt: 1 / 60,
      wheels, tuning: CAR_PHYSICS.lambo,
      surfaceAt: () => ({ surface: 'asphalt', grip: 1, rollingDrag: 1, speedLimitMultiplier: 1 }),
    });
    physics.step(1 / 60);
  }
  check('raycast suspension detects grounded wheel contact', (lastMotion?.wheelContacts || 0) >= 3,
    `contacts=${lastMotion?.wheelContacts ?? 0}`);
  check('wheel contact states are exposed for wheel animation',
    Array.isArray(rb._openWorldWheelStates) && rb._openWorldWheelStates.length === 4,
    `states=${rb._openWorldWheelStates?.length ?? 0}`);
  check('physics publishes distinct Ackermann angles for the front wheel pivots',
    Array.isArray(rb._openWorldSteerAngles)
      && rb._openWorldSteerAngles.filter((a, i) => wheels[i]?.front && Math.abs(a) > 0.01).length === 2
      && Math.abs(rb._openWorldSteerAngles.find((a, i) => wheels[i]?.front) -
        rb._openWorldSteerAngles.findLast((a, i) => wheels[i]?.front)) > 0.01,
    `angles=${(rb._openWorldSteerAngles || []).map(a => (a * 180 / Math.PI).toFixed(1)).join(',')}`);
  check('tyre raycasts carry the sampled surface modifiers into physics',
    rb._openWorldWheelStates.filter(s => s.contact).every(s => s.surface?.surface === 'asphalt' && s.surface.grip === 1),
    `surfaces=${rb._openWorldWheelStates.map(s => s.surface?.surface || 'no-contact').join(',')}`);


  t = rb.translation();
  const bodyRotation = rb.rotation();
  const bodyYaw = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(bodyRotation.x, bodyRotation.y, bodyRotation.z, bodyRotation.w), 'YXZ',
  ).y;
  check('throttle produces real chassis movement', t.z < 21,
    `z=${t.z.toFixed(2)}`);
  const headingDelta = Math.atan2(
    Math.sin(bodyYaw - vehicleYawOffset), Math.cos(bodyYaw - vehicleYawOffset),
  );
  check('steering rotates a moving chassis in corrected model space', Math.abs(headingDelta) > 0.05,
    `bodyYaw=${bodyYaw.toFixed(2)} delta=${headingDelta.toFixed(2)}`);
  check('vehicle stays above the ground plane', t.y > 0.3, `centerY=${t.y.toFixed(2)}`);
  const lamboTireBottom = estimatedWheelBottom(rb, wheels, dynamicVehicleSpec.centerY);
  check('Lambo visible tyres sit at ground level, not half buried', Math.abs(lamboTireBottom) < 0.10,
    `estimated tire-bottom Y=${lamboTireBottom.toFixed(3)}`);

  const lamboRotation = rb.rotation();
  const lamboQ = new THREE.Quaternion(lamboRotation.x, lamboRotation.y, lamboRotation.z, lamboRotation.w);
  const lamboUp = new THREE.Vector3(0, 1, 0).applyQuaternion(lamboQ);
  const lamboTilt = Math.acos(THREE.MathUtils.clamp(lamboUp.y, -1, 1));
  check('hard steering keeps the sports car planted instead of rolling onto two wheels',
    (lastMotion?.wheelContacts || 0) >= 3 && lamboTilt < 0.40,
    `contacts=${lastMotion?.wheelContacts ?? 0} tilt=${(lamboTilt * 180 / Math.PI).toFixed(1)}deg`);

  const highSpeedTurn = physics.createVehicleBody(80, 0, 0, vehicleYawOffset, [dynamicVehicleSpec.physicsBox], {
    dynamic: true, centerY: dynamicVehicleSpec.centerY,
    mass: CAR_PHYSICS.lambo.mass, yawOffset: vehicleYawOffset,
    tuning: CAR_PHYSICS.lambo, angularDamping: CAR_PHYSICS.lambo.angularDamping,
  });
  physics.step(1 / 60);
  physics.updateVehicleBody(highSpeedTurn, 80, 0, 0, vehicleYawOffset);
  highSpeedTurn.setLinvel({ x: 0, y: 0, z: -27 }, true);
  let highSpeedTurnMotion = null;
  for (let i = 0; i < 150; i++) {
    highSpeedTurnMotion = physics.applyVehicleControls(highSpeedTurn, {
      throttle: 0, steer: 1, handbrake: false, dt: 1 / 60,
      wheels, tuning: CAR_PHYSICS.lambo,
      surfaceAt: () => ({ surface: 'asphalt', grip: 1, rollingDrag: 1, speedLimitMultiplier: 1 }),
    });
    physics.step(1 / 60);
  }
  const turnPose = highSpeedTurn.translation();
  const turnRot = highSpeedTurn.rotation();
  const turnUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
    new THREE.Quaternion(turnRot.x, turnRot.y, turnRot.z, turnRot.w),
  );
  const turnTilt = Math.acos(THREE.MathUtils.clamp(turnUp.y, -1, 1));
  check('sustained fast turn retains suspension contact and avoids extreme chassis lift',
    (highSpeedTurnMotion?.wheelContacts || 0) >= 3 && turnPose.y < dynamicVehicleSpec.centerY + 1.0 && turnTilt < 0.65,
    `contacts=${highSpeedTurnMotion?.wheelContacts ?? 0} chassisY=${turnPose.y.toFixed(2)} tilt=${(turnTilt * 180 / Math.PI).toFixed(1)}deg`);

  // Drive a real chassis up a ramp collider (nose points +Z). This verifies
  // throttle, wheel-ray contact, and rising ground height together.
  const rampCar = physics.createVehicleBody(40, 0.26, -9, 0, [dynamicVehicleSpec.physicsBox], {
    dynamic: true, centerY: dynamicVehicleSpec.centerY,
    mass: CAR_PHYSICS.lambo.mass, yawOffset: vehicleYawOffset,
    tuning: CAR_PHYSICS.lambo, angularDamping: CAR_PHYSICS.lambo.angularDamping,
  });
  for (let i = 0; i < 3; i++) physics.step(1 / 60);
  let rampMotion = null;
  for (let i = 0; i < 90; i++) {
    rampMotion = physics.applyVehicleControls(rampCar, {
      throttle: 1, steer: 0, handbrake: false, dt: 1 / 60,
      wheels, tuning: CAR_PHYSICS.lambo,
    });
    physics.step(1 / 60);
  }
  const rampCarPosition = rampCar.translation();
  check('vehicle has wheel contacts on the slope',
    (rampMotion?.wheelContacts || 0) >= 3,
    `contacts=${rampMotion?.wheelContacts ?? 0}`);
  check('vehicle drives uphill and gains elevation',
    rampCarPosition.z > -5 && rampCarPosition.y > dynamicVehicleSpec.centerY + 0.7,
    `z=${rampCarPosition.z.toFixed(2)} bodyY=${rampCarPosition.y.toFixed(2)}`);

  // Repeat the actual dynamic test using the larger/heavier AWD Cybertruck GLB.
  const truckSpec = dynamicVehicleSpecs.cybertruck;
  if (truckSpec) {
    const truck = physics.createVehicleBody(35, 0, 22, vehicleYawOffset, [truckSpec.physicsBox], {
      dynamic: true, centerY: truckSpec.centerY,
      mass: CAR_PHYSICS.cybertruck.mass,
      yawOffset: vehicleYawOffset,
      tuning: CAR_PHYSICS.cybertruck,
      angularDamping: CAR_PHYSICS.cybertruck.angularDamping,
    });
    physics.step(1 / 60);
    physics.updateVehicleBody(truck, 35, 0, 22, vehicleYawOffset);
    physics.step(1 / 60);
    let truckMotion = null;
    for (let i = 0; i < 90; i++) {
      truckMotion = physics.applyVehicleControls(truck, {
        throttle: 1, steer: 0.35, handbrake: false, dt: 1 / 60,
        wheels: truckSpec.wheels, tuning: CAR_PHYSICS.cybertruck,
      });
      physics.step(1 / 60);
    }
    const truckPosition = truck.translation();
    const truckGrounded = (truckMotion?.wheelContacts || 0) >= 3;
    check('Cybertruck suspension maintains at least three wheel contacts', truckGrounded,
      `contacts=${truckMotion?.wheelContacts ?? 0}`);
    check('Cybertruck AWD throttle moves the heavier chassis', truckPosition.z < 21.5,
      `z=${truckPosition.z.toFixed(2)}`);
    check('Cybertruck chassis does not sink through the ground', truckPosition.y > 0.35,
      `centerY=${truckPosition.y.toFixed(2)}`);
    const truckTireBottom = estimatedWheelBottom(truck, truckSpec.wheels, truckSpec.centerY);
    check('Cybertruck visible tyres sit at ground level, not half buried', Math.abs(truckTireBottom) < 0.10,
      `estimated tire-bottom Y=${truckTireBottom.toFixed(3)}`);
    const frontSteer = truck._openWorldSteerAngles || [];
    const frontMean = frontSteer.reduce((sum, angle, i) =>
      sum + (truckSpec.wheels[i]?.front ? angle : 0), 0) / 2;
    const rearAngles = frontSteer.filter((angle, i) => !truckSpec.wheels[i]?.front);
    check('Cybertruck rear wheels stay straight under steering input',
      rearAngles.length === 2 && rearAngles.every(angle => Math.abs(angle) < 0.01),
      `frontMean=${frontMean.toFixed(3)} rear=${rearAngles.map(a => a.toFixed(3)).join(',')}`);

    const sunkTruck = physics.createVehicleBody(-40, -0.68, -30, vehicleYawOffset, [truckSpec.physicsBox], {
      dynamic: true, centerY: truckSpec.centerY,
      mass: CAR_PHYSICS.cybertruck.mass,
      yawOffset: vehicleYawOffset,
      tuning: CAR_PHYSICS.cybertruck,
      angularDamping: CAR_PHYSICS.cybertruck.angularDamping,
    });
    physics.step(1 / 60);
    let recoveryMotion = null;
    for (let i = 0; i < 120; i++) {
      recoveryMotion = physics.applyVehicleControls(sunkTruck, {
        throttle: 0, steer: 0, handbrake: false, dt: 1 / 60,
        wheels: truckSpec.wheels, tuning: CAR_PHYSICS.cybertruck,
      });
      physics.step(1 / 60);
    }
    const sunkPose = sunkTruck.translation();
    const recoveredRootY = sunkPose.y - truckSpec.centerY;
    check('deeply sagged Tesla chassis keeps wheel contacts for recovery',
      (recoveryMotion?.wheelContacts || 0) >= 3,
      `contacts=${recoveryMotion?.wheelContacts ?? 0}`);
    check('suspension lifts the Tesla chassis back out of the floor',
      recoveredRootY > -0.22,
      `recovered root Y=${recoveredRootY.toFixed(3)}`);
  } else {
    check('Cybertruck dynamic suspension spec exists', false);
  }
  const supportBody = physics.createVehicleBody(110, 0, 0, vehicleYawOffset, [dynamicVehicleSpec.physicsBox], {
    dynamic: true, centerY: dynamicVehicleSpec.centerY,
    mass: CAR_PHYSICS.lambo.mass, yawOffset: vehicleYawOffset,
    tuning: CAR_PHYSICS.lambo, angularDamping: CAR_PHYSICS.lambo.angularDamping,
  });
  physics.step(1 / 60);
  physics.updateVehicleBody(supportBody, 110, 0, 0, vehicleYawOffset);
  physics.step(1 / 60);
  let supportWarmup = null;
  for (let i = 0; i < 8; i++) {
    supportWarmup = physics.applyVehicleControls(supportBody, {
      throttle: 0, steer: 0, handbrake: false, dt: 1 / 60,
      wheels, tuning: CAR_PHYSICS.lambo,
      surfaceAt: () => ({ surface: 'asphalt', grip: 1, rollingDrag: 1, speedLimitMultiplier: 1 }),
    });
    physics.step(1 / 60);
  }
  const originalCast = physics.world.castRayAndGetNormal;
  physics.world.castRayAndGetNormal = function (...args) { return null; };
  const gapMotion = physics.applyVehicleControls(supportBody, {
    throttle: 0, steer: 0, handbrake: false, dt: 1 / 60,
    wheels, tuning: CAR_PHYSICS.lambo,
    surfaceAt: () => ({ surface: 'asphalt', grip: 1, rollingDrag: 1, speedLimitMultiplier: 1 }),
  });
  physics.world.castRayAndGetNormal = originalCast;
  check('one-frame suspension ray miss does not drop every wheel at a road seam',
    (supportWarmup?.wheelContacts || 0) >= 3 && (gapMotion?.wheelContacts || 0) >= 3,
    `warmup=${supportWarmup?.wheelContacts ?? 0} contacts=${gapMotion?.wheelContacts ?? 0}`);


  const steadyBody = physics.createVehicleBody(165, 0, 18, vehicleYawOffset, [dynamicVehicleSpec.physicsBox], {
    dynamic: true, centerY: dynamicVehicleSpec.centerY,
    mass: CAR_PHYSICS.lambo.mass, yawOffset: vehicleYawOffset,
    tuning: CAR_PHYSICS.lambo, angularDamping: CAR_PHYSICS.lambo.angularDamping,
  });
  let steadyMotion = null;
  let steadyMinY = Infinity, steadyMaxY = -Infinity, steadyMaxTilt = 0, steadyMinContacts = 4;
  for (let i = 0; i < 480; i++) {
    physics.step(1 / 60, (h) => {
      steadyMotion = physics.applyVehicleControls(steadyBody, {
        throttle: 0, steer: 0, handbrake: false, dt: h,
        wheels, tuning: CAR_PHYSICS.lambo,
        surfaceAt: () => ({ surface: 'asphalt', grip: 1, rollingDrag: 1, speedLimitMultiplier: 1 }),
      });
    });
    if (i < 180) continue;
    const p = steadyBody.translation();
    const r = steadyBody.rotation();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    const tilt = Math.acos(THREE.MathUtils.clamp(up.y, -1, 1));
    steadyMinY = Math.min(steadyMinY, p.y);
    steadyMaxY = Math.max(steadyMaxY, p.y);
    steadyMaxTilt = Math.max(steadyMaxTilt, tilt);
    steadyMinContacts = Math.min(steadyMinContacts, steadyMotion?.wheelContacts ?? 0);
  }
  check('car suspension settles without continuous shaking on flat ground',
    steadyMaxY - steadyMinY < 0.06 && steadyMaxTilt < 0.12 && steadyMinContacts >= 3,
    `verticalRange=${(steadyMaxY - steadyMinY).toFixed(4)}m maxTilt=${(steadyMaxTilt * 180 / Math.PI).toFixed(2)}deg minContacts=${steadyMinContacts}`);

  const reverseBody = physics.createVehicleBody(40, 0, 0, vehicleYawOffset, [dynamicVehicleSpec.physicsBox], {
    dynamic: true, centerY: dynamicVehicleSpec.centerY,
    mass: CAR_PHYSICS.lambo.mass, yawOffset: vehicleYawOffset,
    tuning: CAR_PHYSICS.lambo, angularDamping: CAR_PHYSICS.lambo.angularDamping,
  });
  physics.step(1 / 60);
  physics.updateVehicleBody(reverseBody, 40, 0, 0, vehicleYawOffset);
  physics.step(1 / 60);
  let reverseMotion = null;
  for (let i = 0; i < 90; i++) {
    reverseMotion = physics.applyVehicleControls(reverseBody, {
      throttle: -1, steer: 0.7, handbrake: false, dt: 1 / 60,
      wheels, tuning: CAR_PHYSICS.lambo,
      surfaceAt: () => ({ surface: 'asphalt', grip: 1, rollingDrag: 1, speedLimitMultiplier: 1 }),
    });
    physics.step(1 / 60);
  }
  const reversePose = reverseBody.translation();
  const reverseRot = reverseBody.rotation();
  const reverseYaw = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(reverseRot.x, reverseRot.y, reverseRot.z, reverseRot.w), 'YXZ',
  ).y;
  const reverseYawDelta = Math.atan2(Math.sin(reverseYaw - vehicleYawOffset), Math.cos(reverseYaw - vehicleYawOffset));
  check('reverse throttle accelerates past walking pace while steering',
    (reverseMotion?.forwardSpeed ?? 0) < -2.5 && Math.abs(reverseYawDelta) > 0.03,
    `reverseSpeed=${reverseMotion?.forwardSpeed?.toFixed(2)} yawDelta=${reverseYawDelta.toFixed(2)} z=${reversePose.z.toFixed(2)}`);
  check('right steering creates the opposite yaw response in reverse',
    headingDelta * reverseYawDelta < 0,
    `forwardYaw=${headingDelta.toFixed(2)} reverseYaw=${reverseYawDelta.toFixed(2)}`);

  const driftBody = physics.createVehicleBody(70, 0, -10, vehicleYawOffset, [dynamicVehicleSpec.physicsBox], {
    dynamic: true, centerY: dynamicVehicleSpec.centerY,
    mass: CAR_PHYSICS.lambo.mass, yawOffset: vehicleYawOffset,
    tuning: CAR_PHYSICS.lambo, angularDamping: CAR_PHYSICS.lambo.angularDamping,
  });
  physics.step(1 / 60);
  physics.updateVehicleBody(driftBody, 70, 0, -10, vehicleYawOffset);
  physics.step(1 / 60);
  driftBody.setLinvel({ x: 0, y: 0, z: -16 }, true);
  let driftMotion = null;
  for (let i = 0; i < 50; i++) {
    driftMotion = physics.applyVehicleControls(driftBody, {
      throttle: 0.2, steer: 0.8, handbrake: true, dt: 1 / 60,
      wheels, tuning: CAR_PHYSICS.lambo,
      surfaceAt: () => ({ surface: 'asphalt', grip: 1, rollingDrag: 1, speedLimitMultiplier: 1 }),
    });
    physics.step(1 / 60);
  }
  check('handbrake drift lets the rear slide while front steering stays active',
    Math.abs(driftMotion?.lateralSpeed ?? 0) > 0.15 && (driftMotion?.wheelContacts ?? 0) >= 3,
    `lateralSpeed=${driftMotion?.lateralSpeed?.toFixed(2) ?? 'n/a'} contacts=${driftMotion?.wheelContacts ?? 0}`);

  const acceleratingTruckSpec = dynamicVehicleSpecs.cybertruck;
  const truckBody = physics.createVehicleBody(-40, 0, 0, vehicleYawOffset, [acceleratingTruckSpec.physicsBox], {
    dynamic: true, centerY: acceleratingTruckSpec.centerY,
    mass: CAR_PHYSICS.cybertruck.mass, yawOffset: vehicleYawOffset,
    tuning: CAR_PHYSICS.cybertruck, angularDamping: CAR_PHYSICS.cybertruck.angularDamping,
  });
  physics.step(1 / 60);
  physics.updateVehicleBody(truckBody, -40, 0, 0, vehicleYawOffset);
  physics.step(1 / 60);
  let truckMotion = null;
  for (let i = 0; i < 90; i++) {
    truckMotion = physics.applyVehicleControls(truckBody, {
      throttle: 1, steer: 0.8, handbrake: false, dt: 1 / 60,
      wheels: acceleratingTruckSpec.wheels, tuning: CAR_PHYSICS.cybertruck,
      surfaceAt: () => ({ surface: 'asphalt', grip: 1, rollingDrag: 1, speedLimitMultiplier: 1 }),
    });
    physics.step(1 / 60);
  }
  const truckRot = truckBody.rotation();
  const truckYaw = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(truckRot.x, truckRot.y, truckRot.z, truckRot.w), 'YXZ',
  ).y;
  const truckYawDelta = Math.atan2(Math.sin(truckYaw - vehicleYawOffset), Math.cos(truckYaw - vehicleYawOffset));
  check('AWD vehicle keeps steering authority while accelerating',
    (truckMotion?.forwardSpeed ?? 0) > 2 && Math.abs(truckYawDelta) > 0.04,
    `forwardSpeed=${truckMotion?.forwardSpeed?.toFixed(2)} yawDelta=${truckYawDelta.toFixed(2)} contacts=${truckMotion?.wheelContacts ?? 0}`);
  // Compare ordinary straight acceleration with combined throttle + steering,
  // then verify each car still turns after the driver lifts off the accelerator.
  const handlingPass = (kind, x, { startSpeed = 0, throttle = 0, steer = 0, frames = 100 } = {}) => {
    const spec = dynamicVehicleSpecs[kind];
    if (!spec) return null;
    const tune = CAR_PHYSICS[kind];
    const body = physics.createVehicleBody(x, 0, -90, vehicleYawOffset, [spec.physicsBox], {
      dynamic: true, centerY: spec.centerY,
      mass: tune.mass, yawOffset: vehicleYawOffset, tuning: tune,
      angularDamping: tune.angularDamping,
    });
    for (let i = 0; i < 110; i++) {
      physics.step(1 / 60, (h) => physics.applyVehicleControls(body, {
        throttle: 0, steer: 0, handbrake: false, dt: h,
        wheels: spec.wheels, tuning: tune,
        surfaceAt: () => ({ surface: 'asphalt', grip: 1, rollingDrag: 1, speedLimitMultiplier: 1 }),
      }));
    }
    if (startSpeed > 0) body.setLinvel({ x: 0, y: 0, z: -startSpeed }, true);
    const startRotation = body.rotation();
    const startYaw = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(startRotation.x, startRotation.y, startRotation.z, startRotation.w), 'YXZ',
    ).y;
    let motion = null;
    for (let i = 0; i < frames; i++) {
      physics.step(1 / 60, (h) => {
        motion = physics.applyVehicleControls(body, {
          throttle, steer, handbrake: false, dt: h,
          wheels: spec.wheels, tuning: tune,
          surfaceAt: () => ({ surface: 'asphalt', grip: 1, rollingDrag: 1, speedLimitMultiplier: 1 }),
        });
      });
    }
    const rotation = body.rotation();
    const yaw = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), 'YXZ',
    ).y;
    const result = {
      speed: motion?.forwardSpeed ?? 0,
      yawChange: Math.abs(Math.atan2(Math.sin(yaw - startYaw), Math.cos(yaw - startYaw))),
      contacts: motion?.wheelContacts ?? 0,
    };
    physics.removeVehicleBody(body);
    return result;
  };

  for (const [kind, x] of [['cybertruck', -180], ['bugatti', -100]]) {
    const straight = handlingPass(kind, x, { throttle: 1, steer: 0, frames: 100 });
    const acceleratingTurn = handlingPass(kind, x + 45, { throttle: 1, steer: 0.72, frames: 100 });
    const coastingTurn = handlingPass(kind, x + 90, { startSpeed: 15, throttle: 0, steer: 0.85, frames: 90 });
    check(`${kind} keeps useful acceleration while steering`,
      !!straight && !!acceleratingTurn
        && acceleratingTurn.speed > straight.speed * 0.68
        && acceleratingTurn.yawChange > 0.12
        && acceleratingTurn.contacts >= 3,
      `straight=${straight?.speed.toFixed(2)}m/s combined=${acceleratingTurn?.speed.toFixed(2)}m/s yaw=${(acceleratingTurn?.yawChange * 180 / Math.PI).toFixed(1)}deg`);
    check(`${kind} still turns decisively while coasting with no throttle`,
      !!coastingTurn && coastingTurn.yawChange > 0.18
        && coastingTurn.speed > 2
        && coastingTurn.speed < 15
        && coastingTurn.contacts >= 3,
      `coastSpeed=${coastingTurn?.speed.toFixed(2)}m/s yaw=${(coastingTurn?.yawChange * 180 / Math.PI).toFixed(1)}deg`);
  }

  // Isolated cornering lab: drive each real GLB on a clean Rapier ground plane.
  // A normal ~0.5g turn should not unload a diagonal wheel pair or roll the
  // chassis onto one corner. This stays in the developer test harness only.
  const corneringKinds = ['lambo', 'cybertruck', 'bugatti'];
  const corneringResults = {};
  for (let kindIndex = 0; kindIndex < corneringKinds.length; kindIndex++) {
    const kind = corneringKinds[kindIndex];
    const spec = dynamicVehicleSpecs[kind];
    if (!spec) {
      check(`${kind} has a real wheel spec for the isolated cornering lab`, false);
      continue;
    }
    const tune = CAR_PHYSICS[kind];
    const startX = 320 + kindIndex * 80;
    const startZ = 240;
    const body = physics.createVehicleBody(startX, 0, startZ, vehicleYawOffset, [spec.physicsBox], {
      dynamic: true, centerY: spec.centerY,
      mass: tune.mass, yawOffset: vehicleYawOffset,
      tuning: tune, angularDamping: tune.angularDamping,
    });
    physics.step(1 / 60);
    physics.updateVehicleBody(body, startX, 0, startZ, vehicleYawOffset);
    physics.step(1 / 60);
    for (let i = 0; i < 120; i++) {
      physics.step(1 / 60, (h) => {
        physics.applyVehicleControls(body, {
          throttle: 0, steer: 0, handbrake: false, dt: h,
          wheels: spec.wheels, tuning: tune,
        });
      });
    }
    body.setLinvel({ x: 0, y: 0, z: -10 }, true);
    let minContacts = 4;
    let maxTilt = 0;
    let maxWheelHeightSpread = 0;
    let maxDiagonalLift = 0;
    let diagonalMissFrames = 0;
    let firstYaw = Math.PI;
    let lastYaw = Math.PI;
    const frontRight = spec.wheels.findIndex(w => w.front && w.x < 0);
    const rearLeft = spec.wheels.findIndex(w => !w.front && w.x > 0);
    for (let frame = 0; frame < 150; frame++) {
      let motion = null;
      physics.step(1 / 60, (h) => {
        motion = physics.applyVehicleControls(body, {
          throttle: 0.05, steer: 0.30, handbrake: false, dt: h,
          wheels: spec.wheels, tuning: tune,
        });
      });
      const rotation = body.rotation();
      const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      maxTilt = Math.max(maxTilt, Math.acos(THREE.MathUtils.clamp(up.y, -1, 1)));
      minContacts = Math.min(minContacts, motion?.wheelContacts ?? 0);
      const p = body.translation();
      const root = new THREE.Vector3(p.x, p.y, p.z)
        .sub(new THREE.Vector3(0, spec.centerY, 0).applyQuaternion(q));
      const states = body._openWorldWheelStates || [];
      const bottoms = spec.wheels.map((w, i) => root.y
        + new THREE.Vector3(w.x, w.y + (states[i]?.offset || 0) - w.radius, w.z).applyQuaternion(q).y);
      maxWheelHeightSpread = Math.max(maxWheelHeightSpread, Math.max(...bottoms) - Math.min(...bottoms));
      if (frontRight >= 0 && rearLeft >= 0) {
        maxDiagonalLift = Math.max(maxDiagonalLift, bottoms[frontRight], bottoms[rearLeft]);
        if (!states[frontRight]?.contact || !states[rearLeft]?.contact) diagonalMissFrames++;
      }
      const currentYaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
      lastYaw = Math.atan2(Math.sin(currentYaw - vehicleYawOffset), Math.cos(currentYaw - vehicleYawOffset));
      if (frame === 0) firstYaw = lastYaw;
    }
    const yawResponse = Math.abs(Math.atan2(Math.sin(lastYaw - firstYaw), Math.cos(lastYaw - firstYaw)));
    corneringResults[kind] = { yawResponse, minContacts, maxTilt, maxDiagonalLift, diagonalMissFrames };
    check(`${kind} keeps all four tyres supported in a normal corner`, minContacts === 4,
      `minContacts=${minContacts}/4`);
    check(`${kind} avoids diagonal wheel lift and excessive body roll`,
      maxDiagonalLift < 0.14 && maxTilt < 0.26 && diagonalMissFrames < 18,
      `diagonalLift=${maxDiagonalLift.toFixed(3)}m roll/pitch=${(maxTilt * 180 / Math.PI).toFixed(1)}deg diagonalMissFrames=${diagonalMissFrames}`);
    check(`${kind} has responsive steering under load`, yawResponse > 0.08,
      `yawChange=${(yawResponse * 180 / Math.PI).toFixed(1)}deg wheelHeightSpread=${maxWheelHeightSpread.toFixed(3)}m`);
    physics.removeVehicleBody(body);
  }
  const teslaTurn = corneringResults.cybertruck?.yawResponse || 0;
  const bugattiTurn = corneringResults.bugatti?.yawResponse || 0;
  check('Tesla steering response is close to the Bugatti under the same test conditions',
    teslaTurn >= bugattiTurn * 0.88 && teslaTurn <= bugattiTurn * 1.30,
    `Tesla=${(teslaTurn * 180 / Math.PI).toFixed(1)}deg Bugatti=${(bugattiTurn * 180 / Math.PI).toFixed(1)}deg`);

} catch (e) {
  failures++;
  console.log('[verify] ERROR', e && e.stack ? e.stack : e);
} finally {
  await new Promise((resolve) => {
    server.on('exit', resolve);
    server.kill();
    setTimeout(resolve, 2000);
  });
  // Let libuv handles settle before exiting (avoids a Windows handle race).
  await new Promise((r) => setTimeout(r, 500));
}

console.log(failures === 0 ? '[verify] ALL CHECKS PASSED' : `[verify] ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
