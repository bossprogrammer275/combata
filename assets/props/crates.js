// Asset: Crates — delivery cluster: 2-4 crates with jitter, some stacked.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installCrates(World) {
  World.prototype._propCrates = function (x, z, ry, p, react) {
    // delivery cluster: 2-4 crates with jitter, some stacked
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const jx = x + (Math.random() - .5) * 2.4, jz = z + (Math.random() - .5) * 2.4;
      const s = 1.1 + Math.random() * 0.7;
      const st = Math.random() < .4 ? 1 : 0;
      this.climbBox(jx, (p.y || 0) + st * s * .9, jz, s, s * .85, s, this._sceneMat(p.m || 'crate'), Math.random() * Math.PI, react);
      if (st) this.climbBox(jx + (Math.random() - .5) * .5, (p.y || 0) + s * .85, jz + (Math.random() - .5) * .5, s * .8, s * .75, s * .8, this._sceneMat(p.m || 'crate'), Math.random() * Math.PI, react);
    }
  };
}
