// Asset: Firestation — two bays with roller doors + crew quarters above.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installFirestation(World) {
  World.prototype.firestation = function (x, z, ry = 0, solid = true, seed = 1) {
    const t = 0.5, w = 18, d = 13, h = 5.2;
    const hw = w / 2, hd = d / 2;
    const mat = this.mBrick([162, 96, 78]);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, mat, solid, ry);
    const bayW = 5, sideW = (w - bayW * 3) / 4;
    for (let i = 0; i < 3; i++) {
      const bx = -hw + (i + 1) * sideW + (i + .5) * bayW;
      this.box(l2w(bx, hd).x, 0, l2w(bx, hd).z, bayW, h, t, mat, solid, ry);
    }
    // three roller doors (slightly recessed in the front face)
    for (let i = 0; i < 3; i++) {
      const bx = -hw + (i + 1) * sideW + (i + .5) * bayW;
      this._facadeDoor(l2w(bx, hd - 0.4).x, l2w(bx, hd - 0.4).z, bayW, 0.4, ry, 2.0, this.mRoller(), 0);
    }
    // red band above doors
    const band = new THREE.Mesh(new THREE.BoxGeometry(w - 1, .5, .1), new THREE.MeshStandardMaterial({ color: 0xa83228, roughness: .7 }));
    const bpos = l2w(0, hd + .4); band.position.set(bpos.x, h - .8, bpos.z); band.rotation.y = ry; this.group.add(band);
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', '-z'], 'tenement', seed);
    // apparatus bay door on the side wall (+x face)
    const sideDoorP = l2w(hw, -hd * 0.3);
    this._facadeDoor(sideDoorP.x, sideDoorP.z, 4.2, 0.2, ry + Math.PI / 2, 2.0, this.mRoller(), 0);
    this.box(x, h, z, w + .4, .35, d + .4, this.mRoof(), solid, ry);
    this.roofProps(x, z, ry, w, d, h + 0.4);
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2));
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.namedLocations.push({ x, z, name: 'FIRE STATION', color: '#ffd24a' });
  };
}
