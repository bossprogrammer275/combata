// Asset: HouseDetailed — residential house with windows, door, porch, chimney, real roof.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installHouseDetailed(World) {
  World.prototype.houseDetailed = function (x, z, ry = 0, w = 10, d = 8, h = 4, wallStyle = 'brick', solid = true, seed = 1) {
    const t = 0.35, hw = w / 2, hd = d / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const wallMat = this._sceneMat(wallStyle === 'brick' ? 'brick' : wallStyle === 'wood' ? 'wood' : 'panel');
    const roofMat = Math.random() < 0.6 ? this.mShingle() : this.mTile();
    // walls (4 box strips)
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, h, t, wallMat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, h, d, wallMat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, h, d, wallMat, solid, ry);
    const doorW = 1.1, sideW = (w - doorW) / 2;
    this.box(l2w(-hw + sideW / 2, hd).x, 0, l2w(-hw + sideW / 2, hd).z, sideW, h, t, wallMat, solid, ry);
    this.box(l2w(hw - sideW / 2, hd).x, 0, l2w(hw - sideW / 2, hd).z, sideW, h, t, wallMat, solid, ry);
    // facade with windows on front + sides
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', 'z'], wallStyle === 'brick' ? 'tenement' : wallStyle === 'wood' ? 'cottage' : 'cottage', seed);
    // front door
    const doorPos = this._facadeDoor(x, z, w, d, ry, 1.1, this.mDoor([96, 66, 44]));
    // porch steps
    const px = doorPos.x, pz = doorPos.z;
    const stepN = 2;
    for (let i = 0; i < stepN; i++) {
      const sx = x + sn * ((d / 2) + 0.6 + i * 0.35), sz = z + cs * ((d / 2) + 0.6 + i * 0.35);
      this.box(sx, 0, sz, 1.6 - i * 0.3, 0.16, 0.5, this.mConcrete([150, 148, 145]), solid, ry);
    }
    // chimney
    const chPos = l2w(w * 0.22, -d * 0.15);
    const pitch = 0.6, ridgeH = h + (w / 2) * pitch;
    this.box(chPos.x, h + 0.3, chPos.z, 0.9, ridgeH - h + 0.4, 0.9, this.mBrick([140, 78, 60]), solid, ry);
    // gable roof
    this.gableRoof(x, z, w, h, d, ry, pitch, roofMat);
    // fascia board under the front eave — breaks the wall-to-roof seam
    const fas = l2w(0, hd + 0.2);
    this.box(fas.x, h - 0.12, fas.z, w + 0.9, 0.2, 0.14, this.mWood(), false, ry);
    // door frame trim: jambs + lintel, proud of the wall
    const dw = 0.66, dh = 2.3;
    for (const sdx of [-1, 1]) {
      const jp = l2w(sdx * (dw / 2 + 0.08), hd + 0.13);
      this.box(jp.x, 0, jp.z, 0.12, dh, 0.12, this.mWood(), false, ry);
    }
    const lp = l2w(0, hd + 0.13);
    this.box(lp.x, dh - 0.05, lp.z, dw + 0.28, 0.12, 0.12, this.mWood(), false, ry);
    // rain downspout at a front corner, running to the ground
    const dp = l2w(-hw + 0.3, hd + 0.42);
    const downMat = this.mMetal();
    const down = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, h - 0.3, 8), downMat);
    down.position.set(dp.x, (h - 0.3) / 2, dp.z); down.castShadow = true; this.group.add(down);
    // foundation plinth band
    this._baseTrim(x, z, w, d, ry, h, { lip: false });
    // attic window on gable ends (front only)
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 1.5));
    this.namedLocations.push({ x, z, name: 'HOUSE', color: '#ffd24a' });
    const roofHH = ridgeH - h + 0.2;
    if (ry) {
      const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      const ex = ((w + 1) / 2) * c + ((d + 1) / 2) * s, ez = ((w + 1) / 2) * s + ((d + 1) / 2) * c;
      this.addCollider(x, h + 0.2, z, ex * 2, roofHH, ez * 2);
    } else {
      this.addCollider(x, h + 0.2, z, w + 1, roofHH, d + 1);
    }
  };
}
