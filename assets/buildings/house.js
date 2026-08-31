// Asset: House — compact residential house with solid walls and gable roof.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installHouse(World) {
  World.prototype.house = function (x, z, ry = 0, ruined = false, solid = false) {
    const w = 8, d = 7, h = 4.5, t = 0.4;
    const hw = w / 2, hd = d / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const col = ruined ? this._pal('pc', this._perimConcrete) : this._pal('cb', this._coreBrick);
    const mat = this.mConcrete(col);

    // Back wall — full width
    const B = l2w(0, -hd);
    this.box(B.x, 0, B.z, w, h, t, mat, solid, ry);

    // Left wall — full depth
    const L = l2w(-hw, 0);
    this.box(L.x, 0, L.z, t, h, d, mat, solid, ry);

    // Right wall — full depth
    const R = l2w(hw, 0);
    this.box(R.x, 0, R.z, t, h, d, mat, solid, ry);

    // Front wall — split into left segment, right segment, and lintel above door
    const doorWidth = 1.8;
    const doorH = 2.8;
    const doorLeft = -doorWidth / 2;
    const doorRight = doorWidth / 2;
    const lintelH = h - doorH;

    // Left front wall segment
    const leftFW = hw + doorLeft;
    if (leftFW > 0.01) {
      const lfp = l2w(-hw + leftFW / 2, hd);
      this.box(lfp.x, 0, lfp.z, leftFW, h, t, mat, solid, ry);
    }

    // Right front wall segment
    const rightFW = hw - doorRight;
    if (rightFW > 0.01) {
      const rfp = l2w(doorRight + rightFW / 2, hd);
      this.box(rfp.x, 0, rfp.z, rightFW, h, t, mat, solid, ry);
    }

    // Lintel above door
    if (lintelH > 0.01) {
      const ltp = l2w(0, hd);
      this.box(ltp.x, doorH + lintelH / 2, ltp.z, doorWidth, lintelH, t, mat, false, ry);
    }

    if (!this._quality || this._quality === 'ultra-low') return;

    // Facade textures on all walls
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', 'z'], ruined ? 'tenement' : 'tenement', 17);

    // Door leaf
    if (!ruined) {
      this._facadeDoor(x, z, w, d, ry, doorWidth, this.mDoor([104, 72, 48]));
    }

    // Gable roof
    const roofMat = Math.random() < 0.55 ? this.mShingle() : this.mTile();
    this.gableRoof(x, z, w, h, d, ry, 0.6, roofMat);

    // Chimney
    if (!ruined) {
      const chX = x + (w * 0.22 * cs - d * 0.15 * sn);
      const chZ = z + (w * 0.22 * sn + d * 0.15 * cs);
      this.box(chX, h + 0.2, chZ, 0.8, 1.1, 0.8, this.mBrick([140, 78, 60]), solid, ry);
    }

    // Interior & cover
    this.addInterior(new THREE.Vector3(x - hw - 0.5, 0, z - hd - 0.5), new THREE.Vector3(x + hw + 0.5, h, z + hd + 0.5));
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 1.5));
    this.namedLocations.push({ x, z, name: 'HOUSE', color: '#ffd24a' });
  };
}
