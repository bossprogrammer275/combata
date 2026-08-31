// Asset: Mosque — prayer hall + central dome on a drum + two minarets + arched entrance.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installMosque(World) {
  World.prototype.mosque = function (x, z, ry = 0, w = 18, d = 20, solid = true, seed = 1) {
    const t = 0.5, hw = w / 2, hd = d / 2;
    const hallH = 6.5;
    const mat = this.mPanel([198, 188, 162]);
    const creamMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: .85 });
    const domeMat = this._mat('dome', () => new THREE.MeshStandardMaterial({ map: TEX.makeDomeTexture(256, [28, 104, 78]), roughness: .65, metalness: .1, envMapIntensity: .6 }));
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9b24a, roughness: .4, metalness: .8 });
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    // prayer hall
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, hallH, t, mat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, hallH, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, hallH, d, mat, solid, ry);
    const doorW = 1.7, sideW = (w - doorW) / 2;
    this.box(l2w(-hw + sideW / 2, hd).x, 0, l2w(-hw + sideW / 2, hd).z, sideW, hallH, t, mat, solid, ry);
    this.box(l2w(hw - sideW / 2, hd).x, 0, l2w(hw - sideW / 2, hd).z, sideW, hallH, t, mat, solid, ry);
    this._applyFacade(x, z, w, hallH, d, ry, ['x', '-x', 'z', '-z'], 'mosque', seed);
    // corner pilasters
    for (const [px, pz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      const pp = l2w(px, pz);
      this.box(pp.x, 0, pp.z, 0.9, hallH, 0.9, creamMat, solid, ry);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.1, .22, 1.1), creamMat);
      cap.position.set(pp.x, hallH + .175 + .11, pp.z); cap.rotation.y = ry;
      this.group.add(cap);
    }
    // flat slab roof
    this.box(x, hallH, z, w + .4, .35, d + .4, this.mRoof(), solid, ry);
    // central dome on a drum — dome base radius === drum radius (flush, no overhang)
    const domeR = Math.min(w, d) * 0.23;
    const slabTop = hallH + .175;
    const drumH = 2.1;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(domeR, domeR, drumH, 32), creamMat);
    drum.position.set(x, slabTop + drumH / 2, z); drum.castShadow = true; this.group.add(drum);
    // drum cornice moldings: ring at base + top of the drum
    for (const dy of [slabTop + .06, slabTop + drumH - .06]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(domeR * 1.02, .1, 8, 32), creamMat);
      ring.position.set(x, dy, z); ring.rotation.x = Math.PI / 2; ring.castShadow = true; this.group.add(ring);
    }
    const domeBase = slabTop + drumH;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(domeR, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.set(x, domeBase, z); dome.castShadow = true; this.group.add(dome);
    const finial = new THREE.Mesh(new THREE.ConeGeometry(.2, .8, 16), goldMat);
    finial.position.set(x, domeBase + domeR + .3, z); this.group.add(finial);
    // two small side domes on the roof (equator seated in the slab, finial on the apex)
    for (const sdx of [-1, 1]) {
      const sp = l2w(sdx * (w * .28), -d * .2);
      const sd = new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
      sd.position.set(sp.x, slabTop, sp.z); sd.castShadow = true; this.group.add(sd);
      const sf = new THREE.Mesh(new THREE.ConeGeometry(.12, .5, 12), goldMat);
      sf.position.set(sp.x, slabTop + 1.35, sp.z); this.group.add(sf);
    }
    // two minarets at the front (+z) corners — every element stacked continuously
    for (const mdx of [-1, 1]) {
      const mp = l2w(mdx * (w / 2 - 1.6), hd + 1.6);
      const mBase = this.mConcrete([180, 176, 168]);
      this.box(mp.x, 0, mp.z, 1.7, 1.7, 1.7, mBase, solid, ry);
      // collar bridging the square base to the round shaft
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(.78, .86, .5, 20), creamMat);
      collar.position.set(mp.x, 1.95, mp.z); this.group.add(collar);
      const shaftTop = 13.0;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.56, .74, shaftTop - 1.7, 24), creamMat);
      shaft.position.set(mp.x, (1.7 + shaftTop) / 2, mp.z); shaft.castShadow = true; this.group.add(shaft);
      // balcony (talley) — flares out over the shaft top
      const bal = new THREE.Mesh(new THREE.CylinderGeometry(.95, .82, .6, 24), creamMat);
      bal.position.set(mp.x, shaftTop - .1, mp.z); bal.castShadow = true; this.group.add(bal);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(.99, .99, .16, 24), creamMat);
      rail.position.set(mp.x, shaftTop + .38, mp.z); this.group.add(rail);
      // pointed cap, tip and crescent — stacked with no gaps
      const capBase = shaftTop + .48;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(.78, 1.7, 20), domeMat);
      cap.position.set(mp.x, capBase + .85, mp.z); cap.castShadow = true; this.group.add(cap);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .9, 12), goldMat);
      tip.position.set(mp.x, capBase + 1.7 + .45, mp.z); this.group.add(tip);
      const cref = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .45, 12), goldMat);
      cref.position.set(mp.x, capBase + 1.7 + .9 + .225, mp.z); this.group.add(cref);
    }
    // arched main entrance + steps
    const ep = l2w(0, hd + 1.4);
    this._facadeDoor(x, z, w, d, ry, 1.7, this.mDoor([90, 62, 40]));
    const arch = new THREE.Mesh(new THREE.BoxGeometry(3, 4.6, .5), creamMat);
    const ap0 = l2w(0, hd + .3); arch.position.set(ap0.x, 2.3, ap0.z); arch.rotation.y = ry; this.group.add(arch);
    // pointed-arch trim: two slanted jambs meeting the peak just under the roofline
    for (const tdx of [-1, 1]) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(.34, 2.2, .3), creamMat);
      const tp = l2w(tdx * 1.05, hd + .34); trim.position.set(tp.x, 4.95, tp.z); trim.rotation.y = ry;
      trim.rotation.z = -tdx * Math.PI / 6; trim.castShadow = true; this.group.add(trim);
    }
    const peak = new THREE.Mesh(new THREE.BoxGeometry(.42, .7, .32), creamMat);
    const pkp = l2w(0, hd + .34); peak.position.set(pkp.x, 6.15, pkp.z); peak.rotation.y = ry; this.group.add(peak);
    const archIn = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.4, .6), new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: .9 }));
    const aip = l2w(0, hd + .58); archIn.position.set(aip.x, 1.9, aip.z); archIn.rotation.y = ry; this.group.add(archIn);
    const stepMat = this.mConcrete([150, 148, 145]);
    for (let s = 0; s < 2; s++) {
      const stp = l2w(0, hd + 1.9 + s * .75);
      this.box(stp.x, s * .18, stp.z, 3.2, .18, .75, stepMat, solid, ry);
    }
    this.coverPoints.push(new THREE.Vector3(x + sn * 3.5, 0, z + cs * 3.5));
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, hallH, z + hd));
    this.namedLocations.push({ x, z, name: 'MOSQUE', color: '#ffd24a' });
  };
}
