// Asset: AirportHangar — Leonida International airport hangar & air traffic control tower.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installAirportHangar(World) {
  World.prototype.airportHangar = function (x, z, ry = 0, w = 34, d = 26, solid = true, seed = 1) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    const wallMat = this._sceneMat({ m: 'corrugated', c: [180, 185, 192] });
    const roofMat = this._sceneMat({ m: 'metal', c: [140, 145, 150] });
    const darkMat = this._sceneMat({ m: 'concrete', c: [55, 58, 62] });
    const glassMat = this.mModernGlass();

    const h = 10.5;

    // Main Aviation Hangar Body
    this.box(x, 0, z, w, h, d, wallMat, solid, ry);

    // Giant Sliding Aircraft Doors on front face (+Z)
    const doorPos = l2w(0, d / 2 + 0.15);
    this.box(doorPos.x, 0, doorPos.z, w * 0.8, h * 0.82, 0.3, this.mRoller(), solid, ry);

    // Structural Top Trusses & Arched Roof Cap
    this.box(x, h, z, w + 1.2, 1.2, d + 1.2, roofMat, true, ry);

    // Air Traffic Control Tower (attached on the side)
    const towerW = 6.5, towerD = 6.5, towerH = 19.0;
    const towerPos = l2w(w / 2 + towerW / 2 - 1.0, 0);
    // Tower Shaft
    this.box(towerPos.x, 0, towerPos.z, towerW, towerH - 4.5, towerD, darkMat, solid, ry);

    // Tower 360-degree Glass Control Cab (flared out)
    const cabPos = l2w(w / 2 + towerW / 2 - 1.0, 0);
    const cabY = towerH - 4.5;
    this.box(cabPos.x, cabY, cabPos.z, towerW + 1.8, 3.6, towerD + 1.8, glassMat, false, ry);

    // Tower Roof & Radar Antenna Mast
    this.box(cabPos.x, towerH - 0.9, cabPos.z, towerW + 2.0, 0.9, towerD + 2.0, darkMat, true, ry);
    // Radar Dish
    const radarPos = l2w(w / 2 + towerW / 2 - 1.0, 0);
    this.box(radarPos.x, towerH, radarPos.z, 0.3, 3.2, 0.3, this.mMetal(), false, ry);
    this.box(radarPos.x, towerH + 2.4, radarPos.z, 2.4, 1.2, 0.4, this.mMetal(), false, ry);
    // Beacon Light
    this.box(radarPos.x, towerH + 3.3, radarPos.z, 0.4, 0.4, 0.4, this.mNeon('#ff2020', '•'), false, ry);

    this.addRoof(x, z, h, w / 2, d / 2);
    this.addRoof(towerPos.x, towerPos.z, towerH, towerW / 2, towerD / 2);
    this.addInterior(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2));
    this.coverPoints.push(new THREE.Vector3(x, 0, z + d / 2 + 4));
    this.lootPoints.push({ x: towerPos.x, z: towerPos.z });
    this.namedLocations.push({ x, z, name: 'AIRPORT HANGAR', color: '#ffd24a' });
  };
}
