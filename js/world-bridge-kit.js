// Reusable, independent prefabs extracted from the downloaded modular bridge kit.
// The source GLTF contains ten independent mesh nodes: five concrete structures
// and five road/deck surfaces. They share section anchors, but are never merged
// into composite meshes or forced to share one vertical transform.
import * as THREE from './lib/three.module.js';

export const WORLD_BRIDGE_KIT_URL = './data/models/assets/others/modular_bridge__low_poly__game_ready_/scene.gltf';

export const WORLD_KIT_BRIDGE_SECTIONS = Object.freeze([
  Object.freeze({
    id: 'bridge-curve-main',
    sourceNode: 'Plane_0',
    structureComponentId: 'bridge-curve-main-structure',
    deckComponentId: 'bridge-curve-main-deck',
    structureNode: 'Object_4',
    deckNode: 'Object_5',
    kind: 'curved-span',
  }),
  Object.freeze({
    id: 'bridge-straight-span',
    sourceNode: 'Plane.001_1',
    structureComponentId: 'bridge-straight-structure',
    deckComponentId: 'bridge-straight-deck',
    structureNode: 'Object_7',
    deckNode: 'Object_8',
    kind: 'straight-span',
  }),
  Object.freeze({
    id: 'bridge-pier-starter',
    sourceNode: 'Plane.002_2',
    structureComponentId: 'bridge-pier-starter-structure',
    deckComponentId: 'bridge-pier-starter-deck',
    structureNode: 'Object_10',
    deckNode: 'Object_11',
    kind: 'short-pier-starter',
  }),
  Object.freeze({
    id: 'bridge-curve-return',
    sourceNode: 'Plane.003_3',
    structureComponentId: 'bridge-curve-return-structure',
    deckComponentId: 'bridge-curve-return-deck',
    structureNode: 'Object_13',
    deckNode: 'Object_14',
    kind: 'curved-span',
  }),
  Object.freeze({
    id: 'bridge-end-ramp',
    sourceNode: 'Plane.004_4',
    structureComponentId: 'bridge-end-ramp-structure',
    deckComponentId: 'bridge-end-ramp-deck',
    structureNode: 'Object_16',
    deckNode: 'Object_17',
    kind: 'sloped-end-abutment',
  }),
]);

export const WORLD_KIT_BRIDGE_COMPONENTS = Object.freeze(
  WORLD_KIT_BRIDGE_SECTIONS.flatMap(section => [
    Object.freeze({
      id: section.structureComponentId,
      sectionId: section.id,
      sourceNode: section.structureNode,
      sourceSectionNode: section.sourceNode,
      kind: section.kind,
      role: 'bridge-structure',
    }),
    Object.freeze({
      id: section.deckComponentId,
      sectionId: section.id,
      sourceNode: section.deckNode,
      sourceSectionNode: section.sourceNode,
      kind: section.kind,
      role: 'bridge-deck',
    }),
  ]),
);

function normalizeBridgeNodeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findBridgeNode(root, requestedName) {
  const exact = root.getObjectByName(requestedName);
  if (exact) return exact;

  // GLTFLoader may normalize punctuation in Blender node suffixes.
  const target = normalizeBridgeNodeName(requestedName);
  let exactNormalized = null;
  const prefixMatches = [];
  root.traverse(node => {
    const normalized = normalizeBridgeNodeName(node.name);
    if (normalized === target) exactNormalized = node;
    else if (normalized.startsWith(target)) {
      prefixMatches.push({ node, extra: normalized.length - target.length });
    }
  });
  if (exactNormalized) return exactNormalized;
  prefixMatches.sort((a, b) => a.extra - b.extra);
  return prefixMatches[0]?.node || null;
}

function worldBounds(node) {
  node.updateWorldMatrix(true, false);
  return new THREE.Box3().setFromObject(node);
}

export function extractWorldBridgeKit(sourceScene) {
  if (!sourceScene || typeof sourceScene.getObjectByName !== 'function') {
    throw new TypeError('A loaded bridge GLTF scene is required');
  }

  sourceScene.updateMatrixWorld(true);
  const prefabs = new Map();

  for (const section of WORLD_KIT_BRIDGE_SECTIONS) {
    const sourceSection = findBridgeNode(sourceScene, section.sourceNode);
    const structureNode = findBridgeNode(sourceScene, section.structureNode);
    const deckNode = findBridgeNode(sourceScene, section.deckNode);
    if (!sourceSection || !structureNode?.isMesh || !deckNode?.isMesh) {
      throw new Error(
        'Bridge section ' + section.id + ' is incomplete: expected ' +
        section.sourceNode + ' with independent meshes ' +
        section.structureNode + ' and ' + section.deckNode,
      );
    }

    const sectionBounds = worldBounds(sourceSection);
    const structureBounds = worldBounds(structureNode);
    const deckBounds = worldBounds(deckNode);
    if (sectionBounds.isEmpty() || structureBounds.isEmpty() || deckBounds.isEmpty()) {
      throw new Error('Bridge section has empty geometry bounds: ' + section.id);
    }

    // Both independent components use the same X/Z anchor and support-foot
    // datum. This preserves the authored relationship without merging the meshes.
    const anchor = sectionBounds.getCenter(new THREE.Vector3());
    const foundationDatum = structureBounds.min.y;
    const sourceDeckHeight = deckBounds.max.y - foundationDatum;
    if (!Number.isFinite(sourceDeckHeight) || sourceDeckHeight <= 0.1) {
      throw new Error('Bridge section has invalid source deck height: ' + section.id);
    }

    const sectionMeta = {
      sectionId: section.id,
      sourceNode: section.sourceNode,
      kind: section.kind,
      sourceDeckHeight,
      sourceDeckMinOffset: deckBounds.min.y - foundationDatum,
      sourceDeckMaxOffset: deckBounds.max.y - foundationDatum,
      anchor: { x: anchor.x, y: foundationDatum, z: anchor.z },
    };

    for (const definition of WORLD_KIT_BRIDGE_COMPONENTS.filter(item => item.sectionId === section.id)) {
      const sourceMesh = definition.role === 'bridge-structure' ? structureNode : deckNode;
      const sourceMaterial = sourceMesh.material;
      const material = Array.isArray(sourceMaterial)
        ? sourceMaterial.map(entry => entry?.clone?.() || entry)
        : sourceMaterial?.clone?.() || sourceMaterial;
      if (!material) throw new Error('Bridge component has no material: ' + definition.id);

      const geometry = sourceMesh.geometry.clone().applyMatrix4(sourceMesh.matrixWorld);
      geometry.translate(-anchor.x, -foundationDatum, -anchor.z);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const bounds = geometry.boundingBox;
      if (!bounds || bounds.isEmpty()) {
        geometry.dispose();
        throw new Error('Bridge component has empty local geometry: ' + definition.id);
      }

      const size = bounds.getSize(new THREE.Vector3());
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = definition.id;
      mesh.castShadow = definition.role === 'bridge-structure';
      mesh.receiveShadow = true;
      mesh.userData.worldKit = {
        assetId: 'modular-bridge',
        componentId: definition.id,
        sectionId: definition.sectionId,
        role: definition.role,
        sourceNode: definition.sourceNode,
      };

      prefabs.set(definition.id, {
        ...definition,
        ...sectionMeta,
        mesh,
        geometry,
        material,
        dimensions: [size.x, size.y, size.z],
        localBounds: {
          min: bounds.min.toArray(),
          max: bounds.max.toArray(),
        },
      });
    }
  }

  if (prefabs.size !== 10) {
    throw new Error('Expected ten independent bridge component prefabs, received ' + prefabs.size);
  }

  for (const section of WORLD_KIT_BRIDGE_SECTIONS) {
    for (const id of [section.structureComponentId, section.deckComponentId]) {
      if (!prefabs.has(id)) throw new Error('Missing reusable bridge component: ' + id);
    }
  }

  return prefabs;
}
