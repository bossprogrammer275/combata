// bvh-collision.js — Mesh-accurate BVH collision system using three-mesh-bvh.
// BVH meshes: raycast-only (camera avoidance, LOS, ground probe).
// AABB colliders: movement overlap (player, vehicle, enemy push-out).
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

// Enable accelerated raycasting on all Three.js meshes
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const _raycaster = new THREE.Raycaster();
const _vec = new THREE.Vector3();
const _box = new THREE.Box3();
const _matrix = new THREE.Matrix4();

export class BVHWorld {
  constructor() {
    this.bvhMeshes = [];         // { mesh, bvh, layer } — raycast-only
    this.aabbColliders = [];     // {min, max} — movement collision
    this._climbables = [];       // same format
    this._dirty = false;
    this.layers = 0xFFFFFFFF;
    // 2D uniform grid for movement queries. Detailed GLB sidecars may contain
    // hundreds of boxes per model; scanning the entire collider array every
    // player/car frame scales badly as the city grows.
    this._cellSize = 16;
    this._spatialCells = new Map();
    this._aabbIndexKeys = new Map();
    this._largeAABBs = new Set();
  }

  // Register ALL meshes in a model for BVH raycasting (no selective filter)
  registerModel(model, opts = {}) {
    const layer = opts.layer != null ? opts.layer : 1;

    model.traverse(child => {
      if (!child.isMesh || !child.visible) return;
      const name = (child.name || '').toLowerCase();
      // Blender/GLTF exporters often put the semantic prefix on an empty parent
      // and leave the actual mesh named "Cube". Check the full ancestry too.
      const hasPrefix = (prefix) => {
        let node = child;
        while (node) {
          if ((node.name || '').toLowerCase().startsWith(prefix)) return true;
          node = node.parent;
        }
        return false;
      };
      const hasRoomMarkerAncestor = () => {
        let node = child;
        while (node) {
          if (/^room_\d+_marker$/.test((node.name || '').toLowerCase())) return true;
          node = node.parent;
        }
        return false;
      };
      // Authoring-only collision proxies and visual accents should not create
      // ray hits. Movement collision for col_* lives in the AABB registry.
      if (
        ['col_', 'door_', 'window_', 'trim_', 'roof_detail', 'sign', 'awning'].some(hasPrefix) ||
        hasRoomMarkerAncestor()
      ) return;
      const geo = child.geometry;
      if (!geo || !geo.attributes.position) return;
      if (geo.index && geo.index.count < 9) return;

      child.updateMatrixWorld(true);

      if (!geo.boundsTree) {
        try {
          geo.computeBoundsTree({ strategy: 0, maxDepth: 10, maxLeafTris: 4 });
        } catch (e) {
          console.warn('[BVH] Failed to build BVH for mesh:', child.name, e);
          return;
        }
      }

      if (!geo.boundingBox) geo.computeBoundingBox();
      const worldBox = new THREE.Box3().copy(geo.boundingBox).applyMatrix4(child.matrixWorld);
      this.bvhMeshes.push({ mesh: child, bvh: geo.boundsTree, layer, worldBox });
    });
  }

  registerMerged(mesh, layer = 1) {
    const geo = mesh.geometry;
    if (!geo || !geo.attributes.position) return;
    if (!geo.boundsTree) {
      try { geo.computeBoundsTree({ strategy: 0, maxDepth: 10, maxLeafTris: 4 }); } catch { return; }
    }
    if (!geo.boundingBox) geo.computeBoundingBox();
    const worldBox = new THREE.Box3().copy(geo.boundingBox).applyMatrix4(mesh.matrixWorld);
    this.bvhMeshes.push({ mesh, bvh: geo.boundsTree, layer, worldBox });
  }

  _cellKey(x, z) {
    return x + ',' + z;
  }

  _unindexAABB(col) {
    const keys = this._aabbIndexKeys.get(col);
    if (keys === undefined) return;
    this._aabbIndexKeys.delete(col);
    if (keys === null) {
      this._largeAABBs.delete(col);
      return;
    }
    for (const key of keys) {
      const bucket = this._spatialCells.get(key);
      if (!bucket) continue;
      bucket.delete(col);
      if (!bucket.size) this._spatialCells.delete(key);
    }
  }

  indexAABB(col) {
    if (!col?.min || !col?.max || this._aabbIndexKeys.has(col)) return;
    const x0 = Math.floor(col.min.x / this._cellSize);
    const x1 = Math.floor(col.max.x / this._cellSize);
    const z0 = Math.floor(col.min.z / this._cellSize);
    const z1 = Math.floor(col.max.z / this._cellSize);
    const nx = x1 - x0 + 1, nz = z1 - z0 + 1;
    // Avoid filling thousands of cell buckets for map-scale trigger volumes.
    if (nx <= 0 || nz <= 0 || nx * nz > 256) {
      this._largeAABBs.add(col);
      this._aabbIndexKeys.set(col, null);
      return;
    }
    const keys = [];
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = this._cellKey(gx, gz);
        let bucket = this._spatialCells.get(key);
        if (!bucket) {
          bucket = new Set();
          this._spatialCells.set(key, bucket);
        }
        bucket.add(col);
        keys.push(key);
      }
    }
    this._aabbIndexKeys.set(col, keys);
  }

  rebuildAABBIndex() {
    this._spatialCells.clear();
    this._aabbIndexKeys.clear();
    this._largeAABBs.clear();
    for (const col of this.aabbColliders) this.indexAABB(col);
  }

  _queryAABBCandidates(x1, z1, x2, z2) {
    if (!this._spatialCells.size && !this._largeAABBs.size) return this.aabbColliders;
    const gx0 = Math.floor(x1 / this._cellSize);
    const gx1 = Math.floor(x2 / this._cellSize);
    const gz0 = Math.floor(z1 / this._cellSize);
    const gz1 = Math.floor(z2 / this._cellSize);
    const nx = gx1 - gx0 + 1, nz = gz1 - gz0 + 1;
    if (nx <= 0 || nz <= 0 || nx * nz > 4096) return this.aabbColliders;
    const out = new Set(this._largeAABBs);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const bucket = this._spatialCells.get(this._cellKey(gx, gz));
        if (bucket) for (const col of bucket) out.add(col);
      }
    }
    return out;
  }

  addAABB(min, max, climbable = false, type = null) {
    const c = { min: min.clone(), max: max.clone() };
    if (type) c.type = type;
    if (climbable) this._climbables.push(c);
    this.aabbColliders.push(c);
    this.indexAABB(c);
    return c;
  }

  removeAABB(col) {
    // A climbable is also a solid collider. Remove it from both registries and
    // from the spatial index to avoid stale collision hits after removal.
    this._unindexAABB(col);
    let i = this.aabbColliders.indexOf(col);
    if (i >= 0) this.aabbColliders.splice(i, 1);
    i = this._climbables.indexOf(col);
    if (i >= 0) this._climbables.splice(i, 1);
  }

  removeMesh(mesh) {
    const idx = this.bvhMeshes.findIndex(e => e.mesh === mesh);
    if (idx >= 0) {
      const entry = this.bvhMeshes[idx];
      if (entry.mesh.geometry.boundsTree) entry.mesh.geometry.disposeBoundsTree();
      this.bvhMeshes.splice(idx, 1);
    }
  }

  clear() {
    for (const e of this.bvhMeshes) {
      if (e.mesh.geometry.boundsTree) e.mesh.geometry.disposeBoundsTree();
    }
    this.bvhMeshes.length = 0;
    this.aabbColliders.length = 0;
    this._climbables.length = 0;
    this._spatialCells.clear();
    this._aabbIndexKeys.clear();
    this._largeAABBs.clear();
  }

  // ---- COMPATIBILITY ALIASES ----
  insert(col) {
    if (!this.aabbColliders.includes(col)) this.aabbColliders.push(col);
    this.indexAABB(col);
  }
  remove(col) { this.removeAABB(col); }
  queryPoint(x, z, r) { return this.queryRadius(x, z, r); }

  // ---- RAYCAST (BVH mesh + AABB fallback) ----

  raycast(origin, dir, maxDist) {
    let best = null;

    _raycaster.ray.origin.set(origin.x, origin.y, origin.z);
    _raycaster.ray.direction.set(dir.x, dir.y, dir.z);
    _raycaster.near = 0.01;
    _raycaster.far = maxDist;
    const layerMask = this.layers;

    for (let i = 0, l = this.bvhMeshes.length; i < l; i++) {
      const entry = this.bvhMeshes[i];
      if (!(entry.layer & layerMask)) continue;
      const mesh = entry.mesh;
      if (!mesh.visible) continue;

      const box = entry.worldBox || (mesh.geometry.boundingBox ? _box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld) : null);
      if (box && !_raycaster.ray.intersectsBox(box)) continue;

      const intersects = [];
      mesh.raycast(_raycaster, intersects);
      if (intersects.length > 0) {
        const h = intersects[0];
        if (h.distance > 0.01 && h.distance < maxDist) {
          if (!best || h.distance < best.dist) {
            const wm = mesh.matrixWorld;
            best = { dist: h.distance, point: h.point.clone(), normal: h.face.normal.clone().transformDirection(wm).normalize(), mesh };
          }
        }
      }
    }

    const rayEndX = origin.x + dir.x * maxDist;
    const rayEndZ = origin.z + dir.z * maxDist;
    const candidates = this._queryAABBCandidates(
      Math.min(origin.x, rayEndX), Math.min(origin.z, rayEndZ),
      Math.max(origin.x, rayEndX), Math.max(origin.z, rayEndZ),
    );
    for (const c of candidates) {
      const hit = _rayCollider(origin, dir, maxDist, c);
      if (hit && (!best || hit.dist < best.dist)) {
        best = { dist: hit.dist, point: hit.point, normal: hit.normal };
      }
    }

    return best;
  }

  raycastSolids(origin, dir, maxDist) {
    let best = null;

    _raycaster.ray.origin.set(origin.x, origin.y, origin.z);
    _raycaster.ray.direction.set(dir.x, dir.y, dir.z);
    _raycaster.near = 0.01;
    _raycaster.far = maxDist;
    const layerMask = this.layers;

    for (let i = 0, l = this.bvhMeshes.length; i < l; i++) {
      const entry = this.bvhMeshes[i];
      if (!(entry.layer & layerMask)) continue;
      const mesh = entry.mesh;
      if (!mesh.visible) continue;

      const box = entry.worldBox || (mesh.geometry.boundingBox ? _box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld) : null);
      if (box && !_raycaster.ray.intersectsBox(box)) continue;

      const intersects = [];
      mesh.raycast(_raycaster, intersects);
      if (intersects.length > 0) {
        const h = intersects[0];
        if (h.distance > 0.01 && h.distance < maxDist) {
          if (!best || h.distance < best.dist) {
            const wm = mesh.matrixWorld;
            best = { dist: h.distance, point: h.point.clone(), normal: h.face.normal.clone().transformDirection(wm).normalize(), mesh };
          }
        }
      }
    }

    const rayEndX = origin.x + dir.x * maxDist;
    const rayEndZ = origin.z + dir.z * maxDist;
    const candidates = this._queryAABBCandidates(
      Math.min(origin.x, rayEndX), Math.min(origin.z, rayEndZ),
      Math.max(origin.x, rayEndX), Math.max(origin.z, rayEndZ),
    );
    for (const c of candidates) {
      if (c.max.y < 1.2) continue;
      const hit = _rayCollider(origin, dir, maxDist, c);
      if (hit && (!best || hit.dist < best.dist)) {
        best = { dist: hit.dist, point: hit.point, normal: hit.normal };
      }
    }

    return best;
  }

  losBlocked(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return false;
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    const hit = this.raycast(a, dir, len);
    return hit !== null;
  }

  // Point overlap — fast AABB collision for movement/steering/spawning
  colliderAt(x, z, r = 0.4) {
    const candidates = this._queryAABBCandidates(x - r, z - r, x + r, z + r);
    for (const c of candidates) {
      if (c.max.y < 0.3) continue;
      if (c.orientedBox) {
        if (_circleOverlapsOrientedBox(x, z, r, c.orientedBox)) return true;
        continue;
      }
      if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) return true;
    }
    return false;
  }

  // ---- MOVEMENT QUERIES (AABB-only, no BVH mesh proxies) ----

  // queryRadius: returns ONLY AABB colliders within radius.
  // BVH meshes are NOT returned as movement proxies (their bounding boxes are too large).
  queryRadius(x, z, radius) {
    const out = [];
    const r2 = radius * radius;
    const candidates = this._queryAABBCandidates(x - radius, z - radius, x + radius, z + radius);
    for (const c of candidates) {
      if (c.max.y < 0.3) continue;
      if (c.orientedBox) {
        if (_circleOverlapsOrientedBox(x, z, radius, c.orientedBox)) out.push(c);
        continue;
      }
      const cx = Math.max(c.min.x, Math.min(x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(z, c.max.z));
      const dx = cx - x, dz = cz - z;
      if (dx * dx + dz * dz <= r2) out.push(c);
    }
    return out;
  }

  // queryAABB: local movement query against cells intersecting the requested XZ area.
  // BVH meshes remain raycast-only and are not movement proxies.
  queryAABB(x1, z1, x2, z2) {
    const candidates = this._queryAABBCandidates(x1, z1, x2, z2);
    const out = [];
    for (const c of candidates) {
      if (c.max.x >= x1 && c.min.x <= x2 && c.max.z >= z1 && c.min.z <= z2) out.push(c);
    }
    return out;
  }

  get allColliders() { return this.aabbColliders; }
  get climbables() { return this._climbables; }
}

function _circleOverlapsOrientedBox(x, z, radius, box) {
  const dx = x - box.center.x, dz = z - box.center.z;
  const c = Math.cos(box.yaw), sn = Math.sin(box.yaw);
  const localX = dx * c - dz * sn;
  const localZ = dx * sn + dz * c;
  const closestX = THREE.MathUtils.clamp(localX, -box.halfExtents.x, box.halfExtents.x);
  const closestZ = THREE.MathUtils.clamp(localZ, -box.halfExtents.z, box.halfExtents.z);
  const ox = localX - closestX, oz = localZ - closestZ;
  return ox * ox + oz * oz <= radius * radius;
}

function _rayCollider(origin, dir, maxDist, collider) {
  const box = collider.orientedBox;
  if (!box) return _rayAABB(origin, dir, collider, maxDist);
  const dx = origin.x - box.center.x, dz = origin.z - box.center.z;
  const c = Math.cos(box.yaw), sn = Math.sin(box.yaw);
  const localOrigin = {
    x: dx * c - dz * sn,
    y: origin.y - box.center.y,
    z: dx * sn + dz * c,
  };
  const localDir = {
    x: dir.x * c - dir.z * sn,
    y: dir.y,
    z: dir.x * sn + dir.z * c,
  };
  const localBox = {
    min: { x: -box.halfExtents.x, y: -box.halfExtents.y, z: -box.halfExtents.z },
    max: { x: box.halfExtents.x, y: box.halfExtents.y, z: box.halfExtents.z },
  };
  const hit = _rayAABB(localOrigin, localDir, localBox, maxDist);
  if (!hit) return null;
  const nx = hit.normal.x * c + hit.normal.z * sn;
  const nz = -hit.normal.x * sn + hit.normal.z * c;
  return {
    dist: hit.dist,
    point: new THREE.Vector3(
      origin.x + dir.x * hit.dist,
      origin.y + dir.y * hit.dist,
      origin.z + dir.z * hit.dist,
    ),
    normal: new THREE.Vector3(nx, hit.normal.y, nz),
  };
}

function _rayAABB(origin, dir, box, maxDist) {
  let tmin = 0, tmax = maxDist;
  const axes = [
    { d: dir.x, mn: box.min.x, mx: box.max.x, o: origin.x },
    { d: dir.y, mn: box.min.y, mx: box.max.y, o: origin.y },
    { d: dir.z, mn: box.min.z, mx: box.max.z, o: origin.z },
  ];
  let axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const { d, mn, mx, o } = axes[i];
    const inv = 1 / (d || 1e-12);
    let t0 = (mn - o) * inv;
    let t1 = (mx - o) * inv;
    let s = -1;
    if (inv < 0) { const tmp = t0; t0 = t1; t1 = tmp; s = 1; }
    if (t0 > tmin) { tmin = t0; axis = i; sign = s; }
    tmax = Math.min(tmax, t1);
    if (tmax < tmin) return null;
  }
  if (tmin < 0 || tmin > maxDist) return null;
  const point = new THREE.Vector3(
    origin.x + dir.x * tmin,
    origin.y + dir.y * tmin,
    origin.z + dir.z * tmin,
  );
  const normal = new THREE.Vector3();
  if (axis === 0) normal.x = sign;
  else if (axis === 1) normal.y = sign;
  else normal.z = sign;
  return { dist: tmin, point, normal };
}
