// Asset: Busstop — poles, glass panel, crossbar, roof, sign, bench with legs + armrests.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installBusstop(World) {
  World.prototype._propBusstop = function (x, z, ry, p, react) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: .6, metalness: .5 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fb6c8, transparent: true, opacity: .45, roughness: .2, metalness: .4 });
    const roofMat2 = new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: .7, metalness: .4 });
    const bst = ry, cb = Math.cos(bst), sb = Math.sin(bst);
    const bp = (lx, lz) => ({ x: lx * cb + lz * sb, z: -lx * sb + lz * cb });
    const g = new THREE.Group();
    g.position.set(x, p.y || 0, z); g.rotation.y = ry;
    // two support poles reaching up to the roof
    const roofY = 2.4;
    for (const dx of [-1.4, 1.4]) {
      const pp = bp(dx, 0);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.04, .06, roofY, 12), poleMat);
      pole.position.set(pp.x, roofY / 2, pp.z); pole.castShadow = true; g.add(pole);
    }
    // glass back panel — grounded, spanning between the poles
    const gp = bp(0, .5);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.4, .05), glassMat);
    glass.position.set(gp.x, .75, gp.z); g.add(glass);
    // horizontal cross-bar between poles at mid height
    const cbar = bp(0, 0);
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(2.8, .04, .04), poleMat);
    crossbar.position.set(cbar.x, 1.2, cbar.z); g.add(crossbar);
    // roof — sits on the pole tops
    const rp = bp(0, .4);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, .07, 1.2), roofMat2);
    roof.position.set(rp.x, roofY + .035, rp.z); roof.castShadow = true; g.add(roof);
    // signboard mounted above the roof
    const sg = bp(0, .4);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.2, .25, .05), this.mMetal());
    sign.position.set(sg.x, roofY + .2, sg.z); g.add(sign);
    // bench with legs — seat at 0.48m (realistic bench height)
    const bq = bp(0, -.2);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.4, .06, .35), this.mWood());
    bench.position.set(bq.x, .48, bq.z); g.add(bench);
    for (const lx of [-1.05, 1.05]) {
      const lp = bp(lx, -.2);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.06, .44, .35), this.mMetal());
      leg.position.set(lp.x, .22, lp.z); g.add(leg);
    }
    // vertical armrests on bench ends
    for (const lx of [-1.2, 1.2]) {
      const ap = bp(lx, -.2);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(.04, .3, .3), poleMat);
      arm.position.set(ap.x, .63, ap.z); g.add(arm);
    }
    this.group.add(g);
    this.addCollider(x, p.y || 0, z, 3.4, 2.5, 1.2);
  };
}
