import * as THREE from 'three';
import { GLTFLoader } from '../js/lib/GLTFLoader.js';
import { OrbitControls } from '../js/lib/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const canvas = $('asset-canvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe5e8);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = false;

scene.add(new THREE.HemisphereLight(0xffffff, 0x5b665d, 2.0));
const key = new THREE.DirectionalLight(0xfff2df, 2.8);
key.position.set(9, 15, 11);
scene.add(key);
const fill = new THREE.DirectionalLight(0xc8dcff, 1.0);
fill.position.set(-10, 8, -7);
scene.add(fill);

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
controls.enablePan = true;
const grid = new THREE.GridHelper(100, 50, 0x8b9992, 0xc7d0ca);
grid.material.transparent = true;
grid.material.opacity = 0.4;
scene.add(grid);

const loader = new GLTFLoader();
let current = null;
let currentEntry = null;
let manifest = [];
let resizeObserver;

function resize() {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}
resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(canvas.parentElement);
window.addEventListener('resize', resize);

function disposeCurrent() {
  if (!current) return;
  scene.remove(current);
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  current.traverse((obj) => {
    if (obj.geometry) geometries.add(obj.geometry);
    const list = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const material of list) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  current = null;
}

function inspect(root, gltf) {
  let nodes = 0;
  let meshNodes = 0;
  let vertices = 0;
  let triangles = 0;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const meshNames = [];
  const seen = new Set();

  root.traverse((obj) => {
    nodes++;
    if (!obj.isMesh) return;
    meshNodes++;
    if (obj.geometry) {
      geometries.add(obj.geometry);
      const p = obj.geometry.getAttribute('position');
      if (p) vertices += p.count;
      const indexCount = obj.geometry.index?.count ?? p?.count ?? 0;
      triangles += Math.floor(indexCount / 3);
    }
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    mats.forEach((m) => {
      materials.add(m);
      Object.values(m).forEach((v) => { if (v?.isTexture) textures.add(v); });
    });
    const chain = [];
    let n = obj;
    while (n && n !== root) {
      if (n.name) chain.unshift(n.name);
      n = n.parent;
    }
    const label = chain.join(' / ') || obj.name || 'unnamed mesh';
    if (!seen.has(label)) { seen.add(label); meshNames.push(label); }
  });

  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const dimensions = [size.x, size.y, size.z].map((v) => Number(v.toFixed(3)));
  const visibleCount = (() => {
    let count = 0;
    root.traverse((o) => { if (o.isMesh && o.visible) count++; });
    return count;
  })();

  return {
    path: currentEntry.path,
    url: currentEntry.url,
    name: currentEntry.name,
    format: currentEntry.format,
    nodeCount: nodes,
    meshNodeCount: meshNodes,
    visibleMeshCount: visibleCount,
    uniqueGeometryCount: geometries.size,
    triangleCount: triangles,
    vertexCount: vertices,
    materialCount: materials.size,
    textureCount: textures.size,
    animationCount: gltf.animations?.length || 0,
    dimensions,
    boundsMin: [bounds.min.x, bounds.min.y, bounds.min.z].map((v) => Number(v.toFixed(3))),
    boundsMax: [bounds.max.x, bounds.max.y, bounds.max.z].map((v) => Number(v.toFixed(3))),
    meshNames,
    emptyBounds: !Number.isFinite(center.x) || size.length() < 0.0001,
  };
}

function frame(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 0.5);
  const floorY = Number.isFinite(box.min.y) ? box.min.y : 0;
  grid.position.y = floorY - 0.015;
  controls.target.copy(center);
  camera.near = Math.max(0.005, span / 20000);
  camera.far = Math.max(1000, span * 40);
  camera.position.set(center.x + span * 1.45, center.y + span * 0.95, center.z + span * 1.65);
  camera.updateProjectionMatrix();
  controls.update();
  renderer.render(scene, camera);
}

function updatePanel(report, index, total, status) {
  $('counter').textContent = total ? `Model ${index + 1} / ${total}` : 'No models found';
  $('asset-name').textContent = report?.name || 'Loading model';
  $('asset-path').textContent = report?.path || '';
  $('status').textContent = status;
  $('meshes').textContent = report?.meshNodeCount ?? '—';
  $('triangles').textContent = report?.triangleCount?.toLocaleString() ?? '—';
  $('materials').textContent = report?.materialCount ?? '—';
  $('textures').textContent = report?.textureCount ?? '—';
  $('vertices').textContent = report?.vertexCount?.toLocaleString() ?? '—';
  $('animations').textContent = report?.animationCount ?? '—';
  $('dimensions').textContent = report?.dimensions ? report.dimensions.map((v) => v + ' m').join(' × ') : '—';
  $('nodes').textContent = report?.nodeCount ?? '—';
  $('geometry').textContent = report?.uniqueGeometryCount ?? '—';
  $('separation').textContent = report ? (report.meshNodeCount === 1 ? 'Single mesh' : report.meshNodeCount + ' renderable mesh nodes') : '—';
  $('mesh-list').replaceChildren();
  (report?.meshNames || []).slice(0, 120).forEach((name) => {
    const li = document.createElement('li');
    li.textContent = name;
    $('mesh-list').append(li);
  });
  if (!report) {
    const li = document.createElement('li');
    li.textContent = 'No mesh data';
    $('mesh-list').append(li);
  }
}

async function loadAsset(index) {
  if (!manifest[index]) throw new Error('Asset index out of range: ' + index);
  disposeCurrent();
  currentEntry = manifest[index];
  updatePanel(null, index, manifest.length, 'Loading ' + currentEntry.format.toUpperCase() + ' through Three.js GLTFLoader…');
  const gltf = await loader.loadAsync(currentEntry.url);
  current = gltf.scene || gltf.scenes?.[0];
  if (!current) throw new Error('No scene returned by GLTFLoader');
  current.name = currentEntry.name;
  scene.add(current);
  frame(current);
  const report = inspect(current, gltf);
  updatePanel(report, index, manifest.length, report.emptyBounds ? 'Loaded, but model bounds are empty or degenerate.' : 'Loaded and rendered successfully.');
  return report;
}

async function setView(view) {
  if (!current) return;
  const b = new THREE.Box3().setFromObject(current);
  const s = b.getSize(new THREE.Vector3());
  const c = b.getCenter(new THREE.Vector3());
  const span = Math.max(s.x, s.y, s.z, 0.5);
  let offset;
  if (view === 'side') offset = new THREE.Vector3(span * 1.8, span * 0.65, 0.12);
  else if (view === 'front') offset = new THREE.Vector3(0.12, span * 0.55, span * 2.0);
  else if (view === 'top') offset = new THREE.Vector3(span * 0.15, span * 2.0, span * 0.15);
  else offset = new THREE.Vector3(span * 1.45, span * 0.95, span * 1.65);
  controls.target.copy(c);
  camera.position.copy(c).add(offset);
  controls.update();
  renderer.render(scene, camera);
}

async function init() {
  const response = await fetch('/tools/asset-review-manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Asset manifest missing. Run tools/verify-asset-review.mjs first.');
  manifest = await response.json();
  $('status').textContent = 'Manifest loaded · ' + manifest.length + ' model files queued.';
  window.__ASSET_REVIEW__ = { manifest, loadAsset, setView, getCurrent: () => currentEntry };
  if (manifest.length) await loadAsset(0);
}

init().catch((error) => {
  $('status').textContent = 'INITIALIZATION FAILED: ' + (error?.message || String(error));
  window.__ASSET_REVIEW__ = { error: String(error), manifest };
});
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
