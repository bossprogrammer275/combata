// Asset: Umbrella — patio/cafe parasol with fabric canopy.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installUmbrella(World) {
  World.prototype._propUmbrella = function (x, z, ry, p, react) {
    // Patio / Cafe Parasol Umbrella
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.5, metalness: 0.8 });
    const fabricColor = p.color || 0xe65a4c;
    const canopyMat = new THREE.MeshStandardMaterial({ color: fabricColor, roughness: 0.9, side: THREE.DoubleSide });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 12), poleMat);
    pole.position.set(x, 1.3 + (p.y || 0), z); pole.castShadow = true; this.group.add(pole);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.6, 16), canopyMat);
    canopy.position.set(x, 2.5 + (p.y || 0), z); canopy.castShadow = true; this.group.add(canopy);
    this.addCollider(x, p.y || 0, z, 0.3, 2.6, 0.3);
  };
}
