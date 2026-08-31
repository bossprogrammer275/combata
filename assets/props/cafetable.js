// Asset: Cafetable — outdoor cafe table with chairs.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installCafetable(World) {
  World.prototype._propCafetable = function (x, z, ry, p, react) {
    // Outdoor Cafe Table with Chairs
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.6, metalness: 0.7 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0xd4cbb8, roughness: 0.4 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.08, 24), topMat);
    top.position.set(x, 0.8 + (p.y || 0), z); top.castShadow = top.receiveShadow = true; this.group.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 12), metalMat);
    leg.position.set(x, 0.4 + (p.y || 0), z); leg.castShadow = true; this.group.add(leg);
    this.climbBox(x, p.y || 0, z, 1.4, 0.85, 1.4, topMat, ry);
  };
}
