// Asset: Bollard — short metal post with cap.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installBollard(World) {
  World.prototype._propBollard = function (x, z, ry, p, react) {
    const bm = new THREE.MeshStandardMaterial({ color: 0x8f9296, roughness: .5, metalness: .7 });
    const b = new THREE.Mesh(new THREE.CylinderGeometry(.12, .14, .9, 16), bm);
    b.position.set(x, .45 + (p.y || 0), z); b.castShadow = true; this.group.add(b);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.12, 16, 10), bm);
    cap.position.set(x, .9 + (p.y || 0), z); this.group.add(cap);
    this.addCollider(x, p.y || 0, z, .4, .9, .4);
  };
}
