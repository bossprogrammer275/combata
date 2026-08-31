// Asset: Barrels — fuel/clutter cluster: 2-4 barrels grouped + one tipped.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installBarrels(World) {
  World.prototype._propBarrels = function (x, z, ry, p, react) {
    // fuel/clutter cluster: 2-4 barrels grouped + one tipped
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 1.1;
      const bx = x + Math.cos(a) * rr, bz = z + Math.sin(a) * rr;
      const cm = this._sceneMat(p.m || 'barrel');
      if (i === 0 && Math.random() < .5) {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, 1.1, 24), cm);
        barrel.position.set(bx, .55 + (p.y || 0), bz);
        barrel.rotation.z = Math.PI / 2 - (Math.random() - .5) * .4;
        barrel.castShadow = true;
        this.group.add(barrel);
        this.addCollider(bx, (p.y || 0), bz, 1.2, 1.1, 1.2);
      } else {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, 1.1, 24), cm);
        barrel.position.set(bx, .55 + (p.y || 0), bz);
        barrel.castShadow = true;
        this.group.add(barrel);
        const col = this.addCollider(bx, (p.y || 0), bz, 1.1, 1.1, 1.1);
        if (react) this._registerReactive(barrel, react, col);
      }
    }
  };
}
