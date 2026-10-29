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
  }

  // Register ALL meshes in a model for BVH raycasting (no selective filter)
  registerModel(model, opts = {}) {
    const layer = opts.layer != null ? opts.layer : 1;

    model.traverse(child => {
      if (!child.isMesh) return;
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

  addAABB(min, max, climbable = false, type = null) {
    const c = { min: min.clone(), max: max.clone() };
    if (type) c.type = type;
    if (climbable) this._climbables.push(c); else this.aabbColliders.push(c);
    return c;
  }

  removeAABB(col) {
    let i = this.aabbColliders.indexOf(col);
    if (i >= 0) { this.aabbColliders.splice(i, 1); return; }
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
  }

  // ---- COMPATIBILITY ALIASES ----
  insert(col) { this.aabbColliders.push(col); }
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

    for (const c of this.aabbColliders) {
      const hit = _rayAABB(origin, dir, c, maxDist);
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

    for (const c of this.aabbColliders) {
      if (c.max.y < 1.2) continue;
      const hit = _rayAABB(origin, dir, c, maxDist);
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
    for (let i = 0, len = this.aabbColliders.length; i < len; i++) {
      const c = this.aabbColliders[i];
      if (c.max.y < 0.3) continue;
      if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) {
        return true;
      }
    }
    return false;
  }

  // ---- MOVEMENT QUERIES (AABB-only, no BVH mesh proxies) ----

  // queryRadius: returns ONLY AABB colliders within radius.
  // BVH meshes are NOT returned as movement proxies (their bounding boxes are too large).
  queryRadius(x, z, radius) {
    const out = [];
    const r2 = radius * radius;

    for (const c of this.aabbColliders) {
      if (c.max.y < 0.3) continue;
      const cx = Math.max(c.min.x, Math.min(x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(z, c.max.z));
      const dx = cx - x, dz = cz - z;
      if (dx * dx + dz * dz <= r2) {
        out.push(c);
      }
    }

    return out;
  }

  // queryAABB: returns ONLY AABB colliders in the region.
  // BVH meshes are NOT returned as movement proxies.
  queryAABB(x1, z1, x2, z2) {
    const out = [];

    for (const c of this.aabbColliders) {
      if (c.max.x >= x1 && c.min.x <= x2 && c.max.z >= z1 && c.min.z <= z2) {
        out.push(c);
      }
    }

    return out;
  }

  get allColliders() { return this.aabbColliders; }
  get climbables() { return this._climbables; }
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
