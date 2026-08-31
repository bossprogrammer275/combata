// Character — now backed by the REAL procedural skinned rig from npc codes.
// Build: buildProceduralHuman + ProceduralAnimator (SSS skin, continuous mesh, skeleton)
// Used by player (third & first person), enemies, civilians — one rig everywhere.
// Mounts guns to Hand_R bone, supports SA wardrobe overlays and SAAnimator crossfades.

import * as THREE from 'three';
import { buildProceduralHuman, DEFAULT_PROPORTIONS } from './utils/ProceduralHuman.js';
import { ProceduralAnimator } from './utils/ProceduralAnimator.js';
import { Wardrobe } from './utils/sa-wardrobe.js';
import { SAAnimator, detectState } from './utils/sa-animation.js';

const TINT = {
  skin: [0.82, 0.62, 0.48],
  pants: [0.22, 0.24, 0.30],
  shirt: [0.45, 0.48, 0.55],
  boots: [0.14, 0.12, 0.10],
  vest: [0.30, 0.34, 0.22],
  cap: [0.20, 0.22, 0.26],
  metal: [0.55, 0.56, 0.58],
};

function tintToHex(tint) {
  if (!tint) return DEFAULT_PROPORTIONS.skinTone;
  const r = Math.round((tint[0] ?? 0.5) * 255).toString(16).padStart(2, '0');
  const g = Math.round((tint[1] ?? 0.5) * 255).toString(16).padStart(2, '0');
  const b = Math.round((tint[2] ?? 0.5) * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function appearanceToProportions(appearance) {
  // Map old appearance tint to new proportions; vary per outfit for visual variety
  const p = Object.assign({}, DEFAULT_PROPORTIONS);
  p.skinTone = tintToHex(appearance.skin || TINT.skin);
  // Slight random-ish variation based on outfit so enemies/civilians don't clone
  const outfit = appearance.outfit || 'camo';
  if (outfit === 'casual' || outfit === 'urban') { p.muscleDefinition = 0.35; p.shoulderWidth = 0.96; }
  else if (outfit === 'navy') { p.muscleDefinition = 0.55; p.shoulderWidth = 1.05; }
  else if (outfit === 'soldier' || outfit === 'cadpat') { p.muscleDefinition = 0.68; p.shoulderWidth = 1.08; }
  if (appearance.helmet) { p.headScale = 1.02; }
  return p;
}

// Keep OLD weapon pose table for compat (now translated to new rig via adapter below)
const WEAPON_POSES = {
  rifle: {
    hip: { uaL: [-1.1, 0.08, -0.08], uaR: [-1.1, -0.08, 0.08], faL: -0.8, faR: -0.8, shL: 0.12, shR: -0.12 },
    aim: { uaL: [-1.2, 0.1, -0.1], uaR: [-1.2, -0.1, 0.1], faL: -0.95, faR: -0.95, shL: 0.15, shR: -0.15 }
  },
  smg: {
    hip: { uaL: [-1.05, 0.08, -0.08], uaR: [-1.05, -0.08, 0.08], faL: -0.75, faR: -0.75, shL: 0.12, shR: -0.12 },
    aim: { uaL: [-1.18, 0.1, -0.1], uaR: [-1.18, -0.1, 0.1], faL: -0.9, faR: -0.9, shL: 0.15, shR: -0.15 }
  },
  pistol: {
    oneHand: true,
    hip: { uaL: [-0.1, 0.04, -0.06], uaR: [-0.95, -0.1, 0.1], faL: -0.2, faR: -0.85, shL: 0, shR: -0.08 },
    aim: { uaL: [-0.1, 0.04, -0.06], uaR: [-1.1, -0.12, 0.12], faL: -0.2, faR: -1.0, shL: 0, shR: -0.1 }
  },
  shotgun: {
    hip: { uaL: [-1.1, 0.09, -0.09], uaR: [-1.1, -0.09, 0.09], faL: -0.8, faR: -0.8, shL: 0.13, shR: -0.13 },
    aim: { uaL: [-1.2, 0.11, -0.11], uaR: [-1.2, -0.11, 0.11], faL: -0.95, faR: -0.95, shL: 0.16, shR: -0.16 }
  },
  dmr: {
    hip: { uaL: [-1.1, 0.09, -0.09], uaR: [-1.1, -0.09, 0.09], faL: -0.82, faR: -0.82, shL: 0.13, shR: -0.13 },
    aim: { uaL: [-1.22, 0.11, -0.11], uaR: [-1.22, -0.11, 0.11], faL: -1.0, faR: -1.0, shL: 0.16, shR: -0.16 }
  },
  sniper: {
    hip: { uaL: [-1.1, 0.09, -0.09], uaR: [-1.1, -0.09, 0.09], faL: -0.82, faR: -0.82, shL: 0.13, shR: -0.13 },
    aim: { uaL: [-1.2, 0.11, -0.11], uaR: [-1.2, -0.11, 0.11], faL: -0.98, faR: -0.98, shL: 0.16, shR: -0.16 }
  },
  lmg: {
    hip: { uaL: [-1.12, 0.09, -0.09], uaR: [-1.12, -0.09, 0.09], faL: -0.82, faR: -0.82, shL: 0.13, shR: -0.13 },
    aim: { uaL: [-1.22, 0.11, -0.11], uaR: [-1.22, -0.11, 0.11], faL: -0.95, faR: -0.95, shL: 0.16, shR: -0.16 }
  },
  rocket: {
    hip: { uaL: [-0.3, 0.05, -0.08], uaR: [-1.0, -0.1, 0.1], faL: -0.25, faR: -0.85, shL: 0, shR: -0.1 },
    aim: { uaL: [-1.15, 0.1, -0.1], uaR: [-1.15, -0.1, 0.1], faL: -0.25, faR: -1.0, shL: 0, shR: -0.12 }
  },
  flame: {
    hip: { uaL: [-1.05, 0.08, -0.08], uaR: [-1.05, -0.08, 0.08], faL: -0.78, faR: -0.78, shL: 0.12, shR: -0.12 },
    aim: { uaL: [-1.18, 0.1, -0.1], uaR: [-1.18, -0.1, 0.1], faL: -0.92, faR: -0.92, shL: 0.15, shR: -0.15 }
  },
  grenade: {
    hip: { uaL: [-0.2, 0.04, -0.06], uaR: [-0.55, -0.06, 0.06], faL: -0.25, faR: -0.5, shL: 0, shR: 0 },
    aim: { uaL: [-0.2, 0.04, -0.06], uaR: [-0.55, -0.06, 0.06], faL: -0.25, faR: -0.5, shL: 0, shR: 0 }
  },
  bow: {
    hip: { uaL: [-1.0, 0.08, -0.08], uaR: [-1.0, -0.08, 0.08], faL: -1.0, faR: -1.0, shL: 0.12, shR: -0.12 },
    aim: { uaL: [-1.15, 0.12, -0.12], uaR: [-1.15, -0.12, 0.12], faL: -1.7, faR: -1.7, shL: 0.18, shR: -0.18 }
  },
};

export class Character {
  constructor(appearance = {}) {
    this.appearance = Object.assign({
      skin: TINT.skin, pants: TINT.pants, shirt: TINT.shirt, boots: TINT.boots,
      vest: TINT.vest, cap: TINT.cap, pack: false, helmet: false,
      outfit: 'camo', glasses: false, showCap: false,
      weaponType: 'rifle', weaponTint: [0.18, 0.18, 0.20],
      height: 1.0,
    }, appearance);
    this.root = new THREE.Group();
    this.root.name = 'CharacterRoot';
    this.wardrobe = null;
    this.saAnimator = null;
    this._rigAnimator = null;
    this._time = 0;
    this.build();
    // SA wardrobe & SAAnimator for GTA-feel crossfades (optional overlay)
    // Keep for modular clothing attachments onto Bones
    try {
      this.wardrobe = new Wardrobe(this);
      this.saAnimator = new SAAnimator(this);
    } catch (e) { /* wardrobe needs bone aliases which are set inside build() */ }
  }

  build() {
    // Dispose previous rig if any
    if (this.rig) {
      try { this.root.remove(this.rig.mesh); } catch {}
      try { this.rig.mesh.geometry.dispose(); } catch {}
      try { this.rig.materials.skin.dispose(); } catch {}
      if (this.rig.skeletonHelper && this.rig.skeletonHelper.parent) this.rig.skeletonHelper.parent.remove(this.rig.skeletonHelper);
    }
    const props = appearanceToProportions(this.appearance);
    // Respect explicit height if provided
    if (this.appearance.height) props.height = this.appearance.height;
    this.rig = buildProceduralHuman(props);
    this.bones = this.rig.bones;
    this.boneList = this.rig.boneList;
    this.skeleton = this.rig.skeleton;
    this.mesh = this.rig.mesh;

    // Root contains the SkinnedMesh; moving root moves the whole character.
    // The rig's Pelvis is at ~0.88 height; root at 0 means feet at ~0.
    this.root.add(this.rig.mesh);

    // Aliases for backward compat with old code that does char.hips / char.chest / char.handL etc
    // Old -> New mapping:
    const b = this.rig.bones;
    this.hips = b.Pelvis; this.spine = b.Spine1; this.chest = b.Spine2; this.neck = b.Neck; this.head = b.Head;
    this.shoulderL = b.Clavicle_L; this.shoulderR = b.Clavicle_R;
    this.upperArmL = b.UpperArm_L; this.upperArmR = b.UpperArm_R;
    this.forearmL = b.Forearm_L; this.forearmR = b.Forearm_R;
    this.handL = b.Hand_L; this.handR = b.Hand_R;
    this.thighL = b.Thigh_L; this.thighR = b.Thigh_R;
    this.shinL = b.Calf_L; this.shinR = b.Calf_R;
    this.footL = b.Foot_L; this.footR = b.Foot_R;
    // Also expose canonical names
    this.Pelvis = b.Pelvis; this.Spine1 = b.Spine1; this.Spine2 = b.Spine2;

    // First-person flag (controls visibility)
    this._firstPerson = false;

    // Procedural animator for walk/run/idle/breath (clock-driven)
    this._rigAnimator = new ProceduralAnimator(this.rig);

    // Weapon mount: child of right hand so it moves with skeleton
    this.weaponMount = new THREE.Group();
    this.weaponMount.name = 'weaponMount';
    // Orient weapon: barrel along -Z when viewed from front, so rotate to face +Z (world forward)
    this.weaponMount.rotation.y = Math.PI;
    // Offset so grip sits in palm (hand bone origin is at wrist; shift slightly)
    this.weaponMount.position.set(0, -0.02, 0.04);
    this.handR.add(this.weaponMount);

    // Left hand helper for two-handed grip (optional)
    this._leftGrip = new THREE.Group();
    this._leftGrip.name = 'leftGripHelper';
    this.handL.add(this._leftGrip);

    this.weaponType = this.appearance.weaponType || 'rifle';
    this.buildWeapon(this.weaponType, this.appearance.weaponTint || [0.18, 0.18, 0.20]);

    // Attach optional visual extras as bone children (cap/helmet/glasses) for backward compat
    this._buildExtras();

    this.setRestPose();
  }

  _buildExtras() {
    const A = this.appearance;
    // Clear previous extras if rebuilding
    if (this._extraGroup) {
      try { this.head.remove(this._extraGroup); } catch {}
      this._extraGroup = null;
    }
    this._extraGroup = new THREE.Group();
    this._extraGroup.name = 'extras';
    this.head.add(this._extraGroup);

    // Cap / Helmet
    if (A.helmet) {
      const hel = new THREE.Mesh(
        new THREE.SphereGeometry(0.125, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(0.55, 0.56, 0.58), metalness: 0.25, roughness: 0.55 })
      );
      hel.position.set(0, 0.02, 0);
      hel.castShadow = true;
      this._extraGroup.add(hel);
    } else if (A.cap && A.showCap) {
      const capMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(A.cap[0], A.cap[1], A.cap[2]), roughness: 0.85 });
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), capMat);
      cap.position.y = 0.02;
      this._extraGroup.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.08), capMat);
      brim.position.set(0, 0.01, 0.11);
      brim.rotation.x = -0.15;
      this._extraGroup.add(brim);
    }
    if (A.glasses) {
      const glassMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.08, 0.09, 0.11), roughness: 0.15, metalness: 0.85 });
      const gL = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, 0.02), glassMat);
      gL.position.set(0.045, 0.04, 0.105);
      this._extraGroup.add(gL);
      const gR = gL.clone(); gR.position.set(-0.045, 0.04, 0.105); this._extraGroup.add(gR);
    }
    // Pack on back (Spine2)
    if (A.pack) {
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.36, 0.14), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.25, 0.27, 0.22), roughness: 0.95 }));
      pack.position.set(0, 0, -0.18);
      pack.castShadow = true;
      // Attach to Spine2 so it follows torso
      this.chest.add(pack);
      this._packMesh = pack;
    }
  }

  buildWeapon(type, tint) {
    while (this.weaponMount.children.length) this.weaponMount.remove(this.weaponMount.children[0]);
    this.weaponMount.add(makeWeaponGroup(type, tint));
    this.weaponType = type;
  }

  setRestPose() {
    if (!this.boneList) return;
    this.boneList.forEach(b => { b.rotation.set(0, 0, 0); b.scale.set(1, 1, 1); });
    // Animator reset
    if (this._rigAnimator) this._rigAnimator.resetPose();
  }

  setAppearance(appearance) {
    const merged = Object.assign({}, this.appearance, appearance);
    // If only weaponType changed, don't rebuild whole mesh — just swap gun
    const onlyWeapon = Object.keys(appearance).length === 1 && appearance.weaponType !== undefined;
    if (onlyWeapon) {
      this.appearance.weaponType = appearance.weaponType;
      if (appearance.weaponTint) this.appearance.weaponTint = appearance.weaponTint;
      this.buildWeapon(this.appearance.weaponType, this.appearance.weaponTint || [0.18, 0.18, 0.20]);
      return;
    }
    // If only pack/helmet/cap/glasses toggle, rebuild extras without full rig rebuild
    const onlyExtras = Object.keys(appearance).every(k => ['pack', 'helmet', 'cap', 'showCap', 'glasses'].includes(k));
    if (onlyExtras) {
      Object.assign(this.appearance, appearance);
      this._buildExtras();
      return;
    }
    const pos = this.root.position.clone();
    const yaw = this.root.rotation.y;
    // Dispose wardrobe overlay before rebuild
    if (this.wardrobe) { try { this.wardrobe.dispose(); } catch {} }
    // Remove old mesh from root
    if (this.rig && this.rig.mesh) {
      try { this.root.remove(this.rig.mesh); this.rig.mesh.geometry.dispose(); this.rig.materials.skin.dispose(); } catch {}
    }
    this.appearance = merged;
    this.build();
    this.root.position.copy(pos);
    this.root.rotation.y = yaw;
    // Recreate wardrobe attachment points for new bones
    try { this.wardrobe = new Wardrobe(this); } catch {}
  }

  setFirstPerson(enabled) {
    this._firstPerson = !!enabled;
    this.root.visible = !enabled;
    // Also hide pack/extra helper if needed but keep skeleton consistent
    if (this.rig && this.rig.skeletonHelper) this.rig.skeletonHelper.visible = false;
  }

  setState(s) {
    this.root.position.set(s.x, s.y, s.z);
    // Rig is modeled facing +Z, world forward is -Z, so rotate 180°
    this.root.rotation.y = s.yaw + Math.PI;
    // Respect first-person hidden state
    if (this._firstPerson) this.root.visible = false;
    this.applyPose(s);
  }

  applyPose(s = {}) {
    if (!this.rig || !this.boneList) return;
    const crouch = s.crouch || 0;
    const aim = s.aim || 0;
    const moveX = s.moveX || 0;
    const moveZ = s.moveZ || 0;
    const sprint = s.sprint || 0;
    const lean = s.lean || 0;
    const phase = s.phase || 0;
    const moving = Math.hypot(moveX, moveZ) > 0.05;
    const speed = s.speed || (moving ? 0.6 : 0);
    const airborne = s.airborne || 0;
    const landDip = s.landDip || 0;
    const wt = s.weaponType || this.weaponType || 'rifle';
    if (wt !== this.weaponType) this.buildWeapon(wt, this.appearance.weaponTint);

    // Use the procedural animator's clock for breathing but override walk cycles with explicit phase
    this._time += 0.016;
    const t = performance.now() * 0.001;

    // Reset first
    if (this._rigAnimator) this._rigAnimator.resetPose();

    // Determine high-level mode for animator
    let mode = 'idle';
    if (s.skydive && s.skydive > 0.5) mode = 'idle'; // skydive handled manually
    else if (airborne > 0.5) mode = 'idle';
    else if (crouch > 0.5 && moving) mode = 'walk';
    else if (sprint > 0.5 && moving) mode = 'run';
    else if (moving) mode = 'walk';
    else if (aim > 0.5) mode = 'combat';
    else mode = 'idle';

    // Drive animator for base locomotion (but we will manually override weapon arms after)
    if (this._rigAnimator) {
      this._rigAnimator.mode = mode;
      // Feed walk phase from game (so it stays in sync with footsteps)
      if (mode === 'walk' || mode === 'run') {
        this._rigAnimator.walkPhase = phase;
        if (mode === 'walk') this._rigAnimator.applyWalkCycle(phase);
        else this._rigAnimator.applyRunCycle(phase);
        // Also apply breathing on top
        this._rigAnimator.applyIdleBreathing(t * (mode === 'run' ? 0 : 0.5));
      } else if (mode === 'combat') {
        this._rigAnimator.applyCombatStance(t);
        this._rigAnimator.applyIdleBreathing(t);
      } else {
        this._rigAnimator.applyIdleBreathing(t);
      }
    }

    // ---- Spine / lean / crouch tweaks on top of animator ----
    const crouchDrop = crouch * 0.12;
    if (this.bones.Pelvis) {
      // Animator already set Pelvis Y for walk bounce; apply crouch offset
      this.bones.Pelvis.position.y -= crouchDrop + landDip * 0.4;
      // Strafe lean
      this.bones.Pelvis.rotation.z += -lean * 0.12;
    }
    if (this.bones.Spine1) {
      this.bones.Spine1.rotation.x += sprint * 0.12;
    }
    if (this.bones.Spine2) {
      this.bones.Spine2.rotation.x += sprint * 0.08;
      this.bones.Spine2.rotation.z += -lean * 0.08;
    }

    // ---- Legs: if animator didn't set them (idle/combat), add crouch/aim tweaks ----
    if (!moving && crouch > 0.4) {
      if (this.bones.Thigh_L) this.bones.Thigh_L.rotation.x += 0.55;
      if (this.bones.Thigh_R) this.bones.Thigh_R.rotation.x += 0.55;
      if (this.bones.Calf_L) this.bones.Calf_L.rotation.x += 0.9;
      if (this.bones.Calf_R) this.bones.Calf_R.rotation.x += 0.9;
    }

    // ---- Skydive / parachute overrides ----
    const sky = s.skydive || 0;
    if (sky > 0.5) {
      const canopy = s.canopy || 0;
      const raise = 1 - canopy;
      if (this.bones.Pelvis) { this.bones.Pelvis.rotation.set(0, 0, 0); }
      if (this.bones.Spine1) this.bones.Spine1.rotation.set(0.15 + canopy * 0.1, 0, 0);
      if (this.bones.Spine2) this.bones.Spine2.rotation.set(0.1, 0, 0);
      const setArm = (side, upper, forearm) => {
        if (!upper || !forearm) return;
        if (side === 'L') {
          upper.rotation.set(-2.7 * raise - 1.3 * canopy, 0, -0.5 * canopy - 0.6 * raise);
          forearm.rotation.set(0, 0, -0.2);
        } else {
          upper.rotation.set(-2.7 * raise - 1.3 * canopy, 0, 0.5 * canopy + 0.6 * raise);
          forearm.rotation.set(0, 0, 0.2);
        }
      };
      setArm('L', this.bones.UpperArm_L, this.bones.Forearm_L);
      setArm('R', this.bones.UpperArm_R, this.bones.Forearm_R);
      if (this.bones.Head) this.bones.Head.rotation.set(0.2 + canopy * 0.15, 0, 0);
      if (this.weaponMount) this.weaponMount.visible = false;
      // Fix legs spread for freefall
      if (this.bones.Thigh_L) this.bones.Thigh_L.rotation.set(0.05, 0, 0.12);
      if (this.bones.Thigh_R) this.bones.Thigh_R.rotation.set(0.05, 0, -0.12);
      if (this.bones.Calf_L) this.bones.Calf_L.rotation.x = 0.1;
      if (this.bones.Calf_R) this.bones.Calf_R.rotation.x = 0.1;
      return;
    }
    if (this.weaponMount) this.weaponMount.visible = true;

    // ---- Weapon hold pose (translate old WEAPON_POSES to new rig) ----
    // New rig: T-pose arms out (+X/-X). Old rig: arms hang down (-Y). Need mapping.
    // We interpret old ua rotations as forward swing from hanging. Convert:
    // For new rig: holding rifle = arms forward + elbows bent.
    // Use a simplified pose that looks plausible for all weapons, refined per type.
    const aimYaw = s.aimYaw || 0;
    const aimBlend = Math.min(1, Math.max(0, aim));
    // Torso twist toward aim
    if (this.bones.Spine2) {
      this.bones.Spine2.rotation.y += aimBlend * aimYaw * 0.45;
    }
    if (this.bones.Spine1) {
      this.bones.Spine1.rotation.y += aimBlend * aimYaw * 0.25;
    }
    if (this.bones.Head) {
      const headPitch = aimBlend * (s.pitch ? Math.max(-0.5, Math.min(0.5, s.pitch * 0.45)) : 0.08);
      this.bones.Head.rotation.x += headPitch;
      this.bones.Head.rotation.y += aimBlend * aimYaw * 0.3;
    }

    // Apply weapon-specific arm pose on top of animator base
    // If aiming or holding a gun, override arm rotations to grip weapon
    const HOLD = WEAPON_POSES[wt] || WEAPON_POSES.rifle;
    const isOneHand = HOLD.oneHand;
    const lerp = (a, b) => a + (b - a) * aimBlend;

    // Weapon vertical position blends hip->aim
    const gunY = lerp(-0.02, 0.06);
    const gunZ = lerp(0.08, 0.12);
    this.weaponMount.position.set(0, -0.02 + gunY, 0.04 + gunZ);
    // Keep weapon level
    this.weaponMount.rotation.set(0, Math.PI, 0);

    if (!isOneHand) {
      // Two-handed rifle/LMG/shotgun: bring both arms forward to chest
      // T-pose -> forward is ~ -Y rotation for left, +Y for right? Empirically tune:
      // Left: UpperArm_L: z ~ -0.9 (down-forward), x ~ 0.7 (forward), y ~ 0.35
      // Right: mirrored
      const baseL = { x: 0.85, y: 0.35, z: -0.95 };
      const baseR = { x: 0.85, y: -0.35, z: 0.95 };
      const aimL = { x: 0.95, y: 0.45, z: -1.15 };
      const aimR = { x: 0.95, y: -0.45, z: 1.15 };
      if (this.bones.UpperArm_L) {
        this.bones.UpperArm_L.rotation.x = lerp(baseL.x, aimL.x);
        this.bones.UpperArm_L.rotation.y = lerp(baseL.y, aimL.y);
        this.bones.UpperArm_L.rotation.z = lerp(baseL.z, aimL.z);
      }
      if (this.bones.UpperArm_R) {
        this.bones.UpperArm_R.rotation.x = lerp(baseR.x, aimR.x);
        this.bones.UpperArm_R.rotation.y = lerp(baseR.y, aimR.y);
        this.bones.UpperArm_R.rotation.z = lerp(baseR.z, aimR.z);
      }
      // Elbows bent to bring hands to weapon
      if (this.bones.Forearm_L) {
        this.bones.Forearm_L.rotation.x = lerp(0.85, 1.05);
        this.bones.Forearm_L.rotation.z = lerp(-0.45, -0.6);
        this.bones.Forearm_L.rotation.y = 0;
      }
      if (this.bones.Forearm_R) {
        this.bones.Forearm_R.rotation.x = lerp(0.85, 1.05);
        this.bones.Forearm_R.rotation.z = lerp(0.45, 0.6);
        this.bones.Forearm_R.rotation.y = 0;
      }
      // Add subtle breathing/sprint wobble if moving
      if (moving) {
        const swing = Math.sin(phase) * (sprint > 0.5 ? 0.07 : 0.04);
        if (this.bones.UpperArm_L) this.bones.UpperArm_L.rotation.x += swing;
        if (this.bones.UpperArm_R) this.bones.UpperArm_R.rotation.x -= swing;
      }
    } else {
      // One-handed (pistol): right arm holds gun forward, left hangs relaxed or swings
      if (this.bones.UpperArm_R) {
        const rX = lerp(0.95, 1.05);
        const rY = lerp(-0.15, -0.22);
        const rZ = lerp(0.55, 0.75);
        this.bones.UpperArm_R.rotation.set(rX, rY, rZ);
      }
      if (this.bones.Forearm_R) {
        this.bones.Forearm_R.rotation.set(lerp(0.85, 1.0), 0, lerp(0.45, 0.55));
      }
      if (this.bones.UpperArm_L && this.bones.Forearm_L) {
        if (moving) {
          const swing = Math.sin(phase + Math.PI) * 0.35;
          this.bones.UpperArm_L.rotation.set(swing, 0, -1.15);
          this.bones.Forearm_L.rotation.set(0, 0, -0.2);
        } else {
          this.bones.UpperArm_L.rotation.set(0.08, 0, -1.15);
          this.bones.Forearm_L.rotation.set(0, 0, -0.2);
        }
      }
    }
  }

  dispose() {
    if (this.wardrobe) { try { this.wardrobe.dispose(); } catch {} }
    if (this.rig) {
      try { this.root.remove(this.rig.mesh); } catch {}
      try { this.rig.mesh.geometry.dispose(); } catch {}
      try { this.rig.materials.skin.dispose(); } catch {}
      // Dispose weapon meshes
      this.weaponMount.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { try { m.dispose(); } catch {} });
      });
    } else {
      this.root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { try { m.dispose(); } catch {} });
      });
    }
  }
}

function makeWeaponGroup(type, tint = [0.18, 0.18, 0.20]) {
  const w = new THREE.Group();
  const matFor = (c, metal = false) => {
    const col = new THREE.Color(c[0], c[1], c[2]);
    return new THREE.MeshStandardMaterial({ color: col, metalness: metal ? 0.7 : 0.15, roughness: metal ? 0.35 : 0.82 });
  };
  const M = (c, m = false) => matFor(c || tint, m);
  const add = (geo, x, y, z, c, m) => { const mm = new THREE.Mesh(geo, M(c || tint, m)); mm.position.set(x, y, z); mm.castShadow = true; w.add(mm); return mm; };
  const barrel = (len, rad = 0.02) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 8), M(TINT.metal, true)); b.rotation.x = Math.PI / 2; b.position.set(0, 0.02, -0.05 - len / 2); b.castShadow = true; w.add(b); return b; };
  switch (type) {
    case 'pistol': add(new THREE.BoxGeometry(0.05, 0.10, 0.18), 0, -0.04, 0.02); barrel(0.1, 0.018); break;
    case 'shotgun': add(new THREE.BoxGeometry(0.06, 0.09, 0.22), 0, 0, 0.05, tint, true); add(new THREE.BoxGeometry(0.05, 0.14, 0.1), 0, -0.09, 0.08); barrel(0.5, 0.03); break;
    case 'sniper': case 'dmr':
      add(new THREE.BoxGeometry(0.05, 0.08, 0.5), 0, 0, 0, tint, true); add(new THREE.BoxGeometry(0.04, 0.12, 0.1), 0, -0.08, 0.12);
      add(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 10), 0, 0.03, 0.0).rotateX(Math.PI / 2); barrel(type === 'sniper' ? 0.85 : 0.6, 0.022); break;
    case 'lmg': add(new THREE.BoxGeometry(0.07, 0.12, 0.45), 0, 0, 0, tint, true); add(new THREE.BoxGeometry(0.06, 0.18, 0.12), 0, -0.12, 0.05); barrel(0.55, 0.03); break;
    case 'rocket': add(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 10), 0, 0, -0.1, tint, true).rotateX(Math.PI / 2); add(new THREE.BoxGeometry(0.05, 0.1, 0.2), 0, -0.06, 0.18); break;
    case 'flame': add(new THREE.BoxGeometry(0.1, 0.16, 0.22), 0, -0.02, 0.06); add(new THREE.BoxGeometry(0.05, 0.06, 0.3), 0, 0.04, -0.1, tint, true); break;
    case 'grenade': add(new THREE.SphereGeometry(0.05, 8, 6), 0, -0.05, 0.05, [0.2, 0.3, 0.15]); break;
    case 'bow': add(new THREE.BoxGeometry(0.02, 0.5, 0.04), 0, 0, -0.1); break;
    default: add(new THREE.BoxGeometry(0.06, 0.10, 0.4), 0, 0, 0, tint, true); add(new THREE.BoxGeometry(0.05, 0.13, 0.08), 0, -0.09, 0.06); barrel(0.45, 0.022);
  }
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.10, 0.035), M([0.12, 0.12, 0.13]));
  grip.position.set(0, -0.08, 0.04); grip.rotation.x = 0.25; w.add(grip);
  const fg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 8), M([0.12, 0.12, 0.13]));
  fg.position.set(0, -0.05, -0.22); w.add(fg);
  // Scale down slightly to fit hand
  w.scale.set(0.92, 0.92, 0.92);
  return w;
}

export function buildWeaponProxy(type, tint = [0.18, 0.18, 0.20]) {
  return makeWeaponGroup(type, tint);
}

Character.WEAPON_POSES = WEAPON_POSES;
