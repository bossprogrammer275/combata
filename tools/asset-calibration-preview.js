import * as THREE from 'three';
import { GLTFLoader } from '../js/lib/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const assetUrl = params.get('asset');
const allowed = /^\/(?:data\/models\/(?:assets|cars)\/)[^?#]+\.(?:glb|gltf)$/i;
if (!assetUrl || !allowed.test(assetUrl)) {
  throw new Error('A valid /data/models/assets/ or /data/models/cars/ model path is required.');
}

const mount = document.querySelector('#view');
const busy = document.querySelector('#busy');
const meta = document.querySelector('#meta');
const renderer = new THREE.WebGLRenderer({
  canvas: document.createElement('canvas'),
  antialias: false,
  alpha: false,
  powerPreference: 'low-power',
  preserveDrawingBuffer: true,
});
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
const tenMetreGroup = new THREE.Group();
tenMetreGroup.name = 'calibration_10m_reference';
scene.add(tenMetreGroup);

let model = null;
let modelReport = null;
let cameraState = null;
let floorGrid = null;
let meshNodes = [];
let selectedMeshIndex = null;
let baseVisibility = new Map();

function clearGroup(group) {
  for (const child of [...group.children]) group.remove(child);
}

function addBox(parent, size, position, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
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
  const shirt = new THREE.MeshStandardMaterial({ color: 0x277b59, roughness: 0.82 });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x173d31, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x9d684a, roughness: 0.9 });
  cylinder(g, 0.105, 0.13, 0.58, [0, 1.12, 0], shirt);
  cylinder(g, 0.065, 0.085, 0.78, [-0.075, 0.39, 0], trousers);
  cylinder(g, 0.065, 0.085, 0.78, [0.075, 0.39, 0], trousers);
  cylinder(g, 0.035, 0.055, 0.57, [-0.19, 1.16, 0], shirt);
  cylinder(g, 0.035, 0.055, 0.57, [0.19, 1.16, 0], shirt);
  sphere(g, 0.13, [0, 1.67, 0], skin);
  addBox(g, [0.25, 0.08, 0.34], [0, 0.04, 0.055], trousers);
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
  clearGroup(referenceGroup);
  clearGroup(tenMetreGroup);

  const span = Math.max(size.x, size.y, size.z, 1);
  const gap = Math.max(1.25, Math.min(5, span * 0.05));
  const baseY = bounds.min.y;
  const midZ = (bounds.min.z + bounds.max.z) * 0.5;
  const startX = bounds.max.x + gap;

  const cubeMat = new THREE.MeshStandardMaterial({ color: 0x286fbd, roughness: 0.75 });
  addHuman(referenceGroup, startX, baseY, midZ);
  addDoor(referenceGroup, startX + 1.8, baseY, midZ);
  addBox(referenceGroup, [1, 1, 1], [startX + 3.5, baseY + 0.5, midZ], cubeMat);

  cylinder(
    tenMetreGroup,
    0.045,
    0.045,
    10,
    [startX + 5.3, baseY + 5, midZ],
    new THREE.MeshStandardMaterial({ color: 0xb84236, roughness: 0.8 }),
    10,
  );

  const axis = new THREE.AxesHelper(2);
  axis.position.set(bounds.min.x, baseY, bounds.min.z);
  referenceGroup.add(axis);

  if (floorGrid) {
    scene.remove(floorGrid);
    floorGrid.geometry.dispose();
    if (Array.isArray(floorGrid.material)) floorGrid.material.forEach(m => m.dispose());
    else floorGrid.material.dispose();
  }
  const gridSize = Math.max(12, Math.min(1000, Math.ceil(span * 1.1 / 10) * 10));
  const divisions = Math.min(500, Math.max(12, Math.round(gridSize)));
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

function applyVisibility(collision = false) {
  for (const mesh of meshNodes) {
    if (collision) {
      mesh.visible = hasCollisionAncestor(mesh);
    } else if (selectedMeshIndex !== null) {
      mesh.visible = meshNodes[selectedMeshIndex] === mesh && !hasCollisionAncestor(mesh);
    } else {
      mesh.visible = !hasCollisionAncestor(mesh) && (baseVisibility.get(mesh) ?? true);
    }
  }
}

function getActiveBounds() {
  if (selectedMeshIndex !== null && meshNodes[selectedMeshIndex]) {
    return new THREE.Box3().setFromObject(meshNodes[selectedMeshIndex]);
  }
  return new THREE.Box3().setFromObject(model);
}

function frameAll(view = 'iso') {
  const activeBounds = getActiveBounds();
  const bounds = activeBounds.clone();
  bounds.union(new THREE.Box3().setFromObject(referenceGroup));
  if (view === 'scale') bounds.union(new THREE.Box3().setFromObject(tenMetreGroup));

  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 0.5);
  camera.near = Math.max(0.005, span / 20000);
  camera.far = Math.max(1000, span * 40);
  cameraState = { center, span };
  return cameraState;
}

function render() {
  renderer.render(scene, camera);
}

function setView(view = 'iso') {
  if (!cameraState) return null;
  const isCollision = view === 'collision';
  applyVisibility(isCollision);
  const { center, span } = frameAll(view);
  const distance = span * 1.9;
  const positions = {
    iso: [1.35, 0.95, 1.55],
    front: [0.05, 0.38, 2.4],
    side: [2.4, 0.38, 0.05],
    top: [0.05, 2.5, 0.05],
    collision: [1.35, 0.95, 1.55],
    scale: [1.35, 0.95, 1.55],
  };
  const v = positions[view] || positions.iso;
  camera.position.set(center.x + distance * v[0], center.y + distance * v[1], center.z + distance * v[2]);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  render();
  return {
    view,
    collisionMode: isCollision,
    selectedMeshIndex,
    cameraPosition: camera.position.toArray(),
    target: center.toArray(),
  };
}

function setMeshIsolation(index) {
  if (!Number.isInteger(index) || index < 0 || index >= meshNodes.length) {
    throw new Error('Invalid mesh index: ' + index);
  }
  selectedMeshIndex = index;
  applyVisibility(false);
  const bounds = getActiveBounds();
  const size = bounds.getSize(new THREE.Vector3());
  buildReferences(bounds, size);
  frameAll('iso');
  setView('iso');
  return modelReport.meshDetails[index];
}

function restoreAllMeshes() {
  selectedMeshIndex = null;
  applyVisibility(false);
  const bounds = getActiveBounds();
  buildReferences(bounds, bounds.getSize(new THREE.Vector3()));
  frameAll('iso');
  setView('iso');
}

function inspect(root, gltf) {
  let nodes = 0, meshCount = 0, triangles = 0, vertices = 0;
  const materials = new Set();
  const textures = new Set();
  const details = [];
  meshNodes = [];

  root.traverse(o => {
    nodes++;
    if (!o.isMesh) return;
    const index = meshNodes.length;
    meshNodes.push(o);
    baseVisibility.set(o, o.visible);
    const p = o.geometry?.getAttribute('position');
    const vertexCount = p?.count || 0;
    const triangleCount = Math.floor((o.geometry?.index?.count ?? vertexCount) / 3);
    vertices += vertexCount;
    triangles += triangleCount;

    const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of list) {
      materials.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }

    const names = [];
    for (let node = o; node && node !== root; node = node.parent) {
      if (node.name) names.unshift(node.name);
    }
    const bounds = new THREE.Box3().setFromObject(o);
    const dimensions = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    details.push({
      index,
      name: o.name || names.at(-1) || ('mesh-' + index),
      nodePath: names.join(' / '),
      dimensions: dimensions.toArray(),
      center: center.toArray(),
      vertexCount,
      triangleCount,
      collisionProxy: hasCollisionAncestor(o),
      visibleAtLoad: o.visible,
      materialNames: list.map(material => material?.name || 'unnamed'),
    });
    meshCount++;
  });

  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  return {
    url: assetUrl,
    name: assetUrl.split('/').pop(),
    nodeCount: nodes,
    meshCount,
    triangleCount: triangles,
    vertexCount: vertices,
    materialCount: materials.size,
    textureCount: textures.size,
    animationCount: gltf.animations?.length || 0,
    collisionProxyCount: details.filter(item => item.collisionProxy).length,
    dimensions: { width: size.x, height: size.y, depth: size.z },
    boundsMin: bounds.min.toArray(),
    boundsMax: bounds.max.toArray(),
    meshDetails: details,
    sourceUnitStatus: 'unverified; glTF is conventionally metres, but exporter/model scale must be checked against references',
    worldUnitConvention: '1 world unit = 1 metre',
    referenceObjects: [
      { id: 'human', heightMetres: 1.8 },
      { id: 'doorway', widthMetres: 1.0, heightMetres: 2.1 },
      { id: 'cube', widthMetres: 1, heightMetres: 1, depthMetres: 1 },
      { id: 'pole', heightMetres: 10, shownIn: 'scale view' },
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

  modelReport = inspect(model, gltf);
  const bounds = new THREE.Box3().setFromObject(model);
  buildReferences(bounds, bounds.getSize(new THREE.Vector3()));
  applyVisibility(false);
  meta.textContent = modelReport.name + ' · '
    + modelReport.dimensions.width.toFixed(3) + ' × '
    + modelReport.dimensions.height.toFixed(3) + ' × '
    + modelReport.dimensions.depth.toFixed(3)
    + ' source units · ' + modelReport.meshCount + ' meshes · '
    + modelReport.collisionProxyCount + ' collision meshes';

  frameAll('iso');
  setView('iso');
  busy.classList.add('hide');
  window.__ASSET_CALIBRATION__ = {
    ready: true,
    url: assetUrl,
    report: modelReport,
    setView,
    setMeshIsolation,
    restoreAllMeshes,
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
