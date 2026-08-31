// Asset: MarinaPier — Vice City marina boardwalk, boat slips & docked luxury yacht.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installMarinaPier(World) {
  World.prototype.marinaPier = function (x, z, ry = 0, w = 32, d = 26, solid = true, seed = 1) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    const deckMat = this.mWoodDeck();
    const pileMat = this._sceneMat({ m: 'wood', c: [70, 52, 38] });
    const whiteMat = this._sceneMat({ m: 'concrete', c: [245, 245, 250] });
    const glassMat = this.mModernGlass();
    const darkMat = this._sceneMat({ m: 'concrete', c: [40, 44, 50] });

    // Main Boardwalk Spine (32w x 4.5d x 0.4h) raised 1.2m above water
    const deckY = 0.8;
    this.box(x, deckY, z, w, 0.4, 5.0, deckMat, solid, ry);

    // Pilings supporting the main boardwalk
    for (let px = -w * 0.45; px <= w * 0.45; px += 4.0) {
      for (const pz of [-2.0, 2.0]) {
        const pil = l2w(px, pz);
        this.box(pil.x, 0, pil.z, 0.4, deckY + 0.4, 0.4, pileMat, false, ry);
      }
    }

    // 3 Pier "Fingers" extending out into the water (+Z)
    for (let f = -1; f <= 1; f++) {
      const fx = f * (w * 0.35);
      const fingerPos = l2w(fx, 9.0);
      this.box(fingerPos.x, deckY, fingerPos.z, 2.4, 0.35, 14.0, deckMat, solid, ry);

      // Mooring Bollards / Cleats at pier finger tips
      const tipPos = l2w(fx, 15.5);
      this.box(tipPos.x, deckY + 0.35, tipPos.z, 0.3, 0.6, 0.3, this.mMetal(), true, ry);

      // Piling posts along finger
      for (let pz = 4.0; pz <= 15.0; pz += 3.5) {
        for (const sx of [-1.0, 1.0]) {
          const fPil = l2w(fx + sx, pz);
          this.box(fPil.x, 0, fPil.z, 0.3, deckY + 0.8, 0.3, pileMat, false, ry);
        }
      }
    }

    // Docked Luxury Yacht at the center slip
    const yachtX = 0, yachtZ = 9.5;
    const yachtPos = l2w(yachtX + 5.5, yachtZ);
    // Yacht Hull (Sleek aerodynamic shape)
    this.box(yachtPos.x, 0.3, yachtPos.z, 4.0, 1.8, 11.0, whiteMat, true, ry);
    // Yacht Cabin / Flybridge
    const cabPos = l2w(yachtX + 5.5, yachtZ - 1.0);
    this.box(cabPos.x, 2.1, cabPos.z, 3.2, 1.4, 6.0, whiteMat, true, ry);
    // Yacht Tinted Windows
    this.box(cabPos.x, 2.3, cabPos.z + 2.0, 3.0, 0.8, 2.0, glassMat, false, ry);
    // Yacht Radar Arch
    const archPos = l2w(yachtX + 5.5, yachtZ - 3.2);
    this.box(archPos.x, 3.5, archPos.z, 2.8, 0.8, 0.6, darkMat, false, ry);

    // Marina Office / Clubhouse on land side (-Z)
    const officePos = l2w(-w * 0.28, -6.0);
    this.box(officePos.x, deckY, officePos.z, 10.0, 4.2, 8.0, whiteMat, solid, ry);
    // Office Glass Wall overlooking the marina
    const offFront = l2w(-w * 0.28, -2.1);
    this.box(offFront.x, deckY + 0.2, offFront.z, 8.0, 3.6, 0.2, glassMat, false, ry);

    this.coverPoints.push(new THREE.Vector3(x, deckY, z));
    this.lootPoints.push({ x: yachtPos.x, z: yachtPos.z });
    this.namedLocations.push({ x, z, name: 'MARINA PIER', color: '#40b0ff' });
  };
}
