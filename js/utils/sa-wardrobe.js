// SA Wardrobe — Modular clothing swap system for the THREE.Group bone hierarchy.
//
// GTA San Andreas did not morph characters. It swapped disconnected mesh parts
// (head, torso, legs, feet) parented to the same invisible skeleton. When CJ
// bought a tank top, the game deleted the bare-chest mesh and attached a tank-top
// mesh to the spine bones.
//
// This implementation mirrors that approach for our procedural Character rig:
//   - Each clothing item is a THREE.Group of meshes attached to a specific bone
//   - Items are indexed by SLOT (torso, legs, feet, head, gear)
//   - Swapping removes old children from the slot's anchor bone and attaches new ones
//   - Items are cloneable so multiple NPCs can wear the same jacket
//
// Usage:
//   import { Wardrobe, OUTFIT_PRESETS } from './sa-wardrobe.js';
//   const wardrobe = new Wardrobe(character);
//   wardrobe.equip('torso', createShirtMeshes(tint));
//   wardrobe.equip('legs', createPantsMeshes(tint));
//   wardrobe.applyPreset(OUTFIT_PRESETS.soldier);

import * as THREE from 'three';
import { saMat } from './sa-materials.js';

// ---- Slot definitions: which bone each clothing category attaches to ----
const SLOT_BONE = {
  torso: 'chest',
  vest: 'chest',
  legs: 'hips',
  feet: 'footL',     // mirrored to footR internally
  head: 'head',
  gear: 'chest',     // backpacks, radios, etc.
  arms: 'upperArmL', // mirrored to upperArmR internally
};

export class Wardrobe {
  constructor(character) {
    this.char = character;
    // Map<slotName, THREE.Group> — the attachment group parented to the bone
    this._slots = {};
    // Map<slotName, current item key> — tracks what's equipped per slot
    this._equipped = {};
    this._initSlots();
  }

  _initSlots() {
    for (const [slot, boneName] of Object.entries(SLOT_BONE)) {
      const bone = this.char[boneName];
      if (!bone) continue;
      const group = new THREE.Group();
      group.name = 'slot_' + slot;
      bone.add(group);
      this._slots[slot] = group;
    }
  }

  // Equip a clothing item into a slot.
  // item: { key, buildFn } or a THREE.Group (direct attach)
  // buildFn(bone, side) => THREE.Group — called to generate meshes for the bone
  equip(slot, item) {
    const group = this._slots[slot];
    if (!group) return;

    // Remove old children
    while (group.children.length) {
      const c = group.children[0];
      group.remove(c);
      c.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
    }

    if (!item) { this._equipped[slot] = null; return; }

    if (item instanceof THREE.Group) {
      group.add(item);
      this._equipped[slot] = item.name || 'custom';
      return;
    }

    // Item has a buildFn — call it with the bone reference
    const bone = this.char[SLOT_BONE[slot]];
    const meshes = item.buildFn(bone, slot);
    if (meshes instanceof THREE.Group) {
      group.add(meshes);
    } else if (Array.isArray(meshes)) {
      meshes.forEach(m => group.add(m));
    }
    this._equipped[slot] = item.key || 'unknown';
  }

  // Remove all items from a slot
  unequip(slot) {
    this.equip(slot, null);
  }

  // Check what's equipped in a slot
  equipped(slot) {
    return this._equipped[slot] || null;
  }

  // Remove all slots (call before character rebuild)
  clear() {
    for (const slot of Object.keys(this._slots)) {
      this.unequip(slot);
    }
  }

  // Dispose all slot groups
  dispose() {
    for (const group of Object.values(this._slots)) {
      while (group.children.length) {
        const c = group.children[0];
        group.remove(c);
        c.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
        });
      }
    }
    this._slots = {};
    this._equipped = {};
  }
}

// ---- MESH BUILDERS: each returns a THREE.Group of meshes for a slot ----

// TORSO: shirt / t-shirt / tank top mesh
export function buildTorsoMeshes(tint, opts = {}) {
  const group = new THREE.Group();
  group.name = 'torso_mesh';
  const camo = opts.camo || false;
  const matFn = (c) => saMat({ color: c, texture: camo ? 'camo' : 'fabric', tint: c.map(v => Math.round(v * 255)) });

  // V-taper shirt
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.155, 0.12, 0.28, 12),
    matFn(tint)
  );
  torso.position.y = 0.07;
  torso.castShadow = true;
  group.add(torso);

  const belly = new THREE.Mesh(
    new THREE.CylinderGeometry(0.135, 0.12, 0.14, 12),
    matFn(tint)
  );
  belly.position.y = -0.11;
  belly.castShadow = true;
  group.add(belly);

  return group;
}

// VEST: tactical plate carrier
export function buildVestMeshes(tint, opts = {}) {
  const group = new THREE.Group();
  group.name = 'vest_mesh';
  const camo = opts.camo || false;
  const matFn = (c) => saMat({ color: c, texture: camo ? 'camo' : 'fabric', tint: c.map(v => Math.round(v * 255)) });

  const vest = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.135, 0.30, 12),
    matFn(tint)
  );
  vest.position.y = 0.04;
  vest.castShadow = true;
  group.add(vest);

  // Mag pouches
  for (let i = -1; i <= 1; i++) {
    const pouch = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.09, 0.04),
      matFn(tint)
    );
    pouch.position.set(i * 0.07, -0.05, 0.145);
    pouch.rotation.y = i * 0.12;
    pouch.castShadow = true;
    group.add(pouch);
  }

  // Shoulder straps
  for (const sx of [1, -1]) {
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.02, 0.22),
      saMat({ color: [0.12, 0.12, 0.14] })
    );
    strap.position.set(sx * 0.11, 0.16, 0.02);
    strap.rotation.x = 0.1;
    group.add(strap);
  }

  return group;
}

// LEGS: pants / jeans / cargo pants
export function buildLegsMeshes(tint, opts = {}) {
  const group = new THREE.Group();
  group.name = 'legs_mesh';
  const camo = opts.camo || false;
  const matFn = (c) => saMat({ color: c, texture: camo ? 'camo' : 'fabric', tint: c.map(v => Math.round(v * 255)) });

  // Pelvis block
  const pelvis = new THREE.Mesh(
    new THREE.CylinderGeometry(0.125, 0.11, 0.16, 12),
    matFn(tint)
  );
  pelvis.position.y = -0.04;
  pelvis.castShadow = true;
  group.add(pelvis);

  // Belt
  const belt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.032, 12),
    saMat({ color: [0.12, 0.12, 0.14] })
  );
  belt.position.y = 0.045;
  group.add(belt);

  // Belt buckle
  const buckle = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.038, 0.015),
    saMat({ color: [0.55, 0.56, 0.58], texture: 'metal' })
  );
  buckle.position.set(0, 0.045, 0.13);
  group.add(buckle);

  return group;
}

// FEET: boots / sneakers
export function buildFeetMeshes(tint, opts = {}) {
  const group = new THREE.Group();
  group.name = 'feet_mesh';
  const matFn = (c) => saMat({ color: c });

  // Left boot
  const footL = new THREE.Mesh(
    new THREE.BoxGeometry(0.082, 0.050, 0.20),
    matFn(tint)
  );
  footL.position.set(0, -0.028, 0.045);
  footL.castShadow = true;
  group.add(footL);

  const soleL = new THREE.Mesh(
    new THREE.BoxGeometry(0.090, 0.018, 0.215),
    saMat({ color: [0.9, 0.9, 0.92] })
  );
  soleL.position.set(0, -0.055, 0.045);
  group.add(soleL);

  // Ankle ball
  const ankleL = new THREE.Mesh(
    new THREE.SphereGeometry(0.044, 8, 6),
    matFn(tint)
  );
  group.add(ankleL);

  return group;
}

// HEAD: hair / headgear
export function buildHeadMeshes(tint, opts = {}) {
  const group = new THREE.Group();
  group.name = 'head_mesh';
  const matFn = (c) => saMat({ color: c });

  if (opts.hair !== false) {
    const hairTop = new THREE.Mesh(
      new THREE.SphereGeometry(0.106, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
      matFn([0.12, 0.10, 0.08])
    );
    hairTop.position.set(0, 0.125, -0.01);
    hairTop.scale.set(0.96, 1.02, 0.96);
    group.add(hairTop);
  }

  if (opts.cap) {
    const capMat = saMat({ color: tint, texture: 'camo' });
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      capMat
    );
    cap.position.y = 0.11;
    group.add(cap);
    const brim = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.012, 0.08),
      capMat
    );
    brim.position.set(0, 0.10, 0.11);
    brim.rotation.x = -0.15;
    group.add(brim);
  }

  if (opts.helmet) {
    const hel = new THREE.Mesh(
      new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      saMat({ color: [0.55, 0.56, 0.58], texture: 'metal' })
    );
    hel.position.y = 0.11;
    hel.castShadow = true;
    group.add(hel);
  }

  if (opts.glasses) {
    const glassMat = saMat({ color: [0.08, 0.09, 0.11] });
    const frameMat = saMat({ color: [0.12, 0.12, 0.12] });
    for (const sx of [1, -1]) {
      const lens = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.022, 0.005),
        saMat({ color: [0.2, 0.5, 0.8] })
      );
      lens.position.set(sx * 0.038, 0.12, 0.098);
      group.add(lens);
    }
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.155, 0.032, 0.032),
      frameMat
    );
    frame.position.set(0, 0.12, 0.082);
    group.add(frame);
  }

  return group;
}

// GEAR: backpack / radio
export function buildGearMeshes(tint, opts = {}) {
  const group = new THREE.Group();
  group.name = 'gear_mesh';

  if (opts.backpack) {
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.36, 0.14),
      saMat({ color: tint, texture: 'camo' })
    );
    pack.position.set(0, 0, -0.16);
    pack.castShadow = true;
    group.add(pack);
  }

  if (opts.radio) {
    const radio = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.07, 0.035),
      saMat({ color: [0.1, 0.1, 0.1] })
    );
    radio.position.set(0.115, 0.17, 0.04);
    group.add(radio);
    const ant = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.18, 6),
      saMat({ color: [0.1, 0.1, 0.1] })
    );
    ant.position.set(0.115, 0.28, 0.04);
    ant.rotation.z = -0.1;
    group.add(ant);
  }

  return group;
}

// ARMS: sleeves (upper arm cloth covering)
export function buildArmMeshes(tint, opts = {}) {
  const group = new THREE.Group();
  group.name = 'arms_mesh';
  const camo = opts.camo || false;
  const matFn = (c) => saMat({ color: c, texture: camo ? 'camo' : 'fabric', tint: c.map(v => Math.round(v * 255)) });

  // Shoulder cap
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.068, 10, 8),
    matFn(tint)
  );
  cap.position.y = -0.02;
  cap.castShadow = true;
  group.add(cap);

  // Upper arm sleeve
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.056, 0.045, 0.25, 10),
    matFn(tint)
  );
  sleeve.position.y = -0.165;
  sleeve.castShadow = true;
  group.add(sleeve);

  return group;
}

// ---- OUTFIT PRESETS: complete wardrobe configurations ----

export const OUTFIT_PRESETS = {
  soldier: {
    torso: { key: 'soldier_shirt', buildFn: (bone) => buildTorsoMeshes([0.27, 0.30, 0.24], { camo: true }) },
    vest: { key: 'soldier_vest', buildFn: (bone) => buildVestMeshes([0.25, 0.27, 0.22], { camo: true }) },
    legs: { key: 'soldier_pants', buildFn: (bone) => buildLegsMeshes([0.20, 0.22, 0.30], { camo: true }) },
    feet: { key: 'soldier_boots', buildFn: (bone) => buildFeetMeshes([0.14, 0.12, 0.10]) },
    head: { key: 'soldier_hair', buildFn: (bone) => buildHeadMeshes(null, { hair: true }) },
    gear: { key: 'soldier_pack', buildFn: (bone) => buildGearMeshes([0.25, 0.27, 0.22], { backpack: true, radio: true }) },
    arms: { key: 'soldier_sleeves', buildFn: (bone) => buildArmMeshes([0.27, 0.30, 0.24], { camo: true }) },
  },

  casual: {
    torso: { key: 'casual_shirt', buildFn: (bone) => buildTorsoMeshes([0.42, 0.40, 0.38]) },
    vest: null,
    legs: { key: 'casual_pants', buildFn: (bone) => buildLegsMeshes([0.30, 0.30, 0.32]) },
    feet: { key: 'casual_shoes', buildFn: (bone) => buildFeetMeshes([0.15, 0.13, 0.12]) },
    head: { key: 'casual_cap', buildFn: (bone) => buildHeadMeshes([0.20, 0.22, 0.26], { cap: true }) },
    gear: null,
    arms: { key: 'casual_sleeves', buildFn: (bone) => buildArmMeshes([0.42, 0.40, 0.38]) },
  },

  navy: {
    torso: { key: 'navy_shirt', buildFn: (bone) => buildTorsoMeshes([0.12, 0.16, 0.30]) },
    vest: { key: 'navy_vest', buildFn: (bone) => buildVestMeshes([0.10, 0.12, 0.18]) },
    legs: { key: 'navy_pants', buildFn: (bone) => buildLegsMeshes([0.10, 0.12, 0.20]) },
    feet: { key: 'navy_boots', buildFn: (bone) => buildFeetMeshes([0.08, 0.08, 0.10]) },
    head: { key: 'navy_hair', buildFn: (bone) => buildHeadMeshes(null, { hair: true }) },
    gear: { key: 'navy_pack', buildFn: (bone) => buildGearMeshes([0.10, 0.12, 0.18], { backpack: true }) },
    arms: { key: 'navy_sleeves', buildFn: (bone) => buildArmMeshes([0.12, 0.16, 0.30]) },
  },

  urban: {
    torso: { key: 'urban_shirt', buildFn: (bone) => buildTorsoMeshes([0.36, 0.38, 0.40]) },
    vest: null,
    legs: { key: 'urban_pants', buildFn: (bone) => buildLegsMeshes([0.30, 0.32, 0.34]) },
    feet: { key: 'urban_shoes', buildFn: (bone) => buildFeetMeshes([0.12, 0.12, 0.14]) },
    head: { key: 'urban_glasses', buildFn: (bone) => buildHeadMeshes(null, { hair: true, glasses: true }) },
    gear: null,
    arms: { key: 'urban_sleeves', buildFn: (bone) => buildArmMeshes([0.36, 0.38, 0.40]) },
  },

  cadpat: {
    torso: { key: 'cadpat_shirt', buildFn: (bone) => buildTorsoMeshes([0.24, 0.30, 0.20], { camo: true }) },
    vest: { key: 'cadpat_vest', buildFn: (bone) => buildVestMeshes([0.20, 0.26, 0.18], { camo: true }) },
    legs: { key: 'cadpat_pants', buildFn: (bone) => buildLegsMeshes([0.20, 0.26, 0.18], { camo: true }) },
    feet: { key: 'cadpat_boots', buildFn: (bone) => buildFeetMeshes([0.12, 0.12, 0.10]) },
    head: { key: 'cadpat_helmet', buildFn: (bone) => buildHeadMeshes(null, { helmet: true }) },
    gear: { key: 'cadpat_pack', buildFn: (bone) => buildGearMeshes([0.20, 0.26, 0.18], { backpack: true }) },
    arms: { key: 'cadpat_sleeves', buildFn: (bone) => buildArmMeshes([0.24, 0.30, 0.20], { camo: true }) },
  },

  // Minimal: just skin and pants (for civilians)
  minimal: {
    torso: null,
    vest: null,
    legs: { key: 'minimal_pants', buildFn: (bone) => buildLegsMeshes([0.22, 0.24, 0.28]) },
    feet: { key: 'minimal_shoes', buildFn: (bone) => buildFeetMeshes([0.10, 0.10, 0.10]) },
    head: { key: 'minimal_hair', buildFn: (bone) => buildHeadMeshes(null, { hair: true }) },
    gear: null,
    arms: null,
  },
};
