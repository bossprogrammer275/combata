// Asset: PoliceStation — Vice City / Leonida Police Precinct with antenna mast & secure bays.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installPoliceStation(World) {
  World.prototype.policeStation = function (x, z, ry = 0, w = 24, d = 18, solid = true, seed = 1) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    const wallMat = this._sceneMat({ m: 'concrete', c: [215, 218, 222] });
    const blueMat = this._sceneMat({ m: 'metal', c: [30, 80, 150] });
    const darkMat = this._sceneMat({ m: 'concrete', c: [50, 52, 58] });
    const glassMat = this.mModernGlass();
    const roofMat = this.mRoof();
    const neonMat = this.mNeon('#3080ff', 'POLICE');

    const h = 8.0;

    // Main 2-story Precinct Building
    this.box(x, 0, z, w, h, d, wallMat, solid, ry);

    // Blue Civic Accent Band across facade
    const bandPos = l2w(0, d / 2 + 0.08);
    this.box(bandPos.x, 4.0, bandPos.z, w + 0.1, 0.8, 0.2, blueMat, false, ry);

    // Police Signboard above entrance
    const signPos = l2w(-w * 0.15, d / 2 + 0.15);
    this.box(signPos.x, 5.2, signPos.z, 6.0, 1.8, 0.2, neonMat, false, ry);

    // Front Glass Entrance with Pillars
    const entPos = l2w(-w * 0.15, d / 2 + 0.05);
    this.box(entPos.x, 0, entPos.z, 5.0, 3.2, 0.2, glassMat, false, ry);

    // Covered Cruiser Intake Bay / Garage Wing
    const garPos = l2w(w * 0.32, d * 0.1);
    this.box(garPos.x, 0, garPos.z, 7.0, 4.5, 9.0, darkMat, solid, ry);
    // Garage Roller Door
    const rollPos = l2w(w * 0.32, d * 0.1 + 4.55);
    this.box(rollPos.x, 0, rollPos.z, 5.5, 3.8, 0.2, this.mRoller(), false, ry);

    // Communications Antenna Mast on Roof
    const antPos = l2w(-w * 0.3, -d * 0.25);
    this.box(antPos.x, h, antPos.z, 0.4, 7.0, 0.4, this.mMetal(), false, ry);
    // Antenna cross-arms
    this.box(antPos.x, h + 5.0, antPos.z, 2.2, 0.15, 0.15, this.mMetal(), false, ry);
    this.box(antPos.x, h + 6.5, antPos.z, 1.4, 0.15, 0.15, this.mMetal(), false, ry);
    // Red beacon light on mast tip
    this.box(antPos.x, h + 7.1, antPos.z, 0.3, 0.3, 0.3, this.mNeon('#ff2020', '•'), false, ry);

    // Security Bollards along front
    for (let bx = -w * 0.45; bx <= w * 0.45; bx += 3.0) {
      const bolPos = l2w(bx, d / 2 + 2.5);
      this.box(bolPos.x, 0, bolPos.z, 0.3, 0.9, 0.3, this.mMetal(), true, ry);
    }

    this.addRoof(x, z, h, w / 2, d / 2);
    this.addInterior(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2));
    this.coverPoints.push(new THREE.Vector3(x, 0, z + d / 2 + 2));
    this.lootPoints.push({ x: antPos.x, z: antPos.z });
    this.namedLocations.push({ x, z, name: 'POLICE STATION', color: '#4080ff' });
  };
}
