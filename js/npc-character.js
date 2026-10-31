// civilian_002 FBX character and Mixamo animation runtime.
import * as THREE from "./lib/three.module.js";
import { FBXLoader } from "./lib/FBXLoader.js";
import { NPC_MODELS, NPC_GLOBAL_CONFIG } from "./npc-config.js";

const loader = new FBXLoader();
const baseCache = new Map();
const clipCache = new Map();

function loadFbx(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

function cloneSkinnedModel(source) {
  const clone = source.clone(true);
  const sourceMeshes = [], cloneMeshes = [], clonedBones = new Map();
  source.traverse((node) => { if (node.isSkinnedMesh) sourceMeshes.push(node); });
  clone.traverse((node) => {
    if (node.isSkinnedMesh) cloneMeshes.push(node);
    if (node.isBone && !clonedBones.has(node.name)) clonedBones.set(node.name, node);
  });
  if (!sourceMeshes.length || sourceMeshes.length !== cloneMeshes.length) {
    throw new Error("civilian_002 FBX has no complete skinned-mesh hierarchy");
  }
  for (let i = 0; i < sourceMeshes.length; i++) {
    const sourceMesh = sourceMeshes[i], cloneMesh = cloneMeshes[i];
    if (!sourceMesh.skeleton) throw new Error("civilian_002 contains an unbound SkinnedMesh");
    const bones = sourceMesh.skeleton.bones.map((bone) => {
      const clonedBone = clonedBones.get(bone.name);
      if (!clonedBone) throw new Error("Missing cloned Mixamo bone: " + bone.name);
      return clonedBone;
    });
    const skeleton = new THREE.Skeleton(bones, sourceMesh.skeleton.boneInverses.map((m) => m.clone()));
    cloneMesh.bind(skeleton, sourceMesh.bindMatrix.clone());
    cloneMesh.bindMode = sourceMesh.bindMode;
    cloneMesh.frustumCulled = false;
  }
  return clone;
}

async function loadBase(modelId) {
  const def = NPC_MODELS[modelId];
  if (!def) throw new Error("Unknown NPC model: " + modelId);
  if (!baseCache.has(modelId)) {
    baseCache.set(modelId, (async () => {
      const model = await loadFbx(def.modelUrl);
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const height = bounds.max.y - bounds.min.y;
      if (!Number.isFinite(height) || height < 0.5) throw new Error("civilian_002 FBX has invalid dimensions");
      model.scale.setScalar(def.targetHeight / height);
      model.updateMatrixWorld(true);
      const fittedBounds = new THREE.Box3().setFromObject(model);
      model.position.y -= fittedBounds.min.y;
      model.updateMatrixWorld(true);
      model.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        node.frustumCulled = false;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (material?.map) material.map.colorSpace = THREE.SRGBColorSpace;
          if (material) material.needsUpdate = true;
        }
      });
      console.info("[NPC] Loaded " + def.displayName + " at " + def.targetHeight + "m");
      return model;
    })());
  }
  return baseCache.get(modelId);
}

async function loadAnimation(modelId, key) {
  const url = NPC_MODELS[modelId]?.animations?.[key];
  if (!url) return null;
  const cacheKey = modelId + ":" + key;
  if (!clipCache.has(cacheKey)) {
    clipCache.set(cacheKey, loadFbx(url).then((group) => {
      const clip = group.animations?.[0];
      if (!clip || !clip.tracks?.length) throw new Error("Mixamo FBX has no tracks: " + key);
      clip.name = key;
      clip.optimize();
      group.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const material of materials) material?.dispose?.();
        }
      });
      return clip;
    }));
  }
  return clipCache.get(cacheKey);
}

export function preloadNpcBase(modelId = NPC_GLOBAL_CONFIG.modelId) {
  return loadBase(modelId);
}

export function preloadNpcAnimations(modelId = NPC_GLOBAL_CONFIG.modelId, keys = ["idle", "walk", "run", "sprint", "talk", "wave", "fall_death"]) {
  return Promise.all(keys.map((key) => loadAnimation(modelId, key)));
}

export class NpcCharacter {
  constructor(modelId = NPC_GLOBAL_CONFIG.modelId) {
    this.modelId = modelId;
    this.root = new THREE.Group();
    this.root.name = "NPC_" + modelId;
    this.model = null;
    this.mixer = null;
    this.actions = new Map();
    this.currentAction = null;
    this.currentAnimation = "";
    this.loadGeneration = 0;
    this.ready = this._build();
  }

  async _build() {
    this.model = cloneSkinnedModel(await loadBase(this.modelId));
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    return this;
  }

  async play(key, options = {}) {
    await this.ready;
    const generation = ++this.loadGeneration;
    const fallback = options.fallback || (key === "sprint" ? "run" : "idle");
    let clip;
    try {
      clip = await loadAnimation(this.modelId, key);
    } catch (error) {
      console.warn("[NPC] Animation load failed: " + key, error);
      clip = await loadAnimation(this.modelId, fallback);
      key = fallback;
    }
    if (!clip) {
      if (key !== "idle") return this.play("idle", { loop: true });
      return false;
    }
    if (generation !== this.loadGeneration) return false;
    const loop = options.loop !== false;
    let action = this.actions.get(key);
    if (!action) {
      action = this.mixer.clipAction(clip, this.model);
      this.actions.set(key, action);
    }
    const previous = this.currentAction;
    action.reset();
    action.enabled = true;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(options.timeScale || 1);
    if (previous && previous !== action) {
      previous.crossFadeTo(action, options.fade ?? NPC_GLOBAL_CONFIG.animation.defaultFadeSeconds, false);
    }
    action.play();
    this.currentAction = action;
    this.currentAnimation = key;
    return true;
  }

  setTimeScale(value) {
    if (!this.currentAction) return;
    this.currentAction.setEffectiveTimeScale(THREE.MathUtils.clamp(
      value, NPC_GLOBAL_CONFIG.animation.minTimeScale, NPC_GLOBAL_CONFIG.animation.maxTimeScale
    ));
  }

  update(dt) {
    if (this.mixer && dt > 0) this.mixer.update(Math.min(dt, 0.05));
  }

  dispose() {
    this.loadGeneration++;
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
    this.actions.clear();
    this.model = null;
    this.mixer = null;
  }
}
