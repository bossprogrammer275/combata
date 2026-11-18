import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  extractWorldBridgeKit,
  WORLD_KIT_BRIDGE_COMPONENTS,
  WORLD_KIT_BRIDGE_SECTIONS,
} from '../js/world-bridge-kit.js';

const assetPath = new URL('../data/models/assets/others/modular_bridge__low_poly__game_ready_/scene.gltf', import.meta.url);
const source = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
const nodeByName = new Map((source.nodes || []).map(node => [node.name, node]));
const meshes = source.meshes || [];
const materialNames = (source.materials || []).map(material => String(material.name || '').toLowerCase());

assert.equal(WORLD_KIT_BRIDGE_SECTIONS.length, 5, 'all five authored bridge section types must be reusable');
assert.equal(WORLD_KIT_BRIDGE_COMPONENTS.length, 10, 'the pack must expose ten independent mesh prefabs');

for (const section of WORLD_KIT_BRIDGE_SECTIONS) {
  const parent = nodeByName.get(section.sourceNode);
  const structureNode = nodeByName.get(section.structureNode);
  const deckNode = nodeByName.get(section.deckNode);
  assert.ok(parent, 'bridge section missing: ' + section.sourceNode);
  assert.ok(structureNode && Number.isInteger(structureNode.mesh), 'concrete structure mesh missing: ' + section.structureNode);
  assert.ok(deckNode && Number.isInteger(deckNode.mesh), 'road deck mesh missing: ' + section.deckNode);
  assert.ok(parent.children?.includes(source.nodes.indexOf(structureNode)), 'structure must remain a distinct child mesh');
  assert.ok(parent.children?.includes(source.nodes.indexOf(deckNode)), 'deck must remain a distinct child mesh');

  const structureMaterials = new Set((meshes[structureNode.mesh]?.primitives || [])
    .map(primitive => materialNames[primitive.material] || ''));
  const deckMaterials = new Set((meshes[deckNode.mesh]?.primitives || [])
    .map(primitive => materialNames[primitive.material] || ''));
  assert.ok([...structureMaterials].some(name => name.includes('concrete')),
    section.id + ' must use the imported concrete component');
  assert.ok([...deckMaterials].some(name => name.includes('bridge_road')),
    section.id + ' must use its separate imported road/deck component');
}

const fixture = new THREE.Group();
for (const section of WORLD_KIT_BRIDGE_SECTIONS) {
  const parent = new THREE.Group();
  parent.name = section.sourceNode.replace(/\./g, '_');

  const structure = new THREE.Mesh(
    new THREE.BoxGeometry(12, 2.4, 5),
    new THREE.MeshStandardMaterial({ color: 0x888888 }),
  );
  structure.name = section.structureNode;
  structure.material.name = 'concrete';

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(12, 0.04, 5),
    new THREE.MeshStandardMaterial({ color: 0x333333 }),
  );
  deck.name = section.deckNode;
  deck.material.name = 'bridge_road';
  deck.position.y = 2.0;

  parent.add(structure, deck);
  fixture.add(parent);
}

const kit = extractWorldBridgeKit(fixture);
assert.equal(kit.size, 10);

for (const section of WORLD_KIT_BRIDGE_SECTIONS) {
  const structure = kit.get(section.structureComponentId);
  const deck = kit.get(section.deckComponentId);
  assert.ok(structure && deck, 'independent prefabs missing for ' + section.id);
  assert.equal(structure.role, 'bridge-structure');
  assert.equal(deck.role, 'bridge-deck');
  assert.notEqual(structure.mesh, deck.mesh, 'concrete and asphalt must not be merged into one component');
  assert.notEqual(structure.geometry, deck.geometry, 'concrete and asphalt must retain independent geometry');
  assert.ok(Math.abs(structure.localBounds.min[1]) < 1e-6,
    'concrete support must be anchored at its source foundation plane');
  assert.ok(Math.abs(deck.localBounds.max[1] - structure.sourceDeckHeight) < 1e-6,
    'the separate deck prefab must retain its source metric deck offset');
  assert.ok(structure.dimensions.every(Number.isFinite));
  assert.ok(deck.dimensions.every(Number.isFinite));
  assert.ok(structure.sourceDeckHeight > 0.1);
  assert.equal(structure.sectionId, deck.sectionId);
}

console.log('[world-bridge-kit] PASS: ten independent bridge meshes extracted from five reusable section types.');
