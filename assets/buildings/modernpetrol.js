// Asset: ModernPetrol — 24/7 Vice Gas Station with lit canopy, digital fuel pumps & convenience mart.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installModernPetrol(World) {
  World.prototype.modernPetrol = function (x, z, ry = 0, solid = true, seed = 1) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    const martMat = this._sceneMat({ m: 'concrete', c: [238, 238, 242] });
    const glassMat = this.mModernGlass();
    const canopyMat = this._sceneMat({ m: 'metal', c: [220, 45, 45] }); // Red brand fascia
    const whiteMat = this._sceneMat({ m: 'concrete', c: [255, 255, 255] });
    const darkMat = this._sceneMat({ m: 'concrete', c: [45, 48, 52] });
    const neonMat = this.mNeon('#00f0ff', '24/7 MART');
    const pumpMat = this._sceneMat({ m: 'metal', c: [240, 240, 240] });

    // 1. Convenience Mart Store (back building: -Z)
    const martW = 16.0, martD = 10.0, martH = 4.8;
    const martPos = l2w(0, -9.0);
    this.box(martPos.x, 0, martPos.z, martW, martH, martD, martMat, solid, ry);

    // Mart Glass Shopfront
    const shopFront = l2w(0, -9.0 + martD / 2 + 0.05);
    this.box(shopFront.x, 0.2, shopFront.z, martW * 0.75, martH - 0.4, 0.15, glassMat, false, ry);

    // Mart Luminous Sign
    const signPos = l2w(0, -9.0 + martD / 2 + 0.15);
    this.box(signPos.x, martH + 0.6, signPos.z, 7.0, 1.4, 0.2, neonMat, false, ry);

    // 2. Large Overhead Canopy (front: +Z)
    const canW = 20.0, canD = 12.0, canH = 0.9, canY = 4.8;
    const canPos = l2w(0, 5.0);
    // Canopy fascia & underside
    this.box(canPos.x, canY, canPos.z, canW, canH, canD, canopyMat, true, ry);
    this.box(canPos.x, canY - 0.08, canPos.z, canW - 0.4, 0.1, canD - 0.4, whiteMat, false, ry);

    // 4 Canopy Support Columns
    for (const sx of [-canW * 0.3, canW * 0.3]) {
      for (const sz of [-canD * 0.25, canD * 0.25]) {
        const colPos = l2w(sx, 5.0 + sz);
        this.box(colPos.x, 0, colPos.z, 0.7, canY, 0.7, whiteMat, true, ry);
      }
    }

    // 3. Four Fuel Pump Islands underneath the canopy
    for (const sx of [-canW * 0.3, canW * 0.3]) {
      for (const sz of [-canD * 0.25, canD * 0.25]) {
        const islandPos = l2w(sx, 5.0 + sz);
        // Concrete curb island
        this.box(islandPos.x, 0, islandPos.z, 1.4, 0.22, 3.8, darkMat, false, ry);
        // Pump housing
        this.box(islandPos.x, 0.22, islandPos.z, 0.9, 1.6, 1.8, pumpMat, true, ry);
        // Digital display
        this.box(islandPos.x, 1.2, islandPos.z, 0.92, 0.45, 0.9, darkMat, false, ry);
        // Protective yellow crash bollards
        for (const bz of [-2.1, 2.1]) {
          const bPos = l2w(sx, 5.0 + sz + bz);
          this.box(bPos.x, 0, bPos.z, 0.22, 0.9, 0.22, this._sceneMat({ m: 'metal', c: [255, 215, 0] }), true, ry);
        }
      }
    }

    // 4. Price Totem / Pylon Sign near street
    const pylonPos = l2w(canW * 0.45 + 3.0, 5.0 + canD * 0.4);
    this.box(pylonPos.x, 0, pylonPos.z, 2.2, 7.5, 0.7, canopyMat, true, ry);
    this.box(pylonPos.x, 3.0, pylonPos.z + 0.4, 1.8, 3.0, 0.1, neonMat, false, ry);

    this.addRoof(martPos.x, martPos.z, martH, martW / 2, martD / 2);
    this.addRoof(canPos.x, canPos.z, canY + canH, canW / 2, canD / 2);
    this.addInterior(new THREE.Vector3(martPos.x - martW / 2, 0, martPos.z - martD / 2), new THREE.Vector3(martPos.x + martW / 2, martH, martPos.z + martD / 2));
    this.coverPoints.push(new THREE.Vector3(x, 0, 5.0));
    this.lootPoints.push({ x: martPos.x, z: martPos.z });
    this.namedLocations.push({ x, z, name: 'MODERN PETROL', color: '#40b0ff' });
  };
}
