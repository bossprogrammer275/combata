// Player and combatants share the npc_core_001 humanoid rig.
import * as THREE from 'three';
import { loadNpcCoreBase, cloneNpcCoreModel, preloadNpcCoreAnimations } from './npc-system/core-assets.js';
import { resolvePlayerAnimation, jumpStartOffset } from './player-animation.js';

const MODEL = Object.freeze({ id: 'npc_core_001', displayName: 'NPC Core 001', targetHeight: 1.74 });
const PLAYER_ANIMATION_KEYS = Object.freeze([
  'idle', 'walk', 'walk_aim', 'run', 'rifle_run', 'sprint',
  'crouch_idle', 'crouch_walk', 'crouch_walk_aim',
  'rifle_aim_idle', 'crouch_aim_idle', 'reload_idle', 'jump_idle',
  'obstacle_climb', 'ladder_climb_up',
  'punch', 'enter_vehicle', 'exit_vehicle', 'vehicle_driver_idle'
]);
let _baseGroup = null;
let _clips = {};
let _loadingPromise = null;

function findSkinnedMesh(group) {
  let found = null;
  group.traverse((node) => { if (node.isSkinnedMesh && !found) found = node; });
  return found;
}
function findBone(group, keywords) {
  let found = null;
  group.traverse((node) => {
    if (found || !node.isBone) return;
    const name = (node.name || '').toLowerCase();
    if (keywords.some((key) => name.includes(key.toLowerCase()))) found = node;
  });
  return found;
}
function cloneModel() {
  if (!_baseGroup) return null;
  return cloneNpcCoreModel(_baseGroup);
}
async function ensureLoaded() {
  if (_baseGroup && _clips.idle) return;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    _baseGroup = await loadNpcCoreBase();
    _clips = await preloadNpcCoreAnimations(PLAYER_ANIMATION_KEYS);
    if (!_clips.idle) throw new Error('npc_core_001 failed its required idle animation load');
    console.info('[Character] npc_core_001 ready; loaded ' + Object.keys(_clips).length
      + '/' + PLAYER_ANIMATION_KEYS.length + ' player animations');
  })();
  try { await _loadingPromise; }
  catch (error) {
    _loadingPromise = null;
    _baseGroup = null;
    _clips = {};
    throw error;
  }
}
ensureLoaded().catch((error) => console.error('[Character] npc_core_001 preload failed:', error));

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
    this.appearance = Object.assign({ weaponType: 'rifle', weaponTint: [0.18, 0.18, 0.20], modelYawOffset: Math.PI, runThreshold: 0.48 }, appearance);
    this.root = new THREE.Group();
    this.root.name = 'Character_npc_core_001';
    this.weaponType = this.appearance.weaponType || 'rifle';
    this._firstPerson = false;
    this._mixer = null;
    this._actions = {};
    this._rightHand = null;
    this._model = null;
    this._pendingState = null;
    this._isBuilt = false;
    this._poseMode = 'idle';
    this._forceRestPose = false;
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
    if (!clone) throw new Error('npc_core_001 player rig could not be cloned');
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
      { bone: findBone(clone, ['LeftShoulder', 'mixamorig:LeftShoulder']), key: 'leftShoulder' },
      { bone: findBone(clone, ['RightShoulder', 'mixamorig:RightShoulder']), key: 'rightShoulder' },
      { bone: findBone(clone, ['LeftArm', 'mixamorig:LeftArm']), key: 'leftUpper' },
      { bone: findBone(clone, ['RightArm', 'mixamorig:RightArm']), key: 'rightUpper' },
      { bone: findBone(clone, ['LeftForeArm', 'mixamorig:LeftForeArm']), key: 'leftFore' },
      { bone: findBone(clone, ['RightForeArm', 'mixamorig:RightForeArm']), key: 'rightFore' },
    ].filter(entry => entry.bone);

    this._mixer = new THREE.AnimationMixer(clone);
    for (const [key, clip] of Object.entries(_clips)) {
      const action = this._mixer.clipAction(clip, clone);
      action.enabled = true;
      const oneShot = ['jump_idle', 'reload_idle', 'obstacle_climb', 'punch', 'enter_vehicle', 'exit_vehicle'].includes(key);
      action.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
      action.clampWhenFinished = oneShot;
      action.reset();
      action.setEffectiveWeight(key === 'idle' ? 1 : 0);
      action.play();
      this._actions[key] = action;
    }
    this._isBuilt = true;
    if (this._pendingState) {
      const state = this._pendingState;
      this._pendingState = null;
      this.setState(state);
    }
    // A gameplay spawn/respawn can happen before the async rig finishes loading.
    // Apply the requested rest pose after the pending state so no startup jump
    // anticipation frame leaks into the first visible frame.
    if (this._forceRestPose) this.setRestPose();
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

  setState(state, dt = 1 / 60) {
    if (state.weaponType && state.weaponType !== this.weaponType) {
      this.weaponType = state.weaponType;
      if (this.weaponMount) {
        this.buildWeapon(this.weaponType, this.appearance.weaponTint || [0.18, 0.18, 0.20]);
      }
    }
    const yaw = Number.isFinite(state.yaw) ? state.yaw : 0;
    const yawOffset = Number.isFinite(this.appearance.modelYawOffset) ? this.appearance.modelYawOffset : Math.PI;
    if (!this._isBuilt) {
      this._pendingState = Object.assign({}, state);
      this.root.position.set(state.x || 0, state.y || 0, state.z || 0);
      this.root.rotation.y = yaw + yawOffset;
      return;
    }
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = yaw + yawOffset;
    if (this._firstPerson) this.root.visible = false;
    this.applyPose(state, dt);
  }

  applyPose(state = {}, dt = 1 / 60) {
    if (!this._mixer || !this._model) return;

    let desired = this._actions[state.actionAnimation] ? state.actionAnimation
      : this._actions[state.traversalAnimation] ? state.traversalAnimation
        : resolvePlayerAnimation(state, this._poseMode || 'idle');
    if (!this._actions[desired]) {
      const fallback = {
        walk_aim: 'walk', rifle_run: 'run',
        crouch_walk_aim: 'crouch_walk', crouch_aim_idle: 'crouch_idle',
        rifle_aim_idle: 'idle', reload_idle: 'idle', jump_idle: this._poseMode || 'idle'
      };
      desired = this._actions[fallback[desired]] ? fallback[desired] : 'idle';
    }
    const groundSpeed = Math.max(0, Number(state.groundSpeed) || 0);
    const moving = groundSpeed > 0.14;
    const aiming = Number(state.aim) > 0.1;

    this._pendingWeaponPose = { aiming, moving };
    if (this.weaponMount) this.weaponMount.visible = desired !== 'punch';

    // Only enter/reset a clip when the state actually changes. This prevents
    // locomotion clips from restarting every frame or blending in response to
    // tiny changes in key intent / collision velocity.
    if (desired !== this._poseMode) {
      const next = this._actions[desired];
      if (next) {
        next.reset();
        next.enabled = true;
        // reset() restores Three.js action weight to 1; explicitly zero it so
        // ordinary clip changes crossfade instead of stacking two full poses.
        next.setEffectiveWeight(0);
        if (desired === 'jump_idle') next.time = jumpStartOffset(next.getClip().duration);
        next.play();
      }
      this._poseMode = desired;
    }

    // Locomotion gets a short crossfade. Jump is exclusive: do not blend the
    // old walk/run cycle into the takeoff pose.
    const blend = 1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) * 24);
    const poseBlend = desired === 'jump_idle' ? 1 : blend;
    const speed = Number(state.speed) || 0;
    for (const [name, action] of Object.entries(this._actions)) {
      const target = name === desired ? 1 : 0;
      const current = action.getEffectiveWeight();
      action.setEffectiveWeight(current + (target - current) * poseBlend);
      if (target > 0) action.setEffectiveTimeScale(
        name === 'obstacle_climb' ? 1
          : name === 'ladder_climb_up' ? THREE.MathUtils.clamp(Number(state.traversalAnimationTimeScale) || 1, 0.6, 1.4)
            : name === 'sprint' ? THREE.MathUtils.clamp(speed * 2.1, 0.92, 1.32)
              : name === 'run' || name === 'rifle_run' ? THREE.MathUtils.clamp(speed * 2.0, 0.82, 1.28)
                : name === 'walk' || name === 'walk_aim' || name === 'crouch_walk' || name === 'crouch_walk_aim' ? THREE.MathUtils.clamp(speed * 2.2, 0.68, 1.2) : 1
      );
    }

    // Crouch height is authored in the Mixamo crouch/crouch-walk clips.
    // Do not translate the model as well or the visual crouch is doubled.
  }

  getBoneOffsetFromRoot(name, target = new THREE.Vector3()) {
    if (!this._model || !name) return null;
    const aliases = {
      LeftHand: ['LeftHand', 'mixamorig:LeftHand'],
      RightHand: ['RightHand', 'mixamorig:RightHand'],
      LeftFoot: ['LeftFoot', 'mixamorig:LeftFoot'],
      RightFoot: ['RightFoot', 'mixamorig:RightFoot'],
      Hips: ['Hips', 'mixamorig:Hips', 'Pelvis'],
    };
    const bone = findBone(this._model, aliases[name] || [String(name)]);
    if (!bone) return null;
    this.root.updateWorldMatrix(true, true);
    bone.getWorldPosition(target);
    const rootWorld = this.root.getWorldPosition(new THREE.Vector3());
    return target.sub(rootWorld);
  }

  applyWeaponPose(dt = 1 / 60) {
    // This downloaded animation set is rifle-only. Never fake a pistol pose
    // from the rifle's static arm offsets.
    if (this.weaponType !== 'rifle') return;
    if (['rifle_aim_idle', 'walk_aim', 'rifle_run', 'crouch_aim_idle', 'crouch_walk_aim'].includes(this._poseMode)) return;
    if (!this._weaponBones?.length) return;
    // The player uses the rig's own relaxed idle and locomotion arm motion.
    // Apply the held-weapon correction only when aiming so it cannot force
    // the shoulders into the wide hip-fire pose while standing or walking.
    if (this.appearance.hipWeaponPose === false && !this._pendingWeaponPose.aiming) return;
    const selected = WEAPON_POSES[this.weaponType] || WEAPON_POSES.rifle;
    const pose = this._pendingWeaponPose.aiming ? selected.aim : selected.hip;
    if (!pose) return;
    const eulerTargets = {
      leftShoulder: new THREE.Euler(0, 0, pose.shL || 0),
      rightShoulder: new THREE.Euler(0, 0, pose.shR || 0),
      leftUpper: new THREE.Euler(...pose.uaL),
      rightUpper: new THREE.Euler(...pose.uaR),
      // Forearm angles are scalar X rotations in WEAPON_POSES, not arrays.
      leftFore: new THREE.Euler(pose.faL || 0, 0, 0),
      rightFore: new THREE.Euler(pose.faR || 0, 0, 0),
    };
    const blend = 1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) * 16);
    for (const entry of this._weaponBones) {
      const euler = eulerTargets[entry.key];
      if (!euler) continue;
      // Layer the held-weapon correction over the current Mixamo pose.
      // Never replace the animated bone with its static bind-pose quaternion.
      const animated = entry.bone.quaternion.clone();
      const offset = new THREE.Quaternion().setFromEuler(euler);
      const desired = animated.clone().multiply(offset);
      entry.bone.quaternion.copy(animated).slerp(desired, blend);
    }
  }

  update(dt) {
    if (this._mixer) this._mixer.update(dt);
    this.applyWeaponPose(dt);
  }

  getActionDuration(key) {
    return Number(this._actions[key]?.getClip?.().duration) || 0;
  }

  setRestPose() {
    this._forceRestPose = true;
    this._poseMode = 'idle';
    this._pendingWeaponPose = { aiming: false, moving: false };
    if (this.weaponMount) this.weaponMount.visible = true;
    this._wasAirborne = false;
    this._prevAirborne = false;
    if (!this._isBuilt || !this._mixer) return;

    // Hard-reset every action once at spawn. This removes any leftover jump
    // anticipation/crouch blend from loading or the previous life.
    for (const [name, action] of Object.entries(this._actions)) {
      action.enabled = true;
      action.reset();
      action.setEffectiveTimeScale(1);
      action.setEffectiveWeight(name === 'idle' ? 1 : 0);
      action.play();
    }
    this._forceRestPose = false;
  }

  dispose() {
    if (this._mixer) this._mixer.stopAllAction();
    // Character materials are cloned per instance; textures and imported
    // geometry are shared through the npc_core_001 base cache.
    this._model?.traverse((node) => {
      if (!node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material?.dispose?.());
    });
    // Procedural hand-held weapon geometry is instance-owned.
    this.weaponMount?.traverse((node) => node.geometry?.dispose?.());
    this.root.removeFromParent();
    this._actions = {};
    this._weaponBones = [];
    this._model = null;
    this._mixer = null;
    this.mesh = null;
    this.skeleton = null;
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
