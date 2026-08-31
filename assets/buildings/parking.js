// Asset: Parking — open levels of slabs + columns + slat facades.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installParking(World) {
  World.prototype.parking = function (x, z, ry = 0, w = 24, d = 20, levels = 3, solid = true, seed = 1) {
    const lh = 2.7, h = levels * lh;
    const t = 0.35, hw = w / 2, hd = d / 2;
    const mat = this.mConcrete([150, 148, 144]);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    // perimeter walls with openings (facade covers them)
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, mat, solid, ry);
    this.box(l2w(0, hd).x, 0, l2w(0, hd).z, w, h, t, mat, solid, ry);
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', 'z', '-z'], 'parking', seed);
    // slabs at each level (visual + interior)
    for (let l = 1; l <= levels; l++) {
      this.box(x, l * lh, z, w - t * 2, .25, d - t * 2, mat, false, ry);
      if (l < levels) {
        this.box(x, l * lh + .35, z, w - t * 2, .3, d - t * 2, mat, false, ry);
      }
    }
    // columns
    for (let ix = 0; ix <= 4; ix++) for (let iz = 0; iz <= 4; iz++) {
      if (ix > 0 && ix < 4 && iz > 0 && iz < 4) continue;
      const lx = -hw + ix * (w / 4), lz = -hd + iz * (d / 4);
      const pp = l2w(lx, lz);
      this.box(pp.x, 0, pp.z, .5, h, .5, mat, solid, ry);
    }
    // ramp (decorative sloped box)
    const rp = l2w(0, 0);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(3.4, .2, d * 0.4), this.mConcrete([140, 138, 134]));
    ramp.position.set(rp.x, 1.4, rp.z);
    ramp.rotation.y = ry; ramp.rotation.x = 0.06;
    ramp.castShadow = true;
    this.group.add(ramp);
    this.coverPoints.push(new THREE.Vector3(x, h, z));
    this.addRoof(x, z, h + 0.1, hw, hd);
    this.namedLocations.push({ x, z, name: 'PARKING', color: '#9affb0' });
  };
}
