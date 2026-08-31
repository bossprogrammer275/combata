// Asset: Palm — Realistic tropical palm tree with curved ringed trunk, coconuts & drooping fronds.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installPalm(World) {
  World.prototype.palm = function (x, z, scale = 1.0, lean = 0.12, ry = 0) {
    const h = (10 + Math.random() * 4) * scale;
    const rBase = (0.26 + Math.random() * 0.08) * scale;
    const trunkMat = this.mPalmTrunk();
    const frondMat = this.mPalmFrond();
    const nutMat = this.mWood();

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const angle = ry || (Math.random() * Math.PI * 2);
    g.rotation.y = angle;

    // Curved trunk segments using smooth cylinders
    const segs = 7;
    const segH = h / segs;
    let curX = 0, curZ = 0, curY = 0;
    const leanZ = lean * h / segs;

    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const r0 = rBase * (1 - t0 * 0.45);
      const r1 = rBase * (1 - t1 * 0.45);
      const nextZ = curZ + leanZ * (1 + t0 * 1.6);
      const nextY = curY + segH;

      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, segH, 12), trunkMat);
      seg.position.set((curX + curX) / 2, curY + segH / 2, (curZ + nextZ) / 2);
      seg.rotation.x = Math.atan2(nextZ - curZ, segH);
      seg.castShadow = true;
      g.add(seg);

      curZ = nextZ;
      curY = nextY;
    }

    const crownZ = curZ, crownY = curY;

    // Coconuts in crown
    for (let i = 0; i < 5; i++) {
      const ca = (i / 5) * Math.PI * 2;
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.18 * scale, 8, 6), nutMat);
      nut.scale.set(0.9, 1.2, 0.9);
      nut.position.set(Math.sin(ca) * 0.28 * scale, crownY - 0.15 * scale, crownZ + Math.cos(ca) * 0.28 * scale);
      g.add(nut);
    }

    // Realistic multi-tier drooping tropical fronds radiating outwards
    const numFronds = 12;
    for (let i = 0; i < numFronds; i++) {
      const fa = (i / numFronds) * Math.PI * 2 + (Math.random() - .5) * 0.15;
      const fLen = (3.6 + Math.random() * 1.5) * scale;
      const fWidth = (0.75 + Math.random() * 0.25) * scale;

      const frondGroup = new THREE.Group();
      frondGroup.position.set(0, crownY, crownZ);
      frondGroup.rotation.y = fa;

      // Tier 1: Arching upward
      const l1 = new THREE.Mesh(new THREE.BoxGeometry(fWidth, 0.05 * scale, fLen * 0.45), frondMat);
      l1.position.set(0, 0.3 * scale, fLen * 0.22);
      l1.rotation.x = -0.3;
      frondGroup.add(l1);

      // Tier 2: Drooping downward
      const l2 = new THREE.Mesh(new THREE.BoxGeometry(fWidth * 0.85, 0.04 * scale, fLen * 0.55), frondMat);
      l2.position.set(0, 0.15 * scale, fLen * 0.65);
      l2.rotation.x = 0.45;
      frondGroup.add(l2);

      // Tier 3: Hanging tip
      const l3 = new THREE.Mesh(new THREE.BoxGeometry(fWidth * 0.6, 0.03 * scale, fLen * 0.35), frondMat);
      l3.position.set(0, -0.35 * scale, fLen * 0.95);
      l3.rotation.x = 0.95;
      frondGroup.add(l3);

      g.add(frondGroup);
    }

    this.group.add(g);
    this.addCollider(x, 0, z, rBase * 2.2, h * 0.7, rBase * 2.2);
  };
}
