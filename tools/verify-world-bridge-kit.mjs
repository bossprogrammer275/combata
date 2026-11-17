import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../js/lib/three.module.js';
import { extractWorldBridgeKit, WORLD_KIT_BRIDGE_COMPONENTS } from '../js/world-bridge-kit.js';

const assetPath = new URL('../data/models/assets/others/modular_bridge__low_poly__game_ready_/scene.gltf', import.meta.url);
const source = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
const nodeByName = new Map((source.nodes || []).map(node => [node.name, node]));
const meshes = source.meshes || [];
const accessors = source.accessors || [];
const materialNames = (source.materials || []).map(material => String(material.name || '').toLowerCase());

assert.equal(WORLD_KIT_BRIDGE_COMPONENTS.length, 5, 'all five authored bridge sections must be registered');
for (const definition of WORLD_KIT_BRIDGE_COMPONENTS) {
  const node = nodeByName.get(definition.sourceNode);
  assert.ok(node, 'bridge source node missing: ' + definition.sourceNode);
  assert.ok(Array.isArray(node.children) && node.children.length >= 2, 'bridge section must preserve its paired structure and deck meshes');
  const childMeshes = node.children.map(index => source.nodes[index]).filter(child => child && Number.isInteger(child.mesh));
  assert.equal(childMeshes.length, 2, 'each bridge section should contain two imported meshes');
  const materialSet = new Set(childMeshes.flatMap(child => (meshes[child.mesh]?.primitives || []).map(p => materialNames[p.material] || '')));
  assert.ok([...materialSet].some(name => name.includes('concrete')), 'bridge section needs its concrete structural mesh');
  assert.ok([...materialSet].some(name => name.includes('bridge_road')), 'bridge section needs its own road-deck mesh');
}

const fixture = new THREE.Group();
for (const definition of WORLD_KIT_BRIDGE_COMPONENTS) {
  const section = new THREE.Group();
  section.name = definition.sourceNode;
  const concrete = new THREE.Mesh(new THREE.BoxGeometry(12, 2, 5), new THREE.MeshStandardMaterial({ color: 0x888888 }));
  concrete.material.name = 'Concrete';
  const road = new THREE.Mesh(new THREE.BoxGeometry(12, 0.04, 5), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  road.material.name = 'bridge_road';
  road.position.y = 1;
  section.add(concrete, road);
  fixture.add(section);
}
const kit = extractWorldBridgeKit(fixture);
assert.equal(kit.size, 5);
for (const definition of WORLD_KIT_BRIDGE_COMPONENTS) {
  const component = kit.get(definition.id);
  assert.ok(component, 'component extraction failed: ' + definition.id);
  assert.equal(component.meshCount, 2);
  assert.equal(component.roadSurfaceCount, 1);
  assert.ok(component.deckHeight > 0);
  assert.ok(component.dimensions.every(Number.isFinite));
  assert.equal(component.group.userData.worldKit.componentId, definition.id);
}

console.log('[world-bridge-kit] PASS: five source bridge sections retain concrete supports and road decks.');
