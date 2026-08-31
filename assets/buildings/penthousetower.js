// Asset: PenthouseTower — Soaring luxury glass skyscraper with rooftop helipad & sky terrace.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installPenthouseTower(World) {
  World.prototype.penthouseTower = function (x, z, ry = 0, floors = 7, w = 18, d = 18, solid = true, seed = 1) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    const fh = 3.6;
    const totalH = floors * fh;
    const coreMat = this._sceneMat({ m: 'concrete', c: [50, 54, 62] });
    const glassMat = this.mModernGlass();
    const heliMat = this._sceneMat({ m: 'concrete', c: [38, 40, 44] });
    const heliMarkMat = this.mNeon('#ffd24a', 'H');
    const roofMat = this.mRoof();

    // 1. Tower Base / Entrance Lobby (Floor 0 to 1)
    this.box(x, 0, z, w + 2.0, fh, d + 2.0, coreMat, solid, ry);
    // Lobby Glass Curtain Wall
    const frontLobby = l2w(0, (d + 2.0) / 2 + 0.05);
    this.box(frontLobby.x, 0.2, frontLobby.z, w * 0.8, fh - 0.4, 0.15, glassMat, false, ry);
    // Entrance Cantilevered Canopy
    const canPos = l2w(0, (d + 2.0) / 2 + 2.2);
    this.box(canPos.x, fh - 0.3, canPos.z, 8.0, 0.3, 4.2, coreMat, true, ry);

    // 2. Main Glass Tower Shaft
    this.box(x, fh, z, w, totalH - fh, d, glassMat, solid, ry);

    // Architectural Spine Ribs (4 vertical column lines)
    for (const sx of [-w / 2, w / 2]) {
      for (const sz of [-d / 2, d / 2]) {
        const col = l2w(sx, sz);
        this.box(col.x, fh, col.z, 0.8, totalH - fh, 0.8, coreMat, false, ry);
      }
    }

    // Mid-Tower Setback / Sky Garden Terrace (around floor 4)
    if (floors >= 6) {
      const midH = fh * 4;
      const deckPos = l2w(0, d / 2 + 1.2);
      this.box(deckPos.x, midH, deckPos.z, w * 0.8, 0.4, 2.4, this.mWoodDeck(), solid, ry);
      this.box(deckPos.x, midH + 0.4, deckPos.z + 1.1, w * 0.8, 1.0, 0.1, glassMat, false, ry);
    }

    // 3. Rooftop Crown & Helipad
    this.box(x, totalH, z, w + 0.6, 0.6, d + 0.6, coreMat, true, ry);

    // Raised Helipad Platform (14x14)
    const heliW = w * 0.8, heliD = d * 0.8;
    this.box(x, totalH + 0.6, z, heliW, 0.4, heliD, heliMat, true, ry);

    // Illuminated "H" Helipad Target Marker
    this.box(x, totalH + 1.02, z, 5.0, 0.05, 5.0, heliMarkMat, false, ry);

    // Helipad Perimeter Safety Netting / Railing
    this.box(x, totalH + 0.8, z, heliW + 0.6, 0.6, heliD + 0.6, this.mMetal(), true, ry);

    // Rooftop Elevator Penthouse & A/C Chillers
    const liftPos = l2w(-w * 0.25, -d * 0.25);
    this.box(liftPos.x, totalH + 0.6, liftPos.z, 4.5, 3.2, 4.5, coreMat, true, ry);
    // Chiller Box
    const chillPos = l2w(w * 0.25, -d * 0.25);
    this.box(chillPos.x, totalH + 0.6, chillPos.z, 3.5, 1.6, 3.0, this._sceneMat({ m: 'metal', c: [110, 115, 120] }), true, ry);

    this.addRoof(x, z, totalH + 1.0, heliW / 2, heliD / 2);
    this.addInterior(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, totalH, z + d / 2));
    this.coverPoints.push(new THREE.Vector3(x, totalH + 1.0, z));
    this.coverPoints.push(new THREE.Vector3(x, 0, z + (d + 2.0) / 2 + 2));
    this.lootPoints.push({ x, z: z, y: totalH + 1.0 });
    this.namedLocations.push({ x, z, name: 'PENTHOUSE TOWER', color: '#88ccff' });
  };
}
