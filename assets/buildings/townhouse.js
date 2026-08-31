// Asset: Townhouse — narrow three floors, stoop, shallow bay window, parapet roof.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installTownhouse(World) {
  World.prototype.townhouse = function (x, z, ry = 0, w = 9, d = 9, h = 8.5, solid = true, seed = 1) {
    const t = 0.45, hw = w / 2, hd = d / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const mat = this.mBrick([158, 100, 82]);
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, mat, solid, ry);
    // Front wall with door opening
    const doorW = 1.1;
    const offX = -0.4;
    const leftW = (w - doorW) / 2 + offX;
    const rightW = (w - doorW) / 2 - offX;
    const FL = l2w(-hw + leftW / 2, hd);
    this.box(FL.x, 0, FL.z, leftW, h, t, mat, solid, ry);
    const FR = l2w(hw - rightW / 2, hd);
    this.box(FR.x, 0, FR.z, rightW, h, t, mat, solid, ry);
    // Lintel above door
    const lhx = offX, lhy = h - 0.6;
    this.box(l2w(lhx, hd).x, lhy, l2w(lhx, hd).z, doorW, 0.6, t, mat, false, ry);
    // bay window on the front face (three narrow panes proud of the wall)
    const bayW = 2.6, bayH = h * 0.62, bayY = h * 0.14;
    for (const bdx of [-bayW / 2, 0, bayW / 2]) {
      const bp = l2w(bdx, hd + 0.32);
      this.box(bp.x, bayY, bp.z, bayW * 0.34, bayH, 0.5, mat, solid, ry);
      this.box(bp.x, bayY + 0.03, bp.z, bayW * 0.3, bayH - 0.06, 0.46, this.mGlass(), false, ry);
    }
    // window band above the bay
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', 'z'], 'tenement', seed);
    // stoop: steps + small platform
    for (let i = 0; i < 3; i++) {
      const s = l2w(-0.4, hd + 0.5 + i * 0.4);
      this.box(s.x, i * 0.15, s.z, 2.2 - i * 0.3, 0.15, 0.5, this.mConcrete([150, 148, 145]), solid, ry);
    }
    this._facadeDoor(x, z, w, d, ry, 1.1, this.mDoor([96, 66, 44]), -0.4);
    // parapet roof with a chimney
    this.box(x, h, z, w + .4, .35, d + .4, this.mRoof(), solid, ry);
    this.roofProps(x, z, ry, w, d, h + 0.4);
    const chp = l2w(w * 0.28, -d * 0.2);
    this.box(chp.x, h + 0.15, chp.z, .7, 1.3, .7, this.mBrick([130, 72, 56]), solid, ry);
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2));
    this.namedLocations.push({ x, z, name: 'TOWNHOUSE', color: '#ffd24a' });
  };
}
