// Asset: School — solid brick walls, entrance bay with canopy, flagpole, playground hoop.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installSchool(World) {
  World.prototype.school = function (x, z, ry = 0, w = 24, d = 16, h = 7.5, solid = true, seed = 1) {
    const t = 0.45, hw = w / 2, hd = d / 2;
    const mat = this.mBrick([168, 120, 92]);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    // back wall — full width, full height
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    // left wall — full depth, full height
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    // right wall — full depth, full height
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, mat, solid, ry);

    // front wall — split for door opening (2.4 wide, 3.2 tall)
    const doorW = 2.4, doorH = 3.2, lintelH = h - doorH;
    const sideW = (w - doorW) / 2;
    // left segment
    this.box(l2w(-hw + sideW / 2, hd).x, 0, l2w(-hw + sideW / 2, hd).z, sideW, h, t, mat, solid, ry);
    // right segment
    this.box(l2w(hw - sideW / 2, hd).x, 0, l2w(hw - sideW / 2, hd).z, sideW, h, t, mat, solid, ry);
    // lintel above door
    this.box(l2w(0, hd).x, doorH, l2w(0, hd).z, doorW, lintelH, t, mat, false, ry);

    // entrance bay — slight protrusion at front center
    const bayW = 4.8, bayD = 2.0, bayH = h;
    const bp = l2w(0, hd + bayD / 2);
    this.box(bp.x, 0, bp.z, bayW, bayH, bayD, mat, solid, ry);
    this._applyFacade(bp.x, bp.z, bayW, bayH, bayD, ry, ['z'], 'tenement', seed + 9);

    // double doors
    this._facadeDoor(x, z, w, d, ry, doorW, this.mDoor([92, 70, 46]));

    // entrance canopy — metal over the door
    const canopyMat = this.mMetal();
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.16, 2.2), canopyMat);
    const cpos = l2w(0, hd + bayD + 0.8);
    canopy.position.set(cpos.x, 3.1, cpos.z);
    canopy.rotation.y = ry;
    canopy.castShadow = true;
    this.group.add(canopy);
    // canopy support posts
    for (const cx of [-2.2, 2.2]) {
      const cp = l2w(cx, hd + bayD + 0.4);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.1, 12), canopyMat);
      post.position.set(cp.x, 1.55, cp.z);
      this.group.add(post);
    }

    // facade textures on remaining walls — tenement style
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', '-z'], 'tenement', seed);

    // flat roof with parapet
    this.box(x, h, z, w + 0.4, 0.35, d + 0.4, this.mRoof(), solid, ry);

    // flagpole on roof
    const fp = l2w(w * 0.28, -hd * 0.55);
    const poleH = 6;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, poleH, 12), this.mMetal());
    pole.position.set(fp.x, h + poleH / 2, fp.z);
    pole.castShadow = true;
    this.group.add(pole);
    // flag
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.8, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.8 })
    );
    const fpos = l2w(w * 0.28, -hd * 0.55 + 0.7);
    flag.position.set(fpos.x, h + poleH - 0.5, fpos.z);
    flag.rotation.y = ry;
    this.group.add(flag);
    // flagpole concrete base
    this.box(fp.x, 0, fp.z, 0.8, 0.35, 0.8, this.mConcrete([150, 148, 145]), solid, ry);

    // playground basketball hoop near the building
    const hoopPos = l2w(hw + 2.0, hd - 3);
    const backboard = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.9, 0.06),
      this.mMetal()
    );
    backboard.position.set(hoopPos.x, 3.6, hoopPos.z);
    backboard.rotation.y = ry;
    this.group.add(backboard);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.23, 0.025, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0xff5500, roughness: 0.4, metalness: 0.6 })
    );
    rim.position.set(hoopPos.x, 3.05, hoopPos.z + 0.3);
    rim.rotation.x = -Math.PI / 2;
    this.group.add(rim);
    const hoopPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 3, 8),
      this.mMetal()
    );
    hoopPost.position.set(hoopPos.x, 1.5, hoopPos.z);
    this.group.add(hoopPost);

    // school sign near entrance
    const signPos = l2w(hw - 3.5, hd + 1.8);
    const signFace = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 1.0, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.8 })
    );
    signFace.position.set(signPos.x, 2.2, signPos.z);
    signFace.rotation.y = ry;
    this.group.add(signFace);
    for (const sx of [-1.2, 1.2]) {
      const sp = l2w(hw - 3.5 + sx, hd + 1.6);
      const signPost = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8),
        this.mMetal()
      );
      signPost.position.set(sp.x, 1.1, sp.z);
      this.group.add(signPost);
    }

    this.roofProps(x, z, ry, w, d, h + 0.4);
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2));
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.namedLocations.push({ x, z, name: 'SCHOOL', color: '#ffd24a' });
  };
}
