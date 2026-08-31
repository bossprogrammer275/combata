// Asset: Stadium — oval bowl with floodlight pylons and roof ring.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installStadium(World) {
  World.prototype.stadium = function (x, z, ry = 0, solid = true, seed = 1) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const rx = 24, rz = 17, wallH = 9;
    const wallMat = this.mPanel([168, 168, 164]);
    const segs = 28;
    for (let i = 0; i < segs; i++) {
      const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
      const p0 = l2w(Math.cos(a0) * rx, Math.sin(a0) * rz);
      const p1 = l2w(Math.cos(a1) * rx, Math.sin(a1) * rz);
      const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
      const segLen = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const ang = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(segLen + .3, wallH, .6), wallMat);
      seg.position.set(mx, wallH / 2, mz);
      seg.rotation.y = ang;
      seg.castShadow = true;
      this.group.add(seg);
    }
    // roof ring
    const roofMat = this.mShingle([90, 96, 104]);
    for (let i = 0; i < segs; i++) {
      const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
      const p0 = l2w(Math.cos(a0) * (rx + 1.5), Math.sin(a0) * (rz + 1.5));
      const p1 = l2w(Math.cos(a1) * (rx + 1.5), Math.sin(a1) * (rz + 1.5));
      const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
      const segLen = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const ang = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(segLen + .3, .5, 2.2), roofMat);
      seg.position.set(mx, wallH + .3, mz);
      seg.rotation.y = ang;
      seg.castShadow = true;
      this.group.add(seg);
    }
    // four floodlight pylons
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a5e64, roughness: .6, metalness: .5 });
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffcf70, emissiveIntensity: .8 });
    for (const [px, pz] of [[rx + 3, 0], [-rx - 3, 0], [0, rz + 3], [0, -rz - 3]]) {
      const pp = l2w(px, pz);
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(.3, .5, 16, 16), poleMat);
      pylon.position.set(pp.x, 8, pp.z); pylon.castShadow = true; this.group.add(pylon);
      const lightHead = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, .8), lightMat);
      lightHead.position.set(pp.x, 15.6, pp.z); lightHead.rotation.y = ry; this.group.add(lightHead);
    }
    // pitch
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(rx * 1.7, rz * 1.7), this._sceneMat('plaza'));
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(x, .02, z);
    pitch.receiveShadow = true;
    this.group.add(pitch);
    this.coverPoints.push(this.frontPoint(x, z, ry, rz + 4));
    this.namedLocations.push({ x, z, name: 'STADIUM', color: '#ffd24a' });
  };
}
