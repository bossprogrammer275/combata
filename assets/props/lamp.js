// Asset: Lamp — street lamp with arm and head housing, correctly rotated.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installLamp(World) {
  World.prototype._propLamp = function (x, z, ry = 0, p = {}, react) {
    const g = new THREE.Group();
    g.position.set(x, p.y || 0, z);
    g.rotation.y = ry;

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: .6, metalness: .6 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffcf70, emissiveIntensity: .85 });

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, 4.8, 16), poleMat);
    pole.position.set(0, 2.4, 0); pole.castShadow = true; g.add(pole);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(.26, .30, .14, 16), poleMat);
    base.position.set(0, .07, 0); base.castShadow = true; g.add(base);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 1.4, 12), poleMat);
    arm.position.set(0, 4.6, .65); arm.rotation.x = Math.PI / 2; g.add(arm);

    const head = new THREE.Mesh(new THREE.BoxGeometry(.45, .16, .9), headMat);
    head.position.set(0, 4.45, 1.25); g.add(head);

    this.group.add(g);
    this.addCollider(x, p.y || 0, z, .35, 4.8, .35);
  };
}
