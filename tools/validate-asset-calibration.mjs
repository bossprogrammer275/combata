#!/usr/bin/env node
/**
 * Validate one generated asset-calibration sidecar against its source asset.
 *
 * Usage:
 *   pnpm validate:asset-calibration -- data/models/assets/others/modular_bridge__low_poly__game_ready_/scene.gltf
 *   pnpm validate:asset-calibration -- data/models/cars/tesla_cybertruk_low_poly/scene.gltf
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_ROOTS = [
  path.join(ROOT, 'data', 'models', 'assets'),
  path.join(ROOT, 'data', 'models', 'cars'),
];

function insideRoot(file, root) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function fail(message) {
  throw new Error(message);
}

function finiteVector(value, length = 3) {
  return Array.isArray(value) && value.length >= length
    && value.slice(0, length).every(item => Number.isFinite(Number(item)));
}

function hasAnchor(value) {
  if (Number.isFinite(Number(value)) && value !== null && value !== '') return true;
  if (finiteVector(value)) return true;
  if (finiteVector(value?.position)) return true;
  if (value?.position && ['x', 'y', 'z'].every(key => Number.isFinite(Number(value.position[key])))) return true;
  if (['x', 'y', 'z'].every(key => Number.isFinite(Number(value?.[key])))) return true;
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function assertBounds(bounds, label) {
  if (!bounds || !finiteVector(bounds.min) || !finiteVector(bounds.max)) fail(label + ': missing finite min/max bounds');
  const size = bounds.size || bounds.max.map((value, index) => value - bounds.min[index]);
  if (!finiteVector(size) || size.slice(0, 3).some(value => Number(value) <= 0)) {
    fail(label + ': bounds have a zero or negative extent');
  }
}

function validateAsset(sourceFile) {
  const absolute = path.resolve(ROOT, sourceFile);
  if (!ALLOWED_ROOTS.some(root => insideRoot(absolute, root))) {
    fail('Source asset must live inside data/models/assets or data/models/cars');
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail('Source asset does not exist: ' + sourceFile);
  if (!/\.(glb|gltf)$/i.test(absolute)) fail('Source must be a .glb or .gltf asset');

  const sidecarPath = path.join(path.dirname(absolute), path.parse(absolute).name + '_calibration.json');
  if (!fs.existsSync(sidecarPath)) fail('Calibration sidecar is missing: ' + path.relative(ROOT, sidecarPath));
  const sourceBytes = fs.readFileSync(absolute);
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  const data = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  const expectedAssetPath = path.relative(ROOT, absolute).split(path.sep).join('/');

  if (data.schemaVersion !== 1 || data.kind !== 'open-world-asset-calibration') fail('Unsupported calibration schema or kind');
  if (data.source?.assetUrl !== expectedAssetPath) fail('Sidecar references a different source asset');
  if (data.source?.sha256 !== sourceSha256 || data.collision?.sourceSha256 !== sourceSha256) {
    fail('Source hash mismatch. Regenerate calibration after modifying the source model.');
  }
  assertBounds(data.bounds, 'asset');

  const components = Array.isArray(data.components) ? data.components : [];
  const componentByKey = new Map();
  for (const [index, component] of components.entries()) {
    if (!component.nodeKey || componentByKey.has(component.nodeKey)) {
      fail('Component ' + index + ' has a missing or duplicate nodeKey');
    }
    if (!component.role || !component.kind) fail('Component ' + component.nodeKey + ' has no semantic role/kind');
    if (!Number.isFinite(Number(component.confidence)) || component.confidence < 0 || component.confidence > 1) {
      fail('Component ' + component.nodeKey + ' has invalid confidence');
    }
    assertBounds(component.bounds, 'component ' + component.nodeKey);
    if (component.runtimeEnabled === true) {
      const allowed = ['bridge-deck', 'road-straight-module', 'road-corner-module', 'walkable-surface'];
      if (!allowed.includes(component.role) || component.requiresReview === true) {
        fail('Unreviewed or unsupported component was enabled for runtime: ' + component.nodeKey);
      }
    }
    componentByKey.set(component.nodeKey, component);
  }

  const boxes = Array.isArray(data.collision?.boxes) ? data.collision.boxes : [];
  for (const [index, box] of boxes.entries()) {
    if (!finiteVector(box, 6)) fail('Collision box ' + index + ' does not contain six finite values');
    if (box.slice(3, 6).some(value => Number(value) <= 0)) fail('Collision box ' + index + ' has a zero or negative size');
  }

  const excluded = new Set(data.collision?.excludedDriveableMeshKeys || []);
  const roadSurfaces = data.road?.surfaces || [];
  const surfaceKeys = new Set();
  for (const surface of roadSurfaces) {
    if (surfaceKeys.has(surface.nodeKey)) fail('Duplicate road/bridge surface node key: ' + surface.nodeKey);
    surfaceKeys.add(surface.nodeKey);
    const component = componentByKey.get(surface.nodeKey);
    if (!component) fail('Surface references unknown component: ' + surface.nodeKey);
    if (surface.runtimeEnabled === true) {
      if (component.runtimeEnabled !== true) fail('Surface runtime flag disagrees with component: ' + surface.nodeKey);
      if (!excluded.has(surface.nodeKey)) fail('Enabled surface was not excluded from solid box generation: ' + surface.nodeKey);
      if (surface.physics?.collider !== 'triangle-surface') fail('Enabled road/bridge surface is missing triangle physics');
    }
    if (surface.connection?.status === 'estimated' && surface.connection?.requiresReview !== true) {
      fail('Estimated connection endpoints must remain review-required: ' + surface.nodeKey);
    }
  }

  if (data.bridge) {
    if (data.bridge.sectionCount !== data.bridge.sections?.length) fail('Bridge section count does not match its profile');
    for (const section of data.bridge.sections || []) {
      const deck = section.deckComponent && componentByKey.get(section.deckComponent.nodeKey);
      const structure = section.structureComponent && componentByKey.get(section.structureComponent.nodeKey);
      if (!deck || !structure) fail('Bridge section is missing its source deck or structure: ' + section.id);
      if (/curved|sloped|ramp/i.test(section.kind) && section.connection?.status === 'estimated') {
        fail('Curved or sloped bridge section has been assigned an unsafe straight endpoint estimate: ' + section.id);
      }
      if (section.connection?.status !== 'estimated' && section.requiresReview !== true) {
        fail('Bridge section requiring geometric review was marked approved: ' + section.id);
      }
    }
  }

  for (const interaction of data.interactions || []) {
    if (interaction.accepted !== true) continue;
    const component = componentByKey.get(interaction.nodeKey);
    if (!component?.interaction?.accepted) fail('Accepted interaction is not present on its component: ' + interaction.nodeKey);
    const anchors = component.interaction.anchors || {};
    for (const required of component.interaction.requiredAnchors || []) {
      if (!hasAnchor(anchors[required])) fail('Accepted interaction is missing required anchor "' + required + '": ' + interaction.nodeKey);
    }
  }

  for (const candidate of data.traversal || []) {
    if (!componentByKey.has(candidate.nodeKey)) fail('Traversal candidate references unknown component: ' + candidate.nodeKey);
    if (candidate.accepted === true && candidate.requiresReview !== false) {
      fail('Traversal candidate cannot be accepted while review is required: ' + candidate.nodeKey);
    }
  }

  if (data.vehicle) {
    if (data.vehicle.dynamicBodyBoxesGeneratedHere !== false) fail('Vehicle sidecar must not replace runtime dynamic-body geometry');
    if (boxes.length) fail('Vehicle calibration must not emit static world collision boxes');
  }

  return {
    source: expectedAssetPath,
    sidecar: path.relative(ROOT, sidecarPath).split(path.sep).join('/'),
    sha256: sourceSha256,
    components: components.length,
    collisionBoxes: boxes.length,
    roadSurfaces: roadSurfaces.length,
    runtimeSurfaces: roadSurfaces.filter(surface => surface.runtimeEnabled === true).length,
    bridgeSections: data.bridge?.sections?.length || 0,
    acceptedInteractions: (data.interactions || []).filter(interaction => interaction.accepted === true).length,
    acceptedTraversal: (data.traversal || []).filter(candidate => candidate.accepted === true).length,
    reviewStatus: data.review?.status || 'unknown',
  };
}

function main() {
  const input = process.argv[2];
  if (!input) fail('Usage: pnpm validate:asset-calibration -- <source.glb|source.gltf>');
  const report = validateAsset(input);
  console.log(JSON.stringify({ valid: true, ...report }, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  try { main(); } catch (error) {
    console.error('[AssetCalibrationValidation] FAILED:', error?.stack || error);
    process.exitCode = 1;
  }
}

export { validateAsset };
