// Asset: Trashcan — round bin with lid and rim.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installTrashcan(World) {
  World.prototype._propTrashcan = function (x, z, ry, p, react) {
    const tm = new THREE.MeshStandardMaterial({ map: TEX.makeMetalTexture(64, [96, 100, 104]), roughness: .6, metalness: .6 });
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(.34, .3, .85, 24), tm);
    bin.position.set(x, .43 + (p.y || 0), z); bin.castShadow = true; this.group.add(bin);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(.36, .36, .06, 24), tm);
    lid.position.set(x, .9 + (p.y || 0), z); this.group.add(lid);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.34, .02, 8, 20), tm);
    rim.position.set(x, .86 + (p.y || 0), z); rim.rotation.x = Math.PI / 2; this.group.add(rim);
    this.addCollider(x, p.y || 0, z, .7, .9, .7);
  };
}
