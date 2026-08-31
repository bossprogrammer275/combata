// Asset: Shop — realistic shopfront with solid walls, storefront glass, awning, signage.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installShop(World) {
  World.prototype.shop = function (x, z, ry, w, h, d, mat, solid, doorW, style, seed, roofMat, b) {
    const t = 0.5, hw = w / 2, hd = d / 2;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const l2w = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    // Back wall — full width
    const B = l2w(0, -hd);
    this.box(B.x, 0, B.z, w, h, t, mat, solid, ry);

    // Left wall — full depth
    const L = l2w(-hw, 0);
    this.box(L.x, 0, L.z, t, h, d, mat, solid, ry);

    // Right wall — full depth
    const R = l2w(hw, 0);
    this.box(R.x, 0, R.z, t, h, d, mat, solid, ry);

    // Front wall — split into left segment, right segment, and lintel above door
    const doorWidth = Math.max(1.6, Math.min(2.4, doorW || 2.0));
    const doorH = Math.max(2.8, Math.min(3.2, h * 0.65));
    const doorLeft = -doorWidth / 2;
    const doorRight = doorWidth / 2;
    const lintelH = h - doorH;

    // Left front wall segment
    const leftFW = hw + doorLeft;
    if (leftFW > 0.01) {
      const lfp = l2w(-hw + leftFW / 2, hd);
      this.box(lfp.x, 0, lfp.z, leftFW, h, t, mat, solid, ry);
    }

    // Right front wall segment
    const rightFW = hw - doorRight;
    if (rightFW > 0.01) {
      const rfp = l2w(doorRight + rightFW / 2, hd);
      this.box(rfp.x, 0, rfp.z, rightFW, h, t, mat, solid, ry);
    }

    // Lintel above door — full width to close gap
    if (lintelH > 0.01) {
      const ltp = l2w(0, hd);
      this.box(ltp.x, doorH + lintelH / 2, ltp.z, w, lintelH, t, mat, false, ry);
    }

    // Storefront glass facade on front
    if (this._quality !== 'ultra-low') {
      const tex = TEX.makeStorefrontTexture(w, h, seed);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w + 0.04, h + 0.04),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.15, metalness: 0.3 })
      );
      const pos = l2w(0, hd + 0.05);
      m.position.set(pos.x, h / 2, pos.z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      this.group.add(m);

      // Side and back facades
      this._applyFacade(x, z, w, h, d, ry, ['x', '-x', '-z'], style === 'office' ? 'tenement' : style, seed + 3);
    }

    // Fabric awning / canopy projecting over entrance
    const awningColor = b.awningColor || 0xd03838;
    const awningMat = new THREE.MeshStandardMaterial({ color: awningColor, roughness: 0.8 });
    const awningW = w + 0.4, awningD = 2.2;
    const awnPos = l2w(0, hd + awningD / 2);
    const awningMesh = new THREE.Mesh(new THREE.BoxGeometry(awningW, 0.25, awningD), awningMat);
    awningMesh.position.set(awnPos.x, h * 0.72, awnPos.z);
    awningMesh.rotation.order = 'YXZ';
    awningMesh.rotation.y = ry;
    awningMesh.rotation.x = 0.25;
    awningMesh.castShadow = awningMesh.receiveShadow = true;
    this.group.add(awningMesh);

    // Signboard
    const signMat = new THREE.MeshStandardMaterial({ color: 0x1f242d, roughness: 0.5 });
    const signMesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.8, 0.15), signMat);
    const signPos = l2w(0, hd + 0.1);
    signMesh.position.set(signPos.x, h * 0.85, signPos.z);
    signMesh.rotation.y = ry;
    this.group.add(signMesh);

    // Door leaf
    this._facadeDoor(x, z, w, d, ry, doorWidth, this.mDoor([96, 68, 46]), 0);

    // Flat roof
    this.box(x, h, z, w + 0.4, 0.35, d + 0.4, roofMat, solid, ry);
    this.roofProps(x, z, ry, w, d, h + 0.4);

    // Interior & cover
    this.addInterior(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, h, z + hd));
    this.coverPoints.push(this.frontPoint(x, z, ry, hd + 2.5));
    if (b.roofAccess) this.addRoof(x, z, h + 0.35, hw, hd);
    this.namedLocations.push({ x, z, name: 'SHOP', color: '#ffd24a' });
  };
}
