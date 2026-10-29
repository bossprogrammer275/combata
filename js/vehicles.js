// VehicleSystem — GTA-style arcade driving with real physics feel + speedometer.
import * as THREE from 'three';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { prefetch } from './model-loader.js';

export const CAR_MODELS = {
  // nose: -1 = model nose faces local -Z (three.js forward convention),
  //        +1 = nose faces local +Z (compensated with a PI yaw offset).
  lambo:  { url: './data/models/cars/CAR Model by Ignition Labs - 5zUWP5UsLg-.glb', targetLen: 4.7, color: 0xda2828, nose: 1 },
  cybertruck: { url: './data/models/cars/tesla_cybertruk_low_poly/scene.gltf', targetLen: 5.7, color: 0x888888, nose: 1 },
  // Temporary Bugatti preset: the repo does not yet contain a dedicated Bugatti GLB.
  // Keep the existing bundled sports-car GLB so spawning works offline; replace this URL when the Bugatti asset is added.
  bugatti: { url: './data/models/cars/CAR Model by Ignition Labs - 5zUWP5UsLg-.glb', targetLen: 4.9, color: 0x1767e8, nose: 1 },
};

// Handling is deliberately different per chassis. Values are tuned for a fun,
// responsive open-world game rather than pretending every vehicle weighs and
// turns like the same generic car. Speeds/accelerations are m/s and m/s².
export const CAR_PHYSICS = {
  lambo: {
    mass: 1480, drivetrain: 'rwd', wheelbase: 2.70,
    engineAcceleration: 12.5, reverseAcceleration: 4.5, brakeAcceleration: 15.0,
    maxSpeed: 64, maxReverseSpeed: 10.5, speedometerMaxKmh: 230,
    aeroDragArea: 0.90, rollingResistance: 0.014,
    speedSteeringFalloff: 0.008, minSteeringScale: 0.48, steeringResponse: 10.5,
    antiRollStiffness: 22000, downforceCoefficient: 0.38, maxDownforceG: 0.22,
    frontDriveBias: 0.35,
    steeringAngle: 0.26, handbrakeSteerAngle: 0.43,
    frontGrip: 7.4, rearGrip: 9.2, handbrakeRearGrip: 0.7,
    tireFriction: 1.30, handbrakeRearFriction: 0.52,
    suspensionRestLength: 0.21, suspensionTravel: 0.18,
    springRate: 32000, springDamping: 3400,
    uprightStrength: 3.8, uprightDamping: 4.3, uprightInertiaScale: 1.8,
    angularDamping: 0.9,
  },
  // Tesla Cybertruck Premium AWD reference: ~3,009 kg curb mass,
  // 0-100 km/h ~4.3 s and 180 km/h top speed.
  // Sources: Tesla owner's manual and published AWD specifications.
  // https://www.tesla.com/ownersmanual/cybertruck/en_us/GUID-12A976DD-EB60-431B-AFF1-5A37E95006DB.html
  cybertruck: {
    mass: 3009, drivetrain: 'awd', wheelbase: 3.635,
    engineAcceleration: 9.5, reverseAcceleration: 3.5, brakeAcceleration: 10.5,
    maxSpeed: 180 / 3.6, maxReverseSpeed: 8.3, speedometerMaxKmh: 180,
    aeroDragArea: 1.15, rollingResistance: 0.016,
    speedSteeringFalloff: 0.006, minSteeringScale: 0.55, steeringResponse: 8.0,
    antiRollStiffness: 32000, downforceCoefficient: 0.20, maxDownforceG: 0.15,
    frontDriveBias: 0.50,
    steeringAngle: 0.20, handbrakeSteerAngle: 0.30,
    frontGrip: 5.9, rearGrip: 6.5, handbrakeRearGrip: 1.0,
    tireFriction: 1.02, handbrakeRearFriction: 0.64,
    suspensionRestLength: 0.25, suspensionTravel: 0.21,
    springRate: 54000, springDamping: 5600,
    uprightStrength: 4.5, uprightDamping: 5.0, uprightInertiaScale: 1.8,
    angularDamping: 1.3,
  },
  // Bugatti Bolide reference (official Jan-2025 technical sheet):
  // 1,450 kg theoretical dry mass, permanent AWD, 380 km/h, 0-100 in 2.2 s,
  // 100-0 km/h in 30 m, racing slicks, and nearly 3,000 kg of downforce at max speed.
  // Cd*A is 1.22 m² in high-speed configuration.
  // Source: https://bugatti-newsroom.imgix.net/67a4b4ec6578153cb3dd2194/technical-specifications-bugatti-bolide-en.pdf
  bugatti: {
    mass: 1450, drivetrain: 'awd', wheelbase: 2.75,
    engineAcceleration: 14.5, reverseAcceleration: 5.0, brakeAcceleration: 13.5,
    maxSpeed: 380 / 3.6, maxReverseSpeed: 12, speedometerMaxKmh: 380,
    aeroDragArea: 1.22, rollingResistance: 0.012,
    speedSteeringFalloff: 0.0085, minSteeringScale: 0.34, steeringResponse: 12.0,
    antiRollStiffness: 27000, downforceCoefficient: 2.65, maxDownforceG: 2.05,
    frontDriveBias: 0.44,
    steeringAngle: 0.21, handbrakeSteerAngle: 0.37,
    frontGrip: 8.7, rearGrip: 9.1, handbrakeRearGrip: 0.75,
    tireFriction: 1.35, handbrakeRearFriction: 0.55,
    suspensionRestLength: 0.20, suspensionTravel: 0.17,
    springRate: 42000, springDamping: 4200,
    uprightStrength: 4.0, uprightDamping: 4.6, uprightInertiaScale: 1.8,
    angularDamping: 0.95,
  },
};

// Rotate a root-space XZ rect by yaw -> world-space AABB extents.
export function rotBoxXZ(bb, yaw, out) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [px, pz] of [[bb.min.x, bb.min.z], [bb.min.x, bb.max.z], [bb.max.x, bb.min.z], [bb.max.x, bb.max.z]]) {
    const wx = px * c + pz * s, wz = -px * s + pz * c;
    if (wx < x0) x0 = wx; if (wx > x1) x1 = wx;
    if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
  }
  out.minX = x0; out.maxX = x1; out.minZ = z0; out.maxZ = z1;
  return out;
}

// Prefetch all car models at module init (off main thread)
prefetch(Object.values(CAR_MODELS).map(c => c.url));

const loader = new GLTFLoader();
const _modelCache = {};

// ---------- model normalization ----------
// Sketchfab car models arrive with arbitrary origins (the cybertruck mesh sits
// ~11m behind its group origin), arbitrary ground offsets and mixed forward
// axes. Everything downstream (camera, entry prompts, collision) assumes:
//   * visual XZ center at the group origin, bottom at y=0
//   * vehicle length along local Z, nose toward local -Z when def.nose === -1
//     (or +Z when def.nose === 1, compensated with a PI yaw offset)
// Scene scale stays uniform, so scene-local coords = (world - position) / scale.

// Accurate per-mesh world boxes (Box3.setFromObject handles rotated children,
// unlike transforming the local bbox corners by hand).
function meshWorldBoxes(root) {
  const out = [];
  root.updateMatrixWorld(true);
  const wb = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g || !g.attributes.position) return;
    wb.setFromObject(o);
    if (wb.isEmpty()) return;
    out.push({ o, min: wb.min.clone(), max: wb.max.clone() });
  });
  return out;
}

function boxSize(b, out) {
  return out.subVectors(b.max, b.min);
}

// Classify meshes: ground-blob discs, wheels (+hub hardware), body shell.
function classifyCarMeshes(items) {
  const all = new THREE.Box3();
  const tmp = new THREE.Vector3();
  for (const m of items) all.expandByPoint(m.min), all.expandByPoint(m.max);
  const total = all.getSize(new THREE.Vector3());
  const maxHoriz = Math.max(total.x, total.z);
  const annotated = items.map((m) => {
    const s = boxSize(m, new THREE.Vector3());
    const c = new THREE.Vector3().addVectors(m.min, m.max).multiplyScalar(0.5);
    return { ...m, s, c };
  });
  // Display-stand discs: flat and spanning most of the footprint. Kept visible
  // but excluded from collision so they don't form invisible floors.
  const blobs = new Set();
  for (const m of annotated) {
    if (m.s.y < 0.12 && Math.max(m.s.x, m.s.z) > 0.45 * maxHoriz
      && (m.min.y - all.min.y) < 0.15) blobs.add(m.o);
  }
  // Wheel candidates: round in side view, thin across the axle, low on the body.
  const cands = annotated.filter((m) => {
    if (blobs.has(m.o)) return false;
    if (m.s.y < 0.28 || m.s.y > 1.05) return false;
    if ((m.c.y - all.min.y) > 0.45 * total.y) return false;
    const side = Math.max(m.s.x, m.s.z);
    if (Math.abs(m.s.y - side) > 0.38 * m.s.y) return false; // not round
    if (Math.min(m.s.x, m.s.z) > 0.8 * m.s.y) return false;  // not thin-axled
    if (side > 1.15) return false;                            // body panel, not a wheel
    return true;
  });
  // One wheel per XZ quadrant around the model center.
  const cx0 = (all.min.x + all.max.x) / 2, cz0 = (all.min.z + all.max.z) / 2;
  const wheels = [];
  if (cands.length >= 4) {
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      let best = null, bestVol = -1;
      for (const m of cands) {
        if (wheels.some((w) => w.best === m)) continue;
        const qx = m.c.x >= cx0 ? 1 : -1;
        const qz = m.c.z >= cz0 ? 1 : -1;
        if (qx !== sx || qz !== sz) continue;
        const vol = m.s.x * m.s.y * m.s.z;
        if (vol > bestVol) { bestVol = vol; best = m; }
      }
      if (best) wheels.push({ best, qx: sx, qz: sz });
    }
  }
  const wheelMeshes = new Set();
  const wheelInfos = [];
  if (wheels.length === 4) {
    // Attach hub hardware (rims, bolts, brake discs): small meshes hugging the hub.
    for (const w of wheels) {
      const members = annotated.filter((m) =>
        !blobs.has(m.o)
        && m.c.distanceTo(w.best.c) < 0.30
        && Math.max(m.s.x, m.s.y, m.s.z) < 1.15
        && m.s.y < 1.05);
      for (const m of members) wheelMeshes.add(m.o);
      const bs = w.best.s;
      wheelInfos.push({
        center: w.best.c.clone(),
        size: bs.clone(),
        axle: bs.x <= bs.z ? 'x' : 'z',
        meshes: members.map((m) => m.o),
      });
    }
  }
  const body = annotated.filter((m) => !blobs.has(m.o) && !wheelMeshes.has(m.o));
  const bodyBox = new THREE.Box3();
  for (const m of body) { bodyBox.expandByPoint(m.min); bodyBox.expandByPoint(m.max); }
  return { all, total, blobs, wheelInfos: wheels.length === 4 ? wheelInfos : [], bodyBox, hasBody: body.length > 0 };
}

// Wrap each wheel's meshes in steer -> spin pivots anchored at the hub.
// attach() preserves world transforms, so visuals don't move at all.
// NOTE: pivot.position lives in scene space, so hub centers are converted.
function rigWheels(scene, wheelInfos, toLocal) {
  const rigs = [];
  for (const w of wheelInfos) {
    const pivot = new THREE.Group();
    pivot.position.copy(toLocal(w.center));
    pivot.userData.wheelPivot = { axle: w.axle };
    scene.add(pivot);
    pivot.updateMatrixWorld(true);
    for (const m of w.meshes) pivot.attach(m);
    const spinner = new THREE.Group();
    spinner.userData.wheelSpinner = true;
    pivot.add(spinner);
    for (const m of [...pivot.children]) {
      if (m !== spinner) spinner.attach(m);
    }
    rigs.push({ pivot, spinner, axle: w.axle, center: w.center.clone(), front: false, meshes: [...spinner.children] });
  }
  return rigs;
}

export async function loadCarModel(kind = 'lambo') {
  if (_modelCache[kind]) return _modelCache[kind];
  const def = CAR_MODELS[kind] || CAR_MODELS.lambo;
  try {
    const gltf = await new Promise((res, rej) => loader.load(def.url, res, undefined, rej));
    const scene = gltf.scene;
    scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
        // Strip non-essential attributes for performance
        if (o.geometry) {
          for (const name of Object.keys(o.geometry.attributes)) {
            if (!['position', 'normal', 'uv', 'uv1', 'color', 'tangent'].includes(name)) {
              o.geometry.deleteAttribute(name);
            }
          }
        }
      }
    });

    // Pass 1: find the body shell, scale longest HORIZONTAL body axis to targetLen.
    let cls = classifyCarMeshes(meshWorldBoxes(scene));
    const bodySize = cls.hasBody
      ? cls.bodyBox.getSize(new THREE.Vector3())
      : cls.total.clone();
    const longestH = Math.max(bodySize.x, bodySize.z, 0.001);
    scene.scale.multiplyScalar(def.targetLen / longestH);
    scene.updateMatrixWorld(true);

    // Pass 2 (final space): recenter XZ on the body, ground the bottom at y=0.
    cls = classifyCarMeshes(meshWorldBoxes(scene));
    const bb = cls.hasBody ? cls.bodyBox : cls.all;
    const bc = bb.getCenter(new THREE.Vector3());
    scene.position.x -= bc.x;
    scene.position.z -= bc.z;
    scene.position.y -= bb.min.y;
    scene.updateMatrixWorld(true);

    // Pass 3: final classification in normalized space. Boxes below are in
    // ROOT space (== world coords here, root identity): the clone keeps the
    // base position/scale, so they translate with the vehicle root directly.
    cls = classifyCarMeshes(meshWorldBoxes(scene));
    const s = scene.scale.x; // uniform
    const toLocal = (v) => v.clone().sub(scene.position).divideScalar(s);

    // Final grounding: tires (not the undertray) touch y=0. Lift so the
    // lowest body/wheel mesh bottom sits exactly on the ground.
    {
      const items = meshWorldBoxes(scene);
      let minY = Infinity;
      const wheelSet = new Set();
      for (const w of cls.wheelInfos) for (const m of w.meshes) wheelSet.add(m);
      for (const m of items) {
        if (cls.blobs.has(m.o)) continue;
        if (m.min.y < minY) minY = m.min.y;
      }
      if (isFinite(minY) && Math.abs(minY) > 1e-4) {
        scene.position.y -= minY;
        scene.updateMatrixWorld(true);
        cls = classifyCarMeshes(meshWorldBoxes(scene));
      }
    }

    const colBoxes = [];
    if (cls.hasBody) {
      const items = meshWorldBoxes(scene);
      const wheelSet = new Set();
      for (const w of cls.wheelInfos) for (const m of w.meshes) wheelSet.add(m);
      for (const m of items) {
        if (cls.blobs.has(m.o) || wheelSet.has(m.o)) continue;
        colBoxes.push({ min: m.min.clone(), max: m.max.clone() });
      }
    }
    if (!colBoxes.length) {
      const fb = new THREE.Box3().setFromObject(scene);
      colBoxes.push({ min: fb.min.clone(), max: fb.max.clone() });
    }

    // Rig wheels AFTER collision was captured (wheel meshes excluded above).
    const rigs = rigWheels(scene, cls.wheelInfos, toLocal);
    const nose = def.nose || -1;
    for (const r of rigs) {
      r.front = (r.center.z * nose) > 0;
      r.pivot.userData.wheelPivot.front = r.front;
    }
    scene.userData.wheels = rigs;

    const fin = new THREE.Box3().setFromObject(scene);
    const fsize = fin.getSize(new THREE.Vector3());
    const yawOffset = nose > 0 ? Math.PI : 0;
    scene.userData.colBoxes = colBoxes;
    scene.userData.bodyBox = { min: fin.min.clone(), max: fin.max.clone() };
    scene.userData.half = { x: fsize.x / 2, z: fsize.z / 2 };
    scene.userData.yawOffset = yawOffset;
    scene.userData.nose = nose;

    _modelCache[kind] = scene;
    console.log(`[Vehicle] Loaded car model: ${kind} (body ${fsize.x.toFixed(2)}x${fsize.y.toFixed(2)}x${fsize.z.toFixed(2)}m, ${colBoxes.length} collision boxes, ${rigs.length} wheels)`);
    return scene;
  } catch (e) {
    console.warn(`[Vehicle] Load failed for ${kind}, using fallback:`, e);
    const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.3, metalness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.2, def.targetLen), mat);
    body.position.y = 0.6;
    body.castShadow = true;
    const group = new THREE.Group();
    group.add(body);
    group.userData.colBoxes = [{ min: new THREE.Vector3(-1.05, 0, -def.targetLen / 2), max: new THREE.Vector3(1.05, 1.2, def.targetLen / 2) }];
    group.userData.bodyBox = { min: new THREE.Vector3(-1.05, 0, -def.targetLen / 2), max: new THREE.Vector3(1.05, 1.2, def.targetLen / 2) };
    group.userData.half = { x: 1.05, z: def.targetLen / 2 };
    group.userData.yawOffset = 0;
    group.userData.nose = -1;
    _modelCache[kind] = group;
    return group;
  }
}

Object.keys(CAR_MODELS).forEach(k => loadCarModel(k).catch(() => {}));

export class VehicleSystem {
  constructor(scene, world, camera, audio, physics = null) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;
    this.audio = audio;
    this.physics = physics;
    this.vehicles = [];
    this.driver = null;
    this.preferredVehicle = null;
    this._camPos = null;
    this._camLook = null;
    this._lookYaw = 0;
    this._lookPitch = 0.2;
    this._enterState = null;
    this._speedometerCanvas = null;
    this._speedometerCtx = null;
    this._initSpeedometer();
  }

  _initSpeedometer() {
    const el = document.createElement('div');
    el.id = 'speedometer';
    el.style.cssText = 'position:fixed;bottom:80px;right:24px;z-index:12;pointer-events:none;display:none;';
    const canvas = document.createElement('canvas');
    canvas.width = 140;
    canvas.height = 140;
    el.appendChild(canvas);
    document.body.appendChild(el);
    this._speedometerCanvas = el;
    this._speedometerCtx = canvas.getContext('2d');
  }

  _drawSpeedometer(kmh, kind = 'lambo') {
    const ctx = this._speedometerCtx;
    if (!ctx) return;
    const W = 140, H = 140, cx = W / 2, cy = H / 2 + 10, r = 52;
    ctx.clearRect(0, 0, W, H);

    // Background arc
    const startAngle = 0.75 * Math.PI;
    const endAngle = 2.25 * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Speed arc
    // Each car uses its own believable top-speed scale rather than sharing one dial.
    const maxSpeed = CAR_PHYSICS[kind]?.speedometerMaxKmh || 230;
    const speedRatio = Math.min(kmh / maxSpeed, 1);
    const speedAngle = startAngle + speedRatio * (endAngle - startAngle);
    const gradient = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    gradient.addColorStop(0, '#6fae5a');
    gradient.addColorStop(0.5, '#c9a227');
    gradient.addColorStop(1, '#c0392b');
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, speedAngle);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Tick marks
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const a = startAngle + t * (endAngle - startAngle);
      const inner = r - 8;
      const outer = r + 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.stroke();
    }

    // Small scale label makes each car's top-speed range explicit.
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '600 8px "Bebas Neue", "Oswald", sans-serif';
    ctx.fillText(`MAX ${maxSpeed} KM/H`, cx, 15);

    // Speed number
    ctx.fillStyle = '#fff';
    ctx.font = '700 26px "Bebas Neue", "Oswald", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(kmh), cx, cy - 4);

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '600 9px "Bebas Neue", "Oswald", sans-serif';
    ctx.fillText('KM/H', cx, cy + 18);

    // Gear indicator
    const gear = kmh < 1 ? 'N' : kmh < 30 ? '1' : kmh < 55 ? '2' : kmh < 85 ? '3' : kmh < 115 ? '4' : '5';
    ctx.fillStyle = '#c9a227';
    ctx.font = '700 13px "Bebas Neue", "Oswald", sans-serif';
    ctx.fillText(gear, cx + 40, cy - 2);
  }

  buildFromWorld() {
    // The driving sandbox intentionally starts with exactly two nearby cars.
    // Prefer authored spawns closest to the player start, but never allow the
    // map's old large vehicle list to flood the initial scene.
    const start = this.world.startPoint || { x: 0, z: 0 };
    const authored = (this.world.vehicleSpawns || [])
      .slice()
      .sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z));
    const chosen = authored.slice(0, 2);
    if (chosen.length < 2) {
      const extra = [
        { x: start.x + 7, z: start.z - 5, ry: start.yaw || 0, kind: 'lambo', elevation: 0 },
        { x: start.x - 7, z: start.z - 5, ry: start.yaw || 0, kind: 'cybertruck', elevation: 0 },
      ];
      for (const candidate of extra) {
        if (chosen.length >= 2) break;
        if (!chosen.some(v => Math.hypot(v.x - candidate.x, v.z - candidate.z) < 5)) chosen.push(candidate);
      }
    }
    for (const s of chosen) this.spawn({ ...s, elevation: s.elevation || 0 });
  }

  // Spawn within interaction range, avoiding existing cars. This keeps the
  // newly requested vehicle reachable with E instead of putting it several metres away.
  async spawnNearPlayer(kind, player) {
    const driving = this.driver;
    const origin = driving?.pos || player?.pos;
    if (!origin) return null;
    const spawnYaw = driving ? (driving.yaw || 0) : (Number.isFinite(player?.yaw) ? player.yaw : 0);
    const heading = driving ? this._worldYaw(driving) : spawnYaw;
    const baseY = Number.isFinite(origin.y) ? origin.y : 0;
    const model = CAR_MODELS[kind] || CAR_MODELS.lambo;
    const modelYawOffset = model.nose > 0 ? Math.PI : 0;
    const preview = {
      yaw: spawnYaw,
      yawOffset: modelYawOffset,
      half: { x: kind === 'cybertruck' ? 1.12 : 1.15, z: model.targetLen * 0.5 },
      pos: { x: origin.x, z: origin.z },
    };
    const candidates = [
      [3.5, 3.5], [3.5, -3.5], [4, 4], [4, -4],
      [4, 3], [4, -3], [3, 5], [3, -5],
      [5, 3], [5, -3], [5, 4], [5, -4],
      [2.5, 5.5], [2.5, -5.5], [5.5, 2.5], [5.5, -2.5],
    ];
    let spot = null;
    for (const [forward, lateral] of candidates) {
      const x = origin.x - Math.sin(heading) * forward + Math.cos(heading) * lateral;
      const z = origin.z - Math.cos(heading) * forward - Math.sin(heading) * lateral;
      preview.pos.x = x;
      preview.pos.z = z;
      if (this.surfaceDistance(preview, origin.x, origin.z) > 4.25) continue;
      if (this.vehicles.some(v => Math.hypot(v.pos.x - x, v.pos.z - z) < 5.2)) continue;
      const sampledY = this.world?.groundHeightAt?.(x, z, baseY + 1.5);
      const elevation = Number.isFinite(sampledY) ? sampledY : Math.max(0, baseY);
      spot = { x, z, elevation };
      break;
    }
    if (!spot) return null;
    const def = { ...spot, kind, ry: spawnYaw };
    const vehicle = await this.spawn(def);
    if (vehicle) this.preferredVehicle = vehicle;
    return vehicle;
  }

  // The visible model, Rapier body and camera all use the same world yaw.
  // yaw is the gameplay heading; yawOffset fixes the source GLB's nose axis.
  _worldYaw(v) {
    return (v?.yaw || 0) + (v?.yawOffset || 0);
  }

  // Fitted, yaw-aware footprint AABB for a parked vehicle (root space -> world).
  _parkedAABB(v) {
    const e = rotBoxXZ(v.bodyBox, this._worldYaw(v), {});
    const cx = (e.minX + e.maxX) / 2 + v.pos.x;
    const cz = (e.minZ + e.maxZ) / 2 + v.pos.z;
    return {
      x: cx, y: v.pos.y + v.bodyBox.min.y, z: cz,
      w: Math.max(e.maxX - e.minX, 0.5),
      h: Math.max(v.bodyBox.max.y - v.bodyBox.min.y, 0.5),
      d: Math.max(e.maxZ - e.minZ, 0.5),
    };
  }

  _addParkedCollider(v) {
    // World.addCollider registers the same handle in world.colliders and the
    // BVH world, so a single reference is enough to add/remove it.
    this._removeParkedCollider(v);
    const b = this._parkedAABB(v);
    v.parkedCol = this.world.addCollider(b.x, b.y, b.z, b.w, b.h, b.d);
    if (this.physics && v.rapierBody) {
      this.physics.updateVehicleBody(v.rapierBody, v.pos.x, v.def.elevation || 0, v.pos.z, this._worldYaw(v));
    }
  }

  _removeParkedCollider(v) {
    if (!v.parkedCol) return;
    const i = this.world.colliders.indexOf(v.parkedCol);
    if (i >= 0) this.world.colliders.splice(i, 1);
    if (this.world.bvhWorld) this.world.bvhWorld.removeAABB(v.parkedCol);
    v.parkedCol = null;
  }

  _refreshParkedCollider(v) {
    if (!v?.parkedCol) return;
    const old = v.parkedCol;
    const i = this.world.colliders.indexOf(old);
    if (i >= 0) this.world.colliders.splice(i, 1);
    if (this.world.bvhWorld) this.world.bvhWorld.removeAABB(old);
    const b = this._parkedAABB(v);
    v.parkedCol = this.world.addCollider(b.x, b.y, b.z, b.w, b.h, b.d);
  }

  syncDynamicVehicle(v, dt = 1 / 60) {
    if (!v?.physicsDynamic || !v.rapierBody) return;
    const t = v.rapierBody.translation();
    const rotation = v.rapierBody.rotation();
    const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const bodyYaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    // The rigid body is centered at the chassis COM, while the visible GLB root
    // is at the wheel-ground origin. Rotate that offset with the full quaternion
    // so roll/pitch does not sink or float the visual car.
    const centerOffset = new THREE.Vector3(0, v.physicsCenterY || 0, 0).applyQuaternion(q);
    v.pos.set(t.x - centerOffset.x, t.y - centerOffset.y, t.z - centerOffset.z);
    // Body yaw rotates the imported model; gameplay yaw removes its GLB axis fix.
    v.yaw = bodyYaw - (v.yawOffset || 0);
    const velocity = v.rapierBody.linvel();
    const forward = new THREE.Vector3(0, 0, -Math.cos(v.yawOffset || 0)).applyQuaternion(q);
    forward.y = 0; if (forward.lengthSq() < 1e-8) forward.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
    forward.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    right.y = 0; if (right.lengthSq() < 1e-8) right.set(Math.cos(bodyYaw), 0, -Math.sin(bodyYaw));
    right.normalize();
    v.speed = velocity.x * forward.x + velocity.z * forward.z;
    v.lateralVel = velocity.x * right.x + velocity.z * right.z;
    v.root.position.copy(v.pos);
    v.root.quaternion.copy(q);
    const wheelStates = v.rapierBody._openWorldWheelStates || [];
    const blend = 1 - Math.exp(-18 * Math.min(Math.max(dt, 0), 0.05));
    for (let i = 0; i < v.wheels.length; i++) {
      const wheel = v.wheels[i];
      const state = wheelStates[i];
      const targetOffset = state?.contact
        ? state.offset
        : (v.suspensionReady ? -(v.physicsProfile?.suspensionTravel ?? 0.18) : 0);
      wheel.suspensionOffset += (targetOffset - wheel.suspensionOffset) * blend;
      // The pivots are children of the source GLB root and their positions
      // are in pre-normalization units. Convert suspension travel from metres
      // back to those local units so scaled cars visibly use their suspension.
      wheel.pivot.position.y = wheel.basePivotY + wheel.suspensionOffset / (wheel.modelScale || 1);
    }
    if (v.parkedCol) this._refreshParkedCollider(v);
  }

  syncDynamicBodies(dt = 1 / 60) {
    for (const v of this.vehicles) {
      // Unoccupied cars still need passive spring/damper forces or their raised
      // chassis colliders would settle through the model origin onto the road.
      // The actively driven car already received its controls earlier this frame.
      if (v !== this.driver && v.physicsDynamic && v.rapierBody && this.physics) {
        this.physics.applyVehicleControls(v.rapierBody, {
          throttle: 0, steer: 0, handbrake: false, dt,
          wheels: v.physicsWheels, tuning: v.physicsProfile,
          surfaceAt: (x, z, y) => this.world?.vehicleSurfaceAt?.(x, z, y),
        });
      }
      this.syncDynamicVehicle(v, dt);
    }
  }

  async spawn(def) {
    try {
      const kind = def.kind || 'lambo';
      const root = new THREE.Group();
      const base = await loadCarModel(kind);
      // The clone keeps the normalized base transform (recenter offset/scale);
      // userData boxes are in root space and translate with the root directly.
      const clone = base.clone(true);
      root.add(clone);
      const colBoxes = base.userData.colBoxes || [];
      const bodyBox = base.userData.bodyBox || {
        min: new THREE.Vector3(-1.05, 0, -2.35), max: new THREE.Vector3(1.05, 1.2, 2.35),
      };
      const half = base.userData.half || { x: 1.05, z: 2.35 };
      const yawOffset = base.userData.yawOffset || 0;
      // Re-resolve the wheel rigs and measure their true positions/radii in
      // normalized model-root space. These are used by the raycast suspension.
      const wheels = [];
      root.updateMatrixWorld(true);
      clone.updateMatrixWorld(true);
      const rootInverse = root.matrixWorld.clone().invert();
      clone.traverse((o) => {
        if (!(o.userData && o.userData.wheelPivot)) return;
        const spinner = (o.children || []).find((c) => c.userData && c.userData.wheelSpinner) || null;
        if (!spinner) return;
        o.updateWorldMatrix(true, false);
        const pivotRootMatrix = rootInverse.clone().multiply(o.matrixWorld);
        const center = new THREE.Vector3().setFromMatrixPosition(pivotRootMatrix);
        const meshes = spinner.children.filter((c) => c.isMesh);
        let radius = 0;
        for (const mesh of meshes) {
          mesh.updateWorldMatrix(true, false);
          const geo = mesh.geometry;
          if (!geo || !geo.attributes.position) continue;
          if (!geo.boundingBox) geo.computeBoundingBox();
          if (!geo.boundingBox) continue;
          const meshRootMatrix = rootInverse.clone().multiply(mesh.matrixWorld);
          const localBox = new THREE.Box3().copy(geo.boundingBox).applyMatrix4(meshRootMatrix);
          // Raycast suspension needs the pivot-to-bottom distance, not half the
          // mesh's Y span: imported wheel hubs and tire meshes are not always centered.
          radius = Math.max(radius, center.y - localBox.min.y);
        }
        // Hub/rim meshes can extend below the actual tyre and inflate the
        // measured radius. The normalized tyre bottom is at (or near) root Y=0,
        // so a wheel radius much larger than its hub height sinks the tyre and
        // makes the suspension ray start inside ramps. Keep the mesh-derived
        // estimate, but cap it to a tiny tolerance above the hub's ground-space Y.
        const radiusLimit = Math.max(0.18, center.y + 0.015);
        const fittedRadius = Math.min(radius || center.y || 0.32, radiusLimit);
        wheels.push({
          pivot: o,
          spinner,
          axle: o.userData.wheelPivot.axle || 'x',
          front: !!o.userData.wheelPivot.front,
          center,
          basePivotY: o.position.y,
          modelScale: Math.max(1e-4, Math.abs(clone.scale.y || 1)),
          suspensionOffset: 0,
          radius: THREE.MathUtils.clamp(fittedRadius, 0.18, 0.5),
          meshes,
        });
      });

      // Parked orientation matches driving orientation exactly (no 180° snap).
      const yaw = def.ry || 0;
      root.position.set(def.x, def.elevation || 0, def.z);
      root.rotation.y = yaw + yawOffset;
      this.scene.add(root);

      const suspensionReady = wheels.length >= 4 && wheels.every(w =>
        Number.isFinite(w.center.x) && Number.isFinite(w.center.y) && Number.isFinite(w.center.z)
        && w.radius >= 0.18 && w.center.y > bodyBox.min.y + 0.015
      );
      const physicsBox = {
        min: bodyBox.min.clone(),
        max: bodyBox.max.clone(),
      };
      if (suspensionReady) {
        // Keep the chassis clear of the road: the wheel rays/springs, not a
        // full-width flat chassis box, must support the vehicle.
        const minWheelY = Math.min(...wheels.map(w => w.center.y));
        const meanRadius = wheels.reduce((sum, w) => sum + w.radius, 0) / wheels.length;
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
      }
      const colliderCenterY = (physicsBox.min.y + physicsBox.max.y) * 0.5;
      // Keep the collision envelope where the model authored it, but place the
      // chassis mass centre lower. This reduces roll torque without kinematic
      // snapping or artificial wheel locking.
      const comDrop = suspensionReady ? Math.min(0.22, (bodyBox.max.y - bodyBox.min.y) * 0.18) : 0;
      const physicsCenterY = Math.max(0.22, colliderCenterY - comDrop);
      const physicsWheels = wheels.map(w => ({
        x: w.center.x, y: w.center.y, z: w.center.z,
        radius: w.radius, front: w.front,
      }));
      const physicsProfile = { ...(CAR_PHYSICS[kind] || CAR_PHYSICS.lambo) };
      const v = {
        def, root, rapierBody: null, physicsDynamic: false, suspensionReady,
        physicsCenterY, physicsBox, physicsWheels, physicsProfile,
        kind, wheels, colBoxes, bodyBox, half,
        yawOffset, parkedCol: null,
        pos: new THREE.Vector3(def.x, def.elevation || 0, def.z),
        yaw,
        speed: 0,
        steerAngle: 0,
        steerInput: 0,
        lateralVel: 0,
        mass: physicsProfile.mass,
        pushForce: 0,
      };

      // Dynamic Rapier chassis with a bounded compound collider set. This body
      // is the source of truth while parked and driven; the old swept-AABB
      // controller remains only as a no-Rapier fallback.
      if (this.physics && this.physics.world) {
        try {
          v.rapierBody = this.physics.createVehicleBody(
            def.x, def.elevation || 0, def.z, yaw + yawOffset, [physicsBox],
            {
              dynamic: true, centerY: physicsCenterY, mass: v.mass,
              yawOffset, tuning: physicsProfile, angularDamping: physicsProfile.angularDamping,
            },
          );
          v.physicsDynamic = !!v.rapierBody?._openWorldDynamic;
          // Let the chassis settle onto its wheel springs before accepting
          // player input; never reset a moving vehicle during ordinary frames.
        } catch (e) { console.warn('[Vehicle] Dynamic Rapier body failed; using AABB fallback:', e); }
      }

      this.vehicles.push(v);
      this._addParkedCollider(v);
      console.log('[Vehicle] Spawned car (' + kind + ') at', def.x, def.z, '- boxes:', colBoxes.length, 'wheels:', wheels.length);
      return v;
    } catch (e) {
      console.error('[Vehicle] Spawn failed:', e);
      return null;
    }
  }

  // Distance from a point to the vehicle's fitted footprint (0 = touching).
  surfaceDistance(v, x, z) {
    const dx = x - v.pos.x, dz = z - v.pos.z;
    const t = -(v.yaw + v.yawOffset);
    const c = Math.cos(t), s = Math.sin(t);
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    const qx = Math.max(Math.abs(lx) - (v.half ? v.half.x : 1.2), 0);
    const qz = Math.max(Math.abs(lz) - (v.half ? v.half.z : 2.5), 0);
    return Math.hypot(qx, qz);
  }

  nearest(x, z, maxDist) {
    let best = null, bd = maxDist;
    for (const v of this.vehicles) {
      const d = this.surfaceDistance(v, x, z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  enter(veh, player) {
    if (this.driver || this._enterState) return false;
    this.driver = veh;
    veh.def.occupied = true;
    // Drop the parked footprint so the driven car never collides with itself.
    this._removeParkedCollider(veh);
    player.vel.set(0, 0, 0);
    player.char.root.visible = false;
    if (this.physics) this.physics.setPlayerCollisionEnabled(false);
    this._lookYaw = 0;
    this._lookPitch = 0.2;
    const totalYaw = this._worldYaw(veh) + this._lookYaw;
    const cx = -Math.sin(totalYaw), cz = -Math.cos(totalYaw);
    const camDist = 5.5;
    const camH = 3.2;
    this._camPos = new THREE.Vector3(veh.pos.x - cx * camDist, camH, veh.pos.z - cz * camDist);
    this._camLook = new THREE.Vector3(veh.pos.x + cx * 4.5, 1.0, veh.pos.z + cz * 4.5);
    if (this._speedometerCanvas) this._speedometerCanvas.style.display = 'block';
    return true;
  }

  _finishEnter(veh, player) {
    this._enterState = null;
    this.driver = veh;
    veh.def.occupied = true;
    player.vel.set(0, 0, 0);
    player.char.root.visible = false;
    if (this.physics) this.physics.setPlayerCollisionEnabled(false);
    this._lookYaw = 0;
    this._lookPitch = 0.2;
    const totalYaw = this._worldYaw(veh) + this._lookYaw;
    const cx = -Math.sin(totalYaw), cz = -Math.cos(totalYaw);
    const camDist = 5.5;
    const camH = 3.2;
    this._camPos = new THREE.Vector3(veh.pos.x - cx * camDist, camH, veh.pos.z - cz * camDist);
    this._camLook = new THREE.Vector3(veh.pos.x + cx * 4.5, 1.0, veh.pos.z + cz * 4.5);
    if (this._speedometerCanvas) this._speedometerCanvas.style.display = 'block';
  }

  exit(player) {
    const veh = this.driver;
    if (!veh) return;
    this.driver = null;
    veh.def.occupied = false;
    const carYaw = this._worldYaw(veh);
    player.pos.set(veh.pos.x + Math.cos(carYaw) * 3, 0.5, veh.pos.z - Math.sin(carYaw) * 3);
    player.vel.set(0, 0, 0);
    if (this.physics) this.physics.setPlayerCollisionEnabled(true);
    player.onGround = true;
    player.yaw = carYaw + Math.PI;
    player.char.root.visible = true;
    player.char.root.position.copy(player.pos);
    player.char.root.rotation.y = player.yaw + Math.PI;
    player.char.update(0.016);
    if (this.physics) this.physics.setPlayerPosition(player.pos.x, player.pos.y, player.pos.z);
    // Re-park: fitted footprint back at the exit pose.
    this._addParkedCollider(veh);
    this._camPos = null;
    if (this._speedometerCanvas) this._speedometerCanvas.style.display = 'none';
  }

  updateEnterExit(dt, player) {
    const es = this._enterState;
    if (!es) return false;
    es.t += dt;
    const veh = es.veh;

    if (es.phase === 'approach') {
      const carYaw = this._worldYaw(veh);
      const tx = veh.pos.x + Math.cos(carYaw) * -2.5;
      const tz = veh.pos.z - Math.sin(carYaw) * -2.5;
      const dx = tx - player.pos.x;
      const dz = tz - player.pos.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 0.5) {
        player.pos.x += (dx / dist) * 4 * dt;
        player.pos.z += (dz / dist) * 4 * dt;
        player.yaw = Math.atan2(-dx, -dz);
      }

      player.char.root.visible = true;
      player.char.root.position.set(player.pos.x, player.pos.y, player.pos.z);
      player.char.root.rotation.y = player.yaw + Math.PI;
      player.char.update(dt);

      if (dist < 0.6 || es.t > 2.5) { es.phase = 'sit'; es.t = 0; }
      return true;
    }

    if (es.phase === 'sit') {
      player.char.root.visible = false;
      if (es.t > 0.3) { this._finishEnter(veh, player); return false; }
      return true;
    }
    return false;
  }

  update(dt, input, player) {
    const v = this.driver;
    if (!v) return;

    const throttle = input.forward || 0;
    const rawSteerInput = input.right || 0;
    const handbrake = !!input.jump;
    const tuning = v.physicsProfile || CAR_PHYSICS[v.kind] || CAR_PHYSICS.lambo;
    const steeringBlend = 1 - Math.exp(-(tuning.steeringResponse || 10) * Math.min(Math.max(dt, 0), 0.05));
    v.steerInput = (v.steerInput || 0) + (rawSteerInput - (v.steerInput || 0)) * steeringBlend;
    const steerInput = v.steerInput;
    let curSpd = 0;
    if (v.physicsDynamic && this.physics && v.rapierBody) {
      // Body pose/velocity come from the last completed Rapier step. Apply
      // controls as impulses; do not manually move or teleport the chassis.
      this.syncDynamicVehicle(v, dt);
      const motion = this.physics.applyVehicleControls(v.rapierBody, {
        throttle,
        steer: steerInput,
        handbrake,
        dt,
        wheels: v.physicsWheels,
        tuning: v.physicsProfile,
        surfaceAt: (x, z, y) => this.world?.vehicleSurfaceAt?.(x, z, y),
      });
      curSpd = motion ? motion.horizontalSpeed : Math.abs(v.speed);
      if (motion) {
        v.speed = motion.forwardSpeed;
        v.lateralVel = motion.lateralSpeed;
      }
      this._pushPlayerNearby(v, curSpd);
    } else {
      const absSpd = Math.abs(v.speed);
  
      // ===== LONGITUDINAL: engine / brake / drag =====
      const tune = v.physicsProfile || CAR_PHYSICS[v.kind] || CAR_PHYSICS.lambo;
      if (throttle > 0) {
        if (v.speed < 0) {
          v.speed += (tune.brakeAcceleration || 12) * dt;
        } else {
          const tune = v.physicsProfile || CAR_PHYSICS[v.kind] || CAR_PHYSICS.lambo;
          const topSpeed = tune.maxSpeed || 40;
          const powerFade = THREE.MathUtils.clamp(1 - (v.speed / topSpeed) * 0.72, 0.18, 1);
          v.speed += (tune.engineAcceleration || 8) * dt * powerFade;
        }
      } else if (throttle < 0) {
        if (v.speed > 1) {
          v.speed -= (tune.brakeAcceleration || 12) * dt;
        } else {
          v.speed -= (tune.reverseAcceleration || 4) * dt;
        }
      } else {
        if (absSpd > 0.1) {
          const topSpeed = tune.maxSpeed || 40;
          const dragCoeff = 0.65 + (absSpd / Math.max(1, topSpeed)) ** 2 * 1.8;
          v.speed *= Math.max(0, 1 - dt * dragCoeff);
        } else {
          v.speed = 0;
        }
      }
  
      // Handbrake — strong deceleration, loose rear
      if (handbrake) {
        v.speed *= Math.max(0, 1 - dt * 4);
      }
  
      // Kill tiny speed
      if (absSpd < 0.05 && !throttle) v.speed = 0;
  
      // Clamp
      v.speed = THREE.MathUtils.clamp(v.speed, -(tune.maxReverseSpeed || 9), tune.maxSpeed || 40);
  
      curSpd = Math.abs(v.speed);
      const fwd = v.speed >= 0 ? 1 : -1;
  
      // ===== STEERING + TIRE GRIP =====
      // Bicycle-model steering: wheel angle creates curvature, so steering
      // naturally tightens at low speed and opens up as speed rises.
      const steerScale = THREE.MathUtils.clamp(1 - curSpd * (v.physicsProfile?.speedSteeringFalloff ?? 0.008), v.physicsProfile?.minSteeringScale ?? 0.4, 1);
      const wheelAngle = steerInput * (handbrake ? (v.physicsProfile?.handbrakeSteerAngle ?? 0.34) : (v.physicsProfile?.steeringAngle ?? 0.20)) * steerScale;
      if (curSpd > 0.25) {
        const wheelbase = v.physicsProfile?.wheelbase || 2.7;
        const yawRate = (v.speed / wheelbase) * Math.tan(wheelAngle);
        v.yaw -= THREE.MathUtils.clamp(yawRate, -1.15, 1.15) * dt;
      }
  
      // Lateral tire velocity decays with grip. A handbrake lowers rear grip,
      // allowing a controlled slide instead of the old instant heading-only turn.
      const targetSlip = steerInput * curSpd * (handbrake ? 0.38 : 0.055);
      const gripRate = handbrake ? 1.7 : 7.5;
      v.lateralVel += (targetSlip - v.lateralVel) * (1 - Math.exp(-gripRate * dt));
      if (Math.abs(steerInput) < 0.05 && !handbrake) {
        v.lateralVel *= Math.exp(-5.5 * dt);
      }
  
      // ===== MOVEMENT — forward velocity plus tire slip =====
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
      const moveX = (fx * v.speed + rx * v.lateralVel) * dt;
      const moveZ = (fz * v.speed + rz * v.lateralVel) * dt;
  
      // ===== SWEPT COLLISION — subdivide fast movement to prevent tunnelling =====
      let blocked = false;
      const boxes = v.colBoxes || [];
      const travel = Math.hypot(moveX, moveZ);
      const moveSteps = Math.max(1, Math.ceil(travel / 0.35));
      const stepX = moveX / moveSteps, stepZ = moveZ / moveSteps;
      const wYaw = this._worldYaw(v);
      const wY = v.def.elevation || 0;
      const rb = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  
      for (let step = 0; step < moveSteps; step++) {
        if (boxes.length > 0) {
          const newX = v.pos.x + stepX;
          const newZ = v.pos.z + stepZ;
          const nearCols = this.world.bvhWorld
            ? this.world.bvhWorld.queryRadius(newX, newZ, 8)
            : this.world.colliders || [];
          let pushX = 0, pushZ = 0;
          for (const b of boxes) {
            rotBoxXZ(b, wYaw, rb);
            const bxMin = rb.minX + newX, bxMax = rb.maxX + newX;
            const bzMin = rb.minZ + newZ, bzMax = rb.maxZ + newZ;
            const byMin = b.min.y + wY, byMax = b.max.y + wY;
            for (const c of nearCols) {
              // Road, sidewalk and curb ribbons are low-profile surfaces, not
              // vertical walls. Rapier uses their exact oriented footprints; the
              // no-Rapier fallback must not push a car out of their broad AABBs.
              if (c.type === 'road_surface') continue;
              // The driven car's own parked AABB is removed on entry. Do NOT
              // filter other parked AABBs: that old Set check made cars ghost
              // straight through every parked vehicle.
              if (c.max.y < 0.1) continue;
              if (bxMax <= c.min.x || bxMin >= c.max.x) continue;
              if (bzMax <= c.min.z || bzMin >= c.max.z) continue;
              if (byMax <= c.min.y || byMin >= c.max.y) continue;
  
              const ox1 = bxMax - c.min.x, ox2 = c.max.x - bxMin;
              const oz1 = bzMax - c.min.z, oz2 = c.max.z - bzMin;
              const minX = Math.min(ox1, ox2), minZ = Math.min(oz1, oz2);
              if (minX < minZ) pushX += ox1 < ox2 ? -ox1 : ox2;
              else pushZ += oz1 < oz2 ? -oz1 : oz2;
              blocked = true;
            }
          }
          v.pos.x = newX + pushX;
          v.pos.z = newZ + pushZ;
        } else {
          v.pos.x += stepX;
          v.pos.z += stepZ;
          this._collideFallback(v);
        }
      }
  
      // Bounce / slow on collision
      if (blocked && curSpd > 2) {
        v.speed *= 0.4;
        v.lateralVel *= 0.2;
        if (curSpd > 5) this._pushPlayerNearby(v, curSpd);
      } else {
        this._pushPlayerNearby(v, curSpd);
      }
  
      // World bounds
      const B = this.world.bounds || 1600;
      v.pos.x = THREE.MathUtils.clamp(v.pos.x, -B, B);
      v.pos.z = THREE.MathUtils.clamp(v.pos.z, -B, B);
  
      // Rapier kinematic body sync
      if (v.rapierBody && this.physics) {
        this.physics.updateVehicleBody(v.rapierBody, v.pos.x, v.def.elevation || 0, v.pos.z, this._worldYaw(v));
      }
  
      // Apply transform (same orientation parked and driven — no 180° snap)
      v.root.position.set(v.pos.x, v.def.elevation || 0, v.pos.z);
      v.root.rotation.y = this._worldYaw(v);
  
  
    }

    // ===== WHEEL MECHANICS — per-wheel steering + radius-correct spin =====
    // Integrate travelled distance once, then divide by each actual GLB tyre radius.
    v.wheelTravel = (v.wheelTravel || 0) - (v.speed * dt);
    if (v.wheels && v.wheels.length) {
      const visualTune = v.physicsProfile || CAR_PHYSICS[v.kind] || CAR_PHYSICS.lambo;
      const visualSteeringScale = THREE.MathUtils.clamp(
        1 - curSpd * (visualTune.speedSteeringFalloff ?? 0.008),
        visualTune.minSteeringScale ?? 0.4,
        1,
      );
      const steerAngle = steerInput * (handbrake
        ? (visualTune.handbrakeSteerAngle ?? 0.4)
        : (visualTune.steeringAngle ?? 0.28)) * visualSteeringScale;
      const wheelSteerBlend = 1 - Math.exp(-Math.max(8, (visualTune.steeringResponse || 10) * 1.5) * Math.min(Math.max(dt, 0), 0.05));
      for (const w of v.wheels) {
        if (w.front) {
          const targetSteer = -steerAngle;
          w.pivot.rotation.y += (targetSteer - w.pivot.rotation.y) * wheelSteerBlend;
        }
        const spin = v.wheelTravel / Math.max(0.18, w.radius || 0.42);
        if (w.axle === 'z') w.spinner.rotation.z = spin;
        else w.spinner.rotation.x = spin;
      }
    }

    // Engine sound
    if (curSpd > 0.5 && this.audio && this.audio.engine) {
      this.audio.engine(Math.min(1, curSpd / 35));
    }

    // ===== CAMERA — free 360° mouse look (yaw unbounded, wide pitch) =====
    const mdx = input.mouseDX || 0;
    const mdy = input.mouseDY || 0;
    this._lookYaw -= mdx * 0.003;
    this._lookPitch = THREE.MathUtils.clamp(this._lookPitch - mdy * 0.003, -0.9, 1.1);
    input.mouseDX = 0; input.mouseDY = 0;

    const totalYaw = this._worldYaw(v) + this._lookYaw;
    const cx = -Math.sin(totalYaw), cz = -Math.cos(totalYaw);

    const turnAmount = Math.abs(steerInput);
    const camDist = 5.5 - turnAmount * 0.8 + Math.min(1.5, curSpd * 0.04);
    const camH = 2.8 + this._lookPitch * 2.2;

    const tPos = new THREE.Vector3(v.pos.x - cx * camDist, camH, v.pos.z - cz * camDist);
    const tLook = new THREE.Vector3(v.pos.x + cx * 4.5, 1.0, v.pos.z + cz * 4.5);

    if (!this._camPos) { this._camPos = tPos.clone(); this._camLook = tLook.clone(); }
    this._camPos.lerp(tPos, Math.min(1, dt * 14));
    this._camLook.lerp(tLook, Math.min(1, dt * 12));
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camLook);

    const tfov = 62 + Math.min(10, curSpd * 0.25);
    if (Math.abs(this.camera.fov - tfov) > 0.05) {
      this.camera.fov += (tfov - this.camera.fov) * Math.min(1, dt * 5);
      this.camera.updateProjectionMatrix();
    }

    player.pos.set(v.pos.x, 0.5, v.pos.z);
    player.yaw = this._worldYaw(v);
    if (this.physics) this.physics.setPlayerPosition(player.pos.x, player.pos.y, player.pos.z);

    // Speedometer
    this._drawSpeedometer(curSpd * 3.6, v.kind);
  }

  _pushPlayerNearby(v, absSpd) {
    if (!this._lastPlayerRef) return;
    const player = this._lastPlayerRef;
    if (absSpd <= 2 || this.driver) return;
    const r = 2.8;
    const pdx = player.pos.x - v.pos.x, pdz = player.pos.z - v.pos.z;
    const pd2 = pdx * pdx + pdz * pdz;
    if (pd2 < r * r && pd2 > 0.01) {
      const pd = Math.sqrt(pd2);
      const pushStrength = absSpd * (v.mass / 1500) * 0.12;
      player.vel.x += (pdx / pd) * pushStrength;
      player.vel.z += (pdz / pd) * pushStrength;
      player.vel.y += Math.min(absSpd * 0.06, 3);
      player.onGround = false;
      v.speed *= 0.7;
      v.pushForce = absSpd * 0.3;
    }
  }

  _collideFallback(v) {
    const r = 2.8;
    const absSpd = Math.abs(v.speed);
    const candidates = this.world.bvhWorld
      ? this.world.bvhWorld.queryRadius(v.pos.x, v.pos.z, r + 2)
      : (this.world.colliders || []);
    for (const c of candidates) {
      if (v.parkedCol && c === v.parkedCol) continue;
      if (c.max.y < 0.1) continue;
      const cx = Math.max(c.min.x, Math.min(v.pos.x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(v.pos.z, c.max.z));
      const dx = v.pos.x - cx, dz = v.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      v.pos.x += (dx / d) * (r - d);
      v.pos.z += (dz / d) * (r - d);
      const impulse = absSpd * 0.5;
      v.speed *= Math.max(0.2, 1 - impulse * 0.08);
      v.pushForce = impulse;
    }
  }

  setPlayerRef(player) {
    this._lastPlayerRef = player;
  }
}
