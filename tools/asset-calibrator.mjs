#!/usr/bin/env node
/**
 * Unified asset calibrator.
 *
 * Usage:
 *   pnpm calibrate:asset -- data/models/assets/others/modular_bridge__low_poly__game_ready_/scene.gltf
 *   pnpm calibrate:asset -- data/models/cars
 *
 * Emits <asset>_calibration.json beside each source. The source model is never
 * rewritten. Work is sequential to keep memory predictable on low-RAM machines.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { glob } from 'glob';
import { processGLB } from './process-glbs.js';
import {
  WORLD_KIT_BRIDGE_SECTIONS,
  WORLD_KIT_DECK_HEIGHT,
} from '../js/world-bridge-kit.js';
import {
  WORLD_KIT_ROAD_PACK_PARTS,
  WORLD_KIT_SIDEWALK_COMPONENTS,
} from '../js/world-kit.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_ROOTS = [
  path.join(ROOT, 'data', 'models', 'assets'),
  path.join(ROOT, 'data', 'models', 'cars'),
];

function relativeAssetPath(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function isInsideRoot(file, root) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function stableNodeName(mesh) {
  return String(mesh.name || '').trim();
}

function classifyAssetType(assetPath) {
  const value = assetPath.toLowerCase().replace(/\\/g, '/');
  if (value.includes('/cars/')) return 'vehicle';
  if (/bridge/.test(value)) return 'bridge';
  if (/roads?\//.test(value) || /street.?road|road.?pack/.test(value)) return 'road';
  return 'world-prop';
}

function vectorSize(item) {
  return item.dimensions.map(value => Number(value) || 0);
}

function isFlatHorizontal(item) {
  const [x, y, z] = vectorSize(item);
  const horizontal = Math.max(x, z);
  const thin = Math.min(x, z);
  return horizontal > 1.5 && thin > 0.8 && y <= Math.max(0.32, thin * 0.12);
}

function bridgeRoleByName(name) {
  for (const section of WORLD_KIT_BRIDGE_SECTIONS) {
    if (name === section.deckNode) {
      return { role: 'bridge-deck', sectionId: section.id, confidence: 0.99, source: 'world-bridge-kit' };
    }
    if (name === section.structureNode) {
      return { role: 'bridge-structure', sectionId: section.id, confidence: 0.99, source: 'world-bridge-kit' };
    }
  }
  return null;
}

function normalizedNameTokens(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasNameToken(tokens, ...values) {
  return values.some(value => tokens.includes(value));
}

function isCollisionProxyComponent(item) {
  const name = String(item?.name || '').trim().toLowerCase();
  const pathParts = String(item?.nodePath || '').toLowerCase().split(' / ').map(part => part.trim());
  if (/^(?:col_|trim_|window_|roof_detail|sign|awning)/.test(name) || /^room_\d+_marker$/.test(name)) return true;
  if (pathParts.some(part => part === 'collision_proxies' || part.startsWith('col_'))) return true;
  // process-glbs marks door meshes as collisionProxy so they do not become
  // solid boxes. They must remain visible to semantic door calibration.
  const explicitDoor = /^(?:door|doorpanel|door_panel)(?:_|$)/.test(name)
    || pathParts.some(part => /^door_[^/]+$/.test(part));
  return item?.collisionProxy === true && !explicitDoor;
}
function isNativeCollisionProxy(item) {
  if (item?.collisionProxy !== true) return false;
  const name = String(item?.name || '').trim().toLowerCase();
  const pathParts = String(item?.nodePath || '').toLowerCase().split(' / ').map(part => part.trim());
  return name.startsWith('col_')
    || pathParts.some(part => part.startsWith('col_') || part === 'collision_proxies');
}

function buildNativeCollisionProxyRecords(meshDetails) {
  return (meshDetails || []).filter(isNativeCollisionProxy).map(item => ({
    nodeKey: item.nodeKey,
    nodePath: item.nodePath,
    name: item.name,
    bounds: {
      min: item.boundsMin,
      max: item.boundsMax,
      size: item.dimensions,
    },
    source: 'authored-col-mesh',
    runtimeAuthority: 'world-native-col-proxy',
  }));
}

function isPlausibleWheelGeometry(item) {
  const dimensions = vectorSize(item).map(Math.abs).sort((a, b) => a - b);
  if (dimensions.length !== 3 || dimensions[0] <= 1e-8 || dimensions[2] <= 1e-8) return false;
  const [thickness, middle, largest] = dimensions;
  return middle / largest >= 0.3
    && thickness / largest >= 0.08
    && largest / middle <= 2.25;
}

function classifyComponent(item, assetType, assetPath) {
  if (isCollisionProxyComponent(item)) return null;

  const name = stableNodeName(item);
  const tokens = normalizedNameTokens(name);
  const compactName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const isSeatBelt = compactName.includes('seatbelt');
  const pathTokens = normalizedNameTokens(item.nodePath || '');
  const has = (...values) => hasNameToken(tokens, ...values);
  const hasInPath = (...values) => hasNameToken(pathTokens, ...values);
  const key = String(item.nodePath || '').toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');

  // These project-owned profiles are tied to exact node identities, not fuzzy
  // words. Their node names and mesh dimensions are the calibration authority.
  if (assetPath.includes('/roads/street_road/') && /two_lane_road/.test(key) && !/side_texture/.test(key)) {
    return { role: 'road-surface', kind: 'driveable-surface', confidence: 0.98, source: 'world-kit-street-road' };
  }
  const bridgeRole = assetType === 'bridge' ? bridgeRoleByName(name) : null;
  if (bridgeRole) return { ...bridgeRole, kind: bridgeRole.role };

  if (assetPath.includes('/roads/road_pack/')) {
    const part = WORLD_KIT_ROAD_PACK_PARTS[name];
    if (part) return { role: part.role, kind: part.id, confidence: 0.98, source: 'world-kit-road-pack' };
  }
  if (assetPath.includes('/roads/sidewalks/')) {
    const part = WORLD_KIT_SIDEWALK_COMPONENTS[name];
    if (part) return { role: 'walkable-surface', kind: part.kind, confidence: 0.96, source: 'world-kit-sidewalks' };
  }

  // Vehicle semantics are deliberately isolated from ordinary props/buildings.
  // "trim" must not become a wheel (it contains the letters "rim"), and
  // "seatbelt" must not become a seat.
  if (assetType === 'vehicle') {
    if (has('steeringwheel', 'volant') || (has('steering') && has('wheel'))) {
      return { role: 'steering-wheel', kind: 'steering-wheel', confidence: 0.86, source: 'node-name' };
    }
    if (!isSeatBelt && has('seat', 'driverseat', 'passengerseat', 'chair')) {
      return { role: 'vehicle-seat', kind: 'seat', confidence: 0.86, source: 'node-name' };
    }
    if (has('door', 'doorpanel', 'hatch', 'tailgate', 'trunk', 'boot')) {
      return { role: 'door-panel', kind: 'door', confidence: 0.86, source: 'node-name' };
    }
    const wheelNamed = tokens.some(token =>
      token === 'wheel' || /^wheel_(?:fl|fr|rl|rr)$/.test(token)
      || /^wheel(?:fl|fr|rl|rr)$/.test(token)
      || /^3dwheel(?:_|[a-z0-9])/.test(token)
    );
    if (wheelNamed && isPlausibleWheelGeometry(item)) {
      return { role: 'vehicle-wheel', kind: 'wheel', confidence: 0.78, source: 'node-name-and-wheel-geometry' };
    }
    return null;
  }

  // Non-vehicle items can have doors/seats, but never inherit vehicle wheel,
  // vehicle door or vehicle-seat roles from generic substring matches.
  if (has('door', 'doorpanel', 'hatch', 'shutter', 'gate')) {
    return { role: 'door-panel', kind: 'door', confidence: 0.82, source: 'node-name' };
  }
  if (!isSeatBelt && has('seat', 'chair', 'bench', 'sofa', 'stool', 'couch')) {
    return { role: 'seat', kind: 'seat', confidence: 0.82, source: 'node-name' };
  }

  if (has('ladder', 'ladderrung') || hasInPath('ladder')) {
    return { role: 'ladder', kind: 'ladder', confidence: 0.82, source: 'node-name-or-parent' };
  }
  if (has('stairs', 'staircase', 'stair', 'steps') || hasInPath('stairs', 'staircase')) {
    return { role: 'stairs', kind: 'stairs', confidence: 0.82, source: 'node-name-or-parent' };
  }
  // Some supplied single-mesh props have generic mesh names. The source file
  // itself is a legitimate semantic label, but it remains review-only.
  const sourceBaseName = String(assetPath).split('/').at(-1).toLowerCase();
  if (['stair.glb', 'stairs.glb'].includes(sourceBaseName) && !assetPath.includes('/roads/')) {
    return { role: 'stairs', kind: 'stairs', confidence: 0.78, source: 'asset-file-name' };
  }
  if (has('ledge', 'hangpoint', 'climbedge')) {
    return { role: 'ledge', kind: 'ledge', confidence: 0.82, source: 'node-name' };
  }
  if (has('fence', 'parapet', 'lowwall')) {
    return { role: 'obstacle', kind: 'obstacle', confidence: 0.82, source: 'node-name' };
  }
  if (has('guardrail', 'handrail', 'barrier', 'kerb', 'curb', 'rail')) {
    return { role: 'barrier', kind: 'obstacle', confidence: 0.82, source: 'node-name' };
  }
  // Generic tall building walls are structural geometry, not climb targets.
  if (has('wall')) {
    return { role: 'building-wall', kind: 'wall', confidence: 0.78, source: 'node-name' };
  }
  if (assetType === 'bridge' && has('pier', 'abutment', 'support', 'column', 'beam', 'foundation')) {
    return { role: 'bridge-support', kind: 'support', confidence: 0.82, source: 'node-name' };
  }
  if (has('handle', 'switch', 'button', 'lever', 'grip')) {
    return { role: 'interaction-part', kind: 'interaction', confidence: 0.78, source: 'node-name' };
  }

  if ((assetType === 'bridge' || assetType === 'road')
    && has('asphalt', 'carriageway', 'road', 'lane', 'deck', 'driveable', 'drivable', 'pavement')) {
    return {
      role: assetType === 'bridge' ? 'bridge-deck-candidate' : 'road-surface-candidate',
      kind: 'driveable-surface',
      confidence: 0.82,
      source: 'node-name',
    };
  }

  if ((assetType === 'bridge' || assetType === 'road') && isFlatHorizontal(item)) {
    return {
      role: assetType === 'bridge' ? 'bridge-deck-candidate' : 'road-surface-candidate',
      kind: 'driveable-surface',
      confidence: 0.58,
      source: 'horizontal-geometry',
    };
  }
  return null;
}

function unionMeshDetails(items, nodeKey, nodePath, name) {
  if (!items.length) return null;
  const min = [0, 1, 2].map(axis => Math.min(...items.map(item => item.boundsMin[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...items.map(item => item.boundsMax[axis])));
  return {
    index: -1,
    nodeKey,
    nodePath,
    name,
    dimensions: max.map((value, axis) => value - min[axis]),
    center: max.map((value, axis) => (value + min[axis]) * 0.5),
    boundsMin: min,
    boundsMax: max,
    vertexCount: items.reduce((sum, item) => sum + (item.vertexCount || 0), 0),
    triangleCount: items.reduce((sum, item) => sum + (item.triangleCount || 0), 0),
    collisionProxy: false,
    skinned: items.some(item => item.skinned),
  };
}

function commonNodeAncestor(items) {
  if (!items.length) return { nodeKey: '', nodePath: '' };
  const keyPaths = items.map(item => String(item.nodeKey || '').split('/'));
  const namePaths = items.map(item => String(item.nodePath || '').split(' / '));
  let count = 0;
  const limit = Math.min(...keyPaths.map(parts => parts.length));
  while (count < limit && keyPaths.every(parts => parts[count] === keyPaths[0][count])) count++;
  // The last common element may itself be a mesh leaf only when all entries
  // refer to the same mesh. Keep the common group, otherwise use its parent.
  const leafMatch = items.length === 1;
  if (!leafMatch && count === limit) count = Math.max(0, count - 1);
  return {
    nodeKey: keyPaths[0].slice(0, count).join('/'),
    nodePath: namePaths[0].slice(0, Math.min(count, namePaths[0].length)).join(' / '),
  };
}

function aggregateNamedAssetSeat(meshDetails, assetPath) {
  const baseName = String(assetPath).split('/').at(-1).toLowerCase();
  if (baseName !== 'plastic_chair.glb') return null;
  const visibleParts = meshDetails.filter(item => !isCollisionProxyComponent(item));
  if (!visibleParts.length) return null;
  const ancestor = commonNodeAncestor(visibleParts);
  const fallback = visibleParts[0];
  const nodeKey = ancestor.nodeKey || fallback.nodeKey;
  const nodePath = ancestor.nodePath || fallback.nodePath;
  const item = unionMeshDetails(visibleParts, nodeKey, nodePath, 'PlasticChair_Seat');
  return item ? {
    item,
    role: { role: 'seat', kind: 'seat', confidence: 0.72, source: 'asset-file-name-and-mesh-group' },
  } : null;
}

function aggregateVehicleWheelGroups(meshDetails) {
  const groups = new Map();
  for (const item of meshDetails) {
    if (isCollisionProxyComponent(item)) continue;
    const keys = String(item.nodeKey || '').split('/');
    const names = String(item.nodePath || '').split(' / ');
    let groupIndex = -1;
    for (let index = keys.length - 2; index >= 0; index--) {
      if (/3dwheel.*(?:front|rear)_[lrc]|(?:^|_)wheel_(?:fl|fr|rl|rr)(?:_|$)/i.test(names[index] || '')) {
        groupIndex = index;
        break;
      }
    }
    if (groupIndex >= 0) {
      const key = keys.slice(0, groupIndex + 1).join('/');
      if (!groups.has(key)) groups.set(key, { key, name: names[groupIndex], nodePath: names.slice(0, groupIndex + 1).join(' / '), items: [] });
      groups.get(key).items.push(item);
    } else {
      const tokens = normalizedNameTokens(item.name);
      const hasWheelLabel = /(?:^|_)wheel_(?:fl|fr|rl|rr)(?:_|$)/i.test(String(item.name || ''))
        || (tokens.includes('wheel') && tokens.some(token => ['fl', 'fr', 'rl', 'rr'].includes(token)))
        || tokens.some(token => /^wheel(?:fl|fr|rl|rr)$/.test(token));
      if (hasWheelLabel && isPlausibleWheelGeometry(item)) {
        const key = item.nodeKey;
        groups.set(key, { key, name: item.name, nodePath: item.nodePath, items: [item] });
      }
    }
  }

  const result = [];
  for (const group of groups.values()) {
    const aggregate = unionMeshDetails(group.items, group.key, group.nodePath, group.name);
    if (!aggregate || !isPlausibleWheelGeometry(aggregate)) continue;
    result.push({
      item: aggregate,
      role: { role: 'vehicle-wheel', kind: 'wheel', confidence: 0.82, source: 'aggregated-wheel-group' },
    });
  }
  return result;
}

function aggregateLadderGroups(meshDetails) {
  const groups = new Map();
  for (const item of meshDetails) {
    if (isCollisionProxyComponent(item)) continue;
    const keys = String(item.nodeKey || '').split('/');
    const names = String(item.nodePath || '').split(' / ');
    let groupIndex = -1;
    for (let index = keys.length - 2; index >= 0; index--) {
      if (normalizedNameTokens(names[index]).includes('ladder')) {
        groupIndex = index;
        break;
      }
    }
    if (groupIndex >= 0) {
      const key = keys.slice(0, groupIndex + 1).join('/');
      if (!groups.has(key)) groups.set(key, { key, name: names[groupIndex], nodePath: names.slice(0, groupIndex + 1).join(' / '), items: [] });
      groups.get(key).items.push(item);
    }
  }
  const result = [];
  for (const group of groups.values()) {
    const aggregate = unionMeshDetails(group.items, group.key, group.nodePath, group.name);
    if (aggregate) result.push(aggregate);
  }
  return result;
}
function localConnection(item, longitudinalAxis, sectionKind = 'unknown-profile') {
  const supportedStraight = sectionKind === 'straight-span' || sectionKind === 'short-pier-starter';
  if (!supportedStraight || !['x', 'z'].includes(longitudinalAxis)) {
    return {
      status: 'review-required',
      method: 'manual-centreline-required-for-curved-sloped-or-unknown-profile',
      requiresReview: true,
    };
  }
  const min = item.boundsMin;
  const max = item.boundsMax;
  const centerX = (min[0] + max[0]) / 2;
  const surfaceY = max[1];
  const centerZ = (min[2] + max[2]) / 2;
  const start = [centerX, surfaceY, centerZ];
  const end = [centerX, surfaceY, centerZ];
  if (longitudinalAxis === 'x') {
    start[0] = min[0]; end[0] = max[0];
  } else {
    start[2] = min[2]; end[2] = max[2];
  }
  const [width, height, depth] = vectorSize(item);
  const tangent = longitudinalAxis === 'x' ? [1, 0, 0] : [0, 0, 1];
  return {
    status: 'estimated',
    method: 'mesh-bounds-axis-estimate',
    start: { position: start, tangent: tangent.map(v => -v), elevation: surfaceY },
    end: { position: end, tangent, elevation: surfaceY },
    accepted: false,
    width: longitudinalAxis === 'x' ? depth : width,
    length: longitudinalAxis === 'x' ? width : depth,
    deckThickness: height,
    confidence: 0.68,
    requiresReview: true,
  };
}

function interactionSpec(component, assetType) {
  switch (component.kind) {
    case 'seat':
      return assetType === 'vehicle'
        ? { kind: 'vehicle-seat', accepted: false, requiredAnchors: ['occupant', 'entry', 'exit', 'seatFacing'] }
        : { kind: 'seat', accepted: false, requiredAnchors: ['approach', 'pelvis', 'seatFacing', 'exit'] };
    case 'door':
      return { kind: assetType === 'vehicle' ? 'vehicle-door' : 'door', accepted: false, requiredAnchors: assetType === 'vehicle' ? ['hinge', 'hingeAxis', 'handle', 'entry', 'exit', 'closedTransform', 'openRange'] : ['hinge', 'hingeAxis', 'handle', 'closedTransform', 'openRange'] };
    case 'ladder':
      return { kind: 'ladder', accepted: false, requiredAnchors: ['mountBottom', 'mountTop', 'climbPath', 'topOut', 'bottomDismount'] };
    case 'stairs':
      return { kind: 'stairs', accepted: false, requiredAnchors: ['bottomEntry', 'topExit', 'walkableTreads'] };
    case 'steering-wheel':
      return { kind: 'steering-wheel', accepted: false, requiredAnchors: ['pivot', 'axis', 'rotationLimit'] };
    case 'wheel':
      return assetType === 'vehicle'
        ? { kind: 'vehicle-wheel', accepted: false, requiredAnchors: ['axle', 'radius', 'steeringAxis'] }
        : null;
    default:
      return null;
  }
}

function buildRoadProfiles(assetType, components, meshByKey) {
  const surfaces = components.filter(c =>
    ['bridge-deck', 'bridge-deck-candidate', 'road-surface', 'road-surface-candidate', 'road-straight-module', 'road-corner-module', 'walkable-surface'].includes(c.role)
  ).map(component => {
    const mesh = meshByKey.get(component.nodeKey);
    const isSidewalk = component.role === 'walkable-surface';
    const isBridge = component.role.startsWith('bridge-deck');
    const name = String(component.name || '').toLowerCase();
    const section = WORLD_KIT_BRIDGE_SECTIONS.find(s => s.id === component.sectionId);
    const axis = section?.longitudinalAxis
      || (mesh && mesh.dimensions[0] >= mesh.dimensions[2] ? 'x' : 'z');
    const sectionKind = section?.kind
      || (component.role === 'road-corner-module' || name.includes('curve') ? 'curved-span'
        : component.role === 'road-straight-module' || component.detection === 'world-kit-street-road'
          ? 'straight-span' : 'unknown-profile');
    const connection = mesh
      ? localConnection(mesh, axis, sectionKind)
      : { status: 'review-required', requiresReview: true };
    return {
      id: component.id,
      nodeKey: component.nodeKey,
      nodePath: component.nodePath,
      role: component.role,
      sectionId: component.sectionId || null,
      sectionKind,
      kind: isSidewalk ? 'sidewalk' : isBridge ? 'bridge-deck' : 'road',
      physics: {
        collider: 'triangle-surface',
        frictionHint: isSidewalk ? 0.82 : isBridge ? 0.76 : 0.72,
        restitution: 0,
      },
      bounds: component.bounds,
      connection,
      confidence: component.confidence,
      requiresReview: component.requiresReview || connection.requiresReview === true,
      runtimeEnabled: component.runtimeEnabled === true,
    };
  });

  if (!surfaces.length) return null;
  return {
    coordinateSpace: 'model-local',
    surfaces,
    connectionPolicy: 'Use node-referenced source triangles for physics. Bounds endpoints are alignment estimates only; curves and ambiguous assets need centreline review.',
  };
}

function buildBridgeProfile(components, meshByKey) {
  const sections = [];
  for (const section of WORLD_KIT_BRIDGE_SECTIONS) {
    const deck = components.find(c => c.name === section.deckNode);
    const structure = components.find(c => c.name === section.structureNode);
    if (!deck && !structure) continue;
    const mesh = deck ? meshByKey.get(deck.nodeKey) : null;
    const connection = mesh
      ? localConnection(mesh, section.longitudinalAxis, section.kind)
      : { status: 'review-required' };
    sections.push({
      id: section.id,
      kind: section.kind,
      longitudinalAxis: section.longitudinalAxis,
      deckComponent: deck ? { nodeKey: deck.nodeKey, role: deck.role } : null,
      structureComponent: structure ? { nodeKey: structure.nodeKey, role: structure.role } : null,
      measuredDeckBounds: mesh ? { min: mesh.boundsMin, max: mesh.boundsMax, size: mesh.dimensions } : null,
      deckTopSourceUnits: mesh?.boundsMax?.[1] ?? null,
      deckThicknessSourceUnits: mesh?.dimensions?.[1] ?? null,
      referenceDeckHeightMetres: WORLD_KIT_DECK_HEIGHT,
      connection,
      requiresReview: !deck || !structure || connection.requiresReview === true,
    });
  }
  return {
    kit: 'modular-bridge__low-poly__game-ready',
    sectionCount: sections.length,
    sections,
    contract: {
      deckPhysics: 'triangle-surface',
      structurePhysics: 'static-collision',
      barriersPhysics: 'static-collision',
      sourceGeometry: 'preserved',
    },
    requiresReview: sections.some(section => section.requiresReview),
  };
}

function makeComponent(item, role, index, assetType) {
  const identity = role?.sectionId || item.nodeKey;
  const component = {
    id: `component-${String(index + 1).padStart(3, '0')}-${identity.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    nodeKey: item.nodeKey,
    nodePath: item.nodePath,
    name: item.name,
    sectionId: role?.sectionId || null,
    role: role?.role || 'unclassified',
    kind: role?.kind || 'unknown',
    confidence: role?.confidence || 0,
    detection: role?.source || 'unknown',
    bounds: {
      min: item.boundsMin,
      max: item.boundsMax,
      size: item.dimensions,
      center: item.center,
    },
    requiresReview: !(role?.source?.startsWith('world-kit') || role?.source === 'world-bridge-kit'),
  };
  const interaction = interactionSpec(component, assetType);
  if (interaction) {
    component.interaction = interaction;
    component.requiresReview = true;
  }
  component.runtimeEnabled = !component.requiresReview && [
    'bridge-deck', 'road-surface', 'road-straight-module', 'road-corner-module', 'walkable-surface',
  ].includes(component.role);
  return component;
}

async function calibrateOne(file) {
  const assetPath = relativeAssetPath(file);
  const assetType = classifyAssetType('/' + assetPath);
  const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const sourceSize = fs.statSync(file).size;
  const baseName = path.parse(file).name;
  const outputPath = path.join(path.dirname(file), `${baseName}_calibration.json`);
  const previousFile = fs.existsSync(outputPath)
    ? (() => { try { return JSON.parse(fs.readFileSync(outputPath, 'utf8')); } catch { return null; } })()
    : null;
  // Manual calibration only survives while the exact source asset is unchanged.
  const old = previousFile?.source?.sha256 === hash ? previousFile : null;
  const priorAcceptedSurfaceKeys = new Set((old?.road?.surfaces || [])
    .filter(surface => surface.runtimeEnabled === true)
    .map(surface => surface.nodeKey));

  console.log(`[Calibrator] Scanning ${assetPath}`);
  const scanned = await processGLB(file, {
    write: false,
    log: false,
    excludeNodeKeys: [...priorAcceptedSurfaceKeys],
    excludeMesh: item => {
      const role = classifyComponent(item, assetType, assetPath);
      return priorAcceptedSurfaceKeys.has(item.nodeKey)
        || ((role?.source?.startsWith('world-kit') || role?.source === 'world-bridge-kit')
          && ['bridge-deck', 'road-surface', 'road-straight-module', 'road-corner-module', 'walkable-surface'].includes(role.role));
    },
  });

  const meshByKey = new Map(scanned.meshDetails.map(mesh => [mesh.nodeKey, mesh]));
  const components = [];
  const aggregatedLadders = aggregateLadderGroups(scanned.meshDetails);
  const groupedLadderKeys = new Set(aggregatedLadders.map(item => item.nodeKey));
  const vehicleWheels = assetType === 'vehicle' ? aggregateVehicleWheelGroups(scanned.meshDetails) : [];
  const assetSeat = assetType === 'world-prop' ? aggregateNamedAssetSeat(scanned.meshDetails, assetPath) : null;

  for (const item of scanned.meshDetails) {
    if (isCollisionProxyComponent(item)) continue;
    // A ladder built from separate rails/rungs is one climbable object, not a
    // collection of five independently climbable fragments.
    if (aggregatedLadders.some(group => item.nodeKey.startsWith(group.nodeKey + '/'))) continue;
    if (vehicleWheels.some(entry => item.nodeKey === entry.item.nodeKey
      || item.nodeKey.startsWith(entry.item.nodeKey + '/'))) continue;
    const role = classifyComponent(item, assetType, assetPath);
    if (role) components.push(makeComponent(item, role, components.length, assetType));
  }
  for (const item of aggregatedLadders) {
    const role = { role: 'ladder', kind: 'ladder', confidence: 0.82, source: 'aggregated-ladder-group' };
    components.push(makeComponent(item, role, components.length, assetType));
  }
  for (const entry of vehicleWheels) {
    components.push(makeComponent(entry.item, entry.role, components.length, assetType));
  }
  if (assetSeat && !components.some(component => component.kind === 'seat')) {
    components.push(makeComponent(assetSeat.item, assetSeat.role, components.length, assetType));
  }
  const road = buildRoadProfiles(assetType, components, meshByKey);
  const bridge = assetType === 'bridge' ? buildBridgeProfile(components, meshByKey) : null;
  const isVehicle = assetType === 'vehicle';
  const traversal = components.filter(component =>
    component.kind === 'ladder'
      || component.kind === 'stairs'
      || component.kind === 'ledge'
      || (component.kind === 'obstacle' && component.bounds.size[1] >= 0.45
        && Math.max(component.bounds.size[0], component.bounds.size[2]) >= 0.7)
  ).map(component => ({
    componentId: component.id,
    nodeKey: component.nodeKey,
    actionCandidate: component.kind === 'ladder' ? 'ladder-climb'
      : component.kind === 'stairs' ? 'walk-stairs'
        : component.kind === 'ledge' ? 'ledge-traversal' : 'obstacle-climb',
    obstacleHeightSourceUnits: component.bounds.size[1],
    playerProfileRequired: 'npc_core_001',
    capabilities: {
      ladderClimbUpAnimation: component.kind === 'ladder',
      ladderClimbDown: false,
      obstacleClimbAnimation: component.kind === 'obstacle',
      vaultAnimation: false,
      mantleAnimation: false,
      ledgeHangAnimation: false,
    },
    coordinateSpace: 'component-local',
    anchors: {},
    animation: null,
    manual: false,
    accepted: false,
    runtimeEnabled: false,
    requiresReview: true,
    note: 'Measure approach, full timed root path, hand/foot contacts, mount/rung points, capsule clearance and supported landing before enabling traversal.',
  }));

  const priorComponents = new Map((old?.components || []).map(component => [component.nodeKey, component]));
  for (const component of components) {
    const previous = priorComponents.get(component.nodeKey);
    if (previous?.interaction?.accepted === true) {
      component.interaction = previous.interaction;
      component.requiresReview = false;
    }
    if (previous?.manual === true) {
      component.manual = true;
      if (previous.requiresReview === false) component.requiresReview = false;
      if (previous.runtimeEnabled === true) component.runtimeEnabled = true;
      if (previous.role && previous.role !== 'unclassified') component.role = previous.role;
      if (previous.kind && previous.kind !== 'unknown') component.kind = previous.kind;
    }
  }
  const priorTraversal = new Map((old?.traversal || []).map(candidate => [candidate.nodeKey, candidate]));
  for (const candidate of traversal) {
    const previous = priorTraversal.get(candidate.nodeKey);
    if (!previous) continue;
    if (previous.accepted === true && previous.requiresReview === false
      && previous.runtimeEnabled === true && previous.manual === true) {
      candidate.accepted = true;
      candidate.runtimeEnabled = true;
      candidate.requiresReview = false;
      candidate.manual = true;
      if (previous.anchors) candidate.anchors = previous.anchors;
      if (previous.animation) candidate.animation = previous.animation;
      if (previous.capabilities) candidate.capabilities = previous.capabilities;
      if (previous.coordinateSpace) candidate.coordinateSpace = previous.coordinateSpace;
    }
  }

  // Keep approved connection corrections and explicit surface activation when
  // rescanning the same source. The corresponding source meshes were excluded
  // from static boxes above and will be registered as exact triangle surfaces.
  const priorRoadSurfaces = new Map((old?.road?.surfaces || []).map(surface => [surface.nodeKey, surface]));
  for (const surface of road?.surfaces || []) {
    const previous = priorRoadSurfaces.get(surface.nodeKey);
    if (!previous) continue;
    if (previous.runtimeEnabled === true) {
      surface.runtimeEnabled = true;
      const component = components.find(item => item.nodeKey === surface.nodeKey);
      if (component) {
        component.runtimeEnabled = true;
        if (previous.requiresReview === false) component.requiresReview = false;
      }
    }
    if (previous.connection?.accepted === true && previous.connection?.requiresReview === false) {
      surface.connection = previous.connection;
      surface.requiresReview = false;
      const component = components.find(item => item.nodeKey === surface.nodeKey);
      if (component) component.requiresReview = false;
    }
  }

  if (bridge) {
    const previousSections = new Map((old?.bridge?.sections || []).map(section => [section.id, section]));
    for (const section of bridge.sections) {
      const previous = previousSections.get(section.id);
      if (previous?.connection?.accepted === true && previous.connection.requiresReview === false) {
        section.connection = previous.connection;
        section.requiresReview = false;
      }
      const deckKey = section.deckComponent?.nodeKey;
      const reviewedSurface = (road?.surfaces || []).find(surface => surface.nodeKey === deckKey);
      if (reviewedSurface?.connection?.accepted === true
        && reviewedSurface.connection.requiresReview === false) {
        section.connection = reviewedSurface.connection;
        section.requiresReview = false;
      }
    }
    bridge.requiresReview = bridge.sections.some(section => section.requiresReview !== false);
  }

  const collisionBoxes = isVehicle ? [] : scanned.manifest.boxes;
  const nativeCollisionProxies = isVehicle ? [] : buildNativeCollisionProxyRecords(scanned.meshDetails);
  const collisionMode = isVehicle ? 'dynamic-vehicle-runtime'
    : road ? 'hybrid-static-and-surface'
      : nativeCollisionProxies.length ? 'authored-proxies-plus-generated-boxes'
        : 'static-boxes';
  const calibration = {
    schemaVersion: 1,
    kind: 'open-world-asset-calibration',
    generator: { id: 'open-world-unified-asset-calibrator', version: 1 },
    generatedAt: new Date().toISOString(),
    source: {
      assetUrl: assetPath,
      fileName: path.basename(file),
      format: path.extname(file).slice(1).toLowerCase(),
      bytes: sourceSize,
      sha256: hash,
    },
    coordinateSpace: 'model-local-after-source-node-transforms',
    units: {
      worldConvention: 'one game-world unit equals one metre',
      sourceUnitStatus: 'unverified',
      sourceDimensionsRequirePhysicalReference: true,
      noAutomaticRescale: true,
    },
    bounds: {
      min: scanned.manifest.boundsMin,
      max: scanned.manifest.boundsMax,
      size: scanned.manifest.dimensions,
    },
    collision: {
      generator: 'process-glbs-triangle-grid-v2',
      mode: collisionMode,
      coordinateSpace: 'model-local',
      boxes: collisionBoxes,
      boxCount: collisionBoxes.length,
      nativeProxies: nativeCollisionProxies,
      nativeProxyCount: nativeCollisionProxies.length,
      nativeProxyAuthority: nativeCollisionProxies.length ? 'source-mesh-col-prefixes-consumed-by-world-runtime' : null,
      excludedDriveableMeshKeys: components.filter(c => c.runtimeEnabled === true).map(c => c.nodeKey),
      exactSurfacePhysics: !!road,
      sourceSha256: hash,
    },
    road,
    bridge,
    components,
    interactions: components.filter(c => c.interaction).map(c => ({
      componentId: c.id,
      nodeKey: c.nodeKey,
      kind: c.interaction.kind,
      accepted: c.interaction.accepted === true,
      requiredAnchors: c.interaction.requiredAnchors,
      bounds: c.bounds,
      confidence: c.confidence,
      requiresReview: c.requiresReview,
    })),
    traversal,
    vehicle: isVehicle ? {
      collisionAuthority: 'js/vehicles.js dynamic body and wheel hardpoint classifier',
      dynamicBodyBoxesGeneratedHere: false,
      candidates: components.filter(c => ['vehicle-wheel', 'vehicle-seat', 'door-panel', 'steering-wheel'].includes(c.role))
        .map(c => ({ componentId: c.id, nodeKey: c.nodeKey, role: c.role, bounds: c.bounds, confidence: c.confidence, requiresReview: true })),
      note: 'Existing measured wheel classifier remains authoritative for wheel hardpoints; calibrated candidates are diagnostic until reviewed.',
    } : null,
    review: (() => {
      const outstanding = [
        ...components.filter(component => component.requiresReview).map(component => ({
          componentId: component.id,
          nodeKey: component.nodeKey,
          role: component.role,
          reason: 'Confirm component identity, bounds, anchors and runtime behaviour in Asset Lab before accepting.',
        })),
        ...traversal.filter(candidate => candidate.requiresReview !== false).map(candidate => ({
          componentId: candidate.componentId,
          nodeKey: candidate.nodeKey,
          role: candidate.actionCandidate,
          reason: 'Confirm animation contact, player capsule clearance and landing support before enabling traversal.',
        })),
        ...(road?.surfaces || []).filter(surface => surface.connection?.status !== 'estimated'
          || surface.connection?.accepted !== true || surface.connection?.requiresReview !== false).map(surface => ({
          componentId: surface.id,
          nodeKey: surface.nodeKey,
          role: surface.role,
          reason: 'Review centreline/endpoints and approve the driveable connection before enabling custom tyre-surface sampling.',
        })),
      ];
      return {
        status: outstanding.length ? 'needs-review' : 'approved',
        approved: outstanding.length === 0,
        outstanding,
        preservedManualReview: !!old,
      };
    })(),
    scan: {
      meshCount: scanned.meshDetails.length,
      collisionBoxCount: collisionBoxes.length,
      collisionStats: scanned.collisionStats,
    },
    manualOverrides: old?.manualOverrides || {},
  };

  fs.writeFileSync(outputPath, JSON.stringify(calibration, null, 2) + '\n', 'utf8');
  console.log(`[Calibrator] Wrote ${relativeAssetPath(outputPath)} · ${components.length} semantic components · ${collisionBoxes.length} collision boxes · ${road?.surfaces.length || 0} driveable surfaces`);
  return { assetPath, outputPath: relativeAssetPath(outputPath), components: components.length, boxes: collisionBoxes.length, surfaces: road?.surfaces.length || 0, bridgeSections: bridge?.sections.length || 0 };
}

async function expandInput(input) {
  const absolute = path.resolve(ROOT, input);
  const allowed = ASSET_ROOTS.some(root => isInsideRoot(absolute, root));
  if (!allowed) throw new Error(`Asset path must be inside data/models/assets or data/models/cars: ${input}`);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    const files = await glob('**/*.{glb,gltf}', { cwd: absolute, nodir: true });
    return files
      .filter(file => file.toLowerCase().endsWith('.glb') || path.basename(file).toLowerCase() === 'scene.gltf')
      .map(file => path.join(absolute, file));
  }
  if (!/\.(glb|gltf)$/i.test(absolute)) throw new Error(`Not a GLB/glTF file: ${input}`);
  return [absolute];
}

async function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) {
    console.error('Usage: pnpm calibrate:asset -- <asset.glb|scene.gltf|asset-folder>');
    process.exitCode = 1;
    return;
  }
  const files = [...new Set((await Promise.all(inputs.map(expandInput))).flat())]
    .sort((a, b) => a.localeCompare(b));
  if (!files.length) throw new Error('No GLB or glTF assets found.');
  let failed = 0;
  const results = [];
  for (const file of files) {
    try {
      results.push(await calibrateOne(file));
    } catch (error) {
      failed++;
      console.error(`[Calibrator] FAILED ${relativeAssetPath(file)}: ${error?.stack || error}`);
    }
  }
  console.log(JSON.stringify({
    scanned: files.length,
    succeeded: results.length,
    failed,
    results,
  }, null, 2));
  if (failed) process.exitCode = 1;
}

export { calibrateOne, classifyAssetType, classifyComponent, isCollisionProxyComponent, isPlausibleWheelGeometry, aggregateVehicleWheelGroups, aggregateLadderGroups, aggregateNamedAssetSeat, isNativeCollisionProxy, buildNativeCollisionProxyRecords, localConnection, interactionSpec, makeComponent, buildRoadProfiles, buildBridgeProfile };

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch(error => {
    console.error('[Calibrator] Fatal:', error?.stack || error);
    process.exitCode = 1;
  });
}
