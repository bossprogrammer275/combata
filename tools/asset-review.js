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
let currentIndex = -1;
let currentMeshObjects = [];
let isolatedMesh = null;
let currentCalibration = null;
let currentCalibrationStale = false;
let selectedCalibrationNodeKey = null;
let selectedTraversalNodeKey = null;
let calibrationOverlayRoot = null;
let calibrationOverlayObjects = [];
let showCollisionOverlay = false;
let showSurfaceOverlay = true;
let showTraversalOverlay = true;
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
  clearCalibrationOverlay();
  currentCalibration = null;
  currentCalibrationStale = false;
  selectedCalibrationNodeKey = null;
  selectedTraversalNodeKey = null;
  currentMeshObjects = [];
  isolatedMesh = null;
  $('mesh-list')?.replaceChildren();
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
  let groupNodes = 0;
  let vertices = 0;
  let triangles = 0;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const meshNames = [];
  const meshDetails = [];
  const meshObjects = [];
  const seen = new Set();

  root.traverse((obj) => {
    nodes++;
    if (obj.isGroup) groupNodes++;
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
    const nodeKey = getAssetNodeKey(root, obj);
    obj.updateWorldMatrix(true, false);
    const meshBounds = new THREE.Box3().setFromObject(obj);
    const meshSize = meshBounds.getSize(new THREE.Vector3());
    const meshCenter = meshBounds.getCenter(new THREE.Vector3());
    meshDetails.push({
      nodeKey,
      name: label,
      dimensions: [meshSize.x, meshSize.y, meshSize.z].map(v => Number(v.toFixed(3))),
      center: [meshCenter.x, meshCenter.y, meshCenter.z].map(v => Number(v.toFixed(3))),
      triangles: obj.geometry?.index?.count
        ? Math.floor(obj.geometry.index.count / 3)
        : Math.floor((obj.geometry?.getAttribute('position')?.count || 0) / 3),
      materials: mats.map(material => material?.name || 'unnamed'),
    });
    meshObjects.push({ object: obj, label, nodeKey, visibleAtLoad: obj.visible });
    if (!seen.has(label)) { seen.add(label); meshNames.push(label); }
  });
  currentMeshObjects = meshObjects;

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
    groupNodeCount: groupNodes,
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
    meshDetails,
    emptyBounds: !Number.isFinite(center.x) || size.length() < 0.0001,
  };
}


function getAssetNodeKey(root, node) {
  const parts = [];
  let currentNode = node;
  while (currentNode && currentNode !== root) {
    const parent = currentNode.parent;
    const index = parent ? parent.children.indexOf(currentNode) : 0;
    parts.unshift(`${currentNode.name || currentNode.type || 'node'}[${index}]`);
    currentNode = parent;
  }
  return parts.join('/');
}

function calibrationHasAnchor(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.trim().length > 0 && Number.isFinite(Number(value));
  if (Array.isArray(value)) return value.length > 0 && value.every(item => Number.isFinite(Number(item)));
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value.position)) return value.position.length >= 3 && value.position.slice(0, 3).every(item => Number.isFinite(Number(item)));
  if (value.position && ['x', 'y', 'z'].every(key => Number.isFinite(Number(value.position[key])))) return true;
  return ['x', 'y', 'z'].every(key => Number.isFinite(Number(value[key]))) || Object.keys(value).length > 0;
}

function selectedCalibrationComponent() {
  return currentCalibration?.components?.find(component => component.nodeKey === selectedCalibrationNodeKey) || null;
}

function selectedCalibrationSurface() {
  return currentCalibration?.road?.surfaces?.find(surface => surface.nodeKey === selectedCalibrationNodeKey) || null;
}

function selectedCalibrationTraversal() {
  return currentCalibration?.traversal?.find(candidate => candidate.nodeKey === selectedTraversalNodeKey) || null;
}

function disposeOverlayObject(object) {
  object.traverse?.(child => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    materials.forEach(material => material?.dispose?.());
  });
  if (object.geometry) object.geometry.dispose();
  const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
  materials.forEach(material => material?.dispose?.());
}

function clearCalibrationOverlay() {
  if (calibrationOverlayRoot) {
    calibrationOverlayRoot.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
      materials.forEach(material => material?.dispose?.());
    });
    calibrationOverlayRoot.removeFromParent();
  }
  calibrationOverlayRoot = null;
  calibrationOverlayObjects = [];
}

function addCalibrationBox(bounds, color = 0xe07b72, opacity = 0.92) {
  if (!calibrationOverlayRoot || !bounds?.min || !bounds?.max) return;
  const min = bounds.min, max = bounds.max;
  const size = new THREE.Vector3(
    Number(max[0]) - Number(min[0]),
    Number(max[1]) - Number(min[1]),
    Number(max[2]) - Number(min[2]),
  );
  if (![size.x, size.y, size.z].every(Number.isFinite) || Math.max(size.x, size.y, size.z) <= 0) return;
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(
    Math.max(0.005, size.x), Math.max(0.005, size.y), Math.max(0.005, size.z),
  ));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.position.set(
    (Number(min[0]) + Number(max[0])) * 0.5,
    (Number(min[1]) + Number(max[1])) * 0.5,
    (Number(min[2]) + Number(max[2])) * 0.5,
  );
  lines.renderOrder = 1000;
  calibrationOverlayRoot.add(lines);
}

function addCalibrationMarker(position, color, radius = 0.13) {
  if (!calibrationOverlayRoot || !Array.isArray(position) || position.length < 3) return;
  if (!position.slice(0, 3).every(value => Number.isFinite(Number(value)))) return;
  const geometry = new THREE.SphereGeometry(radius, 10, 8);
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const marker = new THREE.Mesh(geometry, material);
  marker.position.set(Number(position[0]), Number(position[1]), Number(position[2]));
  marker.renderOrder = 1001;
  calibrationOverlayRoot.add(marker);
}

function renderCalibrationOverlay() {
  clearCalibrationOverlay();
  if (!current || !currentCalibration) return;
  calibrationOverlayRoot = new THREE.Group();
  calibrationOverlayRoot.name = 'asset-calibration-review-overlays';
  calibrationOverlayRoot.renderOrder = 999;
  current.add(calibrationOverlayRoot);

  if (showCollisionOverlay) {
    for (const box of currentCalibration.collision?.boxes || []) {
      if (Array.isArray(box) && box.length >= 6) {
        const [x, y, z, w, h, d] = box;
        addCalibrationBox({
          min: [x - w / 2, y - h / 2, z - d / 2],
          max: [x + w / 2, y + h / 2, z + d / 2],
        }, 0xe07b72, 0.78);
      } else if (box?.center && box?.size) {
        const [x, y, z] = box.center, [w, h, d] = box.size;
        addCalibrationBox({
          min: [x - w / 2, y - h / 2, z - d / 2],
          max: [x + w / 2, y + h / 2, z + d / 2],
        }, 0xe07b72, 0.78);
      } else if (box?.min && box?.max) {
        addCalibrationBox(box, 0xe07b72, 0.78);
      }
    }
    // Authored col_* meshes are the runtime collision source when present.
    // Show their measured bounds separately from generated collision boxes.
    for (const proxy of currentCalibration.collision?.nativeProxies || []) {
      if (proxy.bounds?.min && proxy.bounds?.max) {
        addCalibrationBox(proxy.bounds, 0x72a9e8, 0.92);
      }
    }
  }

  if (showSurfaceOverlay) {
    const surfaces = currentCalibration.road?.surfaces || [];
    for (const surface of surfaces) {
      const component = currentCalibration.components?.find(item => item.nodeKey === surface.nodeKey);
      if (component?.bounds) addCalibrationBox(component.bounds, surface.runtimeEnabled ? 0x79d4a1 : 0xd6b86e, 0.95);
      const connection = surface.connection;
      const localPoints = Array.isArray(connection?.points) && connection.points.length >= 2
        ? connection.points
        : (connection?.start?.position && connection?.end?.position
          ? [connection.start.position, connection.end.position] : []);
      if (localPoints.length >= 2) {
        const color = connection.accepted === true ? 0x47d78b : 0xe1b65d;
        addCalibrationMarker(localPoints[0], color, 0.17);
        addCalibrationMarker(localPoints[localPoints.length - 1], color, 0.17);
        const points = localPoints.map(point => new THREE.Vector3(Number(point[0]), Number(point[1]), Number(point[2])));
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color, depthTest: false });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 1002;
        calibrationOverlayRoot.add(line);
      }
    }
  }

  if (showTraversalOverlay) {
    const candidates = currentCalibration.traversal || [];
    current.updateMatrixWorld(true);
    const toReviewRoot = (candidate, value) => {
      const source = currentMeshObjects.find(entry => entry.nodeKey === candidate.nodeKey)?.object;
      if (!source) return null;
      const raw = Array.isArray(value) ? value : (value?.position || value);
      if (!Array.isArray(raw) || raw.length < 3
        || !raw.slice(0, 3).every(item => Number.isFinite(Number(item)))) return null;
      const worldPoint = source.localToWorld(new THREE.Vector3(Number(raw[0]), Number(raw[1]), Number(raw[2])));
      return current.worldToLocal(worldPoint.clone());
    };
    for (const candidate of candidates) {
      const path = candidate.anchors?.rootPath || candidate.anchors?.climbPath || [];
      const points = path.map(item => toReviewRoot(candidate, item?.position || item)).filter(Boolean);
      if (points.length >= 2) {
        const accepted = candidate.accepted === true && candidate.runtimeEnabled === true
          && candidate.requiresReview === false;
        const selected = candidate.nodeKey === selectedTraversalNodeKey;
        const color = selected ? 0x75b9ef : accepted ? 0x47d78b : 0xe1b65d;
        points.forEach(point => addCalibrationMarker(point.toArray(), color, selected ? 0.14 : 0.1));
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color, depthTest: false });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 1003;
        calibrationOverlayRoot.add(line);
      }
      const contacts = candidate.anchors?.boneContacts || [];
      for (const contact of contacts) {
        const point = toReviewRoot(candidate, contact.position);
        if (point) addCalibrationMarker(point.toArray(), 0x75b9ef, 0.1);
      }
      for (const key of ['approach', 'handContact', 'topOut', 'landing', 'mountBottom', 'mountTop', 'bottomDismount']) {
        const point = toReviewRoot(candidate, candidate.anchors?.[key]);
        if (point) addCalibrationMarker(point.toArray(), 0x75b9ef, 0.13);
      }
    }
  }
  const selected = selectedCalibrationComponent();
  if (selected?.bounds) addCalibrationBox(selected.bounds, 0x75b9ef, 1);
  current.updateMatrixWorld(true);
}

function setCalibrationStatus(message, tone = 'normal') {
  const node = $('calibration-status');
  node.textContent = message;
  node.className = tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : '';
}

function updateCalibrationSummary() {
  if (!currentCalibration) return;
  const components = currentCalibration.components || [];
  const surfaces = currentCalibration.road?.surfaces || [];
  $('calibration-components').textContent = components.length;
  $('calibration-boxes').textContent = currentCalibration.collision?.boxCount
    ?? currentCalibration.collision?.boxes?.length ?? 0;
  $('calibration-native-proxies').textContent = currentCalibration.collision?.nativeProxyCount
    ?? currentCalibration.collision?.nativeProxies?.length ?? 0;
  $('calibration-surfaces').textContent = surfaces.length;
  $('calibration-traversals').textContent = currentCalibration.traversal?.length || 0;
  const status = currentCalibrationStale ? 'STALE SOURCE HASH · regenerate calibration before saving'
    : (currentCalibration.review?.status || 'needs-review').toUpperCase()
      + ' · ' + (currentCalibration.review?.outstanding?.length || 0) + ' outstanding';
  setCalibrationStatus(status, currentCalibrationStale ? 'error' : currentCalibration.review?.approved ? 'normal' : 'warning');
}

function refreshCalibrationEditors() {
  const select = $('calibration-component');
  const components = currentCalibration?.components || [];
  const previous = selectedCalibrationNodeKey;
  select.replaceChildren();
  for (const component of components) {
    const option = document.createElement('option');
    option.value = component.nodeKey;
    const state = component.requiresReview === false ? 'reviewed' : 'needs review';
    option.textContent = `${component.role} · ${component.name || component.nodePath || component.nodeKey} · ${state}`;
    select.append(option);
  }
  if (!components.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No detected components';
    select.append(option);
    selectedCalibrationNodeKey = null;
  } else {
    selectedCalibrationNodeKey = components.some(item => item.nodeKey === previous)
      ? previous : components[0].nodeKey;
    select.value = selectedCalibrationNodeKey;
  }
  const component = selectedCalibrationComponent();
  $('calibration-json').value = component ? JSON.stringify(component, null, 2) : '';
  const surface = selectedCalibrationSurface();
  $('calibration-connection-json').value = surface?.connection ? JSON.stringify(surface.connection, null, 2) : '';
  const traversalSelect = $('calibration-traversal');
  const traversals = currentCalibration?.traversal || [];
  const previousTraversal = selectedTraversalNodeKey;
  traversalSelect.replaceChildren();
  for (const candidate of traversals) {
    const option = document.createElement('option');
    option.value = candidate.nodeKey;
    option.textContent = `${candidate.actionCandidate} · ${candidate.nodeKey} · ${candidate.requiresReview === false ? 'reviewed' : 'needs review'}`;
    traversalSelect.append(option);
  }
  if (!traversals.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No traversal candidates';
    traversalSelect.append(option);
    selectedTraversalNodeKey = null;
  } else {
    selectedTraversalNodeKey = traversals.some(item => item.nodeKey === previousTraversal)
      ? previousTraversal : traversals[0].nodeKey;
    traversalSelect.value = selectedTraversalNodeKey;
  }
  const traversal = selectedCalibrationTraversal();
  $('calibration-traversal-json').value = traversal ? JSON.stringify(traversal, null, 2) : '';
  const hasTraversal = !!traversal;
  $('calibration-save-traversal').disabled = !hasTraversal || currentCalibrationStale;
  $('calibration-accept-traversal').disabled = !hasTraversal || currentCalibrationStale;

  const hasComponent = !!component;
  const hasSurface = !!surface;
  $('calibration-save-component').disabled = !hasComponent || currentCalibrationStale;
  $('calibration-accept-component').disabled = !hasComponent || currentCalibrationStale;
  $('calibration-save-connection').disabled = !hasSurface || currentCalibrationStale;
  $('calibration-accept-connection').disabled = !hasSurface || currentCalibrationStale;
  updateCalibrationSummary();
}

async function loadCalibrationForCurrent() {
  currentCalibration = null;
  currentCalibrationStale = false;
  selectedCalibrationNodeKey = null;
  if (!currentEntry) return;
  try {
    const response = await fetch('/api/asset-calibration?path=' + encodeURIComponent(currentEntry.path), { cache: 'no-store' });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || ('HTTP ' + response.status));
    const result = await response.json();
    currentCalibration = result.exists ? result.data : null;
    currentCalibrationStale = !!result.stale;
    if (!currentCalibration) {
      $('calibration-components').textContent = '—';
      $('calibration-boxes').textContent = '—';
      $('calibration-surfaces').textContent = '—';
      $('calibration-native-proxies').textContent = '—';
      $('calibration-traversals').textContent = '—';
      $('calibration-component').replaceChildren();
      $('calibration-traversal').replaceChildren();
      $('calibration-json').value = '';
      $('calibration-connection-json').value = '';
      setCalibrationStatus('No sidecar yet · run pnpm calibrate:asset -- ' + currentEntry.path, 'warning');
      ['calibration-save-component','calibration-accept-component','calibration-save-connection','calibration-accept-connection','calibration-save-traversal','calibration-accept-traversal'].forEach(id => { $(id).disabled = true; });
      renderCalibrationOverlay();
      return;
    }
    refreshCalibrationEditors();
    if (currentCalibrationStale) {
      setCalibrationStatus('STALE SOURCE HASH · source model changed; rerun calibrator before saving', 'error');
      ['calibration-save-component','calibration-accept-component','calibration-save-connection','calibration-accept-connection'].forEach(id => { $(id).disabled = true; });
    } else if (!currentCalibration.review?.approved) {
      setCalibrationStatus((currentCalibration.review?.status || 'NEEDS REVIEW').toUpperCase()
        + ' · ' + (currentCalibration.review?.outstanding?.length || 0) + ' outstanding', 'warning');
    }
    renderCalibrationOverlay();
  } catch (error) {
    setCalibrationStatus('Calibration API unavailable: ' + (error?.message || String(error)), 'error');
  }
}

function recomputeCalibrationReview() {
  if (!currentCalibration) return;
  const components = currentCalibration.components || [];
  const surfaces = currentCalibration.road?.surfaces || [];
  const componentByKey = new Map(components.map(component => [component.nodeKey, component]));

  // Keep the bridge's section-level profile aligned with its deck surface
  // record. The runtime bridge-kit consumes section profiles; tyre sampling
  // consumes the road surface profiles.
  for (const section of currentCalibration.bridge?.sections || []) {
    const deckKey = section.deckComponent?.nodeKey;
    const surface = surfaces.find(item => item.nodeKey === deckKey);
    if (surface?.connection?.accepted === true && surface.connection.requiresReview === false) {
      section.connection = surface.connection;
      section.requiresReview = false;
    } else {
      if (surface?.connection) section.connection = surface.connection;
      section.requiresReview = true;
    }
  }
  if (currentCalibration.bridge) {
    currentCalibration.bridge.requiresReview = (currentCalibration.bridge.sections || [])
      .some(section => section.requiresReview !== false);
  }

  const outstanding = [
    ...components.filter(component => component.requiresReview !== false).map(component => ({
      componentId: component.id, nodeKey: component.nodeKey, role: component.role,
      reason: 'Confirm component identity, bounds, anchors and runtime behaviour.',
    })),
    ...(currentCalibration.traversal || []).filter(candidate => candidate.requiresReview !== false).map(candidate => ({
      componentId: candidate.componentId, nodeKey: candidate.nodeKey, role: candidate.actionCandidate,
      reason: 'Confirm animation contact, capsule clearance and landing support.',
    })),
    ...surfaces.filter(surface =>
      surface.connection?.status !== 'estimated'
      || surface.connection?.accepted !== true
      || surface.connection?.requiresReview !== false
    ).map(surface => ({
      componentId: surface.id, nodeKey: surface.nodeKey, role: surface.role,
      reason: 'Approve the imported road/bridge connection after checking endpoints and width.',
    })),
    ...(currentCalibration.bridge?.sections || []).filter(section => section.requiresReview !== false).map(section => ({
      componentId: section.id,
      nodeKey: section.deckComponent?.nodeKey || null,
      role: 'bridge-section',
      reason: 'Review this section socket or record a manually measured curved/ramp connection.',
    })),
  ];
  currentCalibration.review ||= {};
  currentCalibration.review.outstanding = outstanding;
  currentCalibration.review.approved = outstanding.length === 0;
  currentCalibration.review.status = outstanding.length ? 'needs-review' : 'approved';
  currentCalibration.review.lastReviewedAt = new Date().toISOString();
  currentCalibration.interactions = components.filter(component => component.interaction).map(component => ({
    componentId: component.id,
    nodeKey: component.nodeKey,
    kind: component.interaction.kind,
    accepted: component.interaction.accepted === true,
    requiredAnchors: component.interaction.requiredAnchors || [],
    bounds: component.bounds,
    confidence: component.confidence,
    requiresReview: component.requiresReview !== false,
  }));
  // Collision exclusions are scan-owned and are never edited from this review panel.
}

function saveParsedComponent() {
  if (!currentCalibration || currentCalibrationStale) throw new Error('Calibration is missing or stale.');
  const component = JSON.parse($('calibration-json').value);
  if (component.nodeKey !== selectedCalibrationNodeKey) throw new Error('Component nodeKey cannot be changed.');
  const index = currentCalibration.components.findIndex(item => item.nodeKey === selectedCalibrationNodeKey);
  if (index < 0) throw new Error('Selected component no longer exists.');
  const previous = currentCalibration.components[index];
  const scannedExclusions = new Set(currentCalibration.collision?.excludedDriveableMeshKeys || []);
  const wasExcludedByScan = scannedExclusions.has(selectedCalibrationNodeKey);
  if (component.runtimeEnabled !== previous.runtimeEnabled
    || (wasExcludedByScan && (component.role !== previous.role || component.kind !== previous.kind))
    || (component.runtimeEnabled === true && !wasExcludedByScan)) {
    throw new Error('Collision roles and runtimeEnabled are fixed by the scan. Change source geometry and rerun calibration instead.');
  }
  currentCalibration.components[index] = component;
  recomputeCalibrationReview();
  refreshCalibrationEditors();
  renderCalibrationOverlay();
  return component;
}

function saveSelectedComponent() {
  try {
    saveParsedComponent();
    setCalibrationStatus('Component edits applied in memory. Save the sidecar after reviewing.', 'normal');
  } catch (error) {
    setCalibrationStatus('Component edit rejected: ' + (error?.message || String(error)), 'error');
  }
}

function acceptSelectedComponent() {
  try {
    const component = saveParsedComponent();
    const interaction = component.interaction;
    if (interaction) {
      const anchors = interaction.anchors || {};
      const missing = (interaction.requiredAnchors || []).filter(key => !calibrationHasAnchor(anchors[key]));
      if (missing.length) throw new Error('Missing required anchors: ' + missing.join(', '));
      interaction.accepted = true;
    }
    component.manual = true;
    component.requiresReview = false;
    recomputeCalibrationReview();
    refreshCalibrationEditors();
    renderCalibrationOverlay();
    setCalibrationStatus('Component accepted locally. Save the sidecar to make the decision persistent.', 'normal');
  } catch (error) {
    setCalibrationStatus('Acceptance rejected: ' + (error?.message || String(error)), 'error');
  }
}


function saveSelectedTraversal() {
  if (!currentCalibration || currentCalibrationStale) throw new Error('Calibration is missing or stale.');
  const candidate = JSON.parse($('calibration-traversal-json').value);
  if (candidate.nodeKey !== selectedTraversalNodeKey) throw new Error('Traversal nodeKey cannot be changed.');
  const index = currentCalibration.traversal.findIndex(item => item.nodeKey === selectedTraversalNodeKey);
  if (index < 0) throw new Error('Selected traversal candidate no longer exists.');
  candidate.accepted = false;
  candidate.runtimeEnabled = false;
  candidate.requiresReview = true;
  candidate.accepted = false;
  candidate.runtimeEnabled = false;
  candidate.requiresReview = true;
  currentCalibration.traversal[index] = candidate;
  const component = currentCalibration.components.find(item => item.nodeKey === selectedTraversalNodeKey);
  if (component && !component.interaction?.accepted) {
    component.manual = false;
    component.requiresReview = true;
  }
  recomputeCalibrationReview();
  refreshCalibrationEditors();
  renderCalibrationOverlay();
  return candidate;
}

function saveTraversalEdits() {
  try {
    saveSelectedTraversal();
    setCalibrationStatus('Traversal edits applied in memory. Validate the path overlay, then accept and save the sidecar.', 'normal');
  } catch (error) {
    setCalibrationStatus('Traversal edit rejected: ' + (error?.message || String(error)), 'error');
  }
}

function vectorDistance(a, b) {
  return Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]), Number(a[2]) - Number(b[2]));
}

function validateTraversalBoneContacts(contacts) {
  if (!Array.isArray(contacts) || contacts.length < 4) {
    throw new Error('Add timed bone contacts for both hands and both feet.');
  }
  const allowedBones = new Set(['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Hips']);
  const seen = new Set();
  for (const contact of contacts) {
    if (!allowedBones.has(contact.bone) || !Number.isFinite(Number(contact.t))
      || Number(contact.t) < 0 || Number(contact.t) > 1
      || !Array.isArray(contact.position) || contact.position.length < 3
      || !contact.position.slice(0, 3).every(value => Number.isFinite(Number(value)))) {
      throw new Error('boneContacts require a supported bone, normalized t in 0..1, and local XYZ position.');
    }
    seen.add(contact.bone);
  }
  for (const bone of ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot']) {
    if (!seen.has(bone)) throw new Error('Missing measured contact for ' + bone + '.');
  }
}

function acceptTraversalProfile() {
  try {
    const candidate = saveSelectedTraversal();
    const anchors = candidate.anchors || {};
    const vector = value => Array.isArray(value) && value.length >= 3
      && value.slice(0, 3).every(item => Number.isFinite(Number(item)));
    if (candidate.actionCandidate === 'obstacle-climb') {
      const path = anchors.rootPath;
      if (!vector(anchors.approach) || !vector(anchors.handContact)
        || !vector(anchors.topOut) || !vector(anchors.landing)) {
        throw new Error('Obstacle climb needs approach, handContact, topOut and landing XYZ anchors.');
      }
      if (!Array.isArray(path) || path.length < 4
        || path.some(point => !Number.isFinite(Number(point.t)) || !vector(point.position))) {
        throw new Error('Obstacle climb needs at least four timed rootPath points with normalized t and XYZ position.');
      }
      if (Math.abs(Number(path[0].t)) > 1e-5 || Math.abs(Number(path.at(-1).t) - 1) > 1e-5
        || path.some((point, index) => index > 0 && Number(point.t) <= Number(path[index - 1].t))) {
        throw new Error('rootPath times must increase strictly from 0 to 1.');
      }
      if (vectorDistance(path[0].position, anchors.approach) > 0.12
        || vectorDistance(path.at(-1).position, anchors.landing) > 0.12) {
        throw new Error('rootPath must begin at approach and end at landing.');
      }
      if (!path.some(point => vectorDistance(point.position, anchors.topOut) <= 0.45)) {
        throw new Error('rootPath must include the measured topOut point.');
      }
      const contacts = anchors.boneContacts || [];
      validateTraversalBoneContacts(contacts);
      candidate.animation = { key: 'obstacle_climb', durationSeconds: 3.833, rootMotion: 'physics-owned-in-place' };
      candidate.capabilities = { ...(candidate.capabilities || {}), obstacleClimbAnimation: true };
    } else if (candidate.actionCandidate === 'ladder-climb') {
      if (!vector(anchors.approach) || !vector(anchors.mountBottom) || !vector(anchors.mountTop)
        || !vector(anchors.topOut) || !vector(anchors.bottomDismount)) {
        throw new Error('Ladder needs approach, mountBottom, mountTop, topOut and bottomDismount XYZ anchors.');
      }
      if (!Array.isArray(anchors.climbPath) || anchors.climbPath.length < 2 || anchors.climbPath.some(point => !vector(point))) {
        throw new Error('Ladder climbPath needs at least two measured XYZ points along the ladder.');
      }
      const rungSpacing = Number(anchors.rungSpacing);
      if (!Number.isFinite(rungSpacing) || rungSpacing < 0.12 || rungSpacing > 0.6) {
        throw new Error('rungSpacing must be measured between 0.12m and 0.6m.');
      }
      if (!vector(anchors.planeNormal)) throw new Error('Ladder needs a measured outward planeNormal vector.');
      if (vectorDistance(anchors.climbPath[0], anchors.mountBottom) > 0.45
        || vectorDistance(anchors.climbPath.at(-1), anchors.mountTop) > 0.45) {
        throw new Error('Ladder climbPath must connect mountBottom to mountTop.');
      }
      const normalLength = Math.hypot(...anchors.planeNormal.slice(0, 3).map(Number));
      if (normalLength < 0.8 || normalLength > 1.2 || Math.abs(Number(anchors.planeNormal[1])) > 0.25) {
        throw new Error('planeNormal must be a normalized, near-horizontal outward vector.');
      }
      validateTraversalBoneContacts(anchors.boneContacts || []);
      candidate.animation = { key: 'ladder_climb_up', cycleSeconds: 0.767, rootMotion: 'rung-synchronized-physics' };
      candidate.capabilities = { ...(candidate.capabilities || {}), ladderClimbUpAnimation: true, ladderClimbDown: false };
    } else {
      throw new Error('Only obstacle-climb and ladder-climb are supported by the downloaded clips. Vault, ledge and stair action profiles stay disabled.');
    }
    candidate.manual = true;
    candidate.accepted = true;
    candidate.runtimeEnabled = true;
    candidate.requiresReview = false;
    const component = currentCalibration.components.find(item => item.nodeKey === candidate.nodeKey);
    if (component) {
      component.manual = true;
      component.requiresReview = false;
    }
    recomputeCalibrationReview();
    refreshCalibrationEditors();
    renderCalibrationOverlay();
    setCalibrationStatus('Traversal profile accepted locally. Save the sidecar to enable it in the game after a world reload.', 'normal');
  } catch (error) {
    setCalibrationStatus('Traversal acceptance rejected: ' + (error?.message || String(error)), 'error');
  }
}

function saveSelectedConnection() {
  try {
    if (!currentCalibration || currentCalibrationStale) throw new Error('Calibration is missing or stale.');
    const surface = selectedCalibrationSurface();
    if (!surface) throw new Error('Select a road/bridge surface component first.');
    const connection = JSON.parse($('calibration-connection-json').value);
    surface.connection = connection;
    const component = selectedCalibrationComponent();
    if (connection.accepted !== true) {
      surface.requiresReview = true;
      if (component) component.requiresReview = true;
    }
    recomputeCalibrationReview();
    refreshCalibrationEditors();
    renderCalibrationOverlay();
    setCalibrationStatus('Connection edits applied in memory. Review the endpoint overlay before approval.', 'normal');
  } catch (error) {
    setCalibrationStatus('Connection edit rejected: ' + (error?.message || String(error)), 'error');
  }
}

function approveSelectedRoadConnection() {
  try {
    if (!currentCalibration || currentCalibrationStale) throw new Error('Calibration is missing or stale.');
    const surface = selectedCalibrationSurface();
    const component = selectedCalibrationComponent();
    if (!surface || !component) throw new Error('Select a road/bridge surface component first.');
    const allowedRoles = ['bridge-deck', 'road-surface', 'road-straight-module', 'road-corner-module'];
    if (!allowedRoles.includes(component.role) || component.runtimeEnabled !== true) {
      throw new Error('This source mesh is not in a recognised driveable-surface collision profile.');
    }
    const excluded = currentCalibration.collision?.excludedDriveableMeshKeys || [];
    if (!excluded.includes(component.nodeKey)) {
      throw new Error('Surface is not excluded from static box generation. Regenerate calibration before approving it.');
    }
    const connection = JSON.parse($('calibration-connection-json').value);
    if (connection.status !== 'estimated') throw new Error('Curved/ambiguous geometry needs a manually measured connection profile before approval.');
    if (!Array.isArray(connection.start?.position) || !Array.isArray(connection.end?.position)
      || ![...connection.start.position.slice(0, 3), ...connection.end.position.slice(0, 3)].every(value => Number.isFinite(Number(value)))
      || !(Number(connection.width) > 0.5)) {
      throw new Error('Connection needs finite local endpoints and a usable width.');
    }
    const needsPolyline = /curve|sloped|ramp/i.test(surface.sectionKind || '')
      || surface.role === 'road-corner-module';
    if (needsPolyline && (!Array.isArray(connection.points)
      || connection.points.length < 3
      || connection.points.some(point => !Array.isArray(point)
        || point.length < 3 || !point.slice(0, 3).every(value => Number.isFinite(Number(value)))))) {
      throw new Error('Curved/sloped surfaces need at least three manually measured centreline points.');
    }
    connection.accepted = true;
    connection.requiresReview = false;
    connection.method = 'manual-reviewed-socket';
    surface.connection = connection;
    surface.runtimeEnabled = true;
    surface.requiresReview = false;
    component.runtimeEnabled = true;
    component.requiresReview = false;
    component.manual = true;
    recomputeCalibrationReview();
    refreshCalibrationEditors();
    renderCalibrationOverlay();
    setCalibrationStatus('Tyre route approved locally. Save the sidecar to activate it in the game on next world load.', 'normal');
  } catch (error) {
    setCalibrationStatus('Route approval rejected: ' + (error?.message || String(error)), 'error');
  }
}

async function persistCalibration() {
  if (!currentCalibration || currentCalibrationStale || !currentEntry) {
    setCalibrationStatus('Cannot save missing or stale calibration.', 'error');
    return;
  }
  try {
    recomputeCalibrationReview();
    const response = await fetch('/api/asset-calibration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentEntry.path, data: JSON.stringify(currentCalibration, null, 2) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || ('HTTP ' + response.status));
    setCalibrationStatus('Saved ' + result.path + ' · reload the world to apply accepted anchors/routes.', 'normal');
    refreshCalibrationEditors();
  } catch (error) {
    setCalibrationStatus('Calibration save failed: ' + (error?.message || String(error)), 'error');
  }
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

function showAllMeshes() {
  currentMeshObjects.forEach((entry) => { entry.object.visible = entry.visibleAtLoad; });
  isolatedMesh = null;
  $('mesh-selection-status').textContent = currentMeshObjects.length + ' subcomponents visible';
  renderMeshList();
  if (current) frame(current);
}

function isolateMesh(mesh) {
  if (isolatedMesh === mesh) {
    showAllMeshes();
    return;
  }
  currentMeshObjects.forEach((entry) => { entry.object.visible = entry.object === mesh; });
  isolatedMesh = mesh;
  const entry = currentMeshObjects.find(item => item.object === mesh);
  $('mesh-selection-status').textContent = 'Isolated: ' + (entry?.label || mesh.name || 'selected mesh');
  renderMeshList();
  frame(mesh);
}

function renderMeshList() {
  const list = $('mesh-list');
  if (!list) return;
  list.replaceChildren();
  const query = ($('mesh-filter')?.value || '').trim().toLowerCase();
  const filtered = currentMeshObjects.filter(entry => !query || entry.label.toLowerCase().includes(query));
  filtered.forEach((entry) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mesh-part' + (isolatedMesh === entry.object ? ' active' : '');
    button.textContent = entry.label;
    button.title = 'Click to isolate this imported mesh; click again or Show all to restore the component';
    button.addEventListener('click', () => isolateMesh(entry.object));
    li.append(button);
    list.append(li);
  });
  if (!filtered.length) {
    const li = document.createElement('li');
    li.textContent = currentMeshObjects.length ? 'No subcomponents match this filter.' : 'No mesh data loaded.';
    list.append(li);
  }
  const status = $('mesh-selection-status');
  if (status && !isolatedMesh && currentMeshObjects.length) {
    status.textContent = currentMeshObjects.length + ' subcomponents visible';
  }
}

function reportLoadError(error) {
  $('status').textContent = 'LOAD FAILED: ' + (error?.message || String(error));
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
  renderMeshList();
  $('asset-prev').disabled = index <= 0;
  $('asset-next').disabled = index >= total - 1;
}

async function loadAsset(index) {
  if (!manifest[index]) throw new Error('Asset index out of range: ' + index);
  disposeCurrent();
  currentIndex = index;
  currentEntry = manifest[index];
  updatePanel(null, index, manifest.length, 'Loading ' + currentEntry.format.toUpperCase() + ' through Three.js GLTFLoader…');
  let timeoutId;
  const gltf = await Promise.race([
    loader.loadAsync(currentEntry.url),
    new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error('GLTF load timed out after 25 seconds')), 25000);
    }),
  ]).finally(() => window.clearTimeout(timeoutId));
  current = gltf.scene || gltf.scenes?.[0];
  if (!current) throw new Error('No scene returned by GLTFLoader');
  current.name = currentEntry.name;
  scene.add(current);
  frame(current);
  const report = inspect(current, gltf);
  updatePanel(report, index, manifest.length, report.emptyBounds ? 'Loaded, but model bounds are empty or degenerate.' : 'Loaded and rendered successfully.');
  await loadCalibrationForCurrent();
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
  $('mesh-filter').addEventListener('input', renderMeshList);
  $('mesh-show-all').addEventListener('click', showAllMeshes);
  $('calibration-component').addEventListener('change', event => {
    selectedCalibrationNodeKey = event.target.value || null;
    refreshCalibrationEditors();
    renderCalibrationOverlay();
    const mesh = currentMeshObjects.find(item => item.nodeKey === selectedCalibrationNodeKey)?.object;
    if (mesh) isolateMesh(mesh);
  });
  $('calibration-show-collision').addEventListener('click', () => {
    showCollisionOverlay = !showCollisionOverlay;
    $('calibration-show-collision').textContent = showCollisionOverlay ? 'Hide collision boxes' : 'Show collision boxes';
    renderCalibrationOverlay();
  });
  $('calibration-show-surfaces').addEventListener('click', () => {
    showSurfaceOverlay = !showSurfaceOverlay;
    $('calibration-show-surfaces').textContent = showSurfaceOverlay ? 'Hide road profiles' : 'Show road profiles';
    renderCalibrationOverlay();
  });
  $('calibration-save-component').addEventListener('click', saveSelectedComponent);
  $('calibration-accept-component').addEventListener('click', acceptSelectedComponent);
  $('calibration-traversal').addEventListener('change', event => {
    selectedTraversalNodeKey = event.target.value || null;
    refreshCalibrationEditors();
    renderCalibrationOverlay();
    const mesh = currentMeshObjects.find(item => item.nodeKey === selectedTraversalNodeKey)?.object;
    if (mesh) isolateMesh(mesh);
  });
  $('calibration-show-traversal').addEventListener('click', () => {
    showTraversalOverlay = !showTraversalOverlay;
    $('calibration-show-traversal').textContent = showTraversalOverlay ? 'Hide traversal path' : 'Show traversal path';
    renderCalibrationOverlay();
  });
  $('calibration-save-traversal').addEventListener('click', saveTraversalEdits);
  $('calibration-accept-traversal').addEventListener('click', acceptTraversalProfile);
  $('calibration-save-connection').addEventListener('click', saveSelectedConnection);
  $('calibration-accept-connection').addEventListener('click', approveSelectedRoadConnection);
  $('calibration-persist').addEventListener('click', persistCalibration);
  $('asset-prev').addEventListener('click', () => {
    if (currentIndex > 0) loadAsset(currentIndex - 1).catch(reportLoadError);
  });
  $('asset-next').addEventListener('click', () => {
    if (currentIndex < manifest.length - 1) loadAsset(currentIndex + 1).catch(reportLoadError);
  });

  const response = await fetch('/tools/asset-review-manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Asset manifest missing. Run tools/verify-asset-review.mjs first.');
  manifest = await response.json();
  $('status').textContent = 'Manifest loaded · ' + manifest.length + ' model files queued.';
  window.__ASSET_REVIEW__ = {
    manifest, loadAsset, setView, showAllMeshes, loadCalibrationForCurrent,
    getCalibration: () => currentCalibration,
    isolateMesh: (index) => currentMeshObjects[index] && isolateMesh(currentMeshObjects[index].object),
    getCurrent: () => currentEntry,
    getMeshList: () => currentMeshObjects.map(({ label, visibleAtLoad }) => ({ label, visibleAtLoad })),
  };
  updatePanel(null, 0, manifest.length, manifest.length + ' model files ready for inspection.');
  $('asset-prev').disabled = true;
  $('asset-next').disabled = manifest.length <= 1;
}

init().catch((error) => {
  $('status').textContent = 'INITIALIZATION FAILED: ' + (error?.message || String(error));
  window.__ASSET_REVIEW__ = { error: String(error), manifest };
});
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
