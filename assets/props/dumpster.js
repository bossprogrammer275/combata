// Asset: Dumpster — big bin with lid and wheels.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installDumpster(World) {
  World.prototype._propDumpster = function (x, z, ry, p, react) {
    const dm = new THREE.MeshStandardMaterial({ map: TEX.makeMetalTexture(512, p.c || [72, 110, 72]), roughness: .6, metalness: .5 });
    this.box(x, p.y || 0, z, 2.6, 1.1, 1.6, dm, true, ry);
    // lid
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.7, .08, 1.7), dm);
    lid.position.set(x, 1.2 + (p.y || 0), z); lid.rotation.y = ry; lid.rotation.z = -0.12;
    lid.castShadow = true; this.group.add(lid);
    // wheels
    for (const [wx, wz] of [[-1.15, -0.75], [1.15, -0.75]]) {
      const wl = new THREE.Mesh(new THREE.CylinderGeometry(.28, .28, .12, 16), new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: .9 }));
      wl.rotation.x = Math.PI / 2;
      wl.position.set(x + wx, .28 + (p.y || 0), z + wz);
      this.group.add(wl);
    }
  };
}
