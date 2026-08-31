// Asset: Warehouse — corrugated metal box with two roller doors, loading dock, skylights, stacked containers.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installWarehouse(World) {
  World.prototype.warehouse = function (x, z, w = 34, d = 22, h = 9, solid = true) {
    const t = 0.6, hw = w / 2, hd = d / 2;
    const mat = this.mCorrugated([122, 126, 122]);
    const doorW = 5, doorH = 4.5, pillarW = 1.8, lintelH = 0.8;
    // back wall
    this.box(x, 0, z - hd, w, h, t, mat, solid, 0);
    // left wall
    this.box(x - hw, 0, z, t, h, d, mat, solid, 0);
    // right wall
    this.box(x + hw, 0, z, t, h, d, mat, solid, 0);
    // front wall: left segment
    const leftSegW = (w - doorW * 2 - pillarW) / 2;
    this.box(x - hw + leftSegW / 2, 0, z + hd, leftSegW, h, t, mat, solid, 0);
    // front wall: middle pillar between doors
    this.box(x, 0, z + hd, pillarW, h, t, mat, solid, 0);
    // front wall: right segment
    this.box(x + hw - leftSegW / 2, 0, z + hd, leftSegW, h, t, mat, solid, 0);
    // lintels above each roller door
    const doorOffset = doorW / 2 + pillarW / 2;
    this.box(x - doorOffset, doorH, z + hd, doorW, lintelH, t, mat, solid, 0);
    this.box(x + doorOffset, doorH, z + hd, doorW, lintelH, t, mat, solid, 0);
    // roller doors
    this.box(x - doorOffset, 0, z + hd + 0.02, doorW, doorH, 0.08, this.mRoller(), false, 0);
    this.box(x + doorOffset, 0, z + hd + 0.02, doorW, doorH, 0.08, this.mRoller(), false, 0);
    // facade textures on side and back walls
    this._applyFacade(x, z, w, h, d, 0, ['x', '-x', '-z'], 'industrial', 7);
    // loading dock platform
    this.box(x, 0.35, z + hd + 2, w * 0.65, 0.7, 3.5, this.mConcrete([140, 138, 132]), false, 0);
    // loading dock ramp edges
    this.box(x - w * 0.325, 0, z + hd + 3.75, 0.4, 0.35, 0.6, this.mConcrete([120, 118, 112]), false, 0);
    this.box(x + w * 0.325, 0, z + hd + 3.75, 0.4, 0.35, 0.6, this.mConcrete([120, 118, 112]), false, 0);
    // skylight strips on the flat roof
    const skyMat = this.mGlass();
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, 0.06, 1.4), skyMat);
      m.position.set(x + (i - 1.5) * w * 0.22, h + 0.42, z - hd * 0.3);
      m.castShadow = true;
      this.group.add(m);
    }
    // roof slab
    this.box(x, h, z, w + 0.4, 0.4, d + 0.4, this.mRoof(), solid, 0);
    this.roofProps(x, z, 0, w, d, h + 0.4);
    // concrete floor slab
    this.box(x, 0.05, z, w - t * 2, 0.15, d - t * 2, new THREE.MeshStandardMaterial({ map: TEX.makeConcreteTexture(512, [130, 128, 124]), roughness: 0.95 }), false);
    // stacked shipping containers
    const contColors = [[150, 60, 45], [60, 90, 110], [95, 100, 70], [120, 70, 120], [60, 110, 90], [140, 100, 50]];
    const spots = [
      [-hw + 5, -hd + 5], [0, -hd + 5], [hw - 5, -hd + 5],
      [-hw + 5, 0], [hw - 5, 0],
      [-hw + 5, hd - 6], [hw - 5, hd - 6]
    ];
    spots.forEach(([ox, oz], i) => {
      const c3 = contColors[i % contColors.length];
      const cm = new THREE.MeshStandardMaterial({ map: TEX.makeMetalTexture(512, c3), roughness: 0.6, metalness: 0.5 });
      this.box(x + ox, 0.2, z + oz, 4, 2.4, 2.4, cm, solid, 0);
      if (i % 2 === 0) this.box(x + ox, 2.8, z + oz, 4, 2.4, 2.4, cm, solid, 0);
    });
    // industrial interior crates and metal boxes
    this.box(x, 0.2, z, 1.6, 1.4, 1.6, this.mCrate(), solid, 0, false, 'fire');
    this.box(x, 0.2, z - hd + 4, 3, 0.9, 1.2, this.mMetal(), solid, 0);
    this.box(x + hw - 4, 0.2, z, 2.2, 1.1, 2.2, this.mCrate(), solid, 0);
    this.box(x - hw + 3, 0.2, z + hd - 4, 2.5, 0.8, 1.8, this.mMetal(), solid, 0);
    this.box(x + 6, 0.2, z - hd + 3, 1.8, 1.3, 1.4, this.mCrate(), solid, 0, false, 'fire');
    // interior
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.coverPoints.push(new THREE.Vector3(x, 0, z));
    this.lootPoints.push({ x: x - hw + 5, z: z - hd + 5 });
    this.lootPoints.push({ x: x + hw - 5, z: z + hd - 5 });
    this.namedLocations.push({ x, z, name: 'WAREHOUSE', color: '#ffd24a' });
  };
}
