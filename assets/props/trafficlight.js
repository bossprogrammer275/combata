// Asset: Trafficlight — pole, overhang arm, head housing with 3 signal lenses, correctly rotated.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installTrafficlight(World) {
  World.prototype._propTrafficlight = function (x, z, ry = 0, p = {}, react) {
    const g = new THREE.Group();
    g.position.set(x, p.y || 0, z);
    g.rotation.y = ry;

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: .6, metalness: .6 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .11, 5, 16), poleMat);
    pole.position.set(0, 2.5, 0); pole.castShadow = true; g.add(pole);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 2.4, 12), poleMat);
    arm.position.set(0, 4.6, 1.2); arm.rotation.x = Math.PI / 2; g.add(arm);

    const head = new THREE.Group(); head.position.set(0, 4.2, 2.3);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(.35, 1.1, .36), new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: .5 }));
    head.add(hb);
    const lensCols = [0xff2222, 0xffbb00, 0x22ff55];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(.11, 16), new THREE.MeshBasicMaterial({ color: lensCols[i] }));
      l.position.set(0, .32 - i * .32, .19);
      head.add(l);
    }
    g.add(head);

    this.group.add(g);
    this.addCollider(x, p.y || 0, z, .4, 5, .4);
  };
}
