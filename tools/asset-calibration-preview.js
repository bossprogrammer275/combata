import * as THREE from 'three';
import { GLTFLoader } from '../js/lib/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const assetUrl = params.get('asset');
const allowed = /^\/(?:data\/models\/(?:assets|cars)\/)[^?#]+\.(?:glb|gltf)$/i;
if (!assetUrl || !allowed.test(assetUrl)) throw new Error('A valid /data/models/assets/ or /data/models/cars/ model path is required.');

const mount = document.querySelector('#view');
const busy = document.querySelector('#busy');
const meta = document.querySelector('#meta');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = false;
mount.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe5e8);
scene.add(new THREE.HemisphereLight(0xffffff, 0x65746a, 2.0));
const key = new THREE.DirectionalLight(0xfff2df, 2.8);
key.position.set(9, 15, 11);
scene.add(key);
const fill = new THREE.DirectionalLight(0xc8dcff, 1.0);
fill.position.set(-10, 8, -7);
scene.add(fill);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.005, 100000);
const loader = new GLTFLoader();
const referenceGroup = new THREE.Group();
referenceGroup.name = 'calibration_reference_objects';
scene.add(referenceGroup);

let model = null;
let modelReport = null;
let cameraState = null;
let collisionMode = false;
let floorGrid = null;

function disposeGroup(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    list.forEach(m => materials.add(m));
  });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
}

function addBox(parent, size, position, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, radiusTop, radiusBottom, height, position, material, segments = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function sphere(parent, radius, position, material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function addHuman(parent, x, y, z) {
  const g = new THREE.Group();
  g.name = 'reference_human_1_8m';
  g.position.set(x, y, z);
  parent.add(g);
  const mat = new THREE.MeshStandardMaterial({ color: 0x277b59, roughness: 0.82 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x173d31, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x9d684a, roughness: 0.9 });
  cylinder(g, 0.105, 0.13, 0.58, [0, 1.12, 0], mat);
  cylinder(g, 0.065, 0.085, 0.78, [-0.075, 0.39, 0], dark);
  cylinder(g, 0.065, 0.085, 0.78, [0.075, 0.39, 0], dark);
  cylinder(g, 0.035, 0.055, 0.57, [-0.19, 1.16, 0], mat);
  cylinder(g, 0.035, 0.055, 0.57, [0.19, 1.16, 0], mat);
  sphere(g, 0.13, [0, 1.62, 0], skin);
  addBox(g, [0.25, 0.08, 0.34], [0, 0.04, 0.055], dark);
  return g;
}

function addDoor(parent, x, y, z) {
  const g = new THREE.Group();
  g.name = 'reference_doorway_1m_by_2_1m';
  g.position.set(x, y, z);
  parent.add(g);
  const material = new THREE.MeshStandardMaterial({ color: 0xb86c25, roughness: 0.75 });
  const w = 1.0, h = 2.1, t = 0.09, d = 0.14;
  addBox(g, [t, h, d], [-w / 2, h / 2, 0], material);
  addBox(g, [t, h, d], [w / 2, h / 2, 0], material);
  addBox(g, [w + t, t, d], [0, h - t / 2, 0], material);
  return g;
}

function buildReferences(bounds, size) {
  disposeGroup(referenceGroup);
  referenceGroup.clear();
  const span = Math.max(size.x, size.y, size.z, 1);
  const gap = Math.max(1.25, span * 0.12);
  const baseY = bounds.min.y;
  const midZ = (bounds.min.z + bounds.max.z) * 0.5;
  const startX = bounds.max.x + gap;

  const cubeMat = new THREE.MeshStandardMaterial({ color: 0x286fbd, roughness: 0.75 });
  addHuman(referenceGroup, startX, baseY, midZ);
  addDoor(referenceGroup, startX + 1.8, baseY, midZ);
  addBox(referenceGroup, [1, 1, 1], [startX + 3.5, baseY + 0.5, midZ], cubeMat);
  cylinder(referenceGroup, 0.045, 0.045, 10, [startX + 5.3, baseY + 5, midZ], new THREE.MeshStandardMaterial({ color: 0xb84236, roughness: 0.8 }), 10);

  const axis = new THREE.AxesHelper(Math.max(2, Math.min(10, span * 0.12)));
  axis.position.set(bounds.min.x, baseY, bounds.min.z);
  referenceGroup.add(axis);

  if (floorGrid) {
    scene.remove(floorGrid);
    floorGrid.geometry.dispose();
    if (Array.isArray(floorGrid.material)) floorGrid.material.forEach(m => m.dispose());
    else floorGrid.material.dispose();
  }
  const gridSize = Math.max(24, Math.min(1000, Math.ceil(span * 1.25 / 10) * 10));
  const divisions = Math.min(500, Math.max(24, Math.round(gridSize)));
  floorGrid = new THREE.GridHelper(gridSize, divisions, 0x7f9287, 0xb9c6bf);
  floorGrid.position.set((bounds.min.x + bounds.max.x) / 2, baseY - 0.015, midZ);
  floorGrid.material.transparent = true;
  floorGrid.material.opacity = 0.55;
  scene.add(floorGrid);
}

function hasCollisionAncestor(node) {
  for (let current = node; current && current !== model; current = current.parent) {
    const n = String(current.name || '').toLowerCase();
    if (n === 'collision_proxies' || n.startsWith('col_')) return true;
  }
  return false;
}

function setCollisionMode(enabled) {
  collisionMode = !!enabled;
  model?.traverse(o => {
    if (!o.isMesh) return;
    o.visible = hasCollisionAncestor(o) === collisionMode;
  });
}

function frameAll() {
  const bounds = new THREE.Box3().setFromObject(model);
  const refBounds = new THREE.Box3().setFromObject(referenceGroup);
  bounds.union(refBounds);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 0.5);
  camera.near = Math.max(0.005, span / 20000);
  camera.far = Math.max(1000, span * 40);
  camera.position.set(center.x + span * 1.45, center.y + span * 0.95, center.z + span * 1.65);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  cameraState = { center, span };
  render();
}

function render() {
  renderer.render(scene, camera);
}

function setView(view) {
  if (!cameraState) return;
  setCollisionMode(view === 'collision');
  const { center, span } = cameraState;
  const distance = span * 2.35;
  const positions = {
    iso: [1.35, 0.95, 1.55],
    front: [0.05, 0.48, 2.4],
    side: [2.4, 0.48, 0.05],
    top: [0.05, 2.5, 0.05],
    collision: [1.35, 0.95, 1.55],
  };
  const v = positions[view] || positions.iso;
  camera.position.set(center.x + distance * v[0], center.y + distance * v[1], center.z + distance * v[2]);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  render();
  return { view, collisionMode, cameraPosition: camera.position.toArray(), target: center.toArray() };
}

function inspect(root, gltf) {
  let nodes = 0, meshCount = 0, triangles = 0, vertices = 0, materialCount = 0, textureCount = 0, collisionProxyCount = 0;
  const materials = new Set(), textures = new Set();
  root.traverse(o => {
    nodes++;
    if (!o.isMesh) return;
    meshCount++;
    const p = o.geometry?.getAttribute('position');
    vertices += p?.count || 0;
    triangles += Math.floor((o.geometry?.index?.count ?? p?.count ?? 0) / 3);
    if (hasCollisionAncestor(o)) collisionProxyCount++;
    const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of list) {
      materials.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }
  });
  materialCount = materials.size;
  textureCount = textures.size;
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  return {
    url: assetUrl,
    name: assetUrl.split('/').pop(),
    nodeCount: nodes,
    meshCount,
    triangleCount: triangles,
    vertexCount: vertices,
    materialCount,
    textureCount,
    animationCount: gltf.animations?.length || 0,
    collisionProxyCount,
    dimensions: { width: size.x, height: size.y, depth: size.z },
    boundsMin: bounds.min.toArray(),
    boundsMax: bounds.max.toArray(),
    sourceUnitStatus: 'unverified; glTF is conventionally metres, but exporter/model scale must be checked against references',
    worldUnitConvention: '1 world unit = 1 metre',
    referenceObjects: [
      { id: 'human', heightMetres: 1.8 },
      { id: 'doorway', widthMetres: 1.0, heightMetres: 2.1 },
      { id: 'cube', widthMetres: 1, heightMetres: 1, depthMetres: 1 },
      { id: 'pole', heightMetres: 10 },
    ],
  };
}

async function main() {
  const gltf = await loader.loadAsync(assetUrl);
  model = gltf.scene || gltf.scenes?.[0];
  if (!model) throw new Error('GLTFLoader returned no scene');
  model.name ||= assetUrl.split('/').pop();
  model.updateMatrixWorld(true);
  scene.add(model);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  buildReferences(bounds, size);
  modelReport = inspect(model, gltf);
  meta.textContent = modelReport.name + ' · ' + size.x.toFixed(3) + ' × ' + size.y.toFixed(3) + ' × ' + size.z.toFixed(3) + ' raw units · ' + modelReport.meshCount + ' meshes · ' + modelReport.collisionProxyCount + ' collision meshes';
  frameAll();
  busy.classList.add('hide');
  window.__ASSET_CALIBRATION__ = {
    ready: true,
    url: assetUrl,
    report: modelReport,
    setView,
    render,
  };
  window.dispatchEvent(new CustomEvent('asset-calibration-ready', { detail: modelReport }));
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  render();
});

main().catch(error => {
  meta.textContent = 'FAILED: ' + (error?.message || String(error));
  busy.textContent = 'MODEL CALIBRATION LOAD FAILED';
  busy.classList.remove('hide');
  window.__ASSET_CALIBRATION__ = { ready: false, error: String(error), url: assetUrl };
});
