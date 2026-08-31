// Asset: Rockfield — scatter of boulders.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installRockField(World) {
  World.prototype.rockField = function (cx, cz, radius) {
    const rockMat = new THREE.MeshStandardMaterial({ map: TEX.makeConcreteTexture(256, [96, 88, 76]), roughness: 1 });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * radius;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      const r = new THREE.Mesh(rockGeo, rockMat); const s = .5 + Math.random() * 1.4;
      r.scale.set(s, s * .7, s); r.position.set(x, s * .3, z); r.rotation.set(Math.random(), Math.random() * 6, Math.random());
      r.castShadow = r.receiveShadow = true; this.group.add(r);
      if (s > .9) this.addCollider(x, 0, z, s * 1.4, s, s * 1.4);
    }
  };
}
