// Asset: Supermarket — big-box retail with a full glass storefront + roof units.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installSupermarket(World) {
  World.prototype.supermarket = function (x, z, ry = 0, w = 36, d = 24, h = 6, solid = true, seed = 1) {
    const t = 0.5, hw = w / 2, hd = d / 2;
    const mat = this.mPanel([170, 168, 162]);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, mat, solid, ry);
    // Front wall with door opening
    const doorW = 2.0;
    const leftW = (w - doorW) / 2;
    const FL = l2w(-hw + leftW / 2, hd);
    this.box(FL.x, 0, FL.z, leftW, h, t, mat, solid, ry);
    const FR = l2w(hw - leftW / 2, hd);
    this.box(FR.x, 0, FR.z, leftW, h, t, mat, solid, ry);
    // Lintel above door
    const lhx = 0, lhy = h - 0.6;
    this.box(l2w(lhx, hd).x, lhy, l2w(lhx, hd).z, w, 0.6, t, mat, false, ry);
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', '-z'], 'industrial', seed);
    // storefront glass on the front face
    const stex = TEX.makeStorefrontTexture(w, h, seed + 9);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.04, h + 0.04), new THREE.MeshStandardMaterial({ map: stex, roughness: .15, metalness: .3 }));
    const pos = l2w(0, hd + 0.05);
    m.position.set(pos.x, h / 2, pos.z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    this.group.add(m);
    // entrance canopy
    const awningMat = new THREE.MeshStandardMaterial({ color: 0x2a6f9a, roughness: .7 });
    const awnPos = l2w(0, hd + 3);
    const awn = new THREE.Mesh(new THREE.BoxGeometry(6, .2, 4.4), awningMat);
    awn.position.set(awnPos.x, h * .5, awnPos.z);
    awn.rotation.y = ry;
    awn.castShadow = true;
    this.group.add(awn);
    for (const [lx, lz] of [[-2.4, 0], [2.4, 0]]) {
      const pp = l2w(lx, hd + 2);
      this.box(pp.x, 0, pp.z, .3, h * .5, .3, this.mMetal(), solid, ry);
    }
    this.box(x, h, z, w + .4, .35, d + .4, this.mRoof(), solid, ry);
    // row of AC units on roof
    const roofMat = this.mMetal();
    for (let i = 0; i < 5; i++) {
      const lx = -w * 0.35 + i * (w * 0.7 / 4);
      const ap = l2w(lx, -d * 0.28);
      this.box(ap.x, h + 0.1, ap.z, 1.6, 1.0, 1.6, roofMat, false, ry);
    }
    this.roofProps(x, z, ry, w, d, h + 0.4);
    this._facadeDoor(x, z, w, d, ry, 2.0, this.mDoor([140, 140, 140]));
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2));
    this.namedLocations.push({ x, z, name: 'SUPERMARKET', color: '#ffd24a' });
  };
}
