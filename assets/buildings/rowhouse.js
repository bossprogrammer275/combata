// Asset: Rowhouse — several attached townhouses sharing one block, repeated doors.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installRowhouse(World) {
  World.prototype.rowhouse = function (x, z, ry = 0, w = 24, d = 8, h = 6.5, solid = true, seed = 1) {
    const t = 0.4, hw = w / 2, hd = d / 2;
    const mat = this.mBrick([158, 100, 82]);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const units = Math.max(2, Math.round(w / 6));
    const unitW = w / units;
    const doorW = 1.0, sideW = (unitW - doorW) / 2;
    // back wall
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    // side walls
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, mat, solid, ry);
    // front wall: split into segments per unit with door gaps
    for (let u = 0; u < units; u++) {
      const ux = -hw + (u + 0.5) * unitW;
      // left segment
      const fl = l2w(ux - unitW / 2 + sideW / 2, hd);
      this.box(fl.x, 0, fl.z, sideW, h, t, mat, solid, ry);
      // right segment
      const fr = l2w(ux + unitW / 2 - sideW / 2, hd);
      this.box(fr.x, 0, fr.z, sideW, h, t, mat, solid, ry);
    }
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', '-z'], 'tenement', seed);
    this._applyFacade(x, z, w, h, d, ry, ['z'], 'tenement', seed + 7);
    for (let u = 0; u < units; u++) {
      const ux = -hw + (u + 0.5) * (w / units);
      const dx = x + ux * cs, dz = z - ux * sn;
      this._facadeDoor(dx, dz, w, d, ry, 1.0, this.mDoor([96, 66, 44]));
      // stoop
      this.box(dx + sn * (hd + 0.5), 0, dz + cs * (hd + 0.5), 1.4, 0.22, 0.7, this.mConcrete([150, 148, 145]), solid, ry);
    }
    this.box(x, h, z, w + .4, .35, d + .4, this.mRoof(), solid, ry);
    // chimneys per unit
    for (let u = 0; u < units; u++) {
      const ux = -hw + (u + 0.5) * (w / units);
      const chx = x + (ux * cs + d * 0.28 * sn), chz = z - ux * sn + d * 0.28 * cs;
      this.box(chx, h + 0.2, chz, 0.7, 1.0, 0.7, this.mBrick([130, 72, 56]), solid, ry);
    }
    this.roofProps(x, z, ry, w, d, h + 0.4);
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2));
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.namedLocations.push({ x, z, name: 'ROW HOUSES', color: '#ffd24a' });
  };
}
