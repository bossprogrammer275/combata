// Asset: Apartment — full window grid + real 3D balconies on the front face.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installApartment(World) {
  World.prototype.apartment = function (x, z, ry = 0, w = 18, d = 12, floors = 3, solid = true, seed = 1) {
    const fh = 3.0, h = floors * fh;
    const t = 0.45, hw = w / 2, hd = d / 2;
    const mat = this.mPanel([172, 168, 158]);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, mat, solid, ry);
    // Front wall with door opening
    const doorW = 1.3;
    const leftW = (w - doorW) / 2;
    const FL = l2w(-hw + leftW / 2, hd);
    this.box(FL.x, 0, FL.z, leftW, h, t, mat, solid, ry);
    const FR = l2w(hw - leftW / 2, hd);
    this.box(FR.x, 0, FR.z, leftW, h, t, mat, solid, ry);
    // Lintel above door
    const lhx = 0, lhy = h - 0.6;
    this.box(l2w(lhx, hd).x, lhy, l2w(lhx, hd).z, doorW, 0.6, t, mat, false, ry);
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', 'z', '-z'], 'apartment', seed);
    // balconies on the front (+z) face — one per floor, flush with floor level
    const balconyMat = this.mConcrete([150, 148, 145]);
    const railMat = this.mMetal();
    const nCols = Math.max(2, Math.floor(w / 3.2));
    const cellW = w / nCols;
    const balconyD = 1.2;
    for (let f = 0; f < floors; f++) {
      const fy = f * fh;
      for (let c = 0; c < nCols; c++) {
        const lx = -hw + (c + 0.5) * cellW;
        // balcony slab — extends outward from the wall face
        const p = l2w(lx, hd + balconyD / 2);
        this.box(p.x, fy, p.z, cellW * 0.85, 0.14, balconyD, balconyMat, false, ry);
        // front rail
        const fr = l2w(lx, hd + balconyD);
        this.box(fr.x, fy + 0.14, fr.z, cellW * 0.85, 0.9, 0.05, railMat, false, ry);
        // side rails
        const sl = l2w(lx - cellW * 0.42, hd + balconyD / 2);
        this.box(sl.x, fy + 0.14, sl.z, 0.05, 0.9, balconyD, railMat, false, ry);
        const sr = l2w(lx + cellW * 0.42, hd + balconyD / 2);
        this.box(sr.x, fy + 0.14, sr.z, 0.05, 0.9, balconyD, railMat, false, ry);
      }
    }
    this._facadeDoor(x, z, w, d, ry, 1.3, this.mDoor([96, 66, 44]));
    this.box(x, h, z, w + .4, .35, d + .4, this.mRoof(), solid, ry);
    this.roofProps(x, z, ry, w, d, h + 0.4);
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2));
    if (solid) this.addRoof(x, z, h + 0.35, hw, hd);
    this.namedLocations.push({ x, z, name: 'APARTMENTS', color: '#ffd24a' });
  };
}
