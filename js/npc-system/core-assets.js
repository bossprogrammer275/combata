// Shared npc_core_001 asset loader. All live characters reuse this rig and clip cache.
import * as THREE from 'three';
import { FBXLoader } from '../lib/FBXLoader.js';

export const NPC_CORE_ID = 'npc_core_001';
export const NPC_CORE_ROOT = './data/models/npc/npc_core_001/';
export const NPC_CORE_TARGET_HEIGHT = 1.74;
const loader = new FBXLoader();
loader.setResourcePath(NPC_CORE_ROOT + 'textures/');
let manifestPromise = null;
let basePromise = null;
const clipPromises = new Map();
const IN_PLACE = new Set(['walk','walk_aim','run','rifle_run','sprint','crouch_walk','crouch_walk_aim','jump_idle']);
export const NPC_ANIMATION_ALIASES = Object.freeze({
  crouch: 'crouch_idle', crouchWalk: 'crouch_walk', jump: 'jump_idle',
  sitIdle: 'sit_idle', fall_death: 'death_candidate', get_up: 'knockdown_recovery_candidate'
});
export const resolveNpcAnimationKey = (key) => NPC_ANIMATION_ALIASES[key] || key;

function loadFbx(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

export async function loadNpcCoreManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(NPC_CORE_ROOT + 'manifest.json', { cache: 'force-cache' })
      .then((response) => {
        if (!response.ok) throw new Error('NPC core manifest returned HTTP ' + response.status);
        return response.json();
      }).catch((error) => { manifestPromise = null; throw error; });
  }
  return manifestPromise;
}

function inspectRig(model) {
  const meshes = [];
  const bones = new Set();
  const materials = new Set();
  model.traverse((node) => {
    if (node.isSkinnedMesh) {
      meshes.push(node);
      node.skeleton?.bones.forEach((bone) => bones.add(bone.name));
    }
    if (node.isBone) bones.add(node.name);
    if (node.isMesh || node.isSkinnedMesh) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((mat) => {
        if (!mat) return;
        materials.add(mat);
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        mat.needsUpdate = true;
      });
      node.castShadow = true;
      node.receiveShadow = false;
      node.frustumCulled = !node.isSkinnedMesh;
      if (node.geometry && !node.geometry.attributes.normal) node.geometry.computeVertexNormals();
    }
  });
  return { meshes, boneCount: bones.size, materialCount: materials.size };
}

export async function loadNpcCoreBase() {
  if (!basePromise) {
    basePromise = (async () => {
      const manifest = await loadNpcCoreManifest();
      const candidate = manifest.baseRig?.candidateFile || (NPC_CORE_ROOT + 'animations/Idle.fbx');
      const url = './' + String(candidate).replace(/^\.\//, '').replace(/^\//, '');
      const model = await loadFbx(url);
      model.updateMatrixWorld(true);
      const report = inspectRig(model);
      const bounds = new THREE.Box3().setFromObject(model);
      const height = bounds.max.y - bounds.min.y;
      const idle = model.animations?.[0];
      if (!report.meshes.length || !report.boneCount) {
        throw new Error('npc_core_001 is not a bound skinned rig (meshes ' + report.meshes.length + ', bones ' + report.boneCount + ')');
      }
      if (!Number.isFinite(height) || height < 0.5) throw new Error('npc_core_001 has invalid source height: ' + height);
      if (!idle?.tracks?.length) throw new Error('npc_core_001 Idle.fbx has no playable idle take');
      model.scale.setScalar(NPC_CORE_TARGET_HEIGHT / height);
      model.updateMatrixWorld(true);
      const fitted = new THREE.Box3().setFromObject(model);
      model.position.y -= fitted.min.y;
      model.updateMatrixWorld(true);
      model.userData.npcCoreValidation = {
        id: NPC_CORE_ID, sourceHeight: height, targetHeight: NPC_CORE_TARGET_HEIGHT,
        skinnedMeshes: report.meshes.length, bones: report.boneCount,
        materials: report.materialCount, idleTracks: idle.tracks.length, verified: true
      };
      console.info('[NPC Core] Verified ' + NPC_CORE_ID + ': ' + report.meshes.length
        + ' skinned mesh(es), ' + report.boneCount + ' bones; fitted to ' + NPC_CORE_TARGET_HEIGHT + 'm');
      return model;
    })().catch((error) => { basePromise = null; throw error; });
  }
  return basePromise;
}

export function cloneNpcCoreModel(source) {
  if (!source) throw new Error('npc_core_001 base rig is not loaded');
  const clone = source.clone(true);
  clone.updateMatrixWorld(true);
  const sourceMeshes = [];
  const cloneMeshes = [];
  const bonesByName = new Map();
  source.traverse((node) => { if (node.isSkinnedMesh) sourceMeshes.push(node); });
  clone.traverse((node) => {
    if (node.isSkinnedMesh) cloneMeshes.push(node);
    if (node.isBone && !bonesByName.has(node.name)) bonesByName.set(node.name, node);
  });
  if (!sourceMeshes.length || sourceMeshes.length !== cloneMeshes.length) throw new Error('npc_core_001 clone lost skinned meshes');
  for (let i = 0; i < sourceMeshes.length; i++) {
    const original = sourceMeshes[i], mesh = cloneMeshes[i];
    if (!original.skeleton) throw new Error('npc_core_001 has an unbound SkinnedMesh');
    const bones = original.skeleton.bones.map((bone) => bonesByName.get(bone.name));
    if (bones.some((bone) => !bone)) throw new Error('npc_core_001 clone has an unresolved Mixamo bone');
    const skeleton = new THREE.Skeleton(bones, original.skeleton.boneInverses.map((matrix) => matrix.clone()));
    mesh.bind(skeleton, original.bindMatrix.clone());
    mesh.bindMode = original.bindMode;
    mesh.frustumCulled = false;
  }
  clone.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    node.castShadow = true;
    node.receiveShadow = false;
    node.frustumCulled = false;
    const sourceMats = Array.isArray(node.material) ? node.material : [node.material];
    const mats = sourceMats.map((sourceMat) => {
      if (!sourceMat) return sourceMat;
      const mat = sourceMat.clone();
      mat.side = THREE.DoubleSide;
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
      mat.depthTest = true;
      if (mat.map) { mat.map.colorSpace = THREE.SRGBColorSpace; mat.map.needsUpdate = true; mat.color?.setHex(0xffffff); }
      if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      if (mat.emissive) { mat.emissive.setRGB(0.012, 0.010, 0.008); mat.emissiveIntensity = 0.12; }
      mat.needsUpdate = true;
      return mat;
    });
    node.material = sourceMats.length === 1 ? mats[0] : mats;
  });
  return clone;
}

function stripControllerRootTranslation(clip) {
  for (let i = clip.tracks.length - 1; i >= 0; i--) {
    const name = clip.tracks[i].name;
    if (/hips/i.test(name) && /\.position$/i.test(name)) clip.tracks.splice(i, 1);
  }
  return clip;
}

export async function loadNpcCoreClip(requestedKey) {
  const key = resolveNpcAnimationKey(requestedKey);
  if (!key) throw new Error('Empty NPC animation key');
  if (!clipPromises.has(key)) {
    clipPromises.set(key, (async () => {
      const manifest = await loadNpcCoreManifest();
      const entry = manifest.animations?.[key];
      if (!entry?.file) throw new Error('npc_core_001 has no downloaded animation: ' + key);
      if (key === 'idle') {
        const base = await loadNpcCoreBase();
        const clip = base.animations?.[0]?.clone();
        if (!clip?.tracks?.length) throw new Error('npc_core_001 base idle take is empty');
        clip.name = key;
        return clip;
      }
      const url = './' + String(entry.file).replace(/^\.\//, '').replace(/^\//, '');
      const group = await loadFbx(url);
      const clip = group.animations?.[0]?.clone();
      group.traverse((node) => {
        node.geometry?.dispose();
        if (node.material) (Array.isArray(node.material) ? node.material : [node.material]).forEach((mat) => mat?.dispose?.());
      });
      if (!clip?.tracks?.length) throw new Error('Downloaded FBX has no playable animation take: ' + entry.file);
      clip.name = key;
      if (IN_PLACE.has(key)) stripControllerRootTranslation(clip);
      clip.optimize();
      return clip;
    })().catch((error) => { clipPromises.delete(key); throw error; }));
  }
  return clipPromises.get(key);
}

export async function preloadNpcCoreAnimations(keys = ['idle']) {
  const result = {};
  const loaded = await Promise.allSettled(keys.map(async (key) => [key, await loadNpcCoreClip(key)]));
  for (let i = 0; i < loaded.length; i++) {
    if (loaded[i].status === 'fulfilled') result[loaded[i].value[0]] = loaded[i].value[1];
    else console.warn('[NPC Core] Animation unavailable:', keys[i], loaded[i].reason);
  }
  return result;
}

export function getNpcCoreCacheStats() {
  return { baseLoaded: !!basePromise, cachedAnimations: clipPromises.size };
}
