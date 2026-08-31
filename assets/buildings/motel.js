// Asset: Motel — two long wings around a central courtyard, exterior corridors.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installMotel(World) {
  World.prototype.motel = function (x, z, ry = 0, w = 26, d = 20, solid = true, seed = 1) {
    const t = 0.45, wingD = 7, h = 6.5;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const mat = this.mPanel([168, 164, 156]);
    // north wing (local z = -d/2)
    const nw = l2w(0, -d / 2 + wingD / 2);
    this.box(nw.x, 0, nw.z, w, h, wingD, mat, solid, ry);
    this._applyFacade(nw.x, nw.z, w, h, wingD, ry, ['x', '-x', 'z', '-z'], 'apartment', seed);
    // south wing
    const sw2 = l2w(0, d / 2 - wingD / 2);
    this.box(sw2.x, 0, sw2.z, w, h, wingD, mat, solid, ry);
    this._applyFacade(sw2.x, sw2.z, w, h, wingD, ry, ['x', '-x', 'z', '-z'], 'apartment', seed + 3);
    // connecting wing on -x side
    const cw = l2w(-w / 2 + wingD / 2, 0);
    this.box(cw.x, 0, cw.z, wingD, h, d - wingD * 2, mat, solid, ry);
    this._applyFacade(cw.x, cw.z, wingD, h, d - wingD * 2, ry, ['-x'], 'apartment', seed + 6);
    // courtyard-facing doors on the inner faces
    const doors = Math.max(2, Math.round(w / 4));
    for (let u = 0; u < doors; u++) {
      const offX = -w / 2 + (u + 0.5) * (w / doors);
      this._facadeDoor(nw.x, nw.z, w, wingD, ry, 1.0, this.mDoor([120, 88, 58]), offX);
      this._facadeDoor(sw2.x, sw2.z, w, wingD, ry + Math.PI, 1.0, this.mDoor([120, 88, 58]), -offX);
    }
    this.box(nw.x, h, nw.z, w + .4, .35, wingD + .4, this.mRoof(), solid, ry);
    this.roofProps(nw.x, nw.z, ry, w, wingD, h + 0.4);
    this.box(sw2.x, h, sw2.z, w + .4, .35, wingD + .4, this.mRoof(), solid, ry);
    this.roofProps(sw2.x, sw2.z, ry, w, wingD, h + 0.4);
    this.coverPoints.push(this.frontPoint(x, z, ry, d / 2 + 2));
    this.namedLocations.push({ x, z, name: 'MOTEL', color: '#8ab4ff' });
  };
}
