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

function classifyComponent(item, assetType, assetPath) {
  const name = stableNodeName(item);
  const pathText = String(item.nodePath || '') + ' / ' + name;
  const key = pathText.toLowerCase().replace(/[\\s-]+/g, '_');
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

  const tests = [
    [/vehicle.*door|door.*vehicle|(^|_)door(_|$)|gate|hatch|shutter/, 'door-panel', 'door'],
    [/seat|chair|bench|sofa|stool|couch/, assetType === 'vehicle' ? 'vehicle-seat' : 'seat', 'seat'],
    [/steer.*wheel|steering_wheel|volant/, 'steering-wheel', 'steering-wheel'],
    [/wheel|tyre|tire|rim/, 'vehicle-wheel', 'wheel'],
    [/ladder|ladder_rung/, 'ladder', 'ladder'],
    [/stairs?|staircase|steps?_/, 'stairs', 'stairs'],
    [/ledge|hang.?point|climb.?edge/, 'ledge', 'ledge'],
    [/guard.?rail|hand.?rail|barrier|kerb|curb|rail_/, 'barrier', 'barrier'],
    [/fence|wall|parapet/, 'obstacle', 'obstacle'],
    [/pier|abutment|support|column|beam|foundation/, 'bridge-support', 'support'],
    [/asphalt|carriageway|road|lane|deck|driveable|drivable|pavement/, assetType === 'bridge' ? 'bridge-deck-candidate' : 'road-surface', 'driveable-surface'],
    [/handle|switch|button|lever|grip/, 'interaction-part', 'interaction'],
  ];
  for (const [pattern, role, kind] of tests) {
    if (pattern.test(key)) return { role, kind, confidence: 0.86, source: 'node-name' };
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

function localConnection(item, longitudinalAxis, sectionKind = 'straight-span') {
  if (sectionKind.includes('curve') || sectionKind.includes('sloped') || sectionKind.includes('ramp') || !['x', 'z'].includes(longitudinalAxis)) {
    return { status: 'review-required', method: 'not-estimated-for-curved-or-unknown-axis', requiresReview: true };
  }
  const min = item.boundsMin;
  const max = item.boundsMax;
  const centerX = (min[0] + max[0]) / 2;
  const centerY = (min[1] + max[1]) / 2;
  const centerZ = (min[2] + max[2]) / 2;
  const start = [centerX, centerY, centerZ];
  const end = [centerX, centerY, centerZ];
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
    start: { position: start, tangent: tangent.map(v => -v), elevation: centerY },
    end: { position: end, tangent, elevation: centerY },
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
        ? { kind: 'vehicle-seat', accepted: false, requiredAnchors: ['seat', 'entry', 'exit', 'seatFacing'] }
        : { kind: 'seat', accepted: false, requiredAnchors: ['approach', 'pelvis', 'seatFacing', 'exit'] };
    case 'door':
      return { kind: assetType === 'vehicle' ? 'vehicle-door' : 'door', accepted: false, requiredAnchors: ['hinge', 'hingeAxis', 'handle', 'closedTransform', 'openRange'] };
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
    const connection = mesh
      ? localConnection(mesh, axis, section?.kind || (component.role === 'road-corner-module' || name.includes('curve') ? 'curved-span' : 'straight-span'))
      : { status: 'review-required' };
    return {
      id: component.id,
      nodeKey: component.nodeKey,
      nodePath: component.nodePath,
      role: component.role,
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
      measuredDeckHeightSourceUnits: mesh?.boundsMax?.[1] ?? null,
      referenceDeckHeightMetres: WORLD_KIT_DECK_HEIGHT,
      connection,
      requiresReview: !deck || !structure || connection.status !== 'estimated',
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
    'bridge-deck', 'road-straight-module', 'road-corner-module', 'walkable-surface',
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

  console.log(`[Calibrator] Scanning ${assetPath}`);
  const scanned = await processGLB(file, {
    write: false,
    log: false,
    excludeMesh: item => {
      const role = classifyComponent(item, assetType, assetPath);
      return (role?.source?.startsWith('world-kit') || role?.source === 'world-bridge-kit')
        && ['bridge-deck', 'road-straight-module', 'road-corner-module', 'walkable-surface'].includes(role.role);
    },
  });

  const meshByKey = new Map(scanned.meshDetails.map(mesh => [mesh.nodeKey, mesh]));
  const components = [];
  for (const item of scanned.meshDetails) {
    const role = classifyComponent(item, assetType, assetPath);
    if (role) components.push(makeComponent(item, role, components.length, assetType));
  }
  const road = buildRoadProfiles(assetType, components, meshByKey);
  const bridge = assetType === 'bridge' ? buildBridgeProfile(components, meshByKey) : null;
  const isVehicle = assetType === 'vehicle';
  const traversal = components.filter(component =>
    ['obstacle', 'ladder', 'stairs', 'ledge'].includes(component.kind)
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
      ladderClimbDown: 'experimental-reverse-clip',
      obstacleClimbAnimation: component.kind === 'obstacle',
      vaultAnimation: false,
      mantleAnimation: false,
      ledgeHangAnimation: false,
    },
    accepted: false,
    requiresReview: true,
    note: 'Compare dimensions, capsule clearance, reach, landing space and the active NPC/player animation set before enabling traversal.',
  }));

  const old = fs.existsSync(outputPath)
    ? (() => { try { return JSON.parse(fs.readFileSync(outputPath, 'utf8')); } catch { return null; } })()
    : null;
  const priorComponents = new Map((old?.components || []).map(component => [component.nodeKey, component]));
  for (const component of components) {
    const previous = priorComponents.get(component.nodeKey);
    if (previous?.interaction?.accepted === true) component.interaction = previous.interaction;
    if (previous?.manual === true) component.manual = previous.manual;
  }

  const collisionBoxes = isVehicle ? [] : scanned.manifest.boxes;
  const collisionMode = isVehicle ? 'dynamic-vehicle-runtime' : road ? 'hybrid-static-and-surface' : 'static-boxes';
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
    review: {
      status: 'needs-review',
      approved: false,
      outstanding: components.filter(c => c.requiresReview).map(c => ({
        componentId: c.id,
        nodeKey: c.nodeKey,
        role: c.role,
        reason: 'Confirm component identity, bounds, anchors and runtime behaviour in Asset Lab before accepting.',
      })),
      preservedManualReview: !!old,
    },
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

export { calibrateOne, classifyAssetType, classifyComponent, buildRoadProfiles };

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch(error => {
    console.error('[Calibrator] Fatal:', error?.stack || error);
    process.exitCode = 1;
  });
}
