// Asset: Nightclub — Vice City VIP nightclub & casino with neon facade accents & rooftop lounge.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installNightclub(World) {
  World.prototype.nightclub = function (x, z, ry = 0, w = 22, d = 20, solid = true, seed = 1) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    const darkWallMat = this._sceneMat({ m: 'concrete', c: [24, 25, 30] });
    const goldMat = this._sceneMat({ m: 'metal', c: [218, 175, 55] });
    const glassMat = this.mModernGlass();
    const neonPink = this.mNeon('#ff2a85', 'MALIBU');
    const neonCyan = this.mNeon('#00f0ff', 'CLUB');
    const roofMat = this.mRoof();

    const h = 7.5;

    // Main 2-story Club Box
    this.box(x, 0, z, w, h, d, darkWallMat, solid, ry);

    // Cantilevered VIP Entrance Canopy
    const canPos = l2w(0, d / 2 + 2.0);
    this.box(canPos.x, 3.8, canPos.z, 8.0, 0.4, 4.0, goldMat, true, ry);

    // Glowing Neon Marquee above canopy
    const marqPos = l2w(0, d / 2 + 0.1);
    this.box(marqPos.x, 4.5, marqPos.z, 7.5, 2.2, 0.2, neonPink, false, ry);

    // Neon Cyan Accent Strip along roofline
    const roofStrip = l2w(0, d / 2 + 0.1);
    this.box(roofStrip.x, h - 0.2, roofStrip.z, w + 0.2, 0.35, 0.2, neonCyan, false, ry);

    // Double Glass Entrance Doors
    const doorPos = l2w(0, d / 2 + 0.05);
    this.box(doorPos.x, 0, doorPos.z, 3.6, 2.8, 0.15, glassMat, false, ry);

    // VIP Velvet Stanchions & Red Carpet
    const carpetPos = l2w(0, d / 2 + 2.2);
    this.box(carpetPos.x, 0.02, carpetPos.z, 2.4, 0.04, 4.5, this._sceneMat({ m: 'concrete', c: [180, 20, 40] }), false, ry);

    for (const sx of [-1.5, 1.5]) {
      for (let sz = 1.0; sz <= 4.0; sz += 1.5) {
        const postPos = l2w(sx, d / 2 + sz);
        this.box(postPos.x, 0, postPos.z, 0.15, 1.0, 0.15, goldMat, false, ry);
      }
    }

    // Rooftop VIP Lounge & Bar
    const barPos = l2w(-w * 0.2, 0);
    this.box(barPos.x, h, barPos.z, 5.0, 1.1, 2.0, goldMat, true, ry);
    this.box(barPos.x, h + 1.1, barPos.z, 5.2, 0.1, 2.2, darkWallMat, true, ry);

    // Rooftop Perimeter Glass Railing
    this.box(x, h, z, w + 0.4, 1.1, d + 0.4, glassMat, true, ry);
    this.addRoof(x, z, h, w / 2, d / 2);
    this.addInterior(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2));
    this.coverPoints.push(new THREE.Vector3(x, 0, z + d / 2 + 2));
    this.lootPoints.push({ x, z });
    this.namedLocations.push({ x, z, name: 'NIGHTCLUB', color: '#ff40ff' });
  };
}
