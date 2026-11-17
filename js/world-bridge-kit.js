// Reusable prefabs extracted from the five authored bridge sections in the
// downloaded bridge kit. Each source section contains a concrete structure mesh
// and a separate textured road-deck mesh.
import * as THREE from './lib/three.module.js';

export const WORLD_BRIDGE_KIT_URL = './data/models/assets/others/modular_bridge__low_poly__game_ready_/scene.gltf';

export const WORLD_KIT_BRIDGE_COMPONENTS = Object.freeze([
  Object.freeze({ id: 'bridge-curve-main', sourceNode: 'Plane_0', kind: 'curved-span', label: 'Curved elevated span A', expectedMeshes: 2 }),
  Object.freeze({ id: 'bridge-span-long', sourceNode: 'Plane.001_1', kind: 'straight-span', label: 'Long straight elevated span', expectedMeshes: 2 }),
  Object.freeze({ id: 'bridge-abutment', sourceNode: 'Plane.002_2', kind: 'abutment', label: 'Supported bridge transition', expectedMeshes: 2 }),
  Object.freeze({ id: 'bridge-curve-return', sourceNode: 'Plane.003_3', kind: 'curved-span', label: 'Curved elevated span B', expectedMeshes: 2 }),
  Object.freeze({ id: 'bridge-span-short', sourceNode: 'Plane.004_4', kind: 'straight-span', label: 'Short straight elevated span', expectedMeshes: 2 }),
]);

function isBridgeRoadMesh(mesh) {
  const materialNames = (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    .filter(Boolean)
    .map(material => String(material.name || '').toLowerCase());
  return materialNames.some(name => name.includes('bridge_road') || name.includes('bridge road'));
}

function normalizeBridgeNodeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findBridgeSourceNode(sourceScene, requestedName) {
  const exact = sourceScene.getObjectByName(requestedName);
  if (exact) return exact;

  // Blender/FBX/glTF exporters can normalize dotted object suffixes while
  // preserving the same imported hierarchy. Resolve punctuation-only name
  // differences before declaring a downloaded bridge section missing.
  const target = normalizeBridgeNodeName(requestedName);
  let match = null;
  let matchExtra = Infinity;
  const prefixMatches = [];
  sourceScene.traverse(node => {
    const normalized = normalizeBridgeNodeName(node.name);
    if (normalized === target) {
      match = node;
      matchExtra = 0;
      return;
    }
    if (normalized.startsWith(target)) {
      prefixMatches.push({ node, extra: normalized.length - target.length });
    }
  });
  if (match) return match;
  prefixMatches.sort((a, b) => a.extra - b.extra);
  return prefixMatches[0]?.node || null;
}

export function extractWorldBridgeKit(sourceScene) {
  if (!sourceScene || typeof sourceScene.getObjectByName !== 'function') {
    throw new TypeError('A loaded bridge GLTF scene is required');
  }

  sourceScene.updateMatrixWorld(true);
  const components = new Map();

  for (const definition of WORLD_KIT_BRIDGE_COMPONENTS) {
    const source = findBridgeSourceNode(sourceScene, definition.sourceNode);
    if (!source) {
      const available = [];
      sourceScene.traverse(node => {
        if (/plane/i.test(node.name || '')) available.push(node.name);
      });
      throw new Error(
        'Bridge kit is missing source component ' + definition.sourceNode +
        '; available Plane nodes: ' + available.join(', '),
      );
    }

    const group = new THREE.Group();
    group.name = definition.id;
    let meshCount = 0;
    let roadSurfaceCount = 0;

    source.traverse(node => {
      if (!node.isMesh || !node.geometry) return;
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
      geometry.computeBoundingBox();
      if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) {
        geometry.dispose();
        return;
      }

      const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
      const materials = sourceMaterials.map(material => material?.clone?.() || material);
      const material = Array.isArray(node.material) ? materials : materials[0];
      const roadSurface = isBridgeRoadMesh({ material });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = node.name;
      mesh.castShadow = !roadSurface;
      mesh.receiveShadow = true;
      mesh.userData.worldKit = {
        assetId: 'modular-bridge',
        componentId: definition.id,
        role: roadSurface ? 'bridge-road-surface' : 'bridge-concrete-structure',
      };
      group.add(mesh);
      meshCount++;
      if (roadSurface) roadSurfaceCount++;
    });

    if (meshCount !== definition.expectedMeshes || roadSurfaceCount !== 1) {
      throw new Error(
        'Bridge component ' + definition.id + ' expected ' + definition.expectedMeshes +
        ' meshes (one road surface), received ' + meshCount + ' meshes (' + roadSurfaceCount + ' road surfaces)',
      );
    }

    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(group);
    if (bounds.isEmpty()) throw new Error('Bridge component has empty bounds: ' + definition.id);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    group.traverse(node => {
      if (!node.isMesh) return;
      node.geometry.translate(-center.x, -bounds.min.y, -center.z);
      node.geometry.computeBoundingBox();
      node.geometry.computeBoundingSphere();
    });
    group.updateMatrixWorld(true);

    let deckHeight = 0;
    group.traverse(node => {
      if (!node.isMesh || node.userData.worldKit?.role !== 'bridge-road-surface') return;
      node.geometry.computeBoundingBox();
      deckHeight = node.geometry.boundingBox.max.y;
    });

    group.userData.worldKit = {
      assetId: 'modular-bridge',
      componentId: definition.id,
      kind: definition.kind,
      sourceNode: definition.sourceNode,
      meshCount,
      roadSurfaceCount,
      deckHeight,
    };

    components.set(definition.id, {
      ...definition,
      group,
      meshCount,
      roadSurfaceCount,
      dimensions: [size.x, size.y, size.z],
      deckHeight,
      longitudinalAxis: size.x >= size.z ? 'x' : 'z',
    });
  }

  return components;
}
