// VehicleSystem — GTA-style arcade driving with real physics feel + speedometer.
import * as THREE from 'three';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { loadAssetOverrides, applyAssetOverrides } from './asset-overrides.js';
import {
  VEHICLE_COORDINATES,
  ackermannSteerAngle, updateChaseLook, updateReverseCameraBlend, chaseCameraYaw,
  getBridgeAwareChaseHeights,
} from './vehicle-steering.js';
import {
  clampCockpitCameraValue, COCKPIT_CAMERA_SETTING_KEYS,
  getCockpitLookAngles, resolveCockpitCameraProfile,
} from './vehicle-cockpit.js';

export { VEHICLE_COORDINATES };

export const CAR_MODELS = {
  // The source GLBs use +Y up and +Z forward. The runtime applies the
  // renderer's one-time nose correction at the vehicle root.
  lambo: { url: './data/models/cars/CAR Model by Ignition Labs - 5zUWP5UsLg-.glb', targetLen: 4.7, color: 0xda2828, nose: 1 },
  cybertruck: { url: './data/models/cars/tesla_cybertruk_low_poly/scene.gltf', targetLen: 5.7, color: 0x888888, nose: 1 },
  bugatti: { url: './data/models/cars/2021_bugatti_chiron_pur_sport/scene.gltf', targetLen: 4.647, color: 0x111820, nose: 1 },
  escalade: { url: './data/models/cars/cadillac_escalade_2006/scene.gltf', targetLen: 5.624, color: 0x17191c, nose: 1 },
};

// Physical values are tuning baselines, not claims of laboratory measurement.
// Wheel hardpoints and tyre radii are measured from the imported GLB and checked
// against each profile before a vehicle is allowed into the world.
export const CAR_PHYSICS = {
  lambo: {
    mass: 1620,
    drivetrain: 'rwd',
    wheelbase: 2.62,
    trackFront: 1.668,
    trackRear: 1.620,
    wheelRadiusFront: 0.3275,
    wheelRadiusRear: 0.3455,
    weightFront: 0.42,
    centerOfMassHeight: 0.46,
    inertiaScale: 0.85,
    brakeBias: 0.62,
    powertrain: {
      type: 'dct',
      torqueModel: 'gallardo-v10',
      // The Gallardo e-gear prototype and real gearbox are six-speed.
      gearRatios: [3.15, 2.18, 1.58, 1.20, 0.97, 0.82],
      finalDrive: 4.20,
      wheelRadius: 0.34,
      idleRpm: 900,
      redline: 8500,
      upshiftRpm: 8000,
      upshiftRpmLowLoad: 3200,
      upshiftRpmFullLoad: 8200,
      upshiftThrottleThreshold: 0.15,
      downshiftRpm: 2300,
      downshiftRpmLowLoad: 2300,
      downshiftRpmHighLoad: 5200,
      downshiftRpmBraking: 3800,
      downshiftTorqueRetention: 1,
      shiftTime: 0.24,
      peakTorqueNm: 540,
      drivetrainEfficiency: 0.90,
      maxAcceleration: 16.5,
      torqueCurve: [[900, 361], [2000, 400], [3000, 432], [4000, 464], [5000, 495], [6500, 540], [7500, 497], [8000, 475], [8500, 454]],
    },
    interiorCamera: { height: 0.98, forward: 0.16, side: 0, lookAhead: 18, pitch: 0, fov: 82 },
    steeringWheel: { axis: 'x', maxAngleDeg: 450, sign: 1, response: 11 },
    engineAcceleration: 11.8,
    reverseAcceleration: 9.5,
    reverseGripUsageLimit: 0.95,
    brakeAcceleration: 16.0,
    maxSpeed: 328 / 3.6,
    maxReverseSpeed: 15.0,
    speedometerMaxKmh: 325,
    aeroDragArea: 0.78,
    rollingResistance: 0.015,
    speedSteeringFalloff: 0.0105,
    minSteeringScale: 0.30,
    steeringResponse: 15.0,
    antiRollStiffness: 30000,
    downforceCoefficient: 0.38,
    maxDownforceG: 0.22,
    driveGripUsageLimit: 0.88,
    brakingGripUsageLimit: 0.96,
    handbrakeGripUsageLimit: 0.78,
    steeringAngle: 0.56,
    handbrakeSteerAngle: 0.56,
    frontGrip: 8.4,
    rearGrip: 9.5,
    handbrakeRearGrip: 0.48,
    frontCorneringStiffness: 72000,
    rearCorneringStiffness: 79000,
    tireFriction: 1.35,
    handbrakeRearFriction: 0.38,
    suspensionRestLength: 0.16,
    suspensionTravel: 0.08,
    springRateFront: 53700,
    springRateRear: 89800,
    suspensionDampingRatio: 0.35,
    suspensionResponse: 32,
    uprightStrength: 3.8,
    uprightDamping: 4.3,
    angularDamping: 0.90,
    highSpeedYawDamping: 0.75,
  },
  cybertruck: {
    mass: 3150,
    drivetrain: 'awd',
    wheelbase: 3.635,
    trackFront: 1.74,
    trackRear: 1.74,
    wheelRadiusFront: 0.419,
    wheelRadiusRear: 0.419,
    weightFront: 0.505,
    centerOfMassHeight: 0.75,
    inertiaScale: 0.85,
    brakeBias: 0.60,
    powertrain: {
      type: 'ev',
      maxMotorTorque: 1520,
      peakPowerKw: 470,
      maxDriveForceN: 33500,
      maxRegenForceN: 9000,
      maxRegenPowerKw: 110,
      brakeForceN: 16000,
      driveCutKmh: 209,
      defaultDriveMode: 'beast',
      modes: {
        beast: { peakPowerKw: 470, maxDriveForceN: 33500, motorCount: 3 },
        awd: { peakPowerKw: 224, maxDriveForceN: 26000, motorCount: 2 },
      },
      finalDrive: 10.0,
      wheelRadius: 0.419,
      maxAcceleration: 15.0,
      regenDeceleration: 1.15,
      drivetrainEfficiency: 0.92,
      torqueCurve: [[0, 1520], [4500, 1520], [9000, 1520], [14000, 1520], [18000, 0]],
    },
    interiorCamera: { height: 1.42, forward: 0.30, side: 0, lookAhead: 20, pitch: 0, fov: 82 },
    steeringWheel: { axis: 'x', maxAngleDeg: 450, sign: 1, response: 9 },
    engineAcceleration: 12.8,
    reverseAcceleration: 7.2,
    brakeAcceleration: 15.5,
    maxSpeed: 60,
    maxReverseSpeed: 15.0,
    speedometerMaxKmh: 216,
    aeroDragArea: 1.22,
    rollingResistance: 0.020,
    speedSteeringFalloff: 0.0075,
    minSteeringScale: 0.50,
    steeringResponse: 20.0,
    antiRollStiffness: 60000,
    antiRollLoadTransferLimit: 0.22,
    downforceCoefficient: 0,
    maxDownforceG: 0,
    frontDriveBias: 0.50,
    driveGripUsageLimit: 0.80,
    brakingGripUsageLimit: 0.97,
    handbrakeGripUsageLimit: 0.76,
    steeringAngle: 0.58,
    handbrakeSteerAngle: 0.55,
    frontGrip: 9.2,
    rearGrip: 9.8,
    handbrakeRearGrip: 0.62,
    frontCorneringStiffness: 92000,
    rearCorneringStiffness: 99000,
    tireFriction: 1.08,
    reverseGripUsageLimit: 0.92,
    handbrakeRearFriction: 0.46,
    suspensionRestLength: 0.30,
    suspensionTravel: 0.14,
    springRateFront: 53000,
    springRateRear: 52000,
    suspensionDampingRatio: 0.40,
    suspensionResponse: 32,
    uprightStrength: 4.8,
    uprightDamping: 5.6,
    rollUprightStrength: 9.0,
    rollUprightDamping: 8.5,
    angularDamping: 1.0,
    highSpeedYawDamping: 0.85,
  },
  bugatti: {
    mass: 1995,
    drivetrain: 'awd',
    wheelbase: 2.711,
    trackFront: 1.776,
    trackRear: 1.695,
    wheelRadiusFront: 0.3395,
    wheelRadiusRear: 0.35545,
    weightFront: 0.45,
    centerOfMassHeight: 0.47,
    inertiaScale: 0.92,
    brakeBias: 0.62,
    powertrain: {
      type: 'dct',
      gearRatios: [3.10, 2.10, 1.55, 1.20, 0.98, 0.87, 0.80],
      finalDrive: 3.30,
      wheelRadius: 0.35,
      idleRpm: 750,
      redline: 7000,
      upshiftRpm: 6700,
      upshiftRpmLowLoad: 3000,
      upshiftRpmFullLoad: 6700,
      upshiftThrottleThreshold: 0.15,
      downshiftRpm: 1900,
      downshiftRpmLowLoad: 1900,
      downshiftRpmHighLoad: 3400,
      downshiftTorqueRetention: 0.12,
      shiftTime: 0.17,
      peakTorqueNm: 1600,
      drivetrainEfficiency: 0.90,
      maxAcceleration: 16.2,
      shiftTorqueRetention: 0.12,
      // The W16's boost is not instantaneous: its spool state feeds both
      // low-RPM torque delivery and the authored turbo whistle/bov sound layers.
      turboBoost: {
        spoolStartRpm: 1400,
        fullSpoolRpm: 4000,
        spoolUpBase: 0.8,
        spoolDownRate: 3.2,
        maxBoostBar: 1.8,
        torqueModel: 'chiron-w16',
      },
      torqueCurve: [
        [750, 420], [1000, 700], [1500, 1200], [2000, 1600],
        [3000, 1600], [4500, 1600], [6000, 1600], [6700, 1570],
        [6900, 1510], [7000, 1200],
      ],
    },
    interiorCamera: { height: 0.94, forward: 0.34, side: 0.0, lookAhead: 20, pitch: 0, fov: 82 },
    steeringWheel: { axis: 'x', maxAngleDeg: 450, sign: 1, response: 11 },
    engineAcceleration: 13.8,
    reverseAcceleration: 8.5,
    reverseGripUsageLimit: 0.92,
    brakeAcceleration: 20.0,
    maxSpeed: 97.22,
    maxReverseSpeed: 15.0,
    speedometerMaxKmh: 350,
    aeroDragArea: 0.92,
    rollingResistance: 0.014,
    speedSteeringFalloff: 0.008,
    minSteeringScale: 0.26,
    steeringResponse: 17.0,
    antiRollStiffness: 56000,
    downforceCoefficient: 0.78,
    maxDownforceG: 0.40,
    driveGripUsageLimit: 0.86,
    brakingGripUsageLimit: 0.98,
    handbrakeGripUsageLimit: 0.72,
    frontDriveBias: 0.38,
    steeringAngle: 0.54,
    handbrakeSteerAngle: 0.50,
    frontGrip: 10.8,
    rearGrip: 11.4,
    handbrakeRearGrip: 0.58,
    frontCorneringStiffness: 104000,
    rearCorneringStiffness: 114000,
    tireFriction: 1.52,
    handbrakeRearFriction: 0.48,
    suspensionRestLength: 0.11,
    suspensionTravel: 0.075,
    springRateFront: 74000,
    springRateRear: 88000,
    suspensionDampingRatio: 0.52,
    suspensionResponse: 34,
    uprightStrength: 4.4,
    uprightDamping: 5.0,
    angularDamping: 0.98,
    highSpeedYawDamping: 0.82,
  },
  escalade: {
    // 2006 Escalade ESV AWD curb weight and chassis dimensions. The bundled
    // Sketchfab model's source file identifies the ESV body; the profile uses
    // the ESV wheelbase and track measurements, not the sports-car defaults.
    mass: 2613,
    drivetrain: 'awd',
    wheelbase: 3.302,
    trackFront: 1.651,
    trackRear: 1.676,
    wheelRadiusFront: 0.401,
    wheelRadiusRear: 0.401,
    weightFront: 0.53,
    centerOfMassHeight: 0.78,
    inertiaScale: 1.18,
    brakeBias: 0.62,
    powertrain: {
      type: 'automatic',
      // Hydra-Matic 4L65-E four-speed automatic with AWD transfer case.
      gearRatios: [3.06, 1.63, 1.00, 0.70],
      finalDrive: 3.73,
      wheelRadius: 0.401,
      idleRpm: 600,
      redline: 5600,
      upshiftRpm: 5200,
      upshiftRpmLowLoad: 2600,
      upshiftRpmFullLoad: 5100,
      upshiftThrottleThreshold: 0.15,
      downshiftRpm: 1800,
      downshiftRpmLowLoad: 1700,
      downshiftRpmHighLoad: 3400,
      downshiftRpmBraking: 3000,
      downshiftTorqueRetention: 0.45,
      shiftTime: 0.34,
      peakTorqueNm: 515,
      drivetrainEfficiency: 0.86,
      maxAcceleration: 5.8,
      torqueCurve: [
        [600, 275], [1000, 335], [1500, 405], [2000, 445],
        [2800, 480], [3400, 505], [4000, 515], [4500, 500],
        [5000, 480], [5200, 472], [5500, 430], [5600, 0],
      ],
    },
    interiorCamera: { height: 1.36, forward: 0.38, side: 0, lookAhead: 20, pitch: 0, fov: 82 },
    steeringWheel: { axis: 'x', maxAngleDeg: 450, sign: 1, response: 8.5 },
    engineAcceleration: 6.4,
    reverseAcceleration: 4.0,
    brakeAcceleration: 10.5,
    maxSpeed: 50,
    maxReverseSpeed: 11,
    speedometerMaxKmh: 180,
    aeroDragArea: 1.18,
    rollingResistance: 0.018,
    speedSteeringFalloff: 0.009,
    minSteeringScale: 0.42,
    steeringResponse: 9.0,
    antiRollStiffness: 52000,
    downforceCoefficient: 0,
    maxDownforceG: 0,
    frontDriveBias: 0.50,
    driveGripUsageLimit: 0.82,
    brakingGripUsageLimit: 0.96,
    handbrakeGripUsageLimit: 0.70,
    steeringAngle: 0.45,
    handbrakeSteerAngle: 0.40,
    frontGrip: 7.8,
    rearGrip: 8.4,
    handbrakeRearGrip: 0.55,
    frontCorneringStiffness: 85000,
    rearCorneringStiffness: 90000,
    tireFriction: 1.14,
    handbrakeRearFriction: 0.44,
    suspensionRestLength: 0.26,
    suspensionTravel: 0.17,
    springRateFront: 62000,
    springRateRear: 68000,
    suspensionDampingRatio: 0.62,
    suspensionResponse: 20,
    uprightStrength: 3.8,
    uprightDamping: 4.8,
    angularDamping: 1.15,
    highSpeedYawDamping: 0.92,
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

// Car source files are persisted by the service worker. Avoid the old
// model-loader prefetch here: its raw buffers were not consumed by this
// dedicated GLTFLoader, so it fetched large car files a second time.
const loader = new GLTFLoader();
const _modelCache = Object.create(null);
const _modelLoadPromises = new Map();
const _modelLoadQueue = [];
const MODEL_DEVICE_MEMORY_GB = typeof navigator !== 'undefined'
  ? (Number(navigator.deviceMemory) || 4)
  : 4;
const MODEL_HARDWARE_THREADS = typeof navigator !== 'undefined'
  ? (Number(navigator.hardwareConcurrency) || 2)
  : 2;
// A single GLTF parse at a time avoids memory spikes and main-thread stalls on
// 4 GB / dual-core laptops. Better hardware can decode two or three in parallel.
const MODEL_DECODE_CONCURRENCY = MODEL_DEVICE_MEMORY_GB <= 4 || MODEL_HARDWARE_THREADS <= 4
  ? 1
  : MODEL_DEVICE_MEMORY_GB <= 8 ? 2 : 3;
let _activeModelLoads = 0;

function drainCarModelQueue() {
  while (_activeModelLoads < MODEL_DECODE_CONCURRENCY && _modelLoadQueue.length) {
    const task = _modelLoadQueue.shift();
    _activeModelLoads++;
    _loadCarModelUncached(task.kind).then(task.resolve, task.reject).finally(() => {
      _activeModelLoads--;
      drainCarModelQueue();
    });
  }
}

function enqueueCarModelLoad(kind) {
  return new Promise((resolve, reject) => {
    _modelLoadQueue.push({ kind, resolve, reject });
    drainCarModelQueue();
  });
}

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
  // Match Box3.setFromObject for static GLB meshes, but reuse each geometry's
  // local bounds instead of re-walking its vertex buffer on every classifier pass.
  const localBox = new THREE.Box3();
  const worldBox = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry;
    if (!geometry?.attributes?.position) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
    localBox.copy(geometry.boundingBox);
    worldBox.copy(localBox).applyMatrix4(o.matrixWorld);
    if (worldBox.isEmpty()) return;
    out.push({ o, min: worldBox.min.clone(), max: worldBox.max.clone() });
  });
  return out;
}

function boxSize(b, out) {
  return out.subVectors(b.max, b.min);
}

// Classify meshes: ground-blob discs, wheels (+hub hardware), body shell.
// Exported options let the visual calibration harness measure a model before
// deciding whether it needs a vehicle-specific size allowance.
export function getWheelClassificationOptions(kind) {
  if (kind === 'escalade') {
    return {
      // Its material-wide tyre/rim meshes are first split into four real corners.
      // Allow those authored tyre/rim layers to group around the measured hubs.
      wheelMemberRadius: 0.48,
      wheelMemberMaxSize: 1.10,
      wheelMemberHeightTolerance: 0.55,
      wheelCandidateMaxSize: 1.15,
    };
  }
  if (kind === 'bugatti') {
    return {
      // The Chiron asset stores its four road wheels as a single front-left
      // assembly. Runtime clones that assembly to measured Pur Sport hardpoints.
      // Its rim/tyre detail is grouped with a tighter bound than the Cybertruck.
      wheelMemberRadius: 0.42,
      wheelMemberMaxSize: 1.05,
      wheelMemberHeightTolerance: 0.48,
      wheelCandidateMaxSize: 1.05,
      // This is a ground-contacting car, not a display asset; low body panels
      // must not be mistaken for standalone display-stand discs.
      disableBlobFilter: true,
    };
  }
  return kind === 'cybertruck'
    ? {
      // Cybertruck wheels are ~0.92m tall and their split outer tyre pieces sit
      // up to ~0.42m from the selected hub mesh. Group those pieces with the rim.
      // Keep this allowance per vehicle; the smaller sports-car radius stays 0.30m.
      wheelMemberRadius: 0.45,
      wheelMemberMaxSize: 1.15,
      wheelMemberHeightTolerance: 1.05,
      // The circumference is also authored as many tiny, separate meshes.
      // Find these by their radial position in the wheel plane, not 3D hub distance.
      wheelTreadFragmentMaxSize: 0.16,
      wheelTreadFragmentMinRadiusRatio: 0.88,
      wheelTreadFragmentMaxRadiusRatio: 1.12,
      wheelTreadFragmentAxialPadding: 0.05,
    }
    : {};
}

function meshHierarchyName(mesh) {
  const names = [];
  let node = mesh;
  while (node) {
    if (node.name) names.push(node.name);
    node = node.parent;
  }
  return names.reverse().join(' / ') || '(unnamed mesh)';
}

function classifyCarMeshes(items, options = {}) {
  const modelNose = Number.isFinite(options.nose) ? (Math.sign(options.nose) || -1) : -1;
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
    if (options.disableBlobFilter !== true
      && m.s.y < 0.12
      && Math.max(m.s.x, m.s.z) > 0.45 * maxHoriz
      && (m.min.y - all.min.y) < 0.15) blobs.add(m.o);
  }
  // Wheel candidates: round in side view, thin across the axle, low on the body.
  // Wheel candidates must sit low and near the left/right outer edges. Round
  // steering wheels, dashboard rings and cabin trim can resemble tyres in a
  // bounding-box test, but they are close to the centreline and must be excluded.
  const cx0 = (all.min.x + all.max.x) / 2, cz0 = (all.min.z + all.max.z) / 2;
  const candidateDiagnostics = [];
  const candidateByMesh = new Map();
  const cands = annotated.filter((m) => {
    const reasons = [];
    if (blobs.has(m.o)) reasons.push('display-stand');
    if (m.o.userData?.staticVehicleHardware) reasons.push('static-vehicle-hardware');
    const hierarchyName = meshHierarchyName(m.o);
    if (/(steer|dashboard|cockpit|interior|instrument|seat|pedal|gear.?shift)/i.test(hierarchyName)) reasons.push('interior-or-steering-hierarchy');
    if (m.s.y < 0.30) reasons.push('diameter-below-0.30m');
    if (m.s.y > 1.05) reasons.push('diameter-above-1.05m');
    if ((m.c.y - all.min.y) > 0.40 * total.y) reasons.push('mounted-too-high');
    const lateralRatio = Math.abs(m.c.x - cx0) / Math.max(0.001, total.x * 0.5);
    if (lateralRatio < (options.wheelSideRatio ?? 0.52)) reasons.push('too-close-to-centreline');
    const side = Math.max(m.s.x, m.s.z);
    if (Math.abs(m.s.y - side) > 0.38 * m.s.y) reasons.push('not-round-in-side-view');
    if (Math.min(m.s.x, m.s.z) > 0.8 * m.s.y) reasons.push('not-thin-across-axle');
    if (side > (options.wheelCandidateMaxSize ?? 1.15)) reasons.push('candidate-exceeds-vehicle-wheel-size-limit');
    const record = {
      uuid: m.o.uuid,
      name: m.o.name || '(unnamed mesh)',
      hierarchy: hierarchyName,
      center: m.c.toArray(),
      size: m.s.toArray(),
      sideDiameter: side,
      lateralRatio,
      candidate: reasons.length === 0,
      rejectedReasons: reasons,
    };
    candidateDiagnostics.push(record);
    candidateByMesh.set(m.o, record);
    return reasons.length === 0;
  });
  // One wheel per XZ quadrant around the model center.
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
  const wheelMemberRadius = options.wheelMemberRadius ?? 0.30;
  const wheelMemberMaxSize = options.wheelMemberMaxSize ?? 1.15;
  const wheelMemberHeightTolerance = options.wheelMemberHeightTolerance ?? 0.35;
  const wheelTreadFragmentMaxSize = options.wheelTreadFragmentMaxSize ?? 0;
  const wheelTreadFragmentMinRadiusRatio = options.wheelTreadFragmentMinRadiusRatio ?? 0.88;
  const wheelTreadFragmentMaxRadiusRatio = options.wheelTreadFragmentMaxRadiusRatio ?? 1.12;
  const wheelTreadFragmentAxialPadding = options.wheelTreadFragmentAxialPadding ?? 0.05;
  if (wheels.length === 4) {
    // Hub parts are grouped by distance. Split tread segments are different:
    // they sit around the wheel's outer circumference with an axle offset.
    for (const w of wheels) {
      const axleIndex = w.best.s.x <= w.best.s.z ? 0 : 2;
      const radialAxes = axleIndex === 0 ? [1, 2] : [0, 1];
      const wheelRadius = Math.max(
        w.best.s.getComponent(radialAxes[0]),
        w.best.s.getComponent(radialAxes[1]),
      ) * 0.5;
      const axialTolerance = w.best.s.getComponent(axleIndex) * 0.5 + wheelTreadFragmentAxialPadding;
      const members = annotated.filter((m) => {
        if (blobs.has(m.o) || m.o.userData?.staticVehicleHardware) return false;
        const maxDimension = Math.max(m.s.x, m.s.y, m.s.z);
        const centerDistance = m.c.distanceTo(w.best.c);
        const hubMember = centerDistance < wheelMemberRadius
          && Math.abs(m.c.y - w.best.c.y) < wheelMemberHeightTolerance
          && maxDimension < wheelMemberMaxSize
          && m.s.y < wheelMemberMaxSize;
        const radialDistance = Math.hypot(
          m.c.getComponent(radialAxes[0]) - w.best.c.getComponent(radialAxes[0]),
          m.c.getComponent(radialAxes[1]) - w.best.c.getComponent(radialAxes[1]),
        );
        const axialDistance = Math.abs(
          m.c.getComponent(axleIndex) - w.best.c.getComponent(axleIndex),
        );
        const treadFragment = wheelTreadFragmentMaxSize > 0
          && maxDimension <= wheelTreadFragmentMaxSize
          && axialDistance <= axialTolerance
          && radialDistance >= wheelRadius * wheelTreadFragmentMinRadiusRatio
          && radialDistance <= wheelRadius * wheelTreadFragmentMaxRadiusRatio;
        if (!hubMember && !treadFragment) return false;
        m.wheelMemberType = treadFragment && !hubMember ? 'tread-fragment' : 'hub';
        return true;
      });
      for (const m of members) wheelMeshes.add(m.o);
      const bs = w.best.s;
      const quadrant = (w.qz * modelNose > 0 ? 'front' : 'rear') + '-' + (w.qx > 0 ? 'left' : 'right');
      const wheelInfo = {
        center: w.best.c.clone(),
        size: bs.clone(),
        axle: bs.x <= bs.z ? 'x' : 'z',
        quadrant,
        meshes: members.map((m) => m.o),
        treadFragmentCount: members.filter((m) => m.wheelMemberType === 'tread-fragment').length,
      };
      wheelInfos.push(wheelInfo);
      const selected = candidateByMesh.get(w.best.o);
      if (selected) {
        selected.selected = true;
        selected.selectedQuadrant = quadrant;
      }
      for (const m of members) {
        const record = candidateByMesh.get(m.o);
        if (record) {
          record.attachedToWheel = quadrant;
          record.wheelMemberType = m.wheelMemberType || 'hub';
          record.memberDistance = m.c.distanceTo(w.best.c);
        }
      }
    }
  }
  const nearWheelExcludedMap = new Map();
  if (wheels.length === 4) {
    for (const mesh of annotated) {
      if (blobs.has(mesh.o) || wheelMeshes.has(mesh.o) || mesh.o.userData?.staticVehicleHardware) continue;
      for (const wheel of wheels) {
        const distance = mesh.c.distanceTo(wheel.best.c);
        if (distance > wheelMemberRadius + 0.12) continue;
        const heightDelta = Math.abs(mesh.c.y - wheel.best.c.y);
        const maxDimension = Math.max(mesh.s.x, mesh.s.y, mesh.s.z);
        // Ignore tiny bolts/material fragments; keep only meaningful nearby parts
        // that could change the tyre/rim assembly boundary.
        if (maxDimension < 0.18) continue;
        const reasons = [];
        if (distance >= wheelMemberRadius) reasons.push('outside-wheel-member-radius');
        if (heightDelta >= wheelMemberHeightTolerance) reasons.push('outside-wheel-member-height-tolerance');
        if (maxDimension >= wheelMemberMaxSize) reasons.push('mesh-exceeds-wheel-member-size-limit');
        if (mesh.s.y >= wheelMemberMaxSize) reasons.push('mesh-height-exceeds-wheel-member-size-limit');
        if (!reasons.length) continue;
        const quadrant = (wheel.qz * modelNose > 0 ? 'front' : 'rear') + '-' + (wheel.qx > 0 ? 'left' : 'right');
        const current = nearWheelExcludedMap.get(mesh.o.uuid);
        const record = {
          uuid: mesh.o.uuid,
          name: mesh.o.name || '(unnamed mesh)',
          hierarchy: meshHierarchyName(mesh.o),
          center: mesh.c.toArray(),
          size: mesh.s.toArray(),
          nearestWheel: quadrant,
          distance,
          heightDelta,
          maxDimension,
          rejectedReasons: reasons,
        };
        if (!current || distance < current.distance) nearWheelExcludedMap.set(mesh.o.uuid, record);
      }
    }
  }
  const nearWheelExcludedMeshes = [...nearWheelExcludedMap.values()];
  const body = annotated.filter((m) => !blobs.has(m.o) && !wheelMeshes.has(m.o)
    && !m.o.userData?.staticVehicleHardware && !m.o.userData?.vehicleWheelSource);
  const bodyBox = new THREE.Box3();
  for (const m of body) { bodyBox.expandByPoint(m.min); bodyBox.expandByPoint(m.max); }
  const wheelDiagnostics = {
    totalMeshCount: annotated.length,
    candidateCount: cands.length,
    selectedWheelCount: wheels.length,
    attachedWheelMeshCount: wheelMeshes.size,
    candidateSizeLimit: options.wheelCandidateMaxSize ?? 1.15,
    wheelMemberMaxSize,
    wheelMemberRadius,
    wheelMemberHeightTolerance,
    wheelTreadFragmentMaxSize,
    wheelTreadFragmentMinRadiusRatio,
    wheelTreadFragmentMaxRadiusRatio,
    wheelTreadFragmentAxialPadding,
    treadFragmentMeshCount: wheelInfos.reduce((sum, wheel) => sum + wheel.treadFragmentCount, 0),
    nearWheelExcludedMeshes,
    selectedWheels: wheels.map((w) => {
      const info = wheelInfos.find(v => v.center.distanceTo(w.best.c) < 1e-6);
      return {
        quadrant: (w.qz * modelNose > 0 ? 'front' : 'rear') + '-' + (w.qx > 0 ? 'left' : 'right'),
        uuid: w.best.o.uuid,
        name: w.best.o.name || '(unnamed mesh)',
        center: w.best.c.toArray(),
        size: w.best.s.toArray(),
        meshCount: info ? info.meshes.length : 0,
        treadFragmentCount: info ? info.treadFragmentCount : 0,
        meshNames: info ? info.meshes.map(m => m.name || '(unnamed mesh)') : [],
        meshUUIDs: info ? info.meshes.map(m => m.uuid) : [],
      };
    }),
    meshes: candidateDiagnostics,
  };
  return { all, total, blobs, wheelInfos: wheels.length === 4 ? wheelInfos : [], wheelDiagnostics, bodyBox, hasBody: body.length > 0 };
}

// Re-run the exact production classifier on a normalized model for Asset Lab
// and screenshot-based calibration. No alternate detector is used for reports.
export function diagnoseCarWheelMeshes(scene, kind = 'lambo') {
  const options = { ...getWheelClassificationOptions(kind), nose: CAR_MODELS[kind]?.nose ?? -1 };
  const result = classifyCarMeshes(meshWorldBoxes(scene), options);
  return JSON.parse(JSON.stringify(result.wheelDiagnostics));
}

// Wrap each wheel's meshes in steer -> spin pivots anchored at the hub.
// attach() preserves world transforms, so visuals don't move at all.
// NOTE: pivot.position lives in scene space, so hub centers are converted.
// Soft, local cabin illumination. It is enabled only while the interior camera
// is active, so it does not brighten parked vehicles or leak across the city.
// Vehicle model forward is local +Z after the root's yaw-axis correction.
function createCabinLights(root, kind, cameraProfile = null) {
  const profile = CAR_PHYSICS[kind] || CAR_PHYSICS.lambo;
  const cabin = cameraProfile || profile.interiorCamera || { height: 1.0 };
  const group = new THREE.Group();
  group.name = 'interior-cabin-lights';
  group.visible = false;

  // These are low-intensity fill lights, not visible white lamps. They only
  // lift dark material detail close to the driver; they must never bleach the
  // dashboard, seats or windscreen.
  const dome = new THREE.PointLight(0xd9a875, 2.5, 2.8, 2);
  dome.name = 'cabin-dome-fill';
  dome.position.set(0, cabin.height + 0.12, -0.18);
  dome.castShadow = false;

  const dashboard = new THREE.PointLight(0x9aabc0, 0.45, 1.65, 2);
  dashboard.name = 'cabin-dashboard-fill';
  dashboard.position.set(0, Math.max(0.55, cabin.height - 0.20), 0.58);
  dashboard.castShadow = false;

  group.add(dome, dashboard);
  root.add(group);
  return group;
}

function vehicleNodeKey(root, node) {
  const parts = [];
  let current = node;
  while (current && current !== root) {
    const parent = current.parent;
    const index = parent ? parent.children.indexOf(current) : 0;
    parts.push((current.name || current.type || 'node') + '[' + index + ']');
    current = parent;
  }
  return parts.reverse().join('/');
}

const STEERING_WHEEL_NAME = /(steering[\s_-]*wheel|wheel[\s_-]*steering|steer[\s_-]*wheel|volant|lenkrad)/i;

export function rigSteeringWheel(scene, config = {}, toLocal = (value) => value.clone()) {
  const configuredKeys = Array.isArray(config.meshKeys) ? config.meshKeys.filter(Boolean) : [];
  const byKey = new Map();
  scene.traverse(node => {
    if (node.isMesh) byKey.set(vehicleNodeKey(scene, node), node);
  });

  let selected = configuredKeys.map(key => byKey.get(key)).filter(Boolean);
  let source = 'manual';
  if (!selected.length) {
    selected = [];
    scene.traverse(node => {
      if (!node.isMesh) return;
      let current = node;
      while (current && current !== scene) {
        if (STEERING_WHEEL_NAME.test(current.name || '')) {
          selected.push(node);
          break;
        }
        current = current.parent;
      }
    });
    source = 'name-detected';
  }

  selected = [...new Set(selected)];
  if (!selected.length) return null;

  // Remove a selected descendant when one of its selected mesh ancestors will
  // already carry it. This prevents a part being attached twice.
  const selectedSet = new Set(selected);
  selected = selected.filter(node => {
    let parent = node.parent;
    while (parent && parent !== scene) {
      if (selectedSet.has(parent)) return false;
      parent = parent.parent;
    }
    return true;
  });

  const bounds = new THREE.Box3();
  for (const mesh of selected) bounds.expandByObject(mesh);
  if (bounds.isEmpty()) return null;

  const size = bounds.getSize(new THREE.Vector3());
  const inferredAxis = size.x <= size.y && size.x <= size.z ? 'x'
    : (size.y <= size.z ? 'y' : 'z');
  const axis = ['x', 'y', 'z'].includes(config.axis) ? config.axis : inferredAxis;
  const pivot = new THREE.Group();
  pivot.name = 'vehicle-steering-wheel-pivot';
  pivot.position.copy(toLocal(bounds.getCenter(new THREE.Vector3())));
  pivot.userData.steeringWheelPivot = {
    axis,
    maxAngleDeg: THREE.MathUtils.clamp(Number(config.maxAngleDeg) || 450, 90, 900),
    sign: Number(config.sign) < 0 ? -1 : 1,
    response: THREE.MathUtils.clamp(Number(config.response) || 10, 3, 24),
    source,
    meshKeys: selected.map(mesh => vehicleNodeKey(scene, mesh)),
  };
  scene.add(pivot);
  pivot.updateMatrixWorld(true);
  for (const mesh of selected) pivot.attach(mesh);
  return { pivot, meshes: selected };
}

// The bundled Chiron Pur Sport GLTF exports one complete front-left road-wheel
// assembly. Split its brake hardware from the rotating rim/tyre, then instance
// the authored geometry at the four measured Pur Sport hardpoints. No procedural
// replacement wheel meshes are introduced.
function splitBugattiWheelAssembly(scene) {
  let source = null;
  scene.traverse((node) => {
    if (!source && node.name === 'Wheel1A_3D') source = node;
  });
  if (!source || !source.parent) throw new Error('[bugatti] GLTF is missing its Wheel1A_3D wheel assembly');
  const parent = source.parent;
  const wheelParts = source.children.filter((child) => !/calliper/i.test(child.name || ''));
  const brakeParts = source.children.filter((child) => /calliper/i.test(child.name || ''));
  if (wheelParts.length < 2 || brakeParts.length !== 1) {
    throw new Error('[bugatti] Expected two authored wheel groups and one separate caliper group');
  }
  const makeGroup = (name, parts) => {
    const group = new THREE.Group();
    group.name = name;
    group.position.copy(source.position);
    group.quaternion.copy(source.quaternion);
    group.scale.copy(source.scale);
    group.matrixAutoUpdate = source.matrixAutoUpdate;
    if (!group.matrixAutoUpdate) group.matrix.copy(source.matrix);
    for (const part of parts) group.add(part);
    parent.add(group);
    return group;
  };
  const wheel = makeGroup('bugatti-wheel-assembly-source', wheelParts);
  wheel.traverse((node) => {
    if (node.isMesh) node.userData.vehicleWheelSource = true;
  });
  const brakes = makeGroup('bugatti-brake-hardware-source', brakeParts);
  brakes.traverse((node) => {
    if (node.isMesh) node.userData.staticVehicleHardware = true;
  });
  parent.remove(source);
  return { wheel, brakes };
}

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

// The Escalade GLTF exports the four tyres and several rim finishes as
// material-wide meshes. Split their triangles into four spatial wheel assemblies
// before running the normal wheel classifier. This preserves the authored mesh
// and materials while allowing each real corner to steer and spin independently.
function splitEscaladeWheelMeshes(scene) {
  const wheelSourceMaterials = new Set([
    'tire', 'blur_rim', 'chrome_blur_lip', 'chrome_rim', 'chrome_blur_rim', 'inner_rim',
  ]);
  const sources = [];
  let tireSource = null;
  scene.traverse(node => {
    if (!node.isMesh || !node.geometry?.attributes?.position) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const names = materials.map(material => String(material?.name || '').toLowerCase());
    if (!names.some(name => wheelSourceMaterials.has(name))) return;
    sources.push(node);
    if (names.includes('tire')) tireSource = node;
  });
  if (!tireSource) throw new Error('[escalade] merged tyre material mesh was not found');

  const triangleData = (mesh) => {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const triangles = [];
    for (let i = 0; i + 2 < count; i += 3) {
      const ids = index
        ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
        : [i, i + 1, i + 2];
      const points = ids.map(id => new THREE.Vector3().fromBufferAttribute(position, id));
      const center = points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3);
      triangles.push({ ids, center, points });
    }
    return triangles;
  };

  const tireTriangles = triangleData(tireSource);
  if (tireTriangles.length < 24) {
    throw new Error('[escalade] tyre mesh does not contain enough triangles to split four wheels');
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const triangle of tireTriangles) {
    minX = Math.min(minX, triangle.center.x);
    maxX = Math.max(maxX, triangle.center.x);
    minY = Math.min(minY, triangle.center.y);
    maxY = Math.max(maxY, triangle.center.y);
  }
  const seed = (x, y) => ({ x, y });
  let centers = [
    seed(minX + (maxX - minX) * 0.22, minY + (maxY - minY) * 0.22),
    seed(maxX - (maxX - minX) * 0.22, minY + (maxY - minY) * 0.22),
    seed(minX + (maxX - minX) * 0.22, maxY - (maxY - minY) * 0.22),
    seed(maxX - (maxX - minX) * 0.22, maxY - (maxY - minY) * 0.22),
  ];
  let assignments = new Array(tireTriangles.length).fill(0);
  for (let iteration = 0; iteration < 36; iteration++) {
    const sums = centers.map(() => ({ x: 0, y: 0, count: 0 }));
    for (let i = 0; i < tireTriangles.length; i++) {
      const point = tireTriangles[i].center;
      let best = 0, bestDistance = Infinity;
      for (let k = 0; k < centers.length; k++) {
        const dx = point.x - centers[k].x, dy = point.y - centers[k].y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) { bestDistance = distance; best = k; }
      }
      assignments[i] = best;
      sums[best].x += point.x;
      sums[best].y += point.y;
      sums[best].count++;
    }
    centers = centers.map((old, i) => sums[i].count
      ? { x: sums[i].x / sums[i].count, y: sums[i].y / sums[i].count }
      : old);
  }

  const clusters = centers.map((center, clusterIndex) => {
    const selected = tireTriangles.filter((triangle, i) => assignments[i] === clusterIndex);
    if (selected.length < 6) throw new Error('[escalade] unable to isolate all four tyre groups');
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let cx = 0, cy = 0, cz = 0;
    for (const triangle of selected) {
      cx += triangle.center.x; cy += triangle.center.y; cz += triangle.center.z;
      for (const point of triangle.points) {
        min[0] = Math.min(min[0], point.x); max[0] = Math.max(max[0], point.x);
        min[1] = Math.min(min[1], point.y); max[1] = Math.max(max[1], point.y);
        min[2] = Math.min(min[2], point.z); max[2] = Math.max(max[2], point.z);
      }
    }
    const count = selected.length;
    const wheelCenter = new THREE.Vector3(cx / count, cy / count, cz / count);
    const radius = Math.max(max[1] - min[1], max[2] - min[2]) * 0.5;
    return {
      index: clusterIndex,
      center: wheelCenter,
      radius,
      bounds: { min, max },
      triangles: count,
      key: (wheelCenter.y > 0 ? 'front' : 'rear') + '-' + (wheelCenter.x > 0 ? 'left' : 'right'),
    };
  });
  const keys = new Set(clusters.map(cluster => cluster.key));
  if (keys.size !== 4) throw new Error('[escalade] tyre split did not produce front-left, front-right, rear-left and rear-right');

  const makeSubset = (sourceGeometry, triangleList) => {
    const geometry = new THREE.BufferGeometry();
    const indexMap = new Map();
    const output = Object.fromEntries(
      Object.entries(sourceGeometry.attributes).map(([name, attribute]) => [name, []]),
    );
    const outputIndices = [];
    for (const triangle of triangleList) {
      for (const sourceIndex of triangle.ids) {
        let targetIndex = indexMap.get(sourceIndex);
        if (targetIndex === undefined) {
          targetIndex = indexMap.size;
          indexMap.set(sourceIndex, targetIndex);
          for (const [name, attribute] of Object.entries(sourceGeometry.attributes)) {
            const values = output[name];
            for (let component = 0; component < attribute.itemSize; component++) {
              const value = component === 0 ? attribute.getX(sourceIndex)
                : component === 1 ? attribute.getY(sourceIndex)
                  : component === 2 ? attribute.getZ(sourceIndex)
                    : component === 3 ? attribute.getW(sourceIndex) : 0;
              values.push(value);
            }
          }
        }
        outputIndices.push(targetIndex);
      }
    }
    for (const [name, values] of Object.entries(output)) {
      const sourceAttribute = sourceGeometry.attributes[name];
      const AttributeArray = sourceAttribute.array.constructor;
      geometry.setAttribute(name, new THREE.BufferAttribute(
        new AttributeArray(values), sourceAttribute.itemSize, sourceAttribute.normalized,
      ));
    }
    geometry.setIndex(outputIndices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  };

  const splitRecords = (source, wheelTriangles) => {
    const parts = clusters.map(() => []);
    const residual = [];
    const materialName = String((Array.isArray(source.material) ? source.material[0] : source.material)?.name || '').toLowerCase();
    const isTire = materialName === 'tire';
    const triangles = isTire ? tireTriangles : triangleData(source);
    for (let i = 0; i < triangles.length; i++) {
      const triangle = triangles[i];
      if (isTire) {
        parts[assignments[i]].push(triangle);
        continue;
      }
      let best = -1, bestScore = Infinity;
      for (const cluster of clusters) {
        const dx = Math.abs(triangle.center.x - cluster.center.x);
        const radial = Math.hypot(
          triangle.center.y - cluster.center.y,
          triangle.center.z - cluster.center.z,
        );
        const axialLimit = Math.max(7, (cluster.bounds.max[0] - cluster.bounds.min[0]) * 0.75 + 3);
        const radialLimit = Math.max(18, cluster.radius * 1.65);
        if (dx > axialLimit || radial > radialLimit) continue;
        const score = radial * radial + dx * dx * 0.6;
        if (score < bestScore) { best = cluster.index; bestScore = score; }
      }
      if (best >= 0) parts[best].push(triangle);
      else residual.push(triangle);
    }

    for (const cluster of clusters) {
      const list = parts[cluster.index];
      if (!list.length) continue;
      const part = new THREE.Mesh(makeSubset(source.geometry, list), source.material);
      part.name = '[Escalade ' + cluster.key + ' ' + materialName + ']';
      part.position.copy(source.position);
      part.quaternion.copy(source.quaternion);
      part.scale.copy(source.scale);
      part.castShadow = source.castShadow;
      part.receiveShadow = source.receiveShadow;
      part.userData.vehicleWheelSource = true;
      source.parent.add(part);
    }

    if (residual.length) {
      source.geometry = makeSubset(source.geometry, residual);
    } else {
      source.removeFromParent();
    }
  };

  for (const source of sources) {
    splitRecords(source, tireTriangles);
  }
  scene.userData.escaladeWheelSplit = {
    clusters: clusters.map(cluster => ({
      corner: cluster.key,
      center: cluster.center.toArray(),
      radius: cluster.radius,
      triangles: cluster.triangles,
    })),
    sourceMaterials: sources.length,
  };
  return scene.userData.escaladeWheelSplit;
}

async function _loadCarModelUncached(kind = 'lambo') {
  if (_modelCache[kind]) return _modelCache[kind];
  const def = CAR_MODELS[kind];
  if (!def) throw new Error('Unknown vehicle model: ' + kind);
  const loadStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const gltf = await new Promise((res, rej) => loader.load(def.url, res, undefined, rej));
    const decodedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const scene = gltf.scene;
    // Keep any model-specific root correction explicit. The Escalade GLTF's
    // own Sketchfab_Model matrix already provides the game's axis convention.
    if (def.modelRotation) {
      scene.rotation.x += Number(def.modelRotation.x) || 0;
      scene.rotation.y += Number(def.modelRotation.y) || 0;
      scene.rotation.z += Number(def.modelRotation.z) || 0;
      scene.updateMatrixWorld(true);
    }
    await loadAssetOverrides();
    applyAssetOverrides(scene, def.url); // node transforms are applied before mesh fitting and collision extraction
    const bugattiAssembly = kind === 'bugatti' ? splitBugattiWheelAssembly(scene) : null;
    // The Cybertruck GLB splits tyre sidewalls, tread, rim and hub details into
    // more separate meshes than the sports-car asset. Keep those parts together
    // around each wheel hub so the complete rubber tyre spins with the rim.
    const wheelClassificationOptions = { ...getWheelClassificationOptions(kind), nose: def.nose ?? -1 };
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
    let cls = classifyCarMeshes(meshWorldBoxes(scene), wheelClassificationOptions);
    const bodySize = cls.hasBody
      ? cls.bodyBox.getSize(new THREE.Vector3())
      : cls.total.clone();
    const longestH = Math.max(bodySize.x, bodySize.z, 0.001);
    // Keep startup logs lean; detailed mesh diagnostics remain available in
    // the dedicated visual verification tool rather than serializing mesh data
    // on the user's main thread during ordinary game loading.
    scene.scale.multiplyScalar(def.targetLen / longestH);
    scene.updateMatrixWorld(true);

    // Pass 2 (final space): recenter XZ on the body, ground the bottom at y=0.
    cls = classifyCarMeshes(meshWorldBoxes(scene), wheelClassificationOptions);
    const bb = cls.hasBody ? cls.bodyBox : cls.all;
    const bc = bb.getCenter(new THREE.Vector3());
    scene.position.x -= bc.x;
    scene.position.z -= bc.z;
    scene.position.y -= bb.min.y;
    scene.updateMatrixWorld(true);

    // The Pur Sport asset has one authored road-wheel assembly. Place four
    // copies using its measured 4.647m-normalized body and official hardpoints.
    // The Bugatti asset hierarchy already contains all four original wheel
    // positions. Keep those authored meshes in place; the shared detector will
    // build the four independent spin/steer pivots in pass 3.

    // The Escalade asset merges all four tyre/rim objects by material. Separate
    // those authored triangles into four corner assemblies before classification.
    if (kind === 'escalade') splitEscaladeWheelMeshes(scene);

    // Pass 3: final classification in normalized space. Boxes below are in
    // ROOT space (== world coords here, root identity): the clone keeps the
    // base position/scale, so they translate with the vehicle root directly.
    cls = classifyCarMeshes(meshWorldBoxes(scene), wheelClassificationOptions);
    if (kind === 'escalade' && cls.wheelInfos.length !== 4) {
      const diagnostics = cls.wheelDiagnostics.meshes
        .filter(item => item.name.includes('[Escalade') || item.candidate)
        .map(item => ({ name: item.name, size: item.size, center: item.center, candidate: item.candidate, rejectedReasons: item.rejectedReasons }));
      console.warn('[Escalade wheel split diagnostics]', JSON.stringify({
        split: scene.userData.escaladeWheelSplit,
        candidates: diagnostics,
      }));
    }
    const requiredQuadrants = ['front-left', 'front-right', 'rear-left', 'rear-right'];
    const wheelByCorner = new Map(cls.wheelInfos.map(wheel => [wheel.quadrant, wheel]));
    if (cls.wheelInfos.length !== 4 || requiredQuadrants.some(corner => !wheelByCorner.has(corner))) {
      throw new Error(`[${kind}] expected one actual wheel assembly in each corner; found ${[...wheelByCorner.keys()].join(', ')}`);
    }
    const average = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const measuredWheelbase = Math.abs(
      average([wheelByCorner.get('front-left').center.z, wheelByCorner.get('front-right').center.z])
      - average([wheelByCorner.get('rear-left').center.z, wheelByCorner.get('rear-right').center.z]),
    );
    const measuredFrontTrack = Math.abs(wheelByCorner.get('front-left').center.x - wheelByCorner.get('front-right').center.x);
    const measuredRearTrack = Math.abs(wheelByCorner.get('rear-left').center.x - wheelByCorner.get('rear-right').center.x);
    const profile = CAR_PHYSICS[kind];
    const within = (actual, expected, tolerance) =>
      Math.abs(actual - expected) / Math.max(0.001, expected) <= tolerance;
    if (!within(measuredWheelbase, profile.wheelbase, 0.15)
      || !within(measuredFrontTrack, profile.trackFront, 0.15)
      || !within(measuredRearTrack, profile.trackRear, 0.15)) {
      throw new Error(`[${kind}] GLB/profile wheel-layout mismatch: wheelbase=${measuredWheelbase.toFixed(3)}m, tracks=${measuredFrontTrack.toFixed(3)}/${measuredRearTrack.toFixed(3)}m; centres=${JSON.stringify(cls.wheelDiagnostics.selectedWheels.map(w => ({ quadrant: w.quadrant, center: w.center })))}`);
    }
    const wheelCenterX = average(cls.wheelInfos.map(wheel => wheel.center.x));
    if (Math.abs(wheelCenterX) > 0.10) {
      throw new Error(`[${kind}] wheel layout is not centred laterally (mean X=${wheelCenterX.toFixed(3)}m)`);
    }
    const wheelCalibration = {
      wheelbase: measuredWheelbase,
      frontTrack: measuredFrontTrack,
      rearTrack: measuredRearTrack,
    };
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
        cls = classifyCarMeshes(meshWorldBoxes(scene), wheelClassificationOptions);
      }
    }

    const steeringWheelRig = rigSteeringWheel(
      scene,
      { ...(CAR_PHYSICS[kind]?.steeringWheel || {}), ...(scene.userData.assetOverride?.steeringWheel || {}) },
      toLocal,
    );
    const steeringWheelMeshes = new Set(steeringWheelRig?.meshes || []);

    const colBoxes = [];
    if (cls.hasBody) {
      const items = meshWorldBoxes(scene);
      const wheelSet = new Set();
      for (const w of cls.wheelInfos) for (const m of w.meshes) wheelSet.add(m);
      for (const m of items) {
        if (cls.blobs.has(m.o) || wheelSet.has(m.o) || steeringWheelMeshes.has(m.o)) continue;
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
    scene.userData.hasSteeringWheelRig = !!steeringWheelRig;

    const fin = new THREE.Box3().setFromObject(scene);
    const fsize = fin.getSize(new THREE.Vector3());
    const yawOffset = nose > 0 ? Math.PI : 0;
    scene.userData.colBoxes = colBoxes;
    scene.userData.bodyBox = { min: fin.min.clone(), max: fin.max.clone() };
    scene.userData.half = { x: fsize.x / 2, z: fsize.z / 2 };
    scene.userData.yawOffset = yawOffset;
    scene.userData.nose = nose;
    scene.userData.wheelCalibration = wheelCalibration;

    _modelCache[kind] = scene;
    const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    console.log(`[Vehicle] Loaded ${kind}: fetch/decode ${Math.round(decodedAt - loadStartedAt)}ms, fit ${Math.round(finishedAt - decodedAt)}ms, ${colBoxes.length} colliders / ${rigs.length} wheels`);
    return scene;
  } catch (e) {
    console.error(`[Vehicle] Refusing to load ${kind}; no placeholder vehicle will be substituted.`, e);
    delete _modelCache[kind];
    throw e;
  }
}

// Share one network/decode/normalization promise per car. Before this guard,
// three starter spawns could all enter GLTFLoader for the same large Chiron
// before the first load populated _modelCache.
export function loadCarModel(kind = 'lambo') {
  if (_modelCache[kind]) return Promise.resolve(_modelCache[kind]);
  const existing = _modelLoadPromises.get(kind);
  if (existing) return existing;
  const pending = enqueueCarModelLoad(kind);
  _modelLoadPromises.set(kind, pending);
  pending.then(
    () => { if (_modelLoadPromises.get(kind) === pending) _modelLoadPromises.delete(kind); },
    () => { if (_modelLoadPromises.get(kind) === pending) _modelLoadPromises.delete(kind); },
  );
  return pending;
}

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
    this.lastSpawnError = null;
    this._camPos = null;
    this._camLook = null;
    this._lookYaw = 0;
    this._lookPitch = 0.2;
    this._lookIdleTime = 0;
    this._reverseCameraBlend = 0;
    this._enterState = null;
    this._speedometerCanvas = null;
    this._speedometerCtx = null;
    this.interiorView = false;
    this._cockpitProfiles = {};
    this.physicsDebugEnabled = false;
    this._physicsDebugObjects = new Map();
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = JSON.parse(localStorage.getItem('sc_cockpit_camera_profiles_v1') || '{}');
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) this._cockpitProfiles = saved;
      }
    } catch (error) { console.warn('[Vehicle] Cockpit camera settings could not be loaded:', error); }
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

  _drawSpeedometer(kmh, kind = 'lambo', telemetry = null) {
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
    const gear = telemetry?.gear ?? (kmh < 1 ? 'N' : kmh < 30 ? '1' : kmh < 55 ? '2' : kmh < 85 ? '3' : kmh < 115 ? '4' : '5');
    ctx.fillStyle = '#c9a227';
    ctx.font = '700 13px "Bebas Neue", "Oswald", sans-serif';
    ctx.fillText(gear, cx + 40, cy - 2);
  }

  buildFromWorld() {
    // Spawn one of each registered car around the player's authored start.
    // Selecting unique kinds keeps a large authored vehicle list from filling
    // the initial area with duplicate models.
    const start = this.world.startPoint || { x: 0, z: 0 };
    const maxDistance = 48;
    const authored = (this.world.vehicleSpawns || [])
      .filter(vehicle => CAR_MODELS[vehicle.kind]
        && Math.hypot(vehicle.x - start.x, vehicle.z - start.z) <= maxDistance)
      .slice()
      .sort((a, b) =>
        Math.hypot(a.x - start.x, a.z - start.z)
        - Math.hypot(b.x - start.x, b.z - start.z));
    const chosen = [];
    const usedKinds = new Set();
    for (const vehicle of authored) {
      if (usedKinds.has(vehicle.kind)) continue;
      chosen.push(vehicle);
      usedKinds.add(vehicle.kind);
      if (chosen.length >= Object.keys(CAR_MODELS).length) break;
    }

    // Keep a safe fallback for scenes without authored car positions.
    const fallbackSlots = [
      { x: start.x - 10, z: start.z + 12, ry: start.yaw || 0 },
      { x: start.x + 3, z: start.z + 12, ry: start.yaw || 0 },
      { x: start.x + 16, z: start.z + 12, ry: start.yaw || 0 },
      { x: start.x - 13, z: start.z, ry: start.yaw || 0 },
    ];
    for (const kind of Object.keys(CAR_MODELS)) {
      if (usedKinds.has(kind) || chosen.length >= Object.keys(CAR_MODELS).length) continue;
      const slot = fallbackSlots[chosen.length] || fallbackSlots[fallbackSlots.length - 1];
      chosen.push({ ...slot, kind, elevation: 0 });
      usedKinds.add(kind);
    }

    this.startupVehicleLoads = Promise.allSettled(
      chosen.map(vehicle => this.spawn({
        ...vehicle,
        elevation: Number.isFinite(vehicle.elevation) ? vehicle.elevation : 0,
      })),
    );
    return this.startupVehicleLoads;
  }

  // Spawn within interaction range, avoiding existing cars. This keeps the
  // newly requested vehicle reachable with E instead of putting it several metres away.
  async spawnNearPlayer(kind, player) {
    this.lastSpawnError = null;
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
      // Put the first requested car directly in the camera's forward lane.
      // The near-side slots keep a second car reachable without overlapping it.
      [4.2, 0],
      [0, 5.2], [0, -5.2],
      [4.2, 5.2], [4.2, -5.2],
      [-4.2, 0],
      [5.5, 2.8], [5.5, -2.8],
      [-5.5, 2.8], [-5.5, -2.8],
      [2.5, 6.0], [2.5, -6.0],
      [-2.5, 6.0], [-2.5, -6.0],
    ];
    let spot = null;
    for (const [forward, lateral] of candidates) {
      const x = origin.x - Math.sin(heading) * forward + Math.cos(heading) * lateral;
      const z = origin.z - Math.cos(heading) * forward - Math.sin(heading) * lateral;
      preview.pos.x = x;
      preview.pos.z = z;
      if (this.surfaceDistance(preview, origin.x, origin.z) > 4.25) continue;
      // A vehicle can request another car while occupied; don't treat the
      // car being driven as an obstacle to its own spawn search.
      if (this.vehicles.some(v => v !== driving && Math.hypot(v.pos.x - x, v.pos.z - z) < 5.2)) continue;
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
      this.physics.updateVehicleBody(v.rapierBody, v.pos.x, v.pos.y, v.pos.z, this._worldYaw(v));
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

  syncDynamicVehicle(v, dt = 1 / 60, alpha = 1) {
    if (!v?.physicsDynamic || !v.rapierBody) return;
    const interpolated = this.physics?.getInterpolatedVehiclePose?.(v.rapierBody, alpha);
    const t = interpolated?.position || v.rapierBody.translation();
    const rotation = interpolated?.quaternion || v.rapierBody.rotation();
    const q = rotation.isQuaternion
      ? rotation
      : new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
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
    const right = forward.clone().cross(new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-8) right.set(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
    right.normalize();
    v.speed = velocity.x * forward.x + velocity.z * forward.z;
    v.lateralVel = velocity.x * right.x + velocity.z * right.z;
    v.root.position.copy(v.pos);
    v.root.quaternion.copy(q);
    const wheelStates = v.rapierBody._openWorldWheelStates || [];
    if (this.physicsDebugEnabled) this._updatePhysicsDebugVehicle(v, wheelStates);
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

  stepPhysics(dt) {
    if (!this.physics || !this.physics.world) return;
    for (const vehicle of this.vehicles) {
      if (!vehicle.physicsDynamic || !vehicle.rapierBody) continue;
      const active = vehicle === this.driver;
      const drive = active ? (vehicle._pendingDriveInput || {}) : {};
      const motion = this.physics.applyVehicleControls(vehicle.rapierBody, {
        throttle: active ? (drive.throttle || 0) : 0,
        steer: active ? (drive.steer || 0) : 0,
        handbrake: active ? !!drive.handbrake : false,
        dt,
        wheels: vehicle.physicsWheels,
        tuning: vehicle.physicsProfile,
        surfaceAt: (x, z, y) => this.world?.vehicleSurfaceAt?.(x, z, y),
      });
      if (active && motion) {
        vehicle.speed = motion.forwardSpeed;
        vehicle.lateralVel = motion.lateralSpeed;
        vehicle._lastMotion = motion;
        vehicle._lastDriveInput = { ...drive };
      }
    }
  }

  togglePhysicsDebug(force = null) {
    this.physicsDebugEnabled = force === null ? !this.physicsDebugEnabled : !!force;
    if (!this.physicsDebugEnabled) {
      for (const [vehicle, helpers] of this._physicsDebugObjects) {
        vehicle.root.remove(helpers.collider);
        vehicle.root.remove(helpers.rays);
        helpers.collider.geometry.dispose();
        helpers.collider.material.dispose();
        helpers.rays.geometry.dispose();
        helpers.rays.material.dispose();
      }
      this._physicsDebugObjects.clear();
      return false;
    }
    for (const vehicle of this.vehicles) {
      this._ensurePhysicsDebugVehicle(vehicle);
      this._updatePhysicsDebugVehicle(vehicle, vehicle.rapierBody?._openWorldWheelStates || []);
    }
    return true;
  }

  _ensurePhysicsDebugVehicle(vehicle) {
    if (!this.physicsDebugEnabled || this._physicsDebugObjects.has(vehicle)) return;
    const box = vehicle.physicsBox;
    const size = new THREE.Vector3().subVectors(box.max, box.min);
    const center = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
    const collider = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
      new THREE.LineBasicMaterial({ color: 0xffc44d, depthTest: false }),
    );
    collider.position.copy(center);
    collider.renderOrder = 1000;
    vehicle.root.add(collider);

    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.BufferAttribute(new Float32Array(24), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positions);
    geometry.setDrawRange(0, 8);
    const rays = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x32e6a1, depthTest: false }),
    );
    rays.renderOrder = 1001;
    vehicle.root.add(rays);
    this._physicsDebugObjects.set(vehicle, { collider, rays, positions });
  }

  _updatePhysicsDebugVehicle(vehicle, wheelStates = []) {
    this._ensurePhysicsDebugVehicle(vehicle);
    const helpers = this._physicsDebugObjects.get(vehicle);
    if (!helpers) return;
    vehicle.root.updateMatrixWorld(true);
    const data = helpers.positions;
    for (let i = 0; i < 4; i++) {
      const state = wheelStates[i];
      const hardpoint = state?.hardpoint;
      const end = state?.contact && state.point
        ? state.point
        : hardpoint
          ? {
            x: hardpoint.x, y: hardpoint.y - (state.radius || 0.32)
              - (vehicle.physicsProfile?.suspensionRestLength ?? 0.22)
              - (vehicle.physicsProfile?.suspensionTravel ?? 0.18), z: hardpoint.z
          }
          : null;
      const a = hardpoint
        ? vehicle.root.worldToLocal(new THREE.Vector3(hardpoint.x, hardpoint.y, hardpoint.z))
        : new THREE.Vector3();
      const b = end
        ? vehicle.root.worldToLocal(new THREE.Vector3(end.x, end.y, end.z))
        : new THREE.Vector3();
      data.setXYZ(i * 2, a.x, a.y, a.z);
      data.setXYZ(i * 2 + 1, b.x, b.y, b.z);
    }
    data.needsUpdate = true;
    helpers.rays.geometry.computeBoundingSphere();
  }

  syncDynamicBodies(dt = 1 / 60, alpha = 1) {
    for (const v of this.vehicles) this.syncDynamicVehicle(v, dt, alpha);
  }

  async spawn(def) {
    let root = null;
    try {
      const kind = def.kind || 'lambo';
      const physicsProfile = CAR_PHYSICS[kind];
      if (!CAR_MODELS[kind] || !physicsProfile) throw new Error('Vehicle model/physics profile is not registered: ' + kind);
      root = new THREE.Group();
      const base = await loadCarModel(kind);
      // The clone keeps the normalized base transform (recenter offset/scale);
      // userData boxes are in root space and translate with the root directly.
      const clone = base.clone(true);
      clone.visible = true;
      let renderableMeshCount = 0;
      clone.traverse(node => {
        if (!node.isMesh) return;
        renderableMeshCount++;
        node.visible = true;
        // Keep Three.js frustum culling enabled for dense GLTF models.
        node.frustumCulled = true;
      });
      if (!renderableMeshCount) throw new Error('Vehicle model has no renderable meshes: ' + kind);
      root.add(clone);
      const colBoxes = base.userData.colBoxes || [];
      if (!colBoxes.length || !base.userData.bodyBox) throw new Error('Vehicle asset has no valid fitted chassis collision geometry: ' + kind);
      const bodyBox = base.userData.bodyBox;
      const half = base.userData.half;
      const yawOffset = base.userData.yawOffset || 0;
      // Re-resolve the wheel rigs and measure their true positions/radii in
      // normalized model-root space. These are used by the raycast suspension.
      const wheels = [];
      let steeringWheel = null;
      clone.traverse((node) => {
        const spec = node.userData?.steeringWheelPivot;
        if (!spec) return;
        steeringWheel = {
          pivot: node,
          axis: spec.axis || 'x',
          maxAngleRad: (THREE.MathUtils.clamp(Number(spec.maxAngleDeg) || 450, 90, 900) * 0.5) * Math.PI / 180,
          sign: Number(spec.sign) < 0 ? -1 : 1,
          response: THREE.MathUtils.clamp(Number(spec.response) || 10, 3, 24),
          angle: 0,
        };
      });
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

      if (wheels.length !== 4) throw new Error(`[${kind}] exactly four wheel rigs are required; found ${wheels.length}`);
      const suspensionReady = wheels.length === 4 && wheels.every(w =>
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
      const comDrop = suspensionReady ? Math.min(0.30, (bodyBox.max.y - bodyBox.min.y) * 0.24) : 0;
      const physicsCenterY = Math.max(0.22, colliderCenterY - comDrop);
      const physicsWheels = wheels.map(w => ({
        x: w.center.x, y: w.center.y, z: w.center.z,
        radius: w.radius, front: w.front,
      }));
      const frontWheels = physicsWheels.filter(wheel => wheel.front);
      const rearWheels = physicsWheels.filter(wheel => !wheel.front);
      const average = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      const frontLeft = frontWheels.find(wheel => wheel.x > 0);
      const frontRight = frontWheels.find(wheel => wheel.x < 0);
      const rearLeft = rearWheels.find(wheel => wheel.x > 0);
      const rearRight = rearWheels.find(wheel => wheel.x < 0);
      if (frontWheels.length !== 2 || rearWheels.length !== 2
        || !frontLeft || !frontRight || !rearLeft || !rearRight) {
        throw new Error(`[${kind}] GLB wheel layout must contain two left/right wheels on both axles.`);
      }
      const measuredWheelbase = Math.abs(average(frontWheels.map(wheel => wheel.z)) - average(rearWheels.map(wheel => wheel.z)));
      const measuredFrontTrack = Math.abs(frontLeft.x - frontRight.x);
      const measuredRearTrack = Math.abs(rearLeft.x - rearRight.x);
      const measuredFrontRadius = average(frontWheels.map(wheel => wheel.radius));
      const measuredRearRadius = average(rearWheels.map(wheel => wheel.radius));
      const within = (actual, expected, tolerance) => Math.abs(actual - expected) / Math.max(0.001, expected) <= tolerance;
      if (frontWheels.length !== 2 || rearWheels.length !== 2
        || !within(measuredWheelbase, physicsProfile.wheelbase, 0.15)
        || !within(measuredFrontTrack, physicsProfile.trackFront, 0.15)
        || !within(measuredRearTrack, physicsProfile.trackRear, 0.15)
        || !within(measuredFrontRadius, physicsProfile.wheelRadiusFront, 0.20)
        || !within(measuredRearRadius, physicsProfile.wheelRadiusRear, 0.20)) {
        throw new Error(`[${kind}] GLB/physics mismatch: wheelbase=${measuredWheelbase.toFixed(3)}m, tracks=${measuredFrontTrack.toFixed(3)}/${measuredRearTrack.toFixed(3)}m, radii=${measuredFrontRadius.toFixed(3)}/${measuredRearRadius.toFixed(3)}m`);
      }
      const wheelCalibration = {
        wheelbase: measuredWheelbase,
        frontTrack: measuredFrontTrack,
        rearTrack: measuredRearTrack,
        frontRadius: measuredFrontRadius,
        rearRadius: measuredRearRadius,
      };
      // Keep the imported GLB and measured calibration untouched, but make the
      // physics hardpoints truly symmetric. Small authored left/right offsets
      // otherwise create a constant yaw moment once both axles are driven.
      for (const axle of [frontWheels, rearWheels]) {
        const left = axle.find(wheel => wheel.x > 0);
        const right = axle.find(wheel => wheel.x < 0);
        if (!left || !right) continue;
        const halfTrack = (Math.abs(left.x) + Math.abs(right.x)) * 0.5;
        const axleZ = (left.z + right.z) * 0.5;
        const axleY = (left.y + right.y) * 0.5;
        const axleRadius = (left.radius + right.radius) * 0.5;
        left.x = halfTrack; right.x = -halfTrack;
        left.z = right.z = axleZ;
        left.y = right.y = axleY;
        left.radius = right.radius = axleRadius;
      }
      const baseInteriorCamera = base.userData.assetOverride?.interiorCamera
        || physicsProfile.interiorCamera
        || { height: Math.max(0.85, (bodyBox.max.y - bodyBox.min.y) * 0.62), forward: 0.18, side: 0, lookAhead: 18, pitch: 0, fov: 82 };
      const interiorCamera = resolveCockpitCameraProfile(baseInteriorCamera, this._cockpitProfiles[kind]);
      const v = {
        def, root, rapierBody: null, physicsDynamic: false, suspensionReady,
        physicsCenterY, physicsBox, physicsWheels, physicsProfile, wheelCalibration,
        kind, wheels, steeringWheel, colBoxes, bodyBox, half,
        yawOffset, parkedCol: null,
        baseInteriorCamera: { ...baseInteriorCamera },
        interiorCamera,
        cabinLights: createCabinLights(root, kind, baseInteriorCamera),
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
              centerOfMass: {
                x: 0,
                y: physicsProfile.centerOfMassHeight - physicsCenterY,
                z: physicsProfile.wheelbase * (physicsProfile.weightFront - 0.5),
              },
              yawOffset, tuning: physicsProfile, angularDamping: physicsProfile.angularDamping,
            },
          );
          v.physicsDynamic = !!v.rapierBody?._openWorldDynamic;
          if (!v.physicsDynamic) {
            console.warn(`[Vehicle] ${kind} has no dynamic Rapier body; using the tested AABB vehicle controller.`);
          }
        } catch (error) {
          v.rapierBody = null;
          v.physicsDynamic = false;
          console.warn('[Vehicle] Dynamic Rapier body failed; using AABB fallback:', error);
        }
      }

      root.visible = true;
      root.position.set(def.x, def.elevation || 0, def.z);
      root.updateMatrixWorld(true);
      this.scene.add(root);
      this.vehicles.push(v);
      if (this.physicsDebugEnabled) this._ensurePhysicsDebugVehicle(v);
      this._addParkedCollider(v);
      console.log('[Vehicle] Spawned car (' + kind + ') at', def.x, def.elevation || 0, def.z,
        '- meshes:', renderableMeshCount, 'boxes:', colBoxes.length, 'wheels:', wheels.length);
      return v;
    } catch (e) {
      this.lastSpawnError = e;
      root?.removeFromParent();
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
    this.interiorView = false;
    this._setInteriorLights(false);
    veh.def.occupied = true;
    // Drop the parked footprint so the driven car never collides with itself.
    this._removeParkedCollider(veh);
    player.vel.set(0, 0, 0);
    player.char.root.visible = false;
    if (this.physics) this.physics.setPlayerCollisionEnabled(false);
    this._lookYaw = 0;
    this._lookPitch = 0.2;
    this._lookIdleTime = 0;
    this._reverseCameraBlend = 0;
    const totalYaw = (veh.yaw || 0) + this._lookYaw;
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
    this.interiorView = false;
    this._setInteriorLights(false);
    veh.def.occupied = true;
    player.vel.set(0, 0, 0);
    player.char.root.visible = false;
    if (this.physics) this.physics.setPlayerCollisionEnabled(false);
    this._lookYaw = 0;
    this._lookPitch = 0.2;
    this._lookIdleTime = 0;
    this._reverseCameraBlend = 0;
    const totalYaw = (veh.yaw || 0) + this._lookYaw;
    const cx = -Math.sin(totalYaw), cz = -Math.cos(totalYaw);
    const camDist = 5.5;
    const camH = 3.2;
    this._camPos = new THREE.Vector3(veh.pos.x - cx * camDist, camH, veh.pos.z - cz * camDist);
    this._camLook = new THREE.Vector3(veh.pos.x + cx * 4.5, 1.0, veh.pos.z + cz * 4.5);
    if (this._speedometerCanvas) this._speedometerCanvas.style.display = 'block';
  }

  _findExitPosition(veh, player) {
    const yaw = Number.isFinite(veh.yaw) ? veh.yaw : 0;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const radius = Math.max(0.3, Number(player.radius) || 0.42);
    const sideGap = (veh.half?.x || 1.15) + radius + 0.55;
    const endGap = (veh.half?.z || 2.5) + radius + 0.55;
    const candidates = [
      right.clone().multiplyScalar(sideGap),
      right.clone().multiplyScalar(-sideGap),
      forward.clone().multiplyScalar(endGap),
      forward.clone().multiplyScalar(-endGap),
      right.clone().multiplyScalar(sideGap).addScaledVector(forward, endGap * 0.55),
      right.clone().multiplyScalar(-sideGap).addScaledVector(forward, endGap * 0.55),
    ];
    for (const offset of candidates) {
      const x = veh.pos.x + offset.x;
      const z = veh.pos.z + offset.z;
      if (this.surfaceDistance(veh, x, z) < radius + 0.18) continue;
      if (this.world?.colliderAt?.(x, z, radius)) continue;
      const sampledY = this.world?.groundHeightAt?.(x, z, (veh.pos.y || 0) + 1.5);
      const y = Number.isFinite(sampledY) && sampledY >= (veh.pos.y || 0) - 0.75
        ? sampledY
        : (Number.isFinite(veh.pos.y) ? veh.pos.y : 0);
      return new THREE.Vector3(x, y, z);
    }
    // Do not leave the player embedded in the chassis if every preferred exit
    // side is blocked. The rear clearance is the least intrusive fallback.
    return veh.pos.clone().addScaledVector(forward, -endGap).setY(
      Number.isFinite(veh.pos.y) ? veh.pos.y : 0,
    );
  }

  exit(player) {
    const veh = this.driver;
    if (!veh) return;
    this._setInteriorLights(false);
    this.interiorView = false;
    this.driver = null;
    veh.def.occupied = false;

    // Keep the capsule disabled while it is moved out of the cabin. Re-enabling
    // it at the stale in-car transform makes it overlap the chassis and pushes
    // the parked car away on the next physics step.
    const exitPos = this._findExitPosition(veh, player);
    player.pos.copy(exitPos);
    player.vel.set(0, 0, 0);
    player.onGround = true;
    player.yaw = Number.isFinite(veh.yaw) ? veh.yaw : 0;

    player.char.root.visible = true;
    player.char.root.position.copy(player.pos);
    player.char.root.rotation.y = player.yaw + Math.PI;
    player.char.update(0.016);

    // Restore the chassis at its actual road/bridge elevation before enabling
    // the player's capsule. setPlayerPosition teleports the kinematic body now.
    veh.root.position.copy(veh.pos);
    this._addParkedCollider(veh);
    if (this.physics) {
      this.physics.setPlayerPosition(player.pos.x, player.pos.y, player.pos.z);
      this.physics.setPlayerCollisionEnabled(true);
    }
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

  toggleDriveMode() {
    const vehicle = this.driver;
    if (!vehicle || vehicle.kind !== 'cybertruck') return null;
    const current = vehicle.driveMode || CAR_PHYSICS.cybertruck.powertrain.defaultDriveMode || 'beast';
    const next = current === 'beast' ? 'awd' : 'beast';
    vehicle.driveMode = next;
    const powertrain = vehicle.rapierBody?._openWorldPowertrainState;
    if (powertrain) powertrain.driveMode = next;
    return next;
  }

  getEngineAudioState(dt = 1 / 60) {
    const vehicle = this.driver;
    if (!vehicle) return null;
    const tuning = vehicle.physicsProfile || CAR_PHYSICS[vehicle.kind] || CAR_PHYSICS.lambo;
    const physicsState = vehicle.rapierBody?._openWorldPowertrainState || {};
    const motion = vehicle._lastMotion || {};
    const drive = vehicle._lastDriveInput || vehicle._pendingDriveInput || {};
    const forwardSpeed = Number.isFinite(motion.forwardSpeed)
      ? motion.forwardSpeed
      : (Number(vehicle.speed) || 0);
    const throttleInput = THREE.MathUtils.clamp(Number(drive.throttle) || 0, -1, 1);
    const wheels = Array.isArray(motion.wheelStates)
      ? motion.wheelStates
      : (vehicle.rapierBody?._openWorldWheelStates || []);
    const surfaceCounts = new Map();
    for (const wheel of wheels) {
      if (!wheel?.contact) continue;
      const surface = String(wheel.surface?.surface || 'asphalt').toLowerCase();
      surfaceCounts.set(surface, (surfaceCounts.get(surface) || 0) + 1);
    }
    const surface = [...surfaceCounts.entries()]
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'asphalt';
    const isElectric = tuning.powertrain?.type === 'ev';
    const rpm = Number.isFinite(motion.rpm)
      ? motion.rpm
      : (Number(physicsState.rpm) || tuning.powertrain?.idleRpm || 0);
    const motorRpm = Number.isFinite(motion.motorRpm)
      ? motion.motorRpm
      : (Number(physicsState.motorRpm) || 0);
    const gear = motion.gearNumber ?? physicsState.gear ?? 1;

    return {
      kind: vehicle.kind,
      dt: THREE.MathUtils.clamp(Number(dt) || 1 / 60, 0.001, 0.05),
      rpm,
      motorRpm,
      gear,
      throttle: Math.max(0, throttleInput),
      engineLoad: Number.isFinite(motion.engineLoad)
        ? motion.engineLoad
        : (Number(physicsState.engineLoad) || Math.abs(throttleInput)),
      driveDemand: Number.isFinite(motion.driveDemand)
        ? motion.driveDemand
        : (Number(physicsState.driveDemand) || Math.max(0, throttleInput)),
      regenLevel: Number.isFinite(motion.regenLevel)
        ? motion.regenLevel
        : (Number(physicsState.regenLevel) || 0),
      boost: Number.isFinite(motion.boost)
        ? motion.boost
        : (Number(physicsState.boost) || 0),
      shiftTimer: Number(motion.shiftTimer ?? physicsState.shiftTimer) || 0,
      shiftDirection: motion.shiftDirection ?? physicsState.shiftDirection ?? null,
      revLimiter: !!(motion.revLimiter ?? physicsState.revLimiter),
      braking: throttleInput < -0.01 && forwardSpeed > 0.8,
      handbrake: !!drive.handbrake,
      speed: forwardSpeed,
      speedKph: Math.abs(forwardSpeed) * 3.6,
      lateralSpeed: Number(motion.lateralSpeed) || 0,
      slipRatio: THREE.MathUtils.clamp(
        Math.abs(Number(motion.lateralSpeed) || 0) / Math.max(2, Math.abs(forwardSpeed)),
        0, 1,
      ),
      interior: !!this.interiorView,
      surface,
      driveMode: vehicle.driveMode || (isElectric ? 'beast' : undefined),
      exhaustOpen: !!vehicle.exhaustOpen,
      corsa: !!vehicle.corsa,
    };
  }

  update(dt, input, player) {
    const v = this.driver;
    if (!v) return;

    const throttle = input.forward || 0;
    const rawSteerValue = THREE.MathUtils.clamp(input.right || 0, -1, 1);
    const rawSteerInput = Math.abs(rawSteerValue) < 0.02 ? 0 : rawSteerValue;
    const handbrake = !!input.jump;
    const tuning = v.physicsProfile || CAR_PHYSICS[v.kind] || CAR_PHYSICS.lambo;
    const steeringBlend = 1 - Math.exp(-(tuning.steeringResponse || 10) * Math.min(Math.max(dt, 0), 0.05));
    v.steerInput = (v.steerInput || 0) + (rawSteerInput - (v.steerInput || 0)) * steeringBlend;
    if (Math.abs(v.steerInput) < 0.02) v.steerInput = 0;
    const steerInput = v.steerInput;
    v._lastDriveInput = { throttle, steer: steerInput, handbrake };
    let curSpd = 0;
    if (v.physicsDynamic && this.physics && v.rapierBody) {
      // Body pose/velocity come from the last completed Rapier step. Apply
      // controls as impulses; do not manually move or teleport the chassis.
      this.syncDynamicVehicle(v, dt);
      curSpd = Math.hypot(v.speed || 0, v.lateralVel || 0);
      // Held input is re-applied before every Rapier substep so tyre forces
      // stay consistent when the render frame rate changes.
      v._pendingDriveInput = { throttle, steer: steerInput, handbrake };
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
      const physicalSteerAngles = v.physicsDynamic ? v.rapierBody?._openWorldSteerAngles : null;
      const modelRightSign = Math.cos(v.yawOffset || 0) >= 0 ? 1 : -1;
      const wheelSteerBlend = 1 - Math.exp(-Math.max(12, (visualTune.steeringResponse || 10) * 1.7) * Math.min(Math.max(dt, 0), 0.05));
      for (let wheelIndex = 0; wheelIndex < v.wheels.length; wheelIndex++) {
        const w = v.wheels[wheelIndex];
        const axleAngle = w.front ? steerAngle : 0;
        const physicalAngle = physicalSteerAngles?.[wheelIndex];
        if (w.front || Number.isFinite(physicalAngle)) {
          const targetSteer = Number.isFinite(physicalAngle)
            ? -physicalAngle
            : -ackermannSteerAngle(
              axleAngle, w.center.x, v.physicsWheels, visualTune.wheelbase || 2.7, modelRightSign,
            );
          w.pivot.rotation.y += (targetSteer - w.pivot.rotation.y) * wheelSteerBlend;
        }
        const spin = v.wheelTravel / Math.max(0.18, w.radius || 0.42);
        if (w.axle === 'z') w.spinner.rotation.z = spin;
        else w.spinner.rotation.x = spin;
      }
    }

    if (v.steeringWheel) {
      const rig = v.steeringWheel;
      const response = 1 - Math.exp(-rig.response * Math.min(Math.max(dt, 0), 0.05));
      const target = steerInput * rig.maxAngleRad * rig.sign;
      rig.angle += (target - rig.angle) * response;
      rig.pivot.rotation[rig.axis] = rig.angle;
    }

    // Vehicle sound is updated centrally after Rapier completes the frame so
    // the dedicated engine module receives the newest RPM/gear/boost telemetry.

    // Camera positioning is performed after Rapier finishes the frame's steps.
  }

  _setInteriorLights(enabled) {
    for (const vehicle of this.vehicles) {
      if (vehicle.cabinLights) vehicle.cabinLights.visible = !!enabled && vehicle === this.driver;
    }
  }

  toggleInteriorView() {
    if (!this.driver) return false;
    this.interiorView = !this.interiorView;
    this._setInteriorLights(this.interiorView);
    this._camPos = null;
    this._camLook = null;
    return this.interiorView;
  }

  getInteriorCameraSettings() {
    return this.driver ? { ...this.driver.interiorCamera } : null;
  }

  _saveCockpitCameraProfiles() {
    if (!this.driver) return;
    const kind = this.driver.kind;
    const profile = {};
    for (const key of COCKPIT_CAMERA_SETTING_KEYS) profile[key] = this.driver.interiorCamera[key];
    this._cockpitProfiles[kind] = profile;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('sc_cockpit_camera_profiles_v1', JSON.stringify(this._cockpitProfiles));
      }
    } catch (error) { console.warn('[Vehicle] Cockpit camera settings could not be saved:', error); }
  }

  setInteriorCameraSetting(key, value) {
    if (!this.driver) return false;
    const next = clampCockpitCameraValue(key, value);
    if (next === null) return false;
    const kind = this.driver.kind;
    for (const vehicle of this.vehicles) {
      if (vehicle.kind === kind) vehicle.interiorCamera[key] = next;
    }
    this._saveCockpitCameraProfiles();
    this._camPos = null;
    this._camLook = null;
    return true;
  }

  resetInteriorCameraSettings() {
    if (!this.driver) return false;
    const kind = this.driver.kind;
    for (const vehicle of this.vehicles) {
      if (vehicle.kind === kind) {
        vehicle.interiorCamera = resolveCockpitCameraProfile(vehicle.baseInteriorCamera, {});
      }
    }
    delete this._cockpitProfiles[kind];
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('sc_cockpit_camera_profiles_v1', JSON.stringify(this._cockpitProfiles));
      }
    } catch (error) { console.warn('[Vehicle] Cockpit camera settings could not be reset:', error); }
    this._camPos = null;
    this._camLook = null;
    return true;
  }

  updateChaseCamera(dt, input, player) {
    const v = this.driver;
    if (!v) return;
    const curSpd = Math.hypot(v.speed || 0, v.lateralVel || 0);
    const lookState = updateChaseLook({
      yaw: this._lookYaw,
      pitch: this._lookPitch,
      idleTime: this._lookIdleTime,
    }, {
      mouseDX: input.mouseDX || 0,
      mouseDY: input.mouseDY || 0,
      dt,
      throttle: v._pendingDriveInput?.throttle || 0,
      speed: curSpd,
    });
    this._lookYaw = lookState.yaw;
    this._lookPitch = lookState.pitch;
    this._lookIdleTime = lookState.idleTime;
    input.mouseDX = 0;
    input.mouseDY = 0;

    this._reverseCameraBlend = updateReverseCameraBlend(
      this._reverseCameraBlend || 0, v.speed || 0, dt,
    );
    if (this.interiorView) {
      const cabin = v.interiorCamera || { height: 1.05, forward: 0.2, side: 0, lookAhead: 18, pitch: 0, fov: 82 };
      const rotation = v.root.quaternion;
      const cameraLocal = new THREE.Vector3(cabin.side || 0, cabin.height || 1.05, cabin.forward || 0).applyQuaternion(rotation);
      const lookAngles = getCockpitLookAngles(cabin, this._lookYaw, this._lookPitch);
      const lookDistance = Math.max(2, Number(cabin.lookAhead) || 18);
      const lookDirection = new THREE.Vector3(
        Math.sin(lookAngles.yaw),
        Math.tan(lookAngles.pitch),
        Math.cos(lookAngles.yaw),
      ).normalize().multiplyScalar(lookDistance);
      const lookLocal = new THREE.Vector3(
        cabin.side || 0, cabin.height || 1.05, cabin.forward || 0,
      ).add(lookDirection).applyQuaternion(rotation);
      const cabinPosition = v.pos.clone().add(cameraLocal);
      const cabinLook = v.pos.clone().add(lookLocal);
      if (!this._camPos) { this._camPos = cabinPosition.clone(); this._camLook = cabinLook.clone(); }
      this._camPos.lerp(cabinPosition, Math.min(1, dt * 16));
      this._camLook.lerp(cabinLook, Math.min(1, dt * 16));
      this.camera.position.copy(this._camPos);
      this.camera.lookAt(this._camLook);
      const fov = cabin.fov || 82;
      if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 8); this.camera.updateProjectionMatrix(); }
      player.pos.set(v.pos.x, 0.5, v.pos.z);
      player.yaw = this._worldYaw(v);
      if (this.physics) this.physics.setPlayerPosition(player.pos.x, player.pos.y, player.pos.z);
      this._drawSpeedometer(curSpd * 3.6, v.kind, v._lastMotion);
      return;
    }
    // Gameplay heading determines the physical rear. _worldYaw includes the
    // GLB's model-axis correction and is only for the imported vehicle mesh.
    const totalYaw = chaseCameraYaw(v.yaw || 0, this._lookYaw, this._reverseCameraBlend);
    const cx = -Math.sin(totalYaw), cz = -Math.cos(totalYaw);
    const turnAmount = Math.abs(v.steerInput || 0);
    const camDist = 5.5 - turnAmount * 0.8 + Math.min(1.5, curSpd * 0.04);
    const camH = 2.8 + this._lookPitch * 2.2;
    const tPos = new THREE.Vector3(v.pos.x - cx * camDist, 0, v.pos.z - cz * camDist);
    const tLook = new THREE.Vector3(v.pos.x + cx * 4.5, 0, v.pos.z + cz * 4.5);

    // Sample the support surface at the actual chase-camera XZ. The max-height
    // gate rejects a different bridge deck above the vehicle (for example,
    // when driving underneath an overpass), while selecting the deck being
    // driven on when the camera is over that same bridge.
    const vehicleGroundY = Number.isFinite(v.pos.y) ? v.pos.y : 0;
    let cameraSurfaceY = null;
    if (typeof this.world?.groundHeightAt === 'function') {
      cameraSurfaceY = this.world.groundHeightAt(
        tPos.x, tPos.z, vehicleGroundY + 1.25,
      );
    }
    const cameraHeights = getBridgeAwareChaseHeights(
      vehicleGroundY, cameraSurfaceY, camH, 1.0,
    );
    tPos.y = cameraHeights.cameraY;
    tLook.y = cameraHeights.lookY;
    if (!this._camPos) {
      this._camPos = tPos.clone();
      this._camLook = tLook.clone();
    }
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
    this._drawSpeedometer(curSpd * 3.6, v.kind, v._lastMotion);
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
