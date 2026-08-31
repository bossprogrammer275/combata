// Asset: Pole — utility pole with crossarm and insulators.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installPole(World) {
  World.prototype._propPole = function (x, z, ry, p, react) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3d3226, roughness: .8 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, 7, 12), poleMat);
    pole.position.set(x, 3.5 + (p.y || 0), z); pole.castShadow = true; this.group.add(pole);
    // crossarm
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, .12, .12), poleMat);
    arm.position.set(x, 6.2 + (p.y || 0), z); this.group.add(arm);
    // insulators
    for (const dx of [-1, 1]) {
      const ins = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .12, 10), new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: .4 }));
      ins.position.set(x + dx * 1.05, 6.3 + (p.y || 0), z); this.group.add(ins);
    }
    this.addCollider(x, p.y || 0, z, .3, 7, .3);
  };
}
