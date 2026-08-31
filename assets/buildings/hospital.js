// Asset: Hospital — long panel block, entrance canopy, rooftop medical cross.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installHospital(World) {
  World.prototype.hospital = function (x, z, ry = 0, w = 26, d = 18, h = 9, solid = true, seed = 1) {
    const t = 0.5, hw = w / 2, hd = d / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const mat = this.mPanel([188, 186, 180]);
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, mat, solid, ry);
    // Front wall with door opening
    const doorW = 2.4;
    const leftW = (w - doorW) / 2;
    const FL = l2w(-hw + leftW / 2, hd);
    this.box(FL.x, 0, FL.z, leftW, h, t, mat, solid, ry);
    const FR = l2w(hw - leftW / 2, hd);
    this.box(FR.x, 0, FR.z, leftW, h, t, mat, solid, ry);
    // Lintel above door
    const lhx = 0, lhy = h - 0.6;
    this.box(l2w(lhx, hd).x, lhy, l2w(lhx, hd).z, w, 0.6, t, mat, false, ry);
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', 'z', '-z'], 'apartment', seed);
    // entrance canopy on the front face
    const ep = l2w(0, hd + 1.2);
    this.box(ep.x, 3.1, ep.z, 7, .18, 2.4, this.mMetal(), false, ry);
    for (const px of [-2.6, 2.6]) {
      const cp = l2w(px, hd + 1.2);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, 3.1, 12), this.mMetal());
      post.position.set(cp.x, 1.55, cp.z);
      post.castShadow = true;
      this.group.add(post);
    }
    this.box(ep.x + 0.4 * sn, 5.4, ep.z + 0.4 * cs, 4.6, .5, .14, this.mMetal(), false, ry);
    // emergency-light beacon band above the door
    this.box(ep.x + 0.4 * sn, 6.3, ep.z + 0.4 * cs, 4.6, .12, .12, this.mMetal(), false, ry);
    // rooftop tower with a green medical cross
    const tr = l2w(w * 0.28, -hd * 0.35);
    const t2 = this.mConcrete([160, 158, 154]);
    this.box(tr.x, h, tr.z, 3, 2.2, 3, t2, solid, ry);
    const crossMat = new THREE.MeshStandardMaterial({ color: 0x1fae5a, emissive: 0x0c6b34, emissiveIntensity: .4 });
    const cv = new THREE.Mesh(new THREE.BoxGeometry(1.9, .55, .55), crossMat);
    cv.position.set(tr.x, h + 2.6, tr.z);
    this.group.add(cv);
    const ch = new THREE.Mesh(new THREE.BoxGeometry(.55, 1.9, .55), crossMat);
    ch.position.set(tr.x, h + 2.6, tr.z);
    this.group.add(ch);
    // roof slab
    this.box(x, h, z, w + .4, .35, d + .4, this.mRoof(), solid, ry);
    this.roofProps(x, z, ry, w, d, h + 0.4);
    this._facadeDoor(x, z, w, d, ry, 2.4, this.mDoor([150, 150, 150]));
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2.5));
    this.namedLocations.push({ x, z, name: 'HOSPITAL', color: '#8affc0' });
  };
}
