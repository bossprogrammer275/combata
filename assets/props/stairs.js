// Asset: Stairs — climbable step stack.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installStairs(World) {
  World.prototype._propStairs = function (x, z, ry, p, react) {
    this.stairs(x, z, p.n || 3, p.stepH || .4, p.stepW || 3, p.stepD || .4, ry, this._sceneMat(p.m || 'concrete'), true);
  };
}
