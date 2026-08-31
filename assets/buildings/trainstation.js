// Asset: Trainstation — grand station hall with entrance columns, platform canopy, clock, benches.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installTrainStation(World) {
  World.prototype.trainStation = function (x, z, ry = 0, solid = true) {
    const w = 30, d = 14, h = 7, t = 0.5;
    const hw = w / 2, hd = d / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    const brickMat = this.mBrick([168, 130, 100]);
    const conMat = this.mConcrete([160, 155, 148]);
    const metalMat = this.mMetal();

    // back wall (full width, full height)
    const bwp = l2w(0, -hd);
    this.box(bwp.x, 0, bwp.z, w, h, t, brickMat, solid, ry);

    // left wall (full depth, full height)
    const lwp = l2w(-hw, 0);
    this.box(lwp.x, 0, lwp.z, t, h, d, brickMat, solid, ry);

    // right wall (full depth, full height)
    const rwp = l2w(hw, 0);
    this.box(rwp.x, 0, rwp.z, t, h, d, brickMat, solid, ry);

    // front wall — three segments: left solid, right solid, top lintel, with 4-wide 4-tall entrance opening
    const entranceW = 4, entranceH = 4;
    const sideWallW = (w - entranceW) / 2;

    // left front wall segment
    const lfw = l2w(-hw + sideWallW / 2, hd);
    this.box(lfw.x, 0, lfw.z, sideWallW, h, t, brickMat, solid, ry);

    // right front wall segment
    const rfw = l2w(hw - sideWallW / 2, hd);
    this.box(rfw.x, 0, rfw.z, sideWallW, h, t, brickMat, solid, ry);

    // lintel above entrance
    const lintelH = h - entranceH;
    if (lintelH > 0) {
      const lp = l2w(0, hd);
      this.box(lp.x, entranceH + lintelH / 2, lp.z, entranceW, lintelH, t, brickMat, solid, ry);
    }

    // grand entrance columns flanking the opening (4 tall)
    const colH = entranceH, colR = 0.28;
    for (const side of [-1, 1]) {
      const colX = side * (entranceW / 2 + 0.3);
      const cp = l2w(colX, hd + 0.5);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(colR, colR * 1.15, colH, 16), conMat);
      col.position.set(cp.x, colH / 2, cp.z);
      col.castShadow = true;
      this.group.add(col);

      // column base
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.7), conMat);
      base.position.set(cp.x, 0.1, cp.z);
      this.group.add(base);

      // column capital
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.18, 0.65), conMat);
      cap.position.set(cp.x, colH - 0.09, cp.z);
      this.group.add(cap);
    }

    // facade textures (sides and back)
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', '-z'], 'tenement', 1);

    // door via _facadeDoor (on front face, at entrance)
    this._facadeDoor(x, z, w, d, ry, 2.6, this.mDoor([110, 88, 66]), 0);

    // roof slab
    this.box(l2w(0, 0).x, h, l2w(0, 0).z, w + 0.4, 0.35, d + 0.4, this.mRoof(), solid, ry);

    // interior floor
    this.box(x, 0.02, z, w - t * 2, 0.2, d - t * 2, this.mConcrete([120, 116, 110]), false);

    // === PLATFORM AREA (extended concrete slab in front of the building) ===
    const platExtend = 8;
    const platW2 = w + 4;
    const platD2 = platExtend;
    const platH2 = 0.3;
    const platCenterZ = hd + platD2 / 2;
    const pp = l2w(0, platCenterZ);
    this.box(pp.x, -platH2 / 2, pp.z, platW2, platH2, platD2, conMat, false, ry);

    // platform edge markings (yellow safety strip)
    const safetyMat = new THREE.MeshStandardMaterial({ color: 0xddcc22, roughness: 0.8 });
    const spEdge = l2w(0, hd + platD2 - 0.15);
    this.box(spEdge.x, 0.02, spEdge.z, platW2 - 1, 0.04, 0.2, safetyMat, false, ry);

    // === CANOPY / AWNING extending from the building over the platform ===
    const canopyW = w - 2;
    const canopyD = platD2 - 1;
    const canopyH = 3.8;
    const canopyMat = this.mMetal();
    const canopyZ = hd + canopyD / 2 + 0.5;
    const cp = l2w(0, canopyZ);

    // canopy slab
    this.box(cp.x, canopyH, cp.z, canopyW, 0.2, canopyD, canopyMat, false, ry);

    // canopy support columns along the platform edge
    const nCanopyCols = 6;
    const colSpacing = (canopyW - 2) / (nCanopyCols - 1);
    for (let i = 0; i < nCanopyCols; i++) {
      const lx = -canopyW / 2 + 1 + i * colSpacing;
      const ccol = l2w(lx, hd + canopyD - 0.3);
      const supportCol = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, canopyH, 10), canopyMat);
      supportCol.position.set(ccol.x, canopyH / 2, ccol.z);
      supportCol.castShadow = true;
      this.group.add(supportCol);
    }

    // === CLOCK on the facade (circular) ===
    const clockMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e0, roughness: 0.5 });
    const clockR = 0.7;
    const clockP = l2w(0, hd + 0.08);
    const clockFace = new THREE.Mesh(new THREE.CylinderGeometry(clockR, clockR, 0.12, 24), clockMat);
    clockFace.position.set(clockP.x, h - 1.2, clockP.z);
    clockFace.rotation.x = Math.PI / 2;
    clockFace.castShadow = true;
    this.group.add(clockFace);

    // clock rim
    const clockRimMat = this.mMetal();
    const clockRim = new THREE.Mesh(new THREE.TorusGeometry(clockR, 0.06, 8, 24), clockRimMat);
    clockRim.position.set(clockP.x, h - 1.2, clockP.z + 0.06);
    clockRim.rotation.x = Math.PI / 2;
    this.group.add(clockRim);

    // clock hands
    const handMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    // hour hand
    const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.06, clockR * 0.5, 0.03), handMat);
    hourHand.position.set(clockP.x - 0.08, h - 1.2 + 0.12, clockP.z + 0.14);
    hourHand.rotation.z = 0.5;
    this.group.add(hourHand);
    // minute hand
    const minHand = new THREE.Mesh(new THREE.BoxGeometry(0.04, clockR * 0.7, 0.03), handMat);
    minHand.position.set(clockP.x + 0.05, h - 1.2 + 0.05, clockP.z + 0.14);
    minHand.rotation.z = -0.8;
    this.group.add(minHand);

    // === BENCHES on the platform ===
    const benchMat = this.mMetal();
    const benchW = 2.5, benchSeatD = 0.5, benchSeatH = 0.06, benchBackH = 0.55, benchBackThick = 0.05;
    const benchSeatY = 0.45;
    for (const lx of [-5, 0, 5]) {
      const bx = l2w(lx, hd + 3);
      // seat
      this.box(bx.x, benchSeatY, bx.z, benchW, benchSeatH, benchSeatD, benchMat, false, ry);
      // backrest
      this.box(bx.x, benchSeatY + benchBackH / 2, bx.z - 0.25, benchW, benchBackH, benchBackThick, benchMat, false, ry);
    }

    // === TRACK INDICATORS (small signs/posts at platform edge) ===
    const signMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
    const signTopMat = new THREE.MeshStandardMaterial({ color: 0x1a5aaa, roughness: 0.7, emissive: 0x0a2a4a, emissiveIntensity: 0.15 });
    for (const lx of [-8, 0, 8]) {
      const tp = l2w(lx, hd + platD2 - 0.8);
      // post
      this.box(tp.x, 0.75, tp.z, 0.12, 1.5, 0.12, signMat, false, ry);
      // sign head
      this.box(tp.x, 1.6, tp.z, 0.6, 0.4, 0.08, signTopMat, false, ry);
    }

    // add interior
    this.addInterior(
      new THREE.Vector3(x - hw, 0, z - hd),
      new THREE.Vector3(x + hw, h, z + hd)
    );

    // cover points
    this.coverPoints.push(new THREE.Vector3(x, 0, z));
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + platD2 / 2));

    // named location
    this.namedLocations.push({ x, z, name: 'TRAIN STATION', color: '#ffd24a' });
  };
}
