// Asset: Enterablecontainer — hollow shipping container with doors on both short sides.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installEnterableContainer(World) {
  World.prototype.enterableContainer = function (x, z, ry, cm) {
    const w = 4, h = 2.6, d = 2.4, t = 0.06, dw = 1.6;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });
    const fw = (w - dw) / 2;
    // left wall
    const L = l2w(-w / 2, 0); this.box(L.x, 0, L.z, t, h, d, cm, true, ry);
    // right wall
    const R = l2w(w / 2, 0); this.box(R.x, 0, R.z, t, h, d, cm, true, ry);
    // back wall (solid)
    const B = l2w(0, -d / 2); this.box(B.x, 0, B.z, w, h, t, cm, true, ry);
    // front-left panel (door gap in center)
    const FL = l2w(-w / 2 + fw / 2, d / 2); this.box(FL.x, 0, FL.z, fw, h, t, cm, true, ry);
    // front-right panel
    const FR = l2w(w / 2 - fw / 2, d / 2); this.box(FR.x, 0, FR.z, fw, h, t, cm, true, ry);
    // roof
    this.box(x, h - t / 2, z, w - t * 2, t, d - t * 2, cm, true, ry);
    // interior volume (axis-aligned approximation)
    this.addInterior(new THREE.Vector3(x - w / 2 + t, 0, z - d / 2 + t),
                     new THREE.Vector3(x + w / 2 - t, h, z + d / 2 - t));
  };
}
