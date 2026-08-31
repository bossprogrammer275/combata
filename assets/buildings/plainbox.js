// Asset: Plainbox — plain box built from wall strips so ry gets tight per-wall AABBs.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installPlainbox(World) {
  World.prototype.plainbox = function (x, z, ry, w, h, d, mat, solid, doorW, style, seed, roofMat, b) {
    // plain box — build from wall strips so ry gets tight per-wall AABBs
    const t = Math.min(w, d) * 0.08, hw = w / 2, hd = d / 2;
    const dw = b.doorW || 1.2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const B = l2w(0, -hd); this.box(B.x, 0, B.z, w, h, t, mat, solid, ry);
    const L = l2w(-hw, 0); this.box(L.x, 0, L.z, t, h, d, mat, solid, ry);
    const R = l2w(hw, 0); this.box(R.x, 0, R.z, t, h, d, mat, solid, ry);
    if (b.windows) {
      const sideW = (w - dw) / 2;
      const FL = l2w(-hw + sideW / 2, hd); this.box(FL.x, 0, FL.z, sideW, h, t, mat, solid, ry);
      const FR = l2w(hw - sideW / 2, hd); this.box(FR.x, 0, FR.z, sideW, h, t, mat, solid, ry);
    } else {
      const F = l2w(0, hd); this.box(F.x, 0, F.z, w, h, t, mat, solid, ry);
    }
    if (b.roof) this.box(x, h, z, w + .3, .35, d + .3, roofMat, solid, ry);
    if (b.roofAccess) this.addRoof(x, z, h + 0.35, hw, hd);
    if (b.enterable) this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2));
    if (b.windows) {
      this._sceneWindows(x, z, w, h, d, ry, ['x', '-x', '-z'], style, { seed, door: { w: dw } });
    }
    if (b.roofAccess || b.roof) this.roofProps(x, z, ry, w, d, b.roof ? h + 0.4 : h + 0.05);
  };
}
