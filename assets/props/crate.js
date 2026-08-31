// Asset: Crate — wooden shipping crate.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installCrate(World) {
  World.prototype._propCrate = function (x, z, ry, p, react) {
    this.climbBox(x, p.y || 0, z, 1.6, 1.4, 1.6, this._sceneMat(p.m || 'crate'), ry, react);
  };
}
