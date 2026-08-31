// Asset: Woodcrate — single wooden crate, lighter.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installWoodcrate(World) {
  World.prototype._propWoodcrate = function (x, z, ry, p, react) {
    this.climbBox(x, p.y || 0, z, 1.4, 1.2, 1.4, this._sceneMat(p.m || 'wood'), ry, react);
  };
}
