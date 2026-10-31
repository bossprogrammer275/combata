// The player, enemies and civilian population all use the canonical civilian_002 rig.
// Mixamo clips are applied to that rig; the old npc1 body is no longer a runtime model.
import * as THREE from 'three';
import { FBXLoader } from './lib/FBXLoader.js';
import { NPC_MODELS, NPC_GLOBAL_CONFIG } from './npc-config.js';

const MODEL = NPC_MODELS[NPC_GLOBAL_CONFIG.modelId];
const ANIM_URLS = {
  idle: MODEL.animations.idle,
  walk: MODEL.animations.walk,
  run: MODEL.animations.run,
  sprint: MODEL.animations.sprint,
  crouch: MODEL.animations.crouch_idle,
  crouchWalk: MODEL.animations.crouch_walk,
  jump: MODEL.animations.jump,
  talk: MODEL.animations.talk,
  phone: MODEL.animations.phone,
  sitIdle: MODEL.animations.sit_idle,
  fallDeath: MODEL.animations.fall_death,
  getUp: MODEL.animations.get_up,
  wave: MODEL.animations.wave,
  sitDown: MODEL.animations.sit_down,
};
const CROUCH_DROP = 0.30;
const BLEND = 0.18;
const loader = new FBXLoader();
let _baseGroup = null;
let _clips = {};
let _loadingPromise = null;

function findSkinnedMesh(group) {
  let found = null;
  group.traverse(o => { if (o.isSkinnedMesh && !found) found = o; });
  if (!found) group.traverse(o => { if (o.isMesh && !found) found = o; });
  return found;
}

function findBone(group, keywords) {
  let out = null;
  group.traverse(o => {
    if (out || !o.isBone) return;
    const n = (o.name || '').toLowerCase();
    if (keywords.some(k => n.includes(k.toLowerCase()))) out = o;
  });
  return out;
}

function stripRootMotion(clip) {
  for (let i = clip.tracks.length - 1; i >= 0; i--) {
    const track = clip.tracks[i];
    if (track.name.includes('Hips') && track.name.includes('.position')) clip.tracks.splice(i, 1);
  }
  return clip;
}

function cloneModel() {
  if (!_baseGroup) return null;
  const clone = _baseGroup.clone(true);
  clone.updateMatrixWorld(true);
  const boneMap = new Map();
  clone.traverse(o => { if (o.isBone && !boneMap.has(o.name)) boneMap.set(o.name, o); });
  clone.traverse(o => {
    if (o.isSkinnedMesh && o.skeleton) {
      const bones = o.skeleton.bones.map(b => boneMap.get(b.name));
      if (bones.some(b => !b)) throw new Error('civilian_002 skeleton clone has an unresolved bone');
      const skeleton = new THREE.Skeleton(bones, o.skeleton.boneInverses.map(m => m.clone()));
      o.bind(skeleton, o.bindMatrix.clone());
      o.bindMode = o.bindMode || 'attached';
    }
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true;
    // Prevent low-resolution city shadows from blackening the character body.
    o.receiveShadow = false;
    o.frustumCulled = false;
    const sourceMats = Array.isArray(o.material) ? o.material : [o.material];
    const clonedMats = sourceMats.map(source => {
      if (!source) return source;
      const mat = source.clone();
      mat.side = THREE.DoubleSide;
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
      mat.depthTest = true;
      if (mat.map) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.needsUpdate = true;
        // The diffuse texture contains the skin/outfit colour. A white material
        // multiplier avoids applying a second dark tint over the texture.
        mat.color?.setHex(0xffffff);
      } else if (mat.color && mat.color.getHex() === 0x000000) {
        mat.color.setHex(0xc8a88a);
      }
      if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      if (mat.emissive) {
        mat.emissive.setRGB(0.012, 0.010, 0.008);
        mat.emissiveIntensity = 0.12;
      }
      mat.needsUpdate = true;
      return mat;
    });
    o.material = sourceMats.length === 1 ? clonedMats[0] : clonedMats;
  });
  return clone;
}

function loadFbx(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

async function loadAnimation(url, key) {
  const fbx = await loadFbx(url);
  const clip = fbx.animations && fbx.animations.length ? fbx.animations[0].clone() : null;
  fbx.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { try { m.dispose(); } catch {} });
  });
  if (!clip || !clip.tracks.length) throw new Error('Animation file contains no usable tracks: ' + key);
  clip.name = key;
  const manifestKey = key === 'crouchWalk' ? 'crouch_walk' : key;
  if (MODEL.inPlace.includes(manifestKey)) stripRootMotion(clip);
  clip.optimize();
  return clip;
}

async function ensureLoaded() {
  if (_baseGroup && Object.keys(_clips).length === Object.keys(ANIM_URLS).length) return;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    const rig = await loadFbx(MODEL.modelUrl);
    rig.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(rig);
    const height = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(height) || height < 0.5) throw new Error('civilian_002 rig has invalid height');
    rig.scale.setScalar(MODEL.targetHeight / height);
    rig.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(rig);
    rig.position.y -= fitted.min.y;
    rig.updateMatrixWorld(true);
    rig.traverse(o => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (mat.map) { mat.map.colorSpace = THREE.SRGBColorSpace; mat.map.needsUpdate = true; }
        if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      }
    });
    _baseGroup = rig;
    const results = await Promise.allSettled(
      Object.entries(ANIM_URLS).map(([key, url]) => loadAnimation(url, key).then(clip => ({ key, clip })))
    );
    const failures = [];
    for (const result of results) {
      if (result.status === 'fulfilled') _clips[result.value.key] = result.value.clip;
      else failures.push(result.reason?.message || String(result.reason));
    }
    const missing = Object.keys(ANIM_URLS).filter(key => !_clips[key]);
    if (missing.length) throw new Error('civilian_002 required player clips failed: ' + missing.join(', ') + '; ' + failures.join('; '));
    console.info('[Character] civilian_002 player/enemy rig ready; loaded ' + Object.keys(_clips).length + ' Mixamo clips');
  })();
  try { return await _loadingPromise; }
  catch (error) { _loadingPromise = null; _baseGroup = null; _clips = {}; throw error; }
}

ensureLoaded().catch(error => console.error('[Character] civilian_002 preload failed:', error));

export const WEAPON_POSES = {
  rifle: { hip: { uaL: [-1.1,0.08,-0.08], uaR: [-1.1,-0.08,0.08], faL:-0.8, faR:-0.8, shL:0.12, shR:-0.12 }, aim: { uaL:[-1.2,0.1,-0.1], uaR:[-1.2,-0.1,0.1], faL:-0.95, faR:-0.95, shL:0.15, shR:-0.15 }},
  smg: { hip: { uaL:[-1.05,0.08,-0.08], uaR:[-1.05,-0.08,0.08], faL:-0.75, faR:-0.75, shL:0.12, shR:-0.12 }, aim:{ uaL:[-1.18,0.1,-0.1], uaR:[-1.18,-0.1,0.1], faL:-0.9, faR:-0.9, shL:0.15, shR:-0.15 }},
  pistol:{ oneHand:true, hip:{ uaL:[-0.1,0.04,-0.06], uaR:[-0.95,-0.1,0.1], faL:-0.2, faR:-0.85, shL:0, shR:-0.08 }, aim:{ uaL:[-0.1,0.04,-0.06], uaR:[-1.1,-0.12,0.12], faL:-0.2, faR:-1.0, shL:0, shR:-0.1 }},
  shotgun:{ hip:{ uaL:[-1.1,0.09,-0.09], uaR:[-1.1,-0.09,0.09], faL:-0.8, faR:-0.8, shL:0.13, shR:-0.13 }, aim:{ uaL:[-1.2,0.11,-0.11], uaR:[-1.2,-0.11,0.11], faL:-0.95, faR:-0.95, shL:0.16, shR:-0.16 }},
  dmr:{ hip:{ uaL:[-1.1,0.09,-0.09], uaR:[-1.1,-0.09,0.09], faL:-0.82, faR:-0.82, shL:0.13, shR:-0.13 }, aim:{ uaL:[-1.22,0.11,-0.11], uaR:[-1.22,-0.11,0.11], faL:-1.0, faR:-1.0, shL:0.16, shR:-0.16 }},
  sniper:{ hip:{ uaL:[-1.1,0.09,-0.09], uaR:[-1.1,-0.09,0.09], faL:-0.82, faR:-0.82, shL:0.13, shR:-0.13 }, aim:{ uaL:[-1.2,0.11,-0.11], uaR:[-1.2,-0.11,0.11], faL:-0.98, faR:-0.98, shL:0.16, shR:-0.16 }},
  lmg:{ hip:{ uaL:[-1.12,0.09,-0.09], uaR:[-1.12,-0.09,0.09], faL:-0.82, faR:-0.82, shL:0.13, shR:-0.13 }, aim:{ uaL:[-1.22,0.11,-0.11], uaR:[-1.22,-0.11,0.11], faL:-0.95, faR:-0.95, shL:0.16, shR:-0.16 }},
  rocket:{ hip:{ uaL:[-0.3,0.05,-0.08], uaR:[-1.0,-0.1,0.1], faL:-0.25, faR:-0.85, shL:0, shR:-0.1 }, aim:{ uaL:[-1.15,0.1,-0.1], uaR:[-1.15,-0.1,0.1], faL:-0.25, faR:-1.0, shL:0, shR:-0.12 }},
  flame:{ hip:{ uaL:[-1.05,0.08,-0.08], uaR:[-1.05,-0.08,0.08], faL:-0.78, faR:-0.78, shL:0.12, shR:-0.12 }, aim:{ uaL:[-1.18,0.1,-0.1], uaR:[-1.18,-0.1,0.1], faL:-0.92, faR:-0.92, shL:0.15, shR:-0.15 }},
  grenade:{ hip:{ uaL:[-0.2,0.04,-0.06], uaR:[-0.55,-0.06,0.06], faL:-0.25, faR:-0.5, shL:0, shR:0 }, aim:{ uaL:[-0.2,0.04,-0.06], uaR:[-0.55,-0.06,0.06], faL:-0.25, faR:-0.5, shL:0, shR:0 }},
  bow:{ hip:{ uaL:[-1.0,0.08,-0.08], uaR:[-1.0,-0.08,0.08], faL:-1.0, faR:-1.0, shL:0.12, shR:-0.12 }, aim:{ uaL:[-1.15,0.12,-0.12], uaR:[-1.15,-0.12,0.12], faL:-1.7, faR:-1.7, shL:0.18, shR:-0.18 }},
};


export class Character {
  constructor(appearance = {}) {
    this.appearance = Object.assign({ weaponType: 'rifle', weaponTint: [0.18, 0.18, 0.20] }, appearance);
    this.root = new THREE.Group();
    this.root.name = 'Character_civilian_002';
    this.weaponType = this.appearance.weaponType || 'rifle';
    this._firstPerson = false;
    this._mixer = null;
    this._actions = {};
    this._rightHand = null;
    this._model = null;
    this._pendingState = null;
    this._isBuilt = false;
    this._crouchY = 0;
    this._prevAirborne = false;
    this._wasAirborne = false;
    this._wasClimbing = false;
    this._weaponBones = [];
    this._pendingWeaponPose = { aiming: false, moving: false };
    this.build();
  }

  async build() {
    await ensureLoaded();
    if (this._isBuilt) return;
    const clone = cloneModel();
    if (!clone) throw new Error('civilian_002 player rig could not be cloned');
    this._model = clone;
    this.root.add(clone);
    this._rightHand = findBone(clone, ['RightHand', 'mixamorig:RightHand', 'Hand_R']);
    this._leftHand = findBone(clone, ['LeftHand', 'mixamorig:LeftHand', 'Hand_L']);
    this._head = findBone(clone, ['Head', 'mixamorig:Head', 'HeadTop']);
    this._hips = findBone(clone, ['Hips', 'mixamorig:Hips', 'Pelvis']);
    this.hips = this._hips || this.root;
    this.chest = findBone(clone, ['Spine2', 'Spine1', 'Spine', 'mixamorig:Spine2']) || this.root;
    this.head = this._head || this.root;
    this.handR = this._rightHand || this.root;
    this.handL = this._leftHand || this.root;
    this.mesh = findSkinnedMesh(clone);
    this.skeleton = this.mesh?.skeleton || null;
    this.weaponMount = new THREE.Group();
    this.weaponMount.name = 'weaponMount';
    this.weaponMount.rotation.y = Math.PI;
    this.weaponMount.position.set(0, 0.02, 0.06);
    (this._rightHand || this.root).add(this.weaponMount);
    this.buildWeapon(this.weaponType, this.appearance.weaponTint || [0.18, 0.18, 0.20]);

    this._weaponBones = [
      { bone: findBone(clone, ['LeftArm', 'mixamorig:LeftArm']), key: 'leftUpper' },
      { bone: findBone(clone, ['RightArm', 'mixamorig:RightArm']), key: 'rightUpper' },
      { bone: findBone(clone, ['LeftForeArm', 'mixamorig:LeftForeArm']), key: 'leftFore' },
      { bone: findBone(clone, ['RightForeArm', 'mixamorig:RightForeArm']), key: 'rightFore' },
    ].filter(entry => entry.bone).map(entry => ({ ...entry, rest: entry.bone.quaternion.clone() }));

    this._mixer = new THREE.AnimationMixer(clone);
    const aliases = {
      crouch: 'crouch', crouchWalk: 'crouchWalk', sitIdle: 'sitIdle',
      fallDeath: 'fallDeath', getUp: 'getUp', sitDown: 'sitDown',
    };
    for (const [key, clip] of Object.entries(_clips)) {
      const action = this._mixer.clipAction(clip, clone);
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      const actionName = aliases[key] || key;
      this._actions[actionName] = action;
    }
    // Traversal/ladder/stair clips are not part of this character's approved set.
    // Their gameplay state uses the civilian_002 walk/run cycle instead.
    if (this._actions.idle) this._actions.idle.setEffectiveWeight(1);
    this._isBuilt = true;
    if (this._pendingState) {
      const state = this._pendingState;
      this._pendingState = null;
      this.setState(state);
    }
    if (this._firstPerson) this.root.visible = false;
    console.info('[Character] Built ' + MODEL.displayName + ' player rig');
  }

  buildWeapon(type, tint = [0.18, 0.18, 0.20]) {
    if (!this.weaponMount) return;
    while (this.weaponMount.children.length) {
      const child = this.weaponMount.children[0];
      this.weaponMount.remove(child);
      child.traverse?.(node => { if (node.geometry) node.geometry.dispose(); if (node.material) (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => m?.dispose?.()); });
    }
    this.weaponMount.add(makeWeaponGroup(type, tint));
    this.weaponType = type;
  }

  setAppearance(appearance) {
    Object.assign(this.appearance, appearance);
    if (appearance.weaponType) this.buildWeapon(appearance.weaponType, appearance.weaponTint || [0.18, 0.18, 0.20]);
  }

  setFirstPerson(value) {
    this._firstPerson = !!value;
    this.root.visible = !this._firstPerson;
  }

  setState(state) {
    if (!this._isBuilt) {
      this._pendingState = Object.assign({}, state);
      this.root.position.set(state.x, state.y, state.z);
      this.root.rotation.y = state.yaw + Math.PI;
      return;
    }
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = state.yaw + Math.PI;
    if (this._firstPerson) this.root.visible = false;
    this.applyPose(state);
  }

  applyPose(state = {}) {
    if (!this._mixer || !this._model) return;
    const moving = Math.hypot(state.moveX || 0, state.moveZ || 0) > 0.05 || (state.speed || 0) > 0.15;
    const sprinting = state.sprint > 0.5;
    const crouching = state.crouch > 0.5;
    const aiming = state.aim > 0.1;
    const airborne = state.airborne > 0.5;
    const speed = state.speed || 0;
    const justJumped = airborne && !this._prevAirborne;
    this._prevAirborne = airborne;
    this._wasAirborne = airborne;

    const weights = { idle: 0, walk: 0, run: 0, sprint: 0, crouch: 0, crouchWalk: 0, jump: 0 };
    if (airborne) weights.jump = 1;
    else if (state.climbing > 0.5 || state.stairClimb > 0.5) weights.walk = moving ? 1 : 0;
    else if (moving && crouching) weights.crouchWalk = 1;
    else if (moving && sprinting) weights.sprint = 1;
    else if (moving) weights.walk = 1;
    else if (crouching) weights.crouch = 1;
    else weights.idle = 1;

    // Aiming is an additive arm pose over the civilian_002 locomotion clip.
    this._pendingWeaponPose = { aiming, moving };
    for (const [name, action] of Object.entries(this._actions)) {
      const target = weights[name] || 0;
      if (justJumped && name === 'jump') action.time = 0;
      const current = action.getEffectiveWeight();
      action.setEffectiveWeight(current + (target - current) * BLEND);
      if (target > 0) action.setEffectiveTimeScale(
        name === 'sprint' ? THREE.MathUtils.clamp(speed * 2.1, 1.0, 1.35)
          : name === 'run' ? THREE.MathUtils.clamp(speed * 1.7, 0.8, 1.25)
            : name === 'walk' || name === 'crouchWalk' ? THREE.MathUtils.clamp(speed * 2.2, 0.75, 1.2) : 1
      );
    }
    const targetCrouchY = crouching ? -CROUCH_DROP : 0;
    this._crouchY += (targetCrouchY - this._crouchY) * 0.18;
    this._model.position.y = this._crouchY;
  }

  applyWeaponPose() {
    if (!this._weaponBones?.length) return;
    const selected = WEAPON_POSES[this.weaponType] || WEAPON_POSES.rifle;
    const pose = this._pendingWeaponPose.aiming ? selected.aim : selected.hip;
    if (!pose) return;
    const targets = {
      leftUpper: pose.uaL, rightUpper: pose.uaR,
      leftFore: pose.faL, rightFore: pose.faR,
    };
    for (const entry of this._weaponBones) {
      const value = targets[entry.key];
      if (!value) continue;
      const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(value[0], value[1], value[2]));
      const desired = entry.rest.clone().multiply(delta);
      entry.bone.quaternion.slerp(desired, 0.18);
    }
  }

  update(dt) {
    if (this._mixer) this._mixer.update(dt);
    this.applyWeaponPose();
  }

  setRestPose() {}

  dispose() {
    if (this._mixer) this._mixer.stopAllAction();
    this.root.removeFromParent();
    this._actions = {};
    this._weaponBones = [];
  }
}

function makeWeaponGroup(type, tint=[0.18,0.18,0.20]){
  const w=new THREE.Group();
  const matFor=(c,metal=false)=>{ const col=new THREE.Color(c[0],c[1],c[2]); return new THREE.MeshStandardMaterial({color:col, metalness:metal?0.7:0.15, roughness:metal?0.35:0.82}); };
  const M=(c,m=false)=>matFor(c||tint,m);
  const add=(geo,x,y,z,c,m)=>{ const mm=new THREE.Mesh(geo,M(c||tint,m)); mm.position.set(x,y,z); mm.castShadow=true; w.add(mm); return mm; };
  const barrel=(len,rad=0.02)=>{ const b=new THREE.Mesh(new THREE.CylinderGeometry(rad,rad,len,8), M([0.55,0.56,0.58],true)); b.rotation.x=Math.PI/2; b.position.set(0,0.02,-0.05-len/2); b.castShadow=true; w.add(b); return b; };
  switch(type){
    case 'pistol': add(new THREE.BoxGeometry(0.05,0.10,0.18),0,-0.04,0.02); barrel(0.1,0.018); break;
    case 'shotgun': add(new THREE.BoxGeometry(0.06,0.09,0.22),0,0,0.05,tint,true); add(new THREE.BoxGeometry(0.05,0.14,0.1),0,-0.09,0.08); barrel(0.5,0.03); break;
    case 'sniper': case 'dmr':
      add(new THREE.BoxGeometry(0.05,0.08,0.5),0,0,0,tint,true); add(new THREE.BoxGeometry(0.04,0.12,0.1),0,-0.08,0.12);
      add(new THREE.CylinderGeometry(0.04,0.04,0.18,10),0,0.03,0.0).rotateX(Math.PI/2); barrel(type==='sniper'?0.85:0.6,0.022); break;
    case 'lmg': add(new THREE.BoxGeometry(0.07,0.12,0.45),0,0,0,tint,true); add(new THREE.BoxGeometry(0.06,0.18,0.12),0,-0.12,0.05); barrel(0.55,0.03); break;
    case 'rocket': add(new THREE.CylinderGeometry(0.07,0.07,0.7,10),0,0,-0.1,tint,true).rotateX(Math.PI/2); add(new THREE.BoxGeometry(0.05,0.1,0.2),0,-0.06,0.18); break;
    case 'flame': add(new THREE.BoxGeometry(0.1,0.16,0.22),0,-0.02,0.06); add(new THREE.BoxGeometry(0.05,0.06,0.3),0,0.04,-0.1,tint,true); break;
    case 'grenade': add(new THREE.SphereGeometry(0.05,8,6),0,-0.05,0.05,[0.2,0.3,0.15]); break;
    case 'bow': add(new THREE.BoxGeometry(0.02,0.5,0.04),0,0,-0.1); break;
    default: add(new THREE.BoxGeometry(0.06,0.10,0.4),0,0,0,tint,true); add(new THREE.BoxGeometry(0.05,0.13,0.08),0,-0.09,0.06); barrel(0.45,0.022);
  }
  const grip=new THREE.Mesh(new THREE.BoxGeometry(0.035,0.10,0.035), M([0.12,0.12,0.13])); grip.position.set(0,-0.08,0.04); grip.rotation.x=0.25; w.add(grip);
  const fg=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.08,8), M([0.12,0.12,0.13])); fg.position.set(0,-0.05,-0.22); w.add(fg);
  w.scale.set(0.5,0.5,0.5);
  return w;
}
export function buildWeaponProxy(type, tint=[0.18,0.18,0.20]){ return makeWeaponGroup(type, tint); }
Character.WEAPON_POSES = WEAPON_POSES;
export { ensureLoaded as ensureFbxLoaded, _baseGroup as _fbxBase };
