// Asset: Wreck — wrecked vehicle prop with twisted metal and broken parts.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installWreck(World) {
  World.prototype._propWreck = function (x, z, ry, p, react) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    const bodyMat = this.mMetal([90, 85, 80]);
    const rustMat = this.mMetal([120, 60, 40]);
    const glassMat = this.mGlass();
    const tireMat = this._sceneMat({ m: 'rubber', c: [30, 30, 30] });

    // Wrecked car body — tilted and partially crushed
    const bw = 2.0, bd = 4.2, bh = 1.0;
    const body = this.box(x, 0.3, z, bw, bh, bd, rustMat, false, ry);

    // Crushed roof (tilted down on one side)
    this.box(x + 0.3 * sn, 1.1, z + 0.3 * cs, bw * 0.85, 0.15, bd * 0.6, bodyMat, false, ry + 0.15);

    // Broken windshield (angled glass shard)
    const glassPos = l2w(0, bd * 0.25);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(bw * 0.7, 0.9),
      glassMat
    );
    glass.position.set(glassPos.x, 1.0, glassPos.z);
    glass.rotation.set(-0.3, ry, 0);
    this.group.add(glass);

    // Door panel hanging off
    const doorPos = l2w(bw / 2 + 0.2, 0);
    this.box(doorPos.x, 0.2, doorPos.z, 0.08, bh * 0.8, bd * 0.45, bodyMat, false, ry + 0.4);

    // Two wheels on one side, one missing on the other
    const wheelPositions = [
      [-bw / 2, -bd * 0.35],
      [-bw / 2, bd * 0.35],
      [bw / 2, -bd * 0.35],
    ];
    for (const [wlx, wlz] of wheelPositions) {
      const wp = l2w(wlx, wlz);
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12),
        tireMat
      );
      wheel.position.set(wp.x, 0.35, wp.z);
      wheel.rotation.set(Math.PI / 2, 0, ry);
      wheel.castShadow = true;
      this.group.add(wheel);
    }

    // Scrap metal pieces scattered around
    for (let i = 0; i < 3; i++) {
      const ox = (Math.random() - 0.5) * 3;
      const oz = (Math.random() - 0.5) * 3;
      const sp = l2w(ox, oz);
      const sw = 0.3 + Math.random() * 0.6;
      this.box(sp.x, 0.05, sp.z, sw, 0.08, sw * 0.5, bodyMat, false, Math.random() * Math.PI);
    }

    // Push into ground slightly for a buried look
    this.coverPoints.push(new THREE.Vector3(x, 0, z));
  };
}
