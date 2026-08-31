// Asset: Transitstation — bus/shelter stop with canopy, bench, info boards, and light pole.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installTransitStation(World) {
  World.prototype.transitStation = function (x, z, name) {
    this.transitPoints.push({ x, z, name });

    const t = 0.5;
    const platW = 8, platD = 6, platH = 0.3;
    const shelterW = 8, shelterD = 3.5, shelterH = 3.5;
    const cs = 0, sn = 1;
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    const conMat = this.mConcrete([155, 150, 142]);
    const metalMat = this.mMetal();

    // concrete platform base
    this.box(x, -platH / 2, z, platW, platH, platD, conMat, true, 0);

    // back wall (full width, centered at rear edge of platform)
    const bw = l2w(0, -platD / 2 + t / 2);
    this.box(bw.x, shelterH / 2, bw.z, shelterW, shelterH, t, conMat, true, 0);

    // left partial wall (3 deep from back, leaving front open)
    const lw = l2w(-shelterW / 2 + t / 2, -platD / 2 + shelterD / 2);
    this.box(lw.x, shelterH / 2, lw.z, t, shelterH, shelterD, conMat, true, 0);

    // right partial wall (3 deep from back, leaving front open)
    const rw = l2w(shelterW / 2 - t / 2, -platD / 2 + shelterD / 2);
    this.box(rw.x, shelterH / 2, rw.z, t, shelterH, shelterD, conMat, true, 0);

    // roof canopy over the shelter area
    this.box(bw.x, shelterH, bw.z, shelterW + 0.6, 0.25, shelterD + 0.6, metalMat, false, 0);

    // metal support columns at the two front corners of the shelter
    const frontZ = -platD / 2 + shelterD;
    for (const side of [-1, 1]) {
      const cx = l2w(side * (shelterW / 2 - 0.3), frontZ);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, shelterH, 10), metalMat);
      col.position.set(cx.x, shelterH / 2, cx.z);
      col.castShadow = true;
      this.group.add(col);
    }

    // bench inside the shelter (seat + backrest)
    const benchMat = this.mMetal();
    const benchSeatY = 0.45;
    const benchW = 4, benchSeatD = 0.5, benchSeatH = 0.06;
    const benchBackH = 0.6, benchBackThick = 0.05;
    // seat
    const seatP = l2w(0, -platD / 2 + 0.8);
    this.box(seatP.x, benchSeatY, seatP.z, benchW, benchSeatH, benchSeatD, benchMat, false, 0);
    // backrest
    const backP = l2w(0, -platD / 2 + 0.55);
    this.box(backP.x, benchSeatY + benchBackH / 2, backP.z, benchW, benchBackH, benchBackThick, benchMat, false, 0);

    // schedule/info board on back wall (dark box)
    const schedMat = new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 0.6 });
    const schedP = l2w(-1.8, -platD / 2 + t / 2 + 0.06);
    this.box(schedP.x, 2.2, schedP.z, 1.8, 1.2, 0.08, schedMat, false, 0);
    // info board border/accent
    const schedAccent = new THREE.MeshStandardMaterial({ color: 0x2a6eb5, roughness: 0.7, emissive: 0x0a2a4a, emissiveIntensity: 0.2 });
    const saP = l2w(-1.8, -platD / 2 + t / 2 + 0.1);
    this.box(saP.x, 2.2, saP.z, 1.7, 1.1, 0.04, schedAccent, false, 0);

    // route map on back wall (colored box)
    const mapMat = new THREE.MeshStandardMaterial({ color: 0x1e8a4e, roughness: 0.7, emissive: 0x0a3a1e, emissiveIntensity: 0.15 });
    const mapP = l2w(1.8, -platD / 2 + t / 2 + 0.06);
    this.box(mapP.x, 2.2, mapP.z, 1.8, 1.2, 0.08, mapMat, false, 0);
    // map inner panel
    const mapInner = new THREE.MeshStandardMaterial({ color: 0xf0f0e8, roughness: 0.8 });
    const miP = l2w(1.8, -platD / 2 + t / 2 + 0.12);
    this.box(miP.x, 2.2, miP.z, 1.6, 1.0, 0.04, mapInner, false, 0);

    // electronic display board (dark box with emissive strip)
    const dispMat = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.4, metalness: 0.3 });
    const dispP = l2w(0, -platD / 2 + t / 2 + 0.06);
    this.box(dispP.x, 2.9, dispP.z, 2.4, 0.4, 0.1, dispMat, false, 0);
    const dispGlow = new THREE.MeshStandardMaterial({ color: 0x44ccff, emissive: 0x22aadd, emissiveIntensity: 0.8 });
    const dgP = l2w(0, -platD / 2 + t / 2 + 0.12);
    this.box(dgP.x, 2.9, dgP.z, 2.2, 0.28, 0.04, dispGlow, false, 0);

    // glowing beacon / light pole at front-right of platform
    const poleMat = this.mMetal();
    const poleP = l2w(shelterW / 2 - 1, platD / 2 - 1);
    const poleH = 5;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, poleH, 12), poleMat);
    pole.position.set(poleP.x, poleH / 2, poleP.z);
    pole.castShadow = true;
    this.group.add(pole);

    // lamp head at top of pole
    const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.5 });
    const lampHead = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.25, 0.25, 12), lampHeadMat);
    lampHead.position.set(poleP.x, poleH + 0.12, poleP.z);
    this.group.add(lampHead);

    // glowing light emitter under lamp head
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x88ffaa, emissive: 0x44ff88, emissiveIntensity: 0.9 });
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12), glowMat);
    glow.position.set(poleP.x, poleH - 0.05, poleP.z);
    this.group.add(glow);

    // ring light at top (kept from original)
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x88ffaa, emissive: 0x44ff88, emissiveIntensity: 0.8, transparent: true, opacity: 0.5 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 20), ringMat);
    ring.position.set(poleP.x, poleH + 0.35, poleP.z);
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);

    // add interior for the shelter area
    this.addInterior(
      new THREE.Vector3(x - shelterW / 2, 0, -platD / 2),
      new THREE.Vector3(x + shelterW / 2, shelterH, -platD / 2 + shelterD)
    );

    // cover points
    this.coverPoints.push(new THREE.Vector3(x, 0, z));
    this.coverPoints.push(new THREE.Vector3(x, 0, -platD / 2 + shelterD / 2));

    // named location
    this.namedLocations.push({ x, z, name: name || 'TRANSIT STOP', color: '#88ffcc' });
  };
}
