// Asset: Fueltank — large fuel storage tank with barrel ring.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installFuelTank(World) {
  World.prototype.fuelTank = function (x, z, r = 3, h = 7, solid = false) {
    const dm = this._pal('fm', this._docksMetal);
    const mat = new THREE.MeshStandardMaterial({ map: TEX.makeMetalTexture(512, dm), roughness: .6, metalness: .5 });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32), mat);
    tank.position.set(x, h / 2, z); tank.castShadow = tank.receiveShadow = true; this.group.add(tank);
    this.addCollider(x, 0, z, r * 2, h, r * 2);
    this.climbBox(x, h, z, r * 2 + .6, .3, r * 2 + .6, this.mMetal());
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2;
      this.box(x + Math.cos(a) * (r + 1.5), 0, z + Math.sin(a) * (r + 1.5), 1, 1.4, 1, this.mBarrel(), solid, 0, false, 'firex');
    }
    this.coverPoints.push(new THREE.Vector3(x, 0, z));
  };
}
