// Asset: Tree — procedural trunk/fork/leaf tree or dead tree.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installTree(World) {
  World.prototype.tree = function (x, z, scale = 1, dead = false) {
    const rng = (a, b) => a + Math.random() * (b - a);
    const h = (dead ? 4.5 : 7 + Math.random() * 5) * scale;
    const rBase = (dead ? .13 : .20 + Math.random() * .12) * scale;
    const UP = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();

    const seg = (ax, ay, az, bx, by, bz, r0, r1) => {
      const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
      const dir = b.clone().sub(a); const len = dir.length(); dir.normalize();
      q.setFromUnitVectors(UP, dir);
      this._branches.push({
        pos: [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2],
        quat: [q.x, q.y, q.z, q.w],
        scale: [r0, len, r0]
      });
      return b;
    };

    const lean = rng(-0.10, 0.10);
    const topX = x + lean * h, topZ = z;
    seg(x, 0, z, topX, h, topZ, rBase, rBase * 0.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rng(-.3, .3);
      const rl = (.6 + Math.random() * .5) * scale;
      seg(x + Math.sin(a) * rBase, 0.05 * scale, z + Math.cos(a) * rBase,
          x + Math.sin(a) * (rBase + rl), 0.0, z + Math.cos(a) * (rBase + rl),
          rBase * 0.5, 0.04 * scale);
    }

    const fork = (ox, oy, oz, len, el, az, depth, onTip) => {
      const dir = new THREE.Vector3(Math.sin(el) * Math.sin(az), Math.cos(el), Math.sin(el) * Math.cos(az));
      const tip = new THREE.Vector3(ox, oy, oz).addScaledVector(dir, len);
      seg(ox, oy, oz, tip.x, tip.y, tip.z,
          rBase * Math.max(.12, .5 - depth * .12), rBase * Math.max(.06, .35 - depth * .1));
      if (onTip) onTip(tip.x, tip.y, tip.z);
      if (depth > 0) {
        const nb = 2 + (Math.random() < .5 ? 1 : 0);
        for (let i = 0; i < nb; i++)
          fork(tip.x, tip.y, tip.z, len * .72, el + rng(-.35, .35), az + rng(.5, 1.2) * (i % 2 ? 1 : -1), depth - 1, onTip);
      }
    };

    if (dead) {
      for (let i = 0; i < 4; i++)
        fork(topX, h * rng(.55, .7), topZ, (1.6 + Math.random()) * scale, rng(.5, .9), (i / 4) * Math.PI * 2 + rng(-.4, .4), 2, null);
      this.addCollider(x, 0, z, rBase * 2.2, h, rBase * 2.2);
      return;
    }

    const ci = Math.floor(rng(0, 3)) % 3;
    const addCanopy = (cx, cy, cz, rad) => {
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const o = new THREE.Vector3(rng(-1, 1), rng(-.6, 1), rng(-1, 1)).normalize().multiplyScalar(rad * rng(.2, .9));
        const s = rad * rng(.6, 1.0);
        this._leaves.push({ pos: [cx + o.x, cy + o.y, cz + o.z], scale: [s, s * rng(.8, 1.1), s], color: [ci, 0, 0] });
      }
    };

    addCanopy(topX, h + .8 * scale, topZ, 2.2 * scale);
    const nMain = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nMain; i++)
      fork(topX, h * rng(.6, .78), topZ, (1.8 + Math.random() * .8) * scale, rng(.5, .95), (i / nMain) * Math.PI * 2 + rng(-.3, .3), 2, addCanopy);

    this.addCollider(x, 0, z, rBase * 2.4, h * .5, rBase * 2.4);
  };
}
