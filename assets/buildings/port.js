// Asset: Port — concrete pier with container stacks and crane.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installPort(World) {
  World.prototype.port = function (x, z, ry = 0, solid = false) {
    const mat = this.mConcrete([120, 118, 112]);
    const pier = new THREE.Mesh(new THREE.BoxGeometry(20, .6, 14), mat);
    pier.position.set(x, .3, z); pier.receiveShadow = true; pier.castShadow = true; this.group.add(pier);
    this.addCollider(x, 0, z, 20, .6, 14);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const cols = [[0x9a3b2e, 0, -4], [0xc9a23a, 5, -4], [0x2e5b9a, -5, -4], [0x4a7a3c, 0, 0], [0x9a3b2e, 5, 0]];
    for (const [c, lx, lz] of cols) {
      const p = l2w(lx, lz);
      const cm = new THREE.MeshStandardMaterial({ color: c, roughness: .8 });
      this.box(p.x, .6, p.z, 4, 2.4, 2.4, cm, solid, ry);
      if (Math.random() < .8) this.box(p.x, 3.0, p.z, 4, 2.4, 2.4, cm, solid, ry);
    }
    const craneMat = this.mMetal();
    for (const [lx, lz] of [[-2, -6], [2, -6], [-2, 6], [2, 6]]) {
      const p = l2w(lx, lz);
      this.box(p.x, 0, p.z, .4, 14, .4, craneMat, solid, ry);
    }
    this.box(x, 14, z, 18, .6, .6, craneMat, false, ry);
    for (const [lx, lz] of [[-2, -6], [2, -6], [-2, 6], [2, 6]]) {
      const p = l2w(lx, lz);
      this.climbBox(p.x, 14, p.z, .5, .5, .5, craneMat);
    }
    this.coverPoints.push(this.frontPoint(x, z, ry, 2));
    const lp = l2w(5, -4);
    this.lootPoints.push({ x: lp.x, z: lp.z });
  };
}
