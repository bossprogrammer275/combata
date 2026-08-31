// Asset: Planter — concrete planter with soil and bush.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installPlanter(World) {
  World.prototype._propPlanter = function (x, z, ry, p, react) {
    const cm = this.mConcrete([150, 148, 144]);
    this.box(x, p.y || 0, z, 1.4, .55, 1.4, cm, true, ry);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(1.2, .2, 1.2), new THREE.MeshStandardMaterial({ color: 0x3f5a30, roughness: 1 }));
    soil.position.set(x, .6 + (p.y || 0), z); soil.rotation.y = ry; this.group.add(soil);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(.55, 1), this.mFoliage());
    bush.position.set(x, .9 + (p.y || 0), z); bush.castShadow = true; this.group.add(bush);
  };
}
