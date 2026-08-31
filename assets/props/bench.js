// Asset: Bench — urban park/sidewalk bench with slatted seat.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installBench(World) {
  World.prototype._propBench = function (x, z, ry, p, react) {
    // Urban Park / Sidewalk Bench
    const woodMat = this._sceneMat('wood');
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e2228, roughness: 0.6, metalness: 0.8 });
    const bench = new THREE.Group(); bench.position.set(x, 0.4 + (p.y || 0), z); bench.rotation.y = ry;
    // slatted seat
    for (let i = -1; i <= 1; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.14), woodMat);
      slat.position.set(0, 0.02, i * 0.18); slat.castShadow = true; bench.add(slat);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.05), woodMat);
    back.position.set(0, 0.25, -0.24); back.castShadow = true; bench.add(back);
    for (const [lx, lz] of [[-0.8, -0.12], [0.8, -0.12]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.07, .34, .34), frameMat);
      leg.position.set(lx, -0.14, lz); bench.add(leg);
    }
    this.group.add(bench);
    this.climbBox(x, p.y || 0, z, 1.8, 0.8, 0.6, woodMat, ry);
  };
}
