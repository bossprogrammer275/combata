// Reusable, independent prefabs extracted from the downloaded modular bridge kit.
// The source GLTF contains ten independent mesh nodes: five concrete structures
// and five road/deck surfaces. They share section anchors, but are never merged
// into composite meshes.
//
// Source: "Modular Bridge (low poly) Game Ready" by Salah3D, CC-BY-4.0
// https://sketchfab.com/3d-models/modular-bridge-low-poly-game-ready-0d7261538b4e4433b230f083a0cef38f
import * as THREE from 'three';

export const WORLD_BRIDGE_KIT_URL = './data/models/assets/others/modular_bridge__low_poly__game_ready_/scene.gltf';

// Unscaled kit lengths along the travel axis, measured from the GLTF accessors.
// Useful for packing sections end-to-end: pitch = length * scaleX (no gaps, no overlap).
export const WORLD_KIT_SECTION_LENGTH = Object.freeze({
  'bridge-curve-main': null, // curves are not packed linearly
  'bridge-straight-span': 20.0,
  'bridge-pier-starter': 4.0,
  'bridge-curve-return': null,
  'bridge-end-ramp': 8.889,
});

// Every section is authored with the deck surface 2.068 m above the footing level.
export const WORLD_KIT_DECK_HEIGHT = 2.068;
const DECK_HEIGHT_TOLERANCE = 0.02;

export const WORLD_KIT_BRIDGE_SECTIONS = Object.freeze([
  Object.freeze({ id: 'bridge-curve-main', sourceNode: 'Plane_0', structureComponentId: 'bridge-curve-main-structure', deckComponentId: 'bridge-curve-main-deck', structureNode: 'Object_4', deckNode: 'Object_5', kind: 'curved-span', longitudinalAxis: 'x' }),
  Object.freeze({ id: 'bridge-straight-span', sourceNode: 'Plane.001_1', structureComponentId: 'bridge-straight-structure', deckComponentId: 'bridge-straight-deck', structureNode: 'Object_7', deckNode: 'Object_8', kind: 'straight-span', longitudinalAxis: 'x' }),
  Object.freeze({ id: 'bridge-pier-starter', sourceNode: 'Plane.002_2', structureComponentId: 'bridge-pier-starter-structure', deckComponentId: 'bridge-pier-starter-deck', structureNode: 'Object_10', deckNode: 'Object_11', kind: 'short-pier-starter', longitudinalAxis: 'x' }),
  Object.freeze({ id: 'bridge-curve-return', sourceNode: 'Plane.003_3', structureComponentId: 'bridge-curve-return-structure', deckComponentId: 'bridge-curve-return-deck', structureNode: 'Object_13', deckNode: 'Object_14', kind: 'curved-span', longitudinalAxis: 'z' }),
  Object.freeze({ id: 'bridge-end-ramp', sourceNode: 'Plane.004_4', structureComponentId: 'bridge-end-ramp-structure', deckComponentId: 'bridge-end-ramp-deck', structureNode: 'Object_16', deckNode: 'Object_17', kind: 'sloped-end-abutment', longitudinalAxis: 'x' }),
]);

export const WORLD_KIT_BRIDGE_COMPONENTS = Object.freeze(
  WORLD_KIT_BRIDGE_SECTIONS.flatMap(section => [
    Object.freeze({ id: section.structureComponentId, sectionId: section.id, sourceNode: section.structureNode, sourceSectionNode: section.sourceNode, kind: section.kind, role: 'bridge-structure' }),
    Object.freeze({ id: section.deckComponentId, sectionId: section.id, sourceNode: section.deckNode, sourceSectionNode: section.sourceNode, kind: section.kind, role: 'bridge-deck' }),
  ]),
);

// ---------------------------------------------------------------------------
// Footing analysis (pure geometry, no three.js types)
//
// Finds the support footings of a bridge structure mesh: compact, horizontal,
// DOWNWARD-facing triangle patches, grouped by real mesh connectivity (welded
// vertices), not by a spatial hash of vertices.
//
// Why not "vertices near min Y"? In this kit that approach (a) splits one
// footing into two when its vertices straddle a grid cell, (b) picks up rim
// fragments of slightly non-flat triangles, (c) missed 3 of 10 footings on the
// straight span, and (d) on the end ramp returns the buried tip of the slope
// (Y = -1.847) instead of the pier footing (Y = -1.575).

export const FOOTING_DEFAULTS = Object.freeze({
  weldTolerance: 1e-3, // vertices closer than this are the same vertex (UV/normal seams)
  flatTolerance: 0.004, // max Y spread inside a "horizontal" triangle
  levelTolerance: 0.02, // footings within this of the datum are "at the datum"
  minDimension: 0.08, // compact footing size limits (oriented box, metres)
  maxDimension: 3.5,
});

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Minimum-area oriented rectangle over the XZ points (exact: tests every hull edge direction).
export function orientedFootprint(xzPoints) {
  const hull = convexHull(xzPoints);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const phi = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p[0] * c + p[1] * s;
      const v = -p[0] * s + p[1] * c;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const du = maxU - minU;
    const dv = maxV - minV;
    const area = du * dv;
    if (!best || area < best.area - 1e-12) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      // Long axis direction in XZ, then converted to a three.js rotation.y:
      // rotation.y = t maps local +X to world (cos t, 0, -sin t)  =>  t = atan2(-dz, dx).
      const longIsU = du >= dv;
      const axisPhi = longIsU ? phi : phi + Math.PI / 2;
      best = {
        area,
        x: cu * c - cv * s,
        z: cu * s + cv * c,
        length: Math.max(du, dv),
        width: Math.min(du, dv),
        yaw: Math.atan2(-Math.sin(axisPhi), Math.cos(axisPhi)),
      };
    }
  }
  return best;
}

/**
 * @param {{count:number, getX:(i:number)=>number, getY:(i:number)=>number, getZ:(i:number)=>number,
 *          index?:ArrayLike<number>|null}} mesh  positions in the space footings should be reported in
 * @returns {{datumY:number|null, footings:Array}}  datumY = Y of the lowest compact footing level
 */
export function analyzeSupportFootings(mesh, options = {}) {
  const o = { ...FOOTING_DEFAULTS, ...options };
  const { count, getX, getY, getZ } = mesh;
  const index = mesh.index || null;
  const triCount = index ? Math.floor(index.length / 3) : Math.floor(count / 3);

  // 1. Weld coincident vertices.
  const inv = 1 / o.weldTolerance;
  const weldIds = new Map();
  const toWeld = new Int32Array(count);
  const wx = [], wy = [], wz = [];
  for (let i = 0; i < count; i++) {
    const x = getX(i), y = getY(i), z = getZ(i);
    const key = Math.round(x * inv) + ',' + Math.round(y * inv) + ',' + Math.round(z * inv);
    let id = weldIds.get(key);
    if (id === undefined) {
      id = wx.length;
      weldIds.set(key, id);
      wx.push(x); wy.push(y); wz.push(z);
    }
    toWeld[i] = id;
  }

  // 2. Union-find over welded vertices of horizontal, downward-facing triangles.
  const parent = new Int32Array(wx.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = a => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const tris = []; // [a, b, c] welded ids
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index[t * 3] : t * 3;
    const i1 = index ? index[t * 3 + 1] : t * 3 + 1;
    const i2 = index ? index[t * 3 + 2] : t * 3 + 2;
    const y0 = getY(i0), y1 = getY(i1), y2 = getY(i2);
    if (Math.max(y0, y1, y2) - Math.min(y0, y1, y2) > o.flatTolerance) continue;
    // Y component of (p1-p0) x (p2-p0); negative = faces down (CCW winding, glTF).
    const ny = (getZ(i1) - getZ(i0)) * (getX(i2) - getX(i0)) - (getX(i1) - getX(i0)) * (getZ(i2) - getZ(i0));
    if (ny > -1e-9) continue;
    const a = toWeld[i0], b = toWeld[i1], c = toWeld[i2];
    tris.push([a, b, c, -ny * 0.5]);
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
  }

  // 3. Collect components.
  const comps = new Map();
  for (const [a, b, c, area] of tris) {
    const root = find(a);
    let comp = comps.get(root);
    if (!comp) comps.set(root, (comp = { ids: new Set(), area: 0, triangleCount: 0 }));
    comp.ids.add(a); comp.ids.add(b); comp.ids.add(c);
    comp.area += area;
    comp.triangleCount++;
  }

  // 4. Keep compact footings, find the datum, keep those at the datum.
  const compact = [];
  for (const comp of comps.values()) {
    const xz = [];
    let sumY = 0;
    for (const id of comp.ids) { xz.push([wx[id], wz[id]]); sumY += wy[id]; }
    const box = orientedFootprint(xz);
    if (!box || box.width < o.minDimension || box.length > o.maxDimension) continue;
    compact.push({
      x: box.x, y: sumY / comp.ids.size, z: box.z,
      length: box.length, width: box.width, yaw: box.yaw,
      area: comp.area, triangleCount: comp.triangleCount,
    });
  }
  if (!compact.length) return { datumY: null, footings: [] };
  const datumY = Math.min(...compact.map(f => f.y));
  const footings = compact
    .filter(f => Math.abs(f.y - datumY) <= o.levelTolerance)
    .sort((a, b) => a.x - b.x || a.z - b.z);
  return { datumY, footings };
}

// ---------------------------------------------------------------------------
// Kit extraction
// ---------------------------------------------------------------------------
const normalizeName = name => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// GLTFLoader strips characters such as "." from node names ("Plane.001_1" -> "Plane001_1"),
// so fall back to a punctuation-insensitive EXACT match. No prefix matching: "Object_1"
// would silently resolve to "Object_10".
function findBridgeNode(root, requestedName) {
  const exact = root.getObjectByName(requestedName);
  if (exact) return exact;
  const target = normalizeName(requestedName);
  const matches = [];
  root.traverse(node => { if (node.name && normalizeName(node.name) === target) matches.push(node); });
  if (matches.length > 1) throw new Error('Ambiguous bridge node name: ' + requestedName);
  return matches[0] || null;
}

function worldBounds(node) {
  node.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(node);
}

function geometryAccess(geometry) {
  // GLTFLoader returns InterleavedBufferAttribute for strided data, so never touch .array directly.
  const p = geometry.attributes.position;
  return {
    count: p.count,
    getX: i => p.getX(i),
    getY: i => p.getY(i),
    getZ: i => p.getZ(i),
    index: geometry.index ? geometry.index.array : null,
  };
}

export function extractWorldBridgeKit(sourceScene) {
  if (!sourceScene || typeof sourceScene.getObjectByName !== 'function') {
    throw new TypeError('A loaded bridge GLTF scene is required');
  }

  sourceScene.updateMatrixWorld(true);
  const prefabs = new Map();
  const materialCache = new Map(); // one material per source material: 2 total instead of 10

  const shareMaterial = source => {
    if (!source) return source;
    if (Array.isArray(source)) return source.map(shareMaterial);
    let shared = materialCache.get(source);
    if (!shared) { shared = source.clone(); materialCache.set(source, shared); }
    return shared;
  };

  for (const section of WORLD_KIT_BRIDGE_SECTIONS) {
    const sourceSection = findBridgeNode(sourceScene, section.sourceNode);
    const structureNode = findBridgeNode(sourceScene, section.structureNode);
    const deckNode = findBridgeNode(sourceScene, section.deckNode);
    if (!sourceSection || !structureNode?.isMesh || !deckNode?.isMesh) {
      throw new Error('Bridge section ' + section.id + ' is incomplete: expected ' + section.sourceNode +
        ' with independent meshes ' + section.structureNode + ' and ' + section.deckNode);
    }

    const sectionBounds = worldBounds(sourceSection);
    const structureBounds = worldBounds(structureNode);
    const deckBounds = worldBounds(deckNode);
    if (sectionBounds.isEmpty() || structureBounds.isEmpty() || deckBounds.isEmpty()) {
      throw new Error('Bridge section has empty geometry bounds: ' + section.id);
    }

    // Structure geometry in the shared source space, used for footing analysis.
    const structureWorld = structureNode.geometry.clone().applyMatrix4(structureNode.matrixWorld);

    // Foundation datum = the lowest COMPACT FLAT footing, not the lowest vertex.
    // On the end ramp the lowest vertex is the buried tip of the slope (0.27 m below the
    // pier footings), which made its deck look 13% taller than every other section.
    const analysis = analyzeSupportFootings(geometryAccess(structureWorld));
    let foundationDatum = analysis.datumY;
    if (foundationDatum === null) {
      console.warn('[bridge-kit] no flat footings found for ' + section.id + '; falling back to lowest vertex');
      foundationDatum = structureBounds.min.y;
    }
    structureWorld.dispose();

    const anchor = sectionBounds.getCenter(new THREE.Vector3());
    const sourceDeckHeight = deckBounds.max.y - foundationDatum;
    if (!Number.isFinite(sourceDeckHeight) || sourceDeckHeight <= 0.1) {
      throw new Error('Bridge section has invalid source deck height: ' + section.id);
    }
    if (Math.abs(sourceDeckHeight - WORLD_KIT_DECK_HEIGHT) > DECK_HEIGHT_TOLERANCE) {
      console.warn('[bridge-kit] ' + section.id + ' deck height ' + sourceDeckHeight.toFixed(3) +
        ' differs from the kit standard ' + WORLD_KIT_DECK_HEIGHT);
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

    // Footings in prefab-local space (anchor at origin, footing level at Y = 0).
    const supportFootContacts = analysis.footings.map(f => ({
      x: f.x - anchor.x,
      y: 0,
      z: f.z - anchor.z,
      width: f.width, // short side of the oriented box
      depth: f.length, // long side
      yaw: f.yaw, // three.js rotation.y that aligns local +X with the long side
      area: f.area,
      triangleCount: f.triangleCount,
    }));

    for (const definition of WORLD_KIT_BRIDGE_COMPONENTS.filter(item => item.sectionId === section.id)) {
      const isStructure = definition.role === 'bridge-structure';
      const sourceMesh = isStructure ? structureNode : deckNode;
      const material = shareMaterial(sourceMesh.material);
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
      mesh.castShadow = isStructure;
      mesh.receiveShadow = true;
      mesh.userData.worldKit = {
        assetId: 'modular-bridge',
        componentId: definition.id,
        sectionId: definition.sectionId,
        role: definition.role,
        sourceNode: definition.sourceNode,
        supportFootContacts: isStructure ? supportFootContacts : [],
      };

      // Sanity-check the hand-written axis hint against the real geometry (straight pieces only).
      if (!section.kind.startsWith('curved') && (size.x >= size.z ? 'x' : 'z') !== section.longitudinalAxis) {
        console.warn('[bridge-kit] ' + definition.id + ' longitudinalAxis hint disagrees with its bounds');
      }

      prefabs.set(definition.id, {
        ...definition,
        ...sectionMeta,
        mesh,
        geometry,
        material,
        dimensions: [size.x, size.y, size.z],
        longitudinalAxis: section.longitudinalAxis,
        supportFootContacts: isStructure ? supportFootContacts : [],
        localBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      });
    }
  }

  if (prefabs.size !== WORLD_KIT_BRIDGE_COMPONENTS.length) {
    throw new Error('Expected ' + WORLD_KIT_BRIDGE_COMPONENTS.length + ' independent bridge component prefabs, received ' + prefabs.size);
  }
  return prefabs;
}

// Every prefab shares the 2 cloned materials; dispose them once, not per prefab.
export function disposeWorldBridgeKit(prefabs) {
  const materials = new Set();
  for (const prefab of prefabs.values()) {
    prefab.geometry.dispose();
    (Array.isArray(prefab.material) ? prefab.material : [prefab.material]).forEach(m => materials.add(m));
  }
  materials.forEach(m => m.dispose());
  prefabs.clear();
}