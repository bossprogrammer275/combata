// Asset: Gasstation — kiosk shop + fuel canopy + pump islands.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installGasstation(World) {
  World.prototype.gasstation = function (x, z, ry = 0, solid = true, seed = 1) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const kioskW = 9, kioskD = 6, kioskH = 3.6;
    const kp = l2w(0, 6);
    // kiosk building
    const km = this.mPanel([176, 170, 158]);
    this.box(kp.x, 0, kp.z, kioskW, kioskH, kioskD, km, solid, ry);
    this._applyFacade(kp.x, kp.z, kioskW, kioskH, kioskD, ry, ['x', '-x', 'z', '-z'], 'tenement', seed + 3);
    const kc = l2w(0, 6 + kioskD / 2);
    this._facadeDoor(kp.x, kp.z, kioskW, kioskD, ry, 1.2, this.mDoor([110, 110, 116]));
    this.box(kp.x, kioskH, kp.z, kioskW + .3, .3, kioskD + .3, this.mRoof(), solid, ry);
    this.roofProps(kp.x, kp.z, ry, kioskW, kioskD, kioskH + 0.35);
    // canopy: slab on 4 posts
    const canopyW = 14, canopyD = 8, ch = 3.1;
    const capMat = this.mMetal();
    const cp = l2w(0, -2);
    for (const [lx, lz] of [[-canopyW / 2 + 0.6, -canopyD / 2 + 0.6], [canopyW / 2 - 0.6, -canopyD / 2 + 0.6], [-canopyW / 2 + 0.6, canopyD / 2 - 0.6], [canopyW / 2 - 0.6, canopyD / 2 - 0.6]]) {
      const pp = l2w(lx, lz - 2);
      this.box(pp.x, 0, pp.z, 0.35, ch, 0.35, capMat, solid, ry);
    }
    const cs2 = l2w(0, -2);
    this.box(cs2.x, ch, cs2.z, canopyW, .22, canopyD, capMat, false, ry);
    this.climbBox(cs2.x, ch + 0.22, cs2.z - canopyD / 2 + 0.4, 4, .4, 2, this.mMetal(), ry);
    // pump islands
    for (const [lx, lz] of [[-2, -4], [2, -4]]) {
      const pumpP = l2w(lx, lz);
      const pump = new THREE.Mesh(new THREE.BoxGeometry(.9, 1.3, .5), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: .5, metalness: .3 }));
      pump.position.set(pumpP.x, .65, pumpP.z);
      pump.rotation.y = ry;
      pump.castShadow = true;
      this.group.add(pump);
      const disp = new THREE.Mesh(new THREE.BoxGeometry(.8, .4, .08), new THREE.MeshBasicMaterial({ color: 0x22262c }));
      disp.position.set(pumpP.x + sn * .3, 1.1, pumpP.z + cs * .3);
      this.group.add(disp);
    }
    // pad
    this._planeBatch.push({ x, y: 0.02, z, rx: -Math.PI / 2, ry: 0, rz: -ry, mat: this.mSidewalk(), w: 24, h: 20 });
    this.coverPoints.push(this.frontPoint(x, z, ry, 2));
    this.namedLocations.push({ x, z, name: 'GAS STATION', color: '#ffd24a' });
  };
}
