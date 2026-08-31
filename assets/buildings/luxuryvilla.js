// Asset: LuxuryVilla — Vice City / Starfish Island modern waterfront mansion with pool deck & glass balconies.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installLuxuryVilla(World) {
  World.prototype.luxuryVilla = function (x, z, ry = 0, w = 22, d = 18, solid = true, seed = 1) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    const wallMat = this._sceneMat({ m: 'concrete', c: [242, 240, 235] });
    const woodMat = this.mWoodDeck();
    const glassMat = this.mModernGlass();
    const poolMat = this.mOcean();
    const roofMat = this.mRoof();
    const accentMat = this._sceneMat({ m: 'concrete', c: [55, 60, 68] }); // charcoal accent

    // Main Ground Floor (14w x 12d x 3.6h)
    const gH = 3.6;
    const gW = w * 0.65, gD = d * 0.65;
    const gPos = l2w(-w * 0.12, -d * 0.12);
    this.box(gPos.x, 0, gPos.z, gW, gH, gD, wallMat, solid, ry);

    // Large glass sliding doors and floor-to-ceiling windows on ground floor
    const gFront = l2w(-w * 0.12, -d * 0.12 + gD / 2 + 0.05);
    this.box(gFront.x, 0.2, gFront.z, gW * 0.7, gH - 0.4, 0.2, glassMat, false, ry);

    // Cantilevered 2nd Floor (Slightly rotated/offset for modern architectural look)
    const uH = 3.4;
    const uW = w * 0.7, uD = d * 0.6;
    const uPos = l2w(-w * 0.05, 0);
    this.box(uPos.x, gH, uPos.z, uW, uH, uD, wallMat, solid, ry);

    // Cantilever support column
    const colPos = l2w(uW * 0.35 - w * 0.05, uD * 0.35);
    this.box(colPos.x, 0, colPos.z, 0.6, gH, 0.6, accentMat, solid, ry);

    // 2nd floor panoramic glass wall
    const uFront = l2w(-w * 0.05, uD / 2 + 0.05);
    this.box(uFront.x, gH + 0.2, uFront.z, uW * 0.8, uH - 0.4, 0.2, glassMat, false, ry);

    // 2nd Floor Balcony with Glass Railing
    const balW = uW * 0.85, balD = 3.2;
    const balPos = l2w(-w * 0.05, uD / 2 + balD / 2);
    this.box(balPos.x, gH, balPos.z, balW, 0.3, balD, woodMat, solid, ry);
    // Glass railings around balcony
    const railFront = l2w(-w * 0.05, uD / 2 + balD);
    this.box(railFront.x, gH + 0.3, railFront.z, balW, 1.0, 0.1, glassMat, solid, ry);

    // Roof overhang & solar canopy
    this.box(uPos.x, gH + uH, uPos.z, uW + 1.2, 0.35, uD + 1.2, roofMat, true, ry);

    // Swimming Pool Deck (Wood / Travertine)
    const poolDeckW = w * 0.9, poolDeckD = d * 0.55;
    const deckPos = l2w(w * 0.05, d * 0.22);
    this.box(deckPos.x, 0, deckPos.z, poolDeckW, 0.2, poolDeckD, woodMat, false, ry);

    // Infinity Swimming Pool (sunken look with water surface)
    const poolW = poolDeckW * 0.55, poolD = poolDeckD * 0.6;
    const poolPos = l2w(w * 0.15, d * 0.25);
    // Pool coping border
    this.box(poolPos.x, 0.05, poolPos.z, poolW + 0.6, 0.22, poolD + 0.6, wallMat, false, ry);
    // Pool water surface
    this.box(poolPos.x, 0.18, poolPos.z, poolW, 0.1, poolD, poolMat, false, ry);

    // Sun Loungers by the pool
    for (let i = -1; i <= 1; i++) {
      const loungerPos = l2w(-w * 0.15 + i * 2.2, d * 0.28);
      this.box(loungerPos.x, 0.2, loungerPos.z, 0.8, 0.35, 1.8, accentMat, false, ry);
      // Headrest incline
      this.box(loungerPos.x, 0.35, loungerPos.z - 0.7, 0.8, 0.25, 0.5, wallMat, false, ry);
    }

    // Modern Entrance Gate & Perimeter Wall Pillars
    const wallLeft = l2w(-w * 0.45, -d * 0.45);
    const wallRight = l2w(w * 0.45, -d * 0.45);
    this.box(wallLeft.x, 0, wallLeft.z, 1.2, 2.4, 1.2, accentMat, true, ry);
    this.box(wallRight.x, 0, wallRight.z, 1.2, 2.4, 1.2, accentMat, true, ry);

    this.addInterior(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, gH + uH, z + d / 2));
    this.coverPoints.push(new THREE.Vector3(x, 0, z));
    this.lootPoints.push({ x, z });
    this.namedLocations.push({ x, z, name: 'LUXURY VILLA', color: '#ffdd80' });
  };
}
