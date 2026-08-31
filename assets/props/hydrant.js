// Asset: Hydrant — fire hydrant with side nozzles.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installHydrant(World) {
  World.prototype._propHydrant = function (x, z, ry, p, react) {
    const hm = new THREE.MeshStandardMaterial({ color: 0xa83228, roughness: .6, metalness: .2 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.14, .2, .55, 20), hm);
    body.position.set(x, .3, z); body.castShadow = true; this.group.add(body);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.15, 16, 10), hm);
    cap.position.set(x, .64, z); this.group.add(cap);
    // side nozzles
    for (const a of [0, Math.PI / 2, Math.PI]) {
      const nz = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .2, 12), hm);
      nz.position.set(x + Math.cos(a) * .16, .38, z + Math.sin(a) * .16);
      nz.rotation.z = Math.PI / 2; nz.rotation.y = a;
      this.group.add(nz);
    }
    this.addCollider(x, 0, z, .5, .75, .5);
  };
}
