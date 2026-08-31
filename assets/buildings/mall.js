// Asset: Mall — long two-story retail block with glazed entrance + roof vents.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installMall(World) {
  World.prototype.mall = function (x, z, ry = 0, w = 40, d = 20, h = 8.5, solid = true, seed = 1) {
    const t = 0.5, hw = w / 2, hd = d / 2;
    const mat = this.mPanel([182, 180, 174]);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, mat, solid, ry);
    // Front wall with door opening
    const doorW = 2.2;
    const leftW = (w - doorW) / 2;
    const FL = l2w(-hw + leftW / 2, hd);
    this.box(FL.x, 0, FL.z, leftW, h, t, mat, solid, ry);
    const FR = l2w(hw - leftW / 2, hd);
    this.box(FR.x, 0, FR.z, leftW, h, t, mat, solid, ry);
    // Lintel above door
    const lhx = 0, lhy = h - 0.6;
    this.box(l2w(lhx, hd).x, lhy, l2w(lhx, hd).z, w, 0.6, t, mat, false, ry);
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', '-z'], 'office', seed);
    // glazed entrance atrium
    const ep = l2w(0, hd);
    const glMat = this.mGlass();
    const atrium = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 1.2), glMat);
    const apos = l2w(0, hd + .6); atrium.position.set(apos.x, 2.5, apos.z); atrium.rotation.y = ry; atrium.castShadow = true; this.group.add(atrium);
    for (const px of [-3.5, 3.5]) {
      const pp = l2w(px, hd + .6);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 5, 12), this.mMetal());
      post.position.set(pp.x, 2.5, pp.z); this.group.add(post);
    }
    this._facadeDoor(x, z, w, d, ry, 2.2, this.mDoor([70, 74, 80]));
    // sign band
    const sb = new THREE.Mesh(new THREE.BoxGeometry(12, 1.0, .1), new THREE.MeshStandardMaterial({ color: 0x2c3a4c, roughness: .8 }));
    const sbp = l2w(0, hd + .5); sb.position.set(sbp.x, h - .55, sbp.z); sb.rotation.y = ry; this.group.add(sb);
    this.box(x, h, z, w + .4, .35, d + .4, this.mRoof(), solid, ry);
    // roof vents
    for (let i = 0; i < 5; i++) {
      const vp = l2w(-w / 2 + (i + 0.5) * (w / 5), 0);
      this.box(vp.x, h + .35, vp.z, 2.2, 1.1, 1.6, this.mMetal(), solid, ry);
    }
    this.roofProps(x, z, ry, w, d, h + 0.4);
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2));
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.namedLocations.push({ x, z, name: 'MALL', color: '#ffd24a' });
  };
}
