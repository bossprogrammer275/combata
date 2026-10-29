// Character — FBX-only. Walking.fbx = base model + walk anim.
// All other animations loaded from separate Mixamo FBX files.

import * as THREE from 'three';
import { FBXLoader } from './lib/FBXLoader.js';

const ANIM_URLS = {
  walk:    './data/models/npc/npc1/Walking.fbx',
  run:     './data/models/npc/npc1/Running.fbx',
  idle:    './data/models/npc/npc1/Idle.fbx',
  crouch:  './data/models/npc/npc1/Idle Crouching.fbx',
  aim:     './data/models/npc/npc1/Rifle Aiming Idle.fbx',
  aimWalk: './data/models/npc/npc1/Walking AIM.fbx',
  jump:    './data/models/npc/npc1/Jump.fbx',
  climb:   './data/models/npc/npc1/Climbing.fbx',
  stairUp: './data/models/npc/npc1/Ascending Stairs.fbx',
};

const CROUCH_DROP = 0.45;

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
    for (const k of keywords) if (n.includes(k.toLowerCase())) { out = o; break; }
  });
  return out;
}

function stripRootMotion(clip) {
  for (let i = clip.tracks.length - 1; i >= 0; i--) {
    const t = clip.tracks[i];
    if (t.name.includes('Hips') && t.name.includes('.position')) {
      clip.tracks.splice(i, 1);
    }
  }
  return clip;
}

function cloneModel() {
  if (!_baseGroup) return null;
  const clone = _baseGroup.clone(true);
  clone.updateMatrixWorld(true);

  const clonedBones = [];
  clone.traverse(o => { if (o.isBone) clonedBones.push(o); });
  const nameToClonedBone = new Map(clonedBones.map(b => [b.name, b]));

  clone.traverse(o => {
    if (o.isSkinnedMesh && o.skeleton) {
      const newBones = o.skeleton.bones.map(b => nameToClonedBone.get(b.name) || b);
      const newBoneInverses = o.skeleton.boneInverses.map(m => m.clone());
      o.skeleton = new THREE.Skeleton(newBones, newBoneInverses);
      o.bind(o.skeleton, o.bindMatrix);
    }
  });

  clone.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      const geo = o.geometry;
      if (!geo) return;
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.position) return;

      const origMats = Array.isArray(o.material) ? o.material : [o.material];
      const newMats = origMats.map(m => {
        const c = m.clone();
        c.side = THREE.DoubleSide;
        c.transparent = false;
        c.opacity = 1;
        c.depthWrite = true;
        c.depthTest = true;
        c.alphaTest = 0;
        // Check if texture actually loaded (image data valid)
        const hasValidMap = c.map && c.map.image && c.map.image.width > 0;
        if (!hasValidMap) {
          if (c.map) { c.map.dispose(); c.map = null; }
          if (!c.color || c.color.getHex() === 0x000000) {
            c.color = new THREE.Color(0xC8A88A);
          }
        }
        c.needsUpdate = true;
        return c;
      });
      o.material = origMats.length === 1 ? newMats[0] : newMats;
    }
  });

  return clone;
}

async function loadAnimClip(url) {
  const fbx = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
  const clip = fbx.animations && fbx.animations.length ? fbx.animations[0] : null;
  fbx.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { try { m.dispose(); } catch {} });
  });
  return clip;
}

async function ensureLoaded() {
  if (_baseGroup && Object.keys(_clips).length >= 7) return;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    let walk = null;
    try { walk = await new Promise((res, rej) => loader.load(ANIM_URLS.walk, res, undefined, rej)); }
    catch (e) { console.warn('[Character] Walking.fbx failed', e); }
    if (!walk) throw new Error('[Character] Walking.fbx not found');

    walk.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      }
    });

    const bbox = new THREE.Box3().setFromObject(walk);
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const TARGET_HEIGHT = 1.8;
    if (maxDim > 10) {
      walk.scale.setScalar(TARGET_HEIGHT / maxDim);
      console.log('[Character] auto-scale:', maxDim.toFixed(1), '->', TARGET_HEIGHT);
    }
    walk.updateMatrixWorld(true);
    _baseGroup = walk;

    if (walk.animations && walk.animations.length) {
      _clips.walk = stripRootMotion(walk.animations[0].clone());
      console.log('[Character] walk clip dur:', _clips.walk.duration.toFixed(2) + 's');
    }

    // Load ALL other animations in PARALLEL (not sequential)
    const otherAnims = Object.entries(ANIM_URLS).filter(([key]) => key !== 'walk');
    const animResults = await Promise.allSettled(
      otherAnims.map(([key, url]) => loadAnimClip(url).then(clip => ({ key, clip })))
    );
    for (const result of animResults) {
      if (result.status === 'fulfilled' && result.value.clip) {
        const { key, clip } = result.value;
        _clips[key] = stripRootMotion(clip.clone());
        console.log(`[Character] ${key} clip dur: ${clip.duration.toFixed(2)}s`);
      } else if (result.status === 'rejected') {
        console.warn('[Character] parallel anim load failed:', result.reason?.message);
      }
    }

    console.log('[Character] clips loaded:', Object.keys(_clips).join(', '));
  })();
  return _loadingPromise;
}

ensureLoaded().catch(() => {});

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

const BLEND = 0.14;

export class Character {
  constructor(appearance = {}) {
    this.appearance = Object.assign({
      weaponType: 'rifle', weaponTint: [0.18, 0.18, 0.20],
    }, appearance);
    this.root = new THREE.Group();
    this.root.name = 'CharacterRoot';
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
    this.build();
  }

  async build() {
    await ensureLoaded();
    if (this._isBuilt) return;

    const clone = cloneModel();
    if (!clone) { console.error('[Character] clone failed'); return; }
    this._model = clone;
    this.root.add(clone);

    this._rightHand = findBone(clone, ['RightHand', 'mixamorig:RightHand', 'Hand_R', 'RightArm']);
    this._leftHand  = findBone(clone, ['LeftHand', 'mixamorig:LeftHand', 'Hand_L']);
    this._head = findBone(clone, ['Head', 'mixamorig:Head', 'HeadTop']);
    this._hips = findBone(clone, ['Hips', 'mixamorig:Hips', 'Pelvis']);
    this.hips = this._hips || this.root;
    this.chest = findBone(clone, ['Spine2', 'Spine1', 'Spine', 'mixamorig:Spine2']) || this.root;
    this.head = this._head || this.root;
    this.handR = this._rightHand || this.root;
    this.handL = this._leftHand || this.root;
    this.mesh = findSkinnedMesh(clone);
    this.skeleton = this.mesh && this.mesh.skeleton ? this.mesh.skeleton : null;

    this.weaponMount = new THREE.Group();
    this.weaponMount.name = 'weaponMount';
    this.weaponMount.rotation.y = Math.PI;
    this.weaponMount.position.set(0, 0.02, 0.06);
    if (this._rightHand) this._rightHand.add(this.weaponMount);
    else this.root.add(this.weaponMount);
    this.buildWeapon(this.weaponType, this.appearance.weaponTint || [0.18, 0.18, 0.20]);

    this._mixer = new THREE.AnimationMixer(clone);

    for (const name of Object.keys(_clips)) {
      const action = this._mixer.clipAction(_clips[name]);
      action.setEffectiveWeight(0);
      action.play();
      this._actions[name] = action;
    }

    if (this._actions.idle) this._actions.idle.setEffectiveWeight(1);

    this._isBuilt = true;
    if (this._pendingState) { const s = this._pendingState; this._pendingState = null; this.setState(s); }
    if (this._firstPerson) this.root.visible = false;
    console.log('[Character] built — actions:', Object.keys(this._actions).join(', '));
  }

  buildWeapon(type, tint = [0.18, 0.18, 0.20]) {
    if (!this.weaponMount) return;
    while (this.weaponMount.children.length) this.weaponMount.remove(this.weaponMount.children[0]);
    this.weaponMount.add(makeWeaponGroup(type, tint));
    this.weaponType = type;
  }

  setAppearance(appearance) {
    Object.assign(this.appearance, appearance);
    if (appearance.weaponType) this.buildWeapon(appearance.weaponType, appearance.weaponTint || [0.18, 0.18, 0.20]);
  }

  setFirstPerson(v) {
    this._firstPerson = !!v;
    this.root.visible = !v;
  }

  setState(s) {
    if (!this._isBuilt) { this._pendingState = Object.assign({}, s); this.root.position.set(s.x, s.y, s.z); this.root.rotation.y = s.yaw + Math.PI; return; }
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw + Math.PI;
    if (this._firstPerson) this.root.visible = false;
    this.applyPose(s);
  }

  applyPose(s = {}) {
    if (!this._mixer || !this._model) return;
    const moving = Math.hypot(s.moveX || 0, s.moveZ || 0) > 0.05 || (s.speed || 0) > 0.15;
    const isSprint = s.sprint > 0.5;
    const crouching = (s.crouch || 0) > 0.5;
    const aiming = (s.aim || 0) > 0.1;
    const airborne = (s.airborne || 0) > 0.5;
    const speed = s.speed || 0;

    const justJumped = airborne && !this._prevAirborne;
    const justLanded = !airborne && this._wasAirborne;
    this._prevAirborne = airborne;
    this._wasAirborne = airborne;

    let idle = 0, walk = 0, run = 0, crouch = 0, aim = 0, aimWalk = 0, jump = 0, climb = 0, stairUp = 0;

    if (s.climbing > 0.5) {
      climb = 1;
      idle = 0;
    } else if (airborne) {
      jump = 1;
      idle = 0;
    } else if (s.stairClimb > 0.5 && moving) {
      stairUp = 1;
      if (isSprint && !crouching) { if (aiming) { aimWalk = 1; stairUp = 0; } else { run = 0; stairUp = 1; } }
      else { walk = 0; stairUp = 1; }
    } else if (moving && isSprint && !crouching) {
      if (aiming) { aimWalk = 1; } else { run = 1; }
    } else if (moving && crouching) {
      walk = 0.3;
      crouch = 0.7;
    } else if (moving) {
      if (aiming) { aimWalk = 1; } else { walk = 1; }
    } else if (crouching) {
      crouch = 1;
    } else {
      idle = 1;
    }

    if (aiming && !moving && !crouching && !airborne && !(s.climbing > 0.5)) {
      aim = Math.min(1, s.aim * 2);
      idle = 0;
    }

    if (justJumped || justLanded || (s.climbing > 0.5 && !this._wasClimbing) || (s.climbing < 0.5 && this._wasClimbing)) {
      const wasStateChange = (s.climbing > 0.5 && !this._wasClimbing) || (s.climbing < 0.5 && this._wasClimbing);
      this._wasClimbing = s.climbing > 0.5;
      for (const name of Object.keys(this._actions)) {
        const a = this._actions[name];
        if (!a) continue;
        if (justJumped) {
          a.setEffectiveWeight(name === 'jump' ? 1 : 0);
        } else if (wasStateChange) {
          const targets = { idle, walk, run, crouch, aim, aimWalk, jump: 0, climb, stairUp };
          const target = targets[name] || 0;
          a.setEffectiveWeight(target);
          if (name === 'climb' && climb > 0.5) a.time = 0;
        } else {
          const targets = { idle, walk, run, crouch, aim, aimWalk, jump: 0, climb, stairUp };
          a.setEffectiveWeight(targets[name] || 0);
        }
      }
      if (justJumped) {
        const ja = this._actions.jump;
        if (ja) ja.time = 0;
      }
    } else {
      const b = (action, target) => {
        if (!action) return;
        const cur = action.getEffectiveWeight();
        action.setEffectiveWeight(cur + (target - cur) * BLEND);
      };

      b(this._actions.idle, idle);
      b(this._actions.walk, walk);
      b(this._actions.run, run);
      b(this._actions.crouch, crouch);
      b(this._actions.aim, aim);
      b(this._actions.aimWalk, aimWalk);
      const ja = this._actions.jump;
      if (ja) ja.setEffectiveWeight(jump);
      b(this._actions.climb, climb);
      b(this._actions.stairUp, stairUp);
    }

    this._mixer.timeScale = 1;

    if (this._actions.walk) {
      const walkRate = speed > 0.01 ? Math.max(speed, 0.8) : 1.0;
      this._actions.walk.setEffectiveTimeScale(walkRate);
    }
    if (this._actions.run) {
      const runRate = speed > 0.01 ? Math.max(speed * 0.8, 1.0) : 1.0;
      this._actions.run.setEffectiveTimeScale(runRate);
    }
    if (this._actions.aimWalk) {
      const aimWalkRate = speed > 0.01 ? Math.max(speed, 0.9) : 1.0;
      this._actions.aimWalk.setEffectiveTimeScale(isSprint ? aimWalkRate * 1.5 : aimWalkRate);
    }
    if (this._actions.crouch) {
      this._actions.crouch.setEffectiveTimeScale(speed > 0.01 ? Math.max(speed * 0.7, 0.6) : 0.0);
    }
    if (this._actions.jump) {
      this._actions.jump.setEffectiveTimeScale(1.2);
    }
    if (this._actions.climb) {
      this._actions.climb.setEffectiveTimeScale(speed > 0.01 ? Math.max(speed * 0.7, 0.8) : 0.8);
    }
    if (this._actions.stairUp) {
      const stairRate = speed > 0.01 ? Math.max(speed, 0.9) : 0.9;
      this._actions.stairUp.setEffectiveTimeScale(stairRate);
    }

    const targetCrouchY = crouching ? -CROUCH_DROP : 0;
    this._crouchY += (targetCrouchY - this._crouchY) * 0.14;
    this._model.position.y = this._crouchY;
  }

  update(dt) {
    if (this._mixer) this._mixer.update(dt);
  }

  setRestPose() { /* handled by idle action weight */ }

  dispose() {
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { try { if (m.map) m.map.dispose(); m.dispose(); } catch {} });
    });
    if (this._mixer) this._mixer.stopAllAction();
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
