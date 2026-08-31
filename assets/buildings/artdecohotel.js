// Asset: ArtDecoHotel — Iconic Ocean Drive / Miami Vice Streamline Moderne hotel with neon spire & striped terrace.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installArtDecoHotel(World) {
  World.prototype.artDecoHotel = function (x, z, ry = 0, w = 18, d = 16, solid = true, seed = 1) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    const pastelType = (seed % 2 === 0) ? 'teal' : 'pink';
    const mainMat = this.mArtDeco(pastelType);
    const trimMat = this._sceneMat({ m: 'concrete', c: [255, 255, 255] });
    const glassMat = this.mModernGlass();
    const roofMat = this.mRoof();
    const neonMat = this.mNeon(pastelType === 'pink' ? '#ff2a85' : '#00f0ff', 'HOTEL');
    const awningMat = this._sceneMat({ m: 'corrugated', c: [40, 180, 210] });

    const floors = 3;
    const fh = 3.2;
    const totalH = floors * fh;

    // Main 3-story hotel block
    this.box(x, 0, z, w, totalH, d, mainMat, solid, ry);

    // Front curved balconies on each floor
    for (let f = 1; f <= floors; f++) {
      const by = (f - 1) * fh;
      // Balcony ledge
      const bFront = l2w(0, d / 2 + 1.2);
      this.box(bFront.x, by, bFront.z, w * 0.75, 0.35, 2.4, trimMat, solid, ry);
      // Balcony railing
      const rFront = l2w(0, d / 2 + 2.3);
      this.box(rFront.x, by + 0.35, rFront.z, w * 0.75, 0.9, 0.15, trimMat, solid, ry);
      // Windows / Doors
      const winPos = l2w(0, d / 2 + 0.05);
      this.box(winPos.x, by + 0.5, winPos.z, w * 0.7, 2.2, 0.1, glassMat, false, ry);
    }

    // Iconic Center Art-Deco Spire / Fin rising above the roofline
    const finW = 2.4, finD = 1.4, finH = totalH + 4.5;
    const finPos = l2w(0, d / 2 + 0.8);
    this.box(finPos.x, 0, finPos.z, finW, finH, finD, trimMat, true, ry);

    // Neon Vertical Sign on the center fin
    const neonPos = l2w(0, d / 2 + 1.55);
    this.box(neonPos.x, totalH * 0.5, neonPos.z, 1.8, 4.2, 0.15, neonMat, false, ry);

    // Ground Floor Terrace Awning (Striped Cabana style)
    const awnPos = l2w(0, d / 2 + 2.8);
    this.box(awnPos.x, 3.0, awnPos.z, w * 0.9, 0.25, 3.2, awningMat, false, ry);

    // Awning Support Pillars
    for (const sx of [-w * 0.4, -w * 0.15, w * 0.15, w * 0.4]) {
      const pilPos = l2w(sx, d / 2 + 4.2);
      this.box(pilPos.x, 0, pilPos.z, 0.25, 3.0, 0.25, trimMat, false, ry);
    }

    // Rooftop Terrace Parapet & Chill Lounge
    this.box(x, totalH, z, w + 0.4, 0.9, d + 0.4, trimMat, true, ry);
    this.addRoof(x, z, totalH, w / 2, d / 2);
    this.addInterior(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, totalH, z + d / 2));
    this.coverPoints.push(new THREE.Vector3(x, 0, z + d / 2 + 3));
    this.lootPoints.push({ x, z });
    this.namedLocations.push({ x, z, name: 'ART DECO HOTEL', color: '#ff80d0' });
  };
}
