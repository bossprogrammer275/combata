// Asset: Billboard — two legs with advertising face.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installBillboard(World) {
  World.prototype._propBillboard = function (x, z, ry, p, react) {
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: .6, metalness: .6 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: .8 });
    for (const [dx, dz] of [[-1.2, 0], [1.2, 0]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, 5, 12), legMat);
      leg.position.set(x + dx, 2.5 + (p.y || 0), z + dz); leg.castShadow = true; this.group.add(leg);
    }
    const face = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, .12), faceMat);
    face.position.set(x, 4.6 + (p.y || 0), z); face.rotation.y = ry; face.castShadow = true; this.group.add(face);
    this.addCollider(x, p.y || 0, z, 5.2, 6, 1.2);
  };
}
