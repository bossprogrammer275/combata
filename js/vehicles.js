// VehicleSystem — GTA-style arcade driving with real physics feel + speedometer.
import * as THREE from 'three';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { prefetch } from './model-loader.js';

export const CAR_MODELS = {
  // nose: -1 = model nose faces local -Z (three.js forward convention),
  //        +1 = nose faces local +Z (compensated with a PI yaw offset).
  lambo:  { url: './data/models/cars/CAR Model by Ignition Labs - 5zUWP5UsLg-.glb', targetLen: 4.7, color: 0xda2828, nose: 1 },
  cybertruck: { url: './data/models/cars/tesla_cybertruk_low_poly/scene.gltf', targetLen: 5.7, color: 0x888888, nose: 1 },
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

  _drawSpeedometer(kmh) {
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
    const maxSpeed = 160;
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
    for (const s of this.world.vehicleSpawns || []) this.spawn(s);
  }

  // Fitted, yaw-aware footprint AABB for a parked vehicle (root space -> world).
  _parkedAABB(v) {
    const e = rotBoxXZ(v.bodyBox, v.yaw + v.yawOffset, {});
    const cx = (e.minX + e.maxX) / 2 + v.pos.x;
    const cz = (e.minZ + e.maxZ) / 2 + v.pos.z;
    return {
      x: cx, y: v.bodyBox.min.y + (v.def.elevation || 0), z: cz,
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
      this.physics.updateVehicleBody(v.rapierBody, v.pos.x, v.def.elevation || 0, v.pos.z, v.yaw + v.yawOffset);
    }
  }

  _removeParkedCollider(v) {
    if (!v.parkedCol) return;
    const i = this.world.colliders.indexOf(v.parkedCol);
    if (i >= 0) this.world.colliders.splice(i, 1);
    if (this.world.bvhWorld) this.world.bvhWorld.removeAABB(v.parkedCol);
    v.parkedCol = null;
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
      // Re-resolve wheel rigs on the CLONE (base refs point at base nodes).
      const wheels = [];
      clone.traverse((o) => {
        if (o.userData && o.userData.wheelPivot) {
          const spinner = (o.children || []).find((c) => c.userData && c.userData.wheelSpinner) || null;
          if (!spinner) return;
          wheels.push({
            pivot: o,
            spinner,
            axle: o.userData.wheelPivot.axle || 'x',
            front: !!o.userData.wheelPivot.front,
            center: o.position.clone(),
            meshes: spinner.children.filter((c) => c.isMesh),
          });
        }
      });

      // Parked orientation matches driving orientation exactly (no 180° snap).
      const yaw = def.ry || 0;
      root.position.set(def.x, def.elevation || 0, def.z);
      root.rotation.y = yaw + yawOffset;
      this.scene.add(root);

      const v = {
        def, root, rapierBody: null, kind, wheels, colBoxes, bodyBox, half,
        yawOffset, parkedCol: null,
        pos: new THREE.Vector3(def.x, def.elevation || 0, def.z),
        yaw,
        speed: 0,
        steerAngle: 0,
        lateralVel: 0,
        mass: 1500,
        pushForce: 0,
      };

      // Kinematic Rapier body with model-fitted compound colliders. It blocks
      // the player while parked AND while driven; manual AABBs handle car/world.
      if (this.physics && this.physics.world) {
        try {
          const rapierBoxes = colBoxes
            .filter((b) => {
              const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
              return Math.min(sx, sy, sz) > 0.05 && (sx * sy * sz) > 0.0006;
            })
            .sort((a, b2) => {
              const va = (a.max.x - a.min.x) * (a.max.y - a.min.y) * (a.max.z - a.min.z);
              const vb = (b2.max.x - b2.min.x) * (b2.max.y - b2.min.y) * (b2.max.z - b2.min.z);
              return vb - va;
            })
            .slice(0, 220);
          v.rapierBody = this.physics.createVehicleBody(
            def.x, def.elevation || 0, def.z, yaw + yawOffset, rapierBoxes);
        } catch (e) { console.warn('[Vehicle] Rapier body failed:', e); }
      }

      this.vehicles.push(v);
      this._addParkedCollider(v);
      console.log('[Vehicle] Spawned car (' + kind + ') at', def.x, def.z, '- boxes:', colBoxes.length, 'wheels:', wheels.length);
    } catch (e) {
      console.error('[Vehicle] Spawn failed:', e);
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
    this._lookYaw = 0;
    this._lookPitch = 0.2;
    const totalYaw = veh.yaw + this._lookYaw;
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
    this._lookYaw = 0;
    this._lookPitch = 0.2;
    const totalYaw = veh.yaw + this._lookYaw;
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
    player.pos.set(veh.pos.x + Math.cos(veh.yaw) * 3, 0.5, veh.pos.z - Math.sin(veh.yaw) * 3);
    player.vel.set(0, 0, 0);
    player.onGround = true;
    player.yaw = veh.yaw + Math.PI;
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
      const tx = veh.pos.x + Math.cos(veh.yaw) * -2.5;
      const tz = veh.pos.z - Math.sin(veh.yaw) * -2.5;
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
    const steerInput = input.right || 0;
    const handbrake = !!input.jump;
    const absSpd = Math.abs(v.speed);

    // ===== LONGITUDINAL: engine / brake / drag =====
    if (throttle > 0) {
      if (v.speed < 0) {
        v.speed += 30 * dt;
      } else {
        const topSpeed = 40;
        const powerFade = 1 - (v.speed / topSpeed) * 0.5;
        v.speed += 24 * dt * Math.max(0.15, powerFade);
      }
    } else if (throttle < 0) {
      if (v.speed > 1) {
        v.speed -= 28 * dt;
      } else {
        v.speed -= 10 * dt;
      }
    } else {
      if (absSpd > 0.1) {
        const dragCoeff = 1.5 + (absSpd / 40) * (absSpd / 40) * 3;
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
    v.speed = THREE.MathUtils.clamp(v.speed, -9, 40);

    const curSpd = Math.abs(v.speed);
    const fwd = v.speed >= 0 ? 1 : -1;

    // ===== STEERING + TIRE GRIP =====
    // Bicycle-model steering: wheel angle creates curvature, so steering
    // naturally tightens at low speed and opens up as speed rises.
    const wheelAngle = steerInput * (handbrake ? 0.34 : 0.20);
    if (curSpd > 0.25) {
      const wheelbase = 2.7;
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
    const wYaw = v.yaw + (v.yawOffset || 0);
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
      this.physics.updateVehicleBody(v.rapierBody, v.pos.x, v.def.elevation || 0, v.pos.z, v.yaw + (v.yawOffset || 0));
    }

    // Apply transform (same orientation parked and driven — no 180° snap)
    v.root.position.set(v.pos.x, v.def.elevation || 0, v.pos.z);
    v.root.rotation.y = v.yaw + (v.yawOffset || 0);

    // ===== WHEEL MECHANICS — steer (front) + rolling spin =====
    // Spin rate from signed speed and a nominal 0.42m wheel radius.
    v.wheelSpin = (v.wheelSpin || 0) - (v.speed * dt) / 0.42;
    if (v.wheels && v.wheels.length) {
      const steerAngle = curSpd > 0.5 ? steerInput * 0.42 : 0;
      for (const w of v.wheels) {
        if (w.front) w.pivot.rotation.y = steerAngle;
        if (w.axle === 'z') w.spinner.rotation.z = v.wheelSpin;
        else w.spinner.rotation.x = v.wheelSpin;
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

    const totalYaw = v.yaw + this._lookYaw;
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
    player.yaw = v.yaw;
    if (this.physics) this.physics.setPlayerPosition(player.pos.x, player.pos.y, player.pos.z);

    // Speedometer
    this._drawSpeedometer(curSpd * 3.6);
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
