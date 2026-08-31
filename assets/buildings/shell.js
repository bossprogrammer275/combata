// Asset: Shell — hollow shell with optional windows/door opening.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installShell(World) {
  World.prototype.shell = function (x, z, ry, w, h, d, mat, solid, doorW, style, seed, roofMat, b) {
    const t = 0.5, hw = w / 2, hd = d / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const sideW = (w - doorW) / 2;
    const B = l2w(0, -hd); this.box(B.x, 0, B.z, w, h, t, mat, solid, ry);
    const L = l2w(-hw, 0); this.box(L.x, 0, L.z, t, h, d, mat, solid, ry);
    const R = l2w(hw, 0); this.box(R.x, 0, R.z, t, h, d, mat, solid, ry);
    const FL = l2w(-hw + sideW / 2, hd); this.box(FL.x, 0, FL.z, sideW, h, t, mat, solid, ry);
    const FR = l2w(hw - sideW / 2, hd); this.box(FR.x, 0, FR.z, sideW, h, t, mat, solid, ry);
    this.box(x, h, z, w + .4, .35, d + .4, roofMat, solid, ry);
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2));
    if (b.roofAccess) this.addRoof(x, z, h + 0.35, hw, hd);
    if (b.windows) {
      this._sceneWindows(x, z, w, h, d, ry, ['x', '-x', '-z'], style, { seed, door: { w: doorW, mat: b.doorM ? this._sceneMat(b.doorM) : null } });
    }
    this.namedLocations.push({ x, z, name: 'SHELL', color: '#ffd24a' });
  };
}
