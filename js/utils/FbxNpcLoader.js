// FbxNpcLoader.js — loads the real FBX npc model + Walking anim, mounts guns, provides Character-compatible wrapper
import * as THREE from 'three';
import { FBXLoader } from '../lib/FBXLoader.js';

const MODEL_URL = './data/models/npc/model.fbx';
const WALK_URL  = './data/models/npc/Walking.fbx';

const fbxLoader = new FBXLoader();
let _base = null;      // Group with SkinnedMesh + skeleton for model.fbx
let _walkClip = null;  // AnimationClip from Walking.fbx
let _walkGroup = null; // Group from Walking.fbx (fallback mesh)
let _loading = null;

function findSkinnedMesh(group) {
  let found = null;
  group.traverse(o => { if (o.isSkinnedMesh && !found) found = o; });
  if (!found) group.traverse(o => { if (o.isMesh && !found) found = o; });
  return found;
}
function findBone(group, names) {
  let out = null;
  group.traverse(o => {
    if (out) return;
    if (o.isBone) {
      const n = (o.name || '').toLowerCase();
      for (const want of names) if (n.includes(want.toLowerCase())) { out = o; break; }
    }
  });
  return out;
}
function findSkeleton(group) {
  const mesh = findSkinnedMesh(group);
  return mesh && mesh.skeleton ? mesh.skeleton : null;
}

async function loadFbx(url) {
  return new Promise((res, rej) => fbxLoader.load(url, res, undefined, rej));
}

export async function ensureFbxLoaded() {
  if (_base && (_walkClip || _walkGroup)) return { base: _base, clip: _walkClip, walkGroup: _walkGroup };
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const [base, walk] = await Promise.all([
        loadFbx(MODEL_URL).catch(e => { console.warn('model.fbx load failed', e); return null; }),
        loadFbx(WALK_URL).catch(e => { console.warn('Walking.fbx load failed', e); return null; }),
      ]);
      if (base) {
        // Normalize scale — MakeHuman / Mixamo models are ~100x too big; scale to ~1.7m
        // FBX units are cm? base scale tweak to match procedural rig (~1.7 height)
        base.traverse(o => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; } });
        // Try to center: base already at origin
        _base = base;
        console.log('[FbxNpc] base bones:', (() => {
          const names=[]; base.traverse(o=>{ if(o.isBone) names.push(o.name); });
          return names.slice(0,20).join(', ') + (names.length>20?' ... +'+(names.length-20):'');
        })());
        const sk = findSkeleton(base);
        if (sk) console.log('[FbxNpc] base skeleton bones', sk.bones.length);
      }
      if (walk) {
        walk.traverse(o => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; } });
        _walkGroup = walk;
        if (walk.animations && walk.animations.length) {
          _walkClip = walk.animations[0];
          console.log('[FbxNpc] walk clip', _walkClip.name, 'duration', _walkClip.duration, 'tracks', _walkClip.tracks.length);
        }
        const wNames=[]; walk.traverse(o=>{ if(o.isBone) wNames.push(o.name); });
        console.log('[FbxNpc] walk bones:', wNames.slice(0,20).join(', '));
      }
      if (!_base && _walkGroup) {
        // Fallback: use walk mesh as base if model.fbx failed or had no usable skeleton
        _base = _walkGroup;
      }
    } catch (e) {
      console.error('[FbxNpc] ensure load error', e);
    }
    return { base: _base, clip: _walkClip, walkGroup: _walkGroup };
  })();
  return _loading;
}

export function isFbxReady() { return !!_base; }

// Clone the base model for a new NPC instance
export function cloneFbxModel() {
  if (!_base) return null;
  const clone = _base.clone(true);
  // Need to clone skeleton properly — THREE's clone doesn't clone skeleton correctly, use SkeletonUtils
  // Simple approach: traverse and create new skeleton via skeleton.clone? We'll use original skeleton bones cloned manually
  // FBXLoader already sets up shared skeleton; clone(true) will share same skeleton reference which causes interference.
  // So we need to deep clone via SkeletonUtils.clone if available, else manual.
  // For now, just clone and create new Skeleton from cloned bones
  const skinned = findSkinnedMesh(clone);
  if (skinned && skinned.skeleton) {
    const bones = [];
    clone.traverse(o => { if (o.isBone) bones.push(o); });
    // Find original bone mapping
    const origBones = findSkeleton(_base)?.bones || [];
    // Rebuild skeleton with cloned bones
    const newBones = bones;
    // Create new skeleton with same boneInverses
    const origSkel = findSkeleton(_base);
    if (origSkel) {
      skinned.skeleton = new THREE.Skeleton(newBones, origSkel.boneInverses.map(m=>m.clone()));
      skinned.bind(skinned.skeleton, skinned.matrixWorld);
    }
  }
  // Scale fix: ensure clone at correct height (feet at y=0)
  // FBX models often have hips at ~90cm; we keep as is, root at 0 will place feet roughly at 0 if model was authored at origin
  clone.scale.setScalar(0.01); // FBX is in cm, procedural is in meters -> 1cm =0.01m
  // Some Mixamo models already are 1 unit = cm, so 100 units = 1m -> need 0.01 scale
  // If model appears too small/big, adjust here
  return clone;
}

// Create a Character-compatible wrapper around FBX model
export class FbxCharacter {
  constructor(appearance = {}, clone = null) {
    this.appearance = appearance;
    this.root = new THREE.Group();
    this.root.name = 'FbxCharacterRoot';
    this._mixer = null;
    this._clip = _walkClip;
    this._action = null;
    this._weaponMount = null;
    this._rightHand = null;
    this._model = clone || cloneFbxModel();
    if (!this._model) {
      console.warn('[FbxCharacter] no FBX base, fallback will be used');
      return;
    }
    // Normalize: remove extra animations holder, keep mesh
    this.root.add(this._model);
    // Find bones
    this._rightHand = findBone(this._model, ['RightHand','Hand_R','mixamorig:RightHand']);
    this._leftHand  = findBone(this._model, ['LeftHand','Hand_L','mixamorig:LeftHand']);
    this._head = findBone(this._model, ['Head','mixamorig:Head']);
    const skinned = findSkinnedMesh(this._model);
    if (skinned && skinned.skeleton) {
      this.skeleton = skinned.skeleton;
      this.mesh = skinned;
    }
    // Weapon mount
    this.weaponMount = new THREE.Group();
    this.weaponMount.name = 'weaponMount';
    this.weaponMount.rotation.y = Math.PI;
    this.weaponMount.position.set(0, 0.02, 0.08);
    if (this._rightHand) this._rightHand.add(this.weaponMount);
    else this.root.add(this.weaponMount);
    this.weaponType = appearance.weaponType || 'rifle';
    this.buildWeapon(this.weaponType, appearance.weaponTint || [0.18,0.18,0.20]);

    // Mixer for Walking clip
    if (this._clip) {
      this._mixer = new THREE.AnimationMixer(this._model);
      this._action = this._mixer.clipAction(this._clip);
      this._action.play();
      this._action.enabled = true;
      this._action.setEffectiveWeight(0); // start idle
    }
    // Expose for wardrobe compat (fake bones)
    this.hips = findBone(this._model, ['Hips','Pelvis']) || this._model;
    this.chest = findBone(this._model, ['Spine2','Spine']) || this._model;
    this.head = this._head || this._model;
  }
  buildWeapon(type, tint) {
    if (!this.weaponMount) return;
    while (this.weaponMount.children.length) this.weaponMount.remove(this.weaponMount.children[0]);
    this.weaponMount.add(makeWeaponGroup(type, tint));
    this.weaponType = type;
  }
  setAppearance(a) {
    if (a.weaponType) this.buildWeapon(a.weaponType, a.weaponTint || this.appearance.weaponTint);
    Object.assign(this.appearance, a);
  }
  setFirstPerson(v) { this.root.visible = !v; }
  setState(s) {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw + Math.PI;
    if (this._firstPerson) this.root.visible = false;
    this.applyPose(s);
  }
  applyPose(s={}) {
    // Drive animation mixer weight based on speed
    if (this._mixer && this._action) {
      const moving = Math.hypot(s.moveX||0, s.moveZ||0) > 0.05 || (s.speed||0) > 0.1;
      const target = moving ? 1 : 0;
      const cur = this._action.getEffectiveWeight();
      const nxt = cur + (target - cur) * 0.15;
      this._action.setEffectiveWeight(nxt);
      // sprint = timeScale
      const isSprint = s.sprint > 0.5;
      this._mixer.timeScale = isSprint ? 1.5 : 1.0;
    }
  }
  update(dt) {
    if (this._mixer) this._mixer.update(dt);
  }
  setUpdate(dt) { this.update(dt); }
  dispose() {
    this.root.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material) (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose&&m.dispose()); });
  }
  // Compatibility for old code that expects .wardrobe etc (no-op)
  get wardrobe(){ return null; }
  get saAnimator(){ return null; }
}

// Simple weapon builder (same as Character)

function makeWeaponGroup(type, tint=[0.18,0.18,0.20]){
  // Reuse Character's weapon builder to keep identical guns — import lazily to avoid cycle
  // Fallback to simple boxes if import fails
  try {
    // dynamic try
    const g = new THREE.Group();
    const matFor = (c, metal=false)=>{
      const col=new THREE.Color(c[0],c[1],c[2]);
      return new THREE.MeshStandardMaterial({color:col, metalness: metal?0.7:0.15, roughness: metal?0.35:0.82});
    };
    const M=(c,m=false)=>matFor(c||tint,m);
    const add=(geo,x,y,z,c,m)=>{ const mm=new THREE.Mesh(geo,M(c||tint,m)); mm.position.set(x,y,z); mm.castShadow=true; g.add(mm); return mm; };
    const barrel=(len,rad=0.02)=>{ const b=new THREE.Mesh(new THREE.CylinderGeometry(rad,rad,len,8), M([0.55,0.56,0.58],true)); b.rotation.x=Math.PI/2; b.position.set(0,0.02,-0.05-len/2); b.castShadow=true; g.add(b); return b; };
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
    const grip=new THREE.Mesh(new THREE.BoxGeometry(0.035,0.10,0.035), M([0.12,0.12,0.13])); grip.position.set(0,-0.08,0.04); grip.rotation.x=0.25; g.add(grip);
    const fg=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.08,8), M([0.12,0.12,0.13])); fg.position.set(0,-0.05,-0.22); g.add(fg);
    g.scale.set(0.5,0.5,0.5); // Fbx is 0.01 scale, weapon at 0.5 keeps visible
    return g;
  } catch(e){
    const g=new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,0.3), new THREE.MeshStandardMaterial({color:0x333333})));
    return g;
  }
}
