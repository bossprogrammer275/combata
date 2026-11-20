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
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return true;
  if (Array.isArray(value)) return value.length > 0 && value.every(item => Number.isFinite(Number(item)));
  if (Array.isArray(value?.position)) return value.position.length >= 3
    && value.position.slice(0, 3).every(item => Number.isFinite(Number(item)));
  if (value?.position && ['x', 'y', 'z'].every(key => Number.isFinite(Number(value.position[key])))) return true;
  if (value && ['x', 'y', 'z'].every(key => Number.isFinite(Number(value[key])))) return true;
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function vectorDistance(a, b) {
  return Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]), Number(a[2]) - Number(b[2]));
}

function validateTraversalCandidate(candidate, component) {
  if (!candidate || !component) fail('Traversal candidate has no source component');
  if (candidate.accepted !== true) {
    if (candidate.runtimeEnabled === true || candidate.requiresReview === false) {
      fail('Unaccepted traversal candidate cannot be runtime-enabled or review-complete: ' + candidate.nodeKey);
    }
    return;
  }
  if (candidate.requiresReview !== false || candidate.runtimeEnabled !== true || candidate.manual !== true) {
    fail('Accepted traversal must be manually reviewed and runtime-enabled: ' + candidate.nodeKey);
  }
  if (component.requiresReview !== false || component.manual !== true) {
    fail('Accepted traversal source component must also be manually reviewed: ' + candidate.nodeKey);
  }
  if (candidate.coordinateSpace !== 'component-local') fail('Traversal anchors must be component-local: ' + candidate.nodeKey);
  const anchors = candidate.anchors || {};
  const contacts = anchors.boneContacts || [];
  const allowedBones = new Set(['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Hips']);
  const seen = new Set();
  if (!Array.isArray(contacts) || contacts.length < 4) {
    fail('Accepted traversal requires measured hand and foot bone contacts: ' + candidate.nodeKey);
  }
  for (const contact of contacts) {
    if (!allowedBones.has(contact.bone) || !Number.isFinite(Number(contact.t))
      || Number(contact.t) < 0 || Number(contact.t) > 1 || !finiteVector(contact.position)) {
      fail('Traversal bone contact has an invalid bone, time or position: ' + candidate.nodeKey);
    }
    seen.add(contact.bone);
  }
  for (const bone of ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot']) {
    if (!seen.has(bone)) fail('Traversal is missing the ' + bone + ' contact: ' + candidate.nodeKey);
  }

  if (candidate.actionCandidate === 'obstacle-climb') {
    if (component.kind !== 'obstacle' || candidate.animation?.key !== 'obstacle_climb'
      || Number(candidate.animation?.durationSeconds) !== 3.833) {
      fail('Obstacle traversal must use the downloaded obstacle_climb clip: ' + candidate.nodeKey);
    }
    for (const key of ['approach', 'handContact', 'topOut', 'landing']) {
      if (!finiteVector(anchors[key])) fail('Obstacle traversal is missing its ' + key + ' anchor: ' + candidate.nodeKey);
    }
    const path = anchors.rootPath;
    if (!Array.isArray(path) || path.length < 4
      || path.some(point => !Number.isFinite(Number(point.t)) || !finiteVector(point.position))) {
      fail('Obstacle traversal requires at least four timed rootPath points: ' + candidate.nodeKey);
    }
    if (Math.abs(Number(path[0].t)) > 1e-5 || Math.abs(Number(path.at(-1).t) - 1) > 1e-5
      || path.some((point, index) => index > 0 && Number(point.t) <= Number(path[index - 1].t))) {
      fail('Obstacle rootPath times must increase strictly from 0 to 1: ' + candidate.nodeKey);
    }
    if (vectorDistance(path[0].position, anchors.approach) > 0.12
      || vectorDistance(path.at(-1).position, anchors.landing) > 0.12) {
      fail('Obstacle rootPath must begin at approach and end at landing: ' + candidate.nodeKey);
    }
    if (candidate.capabilities?.obstacleClimbAnimation !== true
      || candidate.capabilities?.vaultAnimation === true
      || candidate.capabilities?.mantleAnimation === true) {
      fail('Unsupported vault/mantle capabilities cannot be enabled: ' + candidate.nodeKey);
    }
    return;
  }

  if (candidate.actionCandidate === 'ladder-climb') {
    if (component.kind !== 'ladder' || candidate.animation?.key !== 'ladder_climb_up'
      || Number(candidate.animation?.cycleSeconds) !== 0.767) {
      fail('Ladder traversal must use the downloaded ladder_climb_up cycle: ' + candidate.nodeKey);
    }
    for (const key of ['mountBottom', 'mountTop', 'topOut', 'bottomDismount', 'planeNormal']) {
      if (!finiteVector(anchors[key])) fail('Ladder traversal is missing its ' + key + ' anchor: ' + candidate.nodeKey);
    }
    if (!Array.isArray(anchors.climbPath) || anchors.climbPath.length < 2
      || anchors.climbPath.some(point => !finiteVector(point))) {
      fail('Ladder traversal requires measured rung-path points: ' + candidate.nodeKey);
    }
    const rungSpacing = Number(anchors.rungSpacing);
    if (!Number.isFinite(rungSpacing) || rungSpacing < 0.12 || rungSpacing > 0.6) {
      fail('Ladder rung spacing is outside the supported range: ' + candidate.nodeKey);
    }
    if (candidate.capabilities?.ladderClimbUpAnimation !== true
      || candidate.capabilities?.ladderClimbDown !== false) {
      fail('Only the upward ladder cycle is approved; reverse descent remains experimental: ' + candidate.nodeKey);
    }
    return;
  }
  fail('Only obstacle-climb and ladder-climb profiles can be runtime-enabled: ' + candidate.nodeKey);
}

function assertBounds(bounds, label) {
  if (!bounds || !finiteVector(bounds.min) || !finiteVector(bounds.max)) fail(label + ': missing finite min/max bounds');
  const size = bounds.size || bounds.max.map((value, index) => value - bounds.min[index]);
  if (!finiteVector(size) || size.slice(0, 3).some(value => Number(value) < 0)
    || Math.max(...size.slice(0, 3).map(Number)) <= 0) {
    fail(label + ': bounds have negative or fully degenerate extents');
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
    if (surface.connection?.status === 'estimated') {
      if (surface.connection.accepted === true) {
        if (surface.connection.requiresReview !== false
          || surface.connection.method !== 'manual-reviewed-socket') {
          fail('An accepted connection must be explicitly reviewed and carry the manual-reviewed-socket method: ' + surface.nodeKey);
        }
        if (surface.runtimeEnabled !== true || component.runtimeEnabled !== true) {
          fail('An accepted road connection must have its source surface enabled: ' + surface.nodeKey);
        }
        if (!finiteVector(surface.connection.start?.position)
          || !finiteVector(surface.connection.end?.position)
          || !(Number(surface.connection.width) > 0.5)) {
          fail('An accepted road connection is missing finite endpoints or usable width: ' + surface.nodeKey);
        }
        const needsPolyline = /curve|sloped|ramp/i.test(surface.sectionKind || '')
          || surface.role === 'road-corner-module';
        if (needsPolyline && (!Array.isArray(surface.connection.points)
          || surface.connection.points.length < 3
          || surface.connection.points.some(point => !finiteVector(point)))) {
          fail('A curved/sloped driveable surface must have at least three reviewed centreline points: ' + surface.nodeKey);
        }
      } else if (surface.connection.requiresReview !== true) {
        fail('Unaccepted estimated connection endpoints must remain review-required: ' + surface.nodeKey);
      }
    }
  }

  for (const key of excluded) {
    const component = componentByKey.get(key);
    const surface = roadSurfaces.find(item => item.nodeKey === key);
    if (!component || component.runtimeEnabled !== true || !surface || surface.runtimeEnabled !== true) {
      fail('Collision exclusion does not resolve to an enabled calibrated surface: ' + key);
    }
  }

  if (data.bridge) {
    if (data.bridge.sectionCount !== data.bridge.sections?.length) fail('Bridge section count does not match its profile');
    for (const section of data.bridge.sections || []) {
      const deck = section.deckComponent && componentByKey.get(section.deckComponent.nodeKey);
      const structure = section.structureComponent && componentByKey.get(section.structureComponent.nodeKey);
      if (!deck || !structure) fail('Bridge section is missing its source deck or structure: ' + section.id);
      if (/curved|sloped|ramp/i.test(section.kind) && section.connection?.status === 'estimated'
        && !(section.connection.accepted === true
          && section.connection.requiresReview === false
          && section.connection.method === 'manual-reviewed-socket'
          && Array.isArray(section.connection.points)
          && section.connection.points.length >= 3
          && section.connection.points.every(point => finiteVector(point)))) {
        fail('Curved or sloped bridge section has an unsafe straight estimate instead of manually reviewed multi-point sockets: ' + section.id);
      }
      if (section.requiresReview === false
        && !(section.connection?.accepted === true
          && section.connection.requiresReview === false
          && section.connection.method === 'manual-reviewed-socket')) {
        fail('Bridge section was marked approved without an accepted connection: ' + section.id);
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
    const component = componentByKey.get(candidate.nodeKey);
    if (!component) fail('Traversal candidate references unknown component: ' + candidate.nodeKey);
    validateTraversalCandidate(candidate, component);
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

export { validateAsset, hasAnchor };
