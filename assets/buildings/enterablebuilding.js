// Asset: Enterablebuilding — hollow enterable building with door opening + interior clutter.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installEnterableBuilding(World) {
  World.prototype.enterableBuilding = function (x, z, w, h, d, mat, ry = 0, solid = false) {
    const t = 0.5, doorW = 2.6, hw = w / 2, hd = d / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const roofMat = this.mRoof();
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, mat, solid, ry);
    const sideW = (w - doorW) / 2;
    this.box(l2w(-hw + sideW / 2, hd).x, 0, l2w(-hw + sideW / 2, hd).z, sideW, h, t, mat, solid, ry);
    this.box(l2w(hw - sideW / 2, hd).x, 0, l2w(hw - sideW / 2, hd).z, sideW, h, t, mat, solid, ry);
    this.box(x, h, z, w + .4, .35, d + .4, roofMat, solid, ry);
    this.box(x, 0, z, w - t * 2, .2, d - t * 2, new THREE.MeshStandardMaterial({ map: TEX.makeConcreteTexture(512, [130, 128, 124]), roughness: .95 }), false, ry);
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', '-z'], 'tenement', 11);
    this._facadeDoor(x, z, w, d, ry, 1.4, this.mDoor([96, 66, 44]));
    const lint = l2w(0, hd + 0.02);
    this.box(lint.x, h * 0.62, lint.z, doorW + 0.4, h * 0.3, t, mat, solid, ry);
    this.roofProps(x, z, ry, w, d, h + 0.4);
    // interior clutter (solid, not ruined)
    const cl1 = l2w(w * .2, -d * .2);
    this.box(cl1.x, .2, cl1.z, 1.4, 1.4, 1.4, this.mCrate(), solid, ry, false, 'fire');
    const cl2 = l2w(-w * .25, d * .1);
    this.climbBox(cl2.x, .2, cl2.z, 1.6, 1.0, 1.0, this.mWood(), ry);
    const cl3 = l2w(-w * .1, d * .25);
    this.box(cl3.x, .2, cl3.z, 2.0, .9, .8, this.mMetal(), solid, ry);
    this.addRoof(x, z, h + 0.35, hw, hd);
    const rp = l2w(0, -hd);
    this.climbBox(rp.x, h + .35, rp.z, w, .5, .3, this.mMetal(), ry);
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.coverPoints.push(new THREE.Vector3(x + sn * 2, 0, z + cs * 2));
  };
}
