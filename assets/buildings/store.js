// Asset: Store — corner store: storefront below, apartment above, side gable roof.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installStore(World) {
  World.prototype.store = function (x, z, ry = 0, w = 11, d = 12, h = 5.5, solid = true, seed = 1) {
    const t = 0.4, hw = w / 2, hd = d / 2;
    const mat = this.mBrick([176, 112, 86]);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, mat, solid, ry);
    // Front wall with door opening
    const doorW = 1.2;
    const leftW = (w - doorW) / 2;
    const FL = l2w(-hw + leftW / 2, hd);
    this.box(FL.x, 0, FL.z, leftW, h, t, mat, solid, ry);
    const FR = l2w(hw - leftW / 2, hd);
    this.box(FR.x, 0, FR.z, leftW, h, t, mat, solid, ry);
    // Lintel above door
    const lhx = 0, lhy = h - 0.6;
    this.box(l2w(lhx, hd).x, lhy, l2w(lhx, hd).z, doorW, 0.6, t, mat, false, ry);
    // storefront (front face) + upper windows (sides)
    const seedI = (Math.abs(x) * 7 + Math.abs(z) * 13 + seed * 131) | 0;
    const front = l2w(0, hd + .04);
    const storeTex = TEX.makeStorefrontTexture(w, h, seedI);
    const sMat = new THREE.MeshStandardMaterial({ map: storeTex, roughness: .88 });
    const sPlane = new THREE.Mesh(new THREE.PlaneGeometry(w + .04, h + .04), sMat);
    sPlane.position.set(front.x, h / 2, front.z); sPlane.rotation.y = ry; sPlane.receiveShadow = true;
    this.group.add(sPlane);
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', '-z'], 'cottage', seed + 5);
    this._facadeDoor(x, z, w, d, ry, 1.2, this.mDoor([96, 68, 46]), 0);
    // awning
    const aw = new THREE.Mesh(new THREE.BoxGeometry(w - 1, .08, 1.3), new THREE.MeshStandardMaterial({ color: 0xc8402c, roughness: .9 }));
    const awp = l2w(0, hd + .7); aw.position.set(awp.x, h * .52, awp.z); aw.rotation.y = ry; aw.castShadow = true; this.group.add(aw);
    // sign panel
    const sg = new THREE.Mesh(new THREE.BoxGeometry(w - 1.2, .7, .08), new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: .8 }));
    const sgp = l2w(0, hd + .45); sg.position.set(sgp.x, h - .6, sgp.z); sg.rotation.y = ry; this.group.add(sg);
    const sgTxt = new THREE.Mesh(new THREE.BoxGeometry(w - 1.6, .42, .05), new THREE.MeshStandardMaterial({ color: 0xf2c75c, roughness: .7, emissive: 0x5a4410, emissiveIntensity: .25 }));
    const stp = l2w(0, hd + .5); sgTxt.position.set(stp.x, h - .6, stp.z); sgTxt.rotation.y = ry; this.group.add(sgTxt);
    // side gable roof
    this.gableRoof(x, z, w, h, d, ry, 0.75, this.mShingle([128, 96, 78]));
    // chimney
    const chp = l2w(-hw * .5, -hd * .35);
    this.box(chp.x, h + 0.3, chp.z, .7, 1.1, .7, this.mBrick([130, 72, 56]), solid, ry);
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2));
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.namedLocations.push({ x, z, name: 'CORNER STORE', color: '#ffd24a' });
  };
}
