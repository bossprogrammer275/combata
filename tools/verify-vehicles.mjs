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
  await waitForServer();
  console.log('[verify] server up on ' + BASE);

  const { loadCarModel, CAR_MODELS } = await import('../js/vehicles.js');
  const { Physics } = await import('../js/physics.js');

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
  physics.createPlayerBody(0, 3, 0);
  for (let i = 0; i < 60; i++) {
    physics.movePlayer(0, -1, 0);
    physics.step(1 / 60);
  }
  const rest = physics.getPlayerPosition();
  console.log(`    INFO player rest y=${rest.y.toFixed(3)}`);
  check('player capsule rests at feet height', Math.abs(rest.y) < 0.15, `y=${rest.y.toFixed(2)}`);

  const rb = physics.createVehicleBody(10, 0, 20, 0.5, null, {
    dynamic: true, centerY: 0.6, mass: 1200,
  });
  check('vehicle chassis is dynamic', !!rb?._openWorldDynamic);
  physics.step(1 / 60);
  physics.updateVehicleBody(rb, 12, 0, 22, 0);
  physics.step(1 / 60);
  let t = rb.translation();
  check('dynamic vehicle pose reset preserves ground-space coordinates',
    Math.abs(t.x - 12) < 0.05 && Math.abs(t.z - 22) < 0.05,
    `(${t.x.toFixed(2)}, ${t.z.toFixed(2)})`);

  for (let i = 0; i < 90; i++) {
    physics.applyVehicleControls(rb, {
      throttle: 1, steer: 0.8, handbrake: false, dt: 1 / 60,
    });
    physics.step(1 / 60);
  }
  t = rb.translation();
  const bodyRotation = rb.rotation();
  const bodyYaw = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(bodyRotation.x, bodyRotation.y, bodyRotation.z, bodyRotation.w), 'YXZ',
  ).y;
  check('throttle produces real chassis movement', t.z < 21,
    `z=${t.z.toFixed(2)}`);
  check('steering rotates a moving chassis', Math.abs(bodyYaw) > 0.05,
    `yaw=${bodyYaw.toFixed(2)}`);
  check('vehicle stays above the ground plane', t.y > 0.3, `centerY=${t.y.toFixed(2)}`);
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
