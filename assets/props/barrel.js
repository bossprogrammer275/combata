// Asset: Barrel — single standing fuel/oil barrel.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installBarrel(World) {
  World.prototype._propBarrel = function (x, z, ry, p, react) {
    const cm = this._sceneMat(p.m || 'barrel');
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, 1.1, 24), cm);
    tank.position.set(x, .55 + (p.y || 0), z);
    tank.castShadow = tank.receiveShadow = true;
    this.group.add(tank);
    const col = this.addCollider(x, p.y || 0, z, 1.1, 1.1, 1.1);
    if (react) this._registerReactive(tank, react, col);
  };
}
