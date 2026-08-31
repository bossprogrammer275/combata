// Asset: Bank — classical stone building with podium, colonnade, pediment, entrance steps.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installBank(World) {
  World.prototype.bank = function (x, z, ry = 0, w = 20, d = 14, h = 8, solid = true, seed = 1) {
    const t = 0.55, hw = w / 2, hd = d / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const mat = this.mConcrete([184, 180, 170]);
    const dbl = this._mat('bankdbl', () => { const c = mat.clone(); c.side = THREE.DoubleSide; return c; });
    // podium (wider than building)
    this.box(x, 0, z, w + 2, 1, d + 2, mat, solid, ry);
    // back wall
    this.box(l2w(0, -hd).x, 1, l2w(0, -hd).z, w, h, t, mat, solid, ry);
    // left wall
    this.box(l2w(-hw, 0).x, 1, l2w(-hw, 0).z, t, h, d, mat, solid, ry);
    // right wall
    this.box(l2w(hw, 0).x, 1, l2w(hw, 0).z, t, h, d, mat, solid, ry);
    // front wall: left segment
    const doorW = 2.4, doorH = 3.2, pillarGap = doorW;
    const frontSegW = (w - pillarGap) / 2;
    this.box(l2w(-hw + frontSegW / 2, hd).x, 1, l2w(-hw + frontSegW / 2, hd).z, frontSegW, h, t, mat, solid, ry);
    // front wall: right segment
    this.box(l2w(hw - frontSegW / 2, hd).x, 1, l2w(hw - frontSegW / 2, hd).z, frontSegW, h, t, mat, solid, ry);
    // front wall: lintel above door
    const lintelH = h - doorH;
    this.box(l2w(0, hd).x, 1 + doorH + lintelH / 2, l2w(0, hd).z, pillarGap, lintelH, t, mat, solid, ry);
    // facade textures on all walls
    this._applyFacade(x, z, w, h, d, ry, ['x', '-x', 'z', '-z'], 'office', seed);
    // entrance steps (4-5 wide steps)
    for (let i = 0; i < 5; i++) {
      const s = l2w(0, hd + 0.55 + i * 0.5);
      this.box(s.x, i * 0.2, s.z, 5.5 - i * 0.5, 0.2, 0.6, mat, solid, ry);
    }
    // colonnade: 8 round columns on the front
    const numCols = 8;
    const colSpacing = (w - 3) / (numCols - 1);
    for (let c = 0; c < numCols; c++) {
      const lx = -hw + 1.5 + c * colSpacing;
      const cp = l2w(lx, hd + 1.2);
      // column base
      this.box(cp.x, 1, cp.z, 0.9, 0.5, 0.9, mat, solid, ry);
      // column shaft
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, h * 0.7, 20), mat);
      col.position.set(cp.x, 1 + h * 0.35, cp.z);
      col.castShadow = true;
      this.group.add(col);
      // column capital
      this.box(cp.x, 1 + h * 0.7, cp.z, 0.85, 0.35, 0.85, mat, solid, ry);
    }
    // pediment: triangular gable over the portico
    const ph = h * 0.22, pb = w * 0.65;
    const shape = new THREE.Shape();
    shape.moveTo(-pb / 2, 0);
    shape.lineTo(pb / 2, 0);
    shape.lineTo(0, ph);
    shape.closePath();
    const pedGeo = new THREE.ShapeGeometry(shape);
    const pp = l2w(0, hd + 0.8);
    const ped = new THREE.Mesh(pedGeo, dbl);
    ped.position.set(pp.x, 1 + h, pp.z);
    ped.rotation.y = ry;
    ped.castShadow = true;
    this.group.add(ped);
    // pediment base beam
    this.box(pp.x, 1 + h - 0.02, pp.z, pb, 0.18, 0.55, mat, solid, ry);
    // heavy cornice/trim at roofline
    this.box(x, 1 + h, z, w + 1.2, 0.3, d + 1.2, mat, solid, ry);
    this.box(x, 1 + h + 0.15, z, w + 0.6, 0.15, d + 0.6, mat, solid, ry);
    // roof slab
    this.box(x, 1 + h + 0.3, z, w + 0.4, 0.35, d + 0.4, this.mRoof(), solid, ry);
    this.roofProps(x, z, ry, w, d, 1 + h + 0.65);
    // door leaf
    this._facadeDoor(x, z, w, d, ry, 2.4, this.mDoor([120, 92, 62]));
    // interior
    this.addInterior(new THREE.Vector3(x - hw, 1, z - hd), new THREE.Vector3(x + hw, 1 + h, z + hd));
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2.5));
    this.namedLocations.push({ x, z, name: 'BANK', color: '#ffe08a' });
  };
}
