// Asset: Highrise — straight glass shaft with setback crown.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installHighrise(World) {
  World.prototype.highrise = function (x, z, ry = 0, floors = 3, w = 14, d = 14, h = 0, solid = false) {
    const fh = 3.2, t = 0.6, totalH = floors * fh, H = h || totalH;
    const cc = this._pal('cc', this._coreConcrete);
    const mat = this.mConcrete(cc);
    const roofMat = this.mRoof();
    const ultra = this._quality === 'ultra-low';
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    // straight glass shaft — continuous envelope so the facade fits exactly
    this.box(l2w(0, -d / 2).x, 0, l2w(0, -d / 2).z, w, H, t, mat, solid, ry);
    this.box(l2w(-w / 2, 0).x, 0, l2w(-w / 2, 0).z, t, H, d, mat, solid, ry);
    this.box(l2w(w / 2, 0).x, 0, l2w(w / 2, 0).z, t, H, d, mat, solid, ry);
    this.box(l2w(0, d / 2).x, 0, l2w(0, d / 2).z, w, H, t, mat, solid, ry);
    this.box(x, H, z, w + .4, .4, d + .4, roofMat, true, ry);
    // full glass facades on all sides
    if (!ultra) this._applyFacade(x, z, w, H, d, ry, ['x', '-x', 'z', '-z'], 'office', 23);
    if (this._quality !== 'low' && this._quality !== 'ultra-low') {
      // setback crown with its own window band
      const crownY = H - fh, cw = w - 1.2, cd = d - 1.2, chw = cw / 2, chd = cd / 2;
      this.box(l2w(0, -chd).x, crownY, l2w(0, -chd).z, cw, fh, t, mat, solid, ry);
      this.box(l2w(-chw, 0).x, crownY, l2w(-chw, 0).z, t, fh, cd, mat, solid, ry);
      this.box(l2w(chw, 0).x, crownY, l2w(chw, 0).z, t, fh, cd, mat, solid, ry);
      this.box(l2w(0, chd).x, crownY, l2w(0, chd).z, cw, fh, t, mat, solid, ry);
      this._applyFacade(x, z, cw, fh, cd, ry, ['x', '-x', 'z', '-z'], 'office', 30, crownY);
    }
    if (!ultra && this._quality !== 'low') this.roofProps(x, z, ry, w, d, H + 0.45);
    this.addRoof(x, z, H + 0.4, w / 2, d / 2);
    this.addInterior(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, H, z + d / 2));
    this.coverPoints.push(new THREE.Vector3(x, H, z));
    this.namedLocations.push({ x, z, name: 'HIGHRISE', color: '#8ab4ff' });
  };
}
