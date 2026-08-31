// Asset: Box — generic solid box prop with explicit dims.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installBox(World) {
  World.prototype._propBox = function (x, z, ry, p, react) {
    this.box(x, p.y || 0, z, p.w || 2, p.h || 2, p.d || 2, this._sceneMat(p.m), true, ry, false, react);
  };
}
