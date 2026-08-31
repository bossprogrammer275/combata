import * as THREE from 'three';

export class SpatialGrid {
  constructor(cellSize = 12) {
    this.cellSize = cellSize;
    this.invCell = 1 / cellSize;
    this._cells = new Map();
    this._dirty = false;
  }
  clear() { this._cells.clear(); this._dirty = false; }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  insert(col) {
    const minCX = Math.floor(col.min.x * this.invCell);
    const minCZ = Math.floor(col.min.z * this.invCell);
    const maxCX = Math.floor(col.max.x * this.invCell);
    const maxCZ = Math.floor(col.max.z * this.invCell);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const k = this._key(cx, cz);
        let arr = this._cells.get(k);
        if (!arr) { arr = []; this._cells.set(k, arr); }
        arr.push(col);
      }
    }
  }

  remove(col) {
    const minCX = Math.floor(col.min.x * this.invCell);
    const minCZ = Math.floor(col.min.z * this.invCell);
    const maxCX = Math.floor(col.max.x * this.invCell);
    const maxCZ = Math.floor(col.max.z * this.invCell);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const k = this._key(cx, cz);
        const arr = this._cells.get(k);
        if (arr) {
          const idx = arr.indexOf(col);
          if (idx >= 0) arr.splice(idx, 1);
        }
      }
    }
  }

  queryAABB(x1, z1, x2, z2) {
    const minCX = Math.floor(x1 * this.invCell);
    const minCZ = Math.floor(z1 * this.invCell);
    const maxCX = Math.floor(x2 * this.invCell);
    const maxCZ = Math.floor(z2 * this.invCell);
    const seen = new Set();
    const out = [];
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const arr = this._cells.get(this._key(cx, cz));
        if (!arr) continue;
        for (const c of arr) {
          if (seen.has(c)) continue;
          seen.add(c);
          if (c.max.x >= x1 && c.min.x <= x2 && c.max.z >= z1 && c.min.z <= z2) out.push(c);
        }
      }
    }
    return out;
  }

  queryPoint(x, z, r = 0.4) {
    return this.queryAABB(x - r, z - r, x + r, z + r);
  }

  queryRadius(x, z, radius) {
    return this.queryAABB(x - radius, z - radius, x + radius, z + radius);
  }

  raycast(origin, dir, maxDist) {
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (len < 1e-8) return null;
    const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;

    let tmin = 0, tmax = maxDist;
    const invDX = 1 / (dx || 1e-12);
    const invDZ = 1 / (dz || 1e-12);

    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;

    let cx = Math.floor(origin.x * this.invCell);
    let cz = Math.floor(origin.z * this.invCell);
    const endCX = Math.floor((origin.x + dx * maxDist) * this.invCell);
    const endCZ = Math.floor((origin.z + dz * maxDist) * this.invCell);

    const seen = new Set();
    let best = null;

    let tMaxX = dx !== 0
      ? ((dx > 0 ? (cx + 1) : cx) * this.cellSize - origin.x) * invDX
      : Infinity;
    let tMaxZ = dz !== 0
      ? ((dz > 0 ? (cz + 1) : cz) * this.cellSize - origin.z) * invDZ
      : Infinity;

    const tDeltaX = dx !== 0 ? Math.abs(this.cellSize * invDX) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(this.cellSize * invDZ) : Infinity;

    const maxSteps = Math.abs(endCX - cx) + Math.abs(endCZ - cz) + 2;
    for (let i = 0; i < maxSteps && i < 500; i++) {
      const k = this._key(cx, cz);
      const arr = this._cells.get(k);
      if (arr) {
        for (const c of arr) {
          if (seen.has(c)) continue;
          seen.add(c);
          const hit = _rayAABB(origin, dx, dy, dz, c, maxDist);
          if (hit && (!best || hit.dist < best.dist)) best = hit;
        }
      }
      if (tMaxX < tMaxZ) {
        if (tMaxX > maxDist) break;
        cx += stepX; tMaxX += tDeltaX;
      } else {
        if (tMaxZ > maxDist) break;
        cz += stepZ; tMaxZ += tDeltaZ;
      }
    }
    return best;
  }

  losBlocked(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return false;
    const hit = this.raycast(a, { x: dx / len, y: dy / len, z: dz / len }, len);
    return hit !== null;
  }
}

function _rayAABB(o, dx, dy, dz, box, maxDist) {
  let tmin = 0, tmax = maxDist;
  const axes = [
    { d: dx, mn: box.min.x, mx: box.max.x, ox: o.x },
    { d: dy, mn: box.min.y, mx: box.max.y, oy: o.y },
    { d: dz, mn: box.min.z, mx: box.max.z, oz: o.z }
  ];
  let axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const { d, mn, mx, ...rest } = axes[i];
    const oVal = rest[Object.keys(rest)[0]];
    const inv = 1 / (d || 1e-12);
    let t0 = (mn - oVal) * inv;
    let t1 = (mx - oVal) * inv;
    let s = -1;
    if (inv < 0) { const tmp = t0; t0 = t1; t1 = tmp; s = 1; }
    if (t0 > tmin) { tmin = t0; axis = i; sign = s; }
    tmax = Math.min(tmax, t1);
    if (tmax < tmin) return null;
  }
  const t = tmin;
  if (t < 0 || t > maxDist) return null;
  const point = new THREE.Vector3(o.x + dx * t, o.y + dy * t, o.z + dz * t);
  const normal = new THREE.Vector3();
  if (axis === 0) normal.x = sign;
  else if (axis === 1) normal.y = sign;
  else normal.z = sign;
  return { dist: t, point, normal, _box: box };
}
