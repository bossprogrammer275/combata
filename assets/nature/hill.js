// Asset: Hill — dome hill with collider.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installHill(World) {
  World.prototype.hill = function (x, z, r = 14, hgt = 8) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a5a3e, roughness: 1 });
    const geo = new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const hill = new THREE.Mesh(geo, mat);
    hill.position.set(x, 0, z); hill.scale.y = hgt / r; hill.castShadow = hill.receiveShadow = true; this.group.add(hill);
    this.addCollider(x, 0, z, r * .8, hgt, r * .8);
    this.coverPoints.push(new THREE.Vector3(x, hgt * .8, z));
  };
}
