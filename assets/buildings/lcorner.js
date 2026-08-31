// Asset: Lcorner — L-shaped building wrapping a street corner, two wings.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installLcorner(World) {
  World.prototype.lcorner = function (x, z, ry = 0, w = 22, d = 16, wing = 10, h = 8, solid = true, seed = 1) {
    const t = 0.45;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const mat = this.mBrick([150, 94, 76]);
    const wingBz = Math.min(wing, d);
    // Wing A: x in [0, w], z in [0, d]
    const A = l2w(w / 2, d / 2);
    this.box(A.x, 0, A.z, w, h, d, mat, solid, ry);
    this._applyFacade(A.x, A.z, w, h, d, ry, ['x', '-x', 'z', '-z'], 'tenement', seed);
    // Wing B: x in [w - wing, w], z in [d, d + wingBz] (shares the corner)
    const cxx = l2w(w - wing, d);
    const B = l2w(w - wing / 2, d + wingBz / 2);
    this.box(B.x, 0, B.z, wing, h, wingBz, mat, solid, ry);
    this._applyFacade(B.x, B.z, wing, h, wingBz, ry, ['x', '-x', 'z', '-z'], 'tenement', seed + 5);
    // corner entry door on the inside face
    this._facadeDoor(cxx.x, cxx.z, wing, wingBz, ry, 1.2, this.mDoor([100, 70, 48]));
    this.box(A.x, h, A.z, w + .4, .35, d + .4, this.mRoof(), solid, ry);
    this.box(B.x, h, B.z, wing + .3, .35, wingBz + .3, this.mRoof(), solid, ry);
    this.roofProps(A.x, A.z, ry, w, d, h + 0.4);
    this.coverPoints.push(new THREE.Vector3(cxx.x + sn * 2, 0, cxx.z + cs * 2));
    this.namedLocations.push({ x, z, name: 'L-CORNER', color: '#ffd24a' });
  };
}
