// Asset: Tower — straight glass shaft with setback crown.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installTower(World) {
  World.prototype.tower = function (x, z, ry, w, h, d, mat, solid, doorW, style, seed, roofMat, b) {
    const fh = 3.2, floors = Math.max(1, Math.round(h / fh));
    const totalH = floors * fh, t = 0.6, hw = w / 2, hd = d / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    // straight glass shaft — a single continuous envelope so the window
    // facade plane fits the massing exactly (no stepped mismatch)
    this.box(l2w(0, -hd).x, 0, l2w(0, -hd).z, w, totalH, t, mat, solid, ry);
    this.box(l2w(-hw, 0).x, 0, l2w(-hw, 0).z, t, totalH, d, mat, solid, ry);
    this.box(l2w(hw, 0).x, 0, l2w(hw, 0).z, t, totalH, d, mat, solid, ry);
    this.box(l2w(0, hd).x, 0, l2w(0, hd).z, w, totalH, t, mat, solid, ry);
    this._applyFacade(x, z, w, totalH, d, ry, ['x', '-x', 'z', '-z'], style, seed);
    // setback crown: recessed top floor with its own window band
    const crownY = totalH - fh, cw = w - 1.2, cd = d - 1.2, chw = cw / 2, chd = cd / 2;
    this.box(l2w(0, -chd).x, crownY, l2w(0, -chd).z, cw, fh, t, mat, solid, ry);
    this.box(l2w(-chw, 0).x, crownY, l2w(-chw, 0).z, t, fh, cd, mat, solid, ry);
    this.box(l2w(chw, 0).x, crownY, l2w(chw, 0).z, t, fh, cd, mat, solid, ry);
    this.box(l2w(0, chd).x, crownY, l2w(0, chd).z, cw, fh, t, mat, solid, ry);
    this._applyFacade(x, z, cw, fh, cd, ry, ['x', '-x', 'z', '-z'], style, seed + 7, crownY);
    this.box(x, totalH, z, w + .4, .4, d + .4, roofMat, true, ry);
    this.roofProps(x, z, ry, w, d, totalH + 0.45);
    this.addRoof(x, z, totalH + 0.4, hw, hd);
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, totalH, z + hd));
    this.coverPoints.push(new THREE.Vector3(x, totalH, z));
    this.namedLocations.push({ x, z, name: 'TOWER', color: '#8ab4ff' });
  };
}
